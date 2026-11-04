use super::*;
use crate::payroll::{Change, DayInput, SCALE};
fn edit(db: &mut Store, change: Change) {
    let revision = db.payroll_view("2026-11-02", 2026).unwrap().revision;
    db.save_payroll(&Uuid::new_v4().to_string(), revision, change)
        .unwrap();
}
fn setup(db: &mut Store) {
    edit(
        db,
        Change::Rate {
            effective_date: "2026-01-01".into(),
            hourly_rate: "93".into(),
        },
    );
    edit(
        db,
        Change::Year {
            year: 2026,
            opening_sick_used: 0,
            holidays_complete: true,
        },
    );
}
fn day(date: &str, worked: Option<&str>, sick: i64) -> DayInput {
    DayInput {
        date: date.into(),
        planned: "0".into(),
        worked: worked.map(String::from),
        sick,
        planned_sick: 0,
        unpaid: "0".into(),
        note: String::new(),
    }
}
fn days(db: &mut Store, entries: Vec<DayInput>) {
    edit(db, Change::Days { days: entries });
}
#[test]
fn payroll_single_hour_exhaustion_and_calendar_corrections_reopen_review() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    setup(&mut db);
    edit(
        &mut db,
        Change::Year {
            year: 2026,
            opening_sick_used: 39,
            holidays_complete: true,
        },
    );
    days(
        &mut db,
        vec![
            day("2026-11-02", Some("8"), 0),
            day("2026-11-03", Some("8"), 0),
            day("2026-11-04", Some("8"), 0),
            day("2026-11-05", Some("8"), 0),
            day("2026-11-06", Some("7"), 1),
        ],
    );
    let v = db.payroll_view("2026-11-06", 2026).unwrap();
    assert_eq!(v.week.actual_gross_cents, Some(372000));
    assert_eq!(v.sick_year.remaining, Some(0));
    let mut future = day("2026-11-09", None, 0);
    future.planned_sick = 1;
    days(&mut db, vec![future]);
    assert!(db
        .payroll_view("2026-11-09", 2026)
        .unwrap()
        .week
        .issues
        .iter()
        .any(|x| x.message.contains("annual allowance")));
    assert_eq!(
        db.payroll_view("2026-11-06", 2026)
            .unwrap()
            .week
            .actual_gross_cents,
        Some(372000)
    );
    edit(
        &mut db,
        Change::Holiday {
            date: "2026-11-06".into(),
            name: "Corrected official holiday".into(),
        },
    );
    let v = db.payroll_view("2026-11-06", 2026).unwrap();
    assert_eq!(v.week.worked, 39 * SCALE);
    assert_eq!(v.week.actual_gross_cents, None);
    assert!(!v.sick_year.holidays_complete);
    assert_eq!(v.state.days["2026-11-06"].sick, 1);
    let revision = v.revision;
    assert!(db
        .save_payroll(
            &Uuid::new_v4().to_string(),
            revision,
            Change::Days {
                days: vec![day("2026-11-10", Some("24"), 1)]
            }
        )
        .is_err());
    assert_eq!(
        db.payroll_view("2026-11-06", 2026).unwrap().revision,
        revision
    );
    assert!(serde_json::from_str::<DayInput>(r#"{"date":"2026-11-10","planned":"0","worked":"7","sick":0.5,"plannedSick":0,"unpaid":"0","note":""}"#).is_err());
}
#[test]
fn payroll_straight_time_sick_rules_preserve_actual_work_and_never_record_income() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    setup(&mut db);
    days(
        &mut db,
        vec![
            day("2026-11-02", Some("8"), 0),
            day("2026-11-03", Some("8"), 0),
            day("2026-11-04", Some("8"), 0),
            day("2026-11-05", Some("8"), 0),
            day("2026-11-06", Some("0"), 8),
        ],
    );
    let v = db.payroll_view("2026-11-03", 2026).unwrap();
    assert_eq!(
        (v.week.worked, v.week.sick, v.week.actual_gross_cents),
        (32 * SCALE, 8, Some(372000))
    );
    assert_eq!(v.sick_year.remaining, Some(32));
    assert!(v.week.issues.is_empty());
    days(&mut db, vec![day("2026-11-06", Some("9"), 8)]);
    let v = db.payroll_view("2026-11-03", 2026).unwrap();
    assert_eq!(v.week.worked, 41 * SCALE);
    assert_eq!(v.week.actual_gross_cents, None);
    assert!(v
        .week
        .issues
        .iter()
        .any(|x| x.message.contains("40 paid hours")));
    days(&mut db, vec![day("2026-11-06", Some("13"), 0)]);
    assert_eq!(
        db.payroll_view("2026-11-03", 2026)
            .unwrap()
            .week
            .actual_gross_cents,
        Some(418500)
    );
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
    assert_eq!(db.snapshot("2026-11").unwrap().income_cents, 0);
}
#[test]
fn payroll_plans_are_distinct_from_actuals_and_holidays_block_only_sick_time() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    setup(&mut db);
    edit(
        &mut db,
        Change::Holiday {
            date: "2026-11-06".into(),
            name: "Synthetic PSW holiday".into(),
        },
    );
    edit(
        &mut db,
        Change::Year {
            year: 2026,
            opening_sick_used: 0,
            holidays_complete: true,
        },
    );
    let mut planned = day("2026-11-02", None, 0);
    planned.planned = "8".into();
    planned.planned_sick = 1;
    days(&mut db, vec![planned, day("2026-11-06", Some("8"), 0)]);
    let v = db.payroll_view("2026-11-02", 2026).unwrap();
    assert_eq!(v.week.actual_gross_cents, Some(74400));
    assert_eq!(v.week.forecast_gross_cents, Some(158100));
    assert_eq!(v.sick_year.reserved, 1);
    days(
        &mut db,
        vec![
            day("2026-11-02", Some("7"), 1),
            day("2026-11-06", Some("8"), 1),
        ],
    );
    let v = db.payroll_view("2026-11-02", 2026).unwrap();
    assert_eq!(v.week.worked, 15 * SCALE);
    assert_eq!(v.week.actual_gross_cents, None);
    assert_eq!(v.sick_year.reserved, 0);
    assert!(v
        .week
        .issues
        .iter()
        .any(|x| x.date == "2026-11-06" && x.message.contains("official PSW holiday")));
}
#[test]
fn payroll_year_reset_keeps_one_cross_year_weekly_cap_and_exposes_missing_setup() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    setup(&mut db);
    edit(
        &mut db,
        Change::Year {
            year: 2026,
            opening_sick_used: 40,
            holidays_complete: true,
        },
    );
    days(
        &mut db,
        vec![
            day("2026-12-28", Some("8"), 0),
            day("2026-12-29", Some("8"), 0),
            day("2026-12-30", Some("8"), 0),
            day("2026-12-31", Some("8"), 0),
            day("2027-01-01", Some("0"), 8),
        ],
    );
    assert!(db
        .payroll_view("2027-01-01", 2027)
        .unwrap()
        .week
        .issues
        .iter()
        .any(|x| x.message.contains("Confirm sick hours")));
    edit(
        &mut db,
        Change::Year {
            year: 2027,
            opening_sick_used: 0,
            holidays_complete: true,
        },
    );
    let v = db.payroll_view("2027-01-01", 2027).unwrap();
    assert_eq!(v.week.start, "2026-12-28");
    assert_eq!(v.week.actual_gross_cents, Some(372000));
    assert_eq!(v.sick_year.remaining, Some(32));
    assert_eq!(
        db.payroll_view("2027-01-01", 2026)
            .unwrap()
            .sick_year
            .remaining,
        Some(0)
    );
    days(&mut db, vec![day("2027-01-02", Some("1"), 0)]);
    assert!(db
        .payroll_view("2027-01-01", 2027)
        .unwrap()
        .week
        .issues
        .iter()
        .any(|x| x.message.contains("40 paid hours")));
}
#[test]
fn payroll_rate_history_decimal_rounding_missing_values_and_atomic_retries() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    days(
        &mut db,
        vec![
            day("2026-11-02", Some("0.0001"), 0),
            day("2026-11-03", Some("0.0001"), 0),
            day("2026-11-04", Some("0.0001"), 0),
            day("2026-11-05", Some("0.0001"), 0),
            day("2026-11-06", Some("0.0001"), 0),
            day("2026-11-07", Some("0.0001"), 0),
            day("2026-11-08", Some("0.0001"), 0),
        ],
    );
    assert_eq!(
        db.payroll_view("2026-11-02", 2026)
            .unwrap()
            .week
            .actual_gross_cents,
        None
    );
    edit(
        &mut db,
        Change::Rate {
            effective_date: "2026-11-02".into(),
            hourly_rate: "10".into(),
        },
    );
    assert_eq!(
        db.payroll_view("2026-11-02", 2026)
            .unwrap()
            .week
            .actual_gross_cents,
        Some(1)
    );
    edit(
        &mut db,
        Change::Rate {
            effective_date: "2026-11-05".into(),
            hourly_rate: "93".into(),
        },
    );
    days(
        &mut db,
        vec![
            day("2026-11-04", Some("8"), 0),
            day("2026-11-05", Some("8"), 0),
        ],
    );
    assert_eq!(
        db.payroll_view("2026-11-02", 2026)
            .unwrap()
            .week
            .actual_gross_cents,
        Some(82403)
    );
    let base = db.payroll_view("2026-11-02", 2026).unwrap().revision;
    let op = Uuid::new_v4().to_string();
    let change = Change::Holiday {
        date: "2026-11-26".into(),
        name: "Synthetic holiday".into(),
    };
    assert_eq!(
        db.save_payroll(&op, base, change.clone()).unwrap(),
        base + 1
    );
    assert_eq!(db.save_payroll(&op, base, change).unwrap(), base + 1);
    assert!(db
        .save_payroll(
            &op,
            base,
            Change::RemoveHoliday {
                date: "2026-11-26".into()
            }
        )
        .is_err());
    assert!(db
        .save_payroll(
            &Uuid::new_v4().to_string(),
            base,
            Change::Days {
                days: vec![day("2026-11-02", Some("8"), 0)]
            }
        )
        .is_err());
    let mut bad = day("2026-11-03", Some("24"), 1);
    bad.planned = "-1".into();
    assert!(db
        .save_payroll(
            &Uuid::new_v4().to_string(),
            base + 1,
            Change::Days {
                days: vec![day("2026-11-02", Some("8"), 0), bad]
            }
        )
        .is_err());
    assert_eq!(
        db.payroll_view("2026-11-02", 2026).unwrap().state.days["2026-11-02"].worked,
        Some(1)
    );
}
#[test]
fn payroll_upgrade_restore_handoff_and_history_integrity_preserve_finances() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    db.save(expense("100", "jacob")).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(root.path().join("personal.sqlite")).unwrap();
    super::remove_payroll_schema(&conn);
    conn.pragma_update(None, "user_version", 37).unwrap();
    drop(conn);
    let mut db = Store::open(root.path(), "personal").unwrap();
    setup(&mut db);
    days(&mut db, vec![day("2026-11-02", Some("8"), 0)]);
    let backup = db.backup().unwrap();
    let conn = rusqlite::Connection::open(root.path().join("personal.sqlite")).unwrap();
    conn.execute("UPDATE payroll_state SET state_json=json_set(state_json,'$.days.\"2026-11-02\".worked',10000)",[]).unwrap();
    let corrupt = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert!(db.restore(&corrupt).is_err());
    assert_eq!(
        db.payroll_view("2026-11-02", 2026)
            .unwrap()
            .week
            .actual_gross_cents,
        Some(74400)
    );
    let exported = db
        .export_handoff(
            &Uuid::new_v4().to_string(),
            "Payroll fixture",
            "synthetic payroll passphrase".into(),
        )
        .unwrap();
    let bytes = std::fs::read(exported.path).unwrap();
    let other = tempfile::tempdir().unwrap();
    let mut laptop = Store::open(other.path(), "personal").unwrap();
    let preview = laptop
        .preview_handoff(&bytes, "synthetic payroll passphrase".into())
        .unwrap();
    laptop
        .apply_handoff(
            &Uuid::new_v4().to_string(),
            &bytes,
            "synthetic payroll passphrase".into(),
            &preview.token,
            true,
            true,
        )
        .unwrap();
    assert_eq!(
        laptop
            .payroll_view("2026-11-02", 2026)
            .unwrap()
            .week
            .actual_gross_cents,
        Some(74400)
    );
    assert_eq!(laptop.snapshot(&month()).unwrap().spent_cents, 7000);
    let sample = Store::open(root.path(), "demo").unwrap();
    assert!(sample
        .payroll_view("2026-11-02", 2026)
        .unwrap()
        .state
        .rates
        .is_empty());
}
