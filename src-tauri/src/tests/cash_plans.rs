use super::*;
use crate::db::cash_plans::*;
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn schedule(anchor: &str, cadence: &str) -> Schedule {
    Schedule {
        id: op(),
        revision: 0,
        anchor: anchor.into(),
        cadence: cadence.into(),
        second_day: None,
        end_date: None,
        archived: false,
        plan: Plan {
            name: "Synthetic pay".into(),
            kind: "income".into(),
            amount: "1000".into(),
            account_id: Some("checking".into()),
            destination_account_id: None,
            payer: "jacob".into(),
        },
    }
}
fn save(db: &mut Store, mut s: Schedule) -> Schedule {
    db.save_cash_schedule(&op(), s.clone()).unwrap();
    s.revision += 1;
    s
}
fn event(db: &mut Store, s: &Schedule, month: &str) -> Occurrence {
    db.cash_month(month)
        .unwrap()
        .occurrences
        .into_iter()
        .find(|o| o.schedule_id == s.id)
        .unwrap()
}
fn input(o: &Occurrence) -> Edit {
    Edit {
        id: o.id.clone(),
        revision: o.revision,
        due_date: o.due_date.clone(),
        plan: o.plan.clone(),
        cancelled: o.cancelled,
        note: o.note.clone(),
    }
}
fn actual(o: &Occurrence, amount: &str, date: &str) -> EntryInput {
    let mut e = expense(amount, &o.plan.payer);
    e.kind = o.plan.kind.clone();
    e.date = date.into();
    e.description = o.plan.name.clone();
    e.account_id = o.plan.account_id.clone();
    e.destination_account_id = o.plan.destination_account_id.clone();
    e.category_id = None;
    e.split_mode = "none".into();
    e
}
fn record(db: &mut Store, o: &Occurrence, e: EntryInput) -> String {
    let operation = op();
    db.record_cash(
        &operation,
        Record {
            id: o.id.clone(),
            revision: o.revision,
            entry: e,
            confirmed: true,
        },
    )
    .unwrap();
    operation
}
fn close(db: &mut Store, month: &str) {
    let r = db.close_review(month).unwrap();
    db.close_month(crate::db::periods::CloseInput {
        id: op(),
        month: month.into(),
        revision: r.revision,
        token: r.token,
        acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
        note: String::new(),
        carry: None,
    })
    .unwrap();
}

