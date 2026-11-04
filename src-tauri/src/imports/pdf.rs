use super::{types::Dataset, Result, MAX_FILE_BYTES};
use chrono::{Datelike, Local, NaiveDate};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::LazyLock};
pub const MAX_PAGES: usize = 100;
pub const MAX_TEXT: usize = 1_000_000;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub number: u32,
    pub lines: Vec<String>,
}
pub fn validate_pages(pages: &[Page]) -> Result<()> {
    if pages.len() > MAX_PAGES
        || pages.iter().enumerate().any(|(i, p)| {
            p.number != i as u32 + 1
                || p.lines.len() > 5000
                || p.lines.iter().any(|s| s.len() > 4000)
        })
        || pages
            .iter()
            .flat_map(|p| &p.lines)
            .map(String::len)
            .sum::<usize>()
            > MAX_TEXT
    {
        return Err("PDF text exceeds the supported page/text limits.".into());
    }
    Ok(())
}
pub fn extract(bytes: &[u8]) -> Result<Dataset> {
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES || !bytes.starts_with(b"%PDF-") {
        return Err("Use a readable PDF no larger than 10 MB.".into());
    }
    let doc=lopdf::Document::load_mem_with_options(bytes,lopdf::LoadOptions{strict:true,max_decompressed_size:Some(8*1024*1024),..Default::default()}).map_err(|_|"PDF could not be decoded locally. Password-protected, damaged or unsupported files can remain as evidence; use an unlocked text PDF or manual entry.")?;
    if doc.is_encrypted() {
        return Err("Password-protected PDFs are evidence only. Export an unlocked copy for local extraction.".into());
    }
    let pages = doc.get_pages();
    if pages.is_empty() || pages.len() > MAX_PAGES || doc.objects.len() > 100_000 {
        return Err("Use a PDF with 1-100 pages and a smaller object count.".into());
    }
    let mut out = Vec::new();
    let mut size = 0;
    for number in pages.keys() {
        let text=doc.extract_text_with_limit(&[*number],2*1024*1024).map_err(|_|"PDF text could not be extracted within local limits. Keep it as evidence and enter the values manually.".to_string())?;
        size += text.len();
        if size > MAX_TEXT {
            return Err("PDF text exceeds 1 MB. Split the document into smaller PDFs.".into());
        }
        out.push(Page {
            number: *number,
            lines: text
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        });
    }
    validate_pages(&out)?;
    if out.iter().all(|p| p.lines.is_empty()) {
        return Err("No text layer found. Scanned PDFs remain evidence; use manual entry or a supported text PDF.".into());
    }
    Ok(Dataset{pdf_pages:out,notes:vec!["Text extracted locally. Approve a bill/statement template and review field evidence before applying values. Transaction tables are not automatically imported.".into()],..Default::default()})
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    pub page: u32,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub key: String,
    pub page: u32,
    pub label: String,
    pub placement: String,
    pub date_format: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub key: String,
    pub sign: i64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    pub name: String,
    pub kind: String,
    pub page_count: u32,
    pub identity: Anchor,
    pub currency: Anchor,
    pub fields: Vec<Field>,
    pub sum_parts: Vec<Part>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub key: String,
    pub page: u32,
    pub line: usize,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Value {
    pub key: String,
    pub page: u32,
    pub line: usize,
    pub label_line: usize,
    pub raw: String,
    pub date: Option<String>,
    pub cents: Option<i64>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extraction {
    pub values: Vec<Value>,
    pub layout: Vec<Location>,
    pub errors: Vec<String>,
    pub notes: Vec<String>,
}
fn norm(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn date_key(key: &str) -> bool {
    key.ends_with("_date")
}
fn keys(kind: &str) -> &[&str] {
    if kind == "bill" {
        &[
            "amount_due",
            "due_date",
            "invoice_date",
            "subtotal",
            "tax",
            "fees",
        ]
    } else {
        &[
            "statement_balance",
            "closing_date",
            "due_date",
            "minimum_due",
            "previous_balance",
            "payments",
            "credits",
            "purchases",
            "fees",
            "interest",
        ]
    }
}
pub fn validate_definition(d: &Definition) -> Result<()> {
    if d.name.trim().is_empty()
        || d.name.len() > 100
        || !["bill", "statement"].contains(&d.kind.as_str())
        || !(1..=MAX_PAGES as u32).contains(&d.page_count)
        || d.fields.len() > 16
    {
        return Err("Choose a name, document type, and 1-100 pages with at most 16 fields.".into());
    }
    for a in [&d.identity, &d.currency] {
        if a.page == 0 || a.page > d.page_count || a.text.trim().len() < 3 || a.text.len() > 200 {
            return Err("Choose a page and a recognizable identity/currency line.".into());
        }
    }
    if !d
        .currency
        .text
        .split(|c: char| !c.is_ascii_alphabetic())
        .any(|v| v.eq_ignore_ascii_case("USD"))
    {
        return Err("The currency marker must explicitly contain USD.".into());
    }
    let mut seen = HashSet::new();
    for f in &d.fields {
        if !keys(&d.kind).contains(&f.key.as_str())
            || !seen.insert(&f.key)
            || f.page == 0
            || f.page > d.page_count
            || f.label.trim().len() < 3
            || f.label.len() > 150
            || !["inline", "next_line"].contains(&f.placement.as_str())
            || !["iso", "mdy", "dmy"].contains(&f.date_format.as_str())
        {
            return Err("Use unique supported fields, exact labels, valid pages and a supported date format.".into());
        }
        if ["amount_due", "statement_balance"].contains(&f.key.as_str())
            && norm(&f.label)
                .split(|c: char| !c.is_ascii_alphabetic())
                .any(|word| matches!(word, "minimum" | "min"))
        {
            return Err(
                "Minimum due cannot be used as the total bill or statement balance.".into(),
            );
        }
    }
    let required = if d.kind == "bill" {
        vec!["amount_due", "due_date"]
    } else {
        vec!["statement_balance", "closing_date", "due_date"]
    };
    if required
        .iter()
        .any(|key| !d.fields.iter().any(|f| f.key == *key))
    {
        return Err("Map every required amount and date field.".into());
    }
    let mut parts = HashSet::new();
    let total = if d.kind == "bill" {
        "amount_due"
    } else {
        "statement_balance"
    };
    if d.sum_parts.len() > 12
        || d.sum_parts.iter().any(|p| {
            ![-1, 1].contains(&p.sign)
                || !parts.insert(&p.key)
                || p.key == total
                || date_key(&p.key)
                || !seen.contains(&p.key)
        })
    {
        return Err(
            "Arithmetic parts must be unique mapped money fields with a plus or minus sign.".into(),
        );
    }
    Ok(())
}
fn money(s: &str) -> Result<i64> {
    static RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^(?:USD\s+)?(-?)(?:\$)?((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{2})?)(?:\s+USD)?$").unwrap()
    });
    let c = RE
        .captures(s.trim())
        .ok_or("Amount is not an unambiguous USD value.")?;
    Ok(crate::money::cents(&c[2].replace(',', ""))? * if &c[1] == "-" { -1 } else { 1 })
}
fn calendar(s: &str, format: &str) -> Result<String> {
    let fmt = match format {
        "iso" => "%Y-%m-%d",
        "mdy" => "%m/%d/%Y",
        _ => "%d/%m/%Y",
    };
    let d = NaiveDate::parse_from_str(s.trim(), fmt)
        .map_err(|_| "Date does not match the selected format with a four-digit year.")?;
    if !(1900..=2100).contains(&d.year()) {
        return Err("Date is outside 1900-2100.".into());
    }
    Ok(d.to_string())
}
pub fn evaluate(
    d: &Definition,
    pages: &[Page],
    baseline: Option<&[Location]>,
) -> Result<Extraction> {
    evaluate_at(d, pages, baseline, Local::now().date_naive())
}
pub fn evaluate_at(
    d: &Definition,
    pages: &[Page],
    baseline: Option<&[Location]>,
    as_of: NaiveDate,
) -> Result<Extraction> {
    validate_definition(d)?;
    validate_pages(pages)?;
    let mut out = Extraction {
        values: vec![],
        layout: vec![],
        errors: vec![],
        notes: vec![],
    };
    if pages.len() != d.page_count as usize {
        out.errors
            .push("Page count changed from the approved template.".into());
    }
    for (key, a) in [("identity", &d.identity), ("currency", &d.currency)] {
        let hits: Vec<_> = pages
            .get(a.page as usize - 1)
            .map(|p| {
                p.lines
                    .iter()
                    .enumerate()
                    .filter(|(_, line)| norm(line) == norm(&a.text))
                    .map(|(i, _)| i + 1)
                    .collect()
            })
            .unwrap_or_default();
        if hits.len() != 1 {
            out.errors.push(format!(
                "Expected one exact {key} marker on page {}; found {}.",
                a.page,
                hits.len()
            ));
        } else {
            out.layout.push(Location {
                key: key.into(),
                page: a.page,
                line: hits[0],
            });
        }
    }
    for f in &d.fields {
        let label = norm(f.label.trim_end_matches(':'));
        let mut hits = Vec::new();
        if let Some(page) = pages.get(f.page as usize - 1) {
            for (i, line) in page.lines.iter().enumerate() {
                let normalized = norm(line);
                if f.placement == "next_line" {
                    if normalized.trim_end_matches(':') == label {
                        hits.push((
                            i + 1,
                            i + 2,
                            page.lines.get(i + 1).cloned().unwrap_or_default(),
                        ));
                    }
                } else if let Some(rest) = normalized.strip_prefix(&label) {
                    if rest.starts_with(':') || rest.starts_with(' ') {
                        hits.push((
                            i + 1,
                            i + 1,
                            rest.trim_start_matches(':').trim().to_uppercase(),
                        ));
                    }
                }
            }
        }
        if hits.len() != 1 {
            out.errors.push(format!(
                "{}: expected one label on page {}; found {}.",
                f.key,
                f.page,
                hits.len()
            ));
            continue;
        }
        let (label_line, line, raw) = hits.remove(0);
        out.layout.push(Location {
            key: f.key.clone(),
            page: f.page,
            line: label_line,
        });
        let mut value = Value {
            key: f.key.clone(),
            page: f.page,
            line,
            label_line,
            raw,
            date: None,
            cents: None,
        };
        let result = if date_key(&f.key) {
            calendar(&value.raw, &f.date_format).map(|v| value.date = Some(v))
        } else {
            money(&value.raw).and_then(|v| {
                if v < 0 && f.key != "statement_balance" {
                    return Err(
                        "Use a nonnegative amount; arithmetic signs are configured separately."
                            .into(),
                    );
                }
                value.cents = Some(v);
                Ok(())
            })
        };
        if let Err(e) = result {
            out.errors.push(format!("{}: {e}", f.key));
        }
        out.values.push(value);
    }
    if let Some(old) = baseline {
        if old != out.layout {
            out.errors.push("Label positions changed. Review the document and approve a new template version before applying.".into());
        }
    }
    if let (Some(close), Some(due)) = (out.date("closing_date"), out.date("due_date")) {
        let a = NaiveDate::parse_from_str(close, "%Y-%m-%d").map_err(|e| e.to_string())?;
        let b = NaiveDate::parse_from_str(due, "%Y-%m-%d").map_err(|e| e.to_string())?;
        if a > as_of || b < a || (b - a).num_days() > 93 {
            out.errors.push(
                "Statement closing/due dates are implausible or the statement has not closed yet."
                    .into(),
            );
        }
    }
    if let (Some(invoice), Some(due)) = (out.date("invoice_date"), out.date("due_date")) {
        let a = NaiveDate::parse_from_str(invoice, "%Y-%m-%d").unwrap();
        let b = NaiveDate::parse_from_str(due, "%Y-%m-%d").unwrap();
        if b < a || (b - a).num_days() > 366 {
            out.errors
                .push("Bill due date is inconsistent with its invoice date.".into());
        }
    }
    if d.sum_parts.is_empty() {
        out.notes.push("No component arithmetic is configured. Confirm the total against the original document.".into());
    } else {
        let mut sum = Some(0i64);
        for p in &d.sum_parts {
            sum = sum
                .zip(out.cents(&p.key))
                .and_then(|(a, b)| a.checked_add(b * p.sign));
        }
        let total = out.cents(if d.kind == "bill" {
            "amount_due"
        } else {
            "statement_balance"
        });
        if sum.is_none() || sum != total {
            out.errors
                .push("Component arithmetic does not equal the extracted total.".into());
        } else {
            out.notes
                .push("Component arithmetic matches the total exactly.".into());
        }
    }
    Ok(out)
}
impl Extraction {
    pub fn cents(&self, key: &str) -> Option<i64> {
        self.values
            .iter()
            .find(|v| v.key == key)
            .and_then(|v| v.cents)
    }
    pub fn date(&self, key: &str) -> Option<&str> {
        self.values
            .iter()
            .find(|v| v.key == key)
            .and_then(|v| v.date.as_deref())
    }
}
