use super::*;
use crate::imports::{
    parse,
    types::{Dataset, Mapping},
    MAX_FILE_BYTES,
};
use chrono::{DateTime, Datelike, Duration};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub parent_id: String,
    pub parent_name: String,
    pub suggested_account_id: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    pub kind: String,
    pub days: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProfile {
    pub profile: String,
    pub date_basis: String,
    pub completeness: String,
    pub pattern: Pattern,
}
fn decode<T: serde::de::DeserializeOwned>(s: String) -> Result<T> {
    serde_json::from_str(&s).map_err(err)
}
pub(super) fn observation(conn: &Connection, id: &str) -> Result<Option<Observation>> {
    conn.query_row("SELECT s.id,s.name,s.account_id FROM import_observations o JOIN import_sources s ON s.id=o.parent_id WHERE o.source_id=?1",[id],|r|Ok(Observation{parent_id:r.get(0)?,parent_name:r.get(1)?,suggested_account_id:r.get(2)?})).optional().map_err(err)
}
pub(super) fn profile(conn: &Connection, id: &str) -> Result<Option<DownloadProfile>> {
    let (account,data,mapping,configured):(Option<String>,String,String,bool)=conn.query_row("SELECT account_id,dataset_json,mapping_json,configured FROM import_sources WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)?;
    let Some(account) = account.filter(|_| configured) else {
        return Ok(None);
    };
    let data: Dataset = decode(data)?;
    let mapping: Mapping = decode(mapping)?;
    let layout = profile_key(conn, id, &identity::layout_hash(&data, mapping)?)?;
    conn.query_row("SELECT profile,date_basis,completeness,pattern,days FROM import_download_profiles WHERE account_id=?1 AND layout_hash=?2",params![account,layout],|r|Ok(DownloadProfile{profile:r.get(0)?,date_basis:r.get(1)?,completeness:r.get(2)?,pattern:Pattern{kind:r.get(3)?,days:r.get(4)?}})).optional().map_err(err)
}
pub(super) fn profile_key(conn: &Connection, id: &str, layout: &str) -> Result<String> {
    let (format, image): (String, bool) = conn
        .query_row(
            "SELECT format,json_extract(dataset_json,'$.image') FROM import_sources WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    Ok(parse::hash(
        serde_json::to_string(&(format, image, layout))
            .map_err(err)?
            .as_bytes(),
    ))
}
pub(super) fn validate_pattern(pattern: &Pattern) -> Result<()> {
    if !["manual", "trailing_days", "month_to_date", "previous_month"]
        .contains(&pattern.kind.as_str())
        || (if pattern.kind == "trailing_days" {
            !pattern.days.is_some_and(|d| (1..=366).contains(&d))
        } else {
            pattern.days.is_some()
        })
    {
        return Err("Choose a supported download pattern; a trailing window must be 1 to 366 inclusive days.".into());
    }
    Ok(())
}
fn pattern_range(pattern: &Pattern, observed: &str) -> Result<Option<(String, String)>> {
    let end = DateTime::parse_from_rfc3339(observed)
        .map_err(err)?
        .with_timezone(&Local)
        .date_naive();
    let (start, end) = match pattern.kind.as_str() {
        "manual" => return Ok(None),
        "trailing_days" => (end - Duration::days(pattern.days.unwrap() - 1), end),
        "month_to_date" => (end.with_day(1).unwrap(), end),
        "previous_month" => {
            let end = end.with_day(1).unwrap() - Duration::days(1);
            (end.with_day(1).unwrap(), end)
        }
        _ => return Err("Unknown download pattern.".into()),
    };
    Ok(Some((
        start.format("%Y-%m-%d").to_string(),
        end.format("%Y-%m-%d").to_string(),
    )))
}
pub(super) fn remember_profile(
    conn: &Connection,
    id: &str,
    input: &identity::CoverageInput,
    layout: &str,
    pattern: &Pattern,
) -> Result<()> {
    validate_pattern(pattern)?;
    if let Some((start, end)) = pattern_range(pattern, &input.observed_at)? {
        if start != input.start_date || end != input.end_date {
            return Err("The dates do not match the selected download pattern. Choose manual dates or correct the range.".into());
        }
    }
    let layout = profile_key(conn, id, layout)?;
    conn.execute("INSERT INTO import_download_profiles SELECT account_id,?2,?3,?4,?5,?6,?7 FROM import_sources WHERE id=?1 ON CONFLICT(account_id,layout_hash) DO UPDATE SET profile=excluded.profile,date_basis=excluded.date_basis,completeness=excluded.completeness,pattern=excluded.pattern,days=excluded.days",params![id,layout,input.profile,input.date_basis,input.completeness,pattern.kind,pattern.days]).map_err(err)?;
    Ok(())
}
impl Store {
    pub fn new_import_observation(
        &mut self,
        id: &str,
        revision: i64,
        new_id: &str,
    ) -> Result<String> {
        Uuid::parse_str(new_id).map_err(|_| "Invalid download observation operation.")?;
        let prior: Option<(String, i64)> = self
            .conn
            .query_row(
                "SELECT parent_id,parent_revision FROM import_observations WHERE source_id=?1",
                [new_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if let Some((parent, version)) = prior {
            if parent != id || version != revision {
                return Err(
                    "This observation operation was already used for another request.".into(),
                );
            }
            return Ok(new_id.into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let (dataset, mapping): (String, String) = tx
            .query_row(
                "SELECT dataset_json,mapping_json FROM import_sources WHERE id=?1 AND revision=?2",
                params![id, revision],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "Source changed. Reopen it before creating a new observation.")?;
        let data: Dataset = decode(dataset)?;
        let mut mapping: Mapping = decode(mapping)?;
        // A new observation still needs the account/status/year confirmation appropriate to this download.
        mapping.year = None;
        mapping.posted_confirmed = false;
        tx.execute("INSERT INTO import_sources(id,fingerprint,name,mime,format,dataset_json,mapping_json,error) SELECT ?1,fingerprint,name,mime,format,dataset_json,?3,error FROM import_sources WHERE id=?2",params![new_id,id,serde_json::to_string(&mapping).map_err(err)?]).map_err(err)?;
        tx.execute(
            "INSERT INTO import_observations VALUES (?1,?2,?3)",
            params![new_id, id, revision],
        )
        .map_err(err)?;
        imports::materialize(&tx, new_id, &data, &mapping)?;
        pdf_tables::clone_binding(&tx, id, new_id)?;
        ai_rows::clone_binding(&tx, id, new_id)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('import_observation',?1)",
            [format!("{id}:{revision}->{new_id}")],
        )
        .map_err(err)?;
        periods::commit(tx)?;
        Ok(new_id.into())
    }
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    for sql in ["SELECT fingerprint,mime,format,content FROM import_evidence LIMIT 0","SELECT source_id,parent_id,parent_revision FROM import_observations LIMIT 0","SELECT account_id,layout_hash,profile,date_basis,completeness,pattern,days FROM import_download_profiles LIMIT 0"] {conn.prepare(sql).map_err(err)?;}
    let bad:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM import_sources s LEFT JOIN import_evidence e ON e.fingerprint=s.fingerprint WHERE e.fingerprint IS NULL OR e.mime!=s.mime OR e.format!=s.format) OR EXISTS(SELECT 1 FROM import_observations o JOIN import_sources child ON child.id=o.source_id JOIN import_sources parent ON parent.id=o.parent_id WHERE child.fingerprint!=parent.fingerprint OR parent.rowid>=child.rowid OR o.parent_revision>parent.revision OR o.parent_revision<1)",[],|r|r.get(0)).map_err(err)?;
    if bad {
        return Err("Import observations do not match their preserved evidence or history.".into());
    }
    let mut stmt = conn
        .prepare("SELECT fingerprint,format,content FROM import_evidence")
        .map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    let mut total = 0;
    while let Some(r) = rows.next().map_err(err)? {
        let hash: String = r.get(0).map_err(err)?;
        let format: String = r.get(1).map_err(err)?;
        let bytes: Vec<u8> = r.get(2).map_err(err)?;
        total += bytes.len();
        if bytes.is_empty()
            || bytes.len() > MAX_FILE_BYTES
            || total > 250 * 1024 * 1024
            || parse::fingerprint(&bytes, &format)? != hash
        {
            return Err("Preserved import evidence is invalid or exceeds supported limits.".into());
        }
    }
    let mut stmt = conn
        .prepare("SELECT layout_hash,profile,pattern,days FROM import_download_profiles")
        .map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let hash: String = r.get(0).map_err(err)?;
        let name: String = r.get(1).map_err(err)?;
        if hash.len() != 64
            || !hash.bytes().all(|c| c.is_ascii_hexdigit())
            || name.trim() != name
            || name.is_empty()
            || name.len() > 100
        {
            return Err("Saved download profile is invalid.".into());
        }
        validate_pattern(&Pattern {
            kind: r.get(2).map_err(err)?,
            days: r.get(3).map_err(err)?,
        })?;
    }
    Ok(())
}
