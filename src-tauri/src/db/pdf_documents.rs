use super::*;
use crate::imports::{pdf, types::Dataset};
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub revision: i64,
    pub enabled: bool,
    pub definition: pdf::Definition,
    pub layout: Vec<pdf::Location>,
    pub sample_source_id: String,
    pub source_hash: String,
    pub approved_on: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub source_id: String,
    pub source_revision: i64,
    pub id: String,
    pub revision: i64,
    pub definition: pdf::Definition,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub input: Sample,
    pub token: String,
    pub confirmed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateReview {
    pub extraction: pdf::Extraction,
    pub token: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub source_id: String,
    pub source_revision: i64,
    pub template_id: String,
    pub template_revision: i64,
    pub target_id: String,
    pub month: String,
    pub note: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub token: String,
    pub kind: String,
    pub target_name: String,
    pub prior_amount_cents: Option<i64>,
    pub new_amount_cents: i64,
    pub prior_due_date: String,
    pub due_date: String,
    pub extraction: pdf::Extraction,
    pub calculation: Option<card_statements::Calculation>,
    pub as_of: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Apply {
    pub input: Request,
    pub token: String,
    pub confirmed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub pages: Vec<pdf::Page>,
    pub templates: Vec<Template>,
    pub applied: Option<Applied>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub id: String,
    pub kind: String,
    pub target_id: String,
    pub month: String,
    pub review: Review,
    pub note: String,
}
#[derive(Serialize)]
struct Source {
    fingerprint: String,
    revision: i64,
    account: Option<String>,
    pages: Vec<pdf::Page>,
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn hash<T: Serialize>(v: &T) -> Result<String> {
    Ok(crate::imports::parse::hash(json(v)?.as_bytes()))
}
fn source(conn: &Connection, id: &str) -> Result<Source> {
    let (fingerprint,revision,account,raw,format,dismissed):(String,i64,Option<String>,String,String,bool)=conn.query_row("SELECT fingerprint,revision,account_id,dataset_json,format,dismissed FROM import_sources WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(|_|"Choose a stored PDF document.")?;
    if format != "pdf" || dismissed {
        return Err("Choose a PDF that has not been dismissed.".into());
    }
    let d: Dataset = serde_json::from_str(&raw).map_err(err)?;
    pdf::validate_pages(&d.pdf_pages)?;
    Ok(Source {
        fingerprint,
        revision,
        account,
        pages: d.pdf_pages,
    })
}
pub(super) fn template(conn: &Connection, id: &str, version: Option<i64>) -> Result<Template> {
    let (revision, enabled): (i64, bool) = conn
        .query_row(
            "SELECT revision,enabled FROM pdf_templates WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Choose an approved PDF template.")?;
    let version = version.unwrap_or(revision);
    let (sample,source_hash,def,layout,approved_on):(String,String,String,String,String)=conn.query_row("SELECT sample_source_id,source_hash,definition_json,layout_json,approved_on FROM pdf_template_versions WHERE template_id=?1 AND version=?2",params![id,version],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(err)?;
    Ok(Template {
        id: id.into(),
        revision: version,
        enabled,
        definition: serde_json::from_str(&def).map_err(err)?,
        layout: serde_json::from_str(&layout).map_err(err)?,
        sample_source_id: sample,
        source_hash,
        approved_on,
    })
}
fn retry(conn: &Connection, id: &str, h: &str) -> Result<bool> {
    Uuid::parse_str(id).map_err(|_| "Invalid PDF operation identifier.")?;
    let old: Option<String> = conn
        .query_row(
            "SELECT payload_hash FROM pdf_receipts WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(old) = old {
        if old != h {
            return Err(
                "This PDF operation was used for different changes. Reopen the review.".into(),
            );
        }
        return Ok(true);
    }
    Ok(false)
}
fn receipt<T: Serialize>(
    conn: &Connection,
    id: &str,
    h: &str,
    action: &str,
    payload: &T,
) -> Result<()> {
    conn.execute("INSERT INTO pdf_receipts VALUES(?1,?2)", params![id, h])
        .map_err(err)?;
    conn.execute(
        "INSERT INTO audit(action,payload) VALUES(?1,?2)",
        params![action, json(&(id, payload))?],
    )
    .map_err(err)?;
    Ok(())
}
fn sample_review(conn: &Connection, i: &Sample) -> Result<TemplateReview> {
    Uuid::parse_str(&i.id).map_err(|_| "Invalid template identifier.")?;
    let old: Option<i64> = conn
        .query_row(
            "SELECT revision FROM pdf_templates WHERE id=?1",
            [&i.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if old.unwrap_or(0) != i.revision {
        return Err("Template changed. Reopen it before approving another version.".into());
    }
    let s = source(conn, &i.source_id)?;
    if s.revision != i.source_revision {
        return Err("PDF source changed. Reopen it before previewing.".into());
    }
    if s.pages.is_empty() {
        return Err("Extract a supported text PDF before approving a template.".into());
    }
    let extraction = pdf::evaluate(&i.definition, &s.pages, None)?;
    let token = hash(&(i, &s, &extraction))?;
    Ok(TemplateReview { extraction, token })
}
pub(super) fn preview(
    conn: &Connection,
    i: &Request,
) -> Result<(Review, Option<card_statements::Draft>)> {
    let s = source(conn, &i.source_id)?;
    let t = template(conn, &i.template_id, None)?;
    if s.revision != i.source_revision || t.revision != i.template_revision || !t.enabled {
        return Err(
            "Document or template changed, or the template is paused. Reopen the review.".into(),
        );
    }
    if i.note.trim().is_empty() || i.note.len() > 1000 {
        return Err("Enter a document reference/review note up to 1,000 characters.".into());
    }
    let used = ai_documents::used(conn, &s.fingerprint)?;
    if used {
        return Err("This document's evidence was already applied. Review its saved application or edit the existing bill/statement directly.".into());
    }
    let extraction = pdf::evaluate(&t.definition, &s.pages, Some(&t.layout))?;
    if !extraction.errors.is_empty() {
        return Err(extraction.errors.join("\n"));
    }
    let target = document_values::Target {
        target_id: i.target_id.clone(),
        month: i.month.clone(),
        note: i.note.clone(),
    };
    let values = document_values::Values {
        kind: t.definition.kind.clone(),
        amount_cents: extraction
            .cents(if t.definition.kind == "bill" {
                "amount_due"
            } else {
                "statement_balance"
            })
            .ok_or("Missing document total.")?,
        due_date: extraction
            .date("due_date")
            .ok_or("Missing due date.")?
            .into(),
        closing_date: extraction.date("closing_date").map(str::to_owned),
    };
    let (r, draft) = document_values::preview(conn, s.account.as_deref(), &target, &values)?;
    let token = hash(&(
        i,
        &s,
        &t,
        &extraction,
        &r.state_hash,
        &r.calculation,
        &r.as_of,
    ))?;
    Ok((
        Review {
            token,
            kind: t.definition.kind,
            target_name: r.target_name,
            prior_amount_cents: r.prior_amount_cents,
            new_amount_cents: r.new_amount_cents,
            prior_due_date: r.prior_due_date,
            due_date: r.due_date,
            extraction,
            calculation: r.calculation,
            as_of: r.as_of,
        },
        draft,
    ))
}

impl Store {
    pub fn pdf_original(&self, id: &str) -> Result<String> {
        use base64::Engine;
        let (format, expected): (String, String) = self
            .conn
            .query_row(
                "SELECT format,fingerprint FROM import_sources WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        if format != "pdf" {
            return Err("Choose an original PDF source.".into());
        }
        let (_, bytes) = self.import_content(id)?;
        if bytes.len() > crate::imports::MAX_FILE_BYTES
            || !bytes.starts_with(b"%PDF-")
            || crate::imports::parse::fingerprint(&bytes, "pdf")? != expected
        {
            return Err(
                "Original PDF evidence is invalid or exceeds the 10 MB viewer limit.".into(),
            );
        }
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }
    pub fn export_original_pdf(&self, directory: &Path, id: &str) -> Result<String> {
        let parsed = Uuid::parse_str(id).map_err(|_| "Invalid PDF source identifier.")?;
        source(&self.conn, id)?;
        let (_, bytes) = self.import_content(id)?;
        fs::create_dir_all(directory).map_err(err)?;
        let path = directory.join(format!("{}.pdf", parsed));
        if path.exists() {
            if fs::read(&path).map_err(err)? != bytes {
                return Err(
                    "An existing export differs from this source. Move it before exporting again."
                        .into(),
                );
            }
        } else {
            use std::io::Write;
            let mut f = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(err)?;
            f.write_all(&bytes).map_err(err)?;
        }
        Ok(path.to_string_lossy().into_owned())
    }

    pub fn pdf_document(&self, id: &str) -> Result<Document> {
        let s = source(&self.conn, id)?;
        let mut q = self
            .conn
            .prepare("SELECT id FROM pdf_templates ORDER BY rowid")
            .map_err(err)?;
        let ids = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        let templates = ids
            .iter()
            .map(|id| template(&self.conn, id, None))
            .collect::<Result<Vec<_>>>()?;
        let applied=self.conn.query_row("SELECT id,kind,target_id,month,proof_json,note FROM pdf_applications WHERE fingerprint=?1",[s.fingerprint],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get::<_,String>(4)?,r.get(5)?))).optional().map_err(err)?.map(|(id,kind,target_id,month,raw,note)|Ok::<_,String>(Applied{id,kind,target_id,month,review:serde_json::from_str(&raw).map_err(err)?,note})).transpose()?;
        Ok(Document {
            pages: s.pages,
            templates,
            applied,
        })
    }
    pub fn preview_pdf_template(&self, input: Sample) -> Result<TemplateReview> {
        sample_review(&self.conn, &input)
    }
    pub fn approve_pdf_template(&mut self, operation: &str, input: Approval) -> Result<()> {
        let h = hash(&("approve", &input))?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        if !input.confirmed {
            return Err(
                "Confirm the sample values and mapping before approving this template.".into(),
            );
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let r = sample_review(&tx, &input.input)?;
        if r.token != input.token || !r.extraction.errors.is_empty() {
            return Err(
                "The sample preview changed or has unresolved checks. Preview again.".into(),
            );
        }
        let i = &input.input;
        let s = source(&tx, &i.source_id)?;
        let version = i.revision + 1;
        tx.execute("INSERT INTO pdf_templates VALUES(?1,?2,1) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,enabled=1",params![i.id,version]).map_err(err)?;
        tx.execute(
            "INSERT INTO pdf_template_versions VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                i.id,
                version,
                i.source_id,
                s.fingerprint,
                json(&i.definition)?,
                json(&r.extraction.layout)?,
                Local::now().date_naive().to_string()
            ],
        )
        .map_err(err)?;
        receipt(
            &tx,
            operation,
            &h,
            "approve_pdf_template",
            &(input, &r.extraction),
        )?;
        periods::commit(tx)
    }
    pub fn set_pdf_template_enabled(
        &mut self,
        operation: &str,
        id: &str,
        revision: i64,
        enabled: bool,
    ) -> Result<()> {
        let h = hash(&("enabled", id, revision, enabled))?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let old = template(&tx, id, None)?;
        if old.revision != revision {
            return Err("Template version changed. Reload before changing its status.".into());
        }
        // Status is deliberately separate from the immutable mapping version.
        tx.execute(
            "UPDATE pdf_templates SET enabled=?1 WHERE id=?2",
            params![enabled, id],
        )
        .map_err(err)?;
        receipt(
            &tx,
            operation,
            &h,
            "pdf_template_status",
            &(id, revision, enabled),
        )?;
        periods::commit(tx)
    }
    pub fn preview_pdf_application(&self, input: Request) -> Result<Review> {
        preview(&self.conn, &input).map(|v| v.0)
    }
    pub fn apply_pdf_application(&mut self, operation: &str, input: Apply) -> Result<()> {
        let h = hash(&("apply", &input))?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        if !input.confirmed {
            return Err(
                "Confirm the document evidence and the changes to the selected record.".into(),
            );
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        apply_reviewed(&tx, operation, input)?;
        periods::commit(tx)
    }
}
pub(super) fn apply_reviewed(conn: &Connection, operation: &str, input: Apply) -> Result<()> {
    let h = hash(&("apply", &input))?;
    if retry(conn, operation, &h)? {
        return Ok(());
    }
    if !input.confirmed {
        return Err("Confirm the document application first.".into());
    }
    let i = &input.input;
    let (review, draft) = preview(conn, i)?;
    if review.token != input.token {
        return Err(
            "Document or target changed. Preview and confirm the current values again.".into(),
        );
    }
    let s = source(conn, &i.source_id)?;
    document_values::write(
        conn,
        &i.source_id,
        &document_values::Target {
            target_id: i.target_id.clone(),
            month: i.month.clone(),
            note: i.note.clone(),
        },
        &document_values::Values {
            kind: review.kind.clone(),
            amount_cents: review.new_amount_cents,
            due_date: review.due_date.clone(),
            closing_date: review.extraction.date("closing_date").map(str::to_owned),
        },
        draft,
    )?;
    conn.execute(
        "INSERT INTO pdf_applications VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            operation,
            i.source_id,
            s.fingerprint,
            i.template_id,
            i.template_revision,
            review.kind,
            i.target_id,
            i.month,
            json(&review)?,
            i.note
        ],
    )
    .map_err(err)?;
    receipt(conn, operation, &h, "apply_pdf_document", &(input, &review))?;
    Ok(())
}
pub(super) fn protect_account(conn: &Connection, id: &str, account: &str) -> Result<()> {
    ai_documents::protect_account(conn, id, account)?;
    let bound: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pdf_applications WHERE source_id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if bound {
        let current: Option<String> = conn
            .query_row(
                "SELECT account_id FROM import_sources WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if current.as_deref() != Some(account) {
            return Err("This PDF already supports a reviewed financial document. Keep its assigned account or use a new observation.".into());
        }
    }
    Ok(())
}
pub(super) fn protect_source(conn: &Connection, id: &str) -> Result<()> {
    ai_documents::protect_source(conn, id)?;
    let used:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM pdf_template_versions WHERE sample_source_id=?1 UNION ALL SELECT 1 FROM pdf_applications WHERE source_id=?1)",[id],|r|r.get(0)).map_err(err)?;
    if used {
        return Err("This PDF supports an approved template or applied document. Its extraction is preserved; use a new observation for a different mapping.".into());
    }
    Ok(())
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let mut q=conn.prepare("SELECT s.id,s.dataset_json,e.content FROM import_sources s JOIN import_evidence e ON e.fingerprint=s.fingerprint WHERE s.format='pdf'").map_err(err)?;
    let sources = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Vec<u8>>(2)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (_, raw, bytes) in &sources {
        let d: Dataset = serde_json::from_str(raw).map_err(err)?;
        pdf::validate_pages(&d.pdf_pages)?;
        if !d.pdf_pages.is_empty() && pdf::extract(bytes)?.pdf_pages != d.pdf_pages {
            return Err("Saved PDF text does not match its original evidence.".into());
        }
    }
    let mut q = conn
        .prepare(
            "SELECT template_id,version FROM pdf_template_versions ORDER BY template_id,version",
        )
        .map_err(err)?;
    let versions = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, version) in versions {
        Uuid::parse_str(&id).map_err(err)?;
        let t = template(conn, &id, Some(version))?;
        // Dismissal is reversible UI state and does not invalidate immutable evidence.
        let (fp, raw): (String, String) = conn
            .query_row(
                "SELECT fingerprint,dataset_json FROM import_sources WHERE id=?1",
                [&t.sample_source_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        let d: Dataset = serde_json::from_str(&raw).map_err(err)?;
        let day = NaiveDate::parse_from_str(&t.approved_on, "%Y-%m-%d").map_err(err)?;
        let e = pdf::evaluate_at(&t.definition, &d.pdf_pages, Some(&t.layout), day)?;
        if fp != t.source_hash || !e.errors.is_empty() {
            return Err("Invalid approved PDF template evidence.".into());
        }
    }
    let mut q = conn
        .prepare("SELECT id,revision FROM pdf_templates")
        .map_err(err)?;
    let templates = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, revision) in templates {
        let (count,max):(i64,i64)=conn.query_row("SELECT COUNT(*),COALESCE(MAX(version),0) FROM pdf_template_versions WHERE template_id=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
        if count != revision || max != revision {
            return Err("PDF template version history is incomplete.".into());
        }
        template(conn, &id, None)?;
    }
    let mut q=conn.prepare("SELECT id,source_id,fingerprint,template_id,template_version,kind,target_id,month,proof_json,note FROM pdf_applications").map_err(err)?;
    let apps = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, String>(9)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, source, fp, tid, version, kind, target, month, raw, note) in apps {
        Uuid::parse_str(&id).map_err(err)?;
        let has_receipt: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pdf_receipts WHERE id=?1)",
                [&id],
                |row| row.get(0),
            )
            .map_err(err)?;
        let r: Review = serde_json::from_str(&raw).map_err(err)?;
        let t = template(conn, &tid, Some(version))?;
        let (actual_fp, raw): (String, String) = conn
            .query_row(
                "SELECT fingerprint,dataset_json FROM import_sources WHERE id=?1",
                [source],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        let d: Dataset = serde_json::from_str(&raw).map_err(err)?;
        let e = pdf::evaluate_at(
            &t.definition,
            &d.pdf_pages,
            Some(&t.layout),
            NaiveDate::parse_from_str(&r.as_of, "%Y-%m-%d").map_err(err)?,
        )?;
        if kind == "bill" {
            if !month.is_empty() || r.calculation.is_some() {
                return Err("Invalid bill PDF application history.".into());
            }
        } else {
            validate_month(&month)?;
            card_statements::validate_calculation(
                r.calculation
                    .as_ref()
                    .ok_or("Missing PDF statement calculation.")?,
                e.date("closing_date")
                    .ok_or("Missing PDF statement cutoff.")?,
            )?;
        }
        let exists: bool = if kind == "bill" {
            conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM bill_occurrences WHERE id=?1)",
                [target],
                |r| r.get(0),
            )
            .map_err(err)?
        } else {
            conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM card_statements WHERE account_id=?1 AND month=?2)",
                params![target, month],
                |r| r.get(0),
            )
            .map_err(err)?
        };
        if !exists
            || !has_receipt
            || fp != actual_fp
            || kind != t.definition.kind
            || kind != r.kind
            || e != r.extraction
            || !e.errors.is_empty()
            || e.cents(if kind == "bill" {
                "amount_due"
            } else {
                "statement_balance"
            }) != Some(r.new_amount_cents)
            || e.date("due_date") != Some(r.due_date.as_str())
            || note.trim().is_empty()
            || note.len() > 1000
            || r.token.len() != 64
            || !r.token.bytes().all(|v| v.is_ascii_hexdigit())
        {
            return Err("Applied PDF evidence is inconsistent.".into());
        }
    }
    let mut q = conn
        .prepare("SELECT id,payload_hash FROM pdf_receipts")
        .map_err(err)?;
    let receipts = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, h) in receipts {
        Uuid::parse_str(&id).map_err(err)?;
        if h.len() != 64 || !h.bytes().all(|v| v.is_ascii_hexdigit()) {
            return Err("Invalid PDF operation history.".into());
        }
    }
    Ok(())
}
