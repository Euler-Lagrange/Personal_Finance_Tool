use super::*;
use crate::db::periods::{CloseInput, ReopenInput};
fn purchase(db: &mut Store, amount: &str, date: &str) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.date = date.into();
    e.split_mode = "personal".into();
    db.save(e.clone()).unwrap();
    e
}
fn ready(db: &mut Store, month: &str) -> CloseInput {
    let r = db.close_review(month).unwrap();
    assert!(r.blockers.is_empty(), "{:?}", r.blockers);
    CloseInput {
        carry: None,
        id: Uuid::new_v4().to_string(),
        month: month.into(),
        revision: r.revision,
        token: r.token,
        acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
        note: "Synthetic month reviewed".into(),
    }
}
fn reopen(db: &mut Store, month: &str) {
    let r = db.close_review(month).unwrap();
    db.reopen_month(ReopenInput {
        id: Uuid::new_v4().to_string(),
        month: month.into(),
        revision: r.revision,
        reason: "Correct late purchase".into(),
    })
    .unwrap();
}
#[test]
fn close_locks_money_and_budget_but_notes_and_later_refunds_remain_available() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = purchase(&mut db, "100", "2026-10-02");
    db.set_budget("2026-10", "groceries", "200").unwrap();
    let input = ready(&mut db, "2026-10");
    db.close_month(input).unwrap();
    e.revision = 1;
    e.amount = "120".into();
    assert!(db
        .save(e.clone())
        .err()
        .unwrap()
        .contains("2026-10 is closed"));
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 10000);
    assert!(db.set_budget("2026-10", "groceries", "300").is_err());
    assert!(db.delete(&e.id, 1).is_err());
    e.amount = "100".into();
    e.note = "Updated note".into();
    db.save(e.clone()).unwrap();
    assert!(!db.close_review("2026-10").unwrap().changed);
    let mut refund = expense("25", "jacob");
    refund.kind = "refund".into();
    refund.date = "2026-11-01".into();
    refund.original_event_id = Some(e.id);
    db.save(refund).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, -2500);
    assert!(!db.close_review("2026-10").unwrap().changed);
}
#[test]
fn reopen_preserves_latest_snapshot_and_reclose_replaces_it_without_replaying_operations() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = purchase(&mut db, "100", "2026-10-02");
    let input = ready(&mut db, "2026-10");
    let serialized = serde_json::to_string(&input).unwrap();
    db.close_month(input).unwrap();
    db.close_month(serde_json::from_str(&serialized).unwrap())
        .unwrap();
    assert_eq!(db.close_review("2026-10").unwrap().revision, 1);
    reopen(&mut db, "2026-10");
    e.revision = 1;
    e.amount = "120".into();
    db.save(e).unwrap();
    let r = db.close_review("2026-10").unwrap();
    assert!(r.changed);
    assert_eq!(r.previous.unwrap().spent_cents, 10000);
    assert_eq!(r.totals.spent_cents, 12000);
    db.close_month(serde_json::from_str(&serialized).unwrap())
        .unwrap();
    assert!(!db.close_review("2026-10").unwrap().closed);
    let input = ready(&mut db, "2026-10");
    db.close_month(input).unwrap();
    let r = db.close_review("2026-10").unwrap();
    assert!(!r.changed);
    assert!(r.closed);
    assert_eq!(r.previous.unwrap().spent_cents, 12000);
}
#[test]
fn annual_distinguishes_zero_closed_months_missing_open_and_future() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let zero = ready(&mut db, "2026-09");
    db.close_month(zero).unwrap();
    purchase(&mut db, "100", "2026-10-02");
    let oct = ready(&mut db, "2026-10");
    db.close_month(oct).unwrap();
    purchase(&mut db, "50", "2026-11-01");
    let r = db.annual_report(2026).unwrap();
    assert_eq!(r.closed_months, 2);
    assert_eq!(r.average_closed_spending_cents, Some(5000));
    let averages = r.average_closed_totals.as_ref().unwrap();
    assert_eq!(averages.spent_cents, 5000);
    assert_eq!(
        averages
            .categories
            .iter()
            .find(|c| c.id == "groceries")
            .unwrap()
            .spent_cents,
        5000
    );
    assert_eq!(r.actual_spending_cents, 15000);
    assert_eq!(r.months[7].status, "missing");
    assert_eq!(r.months[8].totals.as_ref().unwrap().spent_cents, 0);
    assert_eq!(r.months[10].status, "open");
    assert_eq!(r.months[11].status, "future");
    assert!(r.months[11].totals.is_none());
}

