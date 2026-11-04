use super::*;
use crate::db::{
    balances::CheckpointInput,
    budget_periods::Choice,
    periods::{CloseInput, ReopenInput},
};
fn adjusted(date: &str, month: &str, amount: &str) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.date = date.into();
    e.budget_override = Some(Choice {
        month: Some(month.into()),
        reason: "Late source received after close".into(),
    });
    e
}
fn close(db: &mut Store, month: &str) {
    let r = db.close_review(month).unwrap();
    assert!(r.blockers.is_empty(), "{:?}", r.blockers);
    db.close_month(CloseInput {
        id: Uuid::new_v4().to_string(),
        month: month.into(),
        revision: r.revision,
        token: r.token,
        acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
        note: String::new(),
        carry: None,
    })
    .unwrap();
}
fn reopen(db: &mut Store, month: &str) {
    let r = db.close_review(month).unwrap();
    db.reopen_month(ReopenInput {
        id: Uuid::new_v4().to_string(),
        month: month.into(),
        revision: r.revision,
        reason: "Explicit correction".into(),
    })
    .unwrap();
}

#[test]
fn late_entry_keeps_actual_cash_dates_and_frozen_source_but_reports_in_chosen_month() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_checkpoint(CheckpointInput {
        id: Uuid::new_v4().to_string(),
        revision: 0,
        account_id: "checking".into(),
        date: "2026-09-01".into(),
        amount: "1000".into(),
        purpose: "opening".into(),
        note: String::new(),
    })
    .unwrap();
    close(&mut db, "2026-09");
    let old = db.shared_statement_view(Some("2026-09")).unwrap();
    let mut e = adjusted("2026-09-10", "2026-10", "100");
    e.account_id = Some("checking".into());
    db.save(e.clone()).unwrap();
    assert_eq!(db.snapshot("2026-09").unwrap().spent_cents, 0);
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!((s.spent_cents, s.household_cents), (7000, 3000));
    assert_eq!(s.entries[0].date, "2026-09-10");
    assert_eq!(s.entries[0].reporting_month(), "2026-10");
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .balance
            .as_ref()
            .unwrap()
            .estimated_cents,
        90000
    );
    assert_eq!(db.shared_statement_view(Some("2026-09")).unwrap(), old);
    let statement = db.shared_statement(Some("2026-10")).unwrap();
    assert_eq!(statement.closing_cents, 3000);
    assert_eq!(statement.rows[0].date, "2026-09-10");
    assert_eq!(statement.rows[0].reporting_month, "2026-10");
    let csv = statement.render("csv").unwrap();
    assert!(csv.contains("2026-09-10,2026-10,expense"));
    assert!(statement.render("html").unwrap().contains("Budget 2026-10"));
    close(&mut db, "2026-10");
    let annual = db.annual_report(2026).unwrap();
    assert_eq!(annual.months[8].totals.as_ref().unwrap().spent_cents, 0);
    assert_eq!(annual.months[9].totals.as_ref().unwrap().spent_cents, 7000);
    e.revision = 1;
    e.amount = "200".into();
    assert!(db.save(e).is_err());
}

#[test]
fn closed_original_cannot_escape_lock_and_clearing_override_requires_open_original() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut old = expense("100", "jacob");
    old.date = "2026-09-01".into();
    db.save(old.clone()).unwrap();
    close(&mut db, "2026-09");
    old.revision = 1;
    old.budget_override = Some(Choice {
        month: Some("2026-10".into()),
        reason: "Move closed expense".into(),
    });
    assert!(db.save(old).unwrap_err().contains("2026-09 is closed"));
    let mut late = adjusted("2026-09-12", "2026-10", "20");
    db.save(late.clone()).unwrap();
    late.revision = 1;
    late.budget_override = None;
    late.note = "Ordinary edit keeps override".into();
    db.save(late.clone()).unwrap();
    assert_eq!(
        db.snapshot("2026-10").unwrap().entries[0].reporting_month(),
        "2026-10"
    );
    late.revision = 2;
    late.budget_override = Some(Choice {
        month: None,
        reason: "Return to actual month".into(),
    });
    assert!(db.save(late.clone()).is_err());
    reopen(&mut db, "2026-09");
    db.save(late).unwrap();
    assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
    assert_eq!(db.snapshot("2026-09").unwrap().spent_cents, 8400);
}

