use super::*;
use chrono::{Datelike, Duration as Days, Months};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Funding {
    pub card_id: String,
    pub checking_id: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub revision: i64,
    pub funding: Vec<Funding>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: String,
    pub date: String,
    pub name: String,
    pub source: String,
    pub amount_cents: Option<i64>,
    pub included: bool,
    pub reason: String,
    pub running_cents: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub account_id: String,
    pub as_of: String,
    pub through: String,
    pub settings: Settings,
    pub opening: card_statements::Calculation,
    pub last_observed_at: Option<String>,
    pub rows: Vec<Row>,
    pub warnings: Vec<String>,
    pub ending_known_cents: Option<i64>,
    pub lowest_known_cents: Option<i64>,
    pub next_pay_date: Option<String>,
    pub before_next_pay_cents: Option<i64>,
    pub incomplete: bool,
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn date(s: &str) -> Result<NaiveDate> {
    if s.len() != 10 || !("1900-01-01"..="2100-12-31").contains(&s) {
        return Err("Choose a supported calendar date.".into());
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(err)
}
fn add(a: i64, b: i64) -> Result<i64> {
    a.checked_add(b)
        .filter(|v| (-money::MAX_CENTS..=money::MAX_CENTS).contains(v))
        .ok_or("Forecast exceeds supported amount range.".into())
}
fn ids(conn: &Connection, sql: &str) -> Result<Vec<String>> {
    let mut q = conn.prepare(sql).map_err(err)?;
    let result = q
        .query_map([], |r| r.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(result)
}
fn settings(conn: &Connection) -> Result<Settings> {
    let raw: Option<(i64, String)> = conn
        .query_row(
            "SELECT revision,input_json FROM cash_forecast_settings WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((revision, raw)) = raw else {
        return Ok(Settings::default());
    };
    let s: Settings = serde_json::from_str(&raw).map_err(err)?;
    if s.revision != revision || revision <= 0 {
        return Err("Invalid forecast settings history.".into());
    }
    Ok(s)
}
fn check_settings(conn: &Connection, s: &Settings, previous: Option<&Settings>) -> Result<()> {
    if s.revision < 0 || s.funding.len() > 200 {
        return Err("Invalid forecast settings.".into());
    }
    let mut seen = HashSet::new();
    for f in &s.funding {
        if !seen.insert(&f.card_id) {
            return Err("Choose one funding account per card.".into());
        }
        for (id, kind) in [(&f.card_id, "credit"), (&f.checking_id, "checking")] {
            let (actual, archived): (String, bool) = conn
                .query_row(
                    "SELECT kind,archived FROM accounts WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|_| "Choose existing card and checking accounts.")?;
            if actual != kind {
                return Err("Choose a credit card and its checking payment account.".into());
            }
            if archived && previous.is_some_and(|p| !p.funding.contains(f)) {
                return Err("Choose active accounts for new funding choices.".into());
            }
        }
    }
    Ok(())
}
// Same authoritative checkpoint, posting-date and coverage calculation as statements.
fn position(conn: &Connection, account: &str, as_of: &str) -> Result<card_statements::Calculation> {
    let mut c = card_statements::calculate(
        conn,
        &card_statements::Draft {
            account_id: account.into(),
            month: as_of[..7].into(),
            revision: 0,
            closing_date: as_of.into(),
            due_date: as_of.into(),
            date_basis: "posted".into(),
            dates_confirmed: false,
            balance: None,
            note: String::new(),
            evidence_source_id: None,
        },
    )?;
    for w in &mut c.warnings {
        *w = w
            .replace("statement balance", "account balance")
            .replace("this cutoff", "this date")
            .replace("checkpoint and cutoff", "checkpoint and forecast date");
    }
    Ok(c)
}
fn months(first: NaiveDate, end: NaiveDate) -> Result<Vec<String>> {
    let mut d = first.with_day(1).ok_or("Invalid first month.")?;
    let mut result = Vec::new();
    while d <= end {
        result.push(d.format("%Y-%m").to_string());
        d = d
            .checked_add_months(Months::new(1))
            .ok_or("Forecast date is out of range.")?;
    }
    Ok(result)
}
struct PlannedBill {
    id: String,
    date: String,
    name: String,
    account: Option<String>,
    payer: String,
    amount: i64,
    merchant: String,
    kind: String,
    possible: bool,
}
fn bills_for(conn: &Connection, as_of: &str, end: &str) -> Result<Vec<PlannedBill>> {
    let mut all = Vec::new();
    let mut seen = HashSet::new();
    for id in ids(conn, "SELECT id FROM bill_occurrences")? {
        let o = bills::occurrence(conn, &id)?;
        seen.insert((o.bill_id.clone(), o.period.clone()));
        if o.cancelled || o.remaining_cents <= 0 || o.due_date.as_str() > end {
            continue;
        }
        all.push(PlannedBill {
            id: o.id,
            date: o.due_date,
            name: o.plan.details.name,
            account: o.plan.details.account_id,
            payer: o.plan.details.payer,
            amount: o.remaining_cents,
            merchant: o.plan.details.merchant,
            kind: o.plan.details.payment_kind,
            possible: false,
        });
    }
    for t in bills::templates(conn)? {
        for m in months(date(as_of)?, date(end)?)? {
            if seen.contains(&(t.id.clone(), m.clone())) {
                continue;
            }
            if let Some(d) = bills::due(&t, &m)? {
                if d.as_str() <= end {
                    all.push(PlannedBill {
                        id: format!("bill:{}:{m}", t.id),
                        date: d,
                        name: t.plan.details.name.clone(),
                        account: t.plan.details.account_id.clone(),
                        payer: t.plan.details.payer.clone(),
                        amount: t.plan.amount_cents,
                        merchant: t.plan.details.merchant.clone(),
                        kind: t.plan.details.payment_kind.clone(),
                        possible: false,
                    });
                }
            }
        }
    }
    for b in &mut all {
        // Unlinked plausible actuals are withheld, never silently matched or replayed.
        let mut q=conn.prepare("SELECT e.description FROM events e WHERE e.kind=?1 AND e.payer=?2 AND e.account_id IS ?3 AND ABS(julianday(e.date)-julianday(?4))<=7 AND e.date<=?5 AND e.amount_cents>COALESCE((SELECT SUM(p.amount_cents) FROM bill_payments p WHERE p.event_id=e.id),0)").map_err(err)?;
        let descriptions = q
            .query_map(params![b.kind, b.payer, b.account, b.date, end], |r| {
                r.get::<_, String>(0)
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        b.possible = descriptions.iter().any(|description| {
            b.merchant.is_empty() || rules::normalize(description).contains(&b.merchant)
        });
    }
    Ok(all)
}
fn row(
    id: String,
    date: String,
    name: String,
    source: &str,
    amount: Option<i64>,
    reason: &str,
) -> Row {
    Row {
        id,
        date,
        name,
        source: source.into(),
        amount_cents: amount,
        included: amount.is_some(),
        reason: reason.into(),
        running_cents: None,
    }
}
fn plan_delta(p: &cash_plans::Plan, account: &str) -> Result<Option<i64>> {
    let n = money::cents(&p.amount)?;
    Ok(if p.kind == "transfer" {
        if p.account_id.as_deref() == Some(account) {
            Some(-n)
        } else if p.destination_account_id.as_deref() == Some(account) {
            Some(n)
        } else {
            None
        }
    } else if p.account_id.as_deref() != Some(account) {
        None
    } else if p.kind == "settlement" && p.payer == "jacob" {
        Some(-n)
    } else {
        Some(n)
    })
}
fn cash_rows(conn: &Connection, account: &str, as_of: &str, end: &str) -> Result<Vec<Row>> {
    let payroll_state = super::payroll::read(conn)?.1;
    let mut planned = Vec::new();
    let mut seen = HashSet::new();
    for id in ids(conn, "SELECT id FROM cash_occurrences")? {
        let o = cash_plans::occurrence(conn, &id)?;
        seen.insert((o.schedule_id.clone(), o.slot.clone()));
        if o.cancelled || o.actual.is_some() || o.due_date.as_str() > end || o.payroll_managed {
            continue;
        }
        planned.push((o.id, o.due_date, o.plan));
    }
    for s in cash_plans::schedules(conn)?
        .into_iter()
        .filter(|s| !s.archived)
    {
        for m in months(date(as_of)?, date(end)?)? {
            for (slot, due) in cash_plans::slots(&s, &m)? {
                if due.as_str() > end
                    || super::pay_cash::suppressed(&payroll_state, &s.id, &due)
                    || s.end_date.as_ref().is_some_and(|e| &due > e)
                    || seen.contains(&(s.id.clone(), slot.clone()))
                {
                    continue;
                }
                planned.push((format!("cash:{}:{slot}", s.id), due, s.plan.clone()));
            }
        }
    }
    let mut rows = Vec::new();
    for (id, due, p) in planned {
        let Some(delta) = plan_delta(&p, account)? else {
            continue;
        };
        let mut r = row(
            id,
            due,
            p.name.clone(),
            &p.kind,
            Some(delta),
            "Expected cash plan; amount and date may change.",
        );
        let possible:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM events e WHERE e.kind=?1 AND e.account_id IS ?2 AND e.destination_account_id IS ?3 AND e.payer=?4 AND e.date<=?5 AND ABS(julianday(e.date)-julianday(?6))<=4 AND NOT EXISTS(SELECT 1 FROM cash_matches m WHERE m.event_id=e.id))",params![p.kind,p.account_id,p.destination_account_id,p.payer,end,r.date],|r|r.get(0)).map_err(err)?;
        if possible {
            r.included = false;
            r.reason="Possible recorded match. Match or resolve it in Cash plans before forecasting it again.".into();
        } else if r.date.as_str() <= as_of {
            r.included = false;
            r.reason="Unfulfilled plan due today or earlier. Match, cancel or move its date; excluded from future cash.".into();
        }
        if p.kind == "paypal_cashout" && r.included {
            r.reason="Explicit expected PayPal deposit. Receipt reconciliation and any fees are still required when recorded.".into();
        }
        rows.push(r);
    }
    Ok(rows)
}
impl Store {
    pub fn forecast_settings(&self) -> Result<Settings> {
        settings(&self.conn)
    }
    pub fn save_forecast_settings(&mut self, operation: &str, mut input: Settings) -> Result<()> {
        Uuid::parse_str(operation).map_err(|_| "Invalid forecast operation.")?;
        let hash = crate::imports::parse::hash(json(&input)?.as_bytes());
        let prior: Option<String> = self
            .conn
            .query_row(
                "SELECT payload_hash FROM cash_forecast_receipts WHERE id=?1",
                [operation],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(p) = prior {
            return if p == hash {
                Ok(())
            } else {
                Err("This operation was used for different forecast choices.".into())
            };
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let old = settings(&tx)?;
        if old.revision != input.revision {
            return Err("Forecast choices changed. Reload before saving.".into());
        }
        check_settings(&tx, &input, Some(&old))?;
        input.revision += 1;
        tx.execute("INSERT INTO cash_forecast_settings VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,input_json=excluded.input_json",params![input.revision,json(&input)?]).map_err(err)?;
        tx.execute(
            "INSERT INTO cash_forecast_receipts VALUES (?1,?2)",
            params![operation, hash],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES('forecast_settings',?1)",
            [json(&(operation, &old, &input))?],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
    pub fn cash_forecast(&self, account: &str, days: u32) -> Result<View> {
        self.cash_forecast_at(account, days, &Local::now().date_naive().to_string())
    }
    pub(crate) fn cash_forecast_at(&self, account: &str, days: u32, as_of: &str) -> Result<View> {
        if !(7..=90).contains(&days) {
            return Err("Choose a forecast horizon from 7 to 90 days.".into());
        }
        let start = date(as_of)?;
        if start > Local::now().date_naive() {
            return Err("Forecast opening date cannot be in the future.".into());
        }
        let end = start
            .checked_add_signed(Days::days(days.into()))
            .ok_or("Forecast date is out of range.")?
            .to_string();
        date(&end)?;
        let kind: String = self
            .conn
            .query_row("SELECT kind FROM accounts WHERE id=?1", [account], |r| {
                r.get(0)
            })
            .map_err(|_| "Choose a checking account.")?;
        if kind != "checking" {
            return Err("Cash forecasts start from a checking account.".into());
        }
        let config = settings(&self.conn)?;
        let opening = position(&self.conn, account, as_of)?;
        let last_observed_at:Option<String>=self.conn.query_row("SELECT MAX(c.observed_at) FROM import_coverage c JOIN import_sources s ON s.id=c.source_id WHERE s.account_id=?1 AND s.dismissed=0 AND substr(c.observed_at,1,10)<=?2",params![account,as_of],|r|r.get(0)).map_err(err)?;
        let mut warnings = opening.warnings.clone();
        warnings.push("Known plans only: future discretionary purchases, interest, fees and timing changes are not predicted. This is not a live bank balance or a safe-to-spend amount.".into());
        let mut rows = cash_rows(&self.conn, account, as_of, &end)?;
        rows.extend(super::pay_cash::forecast_rows(
            &self.conn, account, as_of, &end,
        )?);
        let bills = bills_for(&self.conn, as_of, &end)?;
        for b in bills
            .iter()
            .filter(|b| b.payer == "jacob" && b.account.as_deref() == Some(account))
        {
            let mut r=row(b.id.clone(),b.date.clone(),b.name.clone(),"bill",Some(-b.amount),"Full remaining bill amount, including Chelsea's share. Expected charge on its due date.");
            if b.possible {
                r.included = false;
                r.reason="Possible recorded bill payment. Link or resolve it in Bills before forecasting it again.".into();
            } else if b.date.as_str() <= as_of {
                r.included = false;
                r.reason="Unpaid bill due today or earlier. Review or reschedule before including it in future cash.".into();
            }
            rows.push(r);
        }
        if bills
            .iter()
            .any(|b| b.payer == "jacob" && b.account.is_none())
        {
            warnings.push("Some unpaid bills have no payment account. Assign their account in Bills; they are excluded here.".into());
        }
        let names: BTreeMap<String, String> = {
            let mut q = self
                .conn
                .prepare("SELECT id,name FROM accounts WHERE kind='credit'")
                .map_err(err)?;
            let values = q
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(err)?
                .collect::<rusqlite::Result<_>>()
                .map_err(err)?;
            values
        };
        for (id, name) in &names {
            if !config.funding.iter().any(|f| &f.card_id == id) {
                warnings.push(format!(
                    "{name} has no checking payment account selected. Its payments are excluded."
                ));
            }
        }
        for f in config.funding.iter().filter(|f| f.checking_id == account) {
            self.card_forecast_rows(
                &f.card_id,
                names.get(&f.card_id).map(String::as_str).unwrap_or("Card"),
                as_of,
                &end,
                &bills,
                &mut rows,
                &mut warnings,
            )?;
        }
        // Recorded movements after the opening date are included once, independently of their budget period.
        let mut q=self.conn.prepare("SELECT e.id,e.description,d.date,a.change_cents FROM account_activity a JOIN events e ON e.id=a.event_id JOIN effective_activity_dates d ON d.event_id=a.event_id AND d.account_id=a.account_id WHERE a.account_id=?1 AND d.date>?2 AND d.date<=?3 ORDER BY d.date,e.id").map_err(err)?;
        let actuals = q
            .query_map(params![account, as_of, end], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        for (id, name, d, n) in actuals {
            rows.push(row(
                format!("actual:{id}"),
                d,
                name,
                "recorded",
                Some(n),
                "Recorded account movement after the opening date; not a new expected transaction.",
            ));
        }
        rows.sort_by(|a, b| {
            a.date
                .cmp(&b.date)
                .then(
                    a.amount_cents
                        .unwrap_or(0)
                        .cmp(&b.amount_cents.unwrap_or(0)),
                )
                .then(a.id.cmp(&b.id))
        });
        let next_pay_date = rows
            .iter()
            .find(|r| r.included && r.source == "income" && r.date.as_str() > as_of)
            .map(|r| r.date.clone());
        let mut running = opening.balance_cents;
        let mut lowest = running;
        let mut before_pay = None;
        for r in &mut rows {
            if r.included {
                if before_pay.is_none()
                    && r.source == "income"
                    && Some(&r.date) == next_pay_date.as_ref()
                {
                    before_pay = running;
                }
                running = running
                    .zip(r.amount_cents)
                    .map(|(a, b)| add(a, b))
                    .transpose()?;
                lowest = lowest.zip(running).map(|(a, b)| a.min(b));
                r.running_cents = running;
            }
        }
        let incomplete = !opening.complete
            || rows.iter().any(|r| !r.included || r.amount_cents.is_none())
            || warnings.len() > opening.warnings.len() + 1;
        Ok(View {
            account_id: account.into(),
            as_of: as_of.into(),
            through: end,
            settings: config,
            opening,
            last_observed_at,
            rows,
            warnings,
            ending_known_cents: running,
            lowest_known_cents: lowest,
            next_pay_date,
            before_next_pay_cents: before_pay,
            incomplete,
        })
    }
    #[allow(clippy::too_many_arguments)]
    fn card_forecast_rows(
        &self,
        account: &str,
        name: &str,
        as_of: &str,
        end: &str,
        bills: &[PlannedBill],
        rows: &mut Vec<Row>,
        warnings: &mut Vec<String>,
    ) -> Result<()> {
        let view = self.card_payment_view(account)?;
        let next = (date(as_of)? + Days::days(1)).to_string();
        let mut remaining = 0;
        let mut uncertain = false;
        for o in &view.obligations {
            if o.closing_date.as_str() > as_of {
                continue;
            }
            let unallocated = view.payments.iter().any(|p| {
                p.kind == "card_payment"
                    && p.card_date > o.closing_date
                    && p.card_date.as_str() <= as_of
                    && p.allocations.iter().map(|a| a.amount_cents).sum::<i64>() < p.amount_cents
            });
            if o.needs_review || unallocated {
                uncertain = true;
            }
            if let Some(n) = o.remaining_cents {
                remaining = add(remaining, n)?;
            }
            if o.due_date.as_str() > end || o.remaining_cents == Some(0) && !o.needs_review {
                continue;
            }
            let known = if o.needs_review || unallocated {
                None
            } else {
                o.remaining_cents.map(|n| -n)
            };
            let mut reason=if o.needs_review {"Statement obligation needs review in Card statements."} else if unallocated {"Recorded card payments need allocation before this remaining amount can be projected."} else {"Reviewed incremental statement amount remaining; carried debt is counted in its original cycle."}.to_string();
            if o.due_date.as_str() <= as_of {
                reason.push_str(&format!(
                    " Overdue since {}; assumed at the next forecast day.",
                    o.due_date
                ));
            }
            rows.push(row(
                format!("card:{account}:{}", o.month),
                o.due_date.clone().max(next.clone()),
                format!("{name} statement {}", o.month),
                "card_payment",
                known,
                &reason,
            ));
        }
        let position = position(&self.conn, account, as_of)?;
        if !position.complete {
            warnings.push(format!("{name}: current liability has incomplete checkpoint/coverage or posting-date evidence. Future statement subtotals are estimates."));
        }
        let cfg = card_statements::configs(&self.conn)?
            .into_iter()
            .find(|c| c.account_id == account && !c.archived);
        let Some(cfg) = cfg else {
            warnings.push(format!("{name}: configure an active statement schedule to project future card bills and unbilled activity."));
            return Ok(());
        };
        // Credits require explicit review; do not infer that they fulfilled an issuer obligation.
        if view.payments.iter().any(|p| {
            p.kind != "card_payment"
                && p.review_revision == 0
                && p.card_date.as_str() <= as_of
                && view.obligations.iter().any(|o| {
                    o.closing_date < p.card_date && o.remaining_cents.is_none_or(|n| n > 0)
                })
        }) {
            uncertain = true;
            warnings.push(format!(
                "{name}: post-close credits need review before estimating the next statement."
            ));
        }
        let mut residual = position.balance_cents.map(|n| n - remaining);
        let mut projected_bills: Vec<_> = bills
            .iter()
            .filter(|b| {
                b.payer == "jacob"
                    && b.account.as_deref() == Some(account)
                    && b.date.as_str() > as_of
            })
            .collect();
        projected_bills.sort_by(|a, b| a.date.cmp(&b.date));
        if bills.iter().any(|b| {
            b.payer == "jacob"
                && b.account.as_deref() == Some(account)
                && (b.possible || b.date.as_str() <= as_of)
        }) {
            uncertain = true;
            warnings.push(format!("{name}: review unmatched or overdue card bills before relying on the next statement estimate."));
        }
        let mut consumed = HashSet::new();
        let mut actual_query=self.conn.prepare("SELECT d.date,a.change_cents FROM account_activity a JOIN effective_activity_dates d ON d.event_id=a.event_id AND d.account_id=a.account_id WHERE a.account_id=?1 AND d.date>?2 AND d.date<=?3 ORDER BY d.date,a.event_id").map_err(err)?;
        let future_actuals = actual_query
            .query_map(params![account, as_of, end], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        let mut actual_consumed = HashSet::new();
        let mut cycles = Vec::new();
        for m in months(date(&format!("{}-01", cfg.first_month))?, date(end)?)? {
            let existing = card_statements::stored(&self.conn, account, &m)?;
            let d = if let Some((d, _)) = existing {
                d
            } else {
                card_statements::default_draft(&cfg, &m)?
            };
            cycles.push(d);
        }
        cycles.sort_by(|a, b| {
            a.closing_date
                .cmp(&b.closing_date)
                .then(a.month.cmp(&b.month))
        });
        if cycles
            .windows(2)
            .any(|w| w[0].closing_date == w[1].closing_date)
        {
            uncertain = true;
            warnings.push(format!(
                "{name}: two cycles share a cutoff. Correct statement dates before forecasting."
            ));
        }
        let missing: Vec<_> = cycles
            .iter()
            .filter(|d| {
                d.closing_date.as_str() <= as_of
                    && !view.obligations.iter().any(|o| o.month == d.month)
            })
            .map(|d| d.month.clone())
            .collect();
        if !missing.is_empty() {
            uncertain = true;
            warnings.push(format!("{name}: {} earlier cycles have no reviewed obligation (first {}). Review or correct the schedule start before estimating later cycles.",missing.len(),missing[0]));
        }
        for d in cycles {
            let m = d.month.clone();
            if d.closing_date.as_str() <= as_of {
                if missing.contains(&m)
                    && d.due_date.as_str() <= end
                    && date(&d.due_date)? >= date(as_of)? - Days::days(90)
                {
                    rows.push(row(format!("missing:{account}:{m}"),d.due_date.max(next.clone()),format!("{name} unreviewed statement {m}"),"card_payment",None,"This closed cycle has no reviewed obligation. Review its dates, amount and payments in Card statements."));
                }
                continue;
            }
            if d.due_date.as_str() > end {
                continue;
            }
            let mut delta = residual.take();
            // Retain negative residual credit for this cycle, rather than charging it twice.
            for (i, b) in projected_bills.iter().enumerate() {
                if b.date <= d.closing_date && consumed.insert(i) {
                    delta = delta.map(|n| add(n, b.amount)).transpose()?;
                }
            }
            for (i, (day, change)) in future_actuals.iter().enumerate() {
                if day <= &d.closing_date && actual_consumed.insert(i) {
                    delta = delta.map(|n| add(n, *change)).transpose()?;
                }
            }
            let amount = if uncertain {
                None
            } else {
                delta.map(|n| -n.max(0))
            };
            residual = delta.map(|n| n.min(0));
            rows.push(row(format!("estimate:{account}:{m}"),d.due_date,format!("{name} estimated statement {m}"),"card_estimate",amount,if uncertain {"Unknown until prior statements, payments, credits or bills are reviewed."} else {"Known unbilled liability plus scheduled card bills through the expected cutoff. Future discretionary purchases and interest are excluded."}));
        }
        Ok(())
    }
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    check_settings(conn, &settings(conn)?, None)?;
    let mut q = conn
        .prepare("SELECT id,payload_hash FROM cash_forecast_receipts")
        .map_err(err)?;
    let receipts = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, hash) in receipts {
        Uuid::parse_str(&id).map_err(err)?;
        if hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("Invalid forecast operation history.".into());
        }
    }
    Ok(())
}
