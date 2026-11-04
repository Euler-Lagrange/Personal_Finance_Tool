use crate::{
    db::Store,
    models::{AccountInput, CategoryInput, EntryInput},
};
use chrono::Local;
use uuid::Uuid;
mod ai_jobs;
mod ai_rows;
mod balances;
mod bills;
mod classification;
mod classification_profiles;
mod conditional_rules;
mod goals;
mod household;
mod identity;
mod imports;
mod lines;
mod managed_backups;
mod movements;
mod observations;
mod payment_codes;
mod periods;
mod purchase_review;
mod rewards_debt;
mod rules_refunds;
mod shared_reports;
mod sheet_defaults;
mod transfers;

fn expense(amount: &str, payer: &str) -> EntryInput {
    EntryInput {
        budget_override: None,
        id: Uuid::new_v4().to_string(),
        revision: 0,
        kind: "expense".into(),
        date: Local::now().format("%Y-%m-%d").to_string(),
        description: "Test purchase".into(),
        amount: amount.into(),
        payer: payer.into(),
        category_id: Some("groceries".into()),
        account_id: if payer == "jacob" {
            Some("amex".into())
        } else {
            None
        },
        destination_account_id: None,
        split_mode: "shared".into(),
        split_value: String::new(),
        original_event_id: None,
        paypal: None,
        lines: Vec::new(),
        note: String::new(),
    }
}
fn month() -> String {
    Local::now().format("%Y-%m").to_string()
}
fn repayment(amount: &str, payer: &str, checking: bool) -> EntryInput {
    EntryInput {
        budget_override: None,
        kind: "settlement".into(),
        description: "PayPal repayment".into(),
        category_id: None,
        account_id: if checking {
            Some("checking".into())
        } else {
            None
        },
        ..expense(amount, payer)
    }
}

#[test]
fn expense_settlement_restart_and_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save(expense("100.00", "jacob")).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.spent_cents, 7000);
    assert_eq!(s.household_cents, 3000);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        10000
    );
    let pre_settlement = db.backup().unwrap();
    db.save(repayment("30.00", "chelsea", true)).unwrap();
    drop(db);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.spent_cents, 7000);
    assert_eq!(s.income_cents, 0);
    assert_eq!(s.household_cents, 0);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        3000
    );
    db.restore(&pre_settlement).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.household_cents, 3000);
    assert_eq!(s.monthly_count, 1);
}

#[test]
fn chelsea_paid_expenses_have_no_jacob_cash_movement() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save(expense("48.00", "chelsea")).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.spent_cents, 3360);
    assert_eq!(s.household_cents, -3360);
    assert!(s.accounts.iter().all(|a| a.activity_cents == 0));
    db.save(repayment("33.60", "jacob", true)).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.household_cents, 0);
    assert_eq!(s.spent_cents, 3360);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        -3360
    );
}

#[test]
fn paypal_receipt_and_later_checking_deposit_count_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save(expense("100", "jacob")).unwrap();
    let mut receipt = repayment("30", "chelsea", false);
    db.save(receipt.clone()).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.household_cents, 0);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        0
    );
    receipt.revision = 1;
    receipt.account_id = Some("checking".into());
    db.save(receipt).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.monthly_count, 2);
    assert_eq!(s.income_cents, 0);
    assert_eq!(s.household_cents, 0);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        3000
    );
}

#[test]
fn historical_paypal_cash_out_still_works_after_the_balance_reverses() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save(expense("100", "jacob")).unwrap();
    let mut receipt = repayment("30", "chelsea", false);
    db.save(receipt.clone()).unwrap();
    db.save(expense("100", "chelsea")).unwrap();
    assert_eq!(db.snapshot(&month()).unwrap().household_cents, -7000);

    receipt.revision = 1;
    receipt.account_id = Some("checking".into());
    receipt.note = "Earlier PayPal repayment reached checking".into();
    db.save(receipt.clone()).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.household_cents, -7000);
    assert_eq!(s.spent_cents, 14000);
    assert_eq!(s.income_cents, 0);
    assert_eq!(s.monthly_count, 3);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        3000
    );
    receipt.revision = 2;
    receipt.amount = "31".into();
    assert!(db.save(receipt).is_err());
    assert!(db.save(repayment("1", "chelsea", true)).is_err());
    assert_eq!(db.snapshot(&month()).unwrap().household_cents, -7000);
}

