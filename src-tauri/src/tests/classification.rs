use super::*;
use crate::{
    db::{
        classification::{Policy, TypeCode},
        identity::CoverageInput,
    },
    imports::parse,
};
pub(super) fn policy(ownership: &str) -> Policy {
    Policy {
        ordinary_card_charges: true,
        ownership: ownership.into(),
        types: vec![
            TypeCode {
                account_id: None,
                code: "CASHBACK".into(),
                kind: "reward".into(),
            },
            TypeCode {
                account_id: None,
                code: "SALE".into(),
                kind: "expense".into(),
            },
        ],
    }
}
pub(super) fn stage(db: &mut Store, body: &str, account: &str) -> String {
    let bytes = format!("Date,Description,Amount,ID,Type,Status\n{body}").into_bytes();
    let prepared = parse::prepare("activity.csv", &bytes, None).unwrap();
    let id = db.ingest("activity.csv", bytes, prepared).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = false;
    m.status_column = Some(5);
    m.type_column = Some(4);
    m.stable_id_column = Some(3);
    m.stable_ids_confirmed = true;
    db.configure_import(&id, d.source.revision, account, m)
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    db.confirm_import_coverage(
        &id,
        d.source.revision,
        CoverageInput {
            start_date: "2026-10-01".into(),
            end_date: "2026-10-30".into(),
            date_basis: "transaction".into(),
            completeness: "complete".into(),
            profile: "Synthetic verified codes".into(),
            observed_at: "2026-10-30T23:00:00Z".into(),
            inclusive: true,
        },
    )
    .unwrap();
    id
}
pub(super) fn process(db: &mut Store, id: &str, p: Policy) -> String {
    let op = Uuid::new_v4().to_string();
    let revision = db.import_detail(id).unwrap().source.revision;
    db.process_import(id, revision, &op, p).unwrap();
    op
}
fn resolve(e: &crate::models::Entry, kind: &str) -> EntryInput {
    EntryInput {
        budget_override: None,
        id: e.id.clone(),
        revision: e.revision,
        kind: kind.into(),
        date: e.date.clone(),
        description: e.description.clone(),
        amount: format!("{}.{:02}", e.amount_cents / 100, e.amount_cents % 100),
        payer: "jacob".into(),
        category_id: Some("groceries".into()),
        account_id: e.account_id.clone(),
        destination_account_id: None,
        split_mode: "shared".into(),
        split_value: String::new(),
        note: String::new(),
        original_event_id: None,
        lines: Vec::new(),
        paypal: None,
    }
}
#[test]
fn first_card_import_without_rules_records_purchases_and_keeps_nonpurchase_credits_separate() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id=stage(&mut db,"2026-10-10,Market,100,A,,posted\n2026-10-11,Fee,5,B,SALE,posted\n2026-10-12,Reward,-10,C,CASHBACK,posted\n2026-10-13,Payment,-80,D,PAYMENT,posted\n2026-10-14,Advance,25,E,CASH_ADVANCE,posted\n2026-10-15,Pending coffee,9,F,,pending\n","amex");
    let rev = db.import_detail(&id).unwrap().source.revision;
    let op = process(&mut db, &id, policy("personal"));
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 10500);
    assert_eq!(s.card_reward_cents, 1000);
    assert_eq!(s.income_cents, 0);
    assert_eq!(s.unclassified_count, 2);
    assert_eq!(s.provisional_allowance_cents, 0);
    assert_eq!(s.household_cents, 0);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        4000
    );
    let d = db.import_detail(&id).unwrap();
    assert_eq!(d.source.classification_count, 2);
    assert_eq!(d.source.excluded_count, 1);
    assert_eq!(d.source.state, "review");
    assert!(d.coverage.unwrap().accepted);
    assert!(
        db.process_import(&id, rev, &op, policy("personal"))
            .unwrap()
            .already_processed
    );
    assert!(db.process_import(&id, rev, &op, policy("shared")).is_err());
    db.restore(&db.backup().unwrap()).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 10500);
    db.undo_import(&op).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.monthly_count, 0);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        0
    );
}
#[test]
fn unknown_sharing_uses_gross_provisional_then_resolves_once_without_moving_account_again() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = stage(&mut db, "2026-10-10,Market,100,A,,posted\n", "amex");
    let op = process(&mut db, &id, policy("ask"));
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 0);
    assert_eq!(s.provisional_allowance_cents, 10000);
    assert_eq!(s.remaining_cents, s.budget_cents - 10000);
    assert_eq!(s.household_cents, 0);
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "uncategorized")
            .unwrap()
            .provisional_cents,
        10000
    );
    let e = &s.entries[0];
    let mut input = resolve(e, "expense");
    let mut bad = input.clone();
    bad.amount = "200".into();
    assert!(db.save(bad).is_err());
    db.save(input.clone()).unwrap();
    db.save(input.clone()).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 7000);
    assert_eq!(s.household_cents, 3000);
    assert_eq!(s.provisional_allowance_cents, 0);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        10000
    );
    assert_eq!(db.import_detail(&id).unwrap().source.state, "complete");
    assert!(db.undo_import(&op).is_err());
    input.revision = 2;
    input.note = "Edited".into();
    db.save(input).unwrap();
    assert!(db.save(resolve(e, "expense")).is_err());
    db.restore(&db.backup().unwrap()).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().household_cents, 3000);
}
#[test]
fn checking_unknown_debit_and_credit_affect_account_only_and_refund_resolution_reverses_shares() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut purchase = expense("100", "jacob");
    purchase.date = "2026-10-01".into();
    purchase.account_id = Some("checking".into());
    db.save(purchase.clone()).unwrap();
    let id = stage(
        &mut db,
        "2026-10-10,Return,-30,A,,posted\n2026-10-11,Unknown debit,20,B,,posted\n",
        "checking",
    );
    process(&mut db, &id, policy("personal"));
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 7000);
    assert_eq!(s.provisional_allowance_cents, 0);
    assert_eq!(s.income_cents, 0);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        -9000
    );
    let e = s
        .entries
        .iter()
        .find(|e| e.description == "Return")
        .unwrap();
    let mut refund = resolve(e, "refund");
    refund.original_event_id = Some(purchase.id.clone());
    db.save(refund.clone()).unwrap();
    db.save(refund).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 4900);
    assert_eq!(s.household_cents, 2100);
    assert_eq!(s.unclassified_count, 1);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        -9000
    );
    db.restore(&db.backup().unwrap()).unwrap();
}
#[test]
fn overlap_with_unclassified_activity_reuses_identity_and_resolution_survives_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let first = stage(&mut db, "2026-10-10,Unknown,-20,A,CREDIT,posted\n", "amex");
    process(&mut db, &first, policy("personal"));
    let second = stage(
        &mut db,
        "2026-10-10,Unknown,-20,A,CREDIT,posted\n2026-10-20,Book,5,B,,posted\n",
        "amex",
    );
    process(&mut db, &second, policy("personal"));
    let d = db.import_detail(&second).unwrap();
    assert_eq!(d.source.linked_count, 1);
    assert!(d.rows[0].pending_entry.is_some());
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 2);
    let e = d.rows[0].pending_entry.as_ref().unwrap();
    db.save(resolve(e, "reward")).unwrap();
    assert!(db.import_detail(&first).unwrap().rows[0]
        .pending_entry
        .is_none());
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.card_reward_cents, 2000);
    assert_eq!(s.spent_cents, 500);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        -1500
    );
    db.restore(&db.backup().unwrap()).unwrap();
}
#[test]
fn source_codes_require_exact_match_and_conflicting_sign_never_becomes_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id=stage(&mut db,"2026-10-10,Payment-looking merchant,10,A,,posted\n2026-10-11,Lower case,20,B,sale,posted\n2026-10-12,Wrong sign,-30,C,SALE,posted\n","amex");
    process(&mut db, &id, policy("personal"));
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 1000);
    assert_eq!(s.unclassified_count, 2);
    assert_eq!(s.income_cents, 0);
}
#[test]
fn migration_preserves_existing_activity_and_rejects_tampered_pending_backup() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = expense("11", "jacob");
    db.save(e).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_classification_schema(&conn);
    conn.pragma_update(None, "user_version", 12).unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.snapshot(&month()).unwrap().spent_cents, 770);
    let id = stage(&mut db, "2026-10-10,Unknown,-20,A,CREDIT,posted\n", "amex");
    process(&mut db, &id, policy("personal"));
    let backup = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    conn.execute("UPDATE pending_activity SET direction='out'", [])
        .unwrap();
    drop(conn);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().unclassified_count, 1);
}

