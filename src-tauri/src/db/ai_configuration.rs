use super::*;
use crate::{
    assistance::configuration::Configuration,
    imports::{
        parse,
        types::{Candidate, Dataset, Mapping},
    },
};
use serde::{Deserialize, Serialize};
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn hash<T: Serialize>(v: &T) -> Result<String> {
    Ok(parse::hash(json(v)?.as_bytes()))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub job_id: String,
    pub source_revision: i64,
    pub account: String,
    pub mapping: Mapping,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Save {
    pub input: Input,
    pub token: String,
    pub confirmed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub token: String,
    pub candidates: Vec<Candidate>,
}
fn source(
    c: &Connection,
    job_id: &str,
    revision: i64,
) -> Result<(ai_jobs::Job, Configuration, Dataset)> {
    let j = ai_jobs::job(c, job_id)?;
    if j.status != "completed" {
        return Err("Choose a completed configuration suggestion.".into());
    }
    let config = j
        .proposal
        .as_ref()
        .and_then(|p| p.configuration.clone())
        .ok_or("This request has no supported configuration suggestion.")?;
    config.validate()?;
    imports::editable(c, &j.source_id, revision)?;
    let (fp, format, dismissed, raw): (String, String, bool, String) = c
        .query_row(
            "SELECT fingerprint,format,dismissed,dataset_json FROM import_sources WHERE id=?1",
            [&j.source_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(err)?;
    if dismissed || fp != j.request.fingerprint || revision != j.request.input.source_revision {
        return Err("The source changed since this suggestion. Make a new request or edit its mapping manually.".into());
    }
    let data: Dataset = serde_json::from_str(&raw).map_err(err)?;
    match &config {
        Configuration::Mapping(m) => {
            if !["csv", "excel"].contains(&format.as_str()) || data.image || data.assisted {
                return Err("Column suggestions require a structured CSV or Excel export.".into());
            }
            parse::validate_mapping(m, &data)?;
        }
        _ => {
            if format != "pdf" || data.pdf_pages.is_empty() {
                return Err("Reusable PDF suggestions require locally extracted PDF text.".into());
            }
        }
    }
    Ok((j, config, data))
}
fn preview(c: &Connection, i: &Input) -> Result<(Preview, Dataset, serde_json::Value)> {
    let (j, config, d) = source(c, &i.job_id, i.source_revision)?;
    if !matches!(config, Configuration::Mapping(_)) {
        return Err("Choose a column-mapping proposal.".into());
    }
    parse::validate_mapping(&i.mapping, &d)?;
    let (name, kind, revision, archived): (String, String, i64, bool) = c
        .query_row(
            "SELECT name,kind,revision,archived FROM accounts WHERE id=?1",
            [&i.account],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| "Choose an account for this export.")?;
    if archived {
        return Err("Choose an active account.".into());
    }
    card_statements::protect_source_account(c, &j.source_id, &i.account)?;
    pdf_documents::protect_account(c, &j.source_id, &i.account)?;
    let account = serde_json::json!({"id":i.account,"name":name,"kind":kind,"revision":revision});
    let token = hash(&(i, &d, &j.proposal, &account))?;
    Ok((
        Preview {
            token,
            candidates: d
                .rows
                .iter()
                .map(|row| parse::dataset_candidate(row, &i.mapping, &d))
                .collect(),
        },
        d,
        account,
    ))
}
impl Store {
    pub fn ai_configuration(&self, job_id: &str, revision: i64) -> Result<Configuration> {
        Ok(source(&self.conn, job_id, revision)?.1)
    }
    pub fn ai_mapping_preview(&self, i: Input) -> Result<Preview> {
        Ok(preview(&self.conn, &i)?.0)
    }
    pub fn ai_mapping_apply(&mut self, operation: &str, s: Save) -> Result<()> {
        Uuid::parse_str(operation).map_err(err)?;
        let h = hash(&s)?;
        let old: Option<String> = self
            .conn
            .query_row(
                "SELECT payload_hash FROM ai_mapping_reviews WHERE id=?1",
                [operation],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(old) = old {
            if old != h {
                return Err("This mapping operation was already used for other changes.".into());
            }
            return Ok(());
        }
        if !s.confirmed {
            return Err("Confirm the parsed sample and account before applying columns.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let (p, d, a) = preview(&tx, &s.input)?;
        if p.token != s.token {
            return Err("Columns, account or source changed. Preview again.".into());
        }
        let j = ai_jobs::job(&tx, &s.input.job_id)?;
        imports::configure(
            &tx,
            &j.source_id,
            s.input.source_revision,
            &s.input.account,
            &s.input.mapping,
        )?;
        tx.execute(
            "INSERT INTO ai_mapping_reviews VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                operation,
                s.input.job_id,
                j.source_id,
                h,
                json(&s)?,
                json(&d)?,
                hash(&j.proposal)?,
                json(&a)?
            ],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES('ai_mapping_applied',?1)",
            [operation],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}
pub(super) fn validate(c: &Connection) -> Result<()> {
    let orphan:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM audit WHERE action='ai_mapping_applied' AND payload NOT IN (SELECT id FROM ai_mapping_reviews))",[],|r|r.get(0)).map_err(err)?;
    if orphan {
        return Err("Reviewed mapping history is missing.".into());
    }
    let mut q=c.prepare("SELECT id,job_id,source_id,payload_hash,input_json,dataset_json,proposal_hash,account_json FROM ai_mapping_reviews").map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let id: String = r.get(0).map_err(err)?;
        Uuid::parse_str(&id).map_err(err)?;
        let j = ai_jobs::job(c, &r.get::<_, String>(1).map_err(err)?)?;
        let s: Save = serde_json::from_str(&r.get::<_, String>(4).map_err(err)?).map_err(err)?;
        let d: Dataset = serde_json::from_str(&r.get::<_, String>(5).map_err(err)?).map_err(err)?;
        let a: serde_json::Value =
            serde_json::from_str(&r.get::<_, String>(7).map_err(err)?).map_err(err)?;
        parse::validate_mapping(&s.input.mapping, &d)?;
        let (revision, format): (i64, String) = c
            .query_row(
                "SELECT revision,format FROM import_sources WHERE id=?1",
                [&j.source_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        let audited: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM audit WHERE action='ai_mapping_applied' AND payload=?1",
                [&id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if audited != 1
            || j.status != "completed"
            || j.request.input.task != "mapping"
            || !s.confirmed
            || j.id != s.input.job_id
            || r.get::<_, String>(2).map_err(err)? != j.source_id
            || !matches!(
                j.proposal.as_ref().and_then(|p| p.configuration.as_ref()),
                Some(Configuration::Mapping(_))
            )
            || revision <= s.input.source_revision
            || s.input.source_revision != j.request.input.source_revision
            || d.image
            || d.assisted
            || !["csv", "excel"].contains(&format.as_str())
            || a["id"] != s.input.account
            || hash(&s)? != r.get::<_, String>(3).map_err(err)?
            || hash(&j.proposal)? != r.get::<_, String>(6).map_err(err)?
            || hash(&(&s.input, &d, &j.proposal, &a))? != s.token
        {
            return Err("Reviewed AI column mapping is inconsistent.".into());
        }
    }
    Ok(())
}