#[test]
fn restore_rejects_an_incomplete_schema_before_replacing_live_data() {
    for damage in [
        "DROP TABLE budget_months",
        "DROP TABLE audit",
        "ALTER TABLE categories DROP COLUMN icon",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path(), "personal").unwrap();
        db.save(expense("100", "jacob")).unwrap();
        let backup = db.backup().unwrap();
        let candidate =
            rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
        candidate.execute_batch(damage).unwrap();
        drop(candidate);
        db.save(expense("50", "jacob")).unwrap();
        assert!(db.restore(&backup).is_err(), "{damage}");
        let s = db.snapshot(&month()).unwrap();
        assert_eq!(s.monthly_count, 2, "{damage}");
        assert_eq!(s.spent_cents, 10500, "{damage}");
        db.save(expense("1", "jacob")).unwrap();
    }
}

#[test]
fn restore_rejects_inconsistent_account_activity_before_replacing_live_data() {
    for damage in [
        "DELETE FROM account_activity",
        "UPDATE account_activity SET change_cents=1",
        "UPDATE account_activity SET account_id='checking'",
        "UPDATE events SET household_delta_cents=1",
        "UPDATE events SET split_mode='equal'",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path(), "personal").unwrap();
        db.save(expense("100", "jacob")).unwrap();
        let backup = db.backup().unwrap();
        let candidate =
            rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
        candidate.execute_batch(damage).unwrap();
        drop(candidate);
        assert!(db.restore(&backup).is_err(), "{damage}");
        assert_eq!(
            db.snapshot(&month())
                .unwrap()
                .accounts
                .iter()
                .find(|a| a.id == "amex")
                .unwrap()
                .activity_cents,
            10000
        );
    }
}

#[test]
fn recovery_accepts_valid_income_savings_and_both_repayment_directions() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let savings = Uuid::new_v4().to_string();
    db.save_account(AccountInput {
        tracking_mode: "imported".into(),
        id: savings.clone(),
        revision: 0,
        name: "Savings".into(),
        kind: "savings".into(),
        archived: false,
    })
    .unwrap();
    let mut income = expense("1000", "jacob");
    income.kind = "income".into();
    income.account_id = Some(savings.clone());
    db.save(income).unwrap();
    let mut purchase = expense("100", "jacob");
    purchase.account_id = Some(savings.clone());
    db.save(purchase).unwrap();
    db.save(repayment("10", "chelsea", false)).unwrap();
    db.save(repayment("20", "chelsea", true)).unwrap();
    db.save(expense("100", "chelsea")).unwrap();
    db.save(repayment("70", "jacob", true)).unwrap();
    let backup = db.backup().unwrap();
    db.save(expense("99", "jacob")).unwrap();
    db.restore(&backup).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.monthly_count, 6);
    assert_eq!(s.income_cents, 100000);
    assert_eq!(s.spent_cents, 14000);
    assert_eq!(s.household_cents, 0);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == savings)
            .unwrap()
            .activity_cents,
        90000
    );
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        -5000
    );
}

#[test]
fn edits_replace_account_activity_and_reject_stale_changes() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("126.69", "jacob");
    db.save(e.clone()).unwrap();
    assert!(db.save(e.clone()).is_err());
    e.revision = 1;
    e.payer = "chelsea".into();
    e.account_id = None;
    e.amount = "48".into();
    db.save(e.clone()).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.monthly_count, 1);
    assert_eq!(s.spent_cents, 3360);
    assert!(s.accounts.iter().all(|a| a.activity_cents == 0));
    assert!(db.delete(&e.id, 1).is_err());
    db.delete(&e.id, 2).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.monthly_count, 0);
    assert_eq!(s.household_cents, 0);
}

#[test]
fn invalid_mutations_do_not_partially_write() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    for mut e in [
        expense("0", "jacob"),
        expense("-1", "jacob"),
        expense("1.001", "jacob"),
    ] {
        assert!(db.save(e.clone()).is_err());
        e.amount = "2".into();
        e.category_id = Some("missing".into());
        assert!(db.save(e).is_err());
    }
    assert!(db.save(repayment("30", "chelsea", true)).is_err());
    let mut e = expense("100", "chelsea");
    e.account_id = Some("checking".into());
    assert!(db.save(e).is_err());
    assert_eq!(db.snapshot(&month()).unwrap().monthly_count, 0);
}

