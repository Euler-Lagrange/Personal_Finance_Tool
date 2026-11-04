use super::*;
use crate::{
    pay_cash as model,
    payroll::{Change, State as PayState},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DepositView {
    pub event_id: String,
    pub revision: i64,
    pub date: String,
    pub description: String,
    pub account_id: String,
    pub amount_cents: i64,
    pub available_cents: i64,
    pub allocated_cents: i64,
    pub suggested: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanView {
    pub plan: model::Plan,
    pub expected_cents: i64,
    pub deposited_cents: i64,
    pub variance_cents: i64,
    pub remaining_cents: i64,
    pub changed: bool,
    pub deposits: Vec<DepositView>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub revision: i64,
    pub plans: Vec<PlanView>,
    pub schedules: Vec<cash_plans::Schedule>,
    pub takeovers: BTreeMap<String, model::Takeover>,
    pub finalized: BTreeMap<String, bool>,
}
fn event(conn: &Connection, id: &str) -> Result<DepositView> {
    conn.query_row("SELECT id,revision,date,description,account_id,amount_cents FROM events WHERE id=?1 AND kind='income' AND payer='jacob' AND account_id IS NOT NULL",[id],|r|Ok(DepositView{event_id:r.get(0)?,revision:r.get(1)?,date:r.get(2)?,description:r.get(3)?,account_id:r.get(4)?,amount_cents:r.get(5)?,available_cents:0,allocated_cents:0,suggested:false})).map_err(|_|"Choose an existing ordinary income deposit in your bank account.".into())
}
fn account(conn: &Connection, id: &str) -> Result<(String, bool)> {
    conn.query_row(
        "SELECT kind,archived FROM accounts WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .map_err(|_| "Choose an existing bank account.".into())
}
pub(super) fn suppressed(s: &PayState, schedule: &str, scheduled: &str) -> bool {
    s.pay_takeovers
        .get(schedule)
        .is_some_and(|t| scheduled >= t.from_date.as_str())
}
pub(super) fn validate_references(conn: &Connection, s: &PayState) -> Result<()> {
    for p in s.cash_plans.values() {
        for t in &p.targets {
            if !["checking", "savings"].contains(&account(conn, &t.account_id)?.0.as_str()) {
                return Err("Payroll destinations must be checking or savings accounts.".into());
            }
        }
    }
    let mut used = BTreeMap::<String, i64>::new();
    for d in s.pay_deposits.values() {
        let e = event(conn, &d.event_id)?;
        let p = &s.cash_plans[&d.period_id];
        if !p.targets.iter().any(|t| t.account_id == e.account_id) {
            return Err("A linked deposit must use a configured payroll destination. Unlink it before changing destinations.".into());
        }
        *used.entry(e.event_id.clone()).or_default() += d.cents;
        if used[&e.event_id] > e.amount_cents {
            return Err("Payroll allocations exceed this deposit's full amount.".into());
        }
        let matched: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM cash_matches WHERE event_id=?1)",
                [&e.event_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if matched {
            return Err(
                "Unlink the generic Cash plans match before allocating this payroll deposit."
                    .into(),
            );
        }
    }
    for t in s.pay_takeovers.values() {
        let schedule = cash_plans::schedules(conn)?
            .into_iter()
            .find(|x| x.id == t.schedule_id)
            .ok_or("Missing adopted paycheck schedule.")?;
        if schedule.plan.kind != "income" {
            return Err("A payroll takeover must refer to an income schedule.".into());
        }
    }
    Ok(())
}
pub(super) fn validate_change(conn: &Connection, s: &PayState, c: &Change) -> Result<()> {
    match c {
        Change::PayCash { input } => {
            for t in &input.targets {
                let (_, archived) = account(conn, &t.account_id)?;
                if archived
                    && !s
                        .cash_plans
                        .get(&input.period_id)
                        .is_some_and(|p| p.targets.iter().any(|x| x.account_id == t.account_id))
                {
                    return Err("Choose an active account for a new destination.".into());
                }
            }
        }
        Change::PayDeposit {
            event_id,
            event_revision,
            ..
        } => {
            let e = event(conn, event_id)?;
            if e.revision != *event_revision || e.date > Local::now().date_naive().to_string() {
                return Err(
                    "Choose a recorded deposit on or before today; reload if it changed.".into(),
                );
            }
        }
        Change::PayTakeover {
            input,
            schedule_revision,
            ..
        } => {
            let schedule = cash_plans::schedules(conn)?
                .into_iter()
                .find(|x| x.id == input.schedule_id)
                .ok_or("Choose an existing paycheck schedule.")?;
            if schedule.revision != *schedule_revision || schedule.plan.kind != "income" {
                return Err("The paycheck schedule changed. Reload before takeover.".into());
            }
            if s.pay_takeovers.get(&input.schedule_id).is_some_and(|old| {
                input.from_date > old.from_date
                    && s.cash_plans.values().any(|p| {
                        !p.cancelled
                            && !p.complete
                            && p.pay_date >= old.from_date
                            && p.pay_date < input.from_date
                            && p.targets
                                .iter()
                                .any(|x| Some(&x.account_id) == schedule.plan.account_id.as_ref())
                    })
            }) {
                return Err("Cancel or complete overlapping payroll cash plans before moving the takeover date later.".into());
            }
            let matched:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM cash_occurrences o JOIN cash_matches m ON m.occurrence_id=o.id WHERE o.schedule_id=?1 AND o.scheduled_date>=?2)",params![input.schedule_id,input.from_date],|r|r.get(0)).map_err(err)?;
            if matched {
                return Err("Unlink existing generic paycheck matches from the takeover date onward first. Their income remains recorded.".into());
            }
        }
        Change::RemovePayTakeover { schedule_id, .. } => {
            let t = s
                .pay_takeovers
                .get(schedule_id)
                .ok_or("Takeover no longer exists.")?;
            let schedule = cash_plans::schedules(conn)?
                .into_iter()
                .find(|x| &x.id == schedule_id)
                .ok_or("Schedule no longer exists.")?;
            if s.cash_plans.values().any(|p| {
                !p.cancelled
                    && !p.complete
                    && p.pay_date >= t.from_date
                    && p.targets
                        .iter()
                        .any(|x| Some(&x.account_id) == schedule.plan.account_id.as_ref())
            }) {
                return Err("Cancel or complete overlapping payroll cash plans before releasing the generic schedule.".into());
            }
        }
        _ => {}
    }
    Ok(())
}
pub(super) fn allocated(conn: &Connection, id: &str) -> Result<bool> {
    Ok(super::payroll::read(conn)?
        .1
        .pay_deposits
        .values()
        .any(|d| d.event_id == id))
}
pub(super) fn protect_delete(conn: &Connection, id: &str) -> Result<()> {
    if allocated(conn, id)? {
        return Err(
            "Unlink this deposit in Pay & hours before deleting it or undoing its import.".into(),
        );
    }
    Ok(())
}
pub(super) fn protect_entry(conn: &Connection, i: &EntryInput) -> Result<()> {
    if !allocated(conn, &i.id)? {
        return Ok(());
    }
    let same:bool=conn.query_row("SELECT kind=?2 AND date=?3 AND amount_cents=?4 AND payer=?5 AND account_id IS ?6 AND destination_account_id IS ?7 FROM events WHERE id=?1",params![i.id,i.kind,i.date,money::cents(&i.amount)?,i.payer,i.account_id,i.destination_account_id],|r|r.get(0)).map_err(err)?;
    if !same {
        return Err("Unlink this deposit in Pay & hours before changing its money, date or accounts. Description and notes remain editable.".into());
    }
    Ok(())
}
pub(super) fn protect_occurrence(conn: &Connection, o: &cash_plans::Occurrence) -> Result<()> {
    let s = super::payroll::read(conn)?.1;
    if suppressed(&s, &o.schedule_id, &o.scheduled_date) {
        return Err("This paycheck schedule is managed by Pay & hours from its takeover date. Review it there.".into());
    }
    Ok(())
}
fn deposits(conn: &Connection, s: &PayState, p: &model::Plan) -> Result<Vec<DepositView>> {
    s.pay_deposits
        .values()
        .filter(|d| d.period_id == p.period_id)
        .map(|d| {
            let mut e = event(conn, &d.event_id)?;
            e.allocated_cents = d.cents;
            e.available_cents = e.amount_cents
                - s.pay_deposits
                    .values()
                    .filter(|x| x.event_id == e.event_id)
                    .map(|x| x.cents)
                    .sum::<i64>();
            Ok(e)
        })
        .collect()
}
fn plans(conn: &Connection, s: &PayState) -> Result<Vec<PlanView>> {
    s.cash_plans
        .values()
        .map(|p| {
            let deposits = deposits(conn, s, p)?;
            let deposited = deposits.iter().map(|d| d.allocated_cents).sum::<i64>();
            let expected = p.targets.iter().map(|t| t.cents).sum();
            let remaining = if p.complete || p.cancelled {
                0
            } else {
                p.targets
                    .iter()
                    .map(|t| {
                        (t.cents
                            - deposits
                                .iter()
                                .filter(|d| d.account_id == t.account_id)
                                .map(|d| d.allocated_cents)
                                .sum::<i64>())
                        .max(0)
                    })
                    .sum()
            };
            let changed = s.selected_forecasts.get(&p.period_id) != Some(&p.forecast_id)
                || s.forecasts.get(&p.forecast_id).is_none_or(|saved| {
                    crate::pay_forecast::forecast(s, &saved.input)
                        .map_or(true, |current| current != *saved)
                })
                || s.periods
                    .get(&p.period_id)
                    .is_none_or(|x| x.pay_date != p.pay_date);
            Ok(PlanView {
                plan: p.clone(),
                expected_cents: expected,
                deposited_cents: deposited,
                variance_cents: deposited - expected,
                remaining_cents: remaining,
                changed,
                deposits,
            })
        })
        .collect()
}
impl Store {
    pub fn pay_cash_view(&self) -> Result<View> {
        let (revision, s) = super::payroll::read(&self.conn)?;
        let plans = plans(&self.conn, &s)?;
        let finalized = s
            .finalized_periods
            .iter()
            .map(|(id, f)| (id.clone(), model::finalized_current(&s, f)))
            .collect();
        Ok(View {
            revision,
            plans,
            schedules: cash_plans::schedules(&self.conn)?
                .into_iter()
                .filter(|x| x.plan.kind == "income")
                .collect(),
            takeovers: s.pay_takeovers,
            finalized,
        })
    }
    pub fn pay_deposit_candidates(&self, period: &str) -> Result<Vec<DepositView>> {
        let s = super::payroll::read(&self.conn)?.1;
        let p = s
            .cash_plans
            .get(period)
            .ok_or("Approve a payroll cash plan first.")?;
        let mut q=self.conn.prepare("SELECT id FROM events WHERE kind='income' AND payer='jacob' AND date<=?1 AND NOT EXISTS(SELECT 1 FROM cash_matches m WHERE m.event_id=events.id) ORDER BY date DESC,id").map_err(err)?;
        let ids = q
            .query_map([Local::now().date_naive().to_string()], |r| {
                r.get::<_, String>(0)
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        let mut out = Vec::new();
        for id in ids {
            let mut e = event(&self.conn, &id)?;
            if !p.targets.iter().any(|t| t.account_id == e.account_id) {
                continue;
            }
            e.allocated_cents = s
                .pay_deposits
                .get(&model::key(period, &id))
                .map_or(0, |d| d.cents);
            e.available_cents = e.amount_cents
                - s.pay_deposits
                    .values()
                    .filter(|d| d.event_id == id && d.period_id != period)
                    .map(|d| d.cents)
                    .sum::<i64>();
            if e.available_cents <= 0 {
                continue;
            }
            e.suggested = (crate::payroll::date(&e.date)? - crate::payroll::date(&p.pay_date)?)
                .num_days()
                .abs()
                <= 7;
            out.push(e);
        }
        out.sort_by(|a, b| b.suggested.cmp(&a.suggested).then(b.date.cmp(&a.date)));
        Ok(out)
    }
}
pub(super) fn forecast_rows(
    conn: &Connection,
    account: &str,
    as_of: &str,
    end: &str,
) -> Result<Vec<cash_forecast::Row>> {
    let s = super::payroll::read(conn)?.1;
    let mut out = Vec::new();
    for v in plans(conn, &s)? {
        let p = &v.plan;
        if p.cancelled || p.complete || p.pay_date.as_str() > end {
            continue;
        }
        let Some(t) = p.targets.iter().find(|t| t.account_id == account) else {
            continue;
        };
        let remaining = (t.cents
            - v.deposits
                .iter()
                .filter(|d| d.account_id == account)
                .map(|d| d.allocated_cents)
                .sum::<i64>())
        .max(0);
        if remaining == 0 {
            continue;
        }
        let mut q=conn.prepare("SELECT id,amount_cents FROM events WHERE kind='income' AND payer='jacob' AND account_id=?1 AND date<=?2 AND ABS(julianday(date)-julianday(?3))<=7 AND NOT EXISTS(SELECT 1 FROM cash_matches m WHERE m.event_id=events.id)").map_err(err)?;
        let nearby = q
            .query_map(params![account, end, p.pay_date], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        let possible = nearby.iter().any(|(id, n)| {
            s.pay_deposits
                .values()
                .filter(|d| &d.event_id == id)
                .map(|d| d.cents)
                .sum::<i64>()
                < *n
        });
        let included = !possible && p.pay_date.as_str() > as_of;
        let reason = if possible {
            "Possible recorded payroll deposit; allocate or resolve it in Pay & hours before forecasting the remaining pay."
        } else if !included {
            "Unfulfilled payroll pay date is today or earlier. Review the expected date or mark reconciliation complete."
        } else if v.changed {
            "Approved payroll estimate; a newer selected prediction or pay date needs approval."
        } else {
            "Remaining approved payroll estimate after allocated deposits; expected amount may change."
        };
        out.push(cash_forecast::Row {
            id: format!("payroll:{}:{account}", p.period_id),
            date: p.pay_date.clone(),
            name: p.name.clone(),
            source: "income".into(),
            amount_cents: Some(remaining),
            included,
            reason: reason.into(),
            running_cents: None,
        });
    }
    Ok(out)
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkMonth {
    pub month: String,
    pub recorded_days: usize,
    pub unrecorded_planned_days: usize,
    pub worked: i64,
    pub sick: i64,
    pub unpaid: i64,
    pub earned_gross_cents: Option<i64>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaidMonth {
    pub approved_net_cents: i64,
    pub allocated_net_cents: i64,
    pub month: String,
    pub known_paychecks: Vec<crate::pay_forecast::Observation>,
    pub plans: Vec<PlanView>,
    pub selected_predictions: Vec<crate::pay_forecast::Forecast>,
    pub allocated_deposits: Vec<DepositView>,
    pub finalized: Vec<model::Finalized>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annual {
    pub year: i32,
    pub work: Vec<WorkMonth>,
    pub paid: Vec<PaidMonth>,
}
pub(super) fn month_explanation(conn: &Connection, month: &str) -> Result<PaidMonth> {
    validate_month(month)?;
    let s = super::payroll::read(conn)?.1;
    let ps: Vec<_> = plans(conn, &s)?
        .into_iter()
        .filter(|p| p.plan.pay_date.starts_with(month))
        .collect();
    let mut allocated = BTreeMap::<String, DepositView>::new();
    for d in s.pay_deposits.values() {
        let e = event(conn, &d.event_id)?;
        if e.date.starts_with(month) {
            let slot = allocated.entry(e.event_id.clone()).or_insert(e);
            slot.allocated_cents += d.cents;
        }
    }
    Ok(PaidMonth {
        approved_net_cents: ps
            .iter()
            .filter(|p| !p.plan.cancelled)
            .map(|p| p.expected_cents)
            .sum(),
        allocated_net_cents: allocated.values().map(|d| d.allocated_cents).sum(),
        month: month.into(),
        known_paychecks: s
            .observations
            .values()
            .filter(|o| o.pay_date.starts_with(month))
            .cloned()
            .collect(),
        plans: ps,
        selected_predictions: s
            .selected_forecasts
            .values()
            .filter_map(|id| s.forecasts.get(id))
            .filter(|f| f.basis.period.pay_date.starts_with(month))
            .cloned()
            .collect(),
        allocated_deposits: allocated.into_values().collect(),
        finalized: s
            .finalized_periods
            .values()
            .filter(|f| f.basis.period.pay_date.starts_with(month))
            .cloned()
            .collect(),
    })
}
impl Store {
    pub fn pay_annual(&self, year: i32) -> Result<Annual> {
        if !(1900..=2100).contains(&year) {
            return Err("Choose a year from 1900 to 2100.".into());
        }
        let s = super::payroll::read(&self.conn)?.1;
        let mut work = Vec::new();
        let mut paid = Vec::new();
        for m in 1..=12 {
            let month = format!("{year:04}-{m:02}");
            let mut w = WorkMonth {
                month: month.clone(),
                ..Default::default()
            };
            let mut raw = Some(0_i128);
            let mut weeks = BTreeSet::new();
            for (date, d) in s.days.iter().filter(|(day, _)| day.starts_with(&month)) {
                w.unpaid += d.unpaid;
                if let Some(hours) = d.worked {
                    w.recorded_days += 1;
                    w.worked += hours;
                    w.sick += d.sick;
                    let h = hours + d.sick * crate::payroll::SCALE;
                    if h > 0 {
                        raw = raw
                            .zip(crate::payroll::rate_at(&s, date))
                            .map(|(v, r)| v + h as i128 * r as i128);
                    }
                    weeks.insert(
                        crate::payroll::week_start(crate::payroll::date(date)?).to_string(),
                    );
                } else {
                    w.unrecorded_planned_days += 1;
                }
            }
            if w.recorded_days > 0 {
                for day in weeks {
                    if crate::payroll::week(&s, &day)?
                        .issues
                        .iter()
                        .any(|i| !i.planned)
                    {
                        raw = None;
                    }
                }
                w.earned_gross_cents = raw.map(|v| crate::pay_forecast::round_ratio(v, 1_000_000));
            }
            work.push(w);
            paid.push(month_explanation(&self.conn, &month)?);
        }
        Ok(Annual { year, work, paid })
    }
}
