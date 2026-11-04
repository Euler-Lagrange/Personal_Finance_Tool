use super::*;
use crate::assistance::{
    client::{Attachment, Failure, Material, Outcome, Usage},
    proposal::{self, Proposal},
    settings::Config,
};
use crate::imports::{parse, types::Dataset};
use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub source_id: String,
    pub source_revision: i64,
    pub provider: String,
    pub task: String,
    pub scope: String,
    pub text: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bound {
    pub input: Input,
    pub fingerprint: String,
    pub content_hash: String,
    pub model: String,
    pub settings_revision: i64,
    pub page_count: Option<u32>,
    pub attachment_bytes: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Consent {
    pub token: String,
    pub model: String,
    pub source_name: String,
    pub attachment_bytes: usize,
    pub text: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Start {
    pub id: String,
    pub input: Input,
    pub token: String,
    pub confirmed: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub source_id: String,
    pub request: Bound,
    pub status: String,
    pub created_at: String,
    pub finished_at: Option<String>,
    pub proposal: Option<Proposal>,
    pub failure: Option<Failure>,
    pub retry_not_before: Option<i64>,
    /// Billed token counts reported by the provider for a completed request.
    pub usage: Option<Usage>,
}
fn json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(err)
}
fn hash<T: Serialize>(value: &T) -> Result<String> {
    Ok(parse::hash(json(value)?.as_bytes()))
}
/// Provider maximum for one PDF document block.
const MAX_PDF_PAGES: usize = 600;
// Local text extraction is capped at 100 pages and may fail on scans. Its page
// vector is not the original document's page count. Count the verified bytes
// separately before preparing consent or attaching the file to a request.
fn original_pdf_pages(bytes: &[u8]) -> Result<u32> {
    let doc = lopdf::Document::load_mem_with_options(
        bytes,
        lopdf::LoadOptions {
            strict: true,
            max_decompressed_size: Some(8 * 1024 * 1024),
            ..Default::default()
        },
    )
    .map_err(|_| {
        "This PDF's pages could not be verified. Use reviewed text or an unlocked, readable PDF."
    })?;
    if doc.is_encrypted() || doc.objects.len() > 100_000 {
        return Err(
            "Use an unlocked PDF with a smaller object count, or send reviewed text.".into(),
        );
    }
    let pages = doc.get_pages().len();
    if pages == 0 || pages > MAX_PDF_PAGES {
        return Err(
            "Original PDFs must contain 1–600 pages. Use reviewed text or a shorter document."
                .into(),
        );
    }
    Ok(pages as u32)
}
fn input_valid(i: &Input) -> Result<()> {
    Uuid::parse_str(&i.source_id).map_err(|_| "Choose a stored source.")?;
    crate::assistance::provider(&i.provider)?;
    proposal::task(&i.task)?;
    if i.source_revision < 1
        || !["text", "original"].contains(&i.scope.as_str())
        || i.text.len() > 60_000
        || (i.scope == "text" && i.text.trim().is_empty())
    {
        return Err("Select source text up to 60,000 bytes or an original PDF/image.".into());
    }
    Ok(())
}
fn bound(conn: &Connection, i: &Input, c: &Config) -> Result<(Bound, String, Material)> {
    input_valid(i)?;
    if !c.enabled || c.model.is_empty() {
        return Err("Enable and configure this provider before preparing a request.".into());
    }
    let (fingerprint,revision,name,format,mime,raw,bytes,dismissed):(String,i64,String,String,String,String,Vec<u8>,bool)=conn.query_row("SELECT s.fingerprint,s.revision,s.name,s.format,e.mime,s.dataset_json,e.content,s.dismissed FROM import_sources s JOIN import_evidence e ON e.fingerprint=s.fingerprint WHERE s.id=?1",[&i.source_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?))).map_err(|_|"Source is unavailable in this workspace.")?;
    if dismissed || revision != i.source_revision {
        return Err(
            "Source changed or was dismissed. Reopen it and review the material again.".into(),
        );
    }
    if bytes.is_empty()
        || bytes.len() > crate::imports::MAX_FILE_BYTES
        || parse::fingerprint(&bytes, &format)? != fingerprint
    {
        return Err("Stored source evidence failed verification.".into());
    }
    let dataset: Dataset = serde_json::from_str(&raw).map_err(err)?;
    if (i.task == "mapping"
        && (!["csv", "excel"].contains(&format.as_str()) || dataset.image || dataset.assisted))
        || (["pdf_template", "pdf_table"].contains(&i.task.as_str())
            && (format != "pdf" || dataset.pdf_pages.is_empty()))
    {
        return Err("Choose structured CSV/Excel for columns, or a PDF with local text for reusable templates.".into());
    }

    let page_count = if format == "pdf" && i.scope == "original" {
        Some(original_pdf_pages(&bytes)?)
    } else if format == "pdf" && !dataset.pdf_pages.is_empty() {
        Some(dataset.pdf_pages.len() as u32)
    } else {
        None
    };
    let attachment = if i.scope == "original" {
        if !["application/pdf", "image/png", "image/jpeg", "image/webp"].contains(&mime.as_str()) {
            return Err("Original attachments support PDF, PNG, JPEG or WebP. Use reviewed text for other formats.".into());
        }
        Some(Attachment {
            mime,
            data: base64::engine::general_purpose::STANDARD.encode(&bytes),
        })
    } else {
        None
    };
    let attachment_bytes = if attachment.is_some() { bytes.len() } else { 0 };
    let b = Bound {
        input: i.clone(),
        fingerprint,
        content_hash: parse::hash(&bytes),
        model: c.model.clone(),
        settings_revision: c.revision,
        page_count,
        attachment_bytes,
    };
    Ok((
        b,
        name,
        Material {
            text: i.text.clone(),
            attachment,
        },
    ))
}
type StoredJob = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<String>,
);
pub(super) fn job(conn: &Connection, id: &str) -> Result<Job> {
    let (source,request,status,created,finished,proposal,failure,retry,usage):StoredJob=conn.query_row("SELECT source_id,request_json,status,created_at,finished_at,proposal_json,failure_json,retry_not_before,usage_json FROM ai_jobs WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?))).map_err(|_|"Request is unavailable in this workspace.")?;
    Ok(Job {
        id: id.into(),
        source_id: source,
        request: serde_json::from_str(&request).map_err(err)?,
        status,
        created_at: created,
        finished_at: finished,
        proposal: proposal
            .map(|s| serde_json::from_str(&s).map_err(err))
            .transpose()?,
        failure: failure
            .map(|s| serde_json::from_str(&s).map_err(err))
            .transpose()?,
        retry_not_before: retry,
        usage: usage
            .map(|s| serde_json::from_str(&s).map_err(err))
            .transpose()?,
    })
}
impl Store {
    pub fn ai_prepare(&self, i: &Input, c: &Config) -> Result<Consent> {
        let (b, name, _) = bound(&self.conn, i, c)?;
        Ok(Consent {
            token: hash(&b)?,
            model: c.model.clone(),
            source_name: name,
            attachment_bytes: b.attachment_bytes,
            text: i.text.clone(),
        })
    }
    // A repeat ID returns its existing state before checking mutable source/settings.
    // A caller may send only when this method returns Some(material).
    pub fn ai_begin(
        &mut self,
        s: &Start,
        c: &Config,
        session: &str,
    ) -> Result<(Job, Option<Material>)> {
        Uuid::parse_str(&s.id).map_err(|_| "Invalid request identifier.")?;
        if !s.confirmed {
            return Err("Confirm the selected material and provider before sending.".into());
        }
        let payload_hash = hash(&(&s.input, &s.token))?;
        let old: Option<String> = self
            .conn
            .query_row(
                "SELECT payload_hash FROM ai_jobs WHERE id=?1",
                [&s.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(old) = old {
            if old != payload_hash {
                return Err(
                    "This request ID belongs to different material. Prepare a new request.".into(),
                );
            }
            return Ok((job(&self.conn, &s.id)?, None));
        }
        let (b, _, material) = bound(&self.conn, &s.input, c)?;
        if hash(&b)? != s.token {
            return Err(
                "Source, material or provider settings changed. Review and confirm again.".into(),
            );
        }
        let cooldown:Option<i64>=self.conn.query_row("SELECT MAX(retry_not_before) FROM ai_jobs WHERE json_extract(request_json,'$.input.provider')=?1",[&s.input.provider],|r|r.get(0)).map_err(err)?;
        if cooldown.is_some_and(|t| t > Utc::now().timestamp()) {
            return Err("The provider requested a wait before another request. Check the saved request's retry time.".into());
        }
        self.conn.execute("INSERT INTO ai_jobs(id,source_id,request_json,payload_hash,status,session_id,created_at) VALUES(?1,?2,?3,?4,'running',?5,?6)",params![s.id,s.input.source_id,json(&b)?,payload_hash,session,Utc::now().to_rfc3339()]).map_err(err)?;
        Ok((job(&self.conn, &s.id)?, Some(material)))
    }
    pub fn ai_jobs(&self, source: &str) -> Result<Vec<Job>> {
        let mut q=self.conn.prepare("SELECT id FROM ai_jobs WHERE source_id=?1 ORDER BY created_at DESC,id DESC LIMIT 100").map_err(err)?;
        let ids = q
            .query_map([source], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        ids.iter().map(|id| job(&self.conn, id)).collect()
    }
    pub fn ai_cancel(&mut self, id: &str) -> Result<Job> {
        self.conn.execute("UPDATE ai_jobs SET status='cancelled',finished_at=?2 WHERE id=?1 AND status='running'",params![id,Utc::now().to_rfc3339()]).map_err(err)?;
        job(&self.conn, id)
    }
    pub fn ai_interrupt(&mut self, session: &str) -> Result<()> {
        self.conn.execute("UPDATE ai_jobs SET status='interrupted',finished_at=?2 WHERE status='running' AND session_id<>?1",params![session,Utc::now().to_rfc3339()]).map_err(err)?;
        Ok(())
    }
    pub fn ai_finish<T: Into<Outcome>>(
        &mut self,
        id: &str,
        result: std::result::Result<T, Failure>,
    ) -> Result<Job> {
        let j = job(&self.conn, id)?;
        if j.status != "running" {
            return Ok(j);
        }
        let result=result.and_then(|v| {
            let Outcome { proposal, usage } = v.into();
            let p:Proposal=serde_json::from_value(proposal).map_err(|_|Failure::new("invalid_output","The response did not match the requested fields. No values were applied."))?;
            proposal::validate(&p,&j.request.input.task,j.request.page_count).map_err(|_|Failure::new("invalid_output","The proposal contains invalid dates, amounts or evidence. No values were applied; use a smaller source or review manually."))?;
            Ok((p, usage))
        });
        let (status, p, f, retry, usage) = match result {
            Ok((p, usage)) => (
                "completed",
                Some(json(&p)?),
                None,
                None,
                usage.map(|u| json(&u)).transpose()?,
            ),
            Err(f) => {
                let retry = f.retry_after.map(|s| {
                    Utc::now()
                        .timestamp()
                        .saturating_add(i64::try_from(s).unwrap_or(i64::MAX))
                });
                ("failed", None, Some(json(&f)?), retry, None)
            }
        };
        self.conn.execute("UPDATE ai_jobs SET status=?2,finished_at=?3,proposal_json=?4,failure_json=?5,retry_not_before=?6,usage_json=?7 WHERE id=?1 AND status='running'",params![id,status,Utc::now().to_rfc3339(),p,f,retry,usage]).map_err(err)?;
        job(&self.conn, id)
    }
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let mut q = conn
        .prepare("SELECT id,payload_hash FROM ai_jobs")
        .map_err(err)?;
    for r in q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
    {
        let (id, payload) = r.map_err(err)?;
        Uuid::parse_str(&id).map_err(|_| "Invalid saved assistance request.")?;
        let j = job(conn, &id)?;
        input_valid(&j.request.input)?;
        if j.source_id != j.request.input.source_id
            || payload != hash(&(&j.request.input, hash(&j.request)?))?
            || j.request.model.is_empty()
            || j.request.model.len() > 120
            || j.request.settings_revision < 0
        {
            return Err("Assistance request provenance is invalid.".into());
        }
        let (fingerprint,revision,bytes):(String,i64,Vec<u8>)=conn.query_row("SELECT s.fingerprint,s.revision,e.content FROM import_sources s JOIN import_evidence e ON e.fingerprint=s.fingerprint WHERE s.id=?1",[&j.source_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
        if fingerprint != j.request.fingerprint
            || revision < j.request.input.source_revision
            || parse::hash(&bytes) != j.request.content_hash
            || j.request.attachment_bytes
                != if j.request.input.scope == "original" {
                    bytes.len()
                } else {
                    0
                }
        {
            return Err("Assistance source evidence does not match.".into());
        }
        if let Some(p) = &j.proposal {
            proposal::validate(p, &j.request.input.task, j.request.page_count)?;
        }
        if (j.status == "completed") != j.proposal.is_some()
            || (j.status == "failed") != j.failure.is_some()
            || (j.status == "running") != j.finished_at.is_none()
        {
            return Err("Assistance request state is inconsistent.".into());
        }
    }
    Ok(())
}