#[test]
fn monthly_budgets_and_all_time_household_balance_are_separate() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("100", "jacob");
    e.date = "2026-01-31".into();
    db.save(e).unwrap();
    db.set_budget("2026-01", "groceries", "200").unwrap();
    let jan = db.snapshot("2026-01").unwrap();
    assert_eq!(jan.remaining_cents, 13000);
    let feb = db.snapshot("2026-02").unwrap();
    assert_eq!(feb.spent_cents, 0);
    assert_eq!(feb.budget_cents, 0);
    assert_eq!(feb.household_cents, 3000);
}

#[test]
fn corrupt_restore_leaves_active_data_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save(expense("100", "jacob")).unwrap();
    std::fs::write(
        dir.path().join("backups/personal/corrupt.sqlite"),
        b"not a database",
    )
    .unwrap();
    assert!(db.restore("corrupt.sqlite").is_err());
    assert!(db.restore("../../demo.sqlite").is_err());
    assert_eq!(db.snapshot(&month()).unwrap().spent_cents, 7000);
}

#[test]
fn demo_and_personal_data_are_isolated() {
    let dir = tempfile::tempdir().unwrap();
    let demo = Store::open(dir.path(), "demo").unwrap();
    let personal = Store::open(dir.path(), "personal").unwrap();
    assert!(demo.snapshot(&month()).unwrap().monthly_count > 0);
    assert_eq!(personal.snapshot(&month()).unwrap().monthly_count, 0);
    assert_eq!(personal.snapshot(&month()).unwrap().budget_cents, 0);
}

#[test]
fn oldest_backup_can_be_restored_when_retention_is_full() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    for _ in 0..21 {
        db.backup().unwrap();
    }
    db.save(expense("100", "jacob")).unwrap();
    let backups = db.list_backups().unwrap();
    assert_eq!(backups.len(), 20);
    db.restore(backups.last().unwrap()).unwrap();
    assert_eq!(db.snapshot(&month()).unwrap().spent_cents, 0);
    assert_eq!(db.list_backups().unwrap().len(), 20);
}

#[test]
fn partial_repayments_and_entirely_chelsea_expense() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("197.76", "jacob");
    e.split_mode = "chelsea".into();
    db.save(e).unwrap();
    db.save(repayment("100", "chelsea", true)).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.spent_cents, 0);
    assert_eq!(s.household_cents, 9776);
    assert_eq!(s.income_cents, 0);
    assert!(db.save(repayment("97.77", "chelsea", true)).is_err());
    db.save(repayment("97.76", "chelsea", true)).unwrap();
    assert_eq!(db.snapshot(&month()).unwrap().household_cents, 0);
}

fn account_input(db: &Store, id: &str) -> AccountInput {
    let a = db
        .snapshot(&month())
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.id == id)
        .unwrap();
    AccountInput {
        tracking_mode: a.tracking_mode,
        id: a.id,
        revision: a.revision,
        name: a.name,
        kind: a.kind,
        archived: a.archived,
    }
}
fn category_input(db: &Store, id: &str) -> CategoryInput {
    let c = db
        .snapshot(&month())
        .unwrap()
        .categories
        .into_iter()
        .find(|c| c.id == id)
        .unwrap();
    CategoryInput {
        id: c.id,
        revision: c.revision,
        name: c.name,
        group_name: c.group_name,
        color: c.color,
        icon: c.icon,
        default_limit: format!(
            "{}.{:02}",
            c.default_limit_cents / 100,
            c.default_limit_cents % 100
        ),
        archived: c.archived,
    }
}

