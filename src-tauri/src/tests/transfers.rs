use super::*;

fn movement(kind: &str, amount: &str, source: &str, destination: &str) -> EntryInput {
    EntryInput {
        budget_override: None,
        kind: kind.into(),
        description: "Account movement".into(),
        account_id: Some(source.into()),
        destination_account_id: Some(destination.into()),
        category_id: None,
        split_mode: "none".into(),
        ..expense(amount, "jacob")
    }
}
fn savings(db: &mut Store, name: &str) -> String {
    let id = Uuid::new_v4().to_string();
    db.save_account(AccountInput {
        tracking_mode: "imported".into(),
        id: id.clone(),
        revision: 0,
        name: name.into(),
        kind: "savings".into(),
        archived: false,
    })
    .unwrap();
    id
}
fn activity(db: &Store, id: &str) -> i64 {
    db.snapshot(&month())
        .unwrap()
        .accounts
        .iter()
        .find(|a| a.id == id)
        .unwrap()
        .activity_cents
}

#[test]
fn five_purchases_and_624_payment_count_spending_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    for amount in ["100", "125.50", "48.25", "200", "150.25"] {
        let mut purchase = expense(amount, "jacob");
        purchase.split_mode = "personal".into();
        db.save(purchase).unwrap();
    }
    assert_eq!(activity(&db, "amex"), 62400);
    let payment = movement("card_payment", "624", "checking", "amex");
    db.save(payment.clone()).unwrap();
    assert!(db.save(payment).is_err()); // retry of the same submission cannot duplicate it
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(
        (s.spent_cents, s.income_cents, s.household_cents),
        (62400, 0, 0)
    );
    assert_eq!(s.monthly_count, 6);
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "groceries")
            .unwrap()
            .spent_cents,
        62400
    );
    assert_eq!(activity(&db, "amex"), 0);
    assert_eq!(activity(&db, "checking"), -62400);
    assert!(s.household_entries.is_empty());
    drop(db);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let backup = db.backup().unwrap();
    db.save(expense("9", "jacob")).unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(activity(&db, "amex"), 0);
    assert_eq!(db.snapshot(&month()).unwrap().spent_cents, 62400);
}

#[test]
fn later_month_payment_does_not_move_or_reduce_purchase_month_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut purchase = expense("100", "jacob");
    purchase.date = "2025-01-31".into();
    db.save(purchase).unwrap();
    db.set_budget("2025-01", "groceries", "200").unwrap();
    let mut payment = movement("card_payment", "100", "checking", "amex");
    payment.date = "2025-02-02".into();
    db.save(payment).unwrap();
    let jan = db.snapshot("2025-01").unwrap();
    let feb = db.snapshot("2025-02").unwrap();
    assert_eq!(
        (jan.spent_cents, jan.remaining_cents, jan.monthly_count),
        (7000, 13000, 1)
    );
    assert_eq!(
        (feb.spent_cents, feb.income_cents, feb.monthly_count),
        (0, 0, 1)
    );
    assert_eq!(feb.household_cents, 3000);
    assert_eq!(activity(&db, "amex"), 0);
}

#[test]
fn transfers_edit_both_legs_move_month_and_delete_without_budget_effects() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let gift = savings(&mut db, "Gift fund");
    let pto = savings(&mut db, "PTO fund");
    let mut transfer = movement("transfer", "500.01", "checking", &gift);
    transfer.date = "2025-01-31".into();
    db.save(transfer.clone()).unwrap();
    assert_eq!(activity(&db, "checking"), -50001);
    assert_eq!(activity(&db, &gift), 50001);
    transfer.revision = 1;
    transfer.amount = "125.55".into();
    transfer.account_id = Some(gift.clone());
    transfer.destination_account_id = Some(pto.clone());
    transfer.date = "2025-02-01".into();
    db.save(transfer.clone()).unwrap();
    assert_eq!(activity(&db, "checking"), 0);
    assert_eq!(activity(&db, &gift), -12555);
    assert_eq!(activity(&db, &pto), 12555);
    assert_eq!(db.snapshot("2025-01").unwrap().monthly_count, 0);
    let s = db.snapshot("2025-02").unwrap();
    assert_eq!(
        (
            s.monthly_count,
            s.spent_cents,
            s.income_cents,
            s.household_cents
        ),
        (1, 0, 0, 0)
    );
    assert_eq!(
        s.entries[0].destination_account_id.as_deref(),
        Some(pto.as_str())
    );
    assert!(db.save(transfer.clone()).is_err());
    assert!(db.delete(&transfer.id, 1).is_err());
    db.delete(&transfer.id, 2).unwrap();
    assert!(db
        .snapshot(&month())
        .unwrap()
        .accounts
        .iter()
        .all(|a| a.activity_cents == 0));
}

