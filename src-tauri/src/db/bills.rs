use super::*;
use chrono::{Datelike, Months};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub name: String,
    pub merchant: String,
    pub category_id: String,
    pub account_id: Option<String>,
    pub payer: String,
    pub split_mode: String,
    pub split_value: String,
    pub autopay: bool,
    #[serde(default = "purchase_kind")]
    pub payment_kind: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    #[serde(flatten)]
    pub details: Details,
    pub amount_cents: i64,
    #[serde(default)]
    pub lines: Vec<EntryLine>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    #[serde(flatten)]
    pub details: Details,
    pub amount: String,
    #[serde(default)]
    pub lines: Vec<LineInput>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub revision: i64,
    pub first_due: String,
    pub every_months: u32,
    pub end_date: Option<String>,
    pub archived: bool,
    pub plan: Plan,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInput {
    pub id: String,
    pub revision: i64,
    pub first_due: String,
    pub every_months: u32,
    pub end_date: Option<String>,
    pub archived: bool,
    pub plan: Draft,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: String,
    pub event_id: String,
    pub date: String,
    pub description: String,
    pub amount_cents: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub id: String,
    pub name: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub id: String,
    pub bill_id: String,
    pub period: String,
    pub revision: i64,
    pub due_date: String,
    pub plan: Plan,
    pub actual_cents: Option<i64>,
    pub cancelled: bool,
    pub note: String,
    pub paid_cents: i64,
    pub remaining_cents: i64,
    pub previous_cents: Option<i64>,
    pub payments: Vec<Payment>,
    pub evidence: Vec<Evidence>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub revision: i64,
    pub date: String,
    pub description: String,
    pub amount_cents: i64,
    pub available_cents: i64,
    pub suggested: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceInput {
    pub id: String,
    pub revision: i64,
    pub due_date: String,
    pub actual_amount: Option<String>,
    pub cancelled: bool,
    pub note: String,
    pub plan: Draft,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInput {
    pub id: String,
    pub occurrence_id: String,
    pub revision: i64,
    pub event_id: String,
    pub event_revision: i64,
    pub amount: String,
}
fn purchase_kind() -> String {
    "expense".into()
}
fn json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(err)
}
fn decode<T: serde::de::DeserializeOwned>(value: String) -> Result<T> {
    serde_json::from_str(&value).map_err(err)
}
fn date(value: &str) -> Result<NaiveDate> {
    if value.len() != 10 {
        return Err("Choose a valid date.".into());
    }
    let parsed =
        NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "Choose a valid date.")?;
    if !(1900..=2100).contains(&parsed.year()) {
        return Err("Use a date between 1900 and 2100.".into());
    }
    Ok(parsed)
}
fn plan(conn: &Connection, draft: Draft, old: Option<&Plan>) -> Result<Plan> {
    let allocated = if draft.lines.is_empty() {
        Vec::new()
    } else {
        lines::allocate(
            money::cents(&draft.amount)?,
            &draft.details.split_mode,
            &draft.details.split_value,
            &draft.lines,
        )?
    };
    lines::categories(
        conn,
        &allocated,
        old.map(|p| p.lines.as_slice()).unwrap_or(&[]),
    )?;
    let mut result = Plan {
        details: draft.details,
        amount_cents: money::cents(&draft.amount)?,
        lines: allocated,
    };
    result.details.name = result.details.name.trim().into();
    result.details.merchant = rules::normalize(&result.details.merchant);
    check_plan(conn, &result)?;
    let active: bool = conn
        .query_row(
            "SELECT archived=0 FROM categories WHERE id=?1",
            [&result.details.category_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !active && old.is_none_or(|p| p.details.category_id != result.details.category_id) {
        return Err("Choose an active category.".into());
    }
    if let Some(id) = &result.details.account_id {
        let active: bool = conn
            .query_row("SELECT archived=0 FROM accounts WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        if !active && old.is_none_or(|p| p.details.account_id.as_ref() != Some(id)) {
            return Err("Choose an active account.".into());
        }
    }
    Ok(result)
}
fn check_plan(conn: &Connection, p: &Plan) -> Result<()> {
    if !matches!(p.details.payment_kind.as_str(), "expense" | "debt_payment") {
        return Err("Choose a purchase or loan/debt payment for this bill.".into());
    }
    if !p.lines.is_empty() {
        let calculated = lines::allocate(
            p.amount_cents,
            &p.details.split_mode,
            &p.details.split_value,
            &p.lines.iter().map(EntryLine::input).collect::<Vec<_>>(),
        )?;
        if calculated != p.lines {
            return Err("Bill charge-line allocations are inconsistent.".into());
        }
        lines::categories(conn, &p.lines, &p.lines)?;
    }
    if p.details.name.trim().is_empty()
        || p.details.name.len() > 100
        || p.details.merchant.len() > 200
    {
        return Err("Use a bill name up to 100 characters and a merchant phrase up to 200.".into());
    }
    money::allocation(
        p.amount_cents,
        &p.details.split_mode,
        &p.details.split_value,
    )?;
    if !["jacob", "chelsea"].contains(&p.details.payer.as_str())
        || (p.details.payer == "chelsea" && p.details.account_id.is_some())
    {
        return Err("Chelsea-paid bills cannot use your accounts.".into());
    }
    let category: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1)",
            [&p.details.category_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !category {
        return Err("Choose an existing bill category.".into());
    }
    if let Some(id) = &p.details.account_id {
        let account: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !account {
            return Err("Choose an existing bill account.".into());
        }
    }
    Ok(())
}
pub(super) fn templates(conn: &Connection) -> Result<Vec<Template>> {
    let mut stmt=conn.prepare("SELECT id,revision,first_due,every_months,end_date,archived,plan_json FROM bill_templates ORDER BY rowid").map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get(1)?,
                r.get::<_, String>(2)?,
                r.get(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get(5)?,
                r.get::<_, String>(6)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    rows.into_iter()
        .map(
            |(id, revision, first_due, every_months, end_date, archived, p)| {
                Ok(Template {
                    id,
                    revision,
                    first_due,
                    every_months,
                    end_date,
                    archived,
                    plan: decode(p)?,
                })
            },
        )
        .collect()
}
pub(super) fn occurrence(conn: &Connection, id: &str) -> Result<Occurrence> {
    let mut o=conn.query_row("SELECT id,bill_id,period,revision,due_date,plan_json,actual_cents,cancelled,note FROM bill_occurrences WHERE id=?1",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get(6)?,r.get(7)?,r.get::<_,String>(8)?))).map_err(|_|"Bill occurrence no longer exists.".to_string()).and_then(|(id,bill_id,period,revision,due_date,p,actual_cents,cancelled,note)|Ok(Occurrence{id,bill_id,period,revision,due_date,plan:decode(p)?,actual_cents,cancelled,note,paid_cents:0,remaining_cents:0,previous_cents:None,payments:vec![],evidence:vec![]}))?;
    let mut stmt=conn.prepare("SELECT p.id,p.event_id,e.date,e.description,p.amount_cents FROM bill_payments p JOIN events e ON e.id=p.event_id WHERE p.occurrence_id=?1 ORDER BY e.date,p.rowid").map_err(err)?;
    o.payments = stmt
        .query_map([id], |r| {
            Ok(Payment {
                id: r.get(0)?,
                event_id: r.get(1)?,
                date: r.get(2)?,
                description: r.get(3)?,
                amount_cents: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;
    o.paid_cents = o.payments.iter().map(|p| p.amount_cents).sum();
    o.remaining_cents = if o.cancelled {
        0
    } else {
        o.actual_cents.unwrap_or(o.plan.amount_cents) - o.paid_cents
    };
    o.previous_cents=conn.query_row("SELECT actual_cents FROM bill_occurrences WHERE bill_id=?1 AND period<?2 AND actual_cents IS NOT NULL AND cancelled=0 ORDER BY period DESC LIMIT 1",params![o.bill_id,o.period],|r|r.get(0)).optional().map_err(err)?;
    let mut stmt=conn.prepare("SELECT s.id,s.name FROM bill_evidence b JOIN import_sources s ON s.id=b.source_id WHERE b.occurrence_id=?1 ORDER BY s.created_at").map_err(err)?;
    o.evidence = stmt
        .query_map([id], |r| {
            Ok(Evidence {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;
    Ok(o)
}
fn check_revision(o: &Occurrence, revision: i64) -> Result<()> {
    if o.revision != revision {
        return Err("This bill changed. Reopen it before saving.".into());
    }
    Ok(())
}
fn audit(conn: &Connection, action: &str, payload: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO audit(action,payload) VALUES (?1,?2)",
        params![action, payload],
    )
    .map_err(err)?;
    Ok(())
}
pub(super) fn due(t: &Template, month: &str) -> Result<Option<String>> {
    let first = date(&t.first_due)?;
    let start = date(&format!("{month}-01"))?;
    let distance = (start.year() - first.year()) * 12 + start.month() as i32 - first.month() as i32;
    if t.archived || distance < 0 || distance % t.every_months as i32 != 0 {
        return Ok(None);
    }
    let last = (start
        .checked_add_months(Months::new(1))
        .ok_or("Date is outside supported range.")?
        - chrono::Duration::days(1))
    .day();
    let value = start
        .with_day(first.day().min(last))
        .unwrap()
        .format("%Y-%m-%d")
        .to_string();
    if t.end_date.as_ref().is_some_and(|end| end < &value) {
        return Ok(None);
    }
    Ok(Some(value))
}
impl Store {
    pub fn bill_templates(&self) -> Result<Vec<Template>> {
        templates(&self.conn)
    }
    #[allow(clippy::too_many_arguments)]
    pub fn save_bill_template(
        &mut self,
        id: &str,
        revision: i64,
        first_due: &str,
        every_months: u32,
        end_date: Option<String>,
        archived: bool,
        draft: Draft,
    ) -> Result<()> {
        Uuid::parse_str(id).map_err(|_| "Invalid bill identifier.")?;
        date(first_due)?;
        if !(1..=60).contains(&every_months) {
            return Err("Choose a repeat interval between 1 and 60 months.".into());
        }
        if let Some(end) = &end_date {
            date(end)?;
            if end.as_str() < first_due {
                return Err("End date must be on or after the first due date.".into());
            }
        }
        let old = templates(&self.conn)?.into_iter().find(|t| t.id == id);
        if old.as_ref().map(|t| t.revision).unwrap_or(0) != revision {
            return Err("This bill schedule changed. Reopen it before saving.".into());
        }
        let p = plan(&self.conn, draft, old.as_ref().map(|t| &t.plan))?;
        let value = Template {
            id: id.into(),
            revision: revision + 1,
            first_due: first_due.into(),
            every_months,
            end_date,
            archived,
            plan: p,
        };
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute("INSERT INTO bill_templates VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,first_due=excluded.first_due,every_months=excluded.every_months,end_date=excluded.end_date,archived=excluded.archived,plan_json=excluded.plan_json",params![id,value.revision,value.first_due,value.every_months,value.end_date,value.archived,json(&value.plan)?]).map_err(err)?;
        audit(&tx, "bill_schedule", &json(&value)?)?;
        periods::commit(tx)
    }
    pub fn bill_month(&mut self, month: &str) -> Result<Vec<Occurrence>> {
        validate_month(month)?;
        let mut pending = vec![];
        for t in templates(&self.conn)? {
            if let Some(day) = due(&t, month)? {
                let exists:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM bill_occurrences WHERE bill_id=?1 AND period=?2)",params![t.id,month],|r|r.get(0)).map_err(err)?;
                if !exists {
                    pending.push((t, day));
                }
            }
        }
        if !pending.is_empty() {
            self.backup()?;
            let tx = self.conn.transaction().map_err(err)?;
            for (t, day) in pending {
                tx.execute("INSERT INTO bill_occurrences(id,bill_id,period,revision,due_date,plan_json) VALUES (?1,?2,?3,1,?4,?5)",params![Uuid::new_v4().to_string(),t.id,month,day,json(&t.plan)?]).map_err(err)?;
            }
            audit(&tx, "prepare_bill_month", month)?;
            periods::commit(tx)?;
        }
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM bill_occurrences WHERE period=?1 ORDER BY due_date,rowid")
            .map_err(err)?;
        let ids = stmt
            .query_map([month], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        ids.iter().map(|id| occurrence(&self.conn, id)).collect()
    }
    pub fn save_bill_occurrence(&mut self, input: OccurrenceInput) -> Result<()> {
        date(&input.due_date)?;
        if input.note.len() > 2000 {
            return Err("Use a note under 2,000 characters.".into());
        }
        let old = occurrence(&self.conn, &input.id)?;
        check_revision(&old, input.revision)?;
        let p = plan(&self.conn, input.plan.clone(), Some(&old.plan))?;
        let actual = input
            .actual_amount
            .as_deref()
            .map(money::cents)
            .transpose()?;
        if old.paid_cents > actual.unwrap_or(p.amount_cents)
            || (input.cancelled && old.paid_cents != 0)
        {
            return Err("Unlink payments before cancelling this bill or lowering its total below paid amounts.".into());
        }
        if !old.payments.is_empty() && json(&old.plan)? != json(&p)? {
            return Err("Unlink payments before changing the bill's expected amount, category, account, or sharing plan. Actual amount, due date, and notes remain editable.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute("UPDATE bill_occurrences SET revision=revision+1,due_date=?1,plan_json=?2,actual_cents=?3,cancelled=?4,note=?5 WHERE id=?6",params![input.due_date,json(&p)?,actual,input.cancelled,input.note,input.id]).map_err(err)?;
        audit(&tx, "bill_occurrence", &json(&input)?)?;
        periods::commit(tx)
    }
    pub fn bill_candidates(&self, id: &str, all: bool) -> Result<Vec<Candidate>> {
        let o = occurrence(&self.conn, id)?;
        let mut stmt=self.conn.prepare("SELECT e.id,e.revision,e.date,e.description,e.amount_cents,e.amount_cents-COALESCE((SELECT SUM(p.amount_cents) FROM bill_payments p WHERE p.event_id=e.id),0),e.account_id FROM events e WHERE e.kind IN ('expense','debt_payment') AND e.payer=?1 AND (?2 OR ABS(julianday(e.date)-julianday(?3))<=45) ORDER BY e.date DESC,e.rowid DESC").map_err(err)?;
        let rows = stmt
            .query_map(params![o.plan.details.payer, all, o.due_date], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        Ok(rows
            .into_iter()
            .filter(|r| r.5 > 0)
            .map(
                |(id, revision, date, description, amount_cents, available_cents, account)| {
                    let suggested = !o.plan.details.merchant.is_empty()
                        && rules::normalize(&description).contains(&o.plan.details.merchant)
                        && o.plan
                            .details
                            .account_id
                            .as_ref()
                            .is_none_or(|a| Some(a) == account.as_ref())
                        && available_cents == o.remaining_cents;
                    Candidate {
                        id,
                        revision,
                        date,
                        description,
                        amount_cents,
                        available_cents,
                        suggested,
                    }
                },
            )
            .collect())
    }
    pub fn link_bill_payment(&mut self, input: LinkInput) -> Result<()> {
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        link(&tx, &input)?;
        audit(&tx, "bill_payment_link", &json(&input)?)?;
        periods::commit(tx)
    }
    pub fn unlink_bill_payment(&mut self, id: &str, revision: i64, payment: &str) -> Result<()> {
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let o = occurrence(&tx, id)?;
        check_revision(&o, revision)?;
        if tx
            .execute(
                "DELETE FROM bill_payments WHERE id=?1 AND occurrence_id=?2",
                params![payment, id],
            )
            .map_err(err)?
            != 1
        {
            return Err("This payment link changed. Reload the bill.".into());
        }
        tx.execute(
            "UPDATE bill_occurrences SET revision=revision+1 WHERE id=?1",
            [id],
        )
        .map_err(err)?;
        audit(&tx, "bill_payment_unlink", payment)?;
        periods::commit(tx)
    }
    pub fn record_bill_payment(
        &mut self,
        id: &str,
        revision: i64,
        operation: &str,
        input: EntryInput,
    ) -> Result<()> {
        Uuid::parse_str(operation).map_err(|_| "Invalid payment operation.")?;
        let payload = json(&(id, revision, &input))?;
        let previous: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT payload_json,event_id FROM bill_receipts WHERE id=?1",
                [operation],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if let Some((old, event)) = previous {
            let present:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM bill_payments WHERE occurrence_id=?1 AND event_id=?2)",params![id,event],|r|r.get(0)).map_err(err)?;
            if old == payload && present {
                return Ok(());
            }
            return Err(
                "This payment operation was already used or its link was removed. Reload the bill."
                    .into(),
            );
        }
        if !matches!(input.kind.as_str(), "expense" | "debt_payment")
            || input.revision != 0
            || input.date > Local::now().format("%Y-%m-%d").to_string()
        {
            return Err(
                "Record a new expense on its actual payment date, not a future payment.".into(),
            );
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let o = occurrence(&tx, id)?;
        check_revision(&o, revision)?;
        // Expense validation remains authoritative. Linking never creates a second expense.
        Self::write_entry(&tx, input.clone())?;
        link(
            &tx,
            &LinkInput {
                id: Uuid::new_v4().to_string(),
                occurrence_id: id.into(),
                revision,
                event_id: input.id.clone(),
                event_revision: 1,
                amount: input.amount.clone(),
            },
        )?;
        tx.execute(
            "INSERT INTO bill_receipts VALUES (?1,?2,?3)",
            params![operation, input.id, payload],
        )
        .map_err(err)?;
        audit(&tx, "bill_payment_record", operation)?;
        periods::commit(tx)
    }
    pub fn bill_evidence(
        &mut self,
        id: &str,
        revision: i64,
        source: &str,
        remove: bool,
    ) -> Result<()> {
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        check_revision(&occurrence(&tx, id)?, revision)?;
        if remove {
            tx.execute(
                "DELETE FROM bill_evidence WHERE occurrence_id=?1 AND source_id=?2",
                params![id, source],
            )
            .map_err(err)?;
        } else {
            tx.execute(
                "INSERT OR IGNORE INTO bill_evidence VALUES (?1,?2)",
                params![id, source],
            )
            .map_err(err)?;
        }
        tx.execute(
            "UPDATE bill_occurrences SET revision=revision+1 WHERE id=?1",
            [id],
        )
        .map_err(err)?;
        audit(&tx, "bill_evidence", &json(&(id, source, remove))?)?;
        periods::commit(tx)
    }
}
fn link(tx: &Connection, input: &LinkInput) -> Result<()> {
    Uuid::parse_str(&input.id).map_err(|_| "Invalid payment link.")?;
    let amount = money::cents(&input.amount)?;
    let previous: Option<(String, String, i64)> = tx
        .query_row(
            "SELECT occurrence_id,event_id,amount_cents FROM bill_payments WHERE id=?1",
            [&input.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((bill, event, allocated)) = previous {
        if bill == input.occurrence_id && event == input.event_id && allocated == amount {
            return Ok(());
        }
        return Err("This payment link identifier was already used. Reload the bill.".into());
    }
    let o = occurrence(tx, &input.occurrence_id)?;
    check_revision(&o, input.revision)?;
    if o.cancelled || amount == 0 || amount > o.remaining_cents {
        return Err("Payment exceeds this bill's remaining due. Confirm its actual amount or choose a smaller allocation.".into());
    }
    let available:Option<i64>=tx.query_row("SELECT e.amount_cents-COALESCE((SELECT SUM(p.amount_cents) FROM bill_payments p WHERE p.event_id=e.id),0) FROM events e WHERE e.id=?1 AND e.revision=?2 AND e.kind IN ('expense','debt_payment') AND e.payer=?3",params![input.event_id,input.event_revision,o.plan.details.payer],|r|r.get(0)).optional().map_err(err)?;
    if available.is_none_or(|a| amount > a) {
        return Err(
            "Choose an unchanged expense paid by the bill's payer with enough unallocated money."
                .into(),
        );
    }
    tx.execute(
        "INSERT INTO bill_payments VALUES (?1,?2,?3,?4)",
        params![input.id, input.occurrence_id, input.event_id, amount],
    )
    .map_err(|_| {
        "This transaction is already linked to the bill. Unlink it before changing the allocation."
    })?;
    tx.execute(
        "UPDATE bill_occurrences SET revision=revision+1 WHERE id=?1",
        [&input.occurrence_id],
    )
    .map_err(err)?;
    Ok(())
}
pub(super) fn protect_delete(conn: &Connection, id: &str) -> Result<()> {
    let used: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM bill_payments WHERE event_id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if used {
        return Err("This expense pays a bill. Unlink its bill payment before removing it or undoing its import.".into());
    }
    Ok(())
}
pub(super) fn protect_entry(conn: &Connection, i: &EntryInput) -> Result<()> {
    if protect_delete(conn, &i.id).is_ok() {
        return Ok(());
    }
    let same:bool=conn.query_row("SELECT kind=?2 AND date=?3 AND amount_cents=?4 AND payer=?5 AND category_id IS ?6 AND account_id IS ?7 AND split_mode=?8 AND split_value=?9 FROM events WHERE id=?1",params![i.id,i.kind,i.date,money::cents(&i.amount)?,i.payer,i.category_id,i.account_id,i.split_mode,i.split_value],|r|r.get(0)).map_err(err)?;
    if !same {
        return Err("This expense pays a bill. Unlink its bill payments before changing financial fields. Description and notes remain editable.".into());
    }
    Ok(())
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    for t in templates(conn)? {
        date(&t.first_due)?;
        if let Some(end) = &t.end_date {
            date(end)?;
            if end < &t.first_due {
                return Err("Backup bill schedule dates are invalid.".into());
            }
        }
        check_plan(conn, &t.plan)?;
    }
    let mut stmt = conn
        .prepare("SELECT id FROM bill_occurrences")
        .map_err(err)?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for id in ids {
        let o = occurrence(conn, &id)?;
        validate_month(&o.period)?;
        date(&o.due_date)?;
        check_plan(conn, &o.plan)?;
        if o.remaining_cents < 0
            || (o.cancelled && o.paid_cents > 0)
            || o.actual_cents.is_some_and(|c| c > money::MAX_CENTS)
        {
            return Err("Backup bill payment totals are inconsistent.".into());
        }
        for payment in o.payments {
            let payer: String = conn
                .query_row(
                    "SELECT payer FROM events WHERE id=?1",
                    [payment.event_id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if payer != o.plan.details.payer {
                return Err("Backup bill payments have inconsistent payers.".into());
            }
        }
    }
    let bad:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM bill_payments p JOIN events e ON e.id=p.event_id WHERE e.kind NOT IN ('expense','debt_payment') OR e.amount_cents<(SELECT SUM(x.amount_cents) FROM bill_payments x WHERE x.event_id=e.id))",[],|r|r.get(0)).map_err(err)?;
    if bad {
        return Err("Backup bill payments exceed their transactions.".into());
    }
    // Force required recovery tables to be present even when there are no occurrences.
    conn.prepare("SELECT id,event_id,payload_json FROM bill_receipts LIMIT 0")
        .map_err(err)?;
    conn.prepare("SELECT occurrence_id,source_id FROM bill_evidence LIMIT 0")
        .map_err(err)?;
    Ok(())
}