#[test]
fn custom_savings_account_archive_history_and_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = Uuid::new_v4().to_string();
    db.save_account(AccountInput {
        tracking_mode: "imported".into(),
        id: id.clone(),
        revision: 0,
        name: "Gift Fund".into(),
        kind: "savings".into(),
        archived: false,
    })
    .unwrap();
    let mut income = expense("200", "jacob");
    income.kind = "income".into();
    income.account_id = Some(id.clone());
    income.category_id = None;
    db.save(income).unwrap();
    let mut purchase = expense("50", "jacob");
    purchase.split_mode = "personal".into();
    purchase.account_id = Some(id.clone());
    db.save(purchase.clone()).unwrap();
    let mut account = account_input(&db, &id);
    account.name = "Gifts savings".into();
    account.archived = true;
    db.save_account(account).unwrap();
    let mut duplicate = expense("10", "jacob");
    duplicate.account_id = Some(id.clone());
    assert!(db.save(duplicate).unwrap_err().contains("archived"));
    purchase.revision = 1;
    purchase.note = "Receipt attached later".into();
    db.save(purchase).unwrap(); // Existing reference can remain in an edit.
    let mut account = account_input(&db, &id);
    account.kind = "credit".into();
    assert!(db
        .save_account(account)
        .unwrap_err()
        .contains("type cannot change"));
    let snapshot = db.backup().unwrap();
    let mut account = account_input(&db, &id);
    account.archived = false;
    db.save_account(account).unwrap();
    db.restore(&snapshot).unwrap();
    drop(db);
    let db = Store::open(dir.path(), "personal").unwrap();
    let s = db.snapshot(&month()).unwrap();
    let a = s.accounts.iter().find(|a| a.id == id).unwrap();
    assert_eq!(a.name, "Gifts savings");
    assert!(a.archived);
    assert_eq!(a.activity_cents, 15000);
    assert_eq!(s.spent_cents, 5000);
    assert_eq!(s.income_cents, 20000);
    assert_eq!(s.household_cents, 0);
}

#[test]
fn category_defaults_copy_and_archiving_preserve_months() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = Uuid::new_v4().to_string();
    db.save_category(CategoryInput {
        id: id.clone(),
        revision: 0,
        name: "Electric bill".into(),
        group_name: "Needs".into(),
        color: "#7488c1".into(),
        icon: "electric".into(),
        default_limit: "125.50".into(),
        archived: false,
    })
    .unwrap();
    let mut e = expense("100", "jacob");
    e.category_id = Some(id.clone());
    e.date = "2025-01-10".into();
    db.save(e.clone()).unwrap();
    assert_eq!(db.snapshot("2025-01").unwrap().budget_cents, 0);
    db.apply_budget_template("2025-01", None, false).unwrap();
    assert_eq!(db.snapshot("2025-01").unwrap().budget_cents, 583200 + 12550);
    let mut c = category_input(&db, &id);
    c.default_limit = "200".into();
    db.save_category(c).unwrap();
    assert_eq!(db.snapshot("2025-01").unwrap().budget_cents, 583200 + 12550);
    assert_eq!(db.snapshot("2025-02").unwrap().budget_cents, 0);
    db.set_budget("2025-02", &id, "0").unwrap();
    db.apply_budget_template("2025-02", None, false).unwrap();
    assert_eq!(db.snapshot("2025-02").unwrap().budget_cents, 583200); // Explicit zero is preserved; other defaults are filled.
    db.apply_budget_template("2025-02", None, true).unwrap();
    assert_eq!(db.snapshot("2025-02").unwrap().budget_cents, 583200 + 20000);
    db.apply_budget_template("2025-03", Some("2025-01"), false)
        .unwrap();
    assert_eq!(db.snapshot("2025-03").unwrap().budget_cents, 583200 + 12550);
    assert_eq!(db.snapshot("2025-03").unwrap().spent_cents, 0);
    let mut c = category_input(&db, &id);
    c.name = "Electricity".into();
    c.archived = true;
    db.save_category(c).unwrap();
    db.apply_budget_template("2025-04", Some("2025-01"), false)
        .unwrap();
    assert_eq!(db.snapshot("2025-04").unwrap().budget_cents, 583200); // Archived category is not copied.
    let jan = db.snapshot("2025-01").unwrap();
    assert_eq!(jan.spent_cents, 7000);
    assert_eq!(jan.budget_cents, 583200 + 12550);
    let category = jan.categories.iter().find(|c| c.id == id).unwrap();
    assert_eq!(category.name, "Electricity");
    assert_eq!(category.icon, "electric");
    assert!(category.archived);
    let mut new = e.clone();
    new.id = Uuid::new_v4().to_string();
    assert!(db.save(new).unwrap_err().contains("archived"));
    e.revision = 1;
    e.note = "Corrected note".into();
    db.save(e).unwrap();
    assert!(db.set_budget("2025-05", &id, "50").is_err());
    let mut c = category_input(&db, &id);
    c.archived = false;
    db.save_category(c).unwrap();
    db.set_budget("2025-05", &id, "50").unwrap();
}