#[test]
fn payments_allow_partial_and_prior_history_and_preserve_shared_debt() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let bank = savings(&mut db, "Savings");
    db.save(expense("100", "jacob")).unwrap();
    let mut payment = movement("card_payment", "40", &bank, "amex");
    db.save(payment.clone()).unwrap();
    assert_eq!(activity(&db, "amex"), 6000);
    payment.revision = 1;
    payment.amount = "624".into();
    payment.destination_account_id = Some("citi".into());
    db.save(payment.clone()).unwrap();
    assert_eq!(activity(&db, "amex"), 10000);
    assert_eq!(activity(&db, "citi"), -62400); // no opening/reconciled balance assumed
    assert_eq!(activity(&db, &bank), -62400);
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(
        (s.spent_cents, s.income_cents, s.household_cents),
        (7000, 0, 3000)
    );
    assert_eq!(s.household_entries.len(), 1);
    db.delete(&payment.id, 2).unwrap();
    assert_eq!(activity(&db, "citi"), 0);
    assert_eq!(activity(&db, &bank), 0);
}

#[test]
fn invalid_transfers_leave_no_partial_events_or_account_activity() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let gift = savings(&mut db, "Gift");
    let valid = movement("transfer", "10", "checking", &gift);
    let mut bad = vec![
        movement("transfer", "10", "checking", "checking"),
        movement("transfer", "10", "amex", &gift),
        movement("transfer", "10", "checking", "amex"),
        movement("card_payment", "10", "checking", &gift),
        movement("transfer", "10", "checking", "missing"),
        movement("transfer", "0", "checking", &gift),
        movement("transfer", "1.001", "checking", &gift),
    ];
    let mut no_dest = valid.clone();
    no_dest.destination_account_id = None;
    bad.push(no_dest);
    let mut no_source = valid.clone();
    no_source.account_id = None;
    bad.push(no_source);
    let mut shared = valid.clone();
    shared.payer = "chelsea".into();
    bad.push(shared);
    let mut category = valid.clone();
    category.category_id = Some("groceries".into());
    bad.push(category);
    let mut split = valid.clone();
    split.split_mode = "shared".into();
    bad.push(split);
    let mut future = valid.clone();
    future.date = (Local::now().date_naive() + chrono::Duration::days(1)).to_string();
    bad.push(future);
    let mut unexpected = expense("10", "jacob");
    unexpected.destination_account_id = Some(gift);
    bad.push(unexpected);
    for input in bad {
        assert!(db.save(input).is_err());
    }
    assert_eq!(db.snapshot(&month()).unwrap().monthly_count, 0);
    assert!(db
        .snapshot(&month())
        .unwrap()
        .accounts
        .iter()
        .all(|a| a.activity_cents == 0));
    // Simulate destination write failure after a valid source leg was inserted.
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_destination BEFORE INSERT ON account_activity WHEN NEW.account_id='citi' BEGIN SELECT RAISE(ABORT,'test destination failure'); END;").unwrap();
    assert!(db
        .save(movement("card_payment", "25", "checking", "citi"))
        .is_err());
    assert_eq!(db.snapshot(&month()).unwrap().monthly_count, 0);
    assert_eq!(activity(&db, "checking"), 0);
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM audit WHERE action='create'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn archived_transfer_accounts_preserve_history_but_cannot_be_new_choices() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let gift = savings(&mut db, "Gift");
    let mut transfer = movement("transfer", "100", "checking", &gift);
    db.save(transfer.clone()).unwrap();
    for id in ["checking", &gift] {
        let mut a = account_input(&db, id);
        a.archived = true;
        db.save_account(a).unwrap();
    }
    transfer.revision = 1;
    transfer.amount = "80".into();
    db.save(transfer.clone()).unwrap();
    assert_eq!(activity(&db, &gift), 8000);
    assert!(db
        .save(movement("transfer", "1", "checking", &gift))
        .is_err());
    let active = savings(&mut db, "Active bank");
    assert!(db.save(movement("transfer", "1", &active, &gift)).is_err());
    transfer.revision = 2;
    transfer.account_id = Some(active.clone());
    db.save(transfer.clone()).unwrap();
    assert_eq!(activity(&db, "checking"), 0);
    assert_eq!(activity(&db, &active), -8000);
    let backup = db.backup().unwrap();
    db.delete(&transfer.id, 3).unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(activity(&db, &gift), 8000);
}

