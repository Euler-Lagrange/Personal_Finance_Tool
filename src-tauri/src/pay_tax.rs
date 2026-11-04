//! Offline 2026 W-2 withholding. Official-method provenance: PAY_WITHHOLDING_DESIGN.md.
//! Model v1 is immutable for replay. No annual-return or self-employment calculation.
use crate::{
    money,
    pay_forecast::round_ratio,
    payroll::{self, date, SCALE},
};
use chrono::Datelike;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaxMask {
    pub federal: bool,
    pub kentucky: bool,
    pub social_security: bool,
    pub medicare: bool,
    pub local: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Federal {
    pub status: String,
    pub step_two: bool,
    pub credits: String,
    pub other_income: String,
    pub deductions: String,
    pub extra: String,
    pub exempt: bool,
    pub round_dollars: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Deduction {
    pub id: String,
    pub name: String,
    pub method: String,
    pub amount: String,
    pub percent_base: String,
    pub benefits_only: bool,
    pub on_pay_date: Option<String>,
    pub annual_cap: Option<String>,
    pub reduces: TaxMask,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalTax {
    pub id: String,
    pub name: String,
    pub percent: String,
    pub per_pay: String,
    pub wage_cap: Option<String>,
    pub tax_cap: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub year: i32,
    pub effective_date: String,
    pub regime: String,
    pub reviewed: bool,
    pub ordinary_resident_w2: bool,
    pub federal: Federal,
    pub kentucky_exempt: bool,
    pub kentucky_extra: String,
    pub locals_reviewed: bool,
    pub deductions: Vec<Deduction>,
    pub locals: Vec<LocalTax>,
    pub note: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OtherPay {
    pub name: String,
    pub amount: String,
    pub cash: bool,
    pub taxable: TaxMask,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Inputs {
    pub profile_id: String,
    pub ytd_date: String,
    pub ytd_confirmed: bool,
    pub social_security_ytd: Option<String>,
    pub medicare_ytd: Option<String>,
    pub deduction_ytd: BTreeMap<String, String>,
    pub local_wage_ytd: BTreeMap<String, String>,
    pub local_tax_ytd: BTreeMap<String, String>,
    pub other_pay: Vec<OtherPay>,
    pub one_time_deductions: Vec<Deduction>,
    pub deduction_overrides: BTreeMap<String, String>,
    pub calibration_limit: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub pay_date: String,
    pub frequency: String,
    pub benefits: bool,
    pub hourly_gross_cents: i64,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Wages {
    pub federal: i64,
    pub kentucky: i64,
    pub social_security: i64,
    pub medicare: i64,
    pub local: i64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Line {
    pub name: String,
    pub cents: i64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Estimate {
    pub rules: Option<String>,
    pub context: Context,
    pub profile: Profile,
    pub inputs: Inputs,
    pub cash_gross_cents: i64,
    pub noncash_cents: i64,
    pub wages: Wages,
    pub deductions: Vec<Line>,
    pub taxes: Vec<Line>,
    pub net_cents: Option<i64>,
    pub ss_phase: String,
    pub medicare_phase: String,
    pub warnings: Vec<String>,
}
fn name(value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > max {
        Err(format!("Use nonempty text up to {max} characters."))
    } else {
        Ok(())
    }
}
fn id(value: &str) -> Result<()> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| "Use a valid payroll rule identifier.".into())
}
fn amount(value: &str) -> Result<i64> {
    money::cents(value)
}
fn percent(value: &str) -> Result<i64> {
    payroll::fixed(value, 100 * SCALE)
}
pub fn periods(frequency: &str) -> Result<i64> {
    match frequency {
        "weekly" => Ok(52),
        "biweekly" => Ok(26),
        "semimonthly" => Ok(24),
        "monthly" => Ok(12),
        _ => Err("Choose a supported withholding frequency.".into()),
    }
}
fn deduction(d: &Deduction) -> Result<()> {
    id(&d.id)?;
    name(&d.name, 120)?;
    match d.method.as_str() {
        "fixed" => {
            amount(&d.amount)?;
        }
        "percent" => {
            percent(&d.amount)?;
        }
        _ => return Err("Use fixed or percentage deductions.".into()),
    }
    if !["hourlyGross", "cashGross"].contains(&d.percent_base.as_str()) {
        return Err("Choose the deduction percentage base.".into());
    }
    if let Some(day) = &d.on_pay_date {
        date(day)?;
    }
    if let Some(cap) = &d.annual_cap {
        amount(cap)?;
    }
    Ok(())
}
pub fn validate_profile(p: &Profile) -> Result<()> {
    id(&p.id)?;
    name(&p.name, 120)?;
    name(&p.regime, 120)?;
    if !(1900..=2100).contains(&p.year)
        || date(&p.effective_date)?.year() != p.year
        || p.note.len() > 2000
        || p.deductions.len() > 40
        || p.locals.len() > 12
    {
        return Err("Check the profile year, effective date and rule count.".into());
    }
    if !["single", "married", "head"].contains(&p.federal.status.as_str()) {
        return Err("Choose a supported modern W-4 filing status.".into());
    }
    for s in [
        &p.federal.credits,
        &p.federal.other_income,
        &p.federal.deductions,
        &p.federal.extra,
        &p.kentucky_extra,
    ] {
        amount(s)?;
    }
    let mut ids = BTreeSet::new();
    for d in &p.deductions {
        deduction(d)?;
        if !ids.insert(&d.id) {
            return Err("Deduction identifiers must be unique.".into());
        }
        if d.on_pay_date
            .as_ref()
            .is_some_and(|s| !s.starts_with(&format!("{}-", p.year)))
        {
            return Err("One-time deduction dates must match the profile year.".into());
        }
    }
    for l in &p.locals {
        id(&l.id)?;
        name(&l.name, 120)?;
        percent(&l.percent)?;
        amount(&l.per_pay)?;
        if !ids.insert(&l.id) {
            return Err("Payroll rule identifiers must be unique.".into());
        }
        for cap in [&l.wage_cap, &l.tax_cap].into_iter().flatten() {
            amount(cap)?;
        }
    }
    Ok(())
}
fn validate_inputs(i: &Inputs, p: &Profile, c: &Context) -> Result<()> {
    id(&i.profile_id)?;
    if i.profile_id != p.id {
        return Err("Tax inputs belong to a different profile.".into());
    }
    let payday = date(&c.pay_date)?;
    let ytd = date(&i.ytd_date)?;
    if ytd.year() != payday.year() || ytd > payday {
        return Err("YTD context must be in the paid year and no later than the payment.".into());
    }
    if !(0..=money::MAX_CENTS).contains(&c.hourly_gross_cents)
        || i.other_pay.len() > 40
        || i.one_time_deductions.len() > 40
        || i.deduction_ytd.len() > 80
        || i.deduction_overrides.len() > 80
        || i.local_wage_ytd.len() > 12
        || i.local_tax_ytd.len() > 12
    {
        return Err("Payroll inputs exceed supported limits.".into());
    }
    for v in [&i.social_security_ytd, &i.medicare_ytd]
        .into_iter()
        .flatten()
    {
        amount(v)?;
    }
    amount(&i.calibration_limit)?;
    let mut ids: BTreeSet<_> = p.deductions.iter().map(|d| d.id.as_str()).collect();
    for d in &i.one_time_deductions {
        deduction(d)?;
        if !ids.insert(&d.id)
            || d.annual_cap.is_some()
            || d.on_pay_date
                .as_deref()
                .is_some_and(|day| day != c.pay_date)
        {
            return Err(
                "Period-only deductions need unique identifiers, no annual cap and this pay date."
                    .into(),
            );
        }
    }
    for (id, value) in i.deduction_ytd.iter().chain(&i.deduction_overrides) {
        if !ids.contains(id.as_str()) {
            return Err("A deduction input refers to a removed rule.".into());
        }
        amount(value)?;
    }
    let locals: BTreeSet<_> = p.locals.iter().map(|l| l.id.as_str()).collect();
    for (id, value) in i.local_wage_ytd.iter().chain(&i.local_tax_ytd) {
        if !locals.contains(id.as_str()) {
            return Err("A local tax input refers to a removed rule.".into());
        }
        amount(value)?;
    }
    for o in &i.other_pay {
        name(&o.name, 120)?;
        amount(&o.amount)?;
    }
    Ok(())
}
// Tuples are published lower annual adjusted wages ($), annual base tax (cents), rate (%).
// Retain exact published rounded limits, especially Step-2 Single rows.
const MFJ: [(i64, i64, i64); 8] = [
    (0, 0, 0),
    (19300, 0, 10),
    (44100, 248000, 12),
    (120100, 1160000, 22),
    (230700, 3593200, 24),
    (422850, 8204800, 32),
    (531750, 11689600, 35),
    (788000, 20658350, 37),
];
const SINGLE: [(i64, i64, i64); 8] = [
    (0, 0, 0),
    (7500, 0, 10),
    (19900, 124000, 12),
    (57900, 580000, 22),
    (113200, 1796600, 24),
    (209275, 4102400, 32),
    (263725, 5844800, 35),
    (648100, 19297925, 37),
];
const HEAD: [(i64, i64, i64); 8] = [
    (0, 0, 0),
    (15550, 0, 10),
    (33250, 177000, 12),
    (83000, 774000, 22),
    (121250, 1615500, 24),
    (217300, 3920700, 32),
    (271750, 5663100, 35),
    (656150, 19117100, 37),
];
const MFJ_TWO: [(i64, i64, i64); 8] = [
    (0, 0, 0),
    (16100, 0, 10),
    (28500, 124000, 12),
    (66500, 580000, 22),
    (121800, 1796600, 24),
    (217875, 4102400, 32),
    (272325, 5844800, 35),
    (400450, 10329175, 37),
];
const SINGLE_TWO: [(i64, i64, i64); 8] = [
    (0, 0, 0),
    (8050, 0, 10),
    (14250, 62000, 12),
    (33250, 290000, 22),
    (60900, 898300, 24),
    (108938, 2051200, 32),
    (136163, 2922400, 35),
    (328350, 9648963, 37),
];
const HEAD_TWO: [(i64, i64, i64); 8] = [
    (0, 0, 0),
    (12075, 0, 10),
    (20925, 88500, 12),
    (45800, 387000, 22),
    (64925, 807750, 24),
    (112950, 1960350, 32),
    (140175, 2831550, 35),
    (332375, 9558550, 37),
];
pub fn federal(wages: i64, n: i64, f: &Federal) -> Result<i64> {
    if f.exempt {
        return Ok(0);
    }
    let offset = if f.step_two {
        0
    } else if f.status == "married" {
        1_290_000
    } else {
        860_000
    };
    let annual = (wages * n + amount(&f.other_income)? - amount(&f.deductions)? - offset).max(0);
    let rows = match (f.status.as_str(), f.step_two) {
        ("single", false) => &SINGLE,
        ("married", false) => &MFJ,
        ("head", false) => &HEAD,
        ("single", true) => &SINGLE_TWO,
        ("married", true) => &MFJ_TWO,
        ("head", true) => &HEAD_TWO,
        _ => return Err("Unknown W-4 schedule.".into()),
    };
    let &(lower, base, pct) = rows.iter().rev().find(|r| annual >= r.0 * 100).unwrap();
    let annual_hundredths = base as i128 * 100 + (annual - lower * 100) as i128 * pct as i128;
    let after_credit = (annual_hundredths - amount(&f.credits)? as i128 * 100).max(0);
    let tax = round_ratio(after_credit, n as i128 * 100) + amount(&f.extra)?;
    Ok(if f.round_dollars {
        round_ratio(tax as i128, 100) * 100
    } else {
        tax
    })
}
fn add_mask(w: &mut Wages, m: &TaxMask, n: i64) {
    if m.federal {
        w.federal += n;
    }
    if m.kentucky {
        w.kentucky += n;
    }
    if m.social_security {
        w.social_security += n;
    }
    if m.medicare {
        w.medicare += n;
    }
    if m.local {
        w.local += n;
    }
}
fn phase(taxed: i64, wages: i64) -> String {
    if taxed == 0 {
        "none"
    } else if taxed == wages {
        "full"
    } else {
        "partial"
    }
    .into()
}
pub fn estimate(c: &Context, p: &Profile, i: &Inputs) -> Result<Estimate> {
    validate_profile(p)?;
    validate_inputs(i, p, c)?;
    let n = periods(&c.frequency)?;
    let mut out = Estimate {
        rules: None,
        context: c.clone(),
        profile: p.clone(),
        inputs: i.clone(),
        cash_gross_cents: c.hourly_gross_cents,
        noncash_cents: 0,
        wages: Wages::default(),
        deductions: vec![],
        taxes: vec![],
        net_cents: None,
        ss_phase: "unknown".into(),
        medicare_phase: "unknown".into(),
        warnings: vec![],
    };
    if p.year != 2026 || date(&c.pay_date)?.year() != 2026 {
        out.warnings.push("Offline withholding rules are verified only for 2026. Choose a manual or compatible known-pay estimate for another year.".into());
    }
    if p.year != date(&c.pay_date)?.year() || p.effective_date > c.pay_date {
        out.warnings
            .push("This tax profile is not effective for the selected pay date.".into());
    }
    if !p.reviewed || !p.locals_reviewed || !p.ordinary_resident_w2 {
        out.warnings.push("Review the profile, local taxes (including none) and ordinary US-resident modern-W-4 W-2 treatment before using tax estimates.".into());
    }
    if !i.ytd_confirmed || i.social_security_ytd.is_none() || i.medicare_ytd.is_none() {
        out.warnings.push("Confirm same-employer SS and Medicare YTD wages immediately before this payment. Missing YTD is not zero.".into());
    }
    for d in p.deductions.iter().chain(&i.one_time_deductions) {
        let applies = (!d.benefits_only || c.benefits)
            && d.on_pay_date.as_deref().is_none_or(|day| day == c.pay_date);
        if applies && d.annual_cap.is_some() && !i.deduction_ytd.contains_key(&d.id) {
            out.warnings.push(format!(
                "Enter prior YTD usage for capped deduction {}.",
                d.name
            ));
        }
    }
    for l in &p.locals {
        if l.wage_cap.is_some() && !i.local_wage_ytd.contains_key(&l.id) {
            out.warnings
                .push(format!("Enter prior local taxable wages for {}.", l.name));
        }
        if l.tax_cap.is_some() && !i.local_tax_ytd.contains_key(&l.id) {
            out.warnings
                .push(format!("Enter prior local tax withheld for {}.", l.name));
        }
    }
    if !out.warnings.is_empty() {
        return Ok(out);
    }
    out.rules = Some("US-KY-2026-v1".into());
    out.wages = Wages {
        federal: c.hourly_gross_cents,
        kentucky: c.hourly_gross_cents,
        social_security: c.hourly_gross_cents,
        medicare: c.hourly_gross_cents,
        local: c.hourly_gross_cents,
    };
    for other in &i.other_pay {
        let value = amount(&other.amount)?;
        if other.cash {
            out.cash_gross_cents += value;
        } else {
            out.noncash_cents += value;
        }
        add_mask(&mut out.wages, &other.taxable, value);
    }
    if out.cash_gross_cents + out.noncash_cents > money::MAX_CENTS {
        return Err("Combined payroll gross exceeds the supported amount.".into());
    }
    for d in p.deductions.iter().chain(&i.one_time_deductions) {
        if (d.benefits_only && !c.benefits)
            || d.on_pay_date
                .as_deref()
                .is_some_and(|day| day != c.pay_date)
        {
            continue;
        }
        let mut value = if let Some(v) = i.deduction_overrides.get(&d.id) {
            amount(v)?
        } else if d.method == "fixed" {
            amount(&d.amount)?
        } else {
            let base = if d.percent_base == "cashGross" {
                out.cash_gross_cents
            } else {
                c.hourly_gross_cents
            };
            round_ratio(
                base as i128 * percent(&d.amount)? as i128,
                100 * SCALE as i128,
            )
        };
        if let Some(cap) = &d.annual_cap {
            let ytd = amount(&i.deduction_ytd[&d.id])?;
            value = value.min((amount(cap)? - ytd).max(0));
        }
        out.deductions.push(Line {
            name: d.name.clone(),
            cents: value,
        });
        add_mask(&mut out.wages, &d.reduces, -value);
    }
    out.wages.federal = out.wages.federal.max(0);
    out.wages.kentucky = out.wages.kentucky.max(0);
    out.wages.social_security = out.wages.social_security.max(0);
    out.wages.medicare = out.wages.medicare.max(0);
    out.wages.local = out.wages.local.max(0);
    let federal = federal(out.wages.federal, n, &p.federal)?;
    let ky = if p.kentucky_exempt {
        0
    } else {
        round_ratio(
            (out.wages.kentucky * n - 336000).max(0) as i128 * 35,
            n as i128 * 1000,
        ) + amount(&p.kentucky_extra)?
    };
    let ss_ytd = amount(i.social_security_ytd.as_deref().unwrap())?;
    let med_ytd = amount(i.medicare_ytd.as_deref().unwrap())?;
    let ss_wages = out.wages.social_security.min((18_450_000 - ss_ytd).max(0));
    let add_med_wages =
        (med_ytd + out.wages.medicare - 20_000_000).max(0) - (med_ytd - 20_000_000).max(0);
    out.ss_phase = phase(ss_wages, out.wages.social_security);
    out.medicare_phase = phase(add_med_wages, out.wages.medicare);
    out.taxes = vec![
        Line {
            name: "Federal withholding".into(),
            cents: federal,
        },
        Line {
            name: "Kentucky withholding".into(),
            cents: ky,
        },
        Line {
            name: "Social Security".into(),
            cents: round_ratio(ss_wages as i128 * 62, 1000),
        },
        Line {
            name: "Medicare".into(),
            cents: round_ratio(out.wages.medicare as i128 * 145, 10000),
        },
        Line {
            name: "Additional Medicare".into(),
            cents: round_ratio(add_med_wages as i128 * 9, 1000),
        },
    ];
    for l in &p.locals {
        let wages = if let Some(cap) = &l.wage_cap {
            out.wages
                .local
                .min((amount(cap)? - amount(&i.local_wage_ytd[&l.id])?).max(0))
        } else {
            out.wages.local
        };
        let mut tax = round_ratio(
            wages as i128 * percent(&l.percent)? as i128,
            100 * SCALE as i128,
        ) + amount(&l.per_pay)?;
        if let Some(cap) = &l.tax_cap {
            tax = tax.min((amount(cap)? - amount(&i.local_tax_ytd[&l.id])?).max(0));
        }
        out.taxes.push(Line {
            name: format!("{} (configured local)", l.name),
            cents: tax,
        });
    }
    let net = out.cash_gross_cents
        - out.deductions.iter().map(|l| l.cents).sum::<i64>()
        - out.taxes.iter().map(|l| l.cents).sum::<i64>();
    if !(0..=money::MAX_CENTS).contains(&net) {
        out.warnings.push("Deductions/withholding exceed available cash or supported limits. Review the inputs; no precise take-home estimate is saved.".into());
    } else {
        out.net_cents = Some(net);
    }
    out.warnings.push("Payroll withholding estimate, not final annual tax liability. Compare actual payroll rounding and elections; local taxes and tax treatment are configured by you.".into());
    Ok(out)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Calibration {
    pub id: String,
    pub observation: crate::pay_forecast::Observation,
    pub estimate: Estimate,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Correction {
    pub support: Vec<Calibration>,
    pub raw_median_cents: Option<i64>,
    pub applied_cents: Option<i64>,
    pub residual_spread_cents: Option<i64>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaxResult {
    pub estimate: Estimate,
    pub correction: Option<Correction>,
}
pub fn calibration(
    state: &payroll::State,
    comparison_id: &str,
    observation_id: &str,
    i: &Inputs,
) -> Result<Calibration> {
    id(comparison_id)?;
    let o = state
        .observations
        .get(observation_id)
        .ok_or("Choose a known paycheck.")?;
    if !crate::pay_forecast::observation_issues(o).is_empty()
        || o.other_gross_cents != 0
        || o.reimbursement_cents != 0
        || !i.other_pay.is_empty()
        || !i.one_time_deductions.is_empty()
    {
        return Err("Calibration needs a reviewed, reconciled ordinary paycheck, without special pay or one-time deductions.".into());
    }
    let p = state
        .tax_profiles
        .get(&i.profile_id)
        .ok_or("Choose an existing tax profile.")?;
    if !p.regime.eq_ignore_ascii_case(&o.regime) {
        return Err("Use the known paycheck's payroll regime for calibration.".into());
    }
    let e = estimate(
        &Context {
            pay_date: o.pay_date.clone(),
            frequency: o.frequency.clone(),
            benefits: o.benefits,
            hourly_gross_cents: o.gross_cents,
        },
        p,
        i,
    )?;
    if e.net_cents.is_none() {
        return Err(format!(
            "Complete the historical withholding setup first: {}",
            e.warnings.join(" ")
        ));
    }
    Ok(Calibration {
        id: comparison_id.into(),
        observation: o.clone(),
        estimate: e,
    })
}
pub fn calibration_current(state: &payroll::State, c: &Calibration) -> bool {
    state.observations.get(&c.observation.id) == Some(&c.observation)
        && state.tax_profiles.get(&c.estimate.profile.id) == Some(&c.estimate.profile)
}
pub fn correction(
    state: &payroll::State,
    e: &Estimate,
    rate: Option<i64>,
    period_id: &str,
) -> Result<Correction> {
    let mut out = Correction {
        support: vec![],
        raw_median_cents: None,
        applied_cents: None,
        residual_spread_cents: None,
        warnings: vec![],
    };
    if rate.is_none() || !e.inputs.other_pay.is_empty() || !e.inputs.one_time_deductions.is_empty()
    {
        out.warnings.push("Calibration requires one hourly rate and ordinary pay without one-time extras. Use the uncalibrated withholding method.".into());
        return Ok(out);
    }
    let mut seen = BTreeSet::new();
    let mut residuals = vec![];
    for c in state.calibrations.values() {
        let o = &c.observation;
        if !calibration_current(state, c)
            || c.estimate.profile != e.profile
            || Some(o.rate) != rate
            || o.frequency != e.context.frequency
            || o.benefits != e.context.benefits
            || o.pay_date >= e.context.pay_date
            || o.period_id.as_deref() == Some(period_id)
            || date(&o.pay_date)?.year() != date(&e.context.pay_date)?.year()
            || !o.regime.eq_ignore_ascii_case(&e.profile.regime)
            || c.estimate.ss_phase != e.ss_phase
            || c.estimate.medicare_phase != e.medicare_phase
        {
            continue;
        }
        if seen.insert((
            o.pay_date.clone(),
            o.worked,
            o.sick,
            o.gross_cents,
            o.net_cents,
        )) {
            out.support.push(c.clone());
            residuals.push(o.net_cents.unwrap() - c.estimate.net_cents.unwrap());
        }
    }
    if residuals.len() < 2 {
        out.warnings.push("At least two compatible earlier tax comparisons in the same FICA threshold phase are required. Use uncalibrated tax or manual prediction meanwhile.".into());
        return Ok(out);
    }
    residuals.sort();
    let n = residuals.len();
    let raw = if n % 2 == 0 {
        round_ratio(residuals[n / 2 - 1] as i128 + residuals[n / 2] as i128, 2)
    } else {
        residuals[n / 2]
    };
    let limit = amount(&e.inputs.calibration_limit)?;
    out.raw_median_cents = Some(raw);
    out.applied_cents = Some(raw.clamp(-limit, limit));
    out.residual_spread_cents = Some(residuals[n - 1] - residuals[0]);
    if raw.abs() > limit {
        out.warnings.push("The learned correction exceeds the chosen maximum and has been limited. Review deductions and elections before relying on this adjustment.".into());
    }
    if n < 4 {
        out.warnings
            .push("Sparse calibration support: fewer than four compatible prior paychecks.".into());
    }
    out.warnings.push("Calibration is a bounded correction from earlier actuals, not a change to tax rules or a future accuracy guarantee.".into());
    Ok(out)
}
pub fn forecast(
    state: &payroll::State,
    input: &crate::pay_forecast::ForecastInput,
) -> Result<crate::pay_forecast::Forecast> {
    id(&input.id)?;
    name(&input.reason, 2000)?;
    name(&input.regime, 120)?;
    if input.manual_net.is_some() {
        return Err("A tax prediction cannot also contain manual take-home pay.".into());
    }
    let i = input
        .tax
        .as_ref()
        .ok_or("Provide withholding profile and per-paycheck YTD inputs.")?;
    let p = state
        .tax_profiles
        .get(&i.profile_id)
        .ok_or("Choose an existing tax profile.")?;
    if !input.regime.eq_ignore_ascii_case(&p.regime) {
        return Err("Prediction and tax profile regimes must match.".into());
    }
    let period = state
        .periods
        .get(&input.period_id)
        .ok_or("Choose an existing pay period.")?;
    let basis = crate::pay_forecast::period_basis(state, period, input.use_usual)?;
    let mut warnings = basis.warnings.clone();
    warnings.extend(basis.blockers.clone());
    let mut net = None;
    let mut tax = None;
    if let Some(gross) = basis.gross_cents {
        let e = estimate(
            &Context {
                pay_date: period.pay_date.clone(),
                frequency: period.frequency.clone(),
                benefits: period.benefits,
                hourly_gross_cents: gross,
            },
            p,
            i,
        )?;
        warnings.extend(e.warnings.clone());
        net = e.net_cents;
        let mut adjustment = None;
        if input.method == "calibrated" {
            let c = correction(state, &e, basis.uniform_rate, &period.id)?;
            warnings.extend(c.warnings.clone());
            net = net.zip(c.applied_cents).map(|(n, a)| n + a);
            if net.is_some_and(|n| n < 0 || n > e.cash_gross_cents) {
                net = None;
                warnings.push("Calibrated take-home falls outside available cash. Review the correction or use the uncalibrated result.".into());
            }
            adjustment = Some(c);
        }
        tax = Some(TaxResult {
            estimate: e,
            correction: adjustment,
        });
    }
    Ok(crate::pay_forecast::Forecast {
        model_version: 2,
        input: input.clone(),
        basis,
        empirical: None,
        net_cents: net,
        warnings,
        tax,
    })
}
pub fn validate_state(state: &payroll::State) -> Result<()> {
    if state.tax_profiles.len() > 2000 || state.calibrations.len() > 12000 {
        return Err("Tax profile/comparison history exceeds supported limits.".into());
    }
    for (key, p) in &state.tax_profiles {
        validate_profile(p)?;
        if key != &p.id {
            return Err("Tax profile identity mismatch.".into());
        }
    }
    for (key, c) in &state.calibrations {
        id(&c.id)?;
        crate::pay_forecast::validate_observation(&c.observation)?;
        validate_profile(&c.estimate.profile)?;
        if key != &c.observation.id
            || c.observation.net_cents.is_none()
            || c.estimate.net_cents.is_none()
        {
            return Err("Invalid stored tax comparison.".into());
        }
    }
    // Full mathematical and snapshot integrity is enforced by payroll history replay.
    Ok(())
}
