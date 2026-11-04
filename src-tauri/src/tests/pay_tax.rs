use super::*;
use crate::{
    pay_forecast::{ForecastInput, ObservationInput},
    pay_tax::*,
    payroll::{Change, State as PayState, SCALE},
};
use std::collections::BTreeMap;
fn mask(all: bool) -> TaxMask {
    TaxMask {
        federal: all,
        kentucky: all,
        social_security: all,
        medicare: all,
        local: all,
    }
}
fn profile() -> Profile {
    Profile {
        id: Uuid::new_v4().to_string(),
        name: "Synthetic 2026".into(),
        year: 2026,
        effective_date: "2026-01-01".into(),
        regime: "Standard".into(),
        reviewed: true,
        ordinary_resident_w2: true,
        federal: Federal {
            status: "single".into(),
            step_two: false,
            credits: "0".into(),
            other_income: "0".into(),
            deductions: "0".into(),
            extra: "0".into(),
            exempt: false,
            round_dollars: false,
        },
        kentucky_exempt: false,
        kentucky_extra: "0".into(),
        locals_reviewed: true,
        deductions: vec![],
        locals: vec![],
        note: String::new(),
    }
}
fn inputs(p: &Profile) -> Inputs {
    Inputs {
        profile_id: p.id.clone(),
        ytd_date: "2026-11-01".into(),
        ytd_confirmed: true,
        social_security_ytd: Some("0".into()),
        medicare_ytd: Some("0".into()),
        deduction_ytd: BTreeMap::new(),
        local_wage_ytd: BTreeMap::new(),
        local_tax_ytd: BTreeMap::new(),
        other_pay: vec![],
        one_time_deductions: vec![],
        deduction_overrides: BTreeMap::new(),
        calibration_limit: "250".into(),
    }
}
fn context() -> Context {
    Context {
        pay_date: "2026-11-27".into(),
        frequency: "biweekly".into(),
        benefits: true,
        hourly_gross_cents: 400000,
    }
}
fn line(e: &Estimate, name: &str) -> i64 {
    e.taxes.iter().find(|l| l.name == name).unwrap().cents
}
fn rule() -> Deduction {
    Deduction {
        id: Uuid::new_v4().to_string(),
        name: "Synthetic benefit".into(),
        method: "fixed".into(),
        amount: "100".into(),
        percent_base: "hourlyGross".into(),
        benefits_only: true,
        on_pay_date: None,
        annual_cap: None,
        reduces: mask(true),
    }
}
#[test]
fn withholding_six_official_schedules_frequency_credits_and_rounding() {
    let p = profile();
    let mut f = p.federal;
    // Independent Worksheet 1A arithmetic for $4,000 wages (documented in design/QA).
    for (status, two, expected) in [
        ("single", false, 54038),
        ("married", false, 31231),
        ("head", false, 40262),
        ("single", true, 74335),
        ("married", true, 54038),
        ("head", true, 67137),
    ] {
        f.status = status.into();
        f.step_two = two;
        assert_eq!(
            federal(400000, 26, &f).unwrap(),
            expected,
            "{status} Step2={two}"
        );
    }
    f.status = "single".into();
    f.step_two = false;
    assert_eq!(federal(400000, 12, &f).unwrap(), 29833);
    assert_eq!(federal(400000, 24, &f).unwrap(), 51208);
    assert_eq!(federal(400000, 52, &f).unwrap(), 74335);
    f.credits = "50000".into();
    f.extra = "25".into();
    assert_eq!(federal(400000, 26, &f).unwrap(), 2500);
    f.credits = "0".into();
    f.extra = "0".into();
    f.other_income = "2600".into();
    f.deductions = "2600".into();
    assert_eq!(federal(400000, 26, &f).unwrap(), 54038);
    f.round_dollars = true;
    assert_eq!(federal(400000, 26, &f).unwrap(), 54000);
    f.exempt = true;
    assert_eq!(federal(400000, 26, &f).unwrap(), 0);
}
#[test]
fn withholding_bracket_edges_and_kentucky_formula_discrepancy() {
    let mut p = profile();
    let i = inputs(&p);
    let mut c = context();
    // Single standard zero-band ends at adjusted annual $7,500; +$8,600 offset.
    assert_eq!(federal(1_610_000, 1, &p.federal).unwrap(), 0);
    assert_eq!(federal(1_610_005, 1, &p.federal).unwrap(), 1);
    assert_eq!(federal(2_850_000, 1, &p.federal).unwrap(), 124000);
    assert_eq!(federal(2_850_005, 1, &p.federal).unwrap(), 124001);
    p.federal.step_two = true;
    assert_eq!(federal(32_835_000, 1, &p.federal).unwrap(), 9648963);
    c.frequency = "monthly".into();
    c.hourly_gross_cents = 327000;
    assert_eq!(
        line(&estimate(&c, &p, &i).unwrap(), "Kentucky withholding"),
        10465
    );
    c.frequency = "biweekly".into();
    c.hourly_gross_cents = 150000;
    assert_eq!(
        line(&estimate(&c, &p, &i).unwrap(), "Kentucky withholding"),
        4798
    );
    c.hourly_gross_cents = 1000;
    assert_eq!(
        line(&estimate(&c, &p, &i).unwrap(), "Kentucky withholding"),
        0
    );
    p.kentucky_extra = "12.50".into();
    assert_eq!(
        line(&estimate(&c, &p, &i).unwrap(), "Kentucky withholding"),
        1250
    );
    p.kentucky_exempt = true;
    assert_eq!(
        line(&estimate(&c, &p, &i).unwrap(), "Kentucky withholding"),
        0
    );
}
#[test]
fn withholding_fica_ytd_crossings_zero_missing_unsupported_and_negative_cash() {
    let p = profile();
    let mut i = inputs(&p);
    let c = context();
    let e = estimate(&c, &p, &i).unwrap();
    assert_eq!(e.net_cents, Some(301814));
    assert_eq!(line(&e, "Social Security"), 24800);
    assert_eq!(line(&e, "Medicare"), 5800);
    i.social_security_ytd = Some("183500".into());
    i.medicare_ytd = Some("199000".into());
    let e = estimate(&c, &p, &i).unwrap();
    assert_eq!(line(&e, "Social Security"), 6200);
    assert_eq!(line(&e, "Additional Medicare"), 2700);
    assert_eq!(e.ss_phase, "partial");
    assert_eq!(e.medicare_phase, "partial");
    i.social_security_ytd = Some("184500".into());
    i.medicare_ytd = Some("200000".into());
    let e = estimate(&c, &p, &i).unwrap();
    assert_eq!(line(&e, "Social Security"), 0);
    assert_eq!(line(&e, "Additional Medicare"), 3600);
    i.social_security_ytd = None;
    assert!(estimate(&c, &p, &i).unwrap().net_cents.is_none());
    i = inputs(&p);
    i.ytd_confirmed = false;
    assert!(estimate(&c, &p, &i).unwrap().net_cents.is_none());
    i = inputs(&p);
    i.ytd_date = "2027-01-01".into();
    assert!(estimate(&c, &p, &i).is_err());
    let mut future = p.clone();
    future.year = 2027;
    future.effective_date = "2027-01-01".into();
    let mut next = c.clone();
    next.pay_date = "2027-02-01".into();
    assert!(estimate(&next, &future, &i).unwrap().net_cents.is_none());
    let mut incomplete = p.clone();
    incomplete.locals_reviewed = false;
    assert!(estimate(&c, &incomplete, &inputs(&incomplete))
        .unwrap()
        .net_cents
        .is_none());
    let mut zero = c.clone();
    zero.hourly_gross_cents = 0;
    assert_eq!(estimate(&zero, &p, &inputs(&p)).unwrap().net_cents, Some(0));
    incomplete = p.clone();
    incomplete.federal.extra = "10000".into();
    assert!(estimate(&c, &incomplete, &inputs(&incomplete))
        .unwrap()
        .net_cents
        .is_none());
}
#[test]
fn withholding_tax_specific_bases_percentage_caps_other_pay_and_one_time() {
    let mut p = profile();
    let mut retirement = rule();
    retirement.name = "Retirement".into();
    retirement.method = "percent".into();
    retirement.amount = "5".into();
    retirement.reduces.social_security = false;
    retirement.reduces.medicare = false;
    retirement.reduces.local = false;
    p.deductions = vec![retirement.clone(), rule()];
    let mut i = inputs(&p);
    let c = context();
    i.other_pay = vec![
        OtherPay {
            name: "Expense reimbursement".into(),
            amount: "100".into(),
            cash: true,
            taxable: mask(false),
        },
        OtherPay {
            name: "Noncash benefit".into(),
            amount: "50".into(),
            cash: false,
            taxable: mask(true),
        },
    ];
    let e = estimate(&c, &p, &i).unwrap();
    assert_eq!(e.cash_gross_cents, 410000);
    assert_eq!(e.noncash_cents, 5000);
    assert_eq!(e.wages.federal, 375000);
    assert_eq!(e.wages.kentucky, 375000);
    assert_eq!(e.wages.social_security, 395000);
    assert_eq!(e.wages.local, 395000);
    assert_eq!(e.deductions[0].cents, 20000);
    assert_eq!(
        e.net_cents,
        Some(
            e.cash_gross_cents
                - e.deductions.iter().map(|l| l.cents).sum::<i64>()
                - e.taxes.iter().map(|l| l.cents).sum::<i64>()
        )
    );
    p.deductions[0].percent_base = "cashGross".into();
    assert_eq!(estimate(&c, &p, &i).unwrap().deductions[0].cents, 20500);
    p.deductions[0].annual_cap = Some("1000".into());
    assert!(estimate(&c, &p, &i).unwrap().net_cents.is_none());
    i.deduction_ytd.insert(retirement.id.clone(), "990".into());
    assert_eq!(estimate(&c, &p, &i).unwrap().deductions[0].cents, 1000);
    let mut once = rule();
    once.name = "One time".into();
    once.benefits_only = false;
    once.amount = "10".into();
    once.on_pay_date = Some(c.pay_date.clone());
    i.one_time_deductions.push(once);
    i.deduction_overrides
        .insert(p.deductions[1].id.clone(), "20".into());
    let e = estimate(&c, &p, &i).unwrap();
    assert_eq!(e.deductions.iter().map(|l| l.cents).sum::<i64>(), 4000);
    let local = LocalTax {
        id: Uuid::new_v4().to_string(),
        name: "Configured city".into(),
        percent: "2".into(),
        per_pay: "1".into(),
        wage_cap: Some("50000".into()),
        tax_cap: Some("1000".into()),
    };
    p.locals.push(local.clone());
    assert!(estimate(&c, &p, &i).unwrap().net_cents.is_none());
    i.local_wage_ytd.insert(local.id.clone(), "49000".into());
    i.local_tax_ytd.insert(local.id.clone(), "990".into());
    assert_eq!(
        line(
            &estimate(&c, &p, &i).unwrap(),
            "Configured city (configured local)"
        ),
        1000
    );
}
#[test]
fn withholding_deduction_holidays_do_not_require_unused_cap_context() {
    let mut p = profile();
    let mut d = rule();
    d.annual_cap = Some("1000".into());
    p.deductions.push(d);
    let mut c = context();
    c.benefits = false;
    let e = estimate(&c, &p, &inputs(&p)).unwrap();
    assert_eq!(e.net_cents, Some(301814));
    assert!(e.deductions.is_empty());
}
fn known(day: &str, net: i64) -> crate::pay_forecast::Observation {
    crate::pay_forecast::observation(ObservationInput {
        id: Uuid::new_v4().to_string(),
        period_id: None,
        pay_date: day.into(),
        worked: "40".into(),
        sick: 0,
        rate: "100".into(),
        gross: "4000".into(),
        net: Some(format!("{}.{:02}", net / 100, net % 100)),
        other_gross: "0".into(),
        reimbursement: "0".into(),
        deductions: vec![],
        detail_complete: false,
        frequency: "biweekly".into(),
        benefits: true,
        regime: "Standard".into(),
        reviewed: true,
        evidence: vec![],
        note: String::new(),
    })
    .unwrap()
}
#[test]
fn withholding_calibration_is_bounded_past_only_and_excludes_changed_profiles_and_phases() {
    let p = profile();
    let i = inputs(&p);
    let mut state = PayState::default();
    state.tax_profiles.insert(p.id.clone(), p.clone());
    for (day, net) in [
        ("2026-10-02", 311814),
        ("2026-10-16", 313814),
        ("2026-11-27", 380000),
        ("2026-12-11", 380000),
    ] {
        let o = known(day, net);
        let id = o.id.clone();
        state.observations.insert(id.clone(), o);
        let mut historical = i.clone();
        historical.ytd_date = day.into();
        let comparison =
            calibration(&state, &Uuid::new_v4().to_string(), &id, &historical).unwrap();
        state.calibrations.insert(id, comparison);
    }
    let mut i = i;
    i.calibration_limit = "50".into();
    let e = estimate(&context(), &p, &i).unwrap();
    let c = correction(&state, &e, Some(100 * SCALE), "target").unwrap();
    assert_eq!(c.support.len(), 2);
    assert_eq!(c.raw_median_cents, Some(11000));
    assert_eq!(c.applied_cents, Some(5000));
    assert_eq!(c.residual_spread_cents, Some(2000));
    let old_id = state
        .observations
        .values()
        .find(|o| o.pay_date == "2026-10-02")
        .unwrap()
        .id
        .clone();
    state.observations.get_mut(&old_id).unwrap().net_cents = Some(305000);
    assert!(correction(&state, &e, Some(100 * SCALE), "target")
        .unwrap()
        .applied_cents
        .is_none());
    let mut changed = p.clone();
    changed.federal.extra = "1".into();
    state.tax_profiles.insert(p.id.clone(), changed);
    assert_eq!(
        correction(&state, &e, Some(100 * SCALE), "target")
            .unwrap()
            .support
            .len(),
        0
    );
    state.tax_profiles.insert(p.id.clone(), p.clone());
    let mut after = i;
    after.social_security_ytd = Some("190000".into());
    let e = estimate(&context(), &p, &after).unwrap();
    assert!(correction(&state, &e, Some(100 * SCALE), "target")
        .unwrap()
        .support
        .is_empty());
}
#[test]
fn withholding_history_v40_upgrade_old_predictions_and_corrupt_restore() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let period = crate::pay_calendar::Period {
        id: Uuid::new_v4().to_string(),
        name: "Synthetic pay".into(),
        pay_date: "2026-11-27".into(),
        weeks: vec!["2026-11-16".into()],
        frequency: "biweekly".into(),
        benefits: true,
        note: String::new(),
        evidence: vec![],
    };
    let edit = |db: &mut Store, c| {
        let r = db.payroll_view("2026-11-16", 2026).unwrap().revision;
        db.save_payroll(&Uuid::new_v4().to_string(), r, c).unwrap();
    };
    edit(
        &mut db,
        Change::Calendar {
            review: crate::pay_calendar::Review {
                source_id: None,
                periods: vec![period.clone()],
                holidays: vec![],
                remove_periods: vec![],
                reason: "Fixture".into(),
                confirmed: true,
            },
        },
    );
    edit(
        &mut db,
        Change::Rate {
            effective_date: "2026-01-01".into(),
            hourly_rate: "100".into(),
        },
    );
    let f = ForecastInput {
        id: Uuid::new_v4().to_string(),
        period_id: period.id.clone(),
        method: "manual".into(),
        regime: "Standard".into(),
        manual_net: Some("3000".into()),
        reason: "Historical manual".into(),
        use_usual: true,
        extrapolate: false,
        tax: None,
    };
    edit(&mut db, Change::Forecast { input: f.clone() });
    let conn = rusqlite::Connection::open(root.path().join("personal.sqlite")).unwrap();
    let raw: String = conn
        .query_row("SELECT state_json FROM payroll_state", [], |r| r.get(0))
        .unwrap();
    assert!(!raw.contains("taxProfiles"));
    assert!(!raw.contains("\"tax\""));
    conn.pragma_update(None, "user_version", 40).unwrap();
    drop(conn);
    drop(db);
    let mut db = Store::open(root.path(), "personal").unwrap();
    let good_old = db.backup().unwrap();
    db.restore(&good_old).unwrap();
    assert_eq!(
        db.payroll_view("2026-11-16", 2026).unwrap().state.forecasts[&f.id].model_version,
        1
    );
    let p = profile();
    edit(&mut db, Change::TaxProfile { profile: p.clone() });
    let mut f2 = f.clone();
    f2.id = Uuid::new_v4().to_string();
    f2.method = "tax".into();
    f2.manual_net = None;
    f2.tax = Some(inputs(&p));
    edit(&mut db, Change::Forecast { input: f2.clone() });
    let v = db.payroll_view("2026-11-16", 2026).unwrap();
    assert_eq!(v.state.forecasts[&f2.id].net_cents, Some(301814));
    assert_eq!(v.state.forecasts[&f2.id].model_version, 2);
    let mut changed = p.clone();
    changed.federal.extra = "10".into();
    edit(&mut db, Change::TaxProfile { profile: changed });
    let v = db.payroll_view("2026-11-16", 2026).unwrap();
    assert!(
        v.forecast_status
            .iter()
            .find(|s| s.id == f2.id)
            .unwrap()
            .stale
    );
    assert_eq!(v.state.forecasts[&f2.id].net_cents, Some(301814));
    assert_eq!(db.snapshot(&month()).unwrap().income_cents, 0);
    let good = db.backup().unwrap();
    let conn = rusqlite::Connection::open(root.path().join("personal.sqlite")).unwrap();
    conn.execute(
        "UPDATE payroll_state SET state_json=json_set(state_json,?1,'999')",
        [format!("$.taxProfiles.\"{}\".federal.extra", p.id)],
    )
    .unwrap();
    let bad = db.backup().unwrap();
    db.restore(&good).unwrap();
    assert!(db.restore(&bad).is_err());
    assert!(Store::open(root.path(), "demo")
        .unwrap()
        .payroll_view("2026-11-16", 2026)
        .unwrap()
        .state
        .tax_profiles
        .is_empty());
}

