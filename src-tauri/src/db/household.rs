use super::*;
use chrono::Datelike;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpeningInput {
    pub revision: i64,
    pub date: String,
    pub amount: String,
    pub note: String,
    pub reconciled: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opening {
    pub revision: i64,
    pub date: String,
    pub amount_cents: i64,
    pub note: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub id: String,
    pub revision: i64,
    pub date: String,
    pub description: String,
    pub amount_cents: i64,
    pub available_cents: i64,
}
fn actual_date(s: &str) -> Result<()> {
    let d = NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "Choose a valid date.")?;
    if s.len() != 10 || !(1900..=2100).contains(&d.year()) || d > Local::now().date_naive() {
        return Err("Use an actual date from 1900 through today.".into());
    }
    Ok(())
}
fn decimal(cents: i64) -> String {
    format!("{}.{:02}", cents / 100, cents % 100)
}
pub(super) fn opening_cents(conn: &Connection) -> Result<i64> {
    conn.query_row(
        "SELECT COALESCE((SELECT amount_cents FROM household_opening WHERE id=1),0)",
        [],
        |r| r.get(0),
    )
    .map_err(err)
}
pub(super) fn check_date(conn: &Connection, date: &str, delta: i64) -> Result<()> {
    if delta != 0
        && conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM household_opening WHERE date>=?1)",
                [date],
                |r| r.get::<_, bool>(0),
            )
            .map_err(err)?
    {
        return Err("Shared activity must be after the opening balance date. Reconcile the opening balance before adding older activity.".into());
    }
    Ok(())
}
impl Store {
    pub fn household_opening(&self) -> Result<Option<Opening>> {
        self.conn
            .query_row(
                "SELECT revision,date,amount_cents,note FROM household_opening WHERE id=1",
                [],
                |r| {
                    Ok(Opening {
                        revision: r.get(0)?,
                        date: r.get(1)?,
                        amount_cents: r.get(2)?,
                        note: r.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(err)
    }
    pub fn save_household_opening(&mut self, input: OpeningInput) -> Result<()> {
        actual_date(&input.date)?;
        if !input.reconciled || input.note.len() > 2000 {
            return Err(
                "Confirm one reconciled opening balance and keep its note under 2,000 characters."
                    .into(),
            );
        }
        let value = input.amount.trim();
        let negative = value.starts_with('-');
        let amount = money::cents(if negative { &value[1..] } else { value })?
            * if negative { -1 } else { 1 };
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let revision: i64 = tx
            .query_row(
                "SELECT COALESCE((SELECT revision FROM household_opening WHERE id=1),0)",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if revision != input.revision {
            return Err("The opening balance changed. Reload before saving.".into());
        }
        if tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM events WHERE household_delta_cents!=0 AND date<=?1)",
                [&input.date],
                |r| r.get::<_, bool>(0),
            )
            .map_err(err)?
        {
            return Err("Choose an opening date before all recorded shared activity to avoid counting history twice.".into());
        }
        tx.execute("INSERT INTO household_opening VALUES (1,?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,date=excluded.date,amount_cents=excluded.amount_cents,note=excluded.note",params![revision+1,input.date,amount,input.note]).map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('household_opening',?1)",
            [serde_json::to_string(&input).map_err(err)?],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
    pub fn paypal_receipts(&self, editing: Option<&str>) -> Result<Vec<Receipt>> {
        let mut stmt=self.conn.prepare("SELECT e.id,e.revision,e.date,e.description,e.amount_cents,e.amount_cents-COALESCE((SELECT SUM(p.amount_cents) FROM paypal_allocations p WHERE p.receipt_id=e.id AND (?1 IS NULL OR p.cashout_id!=?1)),0) FROM events e WHERE e.kind='settlement' AND e.payer='chelsea' AND e.account_id IS NULL ORDER BY e.date,e.rowid").map_err(err)?;
        let result = stmt
            .query_map([editing], |r| {
                Ok(Receipt {
                    id: r.get(0)?,
                    revision: r.get(1)?,
                    date: r.get(2)?,
                    description: r.get(3)?,
                    amount_cents: r.get(4)?,
                    available_cents: r.get(5)?,
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err);
        result
    }
}
pub(super) fn protect_receipt(conn: &Connection, input: &EntryInput) -> Result<()> {
    let linked: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM paypal_allocations WHERE receipt_id=?1)",
            [&input.id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if linked {
        let same:bool=conn.query_row("SELECT kind=?2 AND amount_cents=?3 AND payer=?4 AND account_id IS ?5 AND date=?6 FROM events WHERE id=?1",params![input.id,input.kind,money::cents(&input.amount)?,input.payer,input.account_id,input.date],|r|r.get(0)).map_err(err)?;
        if !same {
            return Err("This PayPal receipt is allocated to cash-outs. Remove those allocations before changing its amount, date, payer or account.".into());
        }
    }
    Ok(())
}
pub(super) fn protect_delete(conn: &Connection, id: &str) -> Result<()> {
    if conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM paypal_allocations WHERE receipt_id=?1)",
            [id],
            |r| r.get::<_, bool>(0),
        )
        .map_err(err)?
    {
        return Err("This PayPal receipt has cash-out allocations. Remove them before deleting or undoing the receipt.".into());
    }
    Ok(())
}
fn check_breakdown(
    conn: &Connection,
    input: &EntryInput,
    revision_check: bool,
) -> Result<(i64, i64)> {
    actual_date(&input.date)?;
    let p = input
        .paypal
        .as_ref()
        .ok_or("Provide the PayPal cash-out breakdown.")?;
    if p.receipts.len() > 100 || p.other_note.len() > 2000 {
        return Err("Use up to 100 receipts and an explanation under 2,000 characters.".into());
    }
    let fee = money::cents(&p.fee)?;
    let other = money::cents(&p.other)?;
    if other > 0 && p.other_note.trim().is_empty() {
        return Err("Explain the other PayPal funds. A cash-out is not new income; record their original source separately when needed.".into());
    }
    if fee == 0 && p.fee_category_id.is_some() {
        return Err("A fee category requires an actual PayPal fee.".into());
    }
    let mut sum = 0i64;
    let mut seen = HashSet::new();
    for a in &p.receipts {
        if !seen.insert(&a.id) {
            return Err("A PayPal receipt was selected twice.".into());
        }
        let (revision,date,total):(i64,String,i64)=conn.query_row("SELECT revision,date,amount_cents FROM events WHERE id=?1 AND kind='settlement' AND payer='chelsea' AND account_id IS NULL",[&a.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"Choose a received Chelsea repayment still held in PayPal.")?;
        if revision_check && revision != a.revision {
            return Err("A PayPal receipt changed. Refresh the available receipts.".into());
        }
        if date > input.date {
            return Err("A cash-out cannot use a receipt received after its deposit date.".into());
        }
        let used:i64=conn.query_row("SELECT COALESCE(SUM(amount_cents),0) FROM paypal_allocations WHERE receipt_id=?1 AND cashout_id!=?2",params![a.id,input.id],|r|r.get(0)).map_err(err)?;
        let cents = money::cents(&a.amount)?;
        if cents == 0 || cents > total - used {
            return Err("Receipt allocations must be positive and cannot exceed the amount still held in PayPal.".into());
        }
        sum += cents;
    }
    if sum + other != money::cents(&input.amount)? + fee {
        return Err(
            "Receipts plus other funds must equal the bank deposit plus the PayPal fee.".into(),
        );
    }
    Ok((fee, other))
}
pub(super) fn cashout_lines(conn: &Connection, input: &EntryInput) -> Result<Vec<EntryLine>> {
    let (fee, _) = check_breakdown(conn, input, true)?;
    if fee == 0 {
        return Ok(vec![]);
    }
    let category = input
        .paypal
        .as_ref()
        .and_then(|p| p.fee_category_id.clone())
        .ok_or("Choose the category for the actual PayPal fee.")?;
    let allocated = vec![EntryLine {
        id: "paypal-fee".into(),
        label: "PayPal cash-out fee".into(),
        category_id: category,
        amount_cents: fee,
        split_mode: "personal".into(),
        split_value: String::new(),
        jacob_cents: fee,
        chelsea_cents: 0,
        original_line_id: None,
    }];
    lines::categories(conn, &allocated, &lines::read(conn, &input.id)?)?;
    Ok(allocated)
}
pub(super) fn write_cashout(conn: &Connection, input: &EntryInput) -> Result<()> {
    if input.kind != "paypal_cashout" {
        return Ok(());
    }
    let p = input.paypal.as_ref().ok_or("Missing PayPal breakdown.")?;
    conn.execute("INSERT INTO paypal_cashouts VALUES (?1,?2,?3,?4) ON CONFLICT(event_id) DO UPDATE SET fee_cents=excluded.fee_cents,other_cents=excluded.other_cents,other_note=excluded.other_note",params![input.id,money::cents(&p.fee)?,money::cents(&p.other)?,p.other_note]).map_err(err)?;
    conn.execute(
        "DELETE FROM paypal_allocations WHERE cashout_id=?1",
        [&input.id],
    )
    .map_err(err)?;
    for a in &p.receipts {
        conn.execute(
            "INSERT INTO paypal_allocations VALUES (?1,?2,?3)",
            params![input.id, a.id, money::cents(&a.amount)?],
        )
        .map_err(err)?;
    }
    Ok(())
}
pub(super) fn read_cashout(conn: &Connection, id: &str) -> Result<Option<PayPalInput>> {
    let detail:Option<(i64,i64,String,Option<String>)>=conn.query_row("SELECT p.fee_cents,p.other_cents,p.other_note,e.category_id FROM paypal_cashouts p JOIN events e ON e.id=p.event_id WHERE p.event_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(err)?;
    let Some((fee, other, other_note, category)) = detail else {
        return Ok(None);
    };
    let mut stmt=conn.prepare("SELECT p.receipt_id,e.revision,p.amount_cents FROM paypal_allocations p JOIN events e ON e.id=p.receipt_id WHERE p.cashout_id=?1 ORDER BY e.date,e.rowid").map_err(err)?;
    let receipts = stmt
        .query_map([id], |r| {
            Ok(ReceiptInput {
                id: r.get(0)?,
                revision: r.get(1)?,
                amount: decimal(r.get(2)?),
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(Some(PayPalInput {
        receipts,
        fee: decimal(fee),
        fee_category_id: category,
        other: decimal(other),
        other_note,
    }))
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    for q in [
        "SELECT revision,date,amount_cents,note FROM household_opening LIMIT 0",
        "SELECT event_id,fee_cents,other_cents,other_note FROM paypal_cashouts LIMIT 0",
        "SELECT cashout_id,receipt_id,amount_cents FROM paypal_allocations LIMIT 0",
    ] {
        conn.prepare(q).map_err(err)?;
    }
    let opening: Option<(String, i64, String)> = conn
        .query_row(
            "SELECT date,amount_cents,note FROM household_opening WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((date, cents, note)) = opening {
        actual_date(&date)?;
        money::cents(&decimal(
            cents.checked_abs().ok_or("Invalid opening balance.")?,
        ))?;
        if note.len()>2000 || conn.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE household_delta_cents!=0 AND date<=?1)",[date],|r|r.get::<_,bool>(0)).map_err(err)? {return Err("Opening shared balance overlaps recorded history.".into());}
    }
    let bad:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM events e LEFT JOIN paypal_cashouts p ON p.event_id=e.id WHERE (e.kind='paypal_cashout' AND (p.event_id IS NULL OR e.payer!='jacob' OR e.account_id IS NULL OR (SELECT kind FROM accounts WHERE id=e.account_id) NOT IN ('checking','savings') OR e.jacob_cents!=p.fee_cents OR e.chelsea_cents!=0 OR e.household_delta_cents!=0 OR e.split_mode!='none' OR e.split_value!='')) OR (e.kind!='paypal_cashout' AND p.event_id IS NOT NULL))",[],|r|r.get(0)).map_err(err)?;
    if bad {
        return Err("PayPal cash-out records do not match their financial events.".into());
    }
    let mut stmt=conn.prepare("SELECT id,revision,date,description,amount_cents,account_id,category_id,note FROM events WHERE kind='paypal_cashout'").map_err(err)?;
    let entries = stmt
        .query_map([], |r| {
            Ok(EntryInput {
                budget_override: None,
                id: r.get(0)?,
                revision: r.get(1)?,
                kind: "paypal_cashout".into(),
                date: r.get(2)?,
                description: r.get(3)?,
                amount: decimal(r.get(4)?),
                payer: "jacob".into(),
                account_id: r.get(5)?,
                category_id: r.get(6)?,
                destination_account_id: None,
                split_mode: "none".into(),
                split_value: String::new(),
                note: r.get(7)?,
                original_event_id: None,
                lines: vec![],
                paypal: None,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for mut e in entries {
        e.paypal = read_cashout(conn, &e.id)?;
        check_breakdown(conn, &e, false)?;
        if cashout_lines(conn, &e)? != lines::read(conn, &e.id)? {
            return Err("PayPal fee allocations do not reconcile.".into());
        }
    }
    Ok(())
}