#[test]
fn setup_rejects_stale_duplicate_and_invalid_changes_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let stale = account_input(&db, "checking");
    let mut change = account_input(&db, "checking");
    change.name = "Everyday checking".into();
    db.save_account(change).unwrap();
    assert!(db.save_account(stale).is_err());
    let mut duplicate = account_input(&db, "amex");
    duplicate.name = "everyday CHECKING".into();
    assert!(db.save_account(duplicate).is_err());
    let stale = category_input(&db, "groceries");
    let mut c = category_input(&db, "groceries");
    c.default_limit = "600".into();
    db.save_category(c).unwrap();
    assert!(db.save_category(stale).is_err());
    for invalid in ["#notrgb", "orange", "#123456;display:none"] {
        let mut c = category_input(&db, "groceries");
        c.color = invalid.into();
        assert!(db.save_category(c).is_err());
    }
    let mut c = category_input(&db, "groceries");
    c.default_limit = "12.345".into();
    assert!(db.save_category(c).is_err());
    let mut c = category_input(&db, "groceries");
    c.name = " ".into();
    assert!(db.save_category(c).is_err());
    let mut c = category_input(&db, "uncategorized");
    c.archived = true;
    assert!(db.save_category(c).is_err());
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.monthly_count, 0);
    assert_eq!(s.budget_cents, 0);
    assert_eq!(
        s.accounts.iter().find(|a| a.id == "amex").unwrap().name,
        "American Express"
    );
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "groceries")
            .unwrap()
            .default_limit_cents,
        60000
    );
}

#[test]
fn copy_rejects_missing_future_and_same_month_without_partial_budget() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    for source in ["2024-01", "2025-02", "2025-03", "invalid"] {
        assert!(db
            .apply_budget_template("2025-02", Some(source), true)
            .is_err());
        let s = db.snapshot("2025-02").unwrap();
        assert!(!s.budget_configured);
        assert_eq!(s.budget_cents, 0);
    }
    assert!(db.apply_budget_template("2025-99", None, false).is_err());
}

#[test]
fn version_one_migration_and_old_backup_restore_preserve_records_and_limits() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("personal.sqlite");
    let legacy = rusqlite::Connection::open(&path).unwrap();
    legacy
        .execute_batch(include_str!("fixtures/workspace_v1.sql"))
        .unwrap();
    drop(legacy);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let old_backup = db.list_backups().unwrap().pop().unwrap();
    let jan = db.snapshot("2025-01").unwrap();
    assert_eq!(jan.spent_cents, 7000);
    assert_eq!(jan.budget_cents, 0);
    assert_eq!(jan.household_cents, 6000);
    assert_eq!(jan.entries[0].note, "Original note");
    assert_eq!(db.snapshot("2025-02").unwrap().budget_cents, 70000);
    assert_eq!(
        jan.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        20000
    );
    let mut c = category_input(&db, "groceries");
    c.default_limit = "900".into();
    db.save_category(c).unwrap();
    assert_eq!(db.snapshot("2025-02").unwrap().budget_cents, 70000);
    let mut account = account_input(&db, "amex");
    account.archived = true;
    db.save_account(account).unwrap();
    db.restore(&old_backup).unwrap();
    assert!(!account_input(&db, "amex").archived);
    assert_eq!(category_input(&db, "groceries").default_limit, "700.00");
    let conn = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        crate::migrations::CURRENT_VERSION
    );
    assert!(!conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .exists([])
        .unwrap());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM account_activity", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
}

#[test]
fn invalid_legacy_references_roll_back_the_migration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("personal.sqlite");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("fixtures/workspace_v1.sql"))
        .unwrap();
    conn.execute_batch("PRAGMA foreign_keys=OFF; UPDATE events SET account_id='missing';")
        .unwrap();
    drop(conn);
    assert!(Store::open(dir.path(), "personal").is_err());
    let conn = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert!(conn.prepare("SELECT archived FROM accounts").is_err());
}

