use super::*;
use crate::imports::parse;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub row_id: String,
    pub event_id: String,
    pub revision: i64,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    // None means leave each record's existing choice intact.
    pub category_id: Option<String>,
    pub split_mode: Option<String>,
    pub split_value: String,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub id: String,
    pub source_id: String,
    pub source_revision: i64,
    pub rows: Vec<Selection>,
    pub changes: Changes,
    pub confirmed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub row_id: String,
    pub merchant: String,
    pub entry: Entry,
    pub reason: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub merchant: String,
    pub date: String,
    pub category_id: String,
    pub split_mode: String,
    pub split_value: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub items: Vec<Item>,
    pub previous: Vec<Choice>,
    pub undo_id: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, PartialEq)]
struct Link {
    row: String,
    source: String,
    commit: String,
    disposition: String,
    revision: i64,
}
#[derive(Serialize, Deserialize)]
struct Saved {
    before: EntryInput,
    pending: Option<classification::Pending>,
    after: EntryInput,
    after_pending: Option<classification::Pending>,
    links: Vec<Link>,
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
fn links(conn: &Connection, event: &str) -> Result<Vec<Link>> {
    let mut stmt = conn.prepare("SELECT id,source_id,commit_id,disposition,event_revision FROM import_rows WHERE event_id=?1 ORDER BY id").map_err(err)?;
    let rows = stmt
        .query_map([event], |r| {
            Ok(Link {
                row: r.get(0)?,
                source: r.get(1)?,
                commit: r.get(2)?,
                disposition: r.get(3)?,
                revision: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}
fn reason(conn: &Connection, e: &Entry) -> Result<String> {
    if let Err(reason) = goals::protect_delete(conn, &e.id) {
        return Ok(reason);
    }
    if e.kind != "expense" && !e.pending.as_ref().is_some_and(|p| p.verified_expense) {
        return Ok("Classify the transaction type individually first.".into());
    }
    if e.lines.len() > 1 || e.lines.iter().any(|l| l.split_mode != "inherit") {
        return Ok("Itemized or overridden charge lines need individual editing.".into());
    }
    let referenced:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE original_event_id=?1) OR EXISTS(SELECT 1 FROM bill_payments WHERE event_id=?1)",[&e.id],|r|r.get(0)).map_err(err)?;
    if referenced {
        return Ok("Linked bills or refunds protect this purchase's allocations.".into());
    }
    if e.movement_link.is_some() {
        return Ok("Undo movement reconciliation before editing.".into());
    }
    Ok(String::new())
}
fn check_changes(conn: &Connection, changes: &Changes) -> Result<()> {
    if changes.category_id.is_none() && changes.split_mode.is_none() {
        return Err("Choose a category or sharing change; other fields stay unchanged.".into());
    }
    if let Some(c) = &changes.category_id {
        let active: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1 AND archived=0)",
                [c],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !active {
            return Err("Choose an active category.".into());
        }
    }
    if let Some(mode) = &changes.split_mode {
        if !["personal", "shared", "equal", "chelsea", "percent"].contains(&mode.as_str()) {
            return Err("Choose a supported sharing preset.".into());
        }
        money::allocation(10000, mode, &changes.split_value)?;
    } else if !changes.split_value.is_empty() {
        return Err("A percentage requires a sharing change.".into());
    }
    Ok(())
}
fn changed(e: &Entry, changes: &Changes) -> (EntryInput, Option<classification::Pending>) {
    let mut next = input(e);
    let mut pending = e.pending.clone();
    if let Some(p) = &mut pending {
        if let Some(category) = &changes.category_id {
            p.category_id = Some(category.clone());
        }
        if let Some(mode) = &changes.split_mode {
            next.kind = "expense".into();
            next.category_id = p.category_id.clone().or(Some("uncategorized".into()));
            next.split_mode = mode.clone();
            next.split_value = changes.split_value.clone();
            pending = None;
        }
    } else {
        if let Some(category) = &changes.category_id {
            next.category_id = Some(category.clone());
            for line in &mut next.lines {
                line.category_id = category.clone();
            }
        }
        if let Some(mode) = &changes.split_mode {
            next.split_mode = mode.clone();
            next.split_value = changes.split_value.clone();
        }
    }
    if changes.split_mode.is_some() && next.split_mode != "percent" {
        next.split_value.clear();
    }
    (next, pending)
}
fn apply(
    tx: &rusqlite::Transaction<'_>,
    i: &EntryInput,
    pending: Option<&classification::Pending>,
) -> Result<()> {
    if let Some(p) = pending {
        let affected=tx.execute("UPDATE events SET revision=revision+1 WHERE id=?1 AND revision=?2 AND kind='unclassified'",params![i.id,i.revision]).map_err(err)?;
        if affected != 1 {
            return Err("Purchase changed. Reload merchant review.".into());
        }
        tx.execute(
            "UPDATE pending_activity SET category_id=?1 WHERE event_id=?2",
            params![p.category_id, i.id],
        )
        .map_err(err)?;
    } else {
        Store::write_entry(tx, i.clone())?;
    }
    Ok(())
}
fn bump_sources(conn: &Connection, snapshots: &[Saved]) -> Result<()> {
    let sources: HashSet<_> = snapshots
        .iter()
        .flat_map(|s| s.links.iter().map(|r| &r.source))
        .collect();
    for source in sources {
        conn.execute(
            "UPDATE import_sources SET revision=revision+1 WHERE id=?1",
            [source],
        )
        .map_err(err)?;
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub count: usize,
    pub before_allowance_cents: i64,
    pub after_allowance_cents: i64,
    pub after_provisional_cents: i64,
    pub household_change_cents: i64,
}
impl Store {
    pub fn preview_purchases(&self, request: Request) -> Result<Preview> {
        check_changes(&self.conn, &request.changes)?;
        if request.rows.is_empty() || request.rows.len() > 5000 {
            return Err("Select up to 5,000 purchases.".into());
        }
        let valid:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM import_sources WHERE id=?1 AND revision=?2 AND configured=1 AND dismissed=0)",params![request.source_id,request.source_revision],|r|r.get(0)).map_err(err)?;
        if !valid {
            return Err("The import changed. Reload merchant review.".into());
        }
        let entries = self.entries(None)?;
        let mut seen = HashSet::new();
        let mut preview = Preview {
            count: request.rows.len(),
            before_allowance_cents: 0,
            after_allowance_cents: 0,
            after_provisional_cents: 0,
            household_change_cents: 0,
        };
        for row in &request.rows {
            if !seen.insert(&row.event_id) {
                return Err("A purchase was selected twice.".into());
            }
            let linked:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM import_rows WHERE id=?1 AND source_id=?2 AND event_id=?3 AND disposition IN ('linked','imported'))",params![row.row_id,request.source_id,row.event_id],|r|r.get(0)).map_err(err)?;
            if !linked {
                return Err("Purchase source changed. Reload review.".into());
            }
            let e = entries
                .iter()
                .find(|e| e.id == row.event_id && e.revision == row.revision)
                .ok_or("Purchase changed. Reload review.")?;
            let why = reason(&self.conn, e)?;
            if !why.is_empty() {
                return Err(why);
            }
            let (next, pending) = changed(e, &request.changes);
            preview.before_allowance_cents += if e.pending.is_some() {
                e.amount_cents
            } else {
                e.jacob_cents
            };
            let (allowance, household) = if pending.is_some() {
                preview.after_provisional_cents += e.amount_cents;
                (e.amount_cents, 0)
            } else {
                let (jacob, chelsea) =
                    money::allocation(e.amount_cents, &next.split_mode, &next.split_value)?;
                (jacob, if e.payer == "jacob" { chelsea } else { -jacob })
            };
            preview.after_allowance_cents += allowance;
            preview.household_change_cents += household - e.household_delta_cents;
        }
        Ok(preview)
    }
    pub fn purchase_review(&self, source: &str) -> Result<View> {
        let account: String = self
            .conn
            .query_row(
                "SELECT account_id FROM import_sources WHERE id=?1 AND configured=1",
                [source],
                |r| r.get(0),
            )
            .map_err(|_| "Confirm the source account and columns first.")?;
        let entries = self.entries(None)?;
        let by_id: HashMap<_, _> = entries.iter().map(|e| (e.id.as_str(), e)).collect();
        let mut stmt=self.conn.prepare("SELECT id,event_id,candidate_json FROM import_rows WHERE source_id=?1 AND disposition IN ('imported','linked') ORDER BY ordinal").map_err(err)?;
        let mut cursor = stmt.query([source]).map_err(err)?;
        let mut items = Vec::new();
        let mut seen = HashSet::new();
        while let Some(row) = cursor.next().map_err(err)? {
            let id: String = row.get(1).map_err(err)?;
            let Some(e) = by_id.get(id.as_str()) else {
                continue;
            };
            if e.kind != "expense" && !e.pending.as_ref().is_some_and(|p| p.verified_expense) {
                continue;
            }
            if !seen.insert(id) {
                continue;
            }
            let c: crate::imports::types::Candidate =
                serde_json::from_str(&row.get::<_, String>(2).map_err(err)?).map_err(err)?;
            items.push(Item {
                row_id: row.get(0).map_err(err)?,
                merchant: rules::normalize(&c.description),
                entry: (*e).clone(),
                reason: reason(&self.conn, e)?,
            });
        }
        // Suggestions are explicit recorded choices, never automatically applied to a group.
        let mut previous = Vec::new();
        let mut seen = HashSet::new();
        for e in &entries {
            let merchant = rules::normalize(&e.description);
            if e.kind == "expense"
                && e.account_id.as_deref() == Some(&account)
                && e.category_id.as_deref() != Some("uncategorized")
                && reason(&self.conn, e)?.is_empty()
                && seen.insert(merchant.clone())
            {
                previous.push(Choice {
                    merchant,
                    date: e.date.clone(),
                    category_id: e.category_id.clone().unwrap(),
                    split_mode: e.split_mode.clone(),
                    split_value: e.split_value.clone(),
                });
            }
        }
        let undo_id=self.conn.query_row("SELECT id FROM purchase_reviews WHERE source_id=?1 AND undone=0 ORDER BY rowid DESC LIMIT 1",[source],|r|r.get(0)).optional().map_err(err)?;
        Ok(View {
            items,
            previous,
            undo_id,
        })
    }
    pub fn review_purchases(&mut self, request: Request) -> Result<()> {
        Uuid::parse_str(&request.id).map_err(|_| "Invalid review operation.")?;
        let hash = parse::hash(serde_json::to_string(&request).map_err(err)?.as_bytes());
        if let Some((prior, undone)) = self
            .conn
            .query_row(
                "SELECT payload_hash,undone FROM purchase_reviews WHERE id=?1",
                [&request.id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)),
            )
            .optional()
            .map_err(err)?
        {
            if prior != hash || undone {
                return Err(
                    "This review operation was already used or undone. Reload review.".into(),
                );
            }
            return Ok(());
        }
        if !request.confirmed || request.rows.is_empty() || request.rows.len() > 5000 {
            return Err("Select up to 5,000 purchases and confirm the preview.".into());
        }
        let entries = self.entries(None)?;
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM import_sources WHERE id=?1 AND revision=?2 AND configured=1 AND dismissed=0)",params![request.source_id,request.source_revision],|r|r.get(0)).map_err(err)?;
        if !valid {
            return Err("The import changed. Reload merchant review.".into());
        }
        check_changes(&tx, &request.changes)?;
        let mut saved = Vec::new();
        let mut seen = HashSet::new();
        for row in &request.rows {
            if !seen.insert(&row.event_id) {
                return Err("A purchase was selected twice.".into());
            }
            let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM import_rows r JOIN events e ON e.id=r.event_id WHERE r.id=?1 AND r.source_id=?2 AND e.id=?3 AND e.revision=?4 AND r.disposition IN ('imported','linked'))",params![row.row_id,request.source_id,row.event_id,row.revision],|r|r.get(0)).map_err(err)?;
            if !valid {
                return Err("A selected purchase changed. Reload merchant review.".into());
            }
            let e = entries
                .iter()
                .find(|e| e.id == row.event_id && e.revision == row.revision)
                .ok_or("Purchase changed. Reload review.")?;
            let why = reason(&tx, e)?;
            if !why.is_empty() {
                return Err(why);
            }
            let (mut next, pending) = changed(e, &request.changes);
            apply(&tx, &next, pending.as_ref())?;
            next.revision += 1;
            saved.push(Saved {
                before: input(e),
                pending: e.pending.clone(),
                after: next,
                after_pending: pending,
                links: links(&tx, &e.id)?,
            });
        }
        let raw = serde_json::to_string(&saved).map_err(err)?;
        tx.execute("INSERT INTO purchase_reviews(id,source_id,payload_hash,snapshot_json,snapshot_hash) VALUES (?1,?2,?3,?4,?5)",params![request.id,request.source_id,hash,raw,parse::hash(raw.as_bytes())]).map_err(err)?;
        bump_sources(&tx, &saved)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('review_purchases',?1)",
            [&request.id],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
    pub fn undo_purchase_review(&mut self, id: &str) -> Result<()> {
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let (raw, hash, undone): (String, String, bool) = tx
            .query_row(
                "SELECT snapshot_json,snapshot_hash,undone FROM purchase_reviews WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| "Review operation no longer exists.")?;
        if undone {
            return Ok(());
        }
        if parse::hash(raw.as_bytes()) != hash {
            return Err("Review history checksum is invalid.".into());
        }
        let saved: Vec<Saved> = serde_json::from_str(&raw).map_err(err)?;
        for s in &saved {
            let current: Option<i64> = tx
                .query_row(
                    "SELECT revision FROM events WHERE id=?1",
                    [&s.before.id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?;
            if current != Some(s.after.revision) || links(&tx, &s.before.id)? != s.links {
                return Err("Undo is unavailable because a purchase changed or its import links changed. Correct it individually.".into());
            }
            refunds::protect_delete(&tx, &s.before.id)?;
            bills::protect_delete(&tx, &s.before.id)?;
            goals::protect_delete(&tx, &s.before.id)?;
            movements::protect_entry(&tx, &s.before.id)?;
        }
        for s in &saved {
            let mut original = s.before.clone();
            original.revision = s.after.revision;
            if let Some(p) = &s.pending {
                tx.execute("DELETE FROM event_lines WHERE event_id=?1", [&original.id])
                    .map_err(err)?;
                tx.execute(
                    "DELETE FROM activity_resolutions WHERE event_id=?1",
                    [&original.id],
                )
                .map_err(err)?;
                tx.execute("UPDATE events SET revision=revision+1,kind='unclassified',category_id=NULL,split_mode='none',split_value='',jacob_cents=0,chelsea_cents=0,household_delta_cents=0 WHERE id=?1",[&original.id]).map_err(err)?;
                tx.execute("INSERT INTO pending_activity(event_id,direction,verified_expense,category_id,kind_hint) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(event_id) DO UPDATE SET direction=excluded.direction,verified_expense=excluded.verified_expense,category_id=excluded.category_id,kind_hint=excluded.kind_hint",params![original.id,p.direction,p.verified_expense,p.category_id,p.kind_hint]).map_err(err)?;
            } else {
                Store::write_entry(&tx, original)?;
            }
            // Only restore import undo eligibility if it matched the exact before-version.
            for link in &s.links {
                if link.revision == s.before.revision {
                    tx.execute(
                        "UPDATE import_rows SET event_revision=?1 WHERE id=?2",
                        params![s.after.revision + 1, link.row],
                    )
                    .map_err(err)?;
                }
            }
        }
        bump_sources(&tx, &saved)?;
        tx.execute("UPDATE purchase_reviews SET undone=1 WHERE id=?1", [id])
            .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('undo_purchase_review',?1)",
            [id],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let mut stmt = conn
        .prepare("SELECT id,payload_hash,snapshot_json,snapshot_hash FROM purchase_reviews")
        .map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let id: String = r.get(0).map_err(err)?;
        Uuid::parse_str(&id).map_err(err)?;
        let payload: String = r.get(1).map_err(err)?;
        let raw: String = r.get(2).map_err(err)?;
        let hash: String = r.get(3).map_err(err)?;
        if payload.len() != 64 || parse::hash(raw.as_bytes()) != hash {
            return Err("Backup purchase-review history checksum is invalid.".into());
        }
        let saved: Vec<Saved> = serde_json::from_str(&raw).map_err(err)?;
        if saved.is_empty() || saved.len() > 5000 {
            return Err("Backup purchase review has an invalid size.".into());
        }
        let mut seen = HashSet::new();
        for s in saved {
            if !seen.insert(s.before.id.clone())
                || s.before.id != s.after.id
                || s.before.revision + 1 != s.after.revision
                || s.before.date != s.after.date
                || s.before.amount != s.after.amount
                || s.before.account_id != s.after.account_id
                || s.before.payer != s.after.payer
                || s.links.is_empty()
                || !["expense", "unclassified"].contains(&s.before.kind.as_str())
                || (s.before.kind == "unclassified") != s.pending.is_some()
                || (s.after.kind == "unclassified") != s.after_pending.is_some()
                || s.pending.as_ref().is_some_and(|p| !p.verified_expense)
            {
                return Err("Backup purchase-review history is inconsistent.".into());
            }
            Uuid::parse_str(&s.before.id).map_err(err)?;
            money::cents(&s.before.amount)?;
        }
    }
    Ok(())
}
