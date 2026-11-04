use super::*;
use crate::imports::{parse, pdf_table as table, types::Dataset};
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub revision: i64,
    pub enabled: bool,
    pub definition: table::Definition,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub source_id: String,
    pub source_revision: i64,
    pub template_id: String,
    pub template_revision: i64,
    pub definition: Option<table::Definition>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub token: String,
    pub extraction: table::Extraction,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Save {
    pub request: Request,
    pub token: String,
    pub confirmed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub template: Template,
    pub recognized: bool,
    pub issue: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub templates: Vec<Match>,
    pub binding: Option<Binding>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub template_id: String,
    pub version: i64,
    pub proof: table::Extraction,
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn hash<T: Serialize>(v: &T) -> Result<String> {
    Ok(parse::hash(json(v)?.as_bytes()))
}
fn dataset(c: &Connection, id: &str) -> Result<Dataset> {
    let (raw, format): (String, String) = c
        .query_row(
            "SELECT dataset_json,format FROM import_sources WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    if format != "pdf" {
        return Err("Choose a stored PDF.".into());
    }
    serde_json::from_str(&raw).map_err(err)
}
fn template(c: &Connection, id: &str, version: Option<i64>) -> Result<Template> {
    c.query_row("SELECT t.revision,t.enabled,v.definition_json FROM pdf_table_templates t JOIN pdf_table_versions v ON v.template_id=t.id AND v.version=COALESCE(?2,t.revision) WHERE t.id=?1",params![id,version],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,bool>(1)?,r.get::<_,String>(2)?))).map_err(err).and_then(|(revision,enabled,raw)|Ok(Template{id:id.into(),revision:version.unwrap_or(revision),enabled,definition:serde_json::from_str(&raw).map_err(err)?}))
}
fn list(c: &Connection) -> Result<Vec<Template>> {
    let mut q = c
        .prepare("SELECT id FROM pdf_table_templates ORDER BY id")
        .map_err(err)?;
    let ids = q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    ids.iter().map(|id| template(c, id, None)).collect()
}
fn preview(c: &Connection, r: &Request) -> Result<Preview> {
    Uuid::parse_str(&r.template_id).map_err(err)?;
    imports::editable(c, &r.source_id, r.source_revision)?;
    let dismissed: bool = c
        .query_row(
            "SELECT dismissed FROM import_sources WHERE id=?1",
            [&r.source_id],
            |row| row.get(0),
        )
        .map_err(err)?;
    if dismissed {
        return Err("Return this source to review first.".into());
    }
    let current: Option<i64> = c
        .query_row(
            "SELECT revision FROM pdf_table_templates WHERE id=?1",
            [&r.template_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    if current.unwrap_or(0) != r.template_revision {
        return Err("Table template version changed. Reload and preview again.".into());
    }
    let d = if let Some(d) = &r.definition {
        d.clone()
    } else {
        let t = template(c, &r.template_id, None)?;
        if !t.enabled {
            return Err("This table template is paused.".into());
        }
        t.definition
    };
    let data = dataset(c, &r.source_id)?;
    if data.assisted && r.definition.is_none() {
        return Err("This source retains reviewed AI rows. Use a separate source before staging a local table extraction.".into());
    }
    let extraction = table::extract(&d, &data.pdf_pages)?;
    Ok(Preview {
        token: hash(&(r, &data, &extraction))?,
        extraction,
    })
}
fn retry(c: &Connection, id: &str, h: &str) -> Result<bool> {
    Uuid::parse_str(id).map_err(err)?;
    let old: Option<String> = c
        .query_row(
            "SELECT payload_hash FROM pdf_table_receipts WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    match old {
        Some(v) if v == h => Ok(true),
        Some(_) => Err("This operation was already used for different PDF table changes.".into()),
        None => Ok(false),
    }
}
fn receipt(c: &Connection, id: &str, h: &str, action: &str) -> Result<()> {
    c.execute(
        "INSERT INTO pdf_table_receipts VALUES(?1,?2)",
        params![id, h],
    )
    .map_err(err)?;
    c.execute(
        "INSERT INTO audit(action,payload) VALUES(?1,?2)",
        params![action, id],
    )
    .map_err(err)?;
    Ok(())
}
fn stage(
    c: &Connection,
    source: &str,
    t: &Template,
    e: &table::Extraction,
    operation: &str,
) -> Result<()> {
    let mut d = dataset(c, source)?;
    d.headers = e.headers.clone();
    d.rows = e.rows.clone();
    d.notes=vec![format!("PDF table: {} (version {}). Row evidence is retained; confirm account, columns and actual coverage before processing.",t.definition.name,t.revision)];
    let m = parse::default_mapping(&d);
    c.execute("UPDATE import_sources SET dataset_json=?1,mapping_json=?2,error='',configured=0,revision=revision+1 WHERE id=?3",params![json(&d)?,json(&m)?,source]).map_err(err)?;
    identity::invalidate_coverage(c, source)?;
    c.execute(
        "DELETE FROM import_classification WHERE source_id=?1",
        [source],
    )
    .map_err(err)?;
    imports::materialize(c, source, &d, &m)?;
    c.execute("INSERT INTO pdf_table_bindings VALUES(?1,?2,?3,?4,?5) ON CONFLICT(source_id) DO UPDATE SET template_id=excluded.template_id,version=excluded.version,proof_json=excluded.proof_json,operation_id=excluded.operation_id",params![source,t.id,t.revision,json(e)?,operation]).map_err(err)?;
    Ok(())
}
pub(super) fn auto_stage(c: &Connection, source: &str) -> Result<()> {
    let format: String = c
        .query_row(
            "SELECT format FROM import_sources WHERE id=?1",
            [source],
            |r| r.get(0),
        )
        .map_err(err)?;
    if format != "pdf" {
        return Ok(());
    }
    let mut d = dataset(c, source)?;
    let recognized: Vec<_> = list(c)?
        .into_iter()
        .filter(|t| t.enabled && table::recognizes(&t.definition, &d.pdf_pages))
        .collect();
    if recognized.is_empty() {
        return Ok(());
    }
    let issue = if recognized.len() != 1 {
        Some("Multiple approved table templates recognize this document. Select and review one manually.".into())
    } else {
        let t = &recognized[0];
        if !t.definition.automatic {
            return Ok(());
        }
        match table::extract(&t.definition, &d.pdf_pages) {
            Ok(e) => {
                let operation = Uuid::new_v4().to_string();
                receipt(
                    c,
                    &operation,
                    &hash(&(source, &t, &e))?,
                    "pdf_table_auto_stage",
                )?;
                return stage(c, source, t, &e, &operation);
            }
            Err(e) => Some(format!("PDF table needs review: {e}")),
        }
    };
    if let Some(issue) = issue {
        d.notes.push(issue);
        c.execute(
            "UPDATE import_sources SET dataset_json=?1 WHERE id=?2",
            params![json(&d)?, source],
        )
        .map_err(err)?;
    }
    Ok(())
}
pub(super) fn has_binding(c: &Connection, id: &str) -> Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM pdf_table_bindings WHERE source_id=?1)",
        [id],
        |r| r.get(0),
    )
    .map_err(err)
}
pub(super) fn protect_reextract(c: &Connection, id: &str) -> Result<()> {
    let used:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM pdf_table_bindings WHERE source_id=?1 UNION ALL SELECT 1 FROM pdf_table_versions WHERE sample_source_id=?1)",[id],|r|r.get(0)).map_err(err)?;
    if used {
        return Err("This PDF supports an approved table or staged rows. Its text evidence is preserved; import a corrected file for new extraction.".into());
    }
    Ok(())
}
pub(super) fn clone_binding(c: &Connection, parent: &str, child: &str) -> Result<()> {
    c.execute("INSERT INTO pdf_table_bindings SELECT ?1,template_id,version,proof_json,operation_id FROM pdf_table_bindings WHERE source_id=?2",params![child,parent]).map_err(err)?;
    Ok(())
}
impl Store {
    pub fn pdf_table_view(&self, id: &str) -> Result<View> {
        let d = dataset(&self.conn, id)?;
        let templates = list(&self.conn)?
            .into_iter()
            .map(|t| {
                let recognized = table::recognizes(&t.definition, &d.pdf_pages);
                let issue = if recognized {
                    table::extract(&t.definition, &d.pdf_pages).err()
                } else {
                    None
                };
                Match {
                    template: t,
                    recognized,
                    issue,
                }
            })
            .collect();
        let b: Option<(String, i64, String)> = self
            .conn
            .query_row(
                "SELECT template_id,version,proof_json FROM pdf_table_bindings WHERE source_id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(err)?;
        Ok(View {
            templates,
            binding: b
                .map(|(template_id, version, raw)| {
                    Ok::<_, String>(Binding {
                        template_id,
                        version,
                        proof: serde_json::from_str(&raw).map_err(err)?,
                    })
                })
                .transpose()?,
        })
    }
    pub fn preview_pdf_table(&self, input: Request) -> Result<Preview> {
        preview(&self.conn, &input)
    }
    pub fn save_pdf_table(&mut self, operation: &str, input: Save) -> Result<()> {
        let h = hash(&input)?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        if !input.confirmed {
            return Err("Confirm the source rows and page evidence first.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let p = preview(&tx, &input.request)?;
        if p.token != input.token {
            return Err("PDF table preview changed. Preview again.".into());
        }
        let r = &input.request;
        receipt(
            &tx,
            operation,
            &h,
            if r.definition.is_some() {
                "pdf_table_template_approved"
            } else {
                "pdf_table_staged"
            },
        )?;
        if let Some(d) = &r.definition {
            tx.execute("INSERT INTO pdf_table_templates VALUES(?1,?2,1) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,enabled=1",params![r.template_id,r.template_revision+1]).map_err(err)?;
            tx.execute(
                "INSERT INTO pdf_table_versions VALUES(?1,?2,?3,?4,?5)",
                params![
                    r.template_id,
                    r.template_revision + 1,
                    r.source_id,
                    json(d)?,
                    json(&p.extraction)?
                ],
            )
            .map_err(err)?;
        } else {
            stage(
                &tx,
                &r.source_id,
                &template(&tx, &r.template_id, None)?,
                &p.extraction,
                operation,
            )?;
        }
        periods::commit(tx)
    }
    pub fn set_pdf_table_enabled(
        &mut self,
        operation: &str,
        id: &str,
        revision: i64,
        enabled: bool,
    ) -> Result<()> {
        let h = hash(&(id, revision, enabled))?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if template(&tx, id, None)?.revision != revision {
            return Err("Table template changed. Reload before changing its status.".into());
        }
        receipt(&tx, operation, &h, "pdf_table_template_status")?;
        tx.execute(
            "UPDATE pdf_table_templates SET enabled=?1 WHERE id=?2",
            params![enabled, id],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}
pub(super) fn validate(c: &Connection) -> Result<()> {
    let mut q = c
        .prepare("SELECT template_id,version,sample_source_id,proof_json FROM pdf_table_versions")
        .map_err(err)?;
    let versions = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, v, s, raw) in versions {
        Uuid::parse_str(&id).map_err(err)?;
        let t = template(c, &id, Some(v))?;
        let proof: table::Extraction = serde_json::from_str(&raw).map_err(err)?;
        if table::extract(&t.definition, &dataset(c, &s)?.pdf_pages)? != proof {
            return Err("Approved PDF table sample evidence changed.".into());
        }
    }
    for t in list(c)? {
        let (count,max):(i64,i64)=c.query_row("SELECT COUNT(*),COALESCE(MAX(version),0) FROM pdf_table_versions WHERE template_id=?1",[&t.id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
        if count != t.revision || max != t.revision {
            return Err("PDF table version history is incomplete.".into());
        }
    }
    let mut q=c.prepare("SELECT s.id,b.template_id,b.version,b.proof_json,b.operation_id FROM import_sources s LEFT JOIN pdf_table_bindings b ON b.source_id=s.id WHERE s.format='pdf'").map_err(err)?;
    let bindings = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (source, id, version, raw, op) in bindings {
        let d = dataset(c, &source)?;
        if let Some(id) = id {
            let t = template(c, &id, version)?;
            let proof: table::Extraction =
                serde_json::from_str(raw.as_deref().ok_or("Missing PDF table evidence.")?)
                    .map_err(err)?;
            let saved: bool = c
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM pdf_table_receipts WHERE id=?1)",
                    [op],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if !saved
                || table::extract(&t.definition, &d.pdf_pages)? != proof
                || d.headers != proof.headers
                || d.rows != proof.rows
            {
                return Err("PDF table rows do not match their original evidence.".into());
            }
            let mapping: String = c
                .query_row(
                    "SELECT mapping_json FROM import_sources WHERE id=?1",
                    [&source],
                    |r| r.get(0),
                )
                .map_err(err)?;
            let mapping: crate::imports::types::Mapping =
                serde_json::from_str(&mapping).map_err(err)?;
            let mut rows = c.prepare("SELECT ordinal,raw_json,candidate_json FROM import_rows WHERE source_id=?1 ORDER BY ordinal").map_err(err)?;
            let mut cursor = rows.query([&source]).map_err(err)?;
            let mut index = 0usize;
            while let Some(row) = cursor.next().map_err(err)? {
                let ordinal: i64 = row.get(0).map_err(err)?;
                let raw: String = row.get(1).map_err(err)?;
                let candidate: String = row.get(2).map_err(err)?;
                let expected = d.rows.get(index).ok_or("Unexpected PDF import row.")?;
                if ordinal != index as i64
                    || serde_json::from_str::<Vec<String>>(&raw).map_err(err)? != *expected
                    || serde_json::from_str::<serde_json::Value>(&candidate).map_err(err)?
                        != serde_json::to_value(parse::candidate(expected, &mapping, false))
                            .map_err(err)?
                {
                    return Err(
                        "PDF import row differs from its approved source interpretation.".into(),
                    );
                }
                index += 1;
            }
            if index != d.rows.len() {
                return Err("PDF import rows are incomplete.".into());
            }
        } else if !d.assisted && (!d.rows.is_empty() || !d.headers.is_empty()) {
            return Err("PDF transaction rows have no approved table evidence.".into());
        }
    }
    let mut q = c
        .prepare("SELECT id,payload_hash FROM pdf_table_receipts")
        .map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?).map_err(err)?;
        let h: String = r.get(1).map_err(err)?;
        if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid PDF table operation history.".into());
        }
    }
    Ok(())
}
