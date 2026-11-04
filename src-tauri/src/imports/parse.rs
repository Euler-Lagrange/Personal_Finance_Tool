use super::{types::*, Result, MAX_FILE_BYTES, MAX_ROWS};
use calamine::{open_workbook_auto_from_rs, DataType, Reader};
use chrono::{Datelike, Local, NaiveDate};
use image::{ImageReader, Limits};
use regex::Regex;
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::sync::LazyLock;

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn decode_image(bytes: &[u8]) -> Result<image::DynamicImage> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(10000);
    limits.max_image_height = Some(10000);
    limits.max_alloc = Some(100 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| "Image is unreadable or too large. Use a smaller screenshot.".into())
}
pub fn fingerprint(bytes: &[u8], format: &str) -> Result<String> {
    if format == "image" {
        let img = decode_image(bytes)?.to_rgba8();
        let mut h = Sha256::new();
        h.update(img.width().to_le_bytes());
        h.update(img.height().to_le_bytes());
        h.update(img.as_raw());
        Ok(format!("image:{h:x}", h = h.finalize()))
    } else {
        Ok(format!("{format}:{}", hash(bytes)))
    }
}
pub fn prepare(name: &str, bytes: &[u8], sheet: Option<&str>) -> Result<Prepared> {
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
        return Err("Use a nonempty file no larger than 10 MB.".into());
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let (format, mime) = match ext.as_str() {
        "csv" | "tsv" => ("csv", "text/csv"),
        "xlsx" | "xls" => ("excel", "application/octet-stream"),
        "pdf" => ("pdf", "application/pdf"),
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "webp" => ("image", "image/webp"),
        "bmp" => ("image", "image/bmp"),
        _ => return Err("Supported files: CSV, TSV, XLSX, XLS, PDF, PNG, JPG, WebP, BMP.".into()),
    };
    let fingerprint = fingerprint(bytes, format)?;
    let extracted = match format {
        "csv" => csv_data(bytes, ext == "tsv"),
        "excel" => excel_data(bytes, sheet),
        "image" => image_data(bytes),
        _ => super::pdf::extract(bytes),
    };
    let (dataset, error) = match extracted.and_then(check_dataset) {
        Ok(d) => (d, String::new()),
        Err(e) => (Dataset::default(), e),
    };
    Ok(Prepared {
        fingerprint,
        mime: mime.into(),
        format: format.into(),
        dataset,
        error,
    })
}
fn check_dataset(d: Dataset) -> Result<Dataset> {
    if d.rows.len() > MAX_ROWS
        || d.headers.len() > 80
        || d.rows
            .iter()
            .any(|r| r.len() > 80 || r.iter().any(|c| c.len() > 4000))
    {
        return Err("Export exceeds the review limit (5,000 rows, 80 columns, 4,000 characters per cell). Split it into smaller exports.".into());
    }
    Ok(d)
}
fn table(mut rows: Vec<Vec<String>>) -> Result<Dataset> {
    rows.retain(|r| r.iter().any(|c| !c.trim().is_empty()));
    if rows.is_empty() {
        return Err("No rows found in this export.".into());
    }
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    let mut headers = rows.remove(0);
    headers.resize(width, String::new());
    for (i, h) in headers.iter_mut().enumerate() {
        if h.trim().is_empty() {
            *h = format!("Column {}", i + 1);
        }
    }
    for row in &mut rows {
        row.resize(width, String::new());
    }
    Ok(Dataset {
        headers,
        rows,
        ..Dataset::default()
    })
}
fn csv_data(bytes: &[u8], tsv: bool) -> Result<Dataset> {
    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if !bytes.len().is_multiple_of(2) {
            return Err("Invalid UTF-16 export.".into());
        }
        let little = bytes[0] == 0xff;
        let words: Vec<_> = bytes[2..]
            .chunks_exact(2)
            .map(|c| {
                if little {
                    u16::from_le_bytes([c[0], c[1]])
                } else {
                    u16::from_be_bytes([c[0], c[1]])
                }
            })
            .collect();
        String::from_utf16(&words).map_err(|_| "Invalid UTF-16 export.")?
    } else {
        std::str::from_utf8(bytes)
            .map_err(|_| "Save this export as UTF-8 CSV or XLSX and try again.")?
            .trim_start_matches('\u{feff}')
            .to_string()
    };
    let delimiters: &[u8] = if tsv { b"\t" } else { b",\t;" };
    let delimiter = *delimiters
        .iter()
        .max_by_key(|&&d| {
            csv::ReaderBuilder::new()
                .delimiter(d)
                .has_headers(false)
                .from_reader(text.as_bytes())
                .records()
                .next()
                .and_then(|r| r.ok())
                .map(|r| r.len())
                .unwrap_or(0)
        })
        .unwrap();
    let mut rows = Vec::new();
    for record in csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes())
        .records()
    {
        let record = record.map_err(|e| format!("CSV could not be read: {e}"))?;
        if rows.len() > MAX_ROWS {
            return Err("Export has more than 5,000 rows. Use a shorter date range.".into());
        }
        rows.push(record.iter().map(|s| s.trim().to_string()).collect());
    }
    table(rows)
}
fn excel_data(bytes: &[u8], sheet: Option<&str>) -> Result<Dataset> {
    if bytes.starts_with(b"PK") {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|_| "Excel archive could not be read.")?;
        if archive.len() > 2000 {
            return Err("Workbook contains too many files. Export this account as CSV.".into());
        }
        let mut total = 0u64;
        for index in 0..archive.len() {
            total = total.saturating_add(
                archive
                    .by_index_raw(index)
                    .map_err(|_| "Excel archive entry could not be read.")?
                    .size(),
            );
        }
        if archive.len() > 2000 || total > 50 * 1024 * 1024 {
            return Err(
                "Workbook expands beyond the safe review limit. Export this account as CSV.".into(),
            );
        }
    }
    let mut book = open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|_| "Excel workbook could not be read. Try exporting a CSV.")?;
    let names = book.sheet_names().to_vec();
    let selected = sheet
        .or_else(|| names.first().map(String::as_str))
        .ok_or("Workbook has no sheets.")?;
    let range = book
        .worksheet_range(selected)
        .map_err(|_| "Selected worksheet could not be read.")?;
    if range.height() > MAX_ROWS + 1 || range.width() > 80 {
        return Err("Worksheet is too large. Export a table with at most 5,000 transaction rows and 80 columns.".into());
    }
    let mut d = table(
        range
            .rows()
            .map(|r| {
                r.iter()
                    .map(|c| {
                        (if c.is_datetime() || c.is_datetime_iso() {
                            c.as_date()
                        } else {
                            None
                        })
                        .map(|v| v.format("%Y-%m-%d").to_string())
                        .unwrap_or_else(|| c.to_string())
                    })
                    .collect()
            })
            .collect(),
    )?;
    d.sheet = selected.into();
    d.sheet_names = names;
    Ok(d)
}
fn image_data(bytes: &[u8]) -> Result<Dataset> {
    #[cfg(windows)]
    {
        Ok(ocr_lines(super::windows_ocr::read(bytes)?))
    }
    #[cfg(not(windows))]
    {
        let _ = bytes;
        Err("Local OCR requires Windows.".into())
    }
}
pub fn ocr_lines(lines: Vec<String>) -> Dataset {
    let date=Regex::new(r"^\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:,?\s+\d{4})?)\s+(.+)$").unwrap();
    let amount = Regex::new(r"(?:[-+]?\$?\s*\d[\d,]*\.\d{2}|\(\$?\d[\d,]*\.\d{2}\))").unwrap();
    let rows = lines
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .map(|line| {
            let (d, body) = date
                .captures(&line)
                .map(|c| (c[1].to_string(), c[2].to_string()))
                .unwrap_or((String::new(), line.clone()));
            let amounts: Vec<_> = amount.find_iter(&body).collect();
            let (description, value) = if amounts.len() == 1 {
                let a = amounts[0];
                (
                    format!("{} {}", &body[..a.start()], &body[a.end()..])
                        .trim()
                        .to_string(),
                    a.as_str().into(),
                )
            } else {
                (body, String::new())
            };
            vec![d, description, value, line]
        })
        .collect();
    Dataset{headers:vec!["Date".into(),"Description".into(),"Amount".into(),"Source line".into()],rows,image:true,notes:vec!["Screenshot coverage is partial. Review every extracted row against the image; OCR may miss rows, signs, or decimal points. Multiple amounts are held for correction.".into()],..Dataset::default()}
}
pub fn default_mapping(d: &Dataset) -> Mapping {
    let col = |names: &[&str]| {
        d.headers
            .iter()
            .position(|h| names.contains(&h.to_lowercase().as_str()))
    };
    Mapping {
        date_column: col(&["date", "transaction date", "trans. date"]),
        description_column: col(&[
            "description",
            "merchant",
            "payee",
            "transaction description",
        ]),
        amount_column: col(&["amount", "transaction amount"]),
        debit_column: None,
        credit_column: None,
        status_column: col(&["status"]),
        type_column: col(&["type", "transaction type"]),
        posted_date_column: col(&["posted date", "posting date", "post date"]),
        stable_id_column: None,
        currency_column: col(&["currency", "currency code"]),
        stable_ids_confirmed: false,
        amount_mode: "".into(),
        date_format: "month_first".into(),
        year: None,
        posted_confirmed: false,
    }
}
pub fn validate_mapping(m: &Mapping, d: &Dataset) -> Result<()> {
    for col in [
        m.date_column,
        m.description_column,
        m.amount_column,
        m.debit_column,
        m.credit_column,
        m.status_column,
        m.type_column,
        m.posted_date_column,
        m.stable_id_column,
        m.currency_column,
    ]
    .into_iter()
    .flatten()
    {
        if col >= d.headers.len() {
            return Err("Choose columns from this export.".into());
        }
    }
    if m.date_column.is_none() || m.description_column.is_none() {
        return Err("Choose the spending date and description columns.".into());
    }
    if !["month_first", "day_first", "iso"].contains(&m.date_format.as_str())
        || m.year.is_some_and(|y| !(1900..=2100).contains(&y))
    {
        return Err("Choose a valid date format and year.".into());
    }
    if m.amount_mode == "separate" {
        if m.debit_column.is_none()
            || m.credit_column.is_none()
            || m.debit_column == m.credit_column
        {
            return Err("Choose separate debit and credit columns.".into());
        }
    } else if !["outflow_positive", "inflow_positive"].contains(&m.amount_mode.as_str())
        || m.amount_column.is_none()
    {
        return Err("Choose an amount column and confirm what positive amounts mean.".into());
    }
    if m.stable_ids_confirmed && m.stable_id_column.is_none() {
        return Err("Choose the stable source-ID column before confirming it.".into());
    }
    let mut used = vec![m.date_column.unwrap(), m.description_column.unwrap()];
    used.extend(
        [m.stable_id_column, m.currency_column]
            .into_iter()
            .flatten(),
    );
    if m.amount_mode == "separate" {
        used.extend([m.debit_column.unwrap(), m.credit_column.unwrap()]);
    } else {
        used.push(m.amount_column.unwrap());
    }
    let n = used.len();
    used.sort();
    used.dedup();
    if n != used.len() {
        return Err("Date, description, and money must use different columns.".into());
    }
    Ok(())
}
pub fn signed_cents(s: &str) -> Option<i64> {
    let raw = s.trim().replace(['$', ' '], "");
    static RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^(?:[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?|\((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?\))$").unwrap()
    });
    if !RE.is_match(&raw) {
        return None;
    }
    let neg = raw.starts_with('-') || raw.starts_with('(');
    let value = raw.trim_matches(['(', ')', '-', '+']).replace(',', "");
    crate::money::cents(&value)
        .ok()
        .map(|c| if neg { -c } else { c })
}
fn parse_date(raw: &str, m: &Mapping) -> Option<String> {
    let raw = raw.trim();
    let mut formats = vec!["%Y-%m-%d"];
    if m.date_format == "month_first" {
        formats.extend([
            "%m/%d/%Y",
            "%m/%d/%y",
            "%m-%d-%Y",
            "%m-%d-%y",
            "%b %d, %Y",
            "%B %d, %Y",
            "%b %d %Y",
            "%B %d %Y",
        ]);
    } else if m.date_format == "day_first" {
        formats.extend(["%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y"]);
    }
    let mut date = formats.iter().find_map(|f| {
        NaiveDate::parse_from_str(raw, f)
            .ok()
            .filter(|d| (1900..=2100).contains(&d.year()))
    });
    if date.is_none() {
        if let Some(year) = m.year {
            let s = format!("{raw}/{year}");
            let f = if m.date_format == "day_first" {
                "%d/%m/%Y"
            } else {
                "%m/%d/%Y"
            };
            date = NaiveDate::parse_from_str(&s, f)
                .ok()
                .or_else(|| NaiveDate::parse_from_str(&format!("{raw} {year}"), "%b %d %Y").ok());
        }
    }
    date.filter(|d| (1900..=2100).contains(&d.year()))
        .map(|d| d.format("%Y-%m-%d").to_string())
}
pub fn candidate(row: &[String], m: &Mapping, image: bool) -> Candidate {
    let cell = |col: Option<usize>| {
        col.and_then(|i| row.get(i))
            .map(String::as_str)
            .unwrap_or("")
    };
    let date = parse_date(cell(m.date_column), m);
    let mut warnings = Vec::new();
    if date.is_none() {
        warnings.push("Date needs correction or an explicit year.".into());
    }
    if date
        .as_ref()
        .is_some_and(|d| d > &Local::now().format("%Y-%m-%d").to_string())
    {
        warnings.push("Future date: verify the source.".into());
    }
    let (amount, direction) = if m.amount_mode == "separate" {
        let debit = if cell(m.debit_column).is_empty() {
            Some(0)
        } else {
            signed_cents(cell(m.debit_column))
        };
        let credit = if cell(m.credit_column).is_empty() {
            Some(0)
        } else {
            signed_cents(cell(m.credit_column))
        };
        match (debit, credit) {
            (Some(d), Some(0)) if d > 0 => (Some(d), "out"),
            (Some(0), Some(c)) if c > 0 => (Some(c), "in"),
            _ => (None, "unknown"),
        }
    } else {
        match signed_cents(cell(m.amount_column)) {
            Some(a)
                if a != 0
                    && ["outflow_positive", "inflow_positive"]
                        .contains(&m.amount_mode.as_str()) =>
            {
                (
                    Some(a.abs()),
                    if (a > 0) == (m.amount_mode == "outflow_positive") {
                        "out"
                    } else {
                        "in"
                    },
                )
            }
            _ => (None, "unknown"),
        }
    };
    if amount.is_none() {
        warnings.push("Amount or debit/credit direction needs review.".into());
    }
    let raw_status = cell(m.status_column).to_lowercase();
    let status = if raw_status.contains("pending") || raw_status.contains("processing") {
        "pending"
    } else if ["posted", "completed", "cleared", "settled"].contains(&raw_status.trim())
        || (m.posted_confirmed && raw_status.is_empty())
    {
        "posted"
    } else {
        "unknown"
    };
    if status != "posted" {
        warnings
            .push("Only posted transactions can be imported. Keep pending rows on hold.".into());
    }
    if image {
        warnings
            .push("Verify OCR against the screenshot, including missing rows and signs.".into());
    }
    let posted_date = m
        .posted_date_column
        .and_then(|_| parse_date(cell(m.posted_date_column), m));
    if m.posted_date_column.is_some() && posted_date.is_none() {
        warnings.push("Posted date needs correction.".into());
    }
    let currency = if m.currency_column.is_some() {
        cell(m.currency_column).trim().to_uppercase()
    } else {
        "USD".into()
    };
    if currency != "USD" {
        warnings.push("Only verified USD amounts are supported. Check the currency.".into());
    }
    let stable_id = if m.stable_ids_confirmed {
        let value = cell(m.stable_id_column).trim();
        if value.is_empty() || value.len() > 200 {
            warnings.push("Stable source ID is missing or too long.".into());
            None
        } else {
            Some(value.into())
        }
    } else {
        None
    };
    Candidate {
        posted_date,
        stable_id,
        currency,
        date,
        description: cell(m.description_column).into(),
        amount_cents: amount,
        direction: direction.into(),
        status: status.into(),
        source_type: cell(m.type_column).into(),
        warnings,
    }
}
pub fn dataset_candidate(row: &[String], mapping: &Mapping, dataset: &Dataset) -> Candidate {
    let mut c = candidate(row, mapping, dataset.image);
    if dataset.assisted {
        c.warnings.push("AI-assisted reading: confirm every value and source quote individually; coverage may be incomplete.".into());
    }
    c
}
