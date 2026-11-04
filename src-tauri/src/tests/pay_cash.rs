use super::*;
use crate::{
    db::{
        cash_plans,
        periods::{CloseInput, ReopenInput},
    },
    pay_calendar::{Period, Review},
    pay_cash::*,
    pay_forecast::ForecastInput,
    payroll::Change,
};
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn edit(db: &mut Store, c: Change) -> Result<i64, String> {
    let r = db.payroll_view("2026-10-05", 2026)?.revision;
    db.save_payroll(&op(), r, c)
}
fn period(db: &mut Store, date: &str, weeks: Vec<&str>, net: &str) -> (Period, ForecastInput) {
    let p = Period {
        id: op(),
        name: "Synthetic payroll".into(),
        pay_date: date.into(),
        weeks: weeks.into_iter().map(str::to_string).collect(),
        frequency: "biweekly".into(),
        benefits: true,
        note: String::new(),
        evidence: vec![],
    };
    edit(
        db,
        Change::Calendar {
            review: Review {
                source_id: None,
                periods: vec![p.clone()],
                holidays: vec![],
                remove_periods: vec![],
                reason: "Synthetic review".into(),
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
    let f = ForecastInput {
        id: op(),
        period_id: p.id.clone(),
        method: "manual".into(),
        regime: "Standard".into(),
        manual_net: Some(net.into()),
        reason: "Synthetic planning".into(),
        use_usual: true,
        extrapolate: false,
        tax: None,
    };
    edit(db, Change::Forecast { input: f.clone() }).unwrap();
    (p, f)
}
fn plan(p: &Period, f: &ForecastInput, targets: &[(&str, &str)]) -> PlanInput {
    PlanInput {
        period_id: p.id.clone(),
        forecast_id: f.id.clone(),
        targets: targets
            .iter()
            .map(|(a, n)| TargetInput {
                account_id: (*a).into(),
                amount: (*n).into(),
            })
            .collect(),
        complete: false,
        cancelled: false,
        note: "Synthetic approved estimate".into(),
        duplicates_reviewed: true,
    }
}
fn income(db: &mut Store, amount: &str, date: &str, account: &str) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.kind = "income".into();
    e.date = date.into();
    e.description = "Synthetic payroll deposit".into();
    e.category_id = None;
    e.account_id = Some(account.into());
    e.split_mode = "none".into();
    db.save(e.clone()).unwrap();
    e.revision = 1;
    e
}
fn link(db: &mut Store, p: &Period, e: &EntryInput, n: &str) -> Result<i64, String> {
    edit(
        db,
        Change::PayDeposit {
            period_id: p.id.clone(),
            event_id: e.id.clone(),
            event_revision: e.revision,
            amount: n.into(),
            confirmed: true,
        },
    )
}
fn schedule(db: &mut Store) -> cash_plans::Schedule {
    let mut s = cash_plans::Schedule {
        id: op(),
        revision: 0,
        anchor: "2026-10-16".into(),
        cadence: "biweekly".into(),
        second_day: None,
        end_date: None,
        archived: false,
        plan: cash_plans::Plan {
            name: "Old paycheck estimate".into(),
            kind: "income".into(),
            amount: "5000".into(),
            account_id: Some("checking".into()),
            destination_account_id: None,
            payer: "jacob".into(),
        },
    };
    db.save_cash_schedule(&op(), s.clone()).unwrap();
    s.revision = 1;
    s
}
#[test]
fn payroll_takeover_suppresses_existing_and_virtual_slots_without_new_income() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let s = schedule(&mut db);
    let o = db.cash_month("2026-10").unwrap().occurrences.remove(0);
    let (p, f) = period(
        &mut db,
        "2026-10-16",
        vec!["2026-10-05", "2026-10-12"],
        "5000",
    );
    edit(
        &mut db,
        Change::PayCash {
            input: plan(&p, &f, &[("checking", "5000")]),
        },
    )
    .unwrap();
    edit(
        &mut db,
        Change::PayTakeover {
            input: Takeover {
                schedule_id: s.id.clone(),
                from_date: "2026-10-16".into(),
                reason: "Replace generic future pay".into(),
            },
            schedule_revision: 1,
            confirmed: true,
        },
    )
    .unwrap();
    let cash = db.cash_forecast_at("checking", 40, "2026-10-01").unwrap();
    let pay: Vec<_> = cash.rows.iter().filter(|r| r.source == "income").collect();
    assert_eq!(pay.len(), 1);
    assert_eq!(pay[0].amount_cents, Some(500000));
    assert!(pay[0].included);
    assert!(db
        .cash_month("2026-10")
        .unwrap()
        .occurrences
        .iter()
        .all(|o| o.payroll_managed));
    assert_eq!(db.snapshot("2026-10").unwrap().income_cents, 0);
    assert!(edit(
        &mut db,
        Change::PayTakeover {
            input: Takeover {
                schedule_id: s.id.clone(),
                from_date: "2026-10-30".into(),
                reason: "Would restore duplicate October 16 pay".into()
            },
            schedule_revision: 1,
            confirmed: true,
        }
    )
    .is_err());
    assert!(db
        .save_cash_occurrence(
            &op(),
            cash_plans::Edit {
                id: o.id,
                revision: o.revision,
                due_date: o.due_date,
                plan: o.plan,
                cancelled: false,
                note: String::new()
            }
        )
        .is_err());
    assert!(edit(
        &mut db,
        Change::RemovePayTakeover {
            schedule_id: s.id,
            confirmed: true
        }
    )
    .is_err());
}

#[test]
fn payroll_cash_warns_when_selected_prediction_inputs_change_without_a_new_selection() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let (p, f) = period(
        &mut db,
        "2026-10-16",
        vec!["2026-10-05", "2026-10-12"],
        "5000",
    );
    edit(
        &mut db,
        Change::PayCash {
            input: plan(&p, &f, &[("checking", "5000")]),
        },
    )
    .unwrap();
    assert!(!db.pay_cash_view().unwrap().plans[0].changed);
    edit(
        &mut db,
        Change::Rate {
            effective_date: "2026-10-01".into(),
            hourly_rate: "101".into(),
        },
    )
    .unwrap();
    let v = db.pay_cash_view().unwrap();
    assert!(v.plans[0].changed);
    assert_eq!(v.plans[0].expected_cents, 500000);
}
#[test]
fn payroll_partial_split_combined_allocations_and_transaction_protection() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let savings = op();
    db.save_account(AccountInput {
        id: savings.clone(),
        revision: 0,
        name: "Synthetic savings".into(),
        kind: "savings".into(),
        tracking_mode: "manual".into(),
        archived: false,
    })
    .unwrap();
    let (p, f) = period(
        &mut db,
        "2026-10-16",
        vec!["2026-10-05", "2026-10-12"],
        "5000",
    );
    edit(
        &mut db,
        Change::PayCash {
            input: plan(&p, &f, &[("checking", "4000"), (&savings, "1000")]),
        },
    )
    .unwrap();
    let mut e = income(&mut db, "2500", "2026-10-15", "checking");
    let se = income(&mut db, "1000", "2026-10-15", &savings);
    link(&mut db, &p, &e, "2500").unwrap();
    link(&mut db, &p, &se, "1000").unwrap();
    let v = db.pay_cash_view().unwrap();
    assert_eq!(v.plans[0].remaining_cents, 150000);
    let row = db
        .cash_forecast_at("checking", 30, "2026-10-01")
        .unwrap()
        .rows
        .into_iter()
        .find(|r| r.id.starts_with("payroll:"))
        .unwrap();
    assert_eq!(row.amount_cents, Some(150000));
    assert!(row.included);
    e.amount = "2600".into();
    assert!(db.save(e.clone()).is_err());
    assert!(db.delete(&e.id, 1).is_err());
    e.amount = "2500".into();
    e.description = "Corrected label".into();
    db.save(e.clone()).unwrap();
    e.revision = 2;
    assert!(link(&mut db, &p, &e, "2500.01").is_err());
    let (p2, f2) = period(
        &mut db,
        "2026-10-30",
        vec!["2026-10-19", "2026-10-26"],
        "1000",
    );
    edit(
        &mut db,
        Change::PayCash {
            input: plan(&p2, &f2, &[("checking", "1000")]),
        },
    )
    .unwrap();
    let combined = income(&mut db, "2500", "2026-10-30", "checking");
    link(&mut db, &p, &combined, "1500").unwrap();
    link(&mut db, &p2, &combined, "1000").unwrap();
    assert!(link(&mut db, &p2, &combined, "1000.01").is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().income_cents, 600000);
    assert!(db
        .pay_cash_view()
        .unwrap()
        .plans
        .iter()
        .all(|p| p.remaining_cents == 0));
}
#[test]
fn payroll_possible_deposits_hold_forecasts_and_generic_matches_cannot_double_claim() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let (p, f) = period(
        &mut db,
        "2026-10-16",
        vec!["2026-10-05", "2026-10-12"],
        "5000",
    );
    edit(
        &mut db,
        Change::PayCash {
            input: plan(&p, &f, &[("checking", "5000")]),
        },
    )
    .unwrap();
    let e = income(&mut db, "4900", "2026-10-16", "checking");
    let row = db
        .cash_forecast_at("checking", 30, "2026-10-01")
        .unwrap()
        .rows
        .into_iter()
        .find(|r| r.id.starts_with("payroll:"))
        .unwrap();
    assert!(!row.included);
    assert!(row.reason.contains("Possible recorded"));
    let s = schedule(&mut db);
    let o = db
        .cash_month("2026-10")
        .unwrap()
        .occurrences
        .into_iter()
        .find(|o| o.schedule_id == s.id)
        .unwrap();
    db.match_cash(
        &op(),
        cash_plans::Match {
            id: o.id.clone(),
            revision: 1,
            event_id: e.id.clone(),
            event_revision: 1,
            confirmed: true,
        },
    )
    .unwrap();
    assert!(link(&mut db, &p, &e, "4900").is_err());
    db.unmatch_cash(&op(), &o.id, 2).unwrap();
    link(&mut db, &p, &e, "4900").unwrap();
    assert!(db
        .match_cash(
            &op(),
            cash_plans::Match {
                id: o.id,
                revision: 3,
                event_id: e.id,
                event_revision: 1,
                confirmed: true
            }
        )
        .is_err());
    let mut i = plan(&p, &f, &[("checking", "5000")]);
    i.complete = true;
    edit(&mut db, Change::PayCash { input: i }).unwrap();
    let v = db.pay_cash_view().unwrap();
    assert_eq!(v.plans[0].variance_cents, -10000);
    assert_eq!(v.plans[0].remaining_cents, 0);
    let mut other = repayment("10", "chelsea", true);
    let mut shared = expense("100", "jacob");
    shared.date = "2026-10-10".into();
    db.save(shared).unwrap();
    other.date = "2026-10-16".into();
    db.save(other.clone()).unwrap();
    other.revision = 1;
    assert!(link(&mut db, &p, &other, "10").is_err());
}
#[test]
fn payroll_close_keeps_original_explanation_after_recalculation_and_recovery() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let (p, f) = period(
        &mut db,
        "2026-10-16",
        vec!["2026-10-05", "2026-10-12"],
        "5000",
    );
    let input = plan(&p, &f, &[("checking", "5000")]);
    let operation = op();
    let revision = db.pay_cash_view().unwrap().revision;
    let change = Change::PayCash { input };
    let result = db
        .save_payroll(&operation, revision, change.clone())
        .unwrap();
    assert_eq!(
        db.save_payroll(&operation, revision, change).unwrap(),
        result
    );
    let r = db.close_review("2026-10").unwrap();
    assert!(r.warnings.iter().any(|w| w.id == "payroll"));
    db.close_month(CloseInput {
        id: op(),
        month: "2026-10".into(),
        revision: r.revision,
        token: r.token,
        acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
        note: "Synthetic close".into(),
        carry: None,
    })
    .unwrap();
    let frozen = db
        .closed_shared("2026-10")
        .unwrap()
        .unwrap()
        .payroll
        .unwrap();
    let mut later = f.clone();
    later.id = op();
    later.manual_net = Some("5100".into());
    edit(&mut db, Change::Forecast { input: later }).unwrap();
    assert!(db.pay_cash_view().unwrap().plans[0].changed);
    assert_eq!(
        db.close_review("2026-10").unwrap().payroll,
        Some(frozen.clone())
    );
    let archive = db
        .export_handoff(
            &op(),
            "Synthetic payroll matching",
            "synthetic payroll cash password".into(),
        )
        .unwrap();
    let bytes = std::fs::read(archive.path).unwrap();
    let other = tempfile::tempdir().unwrap();
    let mut laptop = Store::open(other.path(), "personal").unwrap();
    let preview = laptop
        .preview_handoff(&bytes, "synthetic payroll cash password".into())
        .unwrap();
    laptop
        .apply_handoff(
            &op(),
            &bytes,
            "synthetic payroll cash password".into(),
            &preview.token,
            true,
            true,
        )
        .unwrap();
    assert_eq!(
        laptop.closed_shared("2026-10").unwrap().unwrap().payroll,
        Some(frozen)
    );
    assert_eq!(laptop.snapshot("2026-10").unwrap().income_cents, 0);
    let r = laptop.close_review("2026-10").unwrap();
    laptop
        .reopen_month(ReopenInput {
            id: op(),
            month: "2026-10".into(),
            revision: r.revision,
            reason: "Synthetic correction".into(),
        })
        .unwrap();
    assert!(
        laptop
            .close_review("2026-10")
            .unwrap()
            .payroll
            .unwrap()
            .plans[0]
            .changed
    );
}
#[test]
fn payroll_worked_year_paid_year_and_timesheet_finalization_are_independent() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let (p, _) = period(&mut db, "2027-01-08", vec!["2026-12-28"], "3000");
    assert!(edit(
        &mut db,
        Change::FinalizePay {
            period_id: p.id.clone(),
            reason: "Reviewed".into(),
            confirmed: true
        }
    )
    .is_err());
    let days = [
        "2026-12-28",
        "2026-12-29",
        "2026-12-30",
        "2026-12-31",
        "2027-01-01",
    ]
    .into_iter()
    .map(|date| crate::payroll::DayInput {
        date: date.into(),
        planned: "8".into(),
        worked: Some("8".into()),
        sick: 0,
        planned_sick: 0,
        unpaid: "0".into(),
        note: String::new(),
    })
    .collect();
    edit(&mut db, Change::Days { days }).unwrap();
    edit(
        &mut db,
        Change::FinalizePay {
            period_id: p.id.clone(),
            reason: "Reviewed all actual work".into(),
            confirmed: true,
        },
    )
    .unwrap();
    assert!(db.pay_cash_view().unwrap().finalized[&p.id]);
    let year = db.pay_annual(2026).unwrap();
    assert_eq!(year.work[11].worked, 320000);
    assert_eq!(year.work[11].earned_gross_cents, Some(320000));
    assert!(year.paid.iter().all(|m| m.selected_predictions.is_empty()));
    let next = db.pay_annual(2027).unwrap();
    assert_eq!(next.work[0].earned_gross_cents, Some(80000));
    assert_eq!(next.paid[0].selected_predictions.len(), 1);
    edit(
        &mut db,
        Change::Rate {
            effective_date: "2027-01-01".into(),
            hourly_rate: "101".into(),
        },
    )
    .unwrap();
    assert!(!db.pay_cash_view().unwrap().finalized[&p.id]);
    assert_eq!(db.snapshot("2027-01").unwrap().income_cents, 0);
}

