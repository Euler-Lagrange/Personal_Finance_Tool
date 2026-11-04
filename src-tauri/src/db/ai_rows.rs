use super::*;
use crate::{
    assistance::proposal::{self, Proposal, Row},
    imports::{
        parse,
        types::{Candidate, Dataset, Mapping},
    },
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub job_id: String,
    pub source_revision: i64,
    pub rows: Vec<Row>,
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
    pub previous_rows: usize,
    pub candidates: Vec<Candidate>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub review_id: String,
    pub job_id: String,
    pub rows: Vec<Row>,
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn hash<T: Serialize>(v: &T) -> Result<String> {
    Ok(parse::hash(json(v)?.as_bytes()))
}
fn check_rows(rows: &[Row], pages: Option<u32>) -> Result<()> {
    if rows.is_empty() {
        return Err("Keep at least one reviewed transaction row.".into());
    }
    proposal::validate(
        &Proposal {
            configuration: None,
            fields: vec![],
            rows: rows.to_vec(),
            warnings: vec![],
        },
        "transactions",
        pages,
    )
}
fn dataset(before: &Dataset, rows: &[Row]) -> Dataset {
    let mut d = before.clone();
    d.assisted = true;
    d.headers = [
        "Date",
        "Description",
        "Debit",
        "Credit",
        "Status",
        "Currency",
        "Source quote",
        "Page",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    d.rows = rows
        .iter()
        .map(|r| {
            vec![
                r.date.clone().unwrap_or_default(),
                r.description.clone(),
                if r.direction == "out" {
                    r.amount.clone().unwrap_or_default()
                } else {
                    String::new()
                },
                if r.direction == "in" {
                    r.amount.clone().unwrap_or_default()
                } else {
                    String::new()
                },
                r.status.clone(),
                r.currency.clone().unwrap_or_default(),
                r.evidence.quote.clone(),
                r.evidence.page.map(|n| n.to_string()).unwrap_or_default(),
            ]
        })
        .collect();
    d.notes=vec!["AI-assisted rows are partial evidence. Confirm account, dates, amounts, direction, posted status and USD currency against the original; each transaction requires individual review.".into()];
    d
}
fn mapping(d: &Dataset) -> Mapping {
    let mut m = parse::default_mapping(d);
    m.debit_column = Some(2);
    m.credit_column = Some(3);
    m.amount_mode = "separate".into();
    m
}
fn preview(c: &Connection, i: &Input) -> Result<(Preview, Dataset)> {
    let j = ai_jobs::job(c, &i.job_id)?;
    if j.status != "completed" || j.request.input.task != "transactions" || j.proposal.is_none() {
        return Err("Choose a completed transaction proposal.".into());
    }
    check_rows(&i.rows, j.request.page_count)?;
    let id = &j.source_id;
    imports::editable(c, id, i.source_revision)?;
    let (fingerprint, format, dismissed, raw): (String, String, bool, String) = c
        .query_row(
            "SELECT fingerprint,format,dismissed,dataset_json FROM import_sources WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(err)?;
    if fingerprint != j.request.fingerprint || dismissed {
        return Err("Source is unavailable or changed. Reopen it before reviewing.".into());
    }
    if !["pdf", "image"].contains(&format.as_str()) {
        return Err("Structured exports use their column-mapping workflow. AI row staging supports PDF and image evidence.".into());
    }
    if pdf_tables::has_binding(c, id)? {
        return Err("This source already has an approved local table extraction. Review those rows or create a separate source for AI assistance.".into());
    }
    let before: Dataset = serde_json::from_str(&raw).map_err(err)?;
    let d = dataset(&before, &i.rows);
    let m = mapping(&d);
    parse::validate_mapping(&m, &d)?;
    let candidates = d
        .rows
        .iter()
        .map(|r| parse::dataset_candidate(r, &m, &d))
        .collect();
    let token = hash(&(i, &before, &j.proposal, &fingerprint))?;
    Ok((
        Preview {
            token,
            previous_rows: before.rows.len(),
            candidates,
        },
        before,
    ))
}
impl Store {
    pub fn ai_rows_preview(&self, i: Input) -> Result<Preview> {
        Ok(preview(&self.conn, &i)?.0)
    }
    pub fn ai_rows_stage(&mut self, operation: &str, s: Save) -> Result<()> {
        Uuid::parse_str(operation).map_err(|_| "Invalid row review identifier.")?;
        let h = hash(&s)?;
        let old: Option<String> = self
            .conn
            .query_row(
                "SELECT payload_hash FROM ai_row_reviews WHERE id=?1",
                [operation],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(old) = old {
            if old != h {
                return Err("This row review ID was already used for other changes.".into());
            }
            return Ok(());
        }
        if !s.confirmed {
            return Err("Confirm all reviewed rows against their source before staging.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let (p, before) = preview(&tx, &s.input)?;
        if p.token != s.token {
            return Err("Source or proposed rows changed. Preview and confirm again.".into());
        }
        let j = ai_jobs::job(&tx, &s.input.job_id)?;
        let id = &j.source_id;
        let d = dataset(&before, &s.input.rows);
        let m = mapping(&d);
        tx.execute(
            "INSERT INTO ai_row_reviews VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                operation,
                s.input.job_id,
                h,
                json(&s)?,
                json(&before)?,
                hash(&j.proposal)?,
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(err)?;
        tx.execute("INSERT INTO ai_row_bindings VALUES(?1,?2) ON CONFLICT(source_id) DO UPDATE SET review_id=excluded.review_id",params![id,operation]).map_err(err)?;
        tx.execute("UPDATE import_sources SET dataset_json=?1,mapping_json=?2,error='',configured=0,revision=revision+1 WHERE id=?3",params![json(&d)?,json(&m)?,id]).map_err(err)?;
        identity::invalidate_coverage(&tx, id)?;
        tx.execute("DELETE FROM import_classification WHERE source_id=?1", [id])
            .map_err(err)?;
        imports::materialize(&tx, id, &d, &m)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES('ai_rows_staged',?1)",
            [operation],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
    pub fn ai_rows_binding(&self, source: &str) -> Result<Option<Binding>> {
        let value:Option<(String,String,String)>=self.conn.query_row("SELECT r.id,r.job_id,r.input_json FROM ai_row_bindings b JOIN ai_row_reviews r ON r.id=b.review_id WHERE b.source_id=?1",[source],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(err)?;
        value
            .map(|(review_id, job_id, s)| {
                let s: Save = serde_json::from_str(&s).map_err(err)?;
                Ok(Binding {
                    review_id,
                    job_id,
                    rows: s.input.rows,
                })
            })
            .transpose()
    }
}
pub(super) fn protect_reextract(c: &Connection, id: &str) -> Result<()> {
    let used: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_row_bindings WHERE source_id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if used {
        return Err("This source has reviewed AI rows. Preserve its evidence; review a fresh AI proposal before replacing unprocessed rows.".into());
    }
    Ok(())
}
pub(super) fn clone_binding(c: &Connection, parent: &str, child: &str) -> Result<()> {
    c.execute(
        "INSERT INTO ai_row_bindings SELECT ?1,review_id FROM ai_row_bindings WHERE source_id=?2",
        params![child, parent],
    )
    .map_err(err)?;
    Ok(())
}
pub(super) fn validate(c: &Connection) -> Result<()> {
    let mut q=c.prepare("SELECT id,job_id,payload_hash,input_json,before_json,proposal_hash FROM ai_row_reviews").map_err(err)?;
    let reviews = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, job_id, h, raw, before, proposal_hash) in reviews {
        Uuid::parse_str(&id).map_err(err)?;
        let s: Save = serde_json::from_str(&raw).map_err(err)?;
        let before: Dataset = serde_json::from_str(&before).map_err(err)?;
        let j = ai_jobs::job(c, &job_id)?;
        check_rows(&s.input.rows, j.request.page_count)?;
        if s.input.job_id != job_id
            || !s.confirmed
            || s.input.source_revision < j.request.input.source_revision
            || j.status != "completed"
            || j.request.input.task != "transactions"
            || h != hash(&s)?
            || proposal_hash != hash(&j.proposal)?
            || s.token != hash(&(&s.input, &before, &j.proposal, &j.request.fingerprint))?
        {
            return Err("AI row review provenance is invalid.".into());
        }
    }
    let mut q=c.prepare("SELECT s.id,s.fingerprint,s.dataset_json,s.mapping_json,r.input_json,r.before_json,r.job_id FROM import_sources s LEFT JOIN ai_row_bindings b ON b.source_id=s.id LEFT JOIN ai_row_reviews r ON r.id=b.review_id").map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let id: String = r.get(0).map_err(err)?;
        let fingerprint: String = r.get(1).map_err(err)?;
        let d: Dataset = serde_json::from_str(&r.get::<_, String>(2).map_err(err)?).map_err(err)?;
        let saved: Option<String> = r.get(4).map_err(err)?;
        if d.assisted != saved.is_some() {
            return Err("AI row binding does not match the source's review policy.".into());
        }
        let Some(saved) = saved else {
            continue;
        };
        let s: Save = serde_json::from_str(&saved).map_err(err)?;
        let before: Dataset =
            serde_json::from_str(&r.get::<_, String>(5).map_err(err)?).map_err(err)?;
        let j = ai_jobs::job(c, &r.get::<_, String>(6).map_err(err)?)?;
        let expected = dataset(&before, &s.input.rows);
        if fingerprint != j.request.fingerprint
            || json(&d)? != json(&expected)?
            || pdf_tables::has_binding(c, &id)?
        {
            return Err("Staged AI rows no longer match reviewed evidence.".into());
        }
        let m: Mapping = serde_json::from_str(&r.get::<_, String>(3).map_err(err)?).map_err(err)?;
        parse::validate_mapping(&m, &d)?;
        let mut rq=c.prepare("SELECT ordinal,raw_json,candidate_json FROM import_rows WHERE source_id=?1 ORDER BY ordinal").map_err(err)?;
        let rr = rq
            .query_map([&id], |r| {
                Ok((
                    r.get::<_, usize>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        if rr.len() != d.rows.len() {
            return Err("AI row count does not match the reviewed proposal.".into());
        }
        for ((ordinal, raw, candidate), (index, expected)) in
            rr.into_iter().zip(d.rows.iter().enumerate())
        {
            if ordinal != index
                || serde_json::from_str::<Vec<String>>(&raw).map_err(err)? != *expected
                || serde_json::from_str::<serde_json::Value>(&candidate).map_err(err)?
                    != serde_json::to_value(parse::dataset_candidate(expected, &m, &d))
                        .map_err(err)?
            {
                return Err(
                    "AI source row or candidate differs from its reviewed evidence.".into(),
                );
            }
        }
    }
    Ok(())
}