#[test]
fn mixed_late_import_is_atomic_and_override_preserves_identity_retry_and_undo() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    close(&mut db, "2026-09");
    let d = imports::stage(
        &mut db,
        &imports::csv("09/10/2026,Market,100\n09/11/2026,Cafe,20"),
        "amex",
    );
    let make = || {
        let mut items: Vec<_> = d.rows.iter().map(imports::add).collect();
        items[0].input.as_mut().unwrap().budget_override = Some(Choice {
            month: Some("2026-10".into()),
            reason: "Explicit late import".into(),
        });
        items
    };
    assert!(imports::commit(&mut db, &d, make()).is_err());
    assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
    let mut items = make();
    items[1].input.as_mut().unwrap().budget_override =
        items[0].input.as_ref().unwrap().budget_override.clone();
    let raw = serde_json::to_string(&items).unwrap();
    let operation = Uuid::new_v4().to_string();
    db.commit_import(&d.source.id, d.source.revision, &operation, items)
        .unwrap();
    assert!(
        db.commit_import(
            &d.source.id,
            d.source.revision,
            &operation,
            serde_json::from_str(&raw).unwrap()
        )
        .unwrap()
        .already_processed
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 12000);
    assert_eq!(db.snapshot("2026-09").unwrap().spent_cents, 0);
    assert!(db
        .snapshot("2026-10")
        .unwrap()
        .entries
        .iter()
        .all(|e| e.date.starts_with("2026-09")));
    close(&mut db, "2026-10");
    assert!(db.undo_import(&operation).is_err());
    reopen(&mut db, "2026-10");
    db.undo_import(&operation).unwrap();
    assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
}

#[test]
fn refunds_and_goal_exclusions_follow_explicit_period_without_changing_evidence_dates() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = goals::setup(&mut db, "Gift", Some("1000"));
    let w = goals::withdrawal(&mut db, &g, "200");
    close(&mut db, "2026-10");
    let mut e = adjusted("2026-10-10", "2026-11", "300");
    e.category_id = Some("gifts".into());
    e.split_mode = "personal".into();
    db.save(e.clone()).unwrap();
    e.revision = 1;
    db.save_funding(goals::request(
        &db,
        &e,
        vec![goals::funding(&g, "200", Some(&w))],
    ))
    .unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (s.spent_cents, s.goal_excluded_cents, s.allowance_cents),
        (30000, 20000, 10000)
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
    let mut r = adjusted("2026-10-20", "2026-11", "150");
    r.kind = "refund".into();
    r.original_event_id = Some(e.id);
    db.save(r).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (s.spent_cents, s.goal_excluded_cents, s.allowance_cents),
        (15000, 10000, 5000)
    );
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().goal_excluded_cents, 10000);
}

#[test]
fn override_cannot_invalidate_closed_goal_evidence_through_actual_account_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = goals::setup(&mut db, "Gift", Some("1000"));
    let w = goals::withdrawal(&mut db, &g, "200");
    let e = goals::purchase(&mut db, "300", "personal");
    db.save_funding(goals::request(
        &db,
        &e,
        vec![goals::funding(&g, "200", Some(&w))],
    ))
    .unwrap();
    close(&mut db, "2026-10");
    let mut late = adjusted("2026-10-05", "2026-11", "900");
    late.account_id = Some(g.account_id);
    late.split_mode = "personal".into();
    assert!(db.save(late).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().goal_excluded_cents, 20000);
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
}

#[test]
fn adjusted_card_payment_still_moves_both_accounts_without_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    close(&mut db, "2026-09");
    let mut p = adjusted("2026-09-15", "2026-10", "624");
    p.kind = "card_payment".into();
    p.account_id = Some("checking".into());
    p.destination_account_id = Some("amex".into());
    p.category_id = None;
    p.split_mode = "none".into();
    db.save(p.clone()).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!((s.spent_cents, s.income_cents), (0, 0));
    assert_eq!(s.entries[0].date, "2026-09-15");
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        -62400
    );
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        -62400
    );
    p.revision = 1;
    p.budget_override = None;
    p.note = "Preserve period during normal payment edit".into();
    db.save(p).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().entries.len(), 1);
}

#[test]
fn invalid_choices_and_late_override_write_failure_leave_no_partial_records() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    close(&mut db, "2026-09");
    for (target, reason) in [
        ("2026-09", "same month"),
        ("2026-08", "earlier"),
        ("2026-99", "bad month"),
        ("2026-10", ""),
    ] {
        let mut e = adjusted("2026-09-10", target, "100");
        e.budget_override.as_mut().unwrap().reason = reason.into();
        assert!(db.save(e).is_err());
    }
    let e = adjusted("2026-09-10", "2026-10", "100");
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute_batch("CREATE TRIGGER fail_override BEFORE INSERT ON budget_period_overrides BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    assert!(db.save(e.clone()).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
    c.execute_batch("DROP TRIGGER fail_override").unwrap();
    db.save(e).unwrap();
    let backup = db.backup().unwrap();
    let c = rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    c.execute("UPDATE budget_period_overrides SET month='2026-08'", [])
        .unwrap();
    drop(c);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 7000);
}