#[test]
fn payroll_import_undo_upgrade_and_tampered_restore_keep_current_records() {
    let root = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let (p, f) = period(
        &mut db,
        "2026-10-16",
        vec!["2026-10-05", "2026-10-12"],
        "5000",
    );
    let c = rusqlite::Connection::open(root.path().join("personal.sqlite")).unwrap();
    let raw: String = c
        .query_row("SELECT state_json FROM payroll_state", [], |r| r.get(0))
        .unwrap();
    assert!(!raw.contains("cashPlans"));
    c.pragma_update(None, "user_version", 41).unwrap();
    drop(c);
    drop(db);
    let mut db = Store::open(root.path(), "personal").unwrap();
    edit(
        &mut db,
        Change::PayCash {
            input: plan(&p, &f, &[("checking", "5000")]),
        },
    )
    .unwrap();
    let source = classification::stage(
        &mut db,
        "2026-10-16,Payroll,-4900,pay-cash-1,PAYROLL,Posted\n",
        "checking",
    );
    let mut policy = classification::policy("personal");
    policy.types.push(crate::db::classification::TypeCode {
        code: "PAYROLL".into(),
        kind: "income".into(),
        account_id: None,
    });
    let commit = classification::process(&mut db, &source, policy);
    let e = db.snapshot("2026-10").unwrap().entries.remove(0);
    let change = Change::PayDeposit {
        period_id: p.id.clone(),
        event_id: e.id.clone(),
        event_revision: e.revision,
        amount: "4900".into(),
        confirmed: true,
    };
    edit(&mut db, change).unwrap();
    assert!(db.undo_import(&commit).unwrap_err().contains("Pay & hours"));
    assert_eq!(db.snapshot("2026-10").unwrap().income_cents, 490000);
    let good = db.backup().unwrap();
    let c = rusqlite::Connection::open(root.path().join("personal.sqlite")).unwrap();
    c.execute(
        "UPDATE payroll_state SET state_json=json_set(state_json,?1,600000)",
        [format!("$.payDeposits.\"{}\".cents", key(&p.id, &e.id))],
    )
    .unwrap();
    drop(c);
    let bad = db.backup().unwrap();
    db.restore(&good).unwrap();
    assert!(db.restore(&bad).is_err());
    assert_eq!(db.pay_cash_view().unwrap().plans[0].deposited_cents, 490000);
    edit(
        &mut db,
        Change::RemovePayDeposit {
            period_id: p.id.clone(),
            event_id: e.id,
        },
    )
    .unwrap();
    db.undo_import(&commit).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().income_cents, 0);
    let after = db.backup().unwrap();
    db.restore(&after).unwrap();
    assert_eq!(db.pay_cash_view().unwrap().plans[0].remaining_cents, 500000);
    assert!(Store::open(root.path(), "demo")
        .unwrap()
        .pay_cash_view()
        .unwrap()
        .plans
        .is_empty());
}
