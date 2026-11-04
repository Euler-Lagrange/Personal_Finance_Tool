//! Approved expected pay and allocations to existing income; never posts money.
use crate::{
    money, pay_forecast,
    payroll::{self, State},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub account_id: String,
    pub cents: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetInput {
    pub account_id: String,
    pub amount: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub period_id: String,
    pub forecast_id: String,
    pub name: String,
    pub pay_date: String,
    pub targets: Vec<Target>,
    pub complete: bool,
    pub cancelled: bool,
    pub note: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanInput {
    pub period_id: String,
    pub forecast_id: String,
    pub targets: Vec<TargetInput>,
    pub complete: bool,
    pub cancelled: bool,
    pub note: String,
    pub duplicates_reviewed: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Deposit {
    pub period_id: String,
    pub event_id: String,
    pub cents: i64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Takeover {
    pub schedule_id: String,
    pub from_date: String,
    pub reason: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Finalized {
    pub period_id: String,
    pub basis: pay_forecast::Basis,
    pub reason: String,
}
pub fn uuid(s: &str) -> Result<()> {
    uuid::Uuid::parse_str(s)
        .map(|_| ())
        .map_err(|_| "Invalid payroll cash identifier.".into())
}
pub fn key(period: &str, event: &str) -> String {
    format!("{period}:{event}")
}
pub fn save_plan(state: &mut State, i: &PlanInput) -> Result<()> {
    if !i.duplicates_reviewed || i.note.len() > 2000 {
        return Err("Review other expected pay and enter notes up to 2000 characters.".into());
    }
    let p = state
        .periods
        .get(&i.period_id)
        .ok_or("Choose a current pay period.")?;
    let f = state
        .forecasts
        .get(&i.forecast_id)
        .ok_or("Choose a saved pay prediction.")?;
    let old = state.cash_plans.get(&i.period_id);
    if f.input.period_id != p.id || f.net_cents.is_none_or(|n| n <= 0) {
        return Err("Cash planning needs a positive saved prediction for this period.".into());
    }
    if old.is_none_or(|o| o.forecast_id != f.input.id)
        && state.selected_forecasts.get(&p.id) != Some(&f.input.id)
    {
        return Err("Select this prediction before approving it for cash planning.".into());
    }
    let targets = i
        .targets
        .iter()
        .map(|v| {
            Ok(Target {
                account_id: v.account_id.clone(),
                cents: money::cents(&v.amount)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    // Approval freezes the current period's payment date; later calendar edits require reapproval.
    state.cash_plans.insert(
        p.id.clone(),
        Plan {
            period_id: p.id.clone(),
            forecast_id: f.input.id.clone(),
            name: p.name.clone(),
            pay_date: p.pay_date.clone(),
            targets,
            complete: i.complete,
            cancelled: i.cancelled,
            note: i.note.clone(),
        },
    );
    validate_state(state)
}
pub fn finalize(state: &mut State, period_id: &str, reason: &str, confirmed: bool) -> Result<()> {
    if !confirmed || reason.trim().is_empty() || reason.len() > 2000 {
        return Err("Confirm the timesheet and explain the review.".into());
    }
    let p = state
        .periods
        .get(period_id)
        .ok_or("Choose a current period.")?;
    let basis = pay_forecast::period_basis(state, p, false)?;
    if basis.gross_cents.is_none() {
        return Err("Resolve timesheet/rate issues before finalizing.".into());
    }
    for d in &basis.days {
        use chrono::Datelike;
        let weekday = payroll::date(&d.date)?.weekday().num_days_from_monday() as usize;
        if d.hours.worked.is_none()
            && (state.usual_week[weekday] > 0 || d.hours.planned > 0 || d.hours.planned_sick > 0)
        {
            return Err("Record actual work (including zero for unworked days) for every planned/usual workday before finalizing.".into());
        }
    }
    state.finalized_periods.insert(
        period_id.into(),
        Finalized {
            period_id: period_id.into(),
            basis,
            reason: reason.into(),
        },
    );
    Ok(())
}
pub fn finalized_current(state: &State, f: &Finalized) -> bool {
    state
        .periods
        .get(&f.period_id)
        .and_then(|p| pay_forecast::period_basis(state, p, false).ok())
        .is_some_and(|b| b == f.basis)
}
pub fn validate_state(s: &State) -> Result<()> {
    if s.cash_plans.len() > 6000
        || s.pay_deposits.len() > 24000
        || s.pay_takeovers.len() > 2000
        || s.finalized_periods.len() > 6000
    {
        return Err("Payroll cash history is too large.".into());
    }
    for (key, p) in &s.cash_plans {
        let f = s
            .forecasts
            .get(&p.forecast_id)
            .ok_or("Missing payroll cash prediction.")?;
        if key != &p.period_id
            || !s.periods.contains_key(key)
            || f.input.period_id != *key
            || p.targets.is_empty()
            || p.targets.len() > 20
            || p.note.len() > 2000
            || p.name.trim().is_empty()
            || p.name.len() > 120
        {
            return Err("Invalid payroll cash plan.".into());
        }
        payroll::date(&p.pay_date)?;
        let mut ids = BTreeSet::new();
        let mut sum = 0_i64;
        for t in &p.targets {
            if t.account_id.is_empty()
                || !ids.insert(&t.account_id)
                || !(1..=money::MAX_CENTS).contains(&t.cents)
            {
                return Err("Choose unique destinations with positive amounts.".into());
            }
            sum = sum
                .checked_add(t.cents)
                .ok_or("Destination total is too large.")?;
        }
        if f.net_cents != Some(sum) {
            return Err("Destination amounts must equal the approved net prediction.".into());
        }
    }
    let mut totals = BTreeMap::new();
    for (k, d) in &s.pay_deposits {
        uuid(&d.event_id)?;
        if k != &key(&d.period_id, &d.event_id)
            || !s.cash_plans.contains_key(&d.period_id)
            || !(1..=money::MAX_CENTS).contains(&d.cents)
        {
            return Err("Invalid payroll deposit allocation.".into());
        }
        let sum = totals.entry(&d.event_id).or_insert(0_i64);
        *sum = sum
            .checked_add(d.cents)
            .filter(|n| *n <= money::MAX_CENTS)
            .ok_or("Deposit allocation total is too large.")?;
    }
    for (k, t) in &s.pay_takeovers {
        uuid(k)?;
        payroll::date(&t.from_date)?;
        if k != &t.schedule_id || t.reason.trim().is_empty() || t.reason.len() > 2000 {
            return Err("Invalid paycheck schedule takeover.".into());
        }
    }
    for (k, f) in &s.finalized_periods {
        if k != &f.period_id
            || f.basis.period.id != *k
            || f.reason.trim().is_empty()
            || f.reason.len() > 2000
        {
            return Err("Invalid retained timesheet review.".into());
        }
    }
    Ok(())
}