#[test]
fn late_import_keeps_its_date_and_rolls_back_whole_batch_until_reopened() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let close = ready(&mut db, "2026-10");
    db.close_month(close).unwrap();
    let d = imports::stage(
        &mut db,
        &imports::csv("10/10/2026,Late purchase,100\n11/01/2026,Current purchase,25"),
        "amex",
    );
    let err = imports::commit(&mut db, &d, d.rows.iter().map(imports::add).collect())
        .err()
        .unwrap();
    assert!(err.contains("2026-10 is closed"));
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
    assert!(db
        .import_detail(&d.source.id)
        .unwrap()
        .rows
        .iter()
        .all(|r| r.disposition == "pending"));
    reopen(&mut db, "2026-10");
    let d = db.import_detail(&d.source.id).unwrap();
    imports::commit(&mut db, &d, d.rows.iter().map(imports::add).collect()).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 10000);
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 2500);
}

#[test]
fn goal_support_changes_in_an_earlier_month_cannot_rewrite_closed_allowance() {
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
    let close = ready(&mut db, "2026-10");
    db.close_month(close).unwrap();
    let cp = db.balance_checkpoints(&g.account_id).unwrap().remove(0);
    assert!(db
        .delete_checkpoint(&cp.id, cp.revision)
        .err()
        .unwrap()
        .contains("2026-10 is closed"));
    assert_eq!(db.balance_checkpoints(&g.account_id).unwrap().len(), 1);
    let r = db.annual_report(2026).unwrap();
    let oct = r.months[9].totals.as_ref().unwrap();
    assert_eq!(
        (
            oct.spent_cents,
            oct.goal_excluded_cents,
            oct.allowance_cents
        ),
        (30000, 20000, 10000)
    );
    reopen(&mut db, "2026-10");
    db.delete_checkpoint(&cp.id, cp.revision).unwrap();
    assert!(db
        .close_review("2026-10")
        .unwrap()
        .blockers
        .iter()
        .any(|c| c.id == "funding"));
}

#[test]
fn close_blocks_unknown_sharing_and_uncertain_sources_but_can_acknowledge_uncategorized() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = classification::stage(&mut db, "10/10/2026,Market,100,p1,SALE,Posted", "amex");
    classification::process(&mut db, &id, classification::policy("ask"));
    assert!(db
        .close_review("2026-10")
        .unwrap()
        .blockers
        .iter()
        .any(|c| c.id == "classification"));
    let other = tempfile::tempdir().unwrap();
    let mut clear = Store::open(other.path(), "personal").unwrap();
    let mut e = expense("100", "jacob");
    e.date = "2026-10-02".into();
    e.category_id = Some("uncategorized".into());
    clear.save(e).unwrap();
    let r = clear.close_review("2026-10").unwrap();
    assert!(r.blockers.is_empty());
    assert!(r.warnings.iter().any(|c| c.id == "uncategorized"));
    let mut input = ready(&mut clear, "2026-10");
    input.acknowledgements.retain(|a| a != "uncategorized");
    assert!(clear.close_month(input).is_err());
    let input = ready(&mut clear, "2026-10");
    clear.close_month(input).unwrap();
}

#[test]
fn close_token_rejects_changed_inputs_and_failed_audit_leaves_month_open() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let stale = ready(&mut db, "2026-10");
    purchase(&mut db, "20", "2026-10-01");
    assert!(db
        .close_month(stale)
        .err()
        .unwrap()
        .contains("Month changed"));
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute_batch("CREATE TRIGGER reject_close BEFORE INSERT ON audit WHEN NEW.action='month_close' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    let input = ready(&mut db, "2026-10");
    let copy = serde_json::to_string(&input).unwrap();
    assert!(db.close_month(input).is_err());
    assert!(!db.close_review("2026-10").unwrap().closed);
    c.execute_batch("DROP TRIGGER reject_close;").unwrap();
    db.close_month(serde_json::from_str(&copy).unwrap())
        .unwrap();
    let mut reused: CloseInput = serde_json::from_str(&copy).unwrap();
    reused.note = "Different".into();
    assert!(db.close_month(reused).is_err());
}

