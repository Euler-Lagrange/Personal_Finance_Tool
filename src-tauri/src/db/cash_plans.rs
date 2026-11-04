use super::*;
use chrono::{Datelike, Duration as Days, Months};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub name: String,
    pub kind: String,
    pub amount: String,
    pub account_id: Option<String>,
    pub destination_account_id: Option<String>,
    pub payer: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub revision: i64,
    pub anchor: String,
    pub cadence: String,
    pub second_day: Option<u32>,
    pub end_date: Option<String>,
    pub archived: bool,
    pub plan: Plan,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Actual {
    pub id: String,
    pub revision: i64,
    pub date: String,
    pub description: String,
    pub amount_cents: i64,
    pub suggested: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub payroll_managed: bool,
    pub id: String,
    pub schedule_id: String,
    pub slot: String,
    pub scheduled_date: String,
    pub due_date: String,
    pub revision: i64,
    pub plan: Plan,
    pub cancelled: bool,
    pub note: String,
    pub actual: Option<Actual>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub schedules: Vec<Schedule>,
    pub occurrences: Vec<Occurrence>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    pub id: String,
    pub revision: i64,
    pub due_date: String,
    pub plan: Plan,
    pub cancelled: bool,
    pub note: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub id: String,
    pub revision: i64,
    pub event_id: String,
    pub event_revision: i64,
    pub confirmed: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub revision: i64,
    pub entry: EntryInput,
    pub confirmed: bool,
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn date(s: &str) -> Result<NaiveDate> {
    if s.len() != 10 || !("1900-01-01"..="2100-12-31").contains(&s) {
        return Err("Choose a valid date between 1900 and 2100.".into());
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "Choose a valid calendar date.".into())
}
fn check_plan(conn: &Connection, p: &Plan, old: Option<&Plan>) -> Result<()> {
    if p.name.trim().is_empty() || p.name.len() > 100 || money::cents(&p.amount)? == 0 {
        return Err("Enter a name up to 100 characters and a positive planned amount.".into());
    }
    if !["income", "transfer", "settlement", "paypal_cashout"].contains(&p.kind.as_str())
        || !["jacob", "chelsea"].contains(&p.payer.as_str())
    {
        return Err(
            "Choose a paycheck, bank transfer, household settlement or PayPal cash-out.".into(),
        );
    }
    if p.kind != "settlement" && (p.payer != "jacob" || p.account_id.is_none()) {
        return Err("Choose your bank account for pay or transfers.".into());
    }
    if p.kind == "transfer" {
        if p.destination_account_id.is_none() || p.destination_account_id == p.account_id {
            return Err("Choose two different owned bank accounts.".into());
        }
    } else if p.destination_account_id.is_some() {
        return Err("Only a planned transfer has a destination account.".into());
    }
    for (id, previous) in [
        (&p.account_id, old.and_then(|p| p.account_id.as_ref())),
        (
            &p.destination_account_id,
            old.and_then(|p| p.destination_account_id.as_ref()),
        ),
    ] {
        if let Some(id) = id {
            let (kind, archived): (String, bool) = conn
                .query_row(
                    "SELECT kind,archived FROM accounts WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|_| "Choose an existing bank account.")?;
            if !["checking", "savings"].contains(&kind.as_str()) {
                return Err(
                    "Use a checking or savings account. Card payments belong to card statements."
                        .into(),
                );
            }
            if archived && previous != Some(id) {
                return Err("Choose an active bank account.".into());
            }
        }
    }
    Ok(())
}
fn check_schedule(s: &Schedule) -> Result<()> {
    Uuid::parse_str(&s.id).map_err(|_| "Invalid schedule identifier.")?;
    let anchor = date(&s.anchor)?;
    if !["once", "weekly", "biweekly", "monthly", "twice_monthly"].contains(&s.cadence.as_str()) {
        return Err("Choose a supported cadence.".into());
    }
    if s.cadence == "twice_monthly" {
        if s.second_day.is_none_or(|d| d <= anchor.day() || d > 31) {
            return Err(
                "The second monthly day must follow the anchor's day and be at most 31.".into(),
            );
        }
    } else if s.second_day.is_some() {
        return Err("Only twice-monthly schedules have a second day.".into());
    }
    if let Some(end) = &s.end_date {
        if date(end)? < anchor {
            return Err("End date cannot precede the first planned date.".into());
        }
    }
    Ok(())
}
pub(super) fn schedules(conn: &Connection) -> Result<Vec<Schedule>> {
    let mut q=conn.prepare("SELECT id,revision,anchor,cadence,second_day,end_date,archived,plan_json FROM cash_schedules ORDER BY rowid").map_err(err)?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get::<_, String>(7)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    rows.into_iter()
        .map(
            |(id, revision, anchor, cadence, second_day, end_date, archived, p)| {
                Ok(Schedule {
                    id,
                    revision,
                    anchor,
                    cadence,
                    second_day,
                    end_date,
                    archived,
                    plan: serde_json::from_str(&p).map_err(err)?,
                })
            },
        )
        .collect()
}
// Keys identify original schedule slots, independent of holiday overrides.
pub(super) fn slots(s: &Schedule, month: &str) -> Result<Vec<(String, String)>> {
    validate_month(month)?;
    let first = date(&format!("{month}-01"))?;
    let end = first
        .checked_add_months(Months::new(1))
        .ok_or("Date is out of range.")?;
    let anchor = date(&s.anchor)?;
    let mut out = Vec::new();
    let mut day = first;
    let last = (end - Days::days(1)).day();
    while day < end {
        let count = (day - anchor).num_days();
        if count >= 0 {
            let hits = match s.cadence.as_str() {
                "once" => vec![count == 0],
                "weekly" => vec![count % 7 == 0],
                "biweekly" => vec![count % 14 == 0],
                "monthly" => vec![day.day() == anchor.day().min(last)],
                "twice_monthly" => vec![
                    day.day() == anchor.day().min(last),
                    day.day() == s.second_day.unwrap().min(last),
                ],
                _ => return Err("Invalid cash schedule cadence.".into()),
            };
            for (slot, hit) in hits.into_iter().enumerate() {
                if hit {
                    let d = day.format("%Y-%m-%d").to_string();
                    out.push((format!("{d}:{slot}"), d));
                }
            }
        }
        day += Days::days(1);
    }
    Ok(out)
}
fn actual(conn: &Connection, id: &str) -> Result<Actual> {
    conn.query_row(
        "SELECT id,revision,date,description,amount_cents FROM events WHERE id=?1",
        [id],
        |r| {
            Ok(Actual {
                id: r.get(0)?,
                revision: r.get(1)?,
                date: r.get(2)?,
                description: r.get(3)?,
                amount_cents: r.get(4)?,
                suggested: false,
            })
        },
    )
    .map_err(err)
}
pub(super) fn occurrence(conn: &Connection, id: &str) -> Result<Occurrence> {
    let (id,schedule_id,slot,scheduled_date,due_date,revision,p,cancelled,note,event):(String,String,String,String,String,i64,String,bool,String,Option<String>)=conn.query_row("SELECT o.id,o.schedule_id,o.slot,o.scheduled_date,o.due_date,o.revision,o.plan_json,o.cancelled,o.note,m.event_id FROM cash_occurrences o LEFT JOIN cash_matches m ON m.occurrence_id=o.id WHERE o.id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?))).map_err(|_|"Planned event no longer exists.")?;
    Ok(Occurrence {
        payroll_managed: super::pay_cash::suppressed(
            &super::payroll::read(conn)?.1,
            &schedule_id,
            &scheduled_date,
        ),
        id,
        schedule_id,
        slot,
        scheduled_date,
        due_date,
        revision,
        plan: serde_json::from_str(&p).map_err(err)?,
        cancelled,
        note,
        actual: event.map(|e| actual(conn, &e)).transpose()?,
    })
}
pub(super) fn compatible(conn: &Connection, p: &Plan, id: &str) -> Result<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM events e WHERE id=?1 AND kind=?2 AND account_id IS ?3 AND destination_account_id IS ?4 AND payer=?5 AND NOT EXISTS(SELECT 1 FROM pending_activity WHERE event_id=e.id))",params![id,p.kind,p.account_id,p.destination_account_id,p.payer],|r|r.get(0)).map_err(err)
}
fn revision(o: &Occurrence, expected: i64) -> Result<()> {
    if o.revision != expected {
        return Err("This planned event changed. Reopen it before saving.".into());
    }
    Ok(())
}
fn payload<T: Serialize>(action: &str, input: &T) -> Result<String> {
    Ok(crate::imports::parse::hash(
        json(&(action, input))?.as_bytes(),
    ))
}
fn retry(conn: &Connection, operation: &str, hash: &str) -> Result<bool> {
    Uuid::parse_str(operation).map_err(|_| "Invalid cash-plan operation.")?;
    let prior: Option<String> = conn
        .query_row(
            "SELECT payload_hash FROM cash_receipts WHERE id=?1",
            [operation],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(prior) = prior {
        if prior != hash {
            return Err(
                "This operation was used for different changes. Reload the planner.".into(),
            );
        }
        return Ok(true);
    }
    Ok(false)
}
fn receipt(conn: &Connection, operation: &str, hash: &str, action: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO cash_receipts VALUES (?1,?2)",
        params![operation, hash],
    )
    .map_err(err)?;
    conn.execute(
        "INSERT INTO audit(action,payload) VALUES (?1,?2)",
        params![action, operation],
    )
    .map_err(err)?;
    Ok(())
}
fn link(conn: &Connection, o: &Occurrence, event: &str, event_revision: i64) -> Result<()> {
    super::pay_cash::protect_occurrence(conn, o)?;
    super::pay_cash::protect_delete(conn, event)?;
    if o.cancelled || o.actual.is_some() {
        return Err(
            "Restore a cancelled plan or unlink its existing match before matching.".into(),
        );
    }
    let a = actual(conn, event)?;
    if a.revision != event_revision
        || !compatible(conn, &o.plan, event)?
        || a.date > Local::now().format("%Y-%m-%d").to_string()
    {
        return Err("Choose a completed transaction with the same kind, accounts and direction. Refresh if it changed.".into());
    }
    conn.execute(
        "INSERT INTO cash_matches VALUES (?1,?2)",
        params![o.id, event],
    )
    .map_err(|_| "This transaction is already matched to another planned event.")?;
    conn.execute(
        "UPDATE cash_occurrences SET revision=revision+1 WHERE id=?1",
        [&o.id],
    )
    .map_err(err)?;
    Ok(())
}
impl Store {
    pub fn cash_month(&mut self, month: &str) -> Result<View> {
        validate_month(month)?;
        let schedules = schedules(&self.conn)?;
        let mut pending = Vec::new();
        for s in schedules.iter().filter(|s| !s.archived) {
            for (slot, due) in slots(s, month)? {
                if s.end_date.as_ref().is_some_and(|e| &due > e) {
                    continue;
                }
                let exists:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM cash_occurrences WHERE schedule_id=?1 AND slot=?2)",params![s.id,slot],|r|r.get(0)).map_err(err)?;
                if !exists {
                    pending.push((s, slot, due));
                }
            }
        }
        if !pending.is_empty() {
            self.backup()?;
            let tx = self.conn.transaction().map_err(err)?;
            // Recheck current schedules after the backup under this transaction.
            for s in self::schedules(&tx)?.iter().filter(|s| !s.archived) {
                for (slot, due) in slots(s, month)? {
                    if s.end_date.as_ref().is_some_and(|end| &due > end) {
                        continue;
                    }
                    tx.execute(
                        "INSERT OR IGNORE INTO cash_occurrences VALUES (?1,?2,?3,?4,?4,1,?5,0,'')",
                        params![Uuid::new_v4().to_string(), s.id, slot, due, json(&s.plan)?],
                    )
                    .map_err(err)?;
                }
            }
            tx.execute(
                "INSERT INTO audit(action,payload) VALUES ('prepare_cash_month',?1)",
                [month],
            )
            .map_err(err)?;
            periods::commit(tx)?;
        }
        let mut q=self.conn.prepare("SELECT id FROM cash_occurrences WHERE substr(due_date,1,7)=?1 ORDER BY due_date,scheduled_date,id").map_err(err)?;
        let ids = q
            .query_map([month], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        Ok(View {
            schedules: self::schedules(&self.conn)?,
            occurrences: ids
                .into_iter()
                .map(|id| occurrence(&self.conn, &id))
                .collect::<Result<_>>()?,
        })
    }
    pub fn save_cash_schedule(&mut self, operation: &str, s: Schedule) -> Result<()> {
        let hash = payload("schedule", &s)?;
        if retry(&self.conn, operation, &hash)? {
            return Ok(());
        }
        check_schedule(&s)?;
        let old = schedules(&self.conn)?
            .into_iter()
            .find(|old| old.id == s.id);
        if old.as_ref().map_or(0, |o| o.revision) != s.revision {
            return Err("Schedule changed. Reopen it before saving.".into());
        }
        check_plan(&self.conn, &s.plan, old.as_ref().map(|o| &o.plan))?;
        if super::payroll::read(&self.conn)?
            .1
            .pay_takeovers
            .contains_key(&s.id)
            && old.as_ref().is_some_and(|o| {
                o.plan != s.plan
                    || o.anchor != s.anchor
                    || o.cadence != s.cadence
                    || o.second_day != s.second_day
            })
        {
            return Err("Release the paycheck takeover in Pay & hours before changing this schedule's amounts, accounts or cadence. Archive/end-date controls remain available.".into());
        }
        if let Some(old) = &old {
            let used: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM cash_occurrences WHERE schedule_id=?1)",
                    [&s.id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if used
                && (old.anchor != s.anchor
                    || old.cadence != s.cadence
                    || old.second_day != s.second_day)
            {
                return Err("This schedule already has dated events. End it and create a new schedule to change the cadence; individual dates can still be overridden.".into());
            }
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let current = self::schedules(&tx)?.into_iter().find(|o| o.id == s.id);
        if current.as_ref().map_or(0, |o| o.revision) != s.revision {
            return Err("Schedule changed. Refresh before saving.".into());
        }
        check_plan(&tx, &s.plan, current.as_ref().map(|o| &o.plan))?;
        if let Some(old) = &current {
            let used: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM cash_occurrences WHERE schedule_id=?1)",
                    [&s.id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if used
                && (old.anchor != s.anchor
                    || old.cadence != s.cadence
                    || old.second_day != s.second_day)
            {
                return Err("Dated events now exist. End this schedule and create another to change its cadence.".into());
            }
        }
        if s.revision==0 {tx.execute("INSERT INTO cash_schedules VALUES (?1,1,?2,?3,?4,?5,?6,?7)",params![s.id,s.anchor,s.cadence,s.second_day,s.end_date,s.archived,json(&s.plan)?]).map_err(err)?;}
        else if tx.execute("UPDATE cash_schedules SET revision=revision+1,end_date=?1,archived=?2,plan_json=?3,anchor=?4,cadence=?5,second_day=?6 WHERE id=?7 AND revision=?8",params![s.end_date,s.archived,json(&s.plan)?,s.anchor,s.cadence,s.second_day,s.id,s.revision]).map_err(err)?!=1 {return Err("Schedule changed. Refresh before saving.".into());}
        // Ending a schedule cancels its unmatched later slots. Archiving cancels
        // unmatched future events; neither removes history or recorded matches.
        tx.execute("UPDATE cash_occurrences SET cancelled=1,revision=revision+1,note=CASE WHEN note='' THEN 'Cancelled by schedule end/archive' ELSE note END WHERE schedule_id=?1 AND cancelled=0 AND NOT EXISTS(SELECT 1 FROM cash_matches WHERE occurrence_id=cash_occurrences.id) AND ((?2 IS NOT NULL AND scheduled_date>?2) OR (?3=1 AND due_date>=?4))",params![s.id,s.end_date,s.archived,Local::now().format("%Y-%m-%d").to_string()]).map_err(err)?;
        receipt(&tx, operation, &hash, "cash_schedule_save")?;
        periods::commit(tx)
    }
    pub fn save_cash_occurrence(&mut self, operation: &str, input: Edit) -> Result<()> {
        let hash = payload("occurrence", &input)?;
        if retry(&self.conn, operation, &hash)? {
            return Ok(());
        }
        date(&input.due_date)?;
        if input.note.len() > 2000 {
            return Err("Keep the plan note under 2,000 characters.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let o = occurrence(&tx, &input.id)?;
        revision(&o, input.revision)?;
        super::pay_cash::protect_occurrence(&tx, &o)?;
        check_plan(&tx, &input.plan, Some(&o.plan))?;
        if o.actual.is_some()
            && (o.plan != input.plan || o.due_date != input.due_date || input.cancelled)
        {
            return Err(
                "Unlink the recorded transaction before changing this plan. Notes remain editable."
                    .into(),
            );
        }
        tx.execute("UPDATE cash_occurrences SET revision=revision+1,due_date=?1,plan_json=?2,cancelled=?3,note=?4 WHERE id=?5",params![input.due_date,json(&input.plan)?,input.cancelled,input.note,input.id]).map_err(err)?;
        receipt(&tx, operation, &hash, "cash_occurrence_save")?;
        periods::commit(tx)
    }
    pub fn cash_candidates(&self, id: &str) -> Result<Vec<Actual>> {
        let o = occurrence(&self.conn, id)?;
        let mut q=self.conn.prepare("SELECT e.id FROM events e WHERE NOT EXISTS(SELECT 1 FROM cash_matches WHERE event_id=e.id) AND e.date<=?1 ORDER BY e.date DESC,e.id").map_err(err)?;
        let ids = q
            .query_map([Local::now().format("%Y-%m-%d").to_string()], |r| {
                r.get::<_, String>(0)
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        let mut result = Vec::new();
        for id in ids {
            if compatible(&self.conn, &o.plan, &id)?
                && !super::pay_cash::allocated(&self.conn, &id)?
            {
                let mut a = actual(&self.conn, &id)?;
                a.suggested = a.amount_cents == money::cents(&o.plan.amount)?
                    && (date(&a.date)? - date(&o.due_date)?).num_days().abs() <= 4;
                result.push(a);
            }
        }
        result.sort_by(|a, b| {
            b.suggested
                .cmp(&a.suggested)
                .then(b.date.cmp(&a.date))
                .then(a.id.cmp(&b.id))
        });
        Ok(result)
    }
    pub fn match_cash(&mut self, operation: &str, input: Match) -> Result<()> {
        let hash = payload("match", &input)?;
        if retry(&self.conn, operation, &hash)? {
            return Ok(());
        }
        if !input.confirmed {
            return Err("Confirm this is the actual transaction for this planned event.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let o = occurrence(&tx, &input.id)?;
        revision(&o, input.revision)?;
        link(&tx, &o, &input.event_id, input.event_revision)?;
        receipt(&tx, operation, &hash, "cash_match")?;
        periods::commit(tx)
    }
    pub fn unmatch_cash(&mut self, operation: &str, id: &str, expected: i64) -> Result<()> {
        let hash = payload("unmatch", &(id, expected))?;
        if retry(&self.conn, operation, &hash)? {
            return Ok(());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let o = occurrence(&tx, id)?;
        revision(&o, expected)?;
        if tx
            .execute("DELETE FROM cash_matches WHERE occurrence_id=?1", [id])
            .map_err(err)?
            != 1
        {
            return Err("This planned event has no recorded match.".into());
        }
        tx.execute(
            "UPDATE cash_occurrences SET revision=revision+1 WHERE id=?1",
            [id],
        )
        .map_err(err)?;
        receipt(&tx, operation, &hash, "cash_unmatch")?;
        periods::commit(tx)
    }
    pub fn record_cash(&mut self, operation: &str, input: Record) -> Result<()> {
        let hash = payload("record", &input)?;
        if retry(&self.conn, operation, &hash)? {
            return Ok(());
        }
        if !input.confirmed
            || input.entry.revision != 0
            || input.entry.date > Local::now().format("%Y-%m-%d").to_string()
        {
            return Err(
                "Confirm a new transaction that has actually happened, using its real date.".into(),
            );
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let o = occurrence(&tx, &input.id)?;
        revision(&o, input.revision)?;
        Store::write_entry(&tx, input.entry.clone())?;
        link(&tx, &o, &input.entry.id, 1)?;
        receipt(&tx, operation, &hash, "cash_record")?;
        periods::commit(tx)
    }
}
pub(super) fn protect_delete(conn: &Connection, id: &str) -> Result<()> {
    let used: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM cash_matches WHERE event_id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if used {
        return Err("This transaction fulfills a planned cash event. Unlink it in Cash plans before deleting it or undoing its import.".into());
    }
    Ok(())
}
pub(super) fn protect_entry(conn: &Connection, i: &EntryInput) -> Result<()> {
    let used: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM cash_matches WHERE event_id=?1)",
            [&i.id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !used {
        return Ok(());
    }
    let same:bool=conn.query_row("SELECT kind=?2 AND date=?3 AND amount_cents=?4 AND payer=?5 AND account_id IS ?6 AND destination_account_id IS ?7 FROM events WHERE id=?1",params![i.id,i.kind,i.date,money::cents(&i.amount)?,i.payer,i.account_id,i.destination_account_id],|r|r.get(0)).map_err(err)?;
    if !same {
        return Err("Unlink this transaction in Cash plans before changing its money, date or accounts. Description and notes remain editable.".into());
    }
    Ok(())
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let all = schedules(conn)?;
    for s in &all {
        check_schedule(s)?;
        check_plan(conn, &s.plan, Some(&s.plan))?;
        if s.revision < 1 {
            return Err("Invalid schedule revision.".into());
        }
    }
    let mut q = conn
        .prepare("SELECT id FROM cash_occurrences")
        .map_err(err)?;
    let ids = q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for id in ids {
        let o = occurrence(conn, &id)?;
        Uuid::parse_str(&o.id).map_err(err)?;
        date(&o.due_date)?;
        date(&o.scheduled_date)?;
        check_plan(conn, &o.plan, Some(&o.plan))?;
        let s = all
            .iter()
            .find(|s| s.id == o.schedule_id)
            .ok_or("Missing cash schedule.")?;
        if !slots(s, &o.scheduled_date[..7])?.contains(&(o.slot.clone(), o.scheduled_date.clone()))
            || o.revision < 1
            || o.note.len() > 2000
        {
            return Err("Invalid planned event history.".into());
        }
        if let Some(a) = o.actual {
            if o.cancelled || !compatible(conn, &o.plan, &a.id)? {
                return Err("Invalid planned-event match.".into());
            }
        }
    }
    let mut q = conn
        .prepare("SELECT id,payload_hash FROM cash_receipts")
        .map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?).map_err(err)?;
        let h: String = r.get(1).map_err(err)?;
        if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid cash-plan receipt.".into());
        }
    }
    Ok(())
}