// These fixtures emulate genuinely older schemas, not a lower version number on new tables.
fn remove_identity_schema(conn: &rusqlite::Connection) {
    remove_observation_schema(conn);
    conn.execute_batch("DROP TABLE import_dependencies; DROP TABLE import_stable_ids; DROP TABLE import_coverage; ALTER TABLE import_rows DROP COLUMN occurrence_id; DROP TABLE import_occurrences; ALTER TABLE import_commits DROP COLUMN identity_only;").unwrap();
}

fn remove_goal_schema(conn: &rusqlite::Connection) {
    remove_shared_report_schema(conn);
    conn.execute_batch("DROP TABLE goal_interest; DROP TABLE goal_funding_receipts; DROP TABLE goal_funding; DROP TABLE savings_goals;").unwrap();
}
fn remove_conditional_rule_schema(conn: &rusqlite::Connection) {
    remove_goal_schema(conn);
    conn.execute_batch("ALTER TABLE merchant_rules DROP COLUMN category_scope;")
        .unwrap();
}
fn remove_purchase_review_schema(conn: &rusqlite::Connection) {
    remove_conditional_rule_schema(conn);
    conn.execute_batch("DROP TABLE purchase_reviews;").unwrap();
}
fn remove_payment_code_schema(conn: &rusqlite::Connection) {
    remove_purchase_review_schema(conn);
    conn.execute_batch("DROP VIEW effective_activity_dates; DROP TABLE import_account_dates; ALTER TABLE pending_activity DROP COLUMN kind_hint;").unwrap();
}
fn remove_profile_schema(conn: &rusqlite::Connection) {
    remove_payment_code_schema(conn);
    conn.execute_batch("DROP TABLE import_classification_profiles;")
        .unwrap();
}
fn remove_movement_schema(conn: &rusqlite::Connection) {
    remove_profile_schema(conn);
    conn.execute_batch("PRAGMA foreign_keys=OFF; DROP TABLE movement_dependencies; DROP TABLE movement_reconciliations; DROP TABLE activity_dates;").unwrap();
}
fn remove_classification_schema(conn: &rusqlite::Connection) {
    remove_movement_schema(conn);
    conn.execute_batch("PRAGMA foreign_keys=OFF; DROP TABLE pending_activity; DROP TABLE activity_resolutions; DROP TABLE import_classification;").unwrap();
    let ddl = include_str!("migrations/010_household_paypal.sql")
        .split("CREATE TABLE household_opening")
        .next()
        .unwrap();
    conn.execute_batch(ddl).unwrap();
}
fn remove_observation_schema(conn: &rusqlite::Connection) {
    remove_classification_schema(conn);
    conn.execute_batch("PRAGMA foreign_keys=OFF; DROP TABLE import_observations; DROP TABLE import_download_profiles;").unwrap();
    let ddl = include_str!("migrations/004_imports.sql")
        .split("CREATE TABLE import_commits")
        .next()
        .unwrap()
        .replace(
            "CREATE TABLE import_sources",
            "CREATE TABLE import_sources_old",
        );
    conn.execute_batch(&ddl).unwrap();
    conn.execute_batch("INSERT INTO import_sources_old SELECT s.id,s.fingerprint,s.name,s.mime,s.format,e.content,s.account_id,s.revision,s.dataset_json,s.mapping_json,s.error,s.configured,s.dismissed,s.created_at FROM import_sources s JOIN import_evidence e ON e.fingerprint=s.fingerprint; DROP TABLE import_sources; ALTER TABLE import_sources_old RENAME TO import_sources; DROP TABLE import_evidence;").unwrap();
}

fn remove_shared_report_schema(conn: &rusqlite::Connection) {
    remove_period_schema(conn);
    conn.execute_batch("DROP TABLE household_groups;").unwrap();
}

