//! Civil-date payroll planning. Money and hours use fixed-point integers.
use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
type Result<T> = std::result::Result<T, String>;
pub const SCALE: i64 = 10_000;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Day {
    pub planned: i64,
    pub worked: Option<i64>,
    pub sick: i64,
    pub planned_sick: i64,
    pub unpaid: i64,
    pub note: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub employer: String,
    pub usual_week: [i64; 7],
    pub rates: BTreeMap<String, i64>,
    pub days: BTreeMap<String, Day>,
    pub holidays: BTreeMap<String, String>,
    pub holiday_years: BTreeSet<i32>,
    pub opening_sick_used: BTreeMap<i32, i64>,
    // Omit empty extension fields to preserve schema-38 history hashes during replay.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub periods: BTreeMap<String, crate::pay_calendar::Period>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub holiday_evidence: BTreeMap<String, crate::pay_calendar::Evidence>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub observations: BTreeMap<String, crate::pay_forecast::Observation>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub forecasts: BTreeMap<String, crate::pay_forecast::Forecast>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub selected_forecasts: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tax_profiles: BTreeMap<String, crate::pay_tax::Profile>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub calibrations: BTreeMap<String, crate::pay_tax::Calibration>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub cash_plans: BTreeMap<String, crate::pay_cash::Plan>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub pay_deposits: BTreeMap<String, crate::pay_cash::Deposit>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub pay_takeovers: BTreeMap<String, crate::pay_cash::Takeover>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub finalized_periods: BTreeMap<String, crate::pay_cash::Finalized>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            employer: "PSW / Talent Tier".into(),
            usual_week: [8 * SCALE, 8 * SCALE, 8 * SCALE, 8 * SCALE, 8 * SCALE, 0, 0],
            rates: BTreeMap::new(),
            days: BTreeMap::new(),
            holidays: BTreeMap::new(),
            holiday_years: BTreeSet::new(),
            opening_sick_used: BTreeMap::new(),
            periods: BTreeMap::new(),
            holiday_evidence: BTreeMap::new(),
            observations: BTreeMap::new(),
            forecasts: BTreeMap::new(),
            selected_forecasts: BTreeMap::new(),
            tax_profiles: BTreeMap::new(),
            calibrations: BTreeMap::new(),
            cash_plans: BTreeMap::new(),
            pay_deposits: BTreeMap::new(),
            pay_takeovers: BTreeMap::new(),
            finalized_periods: BTreeMap::new(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DayInput {
    pub date: String,
    pub planned: String,
    pub worked: Option<String>,
    pub sick: i64,
    pub planned_sick: i64,
    pub unpaid: String,
    pub note: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Change {
    PayCash {
        input: crate::pay_cash::PlanInput,
    },
    RemovePayCash {
        period_id: String,
    },
    PayDeposit {
        period_id: String,
        event_id: String,
        event_revision: i64,
        amount: String,
        confirmed: bool,
    },
    RemovePayDeposit {
        period_id: String,
        event_id: String,
    },
    PayTakeover {
        input: crate::pay_cash::Takeover,
        schedule_revision: i64,
        confirmed: bool,
    },
    RemovePayTakeover {
        schedule_id: String,
        confirmed: bool,
    },
    FinalizePay {
        period_id: String,
        reason: String,
        confirmed: bool,
    },
    ReopenPay {
        period_id: String,
        reason: String,
    },
    TaxProfile {
        profile: crate::pay_tax::Profile,
    },
    RemoveTaxProfile {
        id: String,
    },
    Calibration {
        id: String,
        observation_id: String,
        input: crate::pay_tax::Inputs,
    },
    RemoveCalibration {
        observation_id: String,
    },
    Observation {
        input: crate::pay_forecast::ObservationInput,
    },
    RemoveObservation {
        id: String,
    },
    Forecast {
        input: crate::pay_forecast::ForecastInput,
    },
    SelectForecast {
        period_id: String,
        id: Option<String>,
    },
    Calendar {
        review: crate::pay_calendar::Review,
    },
    Settings {
        employer: String,
        usual_week: [String; 7],
    },
    Rate {
        effective_date: String,
        hourly_rate: String,
    },
    RemoveRate {
        effective_date: String,
    },
    Days {
        days: Vec<DayInput>,
    },
    Holiday {
        date: String,
        name: String,
    },
    RemoveHoliday {
        date: String,
    },
    Year {
        year: i32,
        opening_sick_used: i64,
        holidays_complete: bool,
    },
}
pub fn date(value: &str) -> Result<NaiveDate> {
    if value.len() != 10 || !("1900-01-01"..="2100-12-31").contains(&value) {
        return Err("Choose a calendar date between 1900 and 2100.".into());
    }
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "Choose a valid calendar date.")?;
    if parsed.to_string() != value {
        return Err("Choose a date in YYYY-MM-DD format.".into());
    }
    Ok(parsed)
}
pub fn week_start(day: NaiveDate) -> NaiveDate {
    day - Duration::days(day.weekday().num_days_from_monday() as i64)
}
pub fn fixed(value: &str, maximum: i64) -> Result<i64> {
    let value = value.trim();
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty()
        || whole.len() > 9
        || fraction.len() > 4
        || !whole.bytes().all(|x| x.is_ascii_digit())
        || !fraction.bytes().all(|x| x.is_ascii_digit())
    {
        return Err("Enter a nonnegative number with up to four decimal places.".into());
    }
    let whole: i64 = whole.parse().map_err(|_| "Number is too large.")?;
    let fraction: i64 = format!("{fraction:0<4}")
        .parse()
        .map_err(|_| "Invalid decimal.")?;
    let result = whole * SCALE + fraction;
    if result > maximum {
        return Err("Hours or rate exceeds the supported limit.".into());
    }
    Ok(result)
}
fn text(value: &str, max: usize, required: bool) -> Result<()> {
    if value.len() > max || (required && value.trim().is_empty()) {
        return Err(format!(
            "Enter {}text up to {max} characters.",
            if required { "nonempty " } else { "" }
        ));
    }
    Ok(())
}
pub fn apply(state: &mut State, change: &Change) -> Result<()> {
    let mut next = state.clone();
    apply_inner(&mut next, change)?;
    *state = next;
    Ok(())
}
fn apply_inner(state: &mut State, change: &Change) -> Result<()> {
    match change {
        Change::PayCash { input } => crate::pay_cash::save_plan(state, input)?,
        Change::RemovePayCash { period_id } => {
            if state
                .pay_deposits
                .values()
                .any(|d| &d.period_id == period_id)
            {
                return Err("Unlink deposits before removing the cash plan.".into());
            }
            state
                .cash_plans
                .remove(period_id)
                .ok_or("Payroll cash plan no longer exists.")?;
        }
        Change::PayDeposit {
            period_id,
            event_id,
            event_revision,
            amount,
            confirmed,
        } => {
            if !confirmed || *event_revision < 1 {
                return Err("Confirm the selected deposit and allocation.".into());
            }
            let p = state
                .cash_plans
                .get(period_id)
                .ok_or("Approve expected cash before matching deposits.")?;
            if p.cancelled {
                return Err(
                    "Restore the cancelled payroll cash plan before matching deposits.".into(),
                );
            }
            state.pay_deposits.insert(
                crate::pay_cash::key(period_id, event_id),
                crate::pay_cash::Deposit {
                    period_id: period_id.clone(),
                    event_id: event_id.clone(),
                    cents: crate::money::cents(amount)?,
                },
            );
        }
        Change::RemovePayDeposit {
            period_id,
            event_id,
        } => {
            state
                .pay_deposits
                .remove(&crate::pay_cash::key(period_id, event_id))
                .ok_or("Deposit link no longer exists.")?;
        }
        Change::PayTakeover {
            input,
            schedule_revision,
            confirmed,
        } => {
            if !confirmed || *schedule_revision < 1 {
                return Err("Confirm the existing schedule takeover.".into());
            }
            state
                .pay_takeovers
                .insert(input.schedule_id.clone(), input.clone());
        }
        Change::RemovePayTakeover {
            schedule_id,
            confirmed,
        } => {
            if !confirmed {
                return Err("Confirm release of this paycheck schedule.".into());
            }
            state
                .pay_takeovers
                .remove(schedule_id)
                .ok_or("Schedule takeover no longer exists.")?;
        }
        Change::FinalizePay {
            period_id,
            reason,
            confirmed,
        } => crate::pay_cash::finalize(state, period_id, reason, *confirmed)?,
        Change::ReopenPay { period_id, reason } => {
            text(reason, 2000, true)?;
            state
                .finalized_periods
                .remove(period_id)
                .ok_or("Period has no retained timesheet review.")?;
        }
        Change::TaxProfile { profile } => {
            crate::pay_tax::validate_profile(profile)?;
            state
                .tax_profiles
                .insert(profile.id.clone(), profile.clone());
        }
        Change::RemoveTaxProfile { id } => {
            if state.tax_profiles.remove(id).is_none() {
                return Err("Tax profile no longer exists.".into());
            }
        }
        Change::Calibration {
            id,
            observation_id,
            input,
        } => {
            let c = crate::pay_tax::calibration(state, id, observation_id, input)?;
            state.calibrations.insert(observation_id.clone(), c);
        }
        Change::RemoveCalibration { observation_id } => {
            state.calibrations.remove(observation_id);
        }
        Change::Observation { input } => {
            let o = crate::pay_forecast::observation(input.clone())?;
            state.observations.insert(o.id.clone(), o);
        }
        Change::RemoveObservation { id } => {
            if state.observations.remove(id).is_none() {
                return Err("Known paycheck no longer exists.".into());
            }
            state.calibrations.remove(id);
        }
        Change::Forecast { input } => {
            if state.forecasts.contains_key(&input.id) {
                return Err("A saved forecast is immutable. Save a new version instead.".into());
            }
            let f = crate::pay_forecast::forecast(state, input)?;
            if f.net_cents.is_none() {
                return Err(
                    "Resolve the forecast warnings or choose a manual estimate before saving."
                        .into(),
                );
            }
            state
                .selected_forecasts
                .insert(input.period_id.clone(), input.id.clone());
            state.forecasts.insert(input.id.clone(), f);
        }
        Change::SelectForecast { period_id, id } => {
            if !state.periods.contains_key(period_id) {
                return Err("Pay period no longer exists.".into());
            }
            if let Some(id) = id {
                let f = state
                    .forecasts
                    .get(id)
                    .ok_or("Saved forecast no longer exists.")?;
                if &f.input.period_id != period_id {
                    return Err("Choose a forecast for this period.".into());
                }
                state
                    .selected_forecasts
                    .insert(period_id.clone(), id.clone());
            } else {
                state.selected_forecasts.remove(period_id);
            }
        }
        Change::Calendar { review } => crate::pay_calendar::apply(state, review)?,
        Change::Settings {
            employer,
            usual_week,
        } => {
            text(employer, 100, true)?;
            state.employer = employer.trim().into();
            for (i, hours) in usual_week.iter().enumerate() {
                state.usual_week[i] = fixed(hours, 24 * SCALE)?;
            }
        }
        Change::Rate {
            effective_date,
            hourly_rate,
        } => {
            date(effective_date)?;
            let rate = fixed(hourly_rate, 10_000 * SCALE)?;
            if rate == 0 {
                return Err("Hourly rate must be greater than zero.".into());
            }
            state.rates.insert(effective_date.clone(), rate);
        }
        Change::RemoveRate { effective_date } => {
            date(effective_date)?;
            state.rates.remove(effective_date);
        }
        Change::Days { days } => {
            if days.is_empty() || days.len() > 366 {
                return Err("Save between 1 and 366 daily entries at once.".into());
            }
            let mut seen = BTreeSet::new();
            for input in days {
                date(&input.date)?;
                if !seen.insert(&input.date) {
                    return Err("A day appears more than once in this save.".into());
                }
                text(&input.note, 2000, false)?;
                let day = Day {
                    planned: fixed(&input.planned, 24 * SCALE)?,
                    worked: input
                        .worked
                        .as_deref()
                        .map(|x| fixed(x, 24 * SCALE))
                        .transpose()?,
                    sick: input.sick,
                    planned_sick: input.planned_sick,
                    unpaid: fixed(&input.unpaid, 24 * SCALE)?,
                    note: input.note.trim().into(),
                };
                validate_day(&day)?;
                state.days.insert(input.date.clone(), day);
            }
        }
        Change::Holiday { date: day, name } => {
            let year = date(day)?.year();
            text(name, 120, true)?;
            state.holidays.insert(day.clone(), name.trim().into());
            state.holiday_evidence.remove(day);
            state.holiday_years.remove(&year);
        }
        Change::RemoveHoliday { date: day } => {
            let year = date(day)?.year();
            state.holidays.remove(day);
            state.holiday_evidence.remove(day);
            state.holiday_years.remove(&year);
        }
        Change::Year {
            year,
            opening_sick_used,
            holidays_complete,
        } => {
            if !(1900..=2100).contains(year) || !(0..=40).contains(opening_sick_used) {
                return Err("Choose a year from 1900 to 2100 and 0–40 whole sick hours used outside these records.".into());
            }
            state.opening_sick_used.insert(*year, *opening_sick_used);
            if *holidays_complete {
                state.holiday_years.insert(*year);
            } else {
                state.holiday_years.remove(year);
            }
        }
    }
    validate(state)
}
fn validate_day(day: &Day) -> Result<()> {
    if !(0..=24 * SCALE).contains(&day.planned)
        || !(0..=24 * SCALE).contains(&day.unpaid)
        || day.worked.is_some_and(|x| !(0..=24 * SCALE).contains(&x))
        || !(0..=24).contains(&day.sick)
        || !(0..=24).contains(&day.planned_sick)
        || (day.sick > 0 && day.worked.is_none())
        || day.worked.unwrap_or(0) + day.sick * SCALE + day.unpaid > 24 * SCALE
        || day.planned + day.planned_sick * SCALE + day.unpaid > 24 * SCALE
    {
        return Err("A day cannot exceed 24 hours. Sick time uses whole hours; record worked hours (including 0) when recording sick time.".into());
    }
    text(&day.note, 2000, false)
}
pub fn validate(state: &State) -> Result<()> {
    crate::pay_calendar::validate_state(state)?;
    crate::pay_forecast::validate_state(state)?;
    crate::pay_tax::validate_state(state)?;
    crate::pay_cash::validate_state(state)?;
    text(&state.employer, 100, true)?;
    if state
        .usual_week
        .iter()
        .any(|x| !(0..=24 * SCALE).contains(x))
        || state.days.len() > 73_414
        || state.rates.len() > 2000
        || state.holidays.len() > 10_000
    {
        return Err("Invalid or oversized pay policy/history.".into());
    }
    for (day, rate) in &state.rates {
        date(day)?;
        if !(1..=10_000 * SCALE).contains(rate) {
            return Err("Invalid hourly rate.".into());
        }
    }
    for (day, entry) in &state.days {
        date(day)?;
        validate_day(entry)?;
    }
    for (day, name) in &state.holidays {
        date(day)?;
        text(name, 120, true)?;
    }
    if state
        .holiday_years
        .iter()
        .any(|y| !(1900..=2100).contains(y))
        || state
            .opening_sick_used
            .iter()
            .any(|(y, h)| !(1900..=2100).contains(y) || !(0..=40).contains(h))
    {
        return Err("Invalid yearly sick allowance setup.".into());
    }
    Ok(())
}
pub fn rate_at(state: &State, day: &str) -> Option<i64> {
    state
        .rates
        .range(..=day.to_string())
        .next_back()
        .map(|(_, r)| *r)
}
fn raw_gross(state: &State, day: &str, hours: i64) -> Option<i64> {
    if hours == 0 {
        return Some(0);
    }
    rate_at(state, day)?.checked_mul(hours)
}
fn cents(units: i64) -> i64 {
    (units + 500_000) / 1_000_000
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub date: String,
    pub message: String,
    pub planned: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Week {
    pub start: String,
    pub end: String,
    pub worked: i64,
    pub sick: i64,
    pub forecast_hours: i64,
    pub actual_gross_cents: Option<i64>,
    pub forecast_gross_cents: Option<i64>,
    pub unrecorded_days: usize,
    pub issues: Vec<Issue>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SickYear {
    pub year: i32,
    pub allowance: i64,
    pub opening_used: Option<i64>,
    pub recorded: i64,
    pub reserved: i64,
    pub remaining: Option<i64>,
    pub holidays_complete: bool,
}
fn hours_in_week(state: &State, start: NaiveDate, forecast: bool) -> (i64, i64) {
    let mut worked = 0;
    let mut sick = 0;
    for i in 0..7 {
        if let Some(d) = state.days.get(&(start + Duration::days(i)).to_string()) {
            worked += if forecast {
                d.worked.unwrap_or(d.planned)
            } else {
                d.worked.unwrap_or(0)
            };
            sick += if forecast && d.worked.is_none() {
                d.planned_sick
            } else {
                d.sick
            };
        }
    }
    (worked, sick)
}
pub fn sick_year(state: &State, year: i32) -> SickYear {
    let prefix = format!("{year:04}-");
    let recorded = state
        .days
        .iter()
        .filter(|(d, _)| d.starts_with(&prefix))
        .map(|(_, d)| d.sick)
        .sum::<i64>();
    let reserved = state
        .days
        .iter()
        .filter(|(d, e)| d.starts_with(&prefix) && e.worked.is_none())
        .map(|(_, d)| d.planned_sick)
        .sum::<i64>();
    let opening_used = state.opening_sick_used.get(&year).copied();
    SickYear {
        year,
        allowance: 40,
        opening_used,
        recorded,
        reserved,
        remaining: opening_used.map(|opening| (40 - opening - recorded - reserved).max(0)),
        holidays_complete: state.holiday_years.contains(&year),
    }
}
fn sick_issue(state: &State, day: NaiveDate, planned: bool) -> Option<String> {
    let year = sick_year(state, day.year());
    let (worked, sick) = hours_in_week(state, week_start(day), planned);
    if state.holidays.contains_key(&day.to_string()) {
        return Some("Sick time cannot be used on an official PSW holiday. Worked holiday hours remain payable.".into());
    }
    if worked + sick * SCALE > 40 * SCALE {
        return Some("A week containing sick time cannot exceed 40 paid hours. Actual work has been preserved; review the sick allocation.".into());
    }
    let Some(opening) = year.opening_used else {
        return Some("Confirm sick hours already used outside these records for this year.".into());
    };
    if opening + year.recorded + if planned { year.reserved } else { 0 } > 40 {
        return Some(
            "Sick time exceeds the 40-hour annual allowance. Review recorded or reserved hours."
                .into(),
        );
    }
    if !year.holidays_complete {
        return Some("Review the complete official PSW holiday list for this year before relying on sick pay.".into());
    }
    None
}
pub fn week(state: &State, selected: &str) -> Result<Week> {
    let start = week_start(date(selected)?);
    let mut result = Week {
        start: start.to_string(),
        end: (start + Duration::days(6)).to_string(),
        worked: 0,
        sick: 0,
        forecast_hours: 0,
        actual_gross_cents: Some(0),
        forecast_gross_cents: Some(0),
        unrecorded_days: 0,
        issues: vec![],
    };
    let mut actual_raw = Some(0_i64);
    let mut forecast_raw = Some(0_i64);
    for i in 0..7 {
        let day = start + Duration::days(i);
        let key = day.to_string();
        let entry = state.days.get(&key).cloned().unwrap_or_default();
        result.worked += entry.worked.unwrap_or(0);
        result.sick += entry.sick;
        if entry.worked.is_none() {
            result.unrecorded_days += 1;
        }
        let forecast_sick = if entry.worked.is_none() {
            entry.planned_sick
        } else {
            entry.sick
        };
        let actual_hours = entry.worked.unwrap_or(0) + entry.sick * SCALE;
        let forecast_hours = entry.worked.unwrap_or(entry.planned) + forecast_sick * SCALE;
        result.forecast_hours += forecast_hours;
        actual_raw =
            actual_raw.and_then(|sum| sum.checked_add(raw_gross(state, &key, actual_hours)?));
        forecast_raw =
            forecast_raw.and_then(|sum| sum.checked_add(raw_gross(state, &key, forecast_hours)?));
        if rate_at(state, &key).is_none() && (actual_hours > 0 || forecast_hours > 0) {
            result.issues.push(Issue {
                date: key.clone(),
                message: "Add an hourly rate effective on or before this date.".into(),
                planned: false,
            });
        }
        for (amount, planned) in [(entry.sick, false), (forecast_sick, true)] {
            if amount > 0 {
                if let Some(message) = sick_issue(state, day, planned) {
                    if !planned {
                        actual_raw = None;
                    }
                    forecast_raw = None;
                    if !result
                        .issues
                        .iter()
                        .any(|x| x.date == key && x.message == message)
                    {
                        result.issues.push(Issue {
                            date: key.clone(),
                            message,
                            planned,
                        });
                    }
                }
            }
        }
    }
    result.actual_gross_cents = actual_raw.map(cents);
    result.forecast_gross_cents = forecast_raw.map(cents);
    Ok(result)
}