#[test]
fn withholding_comparisons_retry_replay_and_encrypted_handoff_without_income() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let p = profile();
    let mut revision = db
        .save_payroll(
            &Uuid::new_v4().to_string(),
            0,
            Change::TaxProfile { profile: p.clone() },
        )
        .unwrap();
    let input = ObservationInput {
        id: Uuid::new_v4().to_string(),
        period_id: None,
        pay_date: "2026-10-16".into(),
        worked: "40".into(),
        sick: 0,
        rate: "100".into(),
        gross: "4000".into(),
        net: Some("3100".into()),
        other_gross: "0".into(),
        reimbursement: "0".into(),
        deductions: vec![],
        detail_complete: false,
        frequency: "biweekly".into(),
        benefits: true,
        regime: "Standard".into(),
        reviewed: true,
        evidence: vec![],
        note: String::new(),
    };
    revision = db
        .save_payroll(
            &Uuid::new_v4().to_string(),
            revision,
            Change::Observation {
                input: input.clone(),
            },
        )
        .unwrap();
    let mut i = inputs(&p);
    i.ytd_date = "2026-10-16".into();
    let operation = Uuid::new_v4().to_string();
    let change = Change::Calibration {
        id: Uuid::new_v4().to_string(),
        observation_id: input.id.clone(),
        input: i,
    };
    let next = db
        .save_payroll(&operation, revision, change.clone())
        .unwrap();
    assert_eq!(db.save_payroll(&operation, revision, change).unwrap(), next);
    let before = db.payroll_view("2026-11-16", 2026).unwrap();
    assert!(before.calibration_current[&input.id]);
    assert_eq!(
        before.state.calibrations[&input.id].estimate.net_cents,
        Some(301814)
    );
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    let archive = db
        .export_handoff(
            &Uuid::new_v4().to_string(),
            "Synthetic tax profile",
            "synthetic withholding password".into(),
        )
        .unwrap();
    let bytes = std::fs::read(archive.path).unwrap();
    let other = tempfile::tempdir().unwrap();
    let mut laptop = Store::open(other.path(), "personal").unwrap();
    let preview = laptop
        .preview_handoff(&bytes, "synthetic withholding password".into())
        .unwrap();
    laptop
        .apply_handoff(
            &Uuid::new_v4().to_string(),
            &bytes,
            "synthetic withholding password".into(),
            &preview.token,
            true,
            true,
        )
        .unwrap();
    assert_eq!(
        laptop.payroll_view("2026-11-16", 2026).unwrap().state,
        before.state
    );
    assert_eq!(laptop.snapshot(&month()).unwrap().income_cents, 0);
    let mut corrected = input.clone();
    corrected.net = Some("3120".into());
    laptop
        .save_payroll(
            &Uuid::new_v4().to_string(),
            next,
            Change::Observation { input: corrected },
        )
        .unwrap();
    let after = laptop.payroll_view("2026-11-16", 2026).unwrap();
    assert!(!after.calibration_current[&input.id]);
    assert_eq!(
        after.state.calibrations[&input.id].observation.net_cents,
        Some(310000)
    );
    let saved = laptop.backup().unwrap();
    laptop.restore(&saved).unwrap();
    assert_eq!(laptop.snapshot(&month()).unwrap().income_cents, 0);
}
