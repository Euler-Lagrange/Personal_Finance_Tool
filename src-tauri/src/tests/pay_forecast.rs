use super::*;
use crate::{
    pay_calendar::{Period, Review},
    pay_forecast::*,
    payroll::{self, Change, State as PayState, SCALE},
};
fn known(day: &str, hours: &str, net: Option<&str>) -> ObservationInput {
    let h = payroll::fixed(hours, 1344 * SCALE).unwrap();
    ObservationInput {
        id: Uuid::new_v4().to_string(),
        period_id: None,
        pay_date: day.into(),
        worked: hours.into(),
        sick: 0,
        rate: "100".into(),
        gross: format!(
            "{}.{:02}",
            gross(100 * SCALE, h) / 100,
            gross(100 * SCALE, h) % 100
        ),
        net: net.map(String::from),
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
    }
}
fn period() -> Period {
    Period {
        id: Uuid::new_v4().to_string(),
        name: "Synthetic two-week payroll".into(),
        pay_date: "2026-11-27".into(),
        weeks: vec!["2026-11-09".into(), "2026-11-16".into()],
        frequency: "biweekly".into(),
        benefits: true,
        note: String::new(),
        evidence: vec![],
    }
}
fn request() -> EmpiricalRequest {
    EmpiricalRequest {
        pay_date: "2026-11-27".into(),
        period_id: None,
        rate: 100 * SCALE,
        frequency: "biweekly".into(),
        benefits: true,
        regime: "Standard".into(),
        gross_cents: 800000,
        extrapolate: false,
    }
}
fn edit(db: &mut Store, c: Change) -> std::result::Result<i64, String> {
    let r = db.payroll_view("2026-11-09", 2026)?.revision;
    db.save_payroll(&Uuid::new_v4().to_string(), r, c)
}
fn init(db: &mut Store) -> Period {
    let p = period();
    edit(
        db,
        Change::Calendar {
            review: Review {
                source_id: None,
                periods: vec![p.clone()],
                holidays: vec![],
                remove_periods: vec![],
                reason: "Synthetic reviewed schedule".into(),
                confirmed: true,
            },
        },
    )
    .unwrap();
    edit(
        db,
        Change::Rate {
            effective_date: "2026-01-01".into(),
            hourly_rate: "100".into(),
        },
    )
    .unwrap();
    edit(
        db,
        Change::Year {
            year: 2026,
            opening_sick_used: 0,
            holidays_complete: true,
        },
    )
    .unwrap();
    p
}
fn prediction(p: &Period, method: &str) -> ForecastInput {
    ForecastInput {
        id: Uuid::new_v4().to_string(),
        period_id: p.id.clone(),
        method: method.into(),
        regime: "Standard".into(),
        manual_net: if method == "manual" {
            Some("5500".into())
        } else {
            None
        },
        reason: "Synthetic planning assumption".into(),
        use_usual: true,
        extrapolate: false,
        tax: None,
    }
}
#[test]
fn known_pay_missing_net_adjustments_and_complete_details_are_facts_not_model_support() {
    let mut a = known("2026-10-02", "80", None);
    assert!(observation_issues(&observation(a.clone()).unwrap())
        .iter()
        .any(|i| i.contains("missing")));
    a.net = Some("0".into());
    assert!(observation_issues(&observation(a.clone()).unwrap()).is_empty());
    a.detail_complete = true;
    a.net = Some("5500".into());
    a.deductions = vec![DeductionInput {
        name: "Withheld".into(),
        amount: "2500".into(),
    }];
    assert!(observation_issues(&observation(a.clone()).unwrap()).is_empty());
    a.deductions[0].amount = "2499.99".into();
    assert!(observation_issues(&observation(a.clone()).unwrap())
        .iter()
        .any(|i| i.contains("reconcile")));
    a.gross = "8001".into();
    assert!(observation_issues(&observation(a.clone()).unwrap())
        .iter()
        .any(|i| i.contains("Hours")));
    a.other_gross = "1".into();
    a.deductions[0].amount = "2501".into();
    assert!(observation_issues(&observation(a.clone()).unwrap()).is_empty());
    assert!(
        empirical(vec![observation(a).unwrap()].into_iter(), &request())
            .unwrap()
            .observations
            .is_empty()
    );
    let zero = observation(known("2026-10-02", "0", Some("0"))).unwrap();
    assert!(empirical(vec![zero].into_iter(), &request())
        .unwrap()
        .observations
        .is_empty());
    assert!(observation(known("2026-02-30", "80", Some("5500"))).is_err());
}
#[test]
fn empirical_cohorts_no_target_future_leak_and_explicit_extrapolation() {
    let low = observation(known("2026-09-04", "70", Some("5000"))).unwrap();
    let high = observation(known("2026-09-18", "90", Some("6000"))).unwrap();
    let mut observations = vec![low.clone(), high.clone()];
    let mut duplicate = low.clone();
    duplicate.id = Uuid::new_v4().to_string();
    observations.push(duplicate);
    for (day, rate, frequency, regime, benefits) in [
        ("2025-09-01", "100", "biweekly", "Standard", true),
        ("2026-11-27", "100", "biweekly", "Standard", true),
        ("2026-12-01", "100", "biweekly", "Standard", true),
        ("2026-10-01", "90", "biweekly", "Standard", true),
        ("2026-10-01", "100", "weekly", "Standard", true),
        ("2026-10-01", "100", "biweekly", "Changed", true),
        ("2026-10-01", "100", "biweekly", "Standard", false),
    ] {
        let mut o = known(day, "80", Some("4000"));
        o.rate = rate.into();
        o.frequency = frequency.into();
        o.regime = regime.into();
        o.benefits = benefits;
        observations.push(observation(o).unwrap());
    }
    let mut r = request();
    let e = empirical(observations.clone().into_iter(), &r).unwrap();
    assert_eq!(e.net_cents, Some(550000));
    assert_eq!(e.observations.len(), 2);
    assert_eq!(e.distinct_gross_points, 2);
    let target = Uuid::new_v4().to_string();
    observations[0].period_id = Some(target.clone());
    observations[2].period_id = Some(target.clone());
    r.period_id = Some(target);
    assert!(empirical(observations.into_iter(), &r)
        .unwrap()
        .net_cents
        .is_none());
    r = request();
    r.gross_cents = 1_000_000;
    assert!(empirical(vec![low.clone(), high.clone()].into_iter(), &r)
        .unwrap()
        .net_cents
        .is_none());
    r.extrapolate = true;
    let e = empirical(vec![low.clone(), high.clone()].into_iter(), &r).unwrap();
    assert_eq!(e.net_cents, Some(650000));
    assert!(e.extrapolated);
    let mut lower = high.clone();
    lower.net_cents = Some(400000);
    assert!(empirical(vec![low.clone(), lower].into_iter(), &request())
        .unwrap()
        .net_cents
        .is_none());
    let mut variant = low.clone();
    variant.id = Uuid::new_v4().to_string();
    variant.pay_date = "2026-09-11".into();
    variant.net_cents = Some(502000);
    let e = empirical(vec![low, variant, high].into_iter(), &request()).unwrap();
    assert_eq!(e.within_point_spread_cents, Some(2000));
    assert_eq!(e.net_cents, Some(550500));
}
#[test]
fn period_rounds_once_uses_actuals_and_rejects_invalid_sick_without_losing_work() {
    let p = period();
    let mut state = PayState::default();
    state.periods.insert(p.id.clone(), p.clone());
    state.rates.insert("2026-01-01".into(), 10_500);
    state.holiday_years.insert(2026);
    state.opening_sick_used.insert(2026, 0);
    for date in ["2026-11-09", "2026-11-16"] {
        state.days.insert(
            date.into(),
            payroll::Day {
                planned: 7 * SCALE,
                worked: Some(40),
                ..Default::default()
            },
        );
    }
    let b = period_basis(&state, &p, false).unwrap();
    assert_eq!(b.gross_cents, Some(1));
    assert_eq!(b.paid_hours, 80);
    assert_eq!(
        payroll::week(&state, "2026-11-09")
            .unwrap()
            .actual_gross_cents,
        Some(0)
    );
    state.rates.insert("2026-11-16".into(), 20_500);
    assert!(period_basis(&state, &p, false)
        .unwrap()
        .uniform_rate
        .is_none());
    state
        .holidays
        .insert("2026-11-10".into(), "Synthetic holiday".into());
    let before = state.clone();
    let b = period_basis(&state, &p, true).unwrap();
    assert!(
        b.days
            .iter()
            .find(|d| d.date == "2026-11-10")
            .unwrap()
            .assumed
    );
    assert_eq!(
        b.days
            .iter()
            .find(|d| d.date == "2026-11-10")
            .unwrap()
            .hours
            .planned,
        0
    );
    assert_eq!(state, before);
    state.days.insert(
        "2026-11-10".into(),
        payroll::Day {
            worked: Some(8 * SCALE),
            sick: 1,
            ..Default::default()
        },
    );
    let b = period_basis(&state, &p, false).unwrap();
    assert!(b.gross_cents.is_none());
    assert_eq!(state.days["2026-11-10"].worked, Some(8 * SCALE));
    assert!(forecast(&state, &prediction(&p, "manual"))
        .unwrap()
        .net_cents
        .is_some());
    assert!(forecast(&state, &prediction(&p, "known"))
        .unwrap()
        .net_cents
        .is_none());
}
#[test]
fn forecast_versions_retry_corrections_and_history_are_stable_without_income() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let p = init(&mut db);
    let low = known("2026-10-02", "70", Some("5000"));
    let high = known("2026-10-16", "90", Some("6000"));
    edit(&mut db, Change::Observation { input: low.clone() }).unwrap();
    edit(
        &mut db,
        Change::Observation {
            input: high.clone(),
        },
    )
    .unwrap();
    let input = prediction(&p, "known");
    let f = db.preview_pay_forecast(input.clone()).unwrap();
    assert_eq!(f.net_cents, Some(550000));
    let revision = db.payroll_view("2026-11-09", 2026).unwrap().revision;
    let op = Uuid::new_v4().to_string();
    let c = Change::Forecast {
        input: input.clone(),
    };
    assert_eq!(
        db.save_payroll(&op, revision, c.clone()).unwrap(),
        revision + 1
    );
    assert_eq!(
        db.save_payroll(&op, revision, c.clone()).unwrap(),
        revision + 1
    );
    assert!(db
        .save_payroll(&Uuid::new_v4().to_string(), revision, c.clone())
        .is_err());
    assert!(edit(&mut db, c).is_err());
    let mut changed = low;
    changed.net = Some("5100".into());
    edit(&mut db, Change::Observation { input: changed }).unwrap();
    let v = db.payroll_view("2026-11-09", 2026).unwrap();
    assert_eq!(v.state.forecasts[&input.id], f);
    assert!(v.forecast_status[0].stale);
    assert_eq!(
        db.preview_pay_forecast(prediction(&p, "known"))
            .unwrap()
            .net_cents,
        Some(555000)
    );
    let mut actual = known(&p.pay_date, "80", Some("5700"));
    actual.period_id = Some(p.id.clone());
    edit(
        &mut db,
        Change::Observation {
            input: actual.clone(),
        },
    )
    .unwrap();
    let v = db.payroll_view("2026-11-09", 2026).unwrap();
    assert_eq!(
        v.forecast_status[0].actual_minus_forecast_cents,
        Some(20000)
    );
    assert_eq!(
        db.preview_pay_forecast(prediction(&p, "known"))
            .unwrap()
            .net_cents,
        Some(555000)
    );
    actual.id = Uuid::new_v4().to_string();
    assert!(edit(&mut db, Change::Observation { input: actual }).is_err());
    let manual = prediction(&p, "manual");
    edit(
        &mut db,
        Change::Forecast {
            input: manual.clone(),
        },
    )
    .unwrap();
    edit(
        &mut db,
        Change::SelectForecast {
            period_id: p.id.clone(),
            id: Some(input.id.clone()),
        },
    )
    .unwrap();
    assert_eq!(
        db.payroll_view("2026-11-09", 2026)
            .unwrap()
            .state
            .selected_forecasts[&p.id],
        input.id
    );
    assert_eq!(db.snapshot(&month()).unwrap().income_cents, 0);
}
#[test]
fn known_source_rows_review_binding_upgrade_restore_and_handoff() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    db.save(expense("100", "jacob")).unwrap();
    let p = init(&mut db);
    let conn = rusqlite::Connection::open(root.path().join("personal.sqlite")).unwrap();
    conn.pragma_update(None, "user_version", 39).unwrap();
    drop(conn);
    drop(db);
    let mut db = Store::open(root.path(), "personal").unwrap();
    let bytes=b"kind,pay_date,hours_worked,sick_hours,hourly_rate,gross_pay,net_pay,frequency,benefits,regime\npay,2026-10-02,80,0,100,8000,,biweekly,yes,Standard\npay,2026-10-16,90,0,100,9000,6000,biweekly,yes,Standard\n".to_vec();
    let prepared = crate::pay_document::prepare("known.csv", &bytes).unwrap();
    let id = db.ingest_pay_source("known.csv", bytes, prepared).unwrap();
    let d = db.pay_source(&id).unwrap();
    assert_eq!(d.document.pay_observations.len(), 2);
    assert!(d.document.pay_observations[0].input.net.is_none());
    let proposal = &d.document.pay_observations[1];
    let mut input = proposal.input.clone();
    input.reviewed = true;
    input.evidence = vec![crate::pay_calendar::Evidence {
        source_id: id.clone(),
        location: proposal.location.clone(),
        quote: proposal.quote.clone(),
    }];
    edit(
        &mut db,
        Change::Observation {
            input: input.clone(),
        },
    )
    .unwrap();
    input.evidence[0].quote = "not in the document".into();
    assert!(edit(&mut db, Change::Observation { input }).is_err());
    let forecast = prediction(&p, "manual");
    edit(
        &mut db,
        Change::Forecast {
            input: forecast.clone(),
        },
    )
    .unwrap();
    let good = db.backup().unwrap();
    let conn = rusqlite::Connection::open(root.path().join("personal.sqlite")).unwrap();
    conn.execute(
        "UPDATE payroll_state SET state_json=json_set(state_json,?1,1)",
        [format!("$.forecasts.\"{}\".netCents", forecast.id)],
    )
    .unwrap();
    let bad = db.backup().unwrap();
    db.restore(&good).unwrap();
    assert!(db.restore(&bad).is_err());
    assert_eq!(
        db.payroll_view("2026-11-09", 2026).unwrap().state.forecasts[&forecast.id].net_cents,
        Some(550000)
    );
    let exported = db
        .export_handoff(
            &Uuid::new_v4().to_string(),
            "Synthetic known pay",
            "synthetic forecast passphrase".into(),
        )
        .unwrap();
    let archive = std::fs::read(exported.path).unwrap();
    let other = tempfile::tempdir().unwrap();
    let mut laptop = Store::open(other.path(), "personal").unwrap();
    let review = laptop
        .preview_handoff(&archive, "synthetic forecast passphrase".into())
        .unwrap();
    laptop
        .apply_handoff(
            &Uuid::new_v4().to_string(),
            &archive,
            "synthetic forecast passphrase".into(),
            &review.token,
            true,
            true,
        )
        .unwrap();
    assert_eq!(
        laptop
            .payroll_view("2026-11-09", 2026)
            .unwrap()
            .state
            .forecasts
            .len(),
        1
    );
    assert_eq!(laptop.snapshot(&month()).unwrap().spent_cents, 7000);
    assert!(Store::open(root.path(), "demo")
        .unwrap()
        .payroll_view("2026-11-09", 2026)
        .unwrap()
        .state
        .observations
        .is_empty());
}
#[test]
fn scenarios_have_no_mutations_and_extra_hour_is_not_average_rate() {
    let mut state = PayState::default();
    for input in [
        known("2026-10-02", "70", Some("5000")),
        known("2026-10-16", "90", Some("6000")),
    ] {
        let o = observation(input).unwrap();
        state.observations.insert(o.id.clone(), o);
    }
    let before = state.clone();
    let rows = scenarios(
        &state,
        &ScenarioInput {
            pay_date: "2026-11-27".into(),
            rate: "100".into(),
            hours: vec!["80".into(), "0".into()],
            frequency: "biweekly".into(),
            benefits: true,
            regime: "Standard".into(),
            extrapolate: false,
        },
    )
    .unwrap();
    assert_eq!(rows[0].estimate.net_cents, Some(550000));
    assert_eq!(rows[0].extra_hour_net_cents, Some(5000));
    assert!(rows[1].estimate.net_cents.is_none());
    assert_eq!(state, before);
    let o = observation(known("2026-10-23", "80", Some("5520"))).unwrap();
    state.observations.insert(o.id.clone(), o);
    let fit = empirical(state.observations.values().cloned(), &request()).unwrap();
    assert_eq!(fit.fit_mae_cents, Some(2000));
    assert_eq!(fit.fit_observation_count, 1);
}
