use super::{
    pdf::{self, Page},
    Result, MAX_ROWS,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    pub name: String,
    pub identity: String,
    pub currency: String,
    pub start: String,
    pub end: String,
    pub headers: Vec<String>,
    pub separator: String,
    pub automatic: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowEvidence {
    pub page: u32,
    pub first_line: usize,
    pub last_line: usize,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extraction {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub evidence: Vec<RowEvidence>,
}
fn norm(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
pub fn validate(d: &Definition) -> Result<()> {
    if d.name.trim().is_empty()
        || d.name.len() > 100
        || d.headers.len() < 3
        || d.headers.len() > 30
        || !["pipe", "tab", "spaces", "lines"].contains(&d.separator.as_str())
    {
        return Err("Choose a template name, 3-30 columns and a supported table layout.".into());
    }
    for s in [&d.identity, &d.currency, &d.start, &d.end] {
        if s.trim().len() < 3 || s.len() > 300 {
            return Err("Use exact document and table marker lines (3-300 characters).".into());
        }
    }
    if norm(&d.start) == norm(&d.end)
        || !d
            .currency
            .split(|c: char| !c.is_ascii_alphabetic())
            .any(|s| s.eq_ignore_ascii_case("USD"))
    {
        return Err("Choose distinct table markers and an explicit USD currency line.".into());
    }
    let mut names = std::collections::HashSet::new();
    for h in &d.headers {
        if h.trim().is_empty() || h.len() > 100 || !names.insert(norm(h)) {
            return Err("Column names must be nonempty and unique.".into());
        }
    }
    Ok(())
}
pub fn recognizes(d: &Definition, pages: &[Page]) -> bool {
    pages
        .first()
        .is_some_and(|p| p.lines.iter().any(|l| norm(l) == norm(&d.identity)))
}
pub fn extract(d: &Definition, pages: &[Page]) -> Result<Extraction> {
    validate(d)?;
    pdf::validate_pages(pages)?;
    let first = pages.first().ok_or("No PDF text is available.")?;
    for (kind, text) in [
        ("document identity", &d.identity),
        ("USD currency", &d.currency),
    ] {
        if first.lines.iter().filter(|l| norm(l) == norm(text)).count() != 1 {
            return Err(format!("Expected one exact {kind} line on page 1."));
        }
    }
    let mut out = Extraction {
        headers: d.headers.clone(),
        rows: vec![],
        evidence: vec![],
    };
    for page in pages {
        let positions = |s: &str| {
            page.lines
                .iter()
                .enumerate()
                .filter(|(_, l)| norm(l) == norm(s))
                .map(|(i, _)| i)
                .collect::<Vec<_>>()
        };
        let starts = positions(&d.start);
        let ends = positions(&d.end);
        if starts.len() != 1 || ends.len() != 1 || starts[0] >= ends[0] {
            return Err(format!("Page {}: expected one ordered pair of table markers. Review changed or unsupported layout.",page.number));
        }
        let begin = starts[0] + 1;
        let stop = ends[0];
        let width = d.headers.len();
        if d.separator == "lines" {
            if (stop - begin) % width != 0 {
                return Err(format!(
                    "Page {}: incomplete cell group. No rows were staged.",
                    page.number
                ));
            }
            for (i, group) in page.lines[begin..stop].chunks(width).enumerate() {
                out.rows.push(group.to_vec());
                out.evidence.push(RowEvidence {
                    page: page.number,
                    first_line: begin + i * width + 1,
                    last_line: begin + (i + 1) * width,
                });
            }
        } else {
            for (index, line) in page.lines.iter().enumerate().take(stop).skip(begin) {
                let cells: Vec<String> = match d.separator.as_str() {
                    "pipe" => line.split('|').map(|s| s.trim().to_string()).collect(),
                    "tab" => line.split('\t').map(|s| s.trim().to_string()).collect(),
                    _ => {
                        let mut cells = Vec::new();
                        let mut start = 0;
                        let b = line.as_bytes();
                        let mut i = 0;
                        while i < b.len() {
                            if b[i] == b' ' {
                                let a = i;
                                while i < b.len() && b[i] == b' ' {
                                    i += 1;
                                }
                                if i - a >= 2 {
                                    cells.push(line[start..a].trim().to_string());
                                    start = i;
                                }
                            } else {
                                i += 1;
                            }
                        }
                        cells.push(line[start..].trim().to_string());
                        cells
                    }
                };
                if cells.len() != width || cells.iter().all(|s| s.is_empty()) {
                    return Err(format!("Page {}, line {}: expected {width} columns; found {}. No rows were staged.",page.number,index+1,cells.len()));
                }
                out.rows.push(cells);
                out.evidence.push(RowEvidence {
                    page: page.number,
                    first_line: index + 1,
                    last_line: index + 1,
                });
            }
        }
        if out.rows.len() > MAX_ROWS {
            return Err("PDF tables exceed 5,000 rows. Split the document.".into());
        }
    }
    Ok(out)
}
