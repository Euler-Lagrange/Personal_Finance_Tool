use super::{parse::decode_image, Result};
use std::io::Cursor;
use windows::{
    Graphics::Imaging::BitmapDecoder,
    Media::Ocr::OcrEngine,
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
};

pub fn read(bytes: &[u8]) -> Result<Vec<String>> {
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
        .map_err(|_| "Windows OCR could not initialize.")?;
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }
    let _apartment = Apartment;
    extract(bytes).map_err(|e|format!("Local OCR could not read this image ({e}). The original is saved; try a clearer screenshot or a CSV export."))
}
fn extract(bytes: &[u8]) -> Result<Vec<String>> {
    let engine=OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_|"No Windows OCR language is available. Install English language support in Windows Settings.")?;
    let max = OcrEngine::MaxImageDimension().map_err(|e| e.to_string())?;
    let img = decode_image(bytes)?.thumbnail(max, max);
    let mut encoded = Cursor::new(Vec::new());
    img.write_to(&mut encoded, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let stream = InMemoryRandomAccessStream::new().map_err(|e| e.to_string())?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(|e| e.to_string())?;
    writer
        .WriteBytes(encoded.get_ref())
        .map_err(|e| e.to_string())?;
    writer
        .StoreAsync()
        .map_err(|e| e.to_string())?
        .join()
        .map_err(|e| e.to_string())?;
    writer.DetachStream().map_err(|e| e.to_string())?;
    stream.Seek(0).map_err(|e| e.to_string())?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|e| e.to_string())?
        .join()
        .map_err(|e| e.to_string())?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| e.to_string())?
        .join()
        .map_err(|e| e.to_string())?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| e.to_string())?
        .join()
        .map_err(|e| e.to_string())?;
    let mut words = Vec::new();
    for line in result.Lines().map_err(|e| e.to_string())? {
        for word in line.Words().map_err(|e| e.to_string())? {
            let rect = word.BoundingRect().map_err(|e| e.to_string())?;
            words.push((
                rect.Y + rect.Height / 2.0,
                rect.X,
                rect.Height,
                word.Text().map_err(|e| e.to_string())?.to_string(),
            ));
        }
    }
    words.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut grouped: Vec<Vec<(f32, f32, f32, String)>> = Vec::new();
    for word in words {
        if let Some(row) = grouped
            .last_mut()
            .filter(|r| (r[0].0 - word.0).abs() < r[0].2.min(word.2) * 0.5)
        {
            row.push(word);
        } else {
            grouped.push(vec![word]);
        }
    }
    Ok(grouped
        .into_iter()
        .map(|mut row| {
            row.sort_by(|a, b| a.1.total_cmp(&b.1));
            row.into_iter().map(|w| w.3).collect::<Vec<_>>().join(" ")
        })
        .collect())
}
