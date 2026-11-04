use super::*;
use crate::{
    db::{
        balances::CheckpointInput, classification::Policy, identity::CoverageInput,
        movements::ReconcileInput,
    },
    imports::parse,
    models::Entry,
};
fn stage(db: &mut Store, account: &str, body: &str) -> (String, String) {
    let bytes = format!("Date,Description,Amount,ID,Posted\n{body}").into_bytes();
    let prepared = parse::prepare("movement.csv", &bytes, None).unwrap();
    let id = db.ingest("movement.csv", bytes, prepared).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    m.stable_id_column = Some(3);
    m.stable_ids_confirmed = true;
    m.posted_date_column = Some(4);
    db.configure_import(&id, d.source.revision, account, m)
        .unwrap();
    let rev = db.import_detail(&id).unwrap().source.revision;
    db.confirm_import_coverage(
        &id,
        rev,
        CoverageInput {
            start_date: "2026-10-01".into(),
            end_date: "2026-10-31".into(),
            date_basis: "transaction".into(),
            completeness: "complete".into(),
            profile: "Synthetic movement".into(),
            observed_at: "2026-11-01T18:00:00Z".into(),
            inclusive: true,
        },
    )
    .unwrap();
    let rev = db.import_detail(&id).unwrap().source.revision;
    let op = Uuid::new_v4().to_string();
    db.process_import(
        &id,
        rev,
        &op,
        Policy {
            ordinary_card_charges: false,
            ownership: "ask".into(),
            types: Vec::new(),
        },
    )
    .unwrap();
    (id, op)
}
fn entry(db: &Store, account: &str) -> Entry {
    db.snapshot("2026-10")
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.account_id.as_deref() == Some(account) && e.kind == "unclassified")
        .unwrap()
}
fn request(a: &Entry, b: &Entry) -> ReconcileInput {
    ReconcileInput {
        operation_id: Uuid::new_v4().to_string(),
        event_id: a.id.clone(),
        revision: a.revision,
        match_id: b.id.clone(),
        match_revision: b.revision,
        confirmed: true,
    }
}
fn activity(db: &Store, account: &str) -> i64 {
    db.snapshot("2026-10")
        .unwrap()
        .accounts
        .iter()
        .find(|a| a.id == account)
        .unwrap()
        .activity_cents
}
fn pair(db: &mut Store) -> ((String, String), (String, String), Entry, Entry) {
    let bank = stage(
        db,
        "checking",
        "2026-10-10,Card payment,624,BANK,2026-10-11\n",
    );
    let card = stage(
        db,
        "amex",
        "2026-10-12,Payment received,-624,CARD,2026-10-13\n",
    );
    let a = entry(db, "checking");
    let b = entry(db, "amex");
    (bank, card, a, b)
}
#[test]
fn two_imported_legs_become_one_payment_preserving_cash_card_dates_and_exact_undo() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let ((bank, bop), (card, cop), a, b) = pair(&mut db);
    let r = request(&a, &b);
    assert_eq!(db.movement_matches(&a.id).unwrap().len(), 1);
    assert_eq!(db.reconcile_movement(r.clone()).unwrap(), a.id);
    assert_eq!(db.reconcile_movement(r.clone()).unwrap(), a.id);
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.monthly_count, 1);
    assert_eq!(s.spent_cents, 0);
    assert_eq!(s.income_cents, 0);
    assert_eq!(s.household_cents, 0);
    assert_eq!(s.unclassified_count, 0);
    assert_eq!(activity(&db, "checking"), -62400);
    assert_eq!(activity(&db, "amex"), -62400);
    assert_eq!(s.entries[0].kind, "card_payment");
    assert_eq!(
        s.entries[0].movement_link.as_deref(),
        Some(r.operation_id.as_str())
    );
    let detail = db.movement_detail(&r.operation_id).unwrap();
    assert_eq!(
        detail
            .dates
            .iter()
            .find(|d| d.account_id == "checking")
            .unwrap()
            .date,
        "2026-10-11"
    );
    assert_eq!(
        detail
            .dates
            .iter()
            .find(|d| d.account_id == "amex")
            .unwrap()
            .date,
        "2026-10-13"
    );
    assert_eq!(
        db.import_detail(&bank).unwrap().rows[0].event_id,
        db.import_detail(&card).unwrap().rows[0].event_id
    );
    assert!(db.undo_import(&bop).is_err());
    assert!(db.undo_import(&cop).is_err());
    assert!(db.delete(&a.id, 2).is_err());
    db.restore(&db.backup().unwrap()).unwrap();
    db.undo_movement(&r.operation_id).unwrap();
    db.undo_movement(&r.operation_id).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.monthly_count, 2);
    assert_eq!(s.unclassified_count, 2);
    assert_eq!(activity(&db, "checking"), -62400);
    assert_eq!(activity(&db, "amex"), -62400);
    assert_eq!(entry(&db, "checking").revision, 3);
    assert_eq!(entry(&db, "amex").revision, 2);
    assert!(db.reconcile_movement(r).is_err());
    db.restore(&db.backup().unwrap()).unwrap();
    db.undo_import(&cop).unwrap();
    db.undo_import(&bop).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
}
#[test]
fn card_first_and_later_overlaps_preserve_identity_and_protect_reconciliation_undo() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (_, _, a, b) = pair(&mut db);
    let r = request(&b, &a);
    db.reconcile_movement(r.clone()).unwrap();
    assert_eq!(activity(&db, "checking"), -62400);
    let (source,op)=stage(&mut db,"amex","2026-10-12,Payment received,-624,CARD,2026-10-13\n2026-10-20,Other credit,-5,OTHER,2026-10-20\n");
    assert_eq!(db.import_detail(&source).unwrap().source.linked_count, 1);
    assert!(db
        .undo_movement(&r.operation_id)
        .unwrap_err()
        .contains("Later imports"));
    db.undo_import(&op).unwrap();
    db.undo_movement(&r.operation_id).unwrap();
    let a = entry(&db, "checking");
    let b = entry(&db, "amex");
    db.reconcile_movement(request(&a, &b)).unwrap();
    db.restore(&db.backup().unwrap()).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 1);
}
#[test]
fn linking_to_an_existing_payment_removes_only_the_duplicate_account_effect_and_restores_on_undo() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (_, op) = stage(
        &mut db,
        "amex",
        "2026-10-12,Payment received,-624,CARD,2026-10-13\n",
    );
    let a = entry(&db, "amex");
    let mut payment = expense("624", "jacob");
    payment.kind = "card_payment".into();
    payment.date = "2026-10-10".into();
    payment.account_id = Some("checking".into());
    payment.destination_account_id = Some("amex".into());
    payment.category_id = None;
    payment.split_mode = "none".into();
    db.save(payment.clone()).unwrap();
    let b = db
        .snapshot("2026-10")
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.id == payment.id)
        .unwrap();
    assert_eq!(activity(&db, "amex"), -124800);
    let r = request(&a, &b);
    db.reconcile_movement(r.clone()).unwrap();
    assert_eq!(activity(&db, "amex"), -62400);
    assert_eq!(activity(&db, "checking"), -62400);
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 1);
    db.restore(&db.backup().unwrap()).unwrap();
    db.undo_movement(&r.operation_id).unwrap();
    assert_eq!(activity(&db, "amex"), -124800);
    assert_eq!(entry(&db, "amex").revision, 2);
    assert!(db
        .snapshot("2026-10")
        .unwrap()
        .entries
        .iter()
        .any(|e| e.id == payment.id && e.revision == 3));
    db.undo_import(&op).unwrap();
    assert_eq!(activity(&db, "amex"), -62400);
}
#[test]
fn balance_checkpoints_use_each_accounts_posting_date_after_reconciliation() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (_, _, a, b) = pair(&mut db);
    db.reconcile_movement(request(&a, &b)).unwrap();
    for account in ["checking", "amex"] {
        db.save_checkpoint(CheckpointInput {
            id: Uuid::new_v4().to_string(),
            revision: 0,
            account_id: account.into(),
            date: "2026-10-12".into(),
            amount: "1000".into(),
            purpose: "confirmed".into(),
            note: String::new(),
        })
        .unwrap();
    }
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .balance
            .as_ref()
            .unwrap()
            .estimated_cents,
        100000
    );
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .balance
            .as_ref()
            .unwrap()
            .estimated_cents,
        37600
    );
}
#[test]
fn invalid_pairs_stale_revisions_and_missing_confirmation_leave_both_legs_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (_, _, a, b) = pair(&mut db);
    let mut r = request(&a, &b);
    r.confirmed = false;
    assert!(db.reconcile_movement(r).is_err());
    let mut r = request(&a, &b);
    r.match_revision = 9;
    assert!(db.reconcile_movement(r).is_err());
    assert!(db.reconcile_movement(request(&a, &a)).is_err());
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.unclassified_count, 2);
    assert_eq!(s.monthly_count, 2);
    assert_eq!(activity(&db, "checking"), -62400);
}
#[test]
fn schema_thirteen_upgrade_preserves_pending_records_and_corrupt_reconciliation_restore_is_rejected(
) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (_, _, a, b) = pair(&mut db);
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_movement_schema(&conn);
    conn.pragma_update(None, "user_version", 13).unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().unclassified_count, 2);
    let r = request(&a, &b);
    db.reconcile_movement(r).unwrap();
    let backup = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    conn.execute("UPDATE movement_reconciliations SET snapshot_json=replace(snapshot_json,'624.00','624.01')",[]).unwrap();
    drop(conn);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 1);
}

