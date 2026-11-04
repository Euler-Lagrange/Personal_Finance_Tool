use super::*;
use crate::imports::{
    parse,
    types::{Candidate, Dataset, Mapping},
};
use chrono::{DateTime, Datelike, Duration};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageInput {
    pub start_date: String,
    pub end_date: String,
    pub date_basis: String,
    pub completeness: String,
    pub profile: String,
    pub observed_at: String,
    pub inclusive: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    #[serde(flatten)]
    pub input: CoverageInput,
    pub accepted: bool,
    pub newest_activity_date: Option<String>,
    #[serde(skip)]
    pub layout_hash: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(skip)]
    pub code_match_allowed: bool,
    pub row_id: String,
    pub action: String,
    pub reason: String,
    pub occurrence_id: Option<String>,
    pub event_id: Option<String>,
    pub event_revision: Option<i64>,
    #[serde(skip)]
    pub providers: Vec<String>,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub items: Vec<Item>,
    pub notices: Vec<String>,
}
#[derive(Clone)]
struct Row {
    id: String,
    candidate: Candidate,
    disposition: String,
    occurrence: Option<String>,
}
fn decode<T: serde::de::DeserializeOwned>(s: String) -> Result<T> {
    serde_json::from_str(&s).map_err(err)
}
fn source_rows(conn: &Connection, id: &str) -> Result<Vec<Row>> {
    let mut stmt=conn.prepare("SELECT id,candidate_json,disposition,occurrence_id FROM import_rows WHERE source_id=?1 ORDER BY ordinal").map_err(err)?;
    let raw = stmt
        .query_map([id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    raw.into_iter()
        .map(|(id, c, d, o)| {
            Ok(Row {
                id,
                candidate: decode(c)?,
                disposition: d,
                occurrence: o,
            })
        })
        .collect()
}
fn date_key(c: &Candidate, basis: &str) -> Option<String> {
    if basis == "posted" {
        c.posted_date.clone()
    } else {
        c.date.clone()
    }
}
fn key(c: &Candidate, basis: &str) -> Option<String> {
    let date = date_key(c, basis)?;
    if c.currency != "USD"
        || c.status != "posted"
        || !matches!(c.direction.as_str(), "in" | "out")
        || c.amount_cents.is_none_or(|a| a <= 0)
        || c.description.trim().is_empty()
    {
        return None;
    }
    serde_json::to_string(&(
        date,
        c.currency.as_str(),
        c.amount_cents?,
        c.direction.as_str(),
        c.description
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
    ))
    .ok()
}
fn reliable(c: &Candidate) -> bool {
    key(c, "transaction").is_some() && c.warnings.is_empty()
}
fn accepted(conn: &Connection, id: &str, c: &CoverageInput) -> Result<bool> {
    if c.completeness != "complete" {
        return Ok(false);
    }
    let rows = source_rows(conn, id)?;
    let mut seen = HashSet::new();
    let mut ids = HashSet::new();
    for r in rows {
        if r.candidate.status == "pending" && r.disposition == "excluded" {
            continue;
        }
        if !reliable(&r.candidate)
            || key(&r.candidate, &c.date_basis).is_none()
            || r.disposition == "pending"
            || r.occurrence.is_none()
        {
            return Ok(false);
        }
        let date = date_key(&r.candidate, &c.date_basis).unwrap();
        if date < c.start_date || date > c.end_date {
            return Ok(false);
        }
        if !seen.insert(r.occurrence.unwrap())
            || r.candidate.stable_id.is_some_and(|id| !ids.insert(id))
        {
            return Ok(false);
        }
    }
    Ok(true)
}
pub(super) fn coverage(conn: &Connection, id: &str) -> Result<Option<Coverage>> {
    let value:Option<(CoverageInput,String)>=conn.query_row("SELECT start_date,end_date,date_basis,completeness,profile,observed_at,inclusive,layout_hash FROM import_coverage WHERE source_id=?1",[id],|r|Ok((CoverageInput{start_date:r.get(0)?,end_date:r.get(1)?,date_basis:r.get(2)?,completeness:r.get(3)?,profile:r.get(4)?,observed_at:r.get(5)?,inclusive:r.get(6)?},r.get(7)?))).optional().map_err(err)?;
    value
        .map(|(input, layout_hash)| {
            let newest_activity_date = source_rows(conn, id)?
                .iter()
                .filter_map(|r| r.candidate.date.clone())
                .max();
            Ok(Coverage {
                accepted: accepted(conn, id, &input)?,
                input,
                layout_hash,
                newest_activity_date,
            })
        })
        .transpose()
}
fn validate_input(input: &CoverageInput, historical: bool) -> Result<()> {
    let start = NaiveDate::parse_from_str(&input.start_date, "%Y-%m-%d")
        .map_err(|_| "Choose a valid download start date.")?;
    let end = NaiveDate::parse_from_str(&input.end_date, "%Y-%m-%d")
        .map_err(|_| "Choose a valid download end date.")?;
    let observed = DateTime::parse_from_rfc3339(&input.observed_at)
        .map_err(|_| "Choose the actual download observation time.")?;
    let now = Utc::now();
    // Stored observations were normalized to UTC without the original civil
    // timezone. Recovery cannot reinterpret them in the receiving PC's zone.
    // UTC+14 supplies the latest possible source date: reject impossible dates,
    // while retaining previously confirmed ranges at the international boundary.
    // New confirmations still use the actual local calendar and strict cutoff.
    let (observed_day, today) = if historical {
        (
            (observed.with_timezone(&Utc) + Duration::hours(14)).date_naive(),
            (now + Duration::hours(14)).date_naive(),
        )
    } else {
        (
            observed.with_timezone(&Local).date_naive(),
            now.with_timezone(&Local).date_naive(),
        )
    };
    if input.start_date.len() != 10
        || input.end_date.len() != 10
        || start.year() < 1900
        || end.year() > 2100
        || start > end
        || end > today
        || observed > now + Duration::minutes(5)
        || observed_day < end
    {
        return Err(
            "Use an inclusive past date range and an observation time at or after its end.".into(),
        );
    }
    if !["transaction", "posted"].contains(&input.date_basis.as_str())
        || !["complete", "partial", "incremental"].contains(&input.completeness.as_str())
        || !input.inclusive
        || input.profile.trim().is_empty()
        || input.profile.len() > 100
    {
        return Err(
            "Confirm the date basis, coverage type, inclusive boundaries and source profile."
                .into(),
        );
    }
    Ok(())
}
pub(super) fn layout_hash(d: &Dataset, mut m: Mapping) -> Result<String> {
    m.year = None;
    m.posted_confirmed = false;
    Ok(parse::hash(
        serde_json::to_string(&(&d.headers, m))
            .map_err(err)?
            .as_bytes(),
    ))
}
impl Store {
    #[cfg(test)]
    pub fn confirm_import_coverage(
        &mut self,
        id: &str,
        revision: i64,
        input: CoverageInput,
    ) -> Result<()> {
        self.confirm_import_coverage_with_pattern(id, revision, input, None)
    }
    pub fn confirm_import_coverage_with_pattern(
        &mut self,
        id: &str,
        revision: i64,
        input: CoverageInput,
        pattern: Option<observations::Pattern>,
    ) -> Result<()> {
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        write_coverage(&tx, id, revision, input, pattern)?;
        periods::commit(tx)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageRequest {
    pub process_saved_defaults: bool,
    pub input: CoverageInput,
    pub pattern: Option<observations::Pattern>,
}
pub(super) fn write_coverage(
    tx: &Connection,
    id: &str,
    revision: i64,
    mut input: CoverageInput,
    pattern: Option<observations::Pattern>,
) -> Result<()> {
    if let Some(p) = &pattern {
        observations::validate_pattern(p)?;
    }
    input.profile = input.profile.trim().into();
    validate_input(&input, false)?;
    input.observed_at = DateTime::parse_from_rfc3339(&input.observed_at)
        .map_err(err)?
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let (d,m,format):(String,String,String)=tx.query_row("SELECT dataset_json,mapping_json,format FROM import_sources WHERE id=?1 AND revision=?2 AND configured=1 AND dismissed=0",params![id,revision],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"Import changed or needs column setup. Refresh before confirming coverage.")?;
    let d: Dataset = decode(d)?;
    let m: Mapping = decode(m)?;
    if (d.image || d.assisted || (format == "pdf" && !super::pdf_tables::has_binding(tx, id)?))
        && input.completeness == "complete"
    {
        return Err(
            "Images, AI-assisted readings and evidence-only PDFs cannot establish complete account coverage.".into(),
        );
    }
    if input.date_basis == "posted" && m.posted_date_column.is_none() {
        return Err("Map the posted-date column before confirming a posted-date range.".into());
    }
    let locked:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM import_coverage WHERE source_id=?1) AND EXISTS(SELECT 1 FROM import_commits WHERE source_id=?1 AND undone=0)",[id],|r|r.get(0)).map_err(err)?;
    if locked {
        return Err("Processed coverage is retained with its decisions. Undo dependent operations before changing it, or import a corrected source.".into());
    }
    let layout = layout_hash(&d, m)?;
    tx.execute("INSERT INTO import_coverage VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1) ON CONFLICT(source_id) DO UPDATE SET start_date=excluded.start_date,end_date=excluded.end_date,date_basis=excluded.date_basis,completeness=excluded.completeness,profile=excluded.profile,layout_hash=excluded.layout_hash,observed_at=excluded.observed_at",params![id,input.start_date,input.end_date,input.date_basis,input.completeness,input.profile,layout,input.observed_at]).map_err(err)?;
    if let Some(pattern) = pattern {
        observations::remember_profile(tx, id, &input, &layout, &pattern)?;
    }
    tx.execute(
        "UPDATE import_sources SET revision=revision+1 WHERE id=?1",
        [id],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO audit(action,payload) VALUES ('import_coverage',?1)",
        [format!(
            "{id}:{}",
            serde_json::to_string(&input).map_err(err)?
        )],
    )
    .map_err(err)?;
    Ok(())
}

fn item(row: &Row, action: &str, reason: &str) -> Item {
    Item {
        code_match_allowed: false,
        row_id: row.id.clone(),
        action: action.into(),
        reason: reason.into(),
        occurrence_id: None,
        event_id: None,
        event_revision: None,
        providers: vec![],
    }
}
fn reuse(
    conn: &Connection,
    row: &Row,
    occurrence: &str,
    provider: &str,
    reason: &str,
) -> Result<Item> {
    let (event,revision):(Option<String>,Option<i64>)=conn.query_row("SELECT e.id,e.revision FROM import_occurrences o LEFT JOIN events e ON e.id=o.event_id WHERE o.id=?1",[occurrence],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
    Ok(Item {
        code_match_allowed: false,
        row_id: row.id.clone(),
        action: if event.is_some() { "link" } else { "exclude" }.into(),
        reason: reason.into(),
        occurrence_id: Some(occurrence.into()),
        event_id: event,
        event_revision: revision,
        providers: vec![provider.into()],
    })
}
pub(super) fn plan(conn: &Connection, id: &str) -> Result<Plan> {
    let (account, configured): (Option<String>, bool) = conn
        .query_row(
            "SELECT account_id,configured FROM import_sources WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    let rows = source_rows(conn, id)?;
    let mut result = Plan::default();
    let Some(account) = account.filter(|_| configured) else {
        return Ok(result);
    };
    let current = coverage(conn, id)?;
    // Load compatible accepted observations once. Latest observation wins for each date.
    let mut previous: Vec<(String, Coverage, Vec<Row>)> = vec![];
    if let Some(c) = &current {
        if c.input.completeness == "complete" {
            let mut stmt=conn.prepare("SELECT c.source_id FROM import_coverage c JOIN import_sources s ON s.id=c.source_id WHERE s.account_id=?1 AND c.source_id!=?2 AND c.completeness='complete' AND c.profile=?3 AND c.layout_hash=?4 AND c.date_basis=?5 AND c.start_date<=?6 AND c.end_date>=?7 ORDER BY c.observed_at DESC,c.rowid DESC").map_err(err)?;
            let ids = stmt
                .query_map(
                    params![
                        account,
                        id,
                        c.input.profile,
                        c.layout_hash,
                        c.input.date_basis,
                        c.input.end_date,
                        c.input.start_date
                    ],
                    |r| r.get::<_, String>(0),
                )
                .map_err(err)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(err)?;
            for source in ids {
                let c = coverage(conn, &source)?.unwrap();
                if c.accepted {
                    let rows = source_rows(conn, &source)?;
                    previous.push((source, c, rows));
                }
            }
        }
    }
    let mut prior_keys: HashMap<String, HashMap<String, Vec<&Row>>> = HashMap::new();
    for (source, c, items) in &previous {
        let index = prior_keys.entry(source.clone()).or_default();
        for row in items {
            if let Some(k) = key(&row.candidate, &c.input.date_basis) {
                index.entry(k).or_default().push(row);
            }
        }
    }
    let basis = current
        .as_ref()
        .map(|c| c.input.date_basis.as_str())
        .unwrap_or("transaction");
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut ordinals: HashMap<String, usize> = HashMap::new();
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut stable_counts: HashMap<String, usize> = HashMap::new();
    for r in &rows {
        if let Some(k) = key(&r.candidate, basis) {
            let n = seen.entry(k.clone()).or_default();
            ordinals.insert(r.id.clone(), *n);
            *n += 1;
            *counts.entry(k).or_default() += 1;
        }
        if let Some(s) = &r.candidate.stable_id {
            *stable_counts.entry(s.clone()).or_default() += 1;
        }
    }
    let mut reduced = HashSet::new();
    let mut visited = HashSet::new();
    if let Some(c) = &current {
        for (provider_id, _, prior_rows) in &previous {
            let mut prior_counts: HashMap<String, usize> = HashMap::new();
            for r in prior_rows {
                if let Some(date) = date_key(&r.candidate, basis) {
                    if date >= c.input.start_date
                        && date <= c.input.end_date
                        && previous
                            .iter()
                            .find(|(_, s, _)| {
                                s.input.start_date <= date && s.input.end_date >= date
                            })
                            .is_some_and(|(selected, _, _)| selected == provider_id)
                    {
                        if let Some(k) = key(&r.candidate, basis) {
                            *prior_counts.entry(k).or_default() += 1;
                        }
                    }
                }
            }
            for (k, n) in prior_counts {
                if visited.insert(k.clone()) && counts.get(&k).copied().unwrap_or(0) < n {
                    reduced.insert(k);
                }
            }
        }
    }
    if !reduced.is_empty() {
        result.notices.push(format!("{} occurrence groups have fewer rows than the latest accepted snapshot. Existing records will not be deleted; verify whether this download changed or is incomplete.",reduced.len()));
    }
    for row in rows.iter().filter(|r| r.disposition == "pending") {
        if !reliable(&row.candidate) {
            result.items.push(item(
                row,
                "review",
                "Source date, amount, currency, status or extraction needs review.",
            ));
            continue;
        }
        if let Some(c) = &current {
            let date = date_key(&row.candidate, basis);
            if date
                .as_ref()
                .is_none_or(|d| d < &c.input.start_date || d > &c.input.end_date)
            {
                result.items.push(item(
                    row,
                    "review",
                    "Row date is missing or outside the confirmed download range.",
                ));
                continue;
            }
        }
        if let Some(stable) = &row.candidate.stable_id {
            if stable_counts[stable] > 1 {
                result.items.push(item(
                    row,
                    "review",
                    "The same stable source ID appears more than once in this file.",
                ));
                continue;
            }
            let prior:Option<(String,String,String)>=conn.query_row("SELECT i.occurrence_id,r.source_id,r.candidate_json FROM import_stable_ids i JOIN import_rows r ON r.occurrence_id=i.occurrence_id WHERE i.account_id=?1 AND i.stable_id=?2 AND json_extract(r.candidate_json,'$.stableId')=?2 AND r.source_id!=?3 ORDER BY r.rowid DESC LIMIT 1",params![account,stable,id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(err)?;
            if let Some((occurrence, provider, c)) = prior {
                let prior: Candidate = decode(c)?;
                if key(&prior, "transaction") == key(&row.candidate, "transaction") {
                    result.items.push(reuse(
                        conn,
                        row,
                        &occurrence,
                        &provider,
                        "Confirmed account-scoped source ID already represented.",
                    )?);
                } else {
                    result.items.push(item(row,"review","Stable ID conflicts with previously accepted source values. Review the correction."));
                }
                continue;
            }
        }
        if row.candidate.stable_id.is_some() {
            let matches = super::imports::matches_for(conn, &account, &row.candidate)?;
            let mut ambiguous = false;
            for m in matches {
                let identified:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM import_occurrences o JOIN import_stable_ids i ON i.occurrence_id=o.id WHERE o.account_id=?1 AND o.event_id=?2)",params![account,m.id],|r|r.get(0)).map_err(err)?;
                if !identified {
                    ambiguous = true;
                }
            }
            let mut candidate = item(
                row,
                if ambiguous { "review" } else { "new" },
                if ambiguous {
                    "A new stable ID may match an existing un-identified manual record. Review the link."
                } else {
                    "Previously unseen verified stable ID; preserve this distinct occurrence."
                },
            );
            candidate.code_match_allowed = ambiguous;
            result.items.push(candidate);
            continue;
        }
        let k = key(&row.candidate, basis);
        let date = date_key(&row.candidate, basis);
        let baseline = date.as_ref().and_then(|date| {
            previous
                .iter()
                .find(|(_, c, _)| c.input.start_date <= *date && c.input.end_date >= *date)
        });
        if let (Some(k), Some((source, c, _prior_rows))) = (k, baseline) {
            let matching = prior_keys
                .get(source)
                .and_then(|index| index.get(&k))
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let ordinal = ordinals[&row.id];
            if ordinal < matching.len() {
                if let Some(occ) = &matching[ordinal].occurrence {
                    let mut reused = reuse(
                        conn,
                        row,
                        occ,
                        source,
                        "Same occurrence count in a compatible accepted snapshot.",
                    )?;
                    if matching[ordinal].disposition == "excluded" {
                        reused.action = "exclude".into();
                        reused.event_id = None;
                        reused.event_revision = None;
                        reused.reason =
                            "Preserving the prior exclusion for this occurrence.".into();
                    }
                    result.items.push(reused);
                    continue;
                }
            }
            let older = current
                .as_ref()
                .is_some_and(|x| x.input.observed_at < c.input.observed_at);
            let end = NaiveDate::parse_from_str(&c.input.end_date, "%Y-%m-%d").map_err(err)?;
            let window = end - Duration::days(if basis == "posted" { 0 } else { 4 });
            let stable_interior = date
                .as_ref()
                .is_some_and(|d| d < &window.format("%Y-%m-%d").to_string());
            let existing = super::imports::matches_for(conn, &account, &row.candidate)?;
            let known = matching
                .iter()
                .filter_map(|r| r.occurrence.as_ref())
                .filter_map(|o| {
                    conn.query_row(
                        "SELECT event_id FROM import_occurrences WHERE id=?1",
                        [o],
                        |r| r.get::<_, Option<String>>(0),
                    )
                    .ok()
                    .flatten()
                })
                .collect::<HashSet<_>>();
            let conflict = existing.iter().any(|m| !known.contains(&m.id))
                || excluded_history(
                    conn,
                    &account,
                    id,
                    &row.candidate,
                    basis,
                    &matching
                        .iter()
                        .filter_map(|r| r.occurrence.clone())
                        .collect(),
                )?;
            let mut new = item(
                row,
                if older || stable_interior || conflict {
                    "review"
                } else {
                    "new"
                },
                if older {
                    "An older observation cannot add occurrences over newer accepted evidence without review."
                } else if stable_interior {
                    "Extra occurrence in a previously covered stable interior date. Review this late discovery."
                } else if conflict {
                    "Other recorded activity may represent this row or a source correction. Review identity."
                } else {
                    "Additional occurrence within the prior settling window; retain its original spending date."
                },
            );
            new.providers.push(source.clone());
            result.items.push(new);
            continue;
        }
        if excluded_history(conn, &account, id, &row.candidate, basis, &HashSet::new())? {
            result.items.push(item(row,"review","Previously excluded or removed matching evidence exists. Review identity before adding another occurrence."));
            continue;
        }
        let matches = super::imports::matches_for(conn, &account, &row.candidate)?;
        let mut candidate = item(
            row,
            if matches.is_empty() { "new" } else { "review" },
            if matches.is_empty() {
                "No prior identity found. Normal transaction classification is still required."
            } else {
                "Possible existing record. Confirm identity; amount and nearby date alone are not proof."
            },
        );
        candidate.code_match_allowed = !matches.is_empty();
        result.items.push(candidate);
    }
    Ok(result)
}

impl Store {
    pub fn reconcile_import(
        &mut self,
        id: &str,
        revision: i64,
        operation: &str,
    ) -> Result<crate::imports::types::Receipt> {
        let prior:Option<(String,bool,String)>=self.conn.query_row("SELECT receipt_json,undone,source_id FROM import_commits WHERE id=?1 AND identity_only=1",[operation],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(err)?;
        if let Some((value, undone, source)) = prior {
            if undone || source != id {
                return Err(
                    "Reconciliation operation was undone or belongs to another source.".into(),
                );
            }
            let mut receipt: crate::imports::types::Receipt = decode(value)?;
            receipt.already_processed = true;
            return Ok(receipt);
        }
        let p = plan(&self.conn, id)?;
        let decisions = p
            .items
            .into_iter()
            .filter(|i| matches!(i.action.as_str(), "link" | "exclude"))
            .map(|i| crate::imports::types::Decision {
                row_id: i.row_id,
                action: format!("identity_{}", i.action),
                input: None,
                match_id: None,
                match_revision: None,
                confirmed: true,
                separate: false,
                rule_signature: None,
            })
            .collect::<Vec<_>>();
        if decisions.is_empty() {
            return Err(
                "No unchanged occurrences are ready to reconcile. Review new or uncertain rows."
                    .into(),
            );
        }
        self.commit_import(id, revision, operation, decisions)
    }
}
pub(super) fn attach(
    conn: &Connection,
    source: &str,
    operation: &str,
    plan: &Plan,
    selected: &HashSet<String>,
    trusted: &HashMap<String, Item>,
) -> Result<()> {
    let account: String = conn
        .query_row(
            "SELECT account_id FROM import_sources WHERE id=?1",
            [source],
            |r| r.get(0),
        )
        .map_err(err)?;
    for row in source_rows(conn, source)?
        .iter()
        .filter(|r| selected.contains(&r.id))
    {
        if row.candidate.status != "posted" {
            continue;
        }
        let event: Option<String> = conn
            .query_row(
                "SELECT event_id FROM import_rows WHERE id=?1",
                [&row.id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let existing_alias = if let Some(id) = &row.candidate.stable_id {
            conn.query_row(
                "SELECT occurrence_id FROM import_stable_ids WHERE account_id=?1 AND stable_id=?2",
                params![account, id],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(err)?
        } else {
            None
        };
        let reuse = trusted.get(&row.id).and_then(|i| i.occurrence_id.clone());
        let prior = if let Some(e) = &event {
            conn.query_row(
                "SELECT id FROM import_occurrences WHERE account_id=?1 AND event_id=?2",
                params![account, e],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(err)?
        } else {
            existing_alias.clone()
        };
        let occurrence = reuse
            .or(prior)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if existing_alias.as_ref().is_some_and(|a| a != &occurrence) {
            return Err("This source ID already identifies another occurrence. Correct the ID mapping or prior match before adding a separate transaction.".into());
        }
        conn.execute(
            "INSERT OR IGNORE INTO import_occurrences VALUES (?1,?2,?3,?4)",
            params![occurrence, account, event, event.is_none()],
        )
        .map_err(err)?;
        conn.execute(
            "UPDATE import_rows SET occurrence_id=?1 WHERE id=?2",
            params![occurrence, row.id],
        )
        .map_err(err)?;
        if let Some(id) = &row.candidate.stable_id {
            conn.execute(
                "INSERT OR IGNORE INTO import_stable_ids VALUES (?1,?2,?3,?4)",
                params![account, id, occurrence, operation],
            )
            .map_err(err)?;
        }
    }
    let mut providers = HashSet::new();
    for i in &plan.items {
        if selected.contains(&i.row_id) {
            providers.extend(i.providers.iter().cloned());
        }
    }
    for provider in providers {
        if provider != source {
            conn.execute("INSERT OR IGNORE INTO import_dependencies SELECT ?1,id FROM import_commits WHERE source_id=?2 AND undone=0 AND id!=?1",params![operation,provider]).map_err(err)?;
        }
    }
    Ok(())
}
pub(super) fn protect_undo(conn: &Connection, operation: &str) -> Result<()> {
    let dependent:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM import_dependencies d JOIN import_commits c ON c.id=d.consumer_commit_id WHERE d.provider_commit_id=?1 AND c.undone=0)",[operation],|r|r.get(0)).map_err(err)?;
    if dependent {
        return Err("A later import depends on these occurrence decisions. Undo the later operation first, or correct individual records.".into());
    }
    Ok(())
}
pub(super) fn undo_identity(conn: &Connection, operation: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM import_stable_ids WHERE created_commit_id=?1",
        [operation],
    )
    .map_err(err)?;
    conn.execute("DELETE FROM import_occurrences WHERE NOT EXISTS(SELECT 1 FROM import_rows r WHERE r.occurrence_id=import_occurrences.id) AND NOT EXISTS(SELECT 1 FROM import_stable_ids i WHERE i.occurrence_id=import_occurrences.id)",[]).map_err(err)?;
    Ok(())
}
pub(super) fn invalidate_coverage(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM import_coverage WHERE source_id=?1", [id])
        .map_err(err)?;
    Ok(())
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    for q in ["SELECT id,account_id,event_id,excluded FROM import_occurrences LIMIT 0","SELECT occurrence_id FROM import_rows LIMIT 0","SELECT account_id,stable_id,occurrence_id,created_commit_id FROM import_stable_ids LIMIT 0","SELECT source_id,start_date,end_date,date_basis,completeness,profile,layout_hash,observed_at,inclusive FROM import_coverage LIMIT 0","SELECT consumer_commit_id,provider_commit_id FROM import_dependencies LIMIT 0"] {conn.prepare(q).map_err(err)?;}
    let bad:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM import_rows r JOIN import_sources s ON s.id=r.source_id LEFT JOIN import_occurrences o ON o.id=r.occurrence_id WHERE (r.disposition='pending' AND r.occurrence_id IS NOT NULL) OR (r.occurrence_id IS NOT NULL AND (o.id IS NULL OR o.account_id!=s.account_id OR (r.disposition IN ('imported','linked') AND o.event_id IS NOT NULL AND o.event_id!=r.event_id)))) OR EXISTS(SELECT 1 FROM import_stable_ids i JOIN import_occurrences o ON o.id=i.occurrence_id JOIN import_commits c ON c.id=i.created_commit_id WHERE i.account_id!=o.account_id OR length(trim(i.stable_id))=0 OR length(i.stable_id)>200 OR c.undone!=0)",[],|r|r.get(0)).map_err(err)?;
    if bad {
        return Err("Import occurrence identities or stable-ID aliases are inconsistent.".into());
    }
    conn.prepare("SELECT identity_only FROM import_commits LIMIT 0")
        .map_err(err)?;
    let invalid: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM import_stable_ids i WHERE NOT EXISTS(SELECT 1 FROM import_rows r WHERE r.commit_id=i.created_commit_id AND r.occurrence_id=i.occurrence_id AND json_extract(r.candidate_json,'$.stableId')=i.stable_id)) OR EXISTS(SELECT 1 FROM import_dependencies d JOIN import_commits consumer ON consumer.id=d.consumer_commit_id JOIN import_commits provider ON provider.id=d.provider_commit_id WHERE provider.rowid>=consumer.rowid OR (consumer.undone=0 AND provider.undone!=0))",[],|r|r.get(0)).map_err(err)?;
    if invalid {
        return Err(
            "Import identity provenance or operation dependencies are inconsistent.".into(),
        );
    }
    let mut stmt = conn
        .prepare("SELECT source_id FROM import_coverage")
        .map_err(err)?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for id in ids {
        let c = coverage(conn, &id)?.unwrap();
        validate_input(&c.input, true)?;
        let (data,mapping,format,configured):(String,String,String,bool)=conn.query_row("SELECT dataset_json,mapping_json,format,configured FROM import_sources WHERE id=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)?;
        let data: Dataset = decode(data)?;
        let mapping: Mapping = decode(mapping)?;
        let normalized = DateTime::parse_from_rfc3339(&c.input.observed_at)
            .map_err(err)?
            .with_timezone(&Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        if !configured
            || (c.input.completeness == "complete"
                && (data.image
                    || data.assisted
                    || (format == "pdf" && !super::pdf_tables::has_binding(conn, &id)?)))
            || (c.input.date_basis == "posted" && mapping.posted_date_column.is_none())
            || layout_hash(&data, mapping)? != c.layout_hash
            || c.input.observed_at != normalized
        {
            return Err(
                "Confirmed import coverage does not match its source layout or observation time."
                    .into(),
            );
        }
    }
    Ok(())
}

fn excluded_history(
    conn: &Connection,
    account: &str,
    source: &str,
    candidate: &Candidate,
    basis: &str,
    represented: &HashSet<String>,
) -> Result<bool> {
    let mut stmt=conn.prepare("SELECT r.candidate_json,r.occurrence_id FROM import_rows r JOIN import_sources s ON s.id=r.source_id JOIN import_occurrences o ON o.id=r.occurrence_id WHERE s.account_id=?1 AND s.id!=?2 AND (r.disposition='excluded' OR o.event_id IS NULL)").map_err(err)?;
    let values = stmt
        .query_map(params![account, source], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let target = key(candidate, basis);
    for (value, occurrence) in values {
        if !represented.contains(&occurrence) && key(&decode::<Candidate>(value)?, basis) == target
        {
            return Ok(true);
        }
    }
    Ok(false)
}
