use super::*;
use crate::{db::balances::CheckpointInput, models::Balance};
fn checkpoint(account: &str, date: &str, amount: &str) -> CheckpointInput {
    CheckpointInput {
        id: Uuid::new_v4().to_string(),
        revision: 0,
        account_id: account.into(),
        date: date.into(),
        amount: amount.into(),
        purpose: "opening".into(),
        note: String::new(),
    }
}
fn balance(db: &Store, id: &str) -> Option<Balance> {
    db.snapshot("2026-11")
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.id == id)
        .unwrap()
        .balance
}
#[test]
fn opening_balances_are_not_income_and_only_later_recorded_activity_changes_estimate() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_checkpoint(checkpoint("checking", "2026-10-31", "1000"))
        .unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (s.income_cents, s.spent_cents, s.household_cents),
        (0, 0, 0)
    );
    assert!(s.entries.is_empty());
    let mut e = expense("100", "jacob");
    e.account_id = Some("checking".into());
    e.date = "2026-10-31".into();
    db.save(e).unwrap();
    assert_eq!(balance(&db, "checking").unwrap().estimated_cents, 100000);
    let mut e = expense("25", "jacob");
    e.account_id = Some("checking".into());
    e.date = "2026-11-01".into();
    db.save(e).unwrap();
    let b = balance(&db, "checking").unwrap();
    assert_eq!(b.checkpoint_cents, 100000);
    assert_eq!(b.known_change_cents, -2500);
    assert_eq!(b.estimated_cents, 97500);
}
#[test]
fn card_checkpoint_purchase_and_payment_do_not_double_count_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_checkpoint(checkpoint("amex", "2026-10-31", "0"))
        .unwrap();
    db.save_checkpoint(checkpoint("checking", "2026-10-31", "1000"))
        .unwrap();
    for amount in ["100", "200", "50", "74", "200"] {
        let mut e = expense(amount, "jacob");
        e.date = "2026-11-01".into();
        e.split_mode = "personal".into();
        db.save(e).unwrap();
    }
    assert_eq!(balance(&db, "amex").unwrap().estimated_cents, 62400);
    let mut p = expense("624", "jacob");
    p.kind = "card_payment".into();
    p.date = "2026-11-02".into();
    p.account_id = Some("checking".into());
    p.destination_account_id = Some("amex".into());
    p.category_id = None;
    p.split_mode = "none".into();
    db.save(p).unwrap();
    assert_eq!(balance(&db, "checking").unwrap().estimated_cents, 37600);
    assert_eq!(balance(&db, "amex").unwrap().estimated_cents, 0);
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 62400);
}
#[test]
fn confirmed_corrections_delete_and_stale_edits_preserve_transactions() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let old = checkpoint("checking", "2026-10-01", "500");
    db.save_checkpoint(old.clone()).unwrap();
    let mut next = checkpoint("checking", "2026-10-31", "1000");
    next.purpose = "confirmed".into();
    db.save_checkpoint(next.clone()).unwrap();
    assert_eq!(balance(&db, "checking").unwrap().estimated_cents, 100000);
    assert!(db.save_checkpoint(next.clone()).is_err());
    assert!(db
        .save_checkpoint(checkpoint("checking", "2026-10-31", "1001"))
        .is_err());
    next.revision = 1;
    next.amount = "999".into();
    db.save_checkpoint(next.clone()).unwrap();
    assert_eq!(balance(&db, "checking").unwrap().estimated_cents, 99900);
    next.revision = 2;
    next.account_id = "amex".into();
    assert!(db.save_checkpoint(next.clone()).is_err());
    assert!(db.delete_checkpoint(&next.id, 1).is_err());
    db.delete_checkpoint(&next.id, 2).unwrap();
    assert_eq!(balance(&db, "checking").unwrap().estimated_cents, 50000);
    db.delete_checkpoint(&old.id, 1).unwrap();
    assert!(balance(&db, "checking").is_none());
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
}
#[test]
fn manual_untracked_and_archive_modes_preserve_balance_history_and_owned_transfers() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut a = account_input(&db, "checking");
    a.tracking_mode = "manual".into();
    db.save_account(a).unwrap();
    db.save_checkpoint(checkpoint("checking", "2026-10-31", "1000"))
        .unwrap();
    let mut a = account_input(&db, "checking");
    a.tracking_mode = "untracked".into();
    db.save_account(a).unwrap();
    assert!(balance(&db, "checking").is_none());
    assert_eq!(db.balance_checkpoints("checking").unwrap().len(), 1);
    assert!(db
        .save_checkpoint(checkpoint("checking", "2026-11-01", "1000"))
        .is_err());
    let mut p = expense("100", "jacob");
    p.kind = "card_payment".into();
    p.date = "2026-11-01".into();
    p.account_id = Some("checking".into());
    p.destination_account_id = Some("amex".into());
    p.category_id = None;
    p.split_mode = "none".into();
    db.save(p).unwrap();
    assert!(balance(&db, "checking").is_none());
    let mut a = account_input(&db, "checking");
    a.tracking_mode = "manual".into();
    a.archived = true;
    db.save_account(a).unwrap();
    assert_eq!(balance(&db, "checking").unwrap().estimated_cents, 90000);
    assert!(db
        .save_checkpoint(checkpoint("checking", "2026-11-01", "900"))
        .is_err());
    let snap = db.backup().unwrap();
    db.restore(&snap).unwrap();
    assert_eq!(balance(&db, "checking").unwrap().estimated_cents, 90000);
}
#[test]
fn signed_balances_validate_bounds_dates_and_recovery_without_touching_active_data() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_checkpoint(checkpoint("amex", "2026-10-31", "-12.34"))
        .unwrap();
    assert_eq!(balance(&db, "amex").unwrap().estimated_cents, -1234);
    for amount in ["NaN", "--1", "1.234", "100000001", "-100000001"] {
        assert!(db
            .save_checkpoint(checkpoint("checking", "2026-10-31", amount))
            .is_err());
    }
    for date in ["2026-02-30", "2099-01-01", "1899-12-31"] {
        assert!(db
            .save_checkpoint(checkpoint("checking", date, "10"))
            .is_err());
    }
    let snap = db.backup().unwrap();
    let conn = rusqlite::Connection::open(dir.path().join("backups/personal").join(&snap)).unwrap();
    conn.execute(
        "UPDATE balance_checkpoints SET balance_cents=10000000001",
        [],
    )
    .unwrap();
    drop(conn);
    assert!(db.restore(&snap).is_err());
    assert_eq!(balance(&db, "amex").unwrap().estimated_cents, -1234);
}
#[test]
fn schema_seven_upgrade_keeps_itemized_history_and_does_not_invent_balances() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save(expense("100", "jacob")).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_identity_schema(&conn);
    conn.execute_batch("DROP TABLE paypal_allocations; DROP TABLE paypal_cashouts; DROP TABLE household_opening; DROP TABLE balance_checkpoints; ALTER TABLE accounts DROP COLUMN tracking_mode; PRAGMA user_version=7;").unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.spent_cents, 7000);
    assert!(s
        .accounts
        .iter()
        .all(|a| a.tracking_mode == "imported" && a.balance.is_none()));
    assert_eq!(s.entries[0].lines.len(), 1);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
}