#[test]
fn coalesced_same_account_aliases_restore_exactly_when_unlinking_an_existing_payment() {
    use crate::imports::types::Decision;
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (a_source, _) = stage(
        &mut db,
        "amex",
        "2026-10-12,Payment received,-624,CARD,2026-10-13\n",
    );
    let a = entry(&db, "amex");
    let mut payment = expense("624", "jacob");
    payment.kind = "card_payment".into();
    payment.date = "2026-10-10".into();
    payment.account_id = Some("checking".into());
    payment.destination_account_id = Some("amex".into());
    payment.category_id = None;
    payment.split_mode = "none".into();
    db.save(payment.clone()).unwrap();
    let (b_source, _) = stage(
        &mut db,
        "amex",
        "2026-10-12,Other payment description,-624,OTHER-ID,2026-10-13\n",
    );
    let d = db.import_detail(&b_source).unwrap();
    let b = db
        .snapshot("2026-10")
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.id == payment.id)
        .unwrap();
    db.commit_import(
        &b_source,
        d.source.revision,
        &Uuid::new_v4().to_string(),
        vec![Decision {
            row_id: d.rows[0].id.clone(),
            action: "link".into(),
            input: None,
            match_id: Some(b.id.clone()),
            match_revision: Some(b.revision),
            confirmed: true,
            separate: false,
            rule_signature: None,
        }],
    )
    .unwrap();
    let r = request(&a, &b);
    db.reconcile_movement(r.clone()).unwrap();
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(DISTINCT occurrence_id) FROM import_stable_ids WHERE account_id='amex'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    drop(conn);
    db.restore(&db.backup().unwrap()).unwrap();
    db.undo_movement(&r.operation_id).unwrap();
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(DISTINCT occurrence_id) FROM import_stable_ids WHERE account_id='amex'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
    assert_eq!(
        db.import_detail(&a_source).unwrap().rows[0]
            .event_id
            .as_deref(),
        Some(a.id.as_str())
    );
    assert_eq!(
        db.import_detail(&b_source).unwrap().rows[0]
            .event_id
            .as_deref(),
        Some(b.id.as_str())
    );
    drop(conn);
    db.restore(&db.backup().unwrap()).unwrap();
}
#[test]
fn bank_transfer_reconciliation_is_not_income_and_credit_card_outflows_are_not_transfer_sources() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let savings = Uuid::new_v4().to_string();
    db.save_account(AccountInput {
        id: savings.clone(),
        revision: 0,
        name: "Gift savings".into(),
        kind: "savings".into(),
        archived: false,
        tracking_mode: "imported".into(),
    })
    .unwrap();
    stage(
        &mut db,
        "checking",
        "2026-10-10,Savings transfer,50,BANK,2026-10-10\n",
    );
    stage(
        &mut db,
        &savings,
        "2026-10-11,Transfer received,-50,SAVE,2026-10-11\n",
    );
    let a = entry(&db, "checking");
    let b = entry(&db, &savings);
    db.reconcile_movement(request(&a, &b)).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.entries[0].kind, "transfer");
    assert_eq!(s.income_cents, 0);
    assert_eq!(s.spent_cents, 0);
    assert_eq!(activity(&db, &savings), 5000);
    stage(
        &mut db,
        "amex",
        "2026-10-20,Cash advance,25,ADV,2026-10-20\n",
    );
    stage(
        &mut db,
        "checking",
        "2026-10-20,Deposit,-25,DEP,2026-10-20\n",
    );
    let a = entry(&db, "amex");
    let b = entry(&db, "checking");
    assert!(db.movement_matches(&a.id).unwrap().is_empty());
    assert!(db.reconcile_movement(request(&a, &b)).is_err());
}
#[test]
fn editing_spending_date_keeps_explicit_source_posting_date_for_account_balance() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    stage(&mut db, "amex", "2026-10-10,Market,20,A,2026-10-13\n");
    let e = entry(&db, "amex");
    let mut expense = expense("20", "jacob");
    expense.id = e.id.clone();
    expense.revision = e.revision;
    expense.date = e.date.clone();
    db.save(expense.clone()).unwrap();
    expense.revision += 1;
    expense.date = "2026-09-30".into();
    db.save(expense).unwrap();
    let e = &db.snapshot("2026-09").unwrap().entries[0];
    assert_eq!(e.activity_dates[0].date, "2026-10-13");
    assert_eq!(e.date, "2026-09-30");
}
