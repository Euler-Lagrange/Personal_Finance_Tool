use super::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Carry {
    pub month: String,
    pub amount_cents: i64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Allocation {
    pub month: String,
    pub amount: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Obligation {
    pub month: String,
    pub revision: i64,
    pub closing_date: String,
    pub due_date: String,
    pub base_cents: Option<i64>,
    pub carried_cents: i64,
    pub new_cents: Option<i64>,
    pub paid_cents: i64,
    pub credit_cents: i64,
    pub remaining_cents: Option<i64>,
    pub carried_remaining_cents: i64,
    pub statement_remaining_cents: Option<i64>,
    pub proposed_carry: Vec<Carry>,
    pub proposed_base_cents: Option<i64>,
    pub proposed_new_cents: Option<i64>,
    pub needs_review: bool,
    pub can_review: bool,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
    pub note: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: String,
    pub revision: i64,
    pub review_revision: i64,
    pub description: String,
    pub kind: String,
    pub card_date: String,
    pub bank_date: Option<String>,
    pub date_assumed: bool,
    pub amount_cents: i64,
    pub allocations: Vec<Carry>,
    pub note: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub account_id: String,
    pub obligations: Vec<Obligation>,
    pub payments: Vec<Payment>,
    pub token: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObligationInput {
    pub account_id: String,
    pub month: String,
    pub revision: i64,
    pub token: String,
    pub note: String,
    pub confirmed: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    pub account_id: String,
    pub event_id: String,
    pub event_revision: i64,
    pub revision: i64,
    pub token: String,
    pub allocations: Vec<Allocation>,
    pub note: String,
    pub confirmed: bool,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
struct Stamp {
    kind: String,
    date: String,
    amount: i64,
    account: Option<String>,
    destination: Option<String>,
    dates: Vec<(String, String)>,
}
#[derive(Serialize)]
struct Saved {
    revision: i64,
    base: i64,
    carry: Vec<Carry>,
    source_hash: String,
    note: String,
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn hash<T: Serialize>(v: &T) -> Result<String> {
    Ok(crate::imports::parse::hash(json(v)?.as_bytes()))
}
fn sum(mut values: impl Iterator<Item = i64>) -> Result<i64> {
    values.try_fold(0i64, |a, b| {
        if !(0..=money::MAX_CENTS).contains(&b) {
            return Err("Invalid card allocation amount.".into());
        }
        a.checked_add(b)
            .filter(|v| *v <= money::MAX_CENTS)
            .ok_or_else(|| "Card allocation exceeds supported range.".into())
    })
}
fn amount(s: &str) -> Result<i64> {
    if let Some(s) = s.trim().strip_prefix('-') {
        Ok(-money::cents(s)?)
    } else {
        money::cents(s)
    }
}
fn check_note(s: &str) -> Result<()> {
    if s.trim().is_empty() || s.len() > 2000 {
        return Err("Add a review note or issuer reference, up to 2,000 characters.".into());
    }
    Ok(())
}
fn saved(conn: &Connection, account: &str, month: &str) -> Result<Option<Saved>> {
    let raw: Option<(i64,i64,String,String,String)>=conn.query_row("SELECT revision,base_cents,carry_json,source_hash,note FROM card_obligations WHERE account_id=?1 AND month=?2",params![account,month],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(err)?;
    raw.map(|(revision, base, c, h, n)| {
        if !(-money::MAX_CENTS..=money::MAX_CENTS).contains(&base) {
            return Err("Statement balance exceeds the supported limit.".into());
        }
        Ok(Saved {
            revision,
            base,
            carry: serde_json::from_str(&c).map_err(err)?,
            source_hash: h,
            note: n,
        })
    })
    .transpose()
}
fn stamp(conn: &Connection, id: &str) -> Result<Stamp> {
    let (kind,date,amount,account,destination)=conn.query_row("SELECT kind,date,amount_cents,account_id,destination_account_id FROM events WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|_|"Payment or credit no longer exists.")?;
    let mut q=conn.prepare("SELECT account_id,date FROM effective_activity_dates WHERE event_id=?1 ORDER BY account_id").map_err(err)?;
    let dates = q
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(Stamp {
        kind,
        date,
        amount,
        account,
        destination,
        dates,
    })
}
fn allocations(conn: &Connection, event: &str) -> Result<Vec<Carry>> {
    let mut q=conn.prepare("SELECT month,amount_cents FROM card_payment_allocations WHERE event_id=?1 ORDER BY month").map_err(err)?;
    let result = q
        .query_map([event], |r| {
            Ok(Carry {
                month: r.get(0)?,
                amount_cents: r.get(1)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err);
    result
}
fn payments(conn: &Connection, account: &str) -> Result<Vec<Payment>> {
    let mut q=conn.prepare("SELECT e.id,e.revision,e.description,COALESCE(p.revision,0),COALESCE(p.note,'') FROM events e LEFT JOIN card_payment_reviews p ON p.event_id=e.id WHERE ((e.kind='card_payment' AND e.destination_account_id=?1) OR (e.kind IN ('refund','reward') AND e.account_id=?1)) AND NOT EXISTS(SELECT 1 FROM pending_activity x WHERE x.event_id=e.id) ORDER BY e.date,e.id").map_err(err)?;
    let rows = q
        .query_map([account], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    rows.into_iter().map(|(id,revision,description,review_revision,note)| {
        let s=stamp(conn,&id)?;
        let card_date=s.dates.iter().find(|(a,_)|a==account).map(|(_,d)|d.clone()).ok_or("Missing card activity date.")?;
        let bank_date=if s.kind=="card_payment" {s.dates.iter().find(|(a,_)|Some(a)==s.account.as_ref()).map(|(_,d)|d.clone())} else {None};
        let verified:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM activity_dates WHERE event_id=?1 AND account_id=?2) OR (SELECT count(DISTINCT p.date)=1 FROM import_account_dates p JOIN import_rows r ON r.id=p.row_id JOIN import_sources s ON s.id=r.source_id WHERE r.event_id=?1 AND s.account_id=?2 AND r.disposition='linked')",params![id,account],|r|r.get(0)).map_err(err)?;
        let a=allocations(conn,&id)?;
        Ok(Payment {id,revision,review_revision,description,kind:s.kind,card_date,bank_date,date_assumed:!verified,amount_cents:s.amount,allocations:a,note})
    }).collect()
}
fn financial(d: &card_statements::Draft) -> Result<String> {
    hash(&(
        &d.closing_date,
        &d.due_date,
        &d.date_basis,
        d.dates_confirmed,
        d.balance.as_deref().map(amount).transpose()?,
    ))
}
fn source_hash(d: &card_statements::Draft, c: &card_statements::Calculation) -> Result<String> {
    hash(&(
        financial(d)?,
        if d.balance.is_none() { Some(c) } else { None },
    ))
}
fn paid(payments: &[Payment], month: &str, through: Option<&str>, credit: bool) -> Result<i64> {
    sum(payments
        .iter()
        .filter(|p| {
            (p.kind != "card_payment") == credit
                && through.is_none_or(|t| p.card_date.as_str() <= t)
        })
        .flat_map(|p| p.allocations.iter())
        .filter(|a| a.month == month)
        .map(|a| a.amount_cents))
}
fn view(conn: &Connection, account: &str) -> Result<View> {
    let card: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE id=?1 AND kind='credit')",
            [account],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !card {
        return Err("Choose an existing credit card.".into());
    }
    let payments = payments(conn, account)?;
    let mut q=conn.prepare("SELECT month FROM card_statements WHERE account_id=?1 ORDER BY json_extract(input_json,'$.closingDate'),month").map_err(err)?;
    let months = q
        .query_map([account], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let mut obligations: Vec<Obligation> = Vec::new();
    for month in months {
        let (d, c) =
            card_statements::stored(conn, account, &month)?.ok_or("Statement no longer exists.")?;
        let old = saved(conn, account, &month)?;
        let base = d
            .balance
            .as_deref()
            .map(amount)
            .transpose()?
            .or(c.balance_cents);
        let mut blockers = Vec::new();
        let mut warnings = Vec::new();
        let mut proposed = Vec::new();
        if !d.dates_confirmed {
            blockers.push(
                "Confirm the issuer's closing and due dates in the statement review first.".into(),
            );
        }
        if d.closing_date > Local::now().format("%Y-%m-%d").to_string() {
            blockers.push("This cycle has not closed yet.".into());
        }
        if base.is_none() {
            blockers
                .push("Confirm an issuer balance or establish a calculated balance first.".into());
        }
        if d.balance.is_none() {
            warnings.push("Uses the calculated balance from the saved statement review.".into());
            warnings.extend(c.warnings.clone());
            let current = card_statements::calculate(conn, &d)?;
            if hash(&current)? != hash(&c)? {
                blockers.push(
                    "Calculation changed. Review and save this statement again first.".into(),
                );
            }
        }
        for prior in &obligations {
            if prior.closing_date == d.closing_date {
                blockers.push(
                    "Two tracked statements have the same cutoff. Correct the cycle dates first."
                        .into(),
                );
            }
            if prior.revision == 0 || prior.needs_review {
                blockers.push(format!(
                    "Review the earlier {} obligation first.",
                    prior.month
                ));
            }
            if let Some(new) = prior.new_cents {
                let consumed = paid(&payments, &prior.month, Some(&d.closing_date), false)?
                    + paid(&payments, &prior.month, Some(&d.closing_date), true)?;
                let remaining = new - consumed;
                if remaining > 0 {
                    proposed.push(Carry {
                        month: prior.month.clone(),
                        amount_cents: remaining,
                    });
                }
            }
        }
        let carry = sum(proposed.iter().map(|c| c.amount_cents))?;
        let proposed_new = base.map(|b| b.max(0) - carry);
        if proposed_new.is_some_and(|v| v < 0) {
            blockers.push("Earlier unpaid obligations exceed this statement balance. Reconcile their payments and credit treatment first.".into());
        }
        let paid_cents = paid(&payments, &month, None, false)?;
        let credit_cents = paid(&payments, &month, None, true)?;
        if proposed_new.is_some_and(|v| v < paid_cents + credit_cents) {
            blockers.push("Existing allocations exceed the revised new obligation. Reduce those allocations before reviewing again.".into());
        }
        let unreviewed = payments
            .iter()
            .filter(|p| {
                p.kind != "card_payment" && p.review_revision == 0 && p.card_date > d.closing_date
            })
            .count();
        if unreviewed > 0 {
            warnings.push(format!(
                "{unreviewed} post-close credits need an explicit payment-treatment review."
            ));
        }
        let current_hash = source_hash(&d, &c)?;
        let needs_review = old
            .as_ref()
            .is_none_or(|s| s.source_hash != current_hash || s.carry != proposed)
            || !blockers.is_empty();
        let current_carry = old.as_ref().map(|s| &s.carry).unwrap_or(&proposed);
        let carried_remaining_cents = sum(current_carry.iter().map(|c| {
            let remaining = obligations
                .iter()
                .find(|o| o.month == c.month)
                .and_then(|o| o.remaining_cents)
                .unwrap_or(0)
                .max(0);
            c.amount_cents.min(remaining)
        }))?;
        let (revision, stored_base, carried_cents, new_cents, note) = if let Some(s) = old {
            let carried = sum(s.carry.iter().map(|c| c.amount_cents))?;
            (
                s.revision,
                Some(s.base),
                carried,
                Some(s.base.max(0) - carried),
                s.note,
            )
        } else {
            (0, base, carry, proposed_new, String::new())
        };
        let remaining_cents = new_cents.map(|n| n - paid_cents - credit_cents);
        let statement_remaining_cents = if needs_review {
            None
        } else {
            remaining_cents.map(|n| n + carried_remaining_cents)
        };
        obligations.push(Obligation {
            month,
            revision,
            closing_date: d.closing_date,
            due_date: d.due_date,
            base_cents: stored_base,
            carried_cents,
            new_cents,
            paid_cents,
            credit_cents,
            remaining_cents,
            carried_remaining_cents,
            statement_remaining_cents,
            proposed_carry: proposed,
            proposed_base_cents: base,
            proposed_new_cents: proposed_new,
            needs_review,
            can_review: blockers.is_empty(),
            blockers,
            warnings,
            note,
        });
    }
    let mut v = View {
        account_id: account.into(),
        obligations,
        payments,
        token: String::new(),
    };
    v.token = hash(&v)?;
    Ok(v)
}
fn retry(conn: &Connection, id: &str, h: &str) -> Result<bool> {
    Uuid::parse_str(id).map_err(|_| "Invalid card allocation operation.")?;
    let old: Option<String> = conn
        .query_row(
            "SELECT payload_hash FROM card_payment_receipts WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(old) = old {
        if old != h {
            return Err("This operation was used for different card changes.".into());
        }
        return Ok(true);
    }
    Ok(false)
}
fn receipt<T: Serialize>(
    conn: &Connection,
    id: &str,
    h: &str,
    action: &str,
    input: &T,
) -> Result<()> {
    conn.execute(
        "INSERT INTO card_payment_receipts VALUES (?1,?2)",
        params![id, h],
    )
    .map_err(err)?;
    conn.execute(
        "INSERT INTO audit(action,payload) VALUES (?1,?2)",
        params![action, json(&(id, input))?],
    )
    .map_err(err)?;
    Ok(())
}
fn token(v: &View, expected: &str) -> Result<()> {
    if v.token != expected {
        return Err("Card records changed. Reload and review the allocations again.".into());
    }
    Ok(())
}
impl Store {
    pub fn card_payment_view(&self, account: &str) -> Result<View> {
        view(&self.conn, account)
    }
    pub fn save_card_obligation(&mut self, operation: &str, input: ObligationInput) -> Result<()> {
        let h = hash(&("obligation", &input))?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        check_note(&input.note)?;
        if !input.confirmed {
            return Err("Confirm that carried balances are included in this statement.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if retry(&tx, operation, &h)? {
            return Ok(());
        }
        let v = view(&tx, &input.account_id)?;
        token(&v, &input.token)?;
        let o = v
            .obligations
            .iter()
            .find(|o| o.month == input.month)
            .ok_or("Save this statement review first.")?;
        if o.revision != input.revision || !o.can_review {
            return Err("Resolve the earlier obligations or statement warnings before confirming this obligation.".into());
        }
        let (d, c) = card_statements::stored(&tx, &input.account_id, &input.month)?
            .ok_or("Missing statement.")?;
        let base = d
            .balance
            .as_deref()
            .map(amount)
            .transpose()?
            .or(c.balance_cents)
            .ok_or("Unknown statement balance.")?;
        if !(-money::MAX_CENTS..=money::MAX_CENTS).contains(&base) {
            return Err("Statement balance exceeds the supported limit.".into());
        }
        tx.execute("INSERT INTO card_obligations VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(account_id,month) DO UPDATE SET revision=excluded.revision,base_cents=excluded.base_cents,carry_json=excluded.carry_json,source_hash=excluded.source_hash,note=excluded.note",params![input.account_id,input.month,input.revision+1,base,json(&o.proposed_carry)?,source_hash(&d,&c)?,input.note]).map_err(err)?;
        receipt(
            &tx,
            operation,
            &h,
            "card_obligation_review",
            &serde_json::json!({"request": &input, "baseCents": base, "carried": &o.proposed_carry, "newCents": o.proposed_new_cents, "sourceHash": source_hash(&d,&c)?}),
        )?;
        periods::commit(tx)
    }
    pub fn clear_card_obligation(&mut self, operation: &str, input: ObligationInput) -> Result<()> {
        let h = hash(&("clear_obligation", &input))?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        check_note(&input.note)?;
        if !input.confirmed {
            return Err("Confirm removal of this obligation review.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if retry(&tx, operation, &h)? {
            return Ok(());
        }
        let v = view(&tx, &input.account_id)?;
        token(&v, &input.token)?;
        let used:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM card_payment_allocations WHERE account_id=?1 AND month=?2)",params![input.account_id,input.month],|r|r.get(0)).map_err(err)?;
        if used {
            return Err("Remove this statement's payment and credit allocations first.".into());
        }
        for o in &v.obligations {
            if let Some(s) = saved(&tx, &input.account_id, &o.month)? {
                if s.carry.iter().any(|c| c.month == input.month) {
                    return Err(format!(
                        "Clear the {} obligation review first; it carries this debt.",
                        o.month
                    ));
                }
            }
        }
        let prior = saved(&tx, &input.account_id, &input.month)?;
        if tx
            .execute(
                "DELETE FROM card_obligations WHERE account_id=?1 AND month=?2 AND revision=?3",
                params![input.account_id, input.month, input.revision],
            )
            .map_err(err)?
            != 1
        {
            return Err("Obligation changed. Reload before clearing it.".into());
        }
        receipt(
            &tx,
            operation,
            &h,
            "card_obligation_clear",
            &(&input, prior),
        )?;
        periods::commit(tx)
    }
    pub fn save_card_payment_review(&mut self, operation: &str, input: PaymentInput) -> Result<()> {
        let h = hash(&("payment", &input))?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        check_note(&input.note)?;
        if !input.confirmed {
            return Err(
                "Review the account posting date and how this payment or credit applies.".into(),
            );
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if retry(&tx, operation, &h)? {
            return Ok(());
        }
        let v = view(&tx, &input.account_id)?;
        token(&v, &input.token)?;
        let p = v
            .payments
            .iter()
            .find(|p| p.id == input.event_id)
            .ok_or("Choose a completed payment or identified credit for this card.")?;
        if p.revision != input.event_revision || p.review_revision != input.revision {
            return Err("Payment or review changed. Reload before saving.".into());
        }
        if p.card_date > Local::now().format("%Y-%m-%d").to_string() {
            return Err("Future card activity cannot pay a statement.".into());
        }
        let mut seen = HashSet::new();
        let mut parsed = Vec::new();
        for a in &input.allocations {
            let n = money::cents(&a.amount)?;
            if n == 0 || !seen.insert(&a.month) {
                return Err("Use one positive allocation per statement.".into());
            }
            let o = v
                .obligations
                .iter()
                .find(|o| o.month == a.month && o.revision > 0)
                .ok_or("Review the statement obligation before allocating money.")?;
            let old = p
                .allocations
                .iter()
                .find(|v| v.month == a.month)
                .map(|v| v.amount_cents)
                .unwrap_or(0);
            if p.card_date <= o.closing_date {
                return Err("This activity is already included at the statement cutoff; it cannot pay that statement again.".into());
            }
            if o.needs_review && n > old {
                return Err("Review this obligation's changed statement or carry before adding allocations.".into());
            }
            if n > o.remaining_cents.unwrap_or(0) + old {
                return Err("Allocation exceeds this statement's remaining new obligation.".into());
            }
            parsed.push(Carry {
                month: a.month.clone(),
                amount_cents: n,
            });
        }
        if sum(parsed.iter().map(|a| a.amount_cents))? > p.amount_cents {
            return Err("Allocations exceed the actual payment or credit.".into());
        }
        tx.execute("INSERT INTO card_payment_reviews VALUES (?1,?2,?3,?4) ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision,stamp_json=excluded.stamp_json,note=excluded.note",params![p.id,p.review_revision+1,json(&stamp(&tx,&p.id)?)?,input.note]).map_err(err)?;
        tx.execute(
            "DELETE FROM card_payment_allocations WHERE event_id=?1",
            [&p.id],
        )
        .map_err(err)?;
        for a in parsed {
            tx.execute(
                "INSERT INTO card_payment_allocations VALUES (?1,?2,?3,?4)",
                params![p.id, input.account_id, a.month, a.amount_cents],
            )
            .map_err(err)?;
        }
        receipt(
            &tx,
            operation,
            &h,
            "card_payment_review",
            &serde_json::json!({"request": &input, "stamp": stamp(&tx,&p.id)?}),
        )?;
        periods::commit(tx)
    }
    pub fn clear_card_payment_review(
        &mut self,
        operation: &str,
        input: PaymentInput,
    ) -> Result<()> {
        let h = hash(&("clear_payment", &input))?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        check_note(&input.note)?;
        if !input.confirmed || !input.allocations.is_empty() {
            return Err("Confirm clearing this review and all its allocations.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if retry(&tx, operation, &h)? {
            return Ok(());
        }
        let v = view(&tx, &input.account_id)?;
        token(&v, &input.token)?;
        let p = v
            .payments
            .iter()
            .find(|p| p.id == input.event_id)
            .ok_or("Payment no longer exists.")?;
        if p.revision != input.event_revision
            || p.review_revision != input.revision
            || input.revision == 0
        {
            return Err("Payment review changed. Reload before clearing.".into());
        }
        tx.execute(
            "DELETE FROM card_payment_reviews WHERE event_id=?1",
            [&p.id],
        )
        .map_err(err)?;
        receipt(&tx, operation, &h, "card_payment_clear", &(&input, p))?;
        periods::commit(tx)
    }
}
pub(super) fn protect_statement(conn: &Connection, d: &card_statements::Draft) -> Result<()> {
    if saved(conn, &d.account_id, &d.month)?.is_some() {
        let (old, _) = card_statements::stored(conn, &d.account_id, &d.month)?
            .ok_or("Missing saved statement.")?;
        if financial(&old)? != financial(d)? {
            return Err("Clear this statement's obligation review and dependent allocations before changing its dates or issuer amount. Notes and evidence remain editable.".into());
        }
    }
    Ok(())
}
pub(super) fn protect_delete(conn: &Connection, id: &str) -> Result<()> {
    let used: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM card_payment_reviews WHERE event_id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if used {
        return Err("Clear this transaction's statement payment/credit review before removing it or undoing its import.".into());
    }
    Ok(())
}
// Run at the common write boundary: late source links/undo can change effective dates too.
pub(super) fn protect_dates(conn: &Connection) -> Result<()> {
    let mut q = conn
        .prepare("SELECT event_id,stamp_json FROM card_payment_reviews")
        .map_err(err)?;
    let rows = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, s) in rows {
        let prior: Stamp = serde_json::from_str(&s).map_err(err)?;
        if stamp(conn, &id)? != prior {
            return Err("Clear this transaction's statement payment/credit review before changing its money, accounts or account dates. Description and notes remain editable.".into());
        }
    }
    Ok(())
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    protect_dates(conn)?;
    let mut q=conn.prepare("SELECT DISTINCT account_id FROM card_obligations UNION SELECT DISTINCT account_id FROM card_payment_allocations").map_err(err)?;
    let accounts = q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for account in accounts {
        let v = view(conn, &account)?;
        for o in &v.obligations {
            if let Some(s) = saved(conn, &account, &o.month)? {
                check_note(&s.note)?;
                if s.revision < 1
                    || !(-money::MAX_CENTS..=money::MAX_CENTS).contains(&s.base)
                    || o.new_cents.is_none_or(|v| v < 0)
                    || o.remaining_cents.is_none_or(|v| v < 0)
                    || s.source_hash.len() != 64
                    || !s.source_hash.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err("Invalid statement obligation history.".into());
                }
                let mut seen = HashSet::new();
                for c in s.carry {
                    let prior = v
                        .obligations
                        .iter()
                        .find(|p| p.month == c.month && p.revision > 0)
                        .ok_or("Missing carried obligation.")?;
                    if c.amount_cents <= 0
                        || c.amount_cents > money::MAX_CENTS
                        || prior.closing_date >= o.closing_date
                        || !seen.insert(c.month)
                    {
                        return Err("Invalid carried statement balance.".into());
                    }
                }
            }
        }
        for p in v.payments {
            if p.review_revision > 0 {
                check_note(&p.note)?;
            }
            if sum(p.allocations.iter().map(|a| a.amount_cents))? > p.amount_cents {
                return Err("Card allocations exceed their transaction.".into());
            }
            for a in p.allocations {
                let o = v
                    .obligations
                    .iter()
                    .find(|o| o.month == a.month)
                    .ok_or("Missing statement allocation.")?;
                if p.card_date <= o.closing_date {
                    return Err("Card allocation is already included at cutoff.".into());
                }
            }
        }
    }
    let bad:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM card_payment_reviews p JOIN events e ON e.id=p.event_id WHERE e.kind NOT IN ('card_payment','refund','reward') OR NOT EXISTS(SELECT 1 FROM accounts c WHERE c.kind='credit' AND c.id=CASE WHEN e.kind='card_payment' THEN e.destination_account_id ELSE e.account_id END) OR EXISTS(SELECT 1 FROM pending_activity x WHERE x.event_id=e.id) OR p.revision<1 OR length(trim(p.note))=0 OR length(p.note)>2000) OR EXISTS(SELECT 1 FROM card_payment_allocations a JOIN events e ON e.id=a.event_id WHERE a.account_id IS NOT CASE WHEN e.kind='card_payment' THEN e.destination_account_id ELSE e.account_id END OR a.amount_cents<=0)",[],|r|r.get(0)).map_err(err)?;
    if bad {
        return Err("Invalid card payment review.".into());
    }
    let mut q = conn
        .prepare("SELECT id,payload_hash FROM card_payment_receipts")
        .map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?).map_err(err)?;
        let h: String = r.get(1).map_err(err)?;
        if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid card allocation receipt.".into());
        }
    }
    Ok(())
}