fn remove_pdf_routes_schema(conn: &rusqlite::Connection) {
    remove_ai_rows_schema(conn);
    conn.execute_batch("DROP TABLE ai_jobs;").unwrap();
    conn.execute_batch("DROP TABLE pdf_routes; DROP TABLE pdf_route_receipts;")
        .unwrap();
}
fn remove_pdf_table_schema(conn: &rusqlite::Connection) {
    remove_pdf_routes_schema(conn);
    conn.execute_batch("DROP TABLE pdf_table_bindings; DROP TABLE pdf_table_versions; DROP TABLE pdf_table_templates; DROP TABLE pdf_table_receipts;").unwrap();
}
fn remove_pdf_schema(conn: &rusqlite::Connection) {
    remove_pdf_table_schema(conn);
    conn.execute_batch("DROP TABLE pdf_applications; DROP TABLE pdf_template_versions; DROP TABLE pdf_templates; DROP TABLE pdf_receipts;").unwrap();
}
fn remove_cash_forecast_schema(conn: &rusqlite::Connection) {
    remove_pdf_schema(conn);
    conn.execute_batch("DROP TABLE cash_forecast_settings; DROP TABLE cash_forecast_receipts;")
        .unwrap();
}
fn remove_card_payment_schema(conn: &rusqlite::Connection) {
    remove_cash_forecast_schema(conn);
    conn.execute_batch("DROP TABLE card_payment_allocations; DROP TABLE card_payment_reviews; DROP TABLE card_obligations; DROP TABLE card_payment_receipts;").unwrap();
}
fn remove_card_statement_schema(conn: &rusqlite::Connection) {
    remove_card_payment_schema(conn);
    conn.execute_batch("DROP TABLE card_statements; DROP TABLE card_statement_configs; DROP TABLE card_statement_receipts;").unwrap();
}
fn remove_cash_plan_schema(conn: &rusqlite::Connection) {
    remove_card_statement_schema(conn);
    conn.execute_batch("DROP TABLE cash_matches; DROP TABLE cash_occurrences; DROP TABLE cash_schedules; DROP TABLE cash_receipts;").unwrap();
}
fn remove_budget_period_schema(conn: &rusqlite::Connection) {
    remove_cash_plan_schema(conn);
    conn.execute_batch("DROP TABLE budget_period_overrides;")
        .unwrap();
}
fn remove_rollover_schema(conn: &rusqlite::Connection) {
    remove_budget_period_schema(conn);
    conn.execute_batch("DROP TABLE budget_carry_entries; DROP TABLE rollover_policies; DROP TABLE budget_receipts;").unwrap();
}
fn remove_period_schema(conn: &rusqlite::Connection) {
    remove_rollover_schema(conn);
    conn.execute_batch("DROP TABLE month_closes; DROP TABLE close_receipts;")
        .unwrap();
}

mod rollover;

mod budget_periods;

mod trends;

mod cash_plans;

mod card_statements;

mod card_payments;

mod cash_forecast;

mod pdf_documents;

mod pdf_tables;

mod ai_documents;
mod pdf_routes;

fn remove_ai_rows_schema(conn: &rusqlite::Connection) {
    remove_ai_documents_schema(conn);
    conn.execute_batch("DROP TABLE ai_row_bindings; DROP TABLE ai_row_reviews;")
        .unwrap();
}
fn remove_ai_documents_schema(conn: &rusqlite::Connection) {
    remove_ai_mapping_schema(conn);
    conn.execute_batch("DROP TABLE ai_document_applications;")
        .unwrap();
}

fn remove_ai_mapping_schema(conn: &rusqlite::Connection) {
    remove_handoff_schema(conn);
    conn.execute_batch("DROP TABLE ai_mapping_reviews;")
        .unwrap();
}
mod ai_configuration;
mod pay_calendar;
mod pay_cash;
mod pay_forecast;
mod pay_tax;
mod payroll;

/// Simulates a workspace saved before schema 37 recorded provider token usage.
fn remove_ai_usage_schema(conn: &rusqlite::Connection) {
    remove_payroll_schema(conn);
    conn.execute_batch("ALTER TABLE ai_jobs DROP COLUMN usage_json;")
        .unwrap();
}
fn remove_payroll_schema(conn: &rusqlite::Connection) {
    remove_pay_calendar_schema(conn);
    conn.execute_batch("DROP TABLE payroll_changes; DROP TABLE payroll_state;")
        .unwrap();
}
fn remove_pay_calendar_schema(conn: &rusqlite::Connection) {
    conn.execute_batch("DROP TABLE payroll_sources;").unwrap();
}
fn remove_handoff_schema(conn: &rusqlite::Connection) {
    remove_ai_usage_schema(conn);
    conn.execute_batch(
        "DROP TABLE handoff_receipts; DROP TABLE handoff_nodes; DROP TABLE handoff_state;",
    )
    .unwrap();
}
mod final_lifecycle;
mod handoff;
