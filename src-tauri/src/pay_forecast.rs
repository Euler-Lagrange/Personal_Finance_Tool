//! Known payroll facts and inspectable empirical estimates. All money is integer cents.
use crate::{
    money,
    pay_calendar::{Evidence, Period},
    payroll::{self, date, Day, State, SCALE},
};
use chrono::{Datelike, Duration};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Deduction {
    pub name: String,
    pub cents: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeductionInput {
    pub name: String,
    pub amount: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observation {
    pub id: String,
    pub period_id: Option<String>,
    pub pay_date: String,
    pub worked: i64,
    pub sick: i64,
    pub rate: i64,
    pub gross_cents: i64,
    pub net_cents: Option<i64>,
    pub other_gross_cents: i64,
    pub reimbursement_cents: i64,
    pub deductions: Vec<Deduction>,
    pub detail_complete: bool,
    pub frequency: String,
    pub benefits: bool,
    pub regime: String,
    pub reviewed: bool,
    pub evidence: Vec<Evidence>,
    pub note: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservationInput {
    pub id: String,
    pub period_id: Option<String>,
    pub pay_date: String,
    pub worked: String,
    pub sick: i64,
    pub rate: String,
    pub gross: String,
    pub net: Option<String>,
    pub other_gross: String,
    pub reimbursement: String,
    pub deductions: Vec<DeductionInput>,
    pub detail_complete: bool,
    pub frequency: String,
    pub benefits: bool,
    pub regime: String,
    pub reviewed: bool,
    pub evidence: Vec<Evidence>,
    pub note: String,
}
pub fn signed(value: &str) -> Result<i64> {
    let v = value.trim();
    if let Some(rest) = v.strip_prefix('-') {
        Ok(-money::cents(rest)?)
    } else {
        money::cents(v)
    }
}
fn bounded(value: i64) -> bool {
    (-money::MAX_CENTS..=money::MAX_CENTS).contains(&value)
}
fn frequency(value: &str) -> bool {
    ["weekly", "biweekly", "semimonthly", "monthly"].contains(&value)
}
pub fn round_ratio(n: i128, d: i128) -> i64 {
    // caller supplies a positive bounded denominator
    let magnitude = (n.abs() + d / 2) / d;
    if n < 0 {
        -(magnitude as i64)
    } else {
        magnitude as i64
    }
}
pub fn gross(rate: i64, hours: i64) -> i64 {
    round_ratio(rate as i128 * hours as i128, 1_000_000)
}
pub fn observation(input: ObservationInput) -> Result<Observation> {
    let o = Observation {
        id: input.id,
        period_id: input.period_id,
        pay_date: input.pay_date,
        worked: payroll::fixed(&input.worked, 1344 * SCALE)?,
        sick: input.sick,
        rate: payroll::fixed(&input.rate, 10_000 * SCALE)?,
        gross_cents: money::cents(&input.gross)?,
        net_cents: input.net.as_deref().map(money::cents).transpose()?,
        other_gross_cents: signed(&input.other_gross)?,
        reimbursement_cents: money::cents(&input.reimbursement)?,
        deductions: input
            .deductions
            .into_iter()
            .map(|d| {
                Ok(Deduction {
                    name: d.name.trim().into(),
                    cents: signed(&d.amount)?,
                })
            })
            .collect::<Result<Vec<_>>>()?,
        detail_complete: input.detail_complete,
        frequency: input.frequency,
        benefits: input.benefits,
        regime: input.regime.trim().into(),
        reviewed: input.reviewed,
        evidence: input.evidence,
        note: input.note.trim().into(),
    };
    validate_observation(&o)?;
    Ok(o)
}
pub fn validate_observation(o: &Observation) -> Result<()> {
    uuid::Uuid::parse_str(&o.id).map_err(|_| "Invalid known-pay identifier.")?;
    if let Some(p) = &o.period_id {
        uuid::Uuid::parse_str(p).map_err(|_| "Invalid linked pay period.")?;
    }
    date(&o.pay_date)?;
    if !(0..=1344 * SCALE).contains(&o.worked)
        || !(0..=80).contains(&o.sick)
        || o.worked + o.sick * SCALE > 1344 * SCALE
        || !(1..=10_000 * SCALE).contains(&o.rate)
        || !(0..=money::MAX_CENTS).contains(&o.gross_cents)
        || o.net_cents
            .is_some_and(|n| !(0..=money::MAX_CENTS).contains(&n))
        || !bounded(o.other_gross_cents)
        || !(0..=money::MAX_CENTS).contains(&o.reimbursement_cents)
        || !frequency(&o.frequency)
        || o.regime.trim().is_empty()
        || o.regime.len() > 120
        || o.note.len() > 2000
        || o.deductions.len() > 64
        || o.evidence.len() > 8
    {
        return Err("Check known-pay amounts, hours, rate, frequency and payroll regime.".into());
    }
    for d in &o.deductions {
        if d.name.is_empty() || d.name.len() > 120 || !bounded(d.cents) {
            return Err("Use named, bounded deduction amounts.".into());
        }
    }
    for e in &o.evidence {
        crate::pay_calendar::validate_evidence(e)?;
    }
    Ok(())
}
pub fn observation_issues(o: &Observation) -> Vec<String> {
    let mut issues = vec![];
    if !o.reviewed {
        issues.push("Known-pay values have not been reviewed.".into());
    }
    if o.net_cents.is_none() {
        issues.push("Take-home pay is missing, not zero.".into());
    }
    if gross(o.rate, o.worked + o.sick * SCALE) + o.other_gross_cents != o.gross_cents {
        issues.push("Hours × rate plus other gross does not equal reported gross. Check the source or record the adjustment.".into());
    }
    if o.detail_complete {
        let expected = o.gross_cents + o.reimbursement_cents
            - o.deductions.iter().map(|d| d.cents).sum::<i64>();
        if Some(expected) != o.net_cents {
            issues.push(
                "Complete deduction detail does not reconcile to reported take-home pay.".into(),
            );
        }
    }
    issues
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BasisDay {
    pub date: String,
    pub hours: Day,
    pub rate: Option<i64>,
    pub assumed: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Basis {
    pub period: Period,
    pub days: Vec<BasisDay>,
    pub gross_cents: Option<i64>,
    pub worked: i64,
    pub paid_hours: i64,
    pub sick: i64,
    pub uniform_rate: Option<i64>,
    pub warnings: Vec<String>,
    pub blockers: Vec<String>,
}
pub fn period_basis(state: &State, period: &Period, use_usual: bool) -> Result<Basis> {
    crate::pay_calendar::validate_period(period)?;
    // Simulate only time/policy state; never recursively clone stored forecast histories.
    let mut sim = State {
        rates: state.rates.clone(),
        days: state.days.clone(),
        holidays: state.holidays.clone(),
        holiday_years: state.holiday_years.clone(),
        opening_sick_used: state.opening_sick_used.clone(),
        usual_week: state.usual_week,
        ..State::default()
    };
    let mut days = vec![];
    let mut assumed = 0;
    let mut years = BTreeSet::new();
    for week in &period.weeks {
        for i in 0..7 {
            let day = date(week)? + Duration::days(i);
            let key = day.to_string();
            years.insert(day.year());
            let missing = !sim.days.contains_key(&key);
            if missing && use_usual {
                let planned = if sim.holidays.contains_key(&key) {
                    0
                } else {
                    state.usual_week[i as usize]
                };
                sim.days.insert(
                    key.clone(),
                    Day {
                        planned,
                        ..Day::default()
                    },
                );
                assumed += 1;
            }
            days.push(BasisDay {
                date: key.clone(),
                hours: sim.days.get(&key).cloned().unwrap_or_default(),
                rate: payroll::rate_at(state, &key),
                assumed: missing && use_usual,
            });
        }
    }
    let mut blockers = vec![];
    for w in &period.weeks {
        for i in payroll::week(&sim, w)?.issues {
            if !blockers.contains(&i.message) {
                blockers.push(i.message);
            }
        }
    }
    let mut rates = BTreeSet::new();
    let (mut raw, mut worked, mut sick) = (0_i128, 0_i64, 0_i64);
    for d in &days {
        let work = d.hours.worked.unwrap_or(d.hours.planned);
        let leave = if d.hours.worked.is_some() {
            d.hours.sick
        } else {
            d.hours.planned_sick
        };
        worked += work;
        sick += leave;
        if work + leave * SCALE > 0 {
            if let Some(rate) = d.rate {
                raw += rate as i128 * (work + leave * SCALE) as i128;
                rates.insert(rate);
            } else if !blockers.iter().any(|b| b.contains("hourly rate")) {
                blockers.push("Add an hourly rate for every paid day.".into());
            }
        }
    }
    let mut warnings = vec![];
    if assumed > 0 {
        warnings.push(format!("Usual hours were assumed for {assumed} unentered days, excluding known holidays. No timesheet entries were created."));
    }
    if years.iter().any(|y| !state.holiday_years.contains(y)) {
        warnings.push(
            "An official holiday list is incomplete; review it before relying on the work plan."
                .into(),
        );
    }
    if rates.len() > 1 {
        warnings.push("This period spans different rates. The ordinary known-pay model needs one rate; use a manual estimate or the tax method.".into());
    }
    Ok(Basis {
        period: period.clone(),
        days,
        gross_cents: if blockers.is_empty() {
            Some(round_ratio(raw, 1_000_000))
        } else {
            None
        },
        worked,
        paid_hours: worked + sick * SCALE,
        sick,
        uniform_rate: if rates.len() == 1 {
            rates.first().copied()
        } else {
            None
        },
        warnings,
        blockers,
    })
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmpiricalRequest {
    pub pay_date: String,
    pub period_id: Option<String>,
    pub rate: i64,
    pub frequency: String,
    pub benefits: bool,
    pub regime: String,
    pub gross_cents: i64,
    pub extrapolate: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Empirical {
    pub net_cents: Option<i64>,
    pub observations: Vec<Observation>,
    pub distinct_gross_points: usize,
    pub min_gross_cents: Option<i64>,
    pub max_gross_cents: Option<i64>,
    pub within_point_spread_cents: Option<i64>,
    pub fit_mae_cents: Option<i64>,
    pub fit_observation_count: usize,
    pub extrapolated: bool,
    pub warnings: Vec<String>,
}
pub fn empirical(
    observations: impl Iterator<Item = Observation>,
    r: &EmpiricalRequest,
) -> Result<Empirical> {
    let year = date(&r.pay_date)?.year();
    if !(1..=10_000 * SCALE).contains(&r.rate)
        || !(0..=money::MAX_CENTS).contains(&r.gross_cents)
        || !frequency(&r.frequency)
        || r.regime.trim().is_empty()
        || r.regime.len() > 120
    {
        return Err("Choose a valid known-pay model cohort and gross amount.".into());
    }
    let mut eligible = vec![];
    let mut seen = BTreeSet::new();
    for o in observations {
        validate_observation(&o)?;
        if date(&o.pay_date)?.year() != year
            || o.pay_date >= r.pay_date
            || o.period_id
                .as_ref()
                .is_some_and(|id| Some(id) == r.period_id.as_ref())
            || o.rate != r.rate
            || o.frequency != r.frequency
            || o.benefits != r.benefits
            || !o.regime.eq_ignore_ascii_case(r.regime.trim())
            || o.other_gross_cents != 0
            || o.reimbursement_cents != 0
            || !observation_issues(&o).is_empty()
            || o.net_cents.is_none_or(|n| n > o.gross_cents)
            || o.worked + o.sick * SCALE == 0
        {
            continue;
        }
        // Repeated representations of the same fact must not inflate support counts.
        if seen.insert((
            o.pay_date.clone(),
            o.worked,
            o.sick,
            o.gross_cents,
            o.net_cents,
        )) {
            eligible.push(o);
        }
    }
    eligible.sort_by(|a, b| a.pay_date.cmp(&b.pay_date).then(a.id.cmp(&b.id)));
    let mut groups: BTreeMap<i64, Vec<i64>> = BTreeMap::new();
    for o in &eligible {
        groups
            .entry(o.gross_cents)
            .or_default()
            .push(o.net_cents.unwrap());
    }
    let points: Vec<_> = groups
        .iter()
        .map(|(g, ns)| {
            (
                *g,
                round_ratio(ns.iter().map(|n| *n as i128).sum(), ns.len() as i128),
            )
        })
        .collect();
    let min = points.first().map(|p| p.0);
    let max = points.last().map(|p| p.0);
    let extrapolated = min
        .zip(max)
        .is_some_and(|(lo, hi)| r.gross_cents < lo || r.gross_cents > hi);
    let spread = groups
        .values()
        .filter(|ns| ns.len() > 1)
        .map(|ns| ns.iter().max().unwrap() - ns.iter().min().unwrap())
        .max();
    // Leave each interior gross point out, then compare its actual nets with
    // interpolation from its two neighbors. Edges are excluded, never extrapolated.
    let (mut fit_error, mut fit_count) = (0_i128, 0_usize);
    if !points.windows(2).any(|p| p[1].1 < p[0].1) {
        for triple in points.windows(3) {
            let (x0, y0) = triple[0];
            let (x, _) = triple[1];
            let (x1, y1) = triple[2];
            let prediction =
                y0 + round_ratio((x - x0) as i128 * (y1 - y0) as i128, (x1 - x0) as i128);
            for actual in &groups[&x] {
                fit_error += (actual - prediction).abs() as i128;
                fit_count += 1;
            }
        }
    }
    let fit_mae_cents = if fit_count > 0 {
        Some(round_ratio(fit_error, fit_count as i128))
    } else {
        None
    };
    let mut out=Empirical{net_cents:None,observations:eligible,distinct_gross_points:points.len(),min_gross_cents:min,max_gross_cents:max,within_point_spread_cents:spread,fit_mae_cents,fit_observation_count:fit_count,extrapolated,warnings:vec!["Empirical estimate from compatible earlier reviewed paychecks. It does not calculate current YTD tax thresholds or guarantee a deposit.".into()]};
    if points.len() < 2 {
        out.warnings.push("At least two distinct gross-pay observations in this cohort are needed. Use a manual estimate meanwhile.".into());
        return Ok(out);
    }
    if extrapolated && !r.extrapolate {
        out.warnings.push("The requested gross is outside the known range. Explicitly allow extrapolation or use another method.".into());
        return Ok(out);
    }
    if points.windows(2).any(|p| p[1].1 < p[0].1) {
        out.warnings.push("Higher gross has lower net in this cohort. Separate deduction/tax regimes or review the observations before fitting a model.".into());
        return Ok(out);
    }
    let upper = points
        .partition_point(|(g, _)| *g < r.gross_cents)
        .clamp(1, points.len() - 1);
    let (x0, y0) = points[upper - 1];
    let (x1, y1) = points[upper];
    let predicted = y0
        + round_ratio(
            (r.gross_cents - x0) as i128 * (y1 - y0) as i128,
            (x1 - x0) as i128,
        );
    if predicted < 0 || predicted > r.gross_cents {
        out.warnings.push("The fitted result falls outside ordinary net-pay bounds. Use a manual or tax estimate.".into());
        return Ok(out);
    }
    out.net_cents = Some(predicted);
    if extrapolated {
        out.warnings
            .push("Extrapolated beyond the known range; confidence is low.".into());
    }
    if points.len() < 4 {
        out.warnings
            .push("Sparse support: fewer than four distinct gross-pay observations.".into());
    }
    Ok(out)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForecastInput {
    pub id: String,
    pub period_id: String,
    pub method: String,
    pub regime: String,
    pub manual_net: Option<String>,
    pub reason: String,
    pub use_usual: bool,
    pub extrapolate: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax: Option<crate::pay_tax::Inputs>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Forecast {
    pub model_version: u32,
    pub input: ForecastInput,
    pub basis: Basis,
    pub empirical: Option<Empirical>,
    pub net_cents: Option<i64>,
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax: Option<crate::pay_tax::TaxResult>,
}
pub fn forecast(state: &State, input: &ForecastInput) -> Result<Forecast> {
    if ["tax", "calibrated"].contains(&input.method.as_str()) {
        return crate::pay_tax::forecast(state, input);
    }
    if input.tax.is_some() {
        return Err("Choose tax inputs only for a withholding prediction.".into());
    }
    uuid::Uuid::parse_str(&input.id).map_err(|_| "Invalid forecast identifier.")?;
    if input.reason.trim().is_empty()
        || input.reason.len() > 2000
        || input.regime.trim().is_empty()
        || input.regime.len() > 120
    {
        return Err("Name the payroll regime and explain the estimate before saving.".into());
    }
    let p = state
        .periods
        .get(&input.period_id)
        .ok_or("Choose an existing pay period.")?;
    let basis = period_basis(state, p, input.use_usual)?;
    let mut warnings = basis.warnings.clone();
    warnings.extend(basis.blockers.clone());
    let mut model = None;
    let net = match input.method.as_str() {
        "manual" => {
            warnings.push(
                "Manual take-home estimate; it is not a bank deposit or a tax calculation.".into(),
            );
            Some(money::cents(
                input
                    .manual_net
                    .as_deref()
                    .ok_or("Enter a manual take-home amount.")?,
            )?)
        }
        "known" => {
            if input.manual_net.is_some() {
                return Err("A known-pay estimate cannot also contain a manual amount.".into());
            }
            if let Some((gross_cents, rate)) = basis.gross_cents.zip(basis.uniform_rate) {
                let e = empirical(
                    state.observations.values().cloned(),
                    &EmpiricalRequest {
                        pay_date: p.pay_date.clone(),
                        period_id: Some(p.id.clone()),
                        rate,
                        frequency: p.frequency.clone(),
                        benefits: p.benefits,
                        regime: input.regime.clone(),
                        gross_cents,
                        extrapolate: input.extrapolate,
                    },
                )?;
                let net = e.net_cents;
                warnings.extend(e.warnings.clone());
                model = Some(e);
                net
            } else {
                warnings.push("Known-pay prediction needs valid hours and a single rate for the whole period.".into());
                None
            }
        }
        _ => return Err("Choose a supported prediction method.".into()),
    };
    Ok(Forecast {
        model_version: 1,
        input: input.clone(),
        basis,
        empirical: model,
        net_cents: net,
        warnings,
        tax: None,
    })
}
pub fn validate_state(state: &State) -> Result<()> {
    if state.observations.len() > 12_000 || state.forecasts.len() > 30_000 {
        return Err("Pay history exceeds the supported size.".into());
    }
    let mut linked = BTreeSet::new();
    for (id, o) in &state.observations {
        validate_observation(o)?;
        if id != &o.id {
            return Err("Known-pay identity mismatch.".into());
        }
        if let Some(p) = &o.period_id {
            if !state.periods.contains_key(p) || !linked.insert(p) {
                return Err("Each known paycheck needs its own existing period, or leave it unlinked. Unlink the known paycheck before removing its period.".into());
            }
        }
    }
    for (id, f) in &state.forecasts {
        if id != &f.input.id
            || ![1, 2].contains(&f.model_version)
            || f.net_cents
                .is_none_or(|n| !(0..=money::MAX_CENTS).contains(&n))
            || f.basis.period.id != f.input.period_id
        {
            return Err("Invalid retained forecast.".into());
        }
        crate::pay_calendar::validate_period(&f.basis.period)?;
        // Full mathematical integrity is checked by replaying native payroll history.
    }
    for (p, id) in &state.selected_forecasts {
        if !state.periods.contains_key(p)
            || state
                .forecasts
                .get(id)
                .is_none_or(|f| &f.input.period_id != p)
        {
            return Err("Clear the selected forecast before removing its period.".into());
        }
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastStatus {
    pub id: String,
    pub stale: bool,
    pub created_at: String,
    pub actual_net_cents: Option<i64>,
    pub actual_minus_forecast_cents: Option<i64>,
}
pub fn status(state: &State, f: &Forecast, created_at: String) -> ForecastStatus {
    let stale = forecast(state, &f.input).map_or(true, |current| current != *f);
    let actual = state
        .observations
        .values()
        .find(|o| o.period_id.as_ref() == Some(&f.input.period_id))
        .and_then(|o| o.net_cents);
    ForecastStatus {
        id: f.input.id.clone(),
        stale,
        created_at,
        actual_net_cents: actual,
        actual_minus_forecast_cents: actual.zip(f.net_cents).map(|(a, b)| a - b),
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioInput {
    pub pay_date: String,
    pub rate: String,
    pub hours: Vec<String>,
    pub frequency: String,
    pub benefits: bool,
    pub regime: String,
    pub extrapolate: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub hours: i64,
    pub gross_cents: i64,
    pub estimate: Empirical,
    pub extra_hour_net_cents: Option<i64>,
}
pub fn scenarios(state: &State, input: &ScenarioInput) -> Result<Vec<Scenario>> {
    if input.hours.is_empty() || input.hours.len() > 40 {
        return Err("Compare between 1 and 40 total-hours scenarios.".into());
    }
    let rate = payroll::fixed(&input.rate, 10_000 * SCALE)?;
    input
        .hours
        .iter()
        .map(|h| {
            let hours = payroll::fixed(h, 1343 * SCALE)?;
            let gross_cents = gross(rate, hours);
            let r = EmpiricalRequest {
                pay_date: input.pay_date.clone(),
                period_id: None,
                rate,
                frequency: input.frequency.clone(),
                benefits: input.benefits,
                regime: input.regime.clone(),
                gross_cents,
                extrapolate: input.extrapolate,
            };
            let estimate = empirical(state.observations.values().cloned(), &r)?;
            let more = empirical(
                state.observations.values().cloned(),
                &EmpiricalRequest {
                    gross_cents: gross(rate, hours + SCALE),
                    ..r
                },
            )?;
            let extra_hour_net_cents = more.net_cents.zip(estimate.net_cents).map(|(a, b)| a - b);
            Ok(Scenario {
                hours,
                gross_cents,
                estimate,
                extra_hour_net_cents,
            })
        })
        .collect()
}