#[test]
fn schema22_upgrade_preserves_closed_history_and_override_restore_preserves_links() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    close(&mut db, "2026-09");
    let old = db.shared_statement_view(Some("2026-09")).unwrap();
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_budget_period_schema(&c);
    c.pragma_update(None, "user_version", 22).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert!(db.close_review("2026-09").unwrap().closed);
    assert_eq!(db.shared_statement_view(Some("2026-09")).unwrap(), old);
    let e = adjusted("2026-09-10", "2026-10", "100");
    db.save(e.clone()).unwrap();
    let backup = db.backup().unwrap();
    db.delete(&e.id, 1).unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(
        db.snapshot("2026-10").unwrap().entries[0]
            .budget_override
            .as_ref()
            .unwrap()
            .month
            .as_deref(),
        Some("2026-10")
    );
    let c = rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    c.execute_batch("DROP TABLE budget_period_overrides")
        .unwrap();
    drop(c);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 7000);
}

#[test]
fn late_bill_payment_links_once_and_exports_in_its_explicit_budget_period() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_bill_template(
        &Uuid::new_v4().to_string(),
        0,
        "2026-09-01",
        1,
        None,
        false,
        bills::draft("Electric", "100"),
    )
    .unwrap();
    let bill = db.bill_month("2026-09").unwrap().remove(0);
    close(&mut db, "2026-09");
    let mut e = adjusted("2026-09-20", "2026-10", "100");
    e.category_id = Some("home".into());
    let operation = Uuid::new_v4().to_string();
    db.record_bill_payment(&bill.id, bill.revision, &operation, e.clone())
        .unwrap();
    db.record_bill_payment(&bill.id, bill.revision, &operation, e)
        .unwrap();
    let paid = db.bill_month("2026-09").unwrap().remove(0);
    assert_eq!(paid.paid_cents, 10000);
    assert_eq!(paid.payments.len(), 1);
    assert_eq!(db.snapshot("2026-09").unwrap().spent_cents, 0);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 7000);
    let report = db.shared_statement(Some("2026-10")).unwrap();
    assert_eq!(report.bills_cents, 3000);
    assert_eq!(report.rows[0].date, "2026-09-20");
}

#[test]
fn moving_override_back_after_reopen_reconciles_both_carry_chains_without_double_correction() {
    use crate::db::rollover::{BudgetPlan, Choice as CarryChoice};
    fn carried_close(db: &mut Store, month: &str, target: &str) {
        let r = db.close_review_target(month, Some(target)).unwrap();
        assert!(r.blockers.is_empty());
        db.close_month(CloseInput {
            id: Uuid::new_v4().to_string(),
            month: month.into(),
            revision: r.revision,
            token: r.token,
            acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
            note: String::new(),
            carry: Some(CarryChoice {
                target_month: target.into(),
                reason: "Reconcile revised periods".into(),
            }),
        })
        .unwrap();
    }
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let c = db
        .snapshot("2026-09")
        .unwrap()
        .categories
        .into_iter()
        .find(|c| c.id == "groceries")
        .unwrap();
    db.save_budget_plan(BudgetPlan {
        id: Uuid::new_v4().to_string(),
        month: "2026-09".into(),
        category: "groceries".into(),
        amount: "100".into(),
        mode: "carry".into(),
        policy_token: c.rollover_token,
        previous_limit_cents: 0,
    })
    .unwrap();
    carried_close(&mut db, "2026-09", "2026-10");
    db.set_budget("2026-10", "groceries", "100").unwrap();
    let mut e = adjusted("2026-09-20", "2026-10", "20");
    db.save(e.clone()).unwrap();
    carried_close(&mut db, "2026-10", "2026-11");
    assert_eq!(db.snapshot("2026-11").unwrap().budget_cents, 18600);
    reopen(&mut db, "2026-09");
    reopen(&mut db, "2026-10");
    e.revision = 1;
    e.budget_override = Some(Choice {
        month: None,
        reason: "Use reopened actual month".into(),
    });
    db.save(e).unwrap();
    carried_close(&mut db, "2026-09", "2026-11");
    carried_close(&mut db, "2026-10", "2026-11");
    assert_eq!(db.snapshot("2026-11").unwrap().budget_cents, 18600);
    assert_eq!(db.snapshot("2026-09").unwrap().spent_cents, 1400);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
}
