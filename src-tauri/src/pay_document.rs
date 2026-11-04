//! Bounded local evidence extraction for payroll sources. No files are unpacked to disk.
use crate::{
    imports::{parse, MAX_FILE_BYTES},
    pay_calendar::{suggest_table, Chunk, Document},
};
use quick_xml::{events::Event, Reader};
use std::{
    collections::BTreeSet,
    io::{Cursor, Read},
};
type Result<T> = std::result::Result<T, String>;
pub struct Prepared {
    pub format: String,
    pub mime: String,
    pub fingerprint: String,
    pub document: Document,
}
pub fn prepare(name: &str, bytes: &[u8]) -> Result<Prepared> {
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
        return Err("Use a nonempty payroll document no larger than 10 MB.".into());
    }
    if name.len() > 250 || name.trim().is_empty() {
        return Err("Use a document name up to 250 characters.".into());
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if ext == "docx" {
        let mut document = docx(bytes)?;
        original_anchor(&mut document);
        document.validate()?;
        return Ok(Prepared {
            format: "docx".into(),
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into(),
            fingerprint: format!("docx:{}", parse::hash(bytes)),
            document,
        });
    }
    let prepared = parse::prepare(name, bytes, None)?;
    let mut document = Document::default();
    if !prepared.error.is_empty() {
        document.warnings.push(prepared.error);
    }
    if prepared.format == "pdf" {
        for p in &prepared.dataset.pdf_pages {
            for (i, line) in p.lines.iter().enumerate() {
                document.chunks.push(Chunk {
                    location: format!("PDF page {} line {}", p.number, i + 1),
                    text: line.clone(),
                });
            }
        }
    } else if prepared.dataset.image {
        for (i, row) in prepared.dataset.rows.iter().enumerate() {
            document.chunks.push(Chunk {
                location: format!("OCR line {}", i + 1),
                text: row.last().cloned().unwrap_or_default(),
            });
        }
        document.warnings.push("OCR may omit or misread dates. Compare with the original image; no date has been approved.".into());
    } else {
        suggest_table(
            &mut document,
            &prepared.dataset.headers,
            &prepared.dataset.rows,
            "Table",
        );
        if prepared.dataset.sheet_names.len() > 1 {
            document.warnings.push(format!(
                "Only worksheet {} was read. Export other calendar sheets separately.",
                prepared.dataset.sheet
            ));
        }
    }
    document.warnings.push("Only explicit ISO dates in recognized table columns become proposals. Use the evidence viewer to enter other calendar dates; years and workweek assignments are never inferred from a filename.".into());
    original_anchor(&mut document);
    document.validate()?;
    Ok(Prepared {
        format: prepared.format,
        mime: prepared.mime,
        fingerprint: prepared.fingerprint,
        document,
    })
}
fn original_anchor(doc: &mut Document) {
    doc.chunks.insert(0,Chunk { location: "Original document".into(), text: "Original evidence retained. Visually verify dates and year in the original document; this reference is not an extracted date.".into() });
}
fn docx(bytes: &[u8]) -> Result<Document> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "This DOCX is not a readable ZIP document.")?;
    if archive.len() > 2000 {
        return Err("DOCX contains too many parts.".into());
    }
    let mut total = 0_u64;
    let mut names = BTreeSet::new();
    for i in 0..archive.len() {
        let f = archive
            .by_index(i)
            .map_err(|_| "DOCX part is unreadable.")?;
        let name = f.name();
        if f.enclosed_name().is_none()
            || name.contains('\\')
            || !names.insert(name.to_string())
            || f.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("DOCX contains an unsafe or duplicate part path.".into());
        }
        total = total.checked_add(f.size()).ok_or("DOCX size overflow.")?;
        if total > 32 * 1024 * 1024 || f.size() > 16 * 1024 * 1024 {
            return Err("DOCX expanded size exceeds local limits.".into());
        }
    }
    if !names.contains("[Content_Types].xml") || !names.contains("word/document.xml") {
        return Err("DOCX is missing its main document.".into());
    }
    let mut xml = Vec::new();
    archive
        .by_name("word/document.xml")
        .map_err(|_| "Missing document text.")?
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut xml)
        .map_err(|_| "DOCX text could not be read.")?;
    if xml.len() > 4 * 1024 * 1024 {
        return Err("DOCX text exceeds 4 MB.".into());
    }
    let text = std::str::from_utf8(&xml).map_err(|_| "Use a UTF-8 DOCX document.")?;
    let mut doc = xml_document(text)?;
    let images = names
        .iter()
        .filter(|n| n.starts_with("word/media/"))
        .count();
    if images > 0 {
        doc.warnings.push(format!("{images} embedded media part(s) are retained in the original DOCX. Text extraction does not read their calendar dates. Review them in the original or import a screenshot separately."));
    }
    doc.warnings.push("DOCX text and tables are evidence only until reviewed. Headers, footers, floating layout and embedded images can contain additional dates; compare the original before confirming a year.".into());
    Ok(doc)
}
fn xml_document(xml: &str) -> Result<Document> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().check_end_names = true;
    let mut out = Document::default();
    let (mut depth, mut table, mut paragraph) = (0_usize, 0_usize, 0_usize);
    let (mut in_text, mut in_cell, mut in_table) = (false, false, false);
    let (mut cell, mut body) = (String::new(), String::new());
    let mut row: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<String>> = Vec::new();
    loop {
        match reader
            .read_event()
            .map_err(|e| format!("Malformed DOCX XML: {e}"))?
        {
            Event::DocType(_) => {
                return Err(
                    "DTD and external entities are not accepted in payroll documents.".into(),
                )
            }
            Event::Start(e) => {
                depth += 1;
                if depth > 128 {
                    return Err("DOCX XML nesting exceeds local limits.".into());
                }
                match e.local_name().as_ref() {
                    "t" => in_text = true,
                    "tbl" => {
                        if in_table {
                            return Err(
                                "Nested DOCX tables need a simpler export for calendar review."
                                    .into(),
                            );
                        }
                        in_table = true;
                        table += 1;
                        rows.clear();
                    }
                    "tr" => row.clear(),
                    "tc" => {
                        in_cell = true;
                        cell.clear();
                    }
                    "p" if !in_cell => body.clear(),
                    _ => (),
                }
            }
            Event::End(e) => {
                depth = depth.checked_sub(1).ok_or("Unbalanced DOCX XML.")?;
                match e.local_name().as_ref() {
                    "t" => in_text = false,
                    "p" if in_cell => cell.push(' '),
                    "p" if !body.trim().is_empty() => {
                        paragraph += 1;
                        out.chunks.push(Chunk {
                            location: format!("DOCX paragraph {paragraph}"),
                            text: body.trim().to_string(),
                        });
                        body.clear();
                    }
                    "tc" => {
                        in_cell = false;
                        row.push(cell.trim().to_string());
                    }
                    "tr" => {
                        if row.len() > 80 {
                            return Err("DOCX table has too many columns.".into());
                        }
                        rows.push(row.clone());
                    }
                    "tbl" => {
                        in_table = false;
                        if let Some(headers) = rows.first() {
                            suggest_table(
                                &mut out,
                                headers,
                                &rows[1..],
                                &format!("DOCX table {table}"),
                            );
                            out.chunks.push(Chunk {
                                location: format!("DOCX table {table} row 1"),
                                text: headers.join(" | "),
                            });
                        }
                    }
                    _ => (),
                }
            }
            Event::Empty(e) => {
                if ["tab", "br", "cr"].contains(&e.local_name().as_ref()) {
                    if in_cell {
                        cell.push(' ');
                    } else {
                        body.push(' ');
                    }
                }
            }
            Event::Text(e) if in_text => {
                if in_cell {
                    cell.push_str(e.as_ref());
                } else {
                    body.push_str(e.as_ref());
                }
            }
            Event::CData(e) if in_text => {
                if in_cell {
                    cell.push_str(e.as_ref());
                } else {
                    body.push_str(e.as_ref());
                }
            }
            Event::GeneralRef(e) if in_text => {
                let c = if let Some(c) = e
                    .resolve_char_ref()
                    .map_err(|_| "Invalid XML character reference.")?
                {
                    c
                } else {
                    match e.as_ref() {
                        "amp" => '&',
                        "lt" => '<',
                        "gt" => '>',
                        "quot" => '"',
                        "apos" => '\'',
                        _ => return Err("Custom XML entities are not accepted.".into()),
                    }
                };
                if in_cell {
                    cell.push(c);
                } else {
                    body.push(c);
                }
            }
            Event::Eof => break,
            _ => (),
        }
        if cell.len() > 4000 || body.len() > 4000 || rows.len() > 5000 || out.chunks.len() > 5000 {
            return Err("DOCX text exceeds local review limits.".into());
        }
    }
    if depth != 0 {
        return Err("DOCX XML ended before the document was complete.".into());
    }
    out.validate()?;
    Ok(out)
}