#[test]
fn restore_rejects_missing_extra_or_incorrect_transfer_legs() {
    for damage in [
        "DELETE FROM account_activity WHERE account_id='amex'",
        "UPDATE account_activity SET change_cents=10000 WHERE account_id='amex'",
        "UPDATE account_activity SET change_cents=0 WHERE account_id='checking'",
        "INSERT INTO account_activity SELECT event_id,'citi',1 FROM account_activity WHERE account_id='checking'",
        "UPDATE events SET destination_account_id='citi'",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path(), "personal").unwrap();
        db.save(movement("card_payment", "100", "checking", "amex")).unwrap();
        let backup = db.backup().unwrap();
        let conn = rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
        conn.execute_batch(damage).unwrap(); drop(conn);
        assert!(db.restore(&backup).is_err(), "{damage}");
        assert_eq!(activity(&db, "checking"), -10000);
        assert_eq!(activity(&db, "amex"), -10000);
    }
}

fn create_v2(path: &std::path::Path) {
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.execute_batch(include_str!("../fixtures/schema_v2.sql"))
        .unwrap();
    conn.execute_batch("INSERT INTO metadata VALUES ('workspace','personal');
        INSERT INTO accounts VALUES ('checking','Bank','checking',2,0),('amex','Card','credit',4,0);
        INSERT INTO categories VALUES ('groceries','Groceries','Needs','#123456',8800,7,1,'groceries'),('uncategorized','Uncategorized','Other','#333333',0,1,0,'auto');
        INSERT INTO events VALUES ('86838cf9-0f3c-4c33-b3f6-49b3e4b4e891',3,'expense','2025-01-02','Old groceries',10000,'jacob','groceries','amex','shared','',7000,3000,3000,'Keep this note');
        INSERT INTO account_activity SELECT id,account_id,amount_cents FROM events;
        INSERT INTO budgets VALUES ('2025-01','groceries',2500);
        INSERT INTO budget_months VALUES ('2025-01');
        INSERT INTO audit(action,payload) VALUES ('test','original history');
        PRAGMA user_version=2;").unwrap();
}

#[test]
fn v2_upgrade_and_restore_preserve_setup_history_and_enable_two_legs() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("personal.sqlite");
    create_v2(&path);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let legacy = db.list_backups().unwrap().pop().unwrap();
    for restoring in [false, true] {
        if restoring {
            db.restore(&legacy).unwrap();
        }
        let s = db.snapshot("2025-01").unwrap();
        assert_eq!(
            (s.spent_cents, s.budget_cents, s.household_cents),
            (7000, 2500, 3000)
        );
        assert_eq!(s.entries[0].note, "Keep this note");
        assert_eq!(s.entries[0].revision, 3);
        assert_eq!(s.entries[0].destination_account_id, None);
        let category = s.categories.iter().find(|c| c.id == "groceries").unwrap();
        assert!(category.archived);
        assert_eq!(category.revision, 7);
        assert_eq!(category.icon, "groceries");
        assert_eq!(category.default_limit_cents, 8800);
        assert_eq!(activity(&db, "amex"), 10000);
        let payment = movement("card_payment", "100", "checking", "amex");
        db.save(payment.clone()).unwrap();
        assert_eq!(activity(&db, "amex"), 0);
        db.delete(&payment.id, 1).unwrap();
        assert_eq!(activity(&db, "checking"), 0);
    }
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
        conn.query_row(
            "SELECT COUNT(*) FROM audit WHERE payload='original history'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
}

#[test]
fn invalid_v2_upgrade_rolls_back_all_tables() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("personal.sqlite");
    create_v2(&path);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "PRAGMA foreign_keys=OFF; UPDATE account_activity SET account_id='missing';",
    )
    .unwrap();
    drop(conn);
    assert!(Store::open(dir.path(), "personal").is_err());
    let conn = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert!(conn
        .prepare("SELECT destination_account_id FROM events")
        .is_err());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}