#[test]
fn anchored_cadences_generate_three_pay_months_leap_dates_and_distinct_clamped_slots_without_money()
{
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = save(&mut db, schedule("2026-01-02", "biweekly"));
    let v = db.cash_month("2026-01").unwrap();
    assert_eq!(
        v.occurrences
            .iter()
            .map(|o| o.due_date.as_str())
            .collect::<Vec<_>>(),
        vec!["2026-01-02", "2026-01-16", "2026-01-30"]
    );
    let ids: Vec<_> = v.occurrences.iter().map(|o| o.id.clone()).collect();
    assert_eq!(
        db.cash_month("2026-01")
            .unwrap()
            .occurrences
            .iter()
            .map(|o| o.id.clone())
            .collect::<Vec<_>>(),
        ids
    );
    assert_eq!(
        db.cash_month("2026-02")
            .unwrap()
            .occurrences
            .iter()
            .filter(|o| o.schedule_id == s.id)
            .map(|o| o.due_date.as_str())
            .collect::<Vec<_>>(),
        vec!["2026-02-13", "2026-02-27"]
    );
    let w = save(&mut db, schedule("2024-02-01", "weekly"));
    assert_eq!(
        db.cash_month("2024-02")
            .unwrap()
            .occurrences
            .iter()
            .filter(|o| o.schedule_id == w.id)
            .count(),
        5
    );
    let m = save(&mut db, schedule("2024-01-31", "monthly"));
    assert_eq!(event(&mut db, &m, "2024-02").due_date, "2024-02-29");
    assert_eq!(event(&mut db, &m, "2025-02").due_date, "2025-02-28");
    let mut twice = schedule("2024-01-30", "twice_monthly");
    twice.second_day = Some(31);
    let twice = save(&mut db, twice);
    let v = db.cash_month("2024-02").unwrap();
    let rows: Vec<_> = v
        .occurrences
        .iter()
        .filter(|o| o.schedule_id == twice.id)
        .collect();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].due_date, rows[1].due_date);
    assert_ne!(rows[0].slot, rows[1].slot);
    assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
    let snap = db.snapshot("2026-01").unwrap();
    assert_eq!((snap.income_cents, snap.spent_cents), (0, 0));
}
#[test]
fn holiday_overrides_preserve_saved_plans_while_end_archive_and_reenable_keep_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut s = save(&mut db, schedule("2026-10-01", "monthly"));
    let o = event(&mut db, &s, "2026-10");
    let mut edited = input(&o);
    edited.due_date = "2026-09-30".into();
    edited.plan.amount = "1200".into();
    edited.note = "Holiday and variable net pay".into();
    db.save_cash_occurrence(&op(), edited).unwrap();
    assert!(db.cash_month("2026-10").unwrap().occurrences.is_empty());
    assert_eq!(event(&mut db, &s, "2026-09").plan.amount, "1200");
    s.plan.amount = "1300".into();
    s = save(&mut db, s);
    assert_eq!(event(&mut db, &s, "2026-09").plan.amount, "1200");
    let future = event(&mut db, &s, "2026-12");
    assert_eq!(future.plan.amount, "1300");
    let mut changed = s.clone();
    changed.cadence = "biweekly".into();
    assert!(db
        .save_cash_schedule(&op(), changed)
        .unwrap_err()
        .contains("dated events"));
    s.end_date = Some("2026-11-01".into());
    s = save(&mut db, s);
    assert!(event(&mut db, &s, "2026-12").cancelled);
    assert_eq!(event(&mut db, &s, "2026-12").id, future.id);
    s.end_date = None;
    s.archived = true;
    s = save(&mut db, s);
    assert!(db.cash_month("2027-01").unwrap().occurrences.is_empty());
    assert!(!event(&mut db, &s, "2026-09").cancelled);
    s.archived = false;
    s = save(&mut db, s);
    assert!(event(&mut db, &s, "2026-12").cancelled);
    assert!(!event(&mut db, &s, "2027-01").cancelled);
    let old = event(&mut db, &s, "2026-09");
    let e = actual(&old, "1150", "2026-09-30");
    record(&mut db, &old, e);
    s.end_date = Some("2026-10-01".into());
    s = save(&mut db, s);
    assert!(event(&mut db, &s, "2026-09").actual.is_some());
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert!(event(&mut db, &s, "2026-09").actual.is_some());
}
#[test]
fn matching_is_explicit_exactly_once_and_guards_financial_edits_but_allows_notes() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = save(&mut db, schedule("2026-10-10", "once"));
    let o = event(&mut db, &s, "2026-10");
    let mut e = actual(&o, "1100", "2026-10-09");
    db.save(e.clone()).unwrap();
    e.revision = 1;
    let mut twin = actual(&o, "1000", "2026-10-10");
    db.save(twin.clone()).unwrap();
    twin.revision = 1;
    let mut second = twin.clone();
    second.id = op();
    second.revision = 0;
    db.save(second).unwrap();
    let candidates = db.cash_candidates(&o.id).unwrap();
    assert_eq!(candidates.len(), 3);
    assert_eq!(candidates.iter().filter(|c| c.suggested).count(), 2);
    assert!(event(&mut db, &s, "2026-10").actual.is_none());
    let operation = op();
    let request = || Match {
        id: o.id.clone(),
        revision: o.revision,
        event_id: e.id.clone(),
        event_revision: e.revision,
        confirmed: true,
    };
    db.match_cash(&operation, request()).unwrap();
    db.match_cash(&operation, request()).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().entries.len(), 3);
    assert_eq!(
        event(&mut db, &s, "2026-10").actual.unwrap().amount_cents,
        110000
    );
    let mut changed = request();
    changed.event_id = twin.id;
    assert!(db.match_cash(&operation, changed).is_err());
    let other = save(&mut db, schedule("2026-10-11", "once"));
    let oo = event(&mut db, &other, "2026-10");
    assert!(db
        .match_cash(
            &op(),
            Match {
                id: oo.id,
                revision: oo.revision,
                event_id: e.id.clone(),
                event_revision: e.revision,
                confirmed: true
            }
        )
        .is_err());
    let mut edit = e.clone();
    edit.amount = "1200".into();
    assert!(db.save(edit).unwrap_err().contains("Unlink"));
    assert!(db.delete(&e.id, e.revision).is_err());
    e.note = "Nonfinancial correction".into();
    e.description = "Paycheck detail".into();
    db.save(e.clone()).unwrap();
    e.revision += 1;
    let linked = event(&mut db, &s, "2026-10");
    let mut changed = input(&linked);
    changed.plan.amount = "1100".into();
    assert!(db.save_cash_occurrence(&op(), changed).is_err());
    let operation = op();
    db.unmatch_cash(&operation, &linked.id, linked.revision)
        .unwrap();
    db.unmatch_cash(&operation, &linked.id, linked.revision)
        .unwrap();
    db.delete(&e.id, e.revision).unwrap();
    assert!(event(&mut db, &s, "2026-10").actual.is_none());
}
#[test]
fn actual_savings_and_settlements_change_cash_once_and_closed_income_uses_explicit_budget_override()
{
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let goal = goals::setup(&mut db, "Reserve", None);
    let mut t = schedule("2026-10-02", "once");
    t.plan.kind = "transfer".into();
    t.plan.amount = "150".into();
    t.plan.destination_account_id = Some(goal.account_id.clone());
    let t = save(&mut db, t);
    let o = event(&mut db, &t, "2026-10");
    let e = actual(&o, "150", "2026-10-02");
    let eid = e.id.clone();
    let operation = record(&mut db, &o, e.clone());
    db.record_cash(
        &operation,
        Record {
            id: o.id,
            revision: o.revision,
            entry: e,
            confirmed: true,
        },
    )
    .unwrap();
    let snap = db.snapshot("2026-10").unwrap();
    assert_eq!((snap.spent_cents, snap.income_cents), (0, 0));
    assert_eq!(
        snap.accounts
            .iter()
            .find(|a| a.id == goal.account_id)
            .unwrap()
            .activity_cents,
        15000
    );
    let mut purchase = expense("100", "jacob");
    purchase.date = "2026-10-02".into();
    db.save(purchase).unwrap();
    let mut settle = schedule("2026-10-03", "once");
    settle.plan.kind = "settlement".into();
    settle.plan.amount = "30".into();
    settle.plan.payer = "chelsea".into();
    settle.plan.account_id = None;
    let settle = save(&mut db, settle);
    let so = event(&mut db, &settle, "2026-10");
    let se = actual(&so, "30", "2026-10-03");
    record(&mut db, &so, se);
    assert_eq!(db.snapshot("2026-10").unwrap().household_cents, 0);
    assert_eq!(
        db.snapshot("2026-10")
            .unwrap()
            .accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        -15000
    );
    close(&mut db, "2026-09");
    let pay = save(&mut db, schedule("2026-09-30", "once"));
    let po = event(&mut db, &pay, "2026-09");
    let mut income = actual(&po, "1000", "2026-09-30");
    assert!(db
        .record_cash(
            &op(),
            Record {
                id: po.id.clone(),
                revision: po.revision,
                entry: income.clone(),
                confirmed: true
            }
        )
        .is_err());
    assert!(event(&mut db, &pay, "2026-09").actual.is_none());
    income.budget_override = Some(crate::db::budget_periods::Choice {
        month: Some("2026-10".into()),
        reason: "Late statement".into(),
    });
    record(&mut db, &po, income);
    assert_eq!(db.snapshot("2026-09").unwrap().income_cents, 0);
    assert_eq!(db.snapshot("2026-10").unwrap().income_cents, 100000);
    assert_eq!(
        event(&mut db, &pay, "2026-09").actual.unwrap().date,
        "2026-09-30"
    );
    assert_eq!(
        db.snapshot("2026-10")
            .unwrap()
            .entries
            .iter()
            .filter(|e| e.id == eid)
            .count(),
        1
    );
}
#[test]
fn last_write_failure_rolls_back_entry_match_and_receipt_and_stale_choices_do_not_mutate() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = save(&mut db, schedule("2026-10-01", "once"));
    let o = event(&mut db, &s, "2026-10");
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_cash BEFORE INSERT ON cash_receipts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    let operation = op();
    let e = actual(&o, "1000", "2026-10-01");
    let request = || Record {
        id: o.id.clone(),
        revision: o.revision,
        entry: e.clone(),
        confirmed: true,
    };
    assert!(db.record_cash(&operation, request()).is_err());
    assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
    assert!(event(&mut db, &s, "2026-10").actual.is_none());
    conn.execute_batch("DROP TRIGGER fail_cash;").unwrap();
    db.record_cash(&operation, request()).unwrap();
    db.record_cash(&operation, request()).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().entries.len(), 1);
    let linked = event(&mut db, &s, "2026-10");
    let mut stale = input(&linked);
    stale.revision -= 1;
    assert!(db.save_cash_occurrence(&op(), stale).is_err());
    let mut wrong = actual(&linked, "1000", "2026-10-01");
    wrong.account_id = Some("amex".into());
    assert!(db
        .record_cash(
            &op(),
            Record {
                id: linked.id,
                revision: linked.revision,
                entry: wrong,
                confirmed: true
            }
        )
        .is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().entries.len(), 1);
    let mut bad = schedule("2026-01-31", "twice_monthly");
    bad.second_day = Some(15);
    assert!(db.save_cash_schedule(&op(), bad).is_err());
    let mut bad = schedule("2026-10-01", "once");
    bad.plan.amount = "0".into();
    assert!(db.save_cash_schedule(&op(), bad).is_err());
}
#[test]
fn imported_income_cannot_be_undone_while_it_fulfills_a_plan() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let source = classification::stage(
        &mut db,
        "2026-10-10,Payroll,-1000,pay-1,PAYROLL,Posted\n",
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
    let s = save(&mut db, schedule("2026-10-10", "once"));
    let o = event(&mut db, &s, "2026-10");
    db.match_cash(
        &op(),
        Match {
            id: o.id,
            revision: o.revision,
            event_id: e.id,
            event_revision: e.revision,
            confirmed: true,
        },
    )
    .unwrap();
    assert!(db.undo_import(&commit).unwrap_err().contains("Cash plans"));
    let o = event(&mut db, &s, "2026-10");
    db.unmatch_cash(&op(), &o.id, o.revision).unwrap();
    db.undo_import(&commit).unwrap();
    assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
}
#[test]
fn schema23_upgrade_and_corrupt_restore_preserve_closed_reports_and_cash_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    close(&mut db, "2026-09");
    let before = db.shared_statement_view(Some("2026-09")).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_cash_plan_schema(&conn);
    conn.pragma_update(None, "user_version", 23).unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.shared_statement_view(Some("2026-09")).unwrap(), before);
    let s = save(&mut db, schedule("2026-10-01", "once"));
    let o = event(&mut db, &s, "2026-10");
    let e = actual(&o, "1000", "2026-10-01");
    record(&mut db, &o, e);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert!(event(&mut db, &s, "2026-10").actual.is_some());
    let corrupt = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&corrupt)).unwrap();
    conn.execute("UPDATE cash_occurrences SET slot='wrong'", [])
        .unwrap();
    drop(conn);
    assert!(db.restore(&corrupt).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().income_cents, 100000);
    let corrupt = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&corrupt)).unwrap();
    conn.execute_batch("DROP TABLE cash_receipts;").unwrap();
    drop(conn);
    assert!(db.restore(&corrupt).is_err());
    assert!(event(&mut db, &s, "2026-10").actual.is_some());
    let mut demo = Store::open(dir.path(), "demo").unwrap();
    assert!(demo.cash_month("2026-10").unwrap().schedules.is_empty());
}