#[test]
fn merchant_sharing_override_and_ask_beat_source_defaults_without_forcing_a_category() {
    use crate::db::rules::Rule;
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    for (merchant, action, split) in [("Market", "set", "shared"), ("Mystery", "ask", "personal")] {
        db.save_rule(Rule {
            id: Uuid::new_v4().to_string(),
            revision: 0,
            name: merchant.into(),
            merchant: merchant.into(),
            match_mode: "exact".into(),
            account_id: Some("amex".into()),
            description_contains: String::new(),
            category_scope: "any".into(),
            category_action: "leave".into(),
            category_id: None,
            ownership_action: action.into(),
            split_mode: split.into(),
            split_value: String::new(),
            enabled: true,
        })
        .unwrap();
    }
    let id = stage(
        &mut db,
        "2026-10-10,Market,100,A,,posted\n2026-10-11,Mystery,50,B,,posted\n",
        "amex",
    );
    process(&mut db, &id, policy("personal"));
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 7000);
    assert_eq!(s.household_cents, 3000);
    assert_eq!(s.provisional_allowance_cents, 5000);
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "uncategorized")
            .unwrap()
            .spent_cents,
        7000
    );
}
#[test]
fn payment_resolution_preserves_source_leg_and_rejects_possible_recorded_counterpart() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = stage(
        &mut db,
        "2026-10-10,Card payment,-624,A,PAYMENT,posted\n",
        "amex",
    );
    process(&mut db, &id, policy("personal"));
    let e = db.snapshot("2026-10").unwrap().entries.remove(0);
    let mut payment = resolve(&e, "card_payment");
    payment.account_id = Some("checking".into());
    payment.destination_account_id = Some("amex".into());
    payment.split_mode = "none".into();
    payment.split_value.clear();
    payment.category_id = None;
    db.save(payment.clone()).unwrap();
    db.save(payment).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 0);
    assert_eq!(s.income_cents, 0);
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
    let id = stage(
        &mut db,
        "2026-10-20,Card payment,-50,B,PAYMENT,posted\n",
        "amex",
    );
    process(&mut db, &id, policy("personal"));
    let id2 = stage(
        &mut db,
        "2026-10-20,Payment,50,Z,PAYMENT,posted\n",
        "checking",
    );
    process(&mut db, &id2, policy("personal"));
    let e = db
        .snapshot("2026-10")
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.account_id.as_deref() == Some("amex") && e.kind == "unclassified")
        .unwrap();
    let mut payment = resolve(&e, "card_payment");
    payment.account_id = Some("checking".into());
    payment.destination_account_id = Some("amex".into());
    payment.category_id = None;
    payment.split_mode = "none".into();
    assert!(db
        .save(payment)
        .unwrap_err()
        .contains("other account already"));
    assert_eq!(db.snapshot("2026-10").unwrap().unclassified_count, 2);
}
#[test]
fn unverified_coverage_and_invalid_policy_cannot_post_any_activity() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let csv = "Date,Description,Amount\n2026-10-10,Market,100\n";
    let id = db
        .ingest(
            "new.csv",
            csv.as_bytes().to_vec(),
            parse::prepare("new.csv", csv.as_bytes(), None).unwrap(),
        )
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(&id, d.source.revision, "amex", m)
        .unwrap();
    let rev = db.import_detail(&id).unwrap().source.revision;
    assert!(db
        .process_import(&id, rev, &Uuid::new_v4().to_string(), policy("personal"))
        .err()
        .unwrap()
        .contains("range"));
    let mut p = policy("personal");
    p.types.push(p.types[0].clone());
    assert!(db
        .process_import(&id, rev, &Uuid::new_v4().to_string(), p)
        .is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
}