#[test]
fn closed_shared_reports_stay_frozen_through_nonfinancial_changes_until_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("100", "jacob");
    e.date = "2026-10-02".into();
    db.save(e.clone()).unwrap();
    let input = ready(&mut db, "2026-10");
    db.close_month(input).unwrap();
    let before = db.shared_statement_view(Some("2026-10")).unwrap();
    let file = db
        .export_statement(dir.path(), Some("2026-10"), "html")
        .unwrap();
    db.set_household_group(&e.id, 1, Some("bills")).unwrap();
    e.revision = 2;
    e.description = "Renamed after closing".into();
    db.save(e).unwrap();
    assert_eq!(db.shared_statement_view(Some("2026-10")).unwrap(), before);
    let second = db
        .export_statement(dir.path(), Some("2026-10"), "html")
        .unwrap();
    assert_eq!(std::fs::read(file).unwrap(), std::fs::read(second).unwrap());
    assert!(db
        .shared_statement_view(None)
        .unwrap()
        .to_string()
        .contains("Renamed after closing"));
    reopen(&mut db, "2026-10");
    assert!(db
        .shared_statement_view(Some("2026-10"))
        .unwrap()
        .to_string()
        .contains("Renamed after closing"));
}

#[test]
fn schema20_upgrade_and_corrupt_close_restore_preserve_current_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    purchase(&mut db, "100", "2026-10-02");
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_period_schema(&c);
    c.pragma_update(None, "user_version", 20).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let close = ready(&mut db, "2026-10");
    db.close_month(close).unwrap();
    let backup = db.backup().unwrap();
    let c = rusqlite::Connection::open(dir.path().join("backups").join("personal").join(&backup))
        .unwrap();
    c.execute("UPDATE month_closes SET snapshot_json='{}'", [])
        .unwrap();
    drop(c);
    assert!(db.restore(&backup).is_err());
    assert!(db.close_review("2026-10").unwrap().closed);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 10000);
}

#[test]
fn closed_backup_restore_preserves_reports_locks_and_retry_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    purchase(&mut db, "100", "2026-10-02");
    let input = ready(&mut db, "2026-10");
    let retry = serde_json::to_string(&input).unwrap();
    db.close_month(input).unwrap();
    let statement = db.shared_statement_view(Some("2026-10")).unwrap();
    let backup = db.backup().unwrap();
    reopen(&mut db, "2026-10");
    purchase(&mut db, "20", "2026-10-03");
    db.restore(&backup).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 10000);
    assert!(db.close_review("2026-10").unwrap().closed);
    assert_eq!(
        db.shared_statement_view(Some("2026-10")).unwrap(),
        statement
    );
    assert!(db.set_budget("2026-10", "groceries", "300").is_err());
    // A retried close is a no-op even after a deliberate reopen and restart.
    reopen(&mut db, "2026-10");
    drop(db);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.close_month(serde_json::from_str(&retry).unwrap())
        .unwrap();
    assert!(!db.close_review("2026-10").unwrap().closed);
    let backup = db.backup().unwrap();
    let c = rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    c.execute("UPDATE close_receipts SET payload_hash='corrupt'", [])
        .unwrap();
    drop(c);
    assert!(db.restore(&backup).is_err());
    assert!(!db.close_review("2026-10").unwrap().closed);
    let c = rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    c.execute_batch("DROP TABLE close_receipts").unwrap();
    drop(c);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 10000);
}

#[test]
fn closed_month_guards_import_undo_opening_and_checkpoint_mutations() {
    use crate::db::{balances::CheckpointInput, household::OpeningInput};
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_household_opening(OpeningInput {
        revision: 0,
        date: "2026-10-01".into(),
        amount: "100".into(),
        note: String::new(),
        reconciled: true,
    })
    .unwrap();
    let cp = Uuid::new_v4().to_string();
    db.save_checkpoint(CheckpointInput {
        id: cp.clone(),
        revision: 0,
        account_id: "checking".into(),
        date: "2026-10-01".into(),
        amount: "500".into(),
        purpose: "opening".into(),
        note: String::new(),
    })
    .unwrap();
    let d = imports::stage(&mut db, &imports::csv("10/10/2026,Market,100"), "amex");
    let operation = Uuid::new_v4().to_string();
    db.commit_import(
        &d.source.id,
        d.source.revision,
        &operation,
        d.rows.iter().map(imports::add).collect(),
    )
    .unwrap();
    let input = ready(&mut db, "2026-10");
    db.close_month(input).unwrap();
    assert!(db.undo_import(&operation).is_err());
    assert!(db.delete_checkpoint(&cp, 1).is_err());
    assert!(db
        .save_household_opening(OpeningInput {
            revision: 1,
            date: "2026-10-01".into(),
            amount: "50".into(),
            note: String::new(),
            reconciled: true
        })
        .is_err());
    assert_eq!(db.household_opening().unwrap().unwrap().amount_cents, 10000);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 10000);
}
