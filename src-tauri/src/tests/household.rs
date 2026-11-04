use super::*;
use crate::{
    db::household::OpeningInput,
    models::{PayPalInput, ReceiptInput},
};
fn opening(amount: &str) -> OpeningInput {
    OpeningInput {
        revision: 0,
        date: "2026-10-31".into(),
        amount: amount.into(),
        note: "Reconciled opening, no overlapping bills".into(),
        reconciled: true,
    }
}
fn receipt(db: &mut Store, amount: &str) -> EntryInput {
    let mut e = repayment(amount, "chelsea", false);
    e.date = "2026-11-01".into();
    db.save(e.clone()).unwrap();
    e
}
fn cashout(amount: &str, parts: &[(&EntryInput, &str)]) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.kind = "paypal_cashout".into();
    e.date = "2026-11-02".into();
    e.description = "PayPal cash-out".into();
    e.account_id = Some("checking".into());
    e.category_id = None;
    e.split_mode = "none".into();
    e.paypal = Some(PayPalInput {
        receipts: parts
            .iter()
            .map(|(e, a)| ReceiptInput {
                id: e.id.clone(),
                revision: 1,
                amount: (*a).into(),
            })
            .collect(),
        fee: "0".into(),
        fee_category_id: None,
        other: "0".into(),
        other_note: String::new(),
    });
    e
}
fn activity(db: &Store, account: &str) -> i64 {
    db.snapshot("2026-11")
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.id == account)
        .unwrap()
        .activity_cents
}
#[test]
fn reconciled_opening_supports_both_directions_without_monthly_spending_or_income() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_household_opening(opening("100")).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (s.household_cents, s.spent_cents, s.income_cents),
        (10000, 0, 0)
    );
    assert!(s.entries.is_empty());
    receipt(&mut db, "100");
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, 0);
    assert_eq!(activity(&db, "checking"), 0);
    let mut o = opening("-50");
    o.revision = 1;
    db.save_household_opening(o).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, -15000);
    let mut e = repayment("150", "jacob", true);
    e.date = "2026-11-02".into();
    db.save(e).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, 0);
    assert_eq!(activity(&db, "checking"), -15000);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(db.household_opening().unwrap().unwrap().amount_cents, -5000);
}
#[test]
fn opening_date_overlap_stale_revisions_and_unconfirmed_inputs_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut o = opening("100");
    o.reconciled = false;
    assert!(db.save_household_opening(o).is_err());
    db.save_household_opening(opening("100")).unwrap();
    assert!(db.save_household_opening(opening("200")).is_err());
    let mut e = expense("100", "jacob");
    e.date = "2026-10-31".into();
    assert!(db.save(e.clone()).is_err());
    e.date = "2026-11-01".into();
    db.save(e).unwrap();
    let mut o = opening("100");
    o.revision = 1;
    o.date = "2026-11-01".into();
    assert!(db.save_household_opening(o).is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, 13000);
}
#[test]
fn partial_and_combined_paypal_cashouts_move_bank_cash_once_without_resettling_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_household_opening(opening("100")).unwrap();
    let a = receipt(&mut db, "60");
    let b = receipt(&mut db, "40");
    let x = cashout("30", &[(&a, "30")]);
    db.save(x.clone()).unwrap();
    let y = cashout("70", &[(&a, "30"), (&b, "40")]);
    db.save(y.clone()).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (s.household_cents, s.spent_cents, s.income_cents),
        (0, 0, 0)
    );
    assert_eq!(activity(&db, "checking"), 10000);
    assert!(db
        .paypal_receipts(None)
        .unwrap()
        .iter()
        .all(|r| r.available_cents == 0));
    assert_eq!(
        db.paypal_receipts(Some(&x.id))
            .unwrap()
            .iter()
            .find(|r| r.id == a.id)
            .unwrap()
            .available_cents,
        3000
    );
    assert!(db.save(cashout("1", &[(&a, "1")])).is_err());
    assert!(db.delete(&a.id, 1).is_err());
    let mut edited = a.clone();
    edited.revision = 1;
    edited.account_id = Some("checking".into());
    assert!(db.save(edited).is_err());
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    db.delete(&x.id, 1).unwrap();
    assert_eq!(activity(&db, "checking"), 7000);
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, 0);
}
#[test]
fn cashout_fees_and_other_existing_funds_have_an_explicit_reconciled_breakdown() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_household_opening(opening("100")).unwrap();
    let r = receipt(&mut db, "100");
    let mut x = cashout("119", &[(&r, "100")]);
    let p = x.paypal.as_mut().unwrap();
    p.other = "20".into();
    p.other_note = "Already held personal funds, not new income".into();
    p.fee = "1".into();
    p.fee_category_id = Some("home".into());
    db.save(x.clone()).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (
            s.spent_cents,
            s.consumption_cents,
            s.income_cents,
            s.household_cents
        ),
        (100, 100, 0, 0)
    );
    assert_eq!(activity(&db, "checking"), 11900);
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "home")
            .unwrap()
            .spent_cents,
        100
    );
    assert_eq!(db.paypal_receipts(None).unwrap()[0].available_cents, 0);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    x.revision = 1;
    x.amount = "120".into();
    x.paypal.as_mut().unwrap().fee = "0".into();
    x.paypal.as_mut().unwrap().fee_category_id = None;
    db.save(x.clone()).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 0);
    assert_eq!(activity(&db, "checking"), 12000);
    db.delete(&x.id, 2).unwrap();
    assert_eq!(activity(&db, "checking"), 0);
    assert_eq!(db.paypal_receipts(None).unwrap()[0].available_cents, 10000);
}
#[test]
fn invalid_cashout_breakdowns_dates_accounts_and_stale_receipts_are_atomic() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_household_opening(opening("100")).unwrap();
    let r = receipt(&mut db, "100");
    for case in 0..9 {
        let mut x = cashout("100", &[(&r, "100")]);
        match case {
            0 => x.amount = "99".into(),
            1 => x.date = "2026-10-31".into(),
            2 => x.account_id = Some("amex".into()),
            3 => x.paypal.as_mut().unwrap().receipts[0].revision = 5,
            4 => x.paypal.as_mut().unwrap().receipts[0].amount = "101".into(),
            5 => {
                let a = x.paypal.as_ref().unwrap().receipts[0].clone();
                x.paypal.as_mut().unwrap().receipts.push(a);
            }
            6 => {
                x.paypal.as_mut().unwrap().other = "20".into();
                x.amount = "120".into();
            }
            7 => x.date = "2099-01-01".into(),
            _ => {
                x.paypal.as_mut().unwrap().fee = "1".into();
                x.amount = "99".into();
            }
        };
        assert!(db.save(x).is_err(), "case {case}");
    }
    assert_eq!(activity(&db, "checking"), 0);
    assert_eq!(db.paypal_receipts(None).unwrap()[0].available_cents, 10000);
    assert_eq!(db.snapshot("2026-11").unwrap().entries.len(), 1);
}

