use super::*;
use crate::imports::parse;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDate {
    pub account_id: String,
    pub date: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileInput {
    pub operation_id: String,
    pub event_id: String,
    pub revision: i64,
    pub match_id: String,
    pub match_revision: i64,
    pub confirmed: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct SavedEvent {
    input: EntryInput,
    pending: Option<classification::Pending>,
    dates: Vec<ActivityDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    explicit_dates: Option<Vec<ActivityDate>>,
}
#[derive(Clone, Serialize, Deserialize)]
struct SavedRow {
    id: String,
    source: String,
    disposition: String,
    event_id: String,
    event_revision: i64,
    occurrence: Option<String>,
    commit_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct SavedOccurrence {
    id: String,
    account: String,
    event_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct SavedAlias {
    account: String,
    stable_id: String,
    occurrence: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    first: SavedEvent,
    second: SavedEvent,
    canonical: String,
    rows: Vec<SavedRow>,
    occurrences: Vec<SavedOccurrence>,
    aliases: Vec<SavedAlias>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub id: String,
    pub canonical_id: String,
    pub revision: i64,
    pub undone: bool,
    pub first: EntryInput,
    pub second: EntryInput,
    pub dates: Vec<ActivityDate>,
}

pub(super) fn dates(conn: &Connection, id: &str) -> Result<Vec<ActivityDate>> {
    let mut stmt=conn.prepare("SELECT a.account_id,COALESCE(d.date,e.date) FROM account_activity a JOIN events e ON e.id=a.event_id LEFT JOIN effective_activity_dates d ON d.event_id=a.event_id AND d.account_id=a.account_id WHERE a.event_id=?1 ORDER BY a.account_id").map_err(err)?;
    let result = stmt
        .query_map([id], |r| {
            Ok(ActivityDate {
                account_id: r.get(0)?,
                date: r.get(1)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err);
    result
}
pub(super) fn preserved_dates(conn: &Connection, input: &EntryInput) -> Result<Vec<ActivityDate>> {
    // A spending-date edit must not rewrite a separately verified posting date.
    let mut stmt = conn
        .prepare("SELECT account_id,date FROM activity_dates WHERE event_id=?1")
        .map_err(err)?;
    let retained = stmt
        .query_map([&input.id], |r| {
            Ok(ActivityDate {
                account_id: r.get(0)?,
                date: r.get(1)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(retained
        .into_iter()
        .filter(|d| {
            input.account_id.as_deref() == Some(&d.account_id)
                || input.destination_account_id.as_deref() == Some(&d.account_id)
        })
        .collect())
}
pub(super) fn write_dates(conn: &Connection, id: &str, dates: &[ActivityDate]) -> Result<()> {
    for d in dates {
        if d.date.len() != 10
            || NaiveDate::parse_from_str(&d.date, "%Y-%m-%d").is_err()
            || d.date > Local::now().format("%Y-%m-%d").to_string()
        {
            return Err("Choose a valid activity date that has already occurred.".into());
        }
        conn.execute("INSERT INTO activity_dates VALUES (?1,?2,?3) ON CONFLICT(event_id,account_id) DO UPDATE SET date=excluded.date",params![id,d.account_id,d.date]).map_err(err)?;
    }
    Ok(())
}
pub(super) fn active(conn: &Connection, id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT id FROM movement_reconciliations WHERE canonical_id=?1 AND undone=0",
        [id],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}
pub(super) fn protect_entry(conn: &Connection, id: &str) -> Result<()> {
    if active(conn, id)?.is_some() {
        return Err("This movement reconciles separate source records. Undo its reconciliation before editing or removing it.".into());
    }
    Ok(())
}
pub(super) fn protect_import_undo(conn: &Connection, commit_id: &str) -> Result<()> {
    let used:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM movement_dependencies d JOIN movement_reconciliations m ON m.id=d.operation_id WHERE d.commit_id=?1 AND m.undone=0)",[commit_id],|r|r.get(0)).map_err(err)?;
    if used {
        return Err("This import supports a reconciled movement. Undo that reconciliation before undoing this import.".into());
    }
    Ok(())
}
fn input(e: &Entry) -> EntryInput {
    EntryInput {
        budget_override: None,
        id: e.id.clone(),
        revision: e.revision,
        kind: e.kind.clone(),
        date: e.date.clone(),
        description: e.description.clone(),
        amount: format!("{}.{:02}", e.amount_cents / 100, e.amount_cents % 100),
        payer: e.payer.clone(),
        category_id: e.category_id.clone(),
        account_id: e.account_id.clone(),
        destination_account_id: e.destination_account_id.clone(),
        split_mode: e.split_mode.clone(),
        split_value: e.split_value.clone(),
        note: e.note.clone(),
        original_event_id: e.original_event_id.clone(),
        lines: e.lines.iter().map(|l| l.input()).collect(),
        paypal: e.paypal.clone(),
    }
}
fn saved(conn: &Connection, e: &Entry) -> Result<SavedEvent> {
    Ok(SavedEvent {
        input: input(e),
        pending: e.pending.clone(),
        dates: e.activity_dates.clone(),
        explicit_dates: Some(preserved_dates(conn, &input(e))?),
    })
}
fn account_kind(conn: &Connection, id: &str) -> Result<String> {
    conn.query_row("SELECT kind FROM accounts WHERE id=?1", [id], |r| r.get(0))
        .map_err(err)
}
// This is a candidate test only. The write requires explicit source confirmation and revisions.
fn compatible(conn: &Connection, first: &Entry, other: &Entry) -> Result<bool> {
    let Some(p) = first.pending.as_ref() else {
        return Ok(false);
    };
    if first.id == other.id
        || first.amount_cents != other.amount_cents
        || other.movement_link.is_some()
    {
        return Ok(false);
    }
    let Some(account) = first.account_id.as_deref() else {
        return Ok(false);
    };
    if let Some(q) = &other.pending {
        let Some(other_account) = other.account_id.as_deref() else {
            return Ok(false);
        };
        if account == other_account || p.direction == q.direction {
            return Ok(false);
        }
        let source = if p.direction == "out" {
            account
        } else {
            other_account
        };
        return Ok(account_kind(conn, source)? != "credit");
    }
    if !matches!(other.kind.as_str(), "transfer" | "card_payment") {
        return Ok(false);
    }
    Ok(
        imports::event_direction(&input(other), account, &account_kind(conn, account)?)
            .is_ok_and(|d| d == p.direction),
    )
}
fn source_date(conn: &Connection, e: &Entry, account: &str) -> Result<String> {
    // An explicit posting date is stronger evidence than the transaction-date fallback.
    let mut stmt=conn.prepare("SELECT json_extract(r.candidate_json,'$.postedDate') FROM import_rows r JOIN import_sources s ON s.id=r.source_id WHERE r.event_id=?1 AND s.account_id=?2 AND json_extract(r.candidate_json,'$.postedDate') IS NOT NULL").map_err(err)?;
    let found = stmt
        .query_map(params![e.id, account], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<HashSet<_>>>()
        .map_err(err)?;
    if found.len() > 1 {
        return Err(
            "Sources disagree about a posting date. Review the source mappings before reconciling."
                .into(),
        );
    }
    Ok(found.into_iter().next().unwrap_or_else(|| {
        e.activity_dates
            .iter()
            .find(|d| d.account_id == account)
            .map(|d| d.date.clone())
            .unwrap_or_else(|| e.date.clone())
    }))
}
fn capture(conn: &Connection, first: &Entry, second: &Entry, canonical: &str) -> Result<Saved> {
    let mut stmt=conn.prepare("SELECT id,source_id,disposition,event_id,event_revision,occurrence_id,commit_id FROM import_rows WHERE event_id IN (?1,?2) ORDER BY id").map_err(err)?;
    let rows = stmt
        .query_map(params![first.id, second.id], |r| {
            Ok(SavedRow {
                id: r.get(0)?,
                source: r.get(1)?,
                disposition: r.get(2)?,
                event_id: r.get(3)?,
                event_revision: r.get(4)?,
                occurrence: r.get(5)?,
                commit_id: r.get(6)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let mut sources: HashMap<&str, &str> = HashMap::new();
    for r in &rows {
        if sources
            .insert(&r.source, &r.event_id)
            .is_some_and(|old| old != r.event_id)
        {
            return Err("Both records occur in the same source. Do not collapse separate source occurrences into one payment.".into());
        }
    }
    let mut stmt = conn
        .prepare("SELECT id,account_id,event_id FROM import_occurrences WHERE event_id IN (?1,?2)")
        .map_err(err)?;
    let occurrences = stmt
        .query_map(params![first.id, second.id], |r| {
            Ok(SavedOccurrence {
                id: r.get(0)?,
                account: r.get(1)?,
                event_id: r.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let mut stmt=conn.prepare("SELECT s.account_id,s.stable_id,s.occurrence_id FROM import_stable_ids s JOIN import_occurrences o ON o.id=s.occurrence_id WHERE o.event_id IN (?1,?2)").map_err(err)?;
    let aliases = stmt
        .query_map(params![first.id, second.id], |r| {
            Ok(SavedAlias {
                account: r.get(0)?,
                stable_id: r.get(1)?,
                occurrence: r.get(2)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(Saved {
        first: saved(conn, first)?,
        second: saved(conn, second)?,
        canonical: canonical.into(),
        rows,
        occurrences,
        aliases,
    })
}
fn redirect(conn: &Connection, consumed: &str, canonical: &str, revision: i64) -> Result<()> {
    let mut stmt = conn
        .prepare("SELECT id,account_id FROM import_occurrences WHERE event_id=?1")
        .map_err(err)?;
    let values = stmt
        .query_map([consumed], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, account) in values {
        let target: Option<String> = conn
            .query_row(
                "SELECT id FROM import_occurrences WHERE account_id=?1 AND event_id=?2",
                params![account, canonical],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(target) = target {
            conn.execute(
                "UPDATE import_rows SET occurrence_id=?1 WHERE occurrence_id=?2",
                params![target, id],
            )
            .map_err(err)?;
            conn.execute(
                "UPDATE import_stable_ids SET occurrence_id=?1 WHERE occurrence_id=?2",
                params![target, id],
            )
            .map_err(err)?;
            conn.execute(
                "UPDATE import_occurrences SET event_id=NULL WHERE id=?1",
                [id],
            )
            .map_err(err)?;
        } else {
            conn.execute(
                "UPDATE import_occurrences SET event_id=?1 WHERE id=?2",
                params![canonical, id],
            )
            .map_err(err)?;
        }
    }
    conn.execute("UPDATE import_rows SET event_id=?1,event_revision=?2,disposition='linked' WHERE event_id=?3",params![canonical,revision,consumed]).map_err(err)?;
    Ok(())
}
impl Store {
    pub fn movement_matches(&self, id: &str) -> Result<Vec<Entry>> {
        let entries = self.entries(None)?;
        let first = entries
            .iter()
            .find(|e| e.id == id)
            .ok_or("Activity no longer exists.")?;
        if first.pending.is_none() {
            return Err("Choose recorded activity awaiting classification.".into());
        }
        let mut matches = Vec::new();
        for e in &entries {
            if compatible(&self.conn, first, e)? {
                let mut candidate = e.clone();
                if let Some(account) = e.account_id.as_deref().filter(|_| e.pending.is_some()) {
                    candidate.activity_dates = vec![ActivityDate {
                        account_id: account.into(),
                        date: source_date(&self.conn, e, account)?,
                    }];
                }
                matches.push(candidate);
            }
        }
        matches.sort_by_key(|e| {
            (NaiveDate::parse_from_str(&e.date, "%Y-%m-%d").unwrap()
                - NaiveDate::parse_from_str(&first.date, "%Y-%m-%d").unwrap())
            .num_days()
            .abs()
        });
        Ok(matches)
    }
    pub fn movement_detail(&self, id: &str) -> Result<Detail> {
        let (canonical,revision,raw,undone):(String,i64,String,bool)=self.conn.query_row("SELECT canonical_id,revision,snapshot_json,undone FROM movement_reconciliations WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|_|"Reconciliation no longer exists.")?;
        let s: Saved = serde_json::from_str(&raw).map_err(err)?;
        Ok(Detail {
            id: id.into(),
            canonical_id: canonical.clone(),
            revision,
            undone,
            first: s.first.input,
            second: s.second.input,
            dates: dates(&self.conn, &canonical)?,
        })
    }
    pub fn reconcile_movement(&mut self, request: ReconcileInput) -> Result<String> {
        Uuid::parse_str(&request.operation_id).map_err(|_| "Invalid reconciliation operation.")?;
        if !request.confirmed {
            return Err("Confirm these are the same real movement using both sources.".into());
        }
        let hash = parse::hash(serde_json::to_string(&request).map_err(err)?.as_bytes());
        let prior: Option<(String, bool, String)> = self
            .conn
            .query_row(
                "SELECT payload_hash,undone,canonical_id FROM movement_reconciliations WHERE id=?1",
                [&request.operation_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(err)?;
        if let Some((prior, undone, id)) = prior {
            if prior != hash || undone {
                return Err("This reconciliation operation was already used or undone. Refresh the records.".into());
            }
            return Ok(id);
        }
        let entries = self.entries(None)?;
        let first = entries
            .iter()
            .find(|e| e.id == request.event_id && e.revision == request.revision)
            .ok_or("The source activity changed. Reopen it before reconciling.")?;
        let second = entries
            .iter()
            .find(|e| e.id == request.match_id && e.revision == request.match_revision)
            .ok_or("The matching record changed. Refresh the possible matches.")?;
        if !compatible(&self.conn, first, second)? {
            return Err("Choose compatible opposite account movements or an existing payment with the same amount and source direction.".into());
        }
        let canonical = if second.pending.is_some() {
            first
        } else {
            second
        };
        let consumed = if canonical.id == first.id {
            second
        } else {
            first
        };
        let saved = capture(&self.conn, first, second, &canonical.id)?;
        let mut proposed = input(canonical);
        let mut final_dates = canonical.activity_dates.clone();
        if second.pending.is_some() {
            let (from, to) = if first.pending.as_ref().unwrap().direction == "out" {
                (first, second)
            } else {
                (second, first)
            };
            let from_account = from.account_id.clone().unwrap();
            let to_account = to.account_id.clone().unwrap();
            proposed.kind = if account_kind(&self.conn, &to_account)? == "credit" {
                "card_payment"
            } else {
                "transfer"
            }
            .into();
            proposed.account_id = Some(from_account.clone());
            proposed.destination_account_id = Some(to_account.clone());
            proposed.category_id = None;
            proposed.split_mode = "none".into();
            proposed.split_value.clear();
            final_dates = vec![
                ActivityDate {
                    account_id: from_account.clone(),
                    date: source_date(&self.conn, from, &from_account)?,
                },
                ActivityDate {
                    account_id: to_account.clone(),
                    date: source_date(&self.conn, to, &to_account)?,
                },
            ];
        } else {
            let account = first.account_id.as_ref().unwrap();
            let date = source_date(&self.conn, first, account)?;
            for d in &mut final_dates {
                if d.account_id == *account {
                    d.date = date.clone();
                }
            }
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        // Recheck under the write transaction. No other writer can change either revision afterward.
        for e in [first, second] {
            let current: i64 = tx
                .query_row("SELECT revision FROM events WHERE id=?1", [&e.id], |r| {
                    r.get(0)
                })
                .map_err(|_| "A movement was removed. Refresh.")?;
            if current != e.revision {
                return Err("A movement changed. Refresh before reconciling.".into());
            }
            protect_entry(&tx, &e.id)?;
        }
        for row in &saved.rows {
            let unchanged:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM import_rows WHERE id=?1 AND source_id=?2 AND disposition=?3 AND event_id=?4 AND event_revision=?5 AND occurrence_id IS ?6 AND commit_id=?7)",params![row.id,row.source,row.disposition,row.event_id,row.event_revision,row.occurrence,row.commit_id],|r|r.get(0)).map_err(err)?;
            if !unchanged {
                return Err("Source evidence changed. Refresh before reconciling.".into());
            }
        }
        Store::write_entry_inner(&tx, proposed)?;
        tx.execute(
            "DELETE FROM pending_activity WHERE event_id=?1",
            [&canonical.id],
        )
        .map_err(err)?;
        let revision = canonical.revision + 1;
        redirect(&tx, &consumed.id, &canonical.id, revision)?;
        tx.execute("DELETE FROM events WHERE id=?1", [&consumed.id])
            .map_err(err)?;
        write_dates(&tx, &canonical.id, &final_dates)?;
        tx.execute(
            "INSERT INTO movement_reconciliations VALUES (?1,?2,?3,?4,?5,?6,0)",
            params![
                request.operation_id,
                canonical.id,
                revision,
                hash,
                serde_json::to_string(&saved).map_err(err)?,
                parse::hash(serde_json::to_string(&saved).map_err(err)?.as_bytes())
            ],
        )
        .map_err(err)?;
        let mut sources = HashSet::new();
        for r in &saved.rows {
            tx.execute(
                "INSERT OR IGNORE INTO movement_dependencies VALUES (?1,?2)",
                params![request.operation_id, r.commit_id],
            )
            .map_err(err)?;
            sources.insert(&r.source);
        }
        for source in sources {
            tx.execute(
                "UPDATE import_sources SET revision=revision+1 WHERE id=?1",
                [source],
            )
            .map_err(err)?;
        }
        tx.execute(
            "INSERT INTO audit(event_id,action,payload) VALUES (?1,'reconcile_movement',?2)",
            params![canonical.id, serde_json::to_string(&request).map_err(err)?],
        )
        .map_err(err)?;
        periods::commit(tx)?;
        Ok(canonical.id.clone())
    }
    pub fn undo_movement(&mut self, id: &str) -> Result<()> {
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let (canonical,revision,raw,undone):(String,i64,String,bool)=tx.query_row("SELECT canonical_id,revision,snapshot_json,undone FROM movement_reconciliations WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|_|"Reconciliation no longer exists.")?;
        if undone {
            return Ok(());
        }
        let checksum: String = tx
            .query_row(
                "SELECT snapshot_hash FROM movement_reconciliations WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if checksum != parse::hash(raw.as_bytes()) {
            return Err(
                "Reconciliation history is damaged. The current records were not changed.".into(),
            );
        }
        let saved: Saved = serde_json::from_str(&raw).map_err(err)?;
        let current: i64 = tx
            .query_row(
                "SELECT revision FROM events WHERE id=?1",
                [&canonical],
                |r| r.get(0),
            )
            .map_err(err)?;
        if current != revision {
            return Err(
                "This movement changed after reconciliation. Review its history before undoing."
                    .into(),
            );
        }
        let ids: HashSet<&str> = saved.rows.iter().map(|r| r.id.as_str()).collect();
        let mut stmt = tx
            .prepare("SELECT id FROM import_rows WHERE event_id=?1")
            .map_err(err)?;
        let linked = stmt
            .query_map([&canonical], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        drop(stmt);
        if linked.iter().any(|r| !ids.contains(r.as_str())) {
            return Err(
                "Later imports reference this reconciled movement. Undo those import links first."
                    .into(),
            );
        }
        let mut restored = HashMap::new();
        for e in [&saved.first, &saved.second] {
            let mut input = e.input.clone();
            let next = if input.id == canonical {
                current + 1
            } else {
                input.revision + 1
            };
            if let Some(p) = &e.pending {
                if input.id == canonical {
                    tx.execute("DELETE FROM events WHERE id=?1", [&input.id])
                        .map_err(err)?;
                }
                input.revision = next - 1;
                classification::record(
                    &tx,
                    &input,
                    p,
                    &account_kind(&tx, input.account_id.as_ref().unwrap())?,
                )?;
            } else {
                input.revision = current;
                Store::write_entry_inner(&tx, input.clone())?;
            }
            write_dates(
                &tx,
                &input.id,
                e.explicit_dates.as_ref().unwrap_or(&e.dates),
            )?;
            restored.insert(input.id, next);
        }
        // Clear canonical pointers first to avoid the per-account uniqueness constraint during restoration.
        for o in &saved.occurrences {
            tx.execute(
                "UPDATE import_occurrences SET event_id=NULL WHERE id=?1",
                [&o.id],
            )
            .map_err(err)?;
        }
        for o in &saved.occurrences {
            tx.execute(
                "UPDATE import_occurrences SET event_id=?1 WHERE id=?2",
                params![o.event_id, o.id],
            )
            .map_err(err)?;
        }
        for a in &saved.aliases {
            tx.execute("UPDATE import_stable_ids SET occurrence_id=?1 WHERE account_id=?2 AND stable_id=?3",params![a.occurrence,a.account,a.stable_id]).map_err(err)?;
        }
        let mut sources = HashSet::new();
        for r in &saved.rows {
            tx.execute("UPDATE import_rows SET disposition=?1,event_id=?2,event_revision=?3,occurrence_id=?4 WHERE id=?5",params![r.disposition,r.event_id,restored[&r.event_id],r.occurrence,r.id]).map_err(err)?;
            sources.insert(&r.source);
        }
        for source in sources {
            tx.execute(
                "UPDATE import_sources SET revision=revision+1 WHERE id=?1",
                [source],
            )
            .map_err(err)?;
        }
        tx.execute(
            "UPDATE movement_reconciliations SET undone=1 WHERE id=?1",
            [id],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(event_id,action,payload) VALUES (?1,'undo_movement',?2)",
            params![canonical, id],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let mut stmt = conn
        .prepare("SELECT date FROM activity_dates")
        .map_err(err)?;
    for date in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
        let date = date.map_err(err)?;
        if date.len() != 10
            || NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_err()
            || date > Local::now().format("%Y-%m-%d").to_string()
        {
            return Err("Backup account activity dates are invalid.".into());
        }
    }
    let mut stmt=conn.prepare("SELECT id,canonical_id,revision,payload_hash,snapshot_json,undone,snapshot_hash FROM movement_reconciliations").map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let id: String = r.get(0).map_err(err)?;
        Uuid::parse_str(&id).map_err(err)?;
        let canonical: String = r.get(1).map_err(err)?;
        let revision: i64 = r.get(2).map_err(err)?;
        let hash: String = r.get(3).map_err(err)?;
        let raw: String = r.get(4).map_err(err)?;
        let undone: bool = r.get(5).map_err(err)?;
        let snapshot_hash: String = r.get(6).map_err(err)?;
        if parse::hash(raw.as_bytes()) != snapshot_hash {
            return Err("Backup reconciliation snapshot checksum is invalid.".into());
        }
        let saved: Saved = serde_json::from_str(&raw).map_err(err)?;
        if hash.len() != 64
            || saved.canonical != canonical
            || saved.first.pending.is_none()
            || saved.first.input.id == saved.second.input.id
            || money::cents(&saved.first.input.amount)? != money::cents(&saved.second.input.amount)?
        {
            return Err("Backup movement history is invalid.".into());
        }
        if !undone {
            let valid:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE id=?1 AND revision=?2 AND kind IN ('transfer','card_payment'))",params![canonical,revision],|r|r.get(0)).map_err(err)?;
            if !valid {
                return Err("Backup reconciled movement is missing or changed.".into());
            }
            for row in &saved.rows {
                let valid:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM import_rows r JOIN movement_dependencies d ON d.commit_id=r.commit_id WHERE r.id=?1 AND r.source_id=?2 AND r.event_id=?3 AND d.operation_id=?4)",params![row.id,row.source,canonical,id],|r|r.get(0)).map_err(err)?;
                if !valid {
                    return Err("Backup reconciled source history is inconsistent.".into());
                }
            }
        }
    }
    Ok(())
}
