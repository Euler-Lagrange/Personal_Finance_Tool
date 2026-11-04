use super::*;
use crate::{
    pay_calendar::{Document, Evidence},
    pay_document::Prepared,
    payroll::Change,
};
use base64::Engine;
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub format: String,
    pub mime: String,
    pub created_at: String,
    pub applications: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub source: Source,
    pub document: Document,
}
fn source(conn: &Connection, id: &str) -> Result<Source> {
    conn.query_row("SELECT id,name,format,mime,created_at,(SELECT count(*) FROM payroll_changes WHERE (json_extract(change_json,'$.kind')='calendar' AND json_extract(change_json,'$.review.sourceId')=payroll_sources.id) OR (json_extract(change_json,'$.kind')='observation' AND EXISTS(SELECT 1 FROM json_each(change_json,'$.input.evidence') e WHERE json_extract(e.value,'$.sourceId')=payroll_sources.id))) FROM payroll_sources WHERE id=?1",[id],|r|Ok(Source{id:r.get(0)?,name:r.get(1)?,format:r.get(2)?,mime:r.get(3)?,created_at:r.get(4)?,applications:r.get(5)?})).map_err(err)
}
fn document(conn: &Connection, id: &str) -> Result<Document> {
    let (raw, hash): (String, String) = conn
        .query_row(
            "SELECT document_json,document_hash FROM payroll_sources WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    if crate::imports::parse::hash(raw.as_bytes()) != hash {
        return Err("Payroll source text failed integrity validation.".into());
    }
    let d: Document = serde_json::from_str(&raw).map_err(err)?;
    d.validate()?;
    Ok(d)
}
fn check_evidence(conn: &Connection, e: &Evidence) -> Result<()> {
    crate::pay_calendar::validate_evidence(e)?;
    let d = document(conn, &e.source_id)?;
    if !d
        .chunks
        .iter()
        .any(|c| c.location == e.location && c.text.contains(&e.quote))
    {
        return Err("The supporting quote is not present at that source location.".into());
    }
    Ok(())
}
pub(super) fn validate_change(conn: &Connection, change: &Change) -> Result<()> {
    if let Change::Observation { input } = change {
        for e in &input.evidence {
            check_evidence(conn, e)?;
        }
    }
    if let Change::Calendar { review } = change {
        if let Some(id) = &review.source_id {
            document(conn, id)?;
        }
        for p in &review.periods {
            for e in &p.evidence {
                check_evidence(conn, e)?;
            }
        }
        for h in &review.holidays {
            if let Some(e) = &h.evidence {
                check_evidence(conn, e)?;
            }
        }
    }
    Ok(())
}
impl Store {
    pub fn ingest_pay_source(
        &mut self,
        name: &str,
        bytes: Vec<u8>,
        prepared: Prepared,
    ) -> Result<String> {
        if bytes.is_empty() || bytes.len() > crate::imports::MAX_FILE_BYTES || name.len() > 250 {
            return Err("Payroll source is oversized.".into());
        }
        prepared.document.validate()?;
        if let Some(id) = self
            .conn
            .query_row(
                "SELECT id FROM payroll_sources WHERE fingerprint=?1",
                [&prepared.fingerprint],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
        {
            return Ok(id);
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let id = Uuid::new_v4().to_string();
        let raw = serde_json::to_string(&prepared.document).map_err(err)?;
        tx.execute("INSERT INTO payroll_sources(id,fingerprint,name,format,mime,bytes,bytes_hash,document_json,document_hash) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id,prepared.fingerprint,name,prepared.format,prepared.mime,bytes,crate::imports::parse::hash(&bytes),raw,crate::imports::parse::hash(raw.as_bytes())]).map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES('payroll_source',?1)",
            [&id],
        )
        .map_err(err)?;
        periods::commit(tx)?;
        Ok(id)
    }
    pub fn pay_sources(&self) -> Result<Vec<Source>> {
        let mut q = self
            .conn
            .prepare("SELECT id FROM payroll_sources ORDER BY created_at DESC,rowid DESC")
            .map_err(err)?;
        let ids = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        ids.iter().map(|id| source(&self.conn, id)).collect()
    }
    pub fn pay_source(&self, id: &str) -> Result<Detail> {
        Ok(Detail {
            source: source(&self.conn, id)?,
            document: document(&self.conn, id)?,
        })
    }
    fn pay_source_bytes(&self, id: &str) -> Result<Vec<u8>> {
        let (bytes, hash): (Vec<u8>, String) = self
            .conn
            .query_row(
                "SELECT bytes,bytes_hash FROM payroll_sources WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        if bytes.is_empty()
            || bytes.len() > crate::imports::MAX_FILE_BYTES
            || crate::imports::parse::hash(&bytes) != hash
        {
            return Err("Original payroll document failed integrity validation.".into());
        }
        Ok(bytes)
    }
    pub fn pay_source_original(&self, id: &str) -> Result<String> {
        Ok(base64::engine::general_purpose::STANDARD.encode(self.pay_source_bytes(id)?))
    }
    pub fn export_pay_source(&self, directory: &Path, id: &str) -> Result<String> {
        use std::io::Write;
        let parsed = Uuid::parse_str(id).map_err(|_| "Invalid payroll source.")?;
        let src = source(&self.conn, id)?;
        let bytes = self.pay_source_bytes(id)?;
        let ext = src
            .name
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if ![
            "docx", "csv", "tsv", "xlsx", "xls", "pdf", "png", "jpg", "jpeg", "webp", "bmp",
        ]
        .contains(&ext.as_str())
        {
            return Err("Unsupported original document type.".into());
        }
        fs::create_dir_all(directory).map_err(err)?;
        let path = directory.join(format!("{parsed}.{ext}"));
        if path.exists() {
            if fs::read(&path).map_err(err)? != bytes {
                return Err("An existing export differs. Move it before exporting again.".into());
            }
        } else {
            let mut f = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(err)?;
            f.write_all(&bytes).map_err(err)?;
            f.sync_all().map_err(err)?;
        }
        Ok(path.to_string_lossy().into())
    }
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let mut q=conn.prepare("SELECT id,fingerprint,name,format,mime,bytes,bytes_hash,created_at FROM payroll_sources").map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let id: String = r.get(0).map_err(err)?;
        let fingerprint: String = r.get(1).map_err(err)?;
        let name: String = r.get(2).map_err(err)?;
        let format: String = r.get(3).map_err(err)?;
        let mime: String = r.get(4).map_err(err)?;
        let bytes: Vec<u8> = r.get(5).map_err(err)?;
        let hash: String = r.get(6).map_err(err)?;
        let created: String = r.get(7).map_err(err)?;
        Uuid::parse_str(&id).map_err(|_| "Invalid saved payroll source.")?;
        chrono::DateTime::parse_from_rfc3339(&created)
            .map_err(|_| "Invalid payroll source date.")?;
        if name.is_empty()
            || name.len() > 250
            || mime.len() > 150
            || !["docx", "csv", "excel", "pdf", "image"].contains(&format.as_str())
            || bytes.is_empty()
            || bytes.len() > crate::imports::MAX_FILE_BYTES
            || crate::imports::parse::hash(&bytes) != hash
            || crate::imports::parse::fingerprint(&bytes, &format)? != fingerprint
        {
            return Err("Payroll evidence is corrupt or unsupported.".into());
        }
        document(conn, &id)?;
    }
    Ok(())
}