#[test]
fn imported_cashout_links_existing_deposit_and_narrow_undo_preserves_receipt() {
    use crate::imports::{parse, types::Decision};
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_household_opening(opening("100")).unwrap();
    let r = receipt(&mut db, "100");
    let csv = b"Date,Description,Amount\n2026-11-02,PayPal cashout,60\n";
    let id = db
        .ingest(
            "checking.csv",
            csv.to_vec(),
            parse::prepare("checking.csv", csv, None).unwrap(),
        )
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "inflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(&id, d.source.revision, "checking", m)
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut x = cashout("60", &[(&r, "60")]);
    x.id = d.rows[0].id.clone();
    let decision = Decision {
        row_id: x.id.clone(),
        action: "add".into(),
        input: Some(x.clone()),
        match_id: None,
        match_revision: None,
        confirmed: true,
        separate: false,
        rule_signature: None,
    };
    let op = Uuid::new_v4().to_string();
    db.commit_import(&id, d.source.revision, &op, vec![decision])
        .unwrap();
    assert_eq!(activity(&db, "checking"), 6000);
    assert_eq!(db.paypal_receipts(None).unwrap()[0].available_cents, 4000);
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, 0);
    let csv = b"Date,Description,Amount\n2026-11-03,PayPal deposit,60\n";
    let id2 = db
        .ingest(
            "overlap.csv",
            csv.to_vec(),
            parse::prepare("overlap.csv", csv, None).unwrap(),
        )
        .unwrap();
    let d2 = db.import_detail(&id2).unwrap();
    let mut m = d2.mapping;
    m.amount_mode = "inflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(&id2, d2.source.revision, "checking", m)
        .unwrap();
    let d2 = db.import_detail(&id2).unwrap();
    assert_eq!(d2.rows[0].matches[0].kind, "paypal_cashout");
    let op2 = Uuid::new_v4().to_string();
    db.commit_import(
        &id2,
        d2.source.revision,
        &op2,
        vec![Decision {
            row_id: d2.rows[0].id.clone(),
            action: "link".into(),
            input: None,
            match_id: Some(x.id.clone()),
            match_revision: Some(1),
            confirmed: true,
            separate: false,
            rule_signature: None,
        }],
    )
    .unwrap();
    assert!(db.undo_import(&op).is_err());
    db.undo_import(&op2).unwrap();
    db.undo_import(&op).unwrap();
    assert_eq!(activity(&db, "checking"), 0);
    assert_eq!(db.paypal_receipts(None).unwrap()[0].available_cents, 10000);
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, 0);
}
#[test]
fn corrupt_paypal_allocations_or_opening_history_cannot_replace_active_records() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_household_opening(opening("100")).unwrap();
    let r = receipt(&mut db, "100");
    db.save(cashout("50", &[(&r, "50")])).unwrap();
    for sql in ["UPDATE paypal_allocations SET amount_cents=6000","UPDATE household_opening SET date='2026-11-01'","UPDATE account_activity SET change_cents=5100 WHERE event_id IN (SELECT event_id FROM paypal_cashouts)","DELETE FROM paypal_cashouts"] {
 let backup=db.backup().unwrap();let c=rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();c.execute_batch(sql).unwrap();drop(c);assert!(db.restore(&backup).is_err(),"{sql}");assert_eq!(activity(&db,"checking"),5000);assert_eq!(db.paypal_receipts(None).unwrap()[0].available_cents,5000);
 }
}
#[test]
fn schema_nine_upgrade_keeps_legacy_direct_bank_and_held_receipts_without_inventing_cashouts() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("1000", "jacob");
    e.date = "2026-11-01".into();
    db.save(e).unwrap();
    let r = receipt(&mut db, "100");
    let mut direct = repayment("50", "chelsea", true);
    direct.date = "2026-11-01".into();
    db.save(direct).unwrap();
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_identity_schema(&c);
    c.execute_batch("PRAGMA foreign_keys=OFF;DROP TABLE paypal_allocations;DROP TABLE paypal_cashouts;DROP TABLE household_opening;").unwrap();
    c.execute_batch(include_str!("../migrations/009_rewards_debt.sql"))
        .unwrap();
    c.execute_batch("PRAGMA user_version=9;").unwrap();
    c.backup(
        "main",
        dir.path().join("backups/personal/legacy-v9.sqlite"),
        None,
    )
    .unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (
            s.entries.len(),
            s.household_cents,
            s.income_cents,
            s.spent_cents
        ),
        (3, 15000, 0, 70000)
    );
    assert!(db.household_opening().unwrap().is_none());
    assert_eq!(activity(&db, "checking"), 5000);
    assert_eq!(db.paypal_receipts(None).unwrap().len(), 1);
    assert_eq!(db.paypal_receipts(None).unwrap()[0].available_cents, 10000);
    db.save(cashout("40", &[(&r, "40")])).unwrap();
    assert_eq!(activity(&db, "checking"), 9000);
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, 15000);
    db.restore("legacy-v9.sqlite").unwrap();
    assert_eq!(activity(&db, "checking"), 5000);
    assert_eq!(db.paypal_receipts(None).unwrap()[0].available_cents, 10000);
}
