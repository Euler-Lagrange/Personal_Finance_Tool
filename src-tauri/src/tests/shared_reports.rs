use super::*;
use crate::db::{
    bills::{Details, Draft, LinkInput},
    household::OpeningInput,
};
use crate::models::{PayPalInput, ReceiptInput};

fn buy(db: &mut Store, amount: &str, payer: &str, date: &str) -> EntryInput {
    let mut e = expense(amount, payer);
    e.date = date.into();
    db.save(e.clone()).unwrap();
    e
}
fn opening(db: &mut Store, amount: &str) {
    db.save_household_opening(OpeningInput {
        revision: 0,
        date: "2026-09-30".into(),
        amount: amount.into(),
        note: "Private opening note".into(),
        reconciled: true,
    })
    .unwrap();
}
fn link(db: &mut Store, e: &EntryInput, amount: &str) {
    let id = Uuid::new_v4().to_string();
    db.save_bill_template(
        &id,
        0,
        "2026-10-01",
        1,
        None,
        false,
        Draft {
            amount: amount.into(),
            lines: vec![],
            details: Details {
                name: id.clone(),
                merchant: "Utility".into(),
                category_id: "groceries".into(),
                account_id: e.account_id.clone(),
                payer: e.payer.clone(),
                split_mode: "shared".into(),
                split_value: String::new(),
                autopay: false,
                payment_kind: "expense".into(),
            },
        },
    )
    .unwrap();
    let bill = db
        .bill_month("2026-10")
        .unwrap()
        .into_iter()
        .find(|b| b.bill_id == id)
        .unwrap();
    db.link_bill_payment(LinkInput {
        id: Uuid::new_v4().to_string(),
        occurrence_id: bill.id,
        revision: bill.revision,
        event_id: e.id.clone(),
        event_revision: 1,
        amount: amount.into(),
    })
    .unwrap();
}
fn refund(db: &mut Store, e: &EntryInput, amount: &str) -> EntryInput {
    let mut r = expense(amount, &e.payer);
    r.kind = "refund".into();
    r.date = "2026-11-01".into();
    r.original_event_id = Some(e.id.clone());
    db.save(r.clone()).unwrap();
    r
}
#[test]
fn statement_reconciles_one_net_balance_across_months_and_empty_periods() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    opening(&mut db, "100");
    buy(&mut db, "126.69", "jacob", "2026-10-02");
    buy(&mut db, "48", "chelsea", "2026-10-03");
    let mut s = repayment("100", "chelsea", false);
    s.date = "2026-10-04".into();
    db.save(s).unwrap();
    let r = db.shared_statement(Some("2026-10")).unwrap();
    assert_eq!(
        (
            r.opening_cents,
            r.everyday_cents,
            r.repayment_cents,
            r.closing_cents
        ),
        (10000, 441, -10000, 441)
    );
    assert_eq!(
        r.rows.iter().map(|r| r.balance_cents).collect::<Vec<_>>(),
        vec![13801, 10441, 441]
    );
    assert_eq!(
        r.closing_cents,
        db.snapshot("2026-10").unwrap().household_cents
    );
    assert_eq!(
        db.shared_statement(Some("2026-08")).unwrap().closing_cents,
        0
    );
    assert_eq!(
        db.shared_statement(Some("2026-12")).unwrap().opening_cents,
        441
    );
    let all = db.shared_statement(None).unwrap();
    assert_eq!(all.opening_adjustment_cents, 10000);
    assert_eq!(all.closing_cents, 441);
    assert_eq!(all.rows.len(), 4);
}
#[test]
fn bill_groups_do_not_apportion_partial_links_or_double_count_combined_links() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = buy(&mut db, "100", "jacob", "2026-10-02");
    link(&mut db, &e, "40");
    let r = db.shared_statement(None).unwrap();
    assert_eq!(r.unassigned_cents, 3000);
    assert_eq!(r.rows[0].group, "unassigned");
    link(&mut db, &e, "60");
    let r = db.shared_statement(None).unwrap();
    assert_eq!(r.bills_cents, 3000);
    assert_eq!(r.rows.len(), 1);
    assert_eq!(r.rows[0].full_cents, 10000);
    refund(&mut db, &e, "50");
    let r = db.shared_statement(Some("2026-11")).unwrap();
    assert_eq!(
        (r.opening_cents, r.bills_cents, r.closing_cents),
        (3000, -1500, 1500)
    );
    assert_eq!(r.rows[0].full_cents, -5000);
}
#[test]
fn explicit_groups_and_tagged_settlements_never_change_money_or_create_group_debts() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = buy(&mut db, "100", "jacob", "2026-10-02");
    db.set_household_group(&e.id, 1, Some("bills")).unwrap();
    let mut s = repayment("30", "chelsea", true);
    s.date = "2026-10-03".into();
    db.save(s.clone()).unwrap();
    db.set_household_group(&s.id, 1, Some("bills")).unwrap();
    let r = db.shared_statement(None).unwrap();
    assert_eq!(
        (r.bills_cents, r.repayment_cents, r.closing_cents),
        (3000, -3000, 0)
    );
    assert!(r.rows.iter().all(|r| r.group == "bills"));
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 7000);
    assert!(db.set_household_group(&e.id, 1, Some("everyday")).is_err());
    assert!(db.set_household_group(&e.id, 2, Some("other")).is_err());
    db.set_household_group(&e.id, 2, None).unwrap();
    assert_eq!(db.shared_statement(None).unwrap().everyday_cents, 3000);
}
#[test]
fn refunds_inherit_overrides_and_preserve_reversed_balance_after_settlement() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = buy(&mut db, "100", "jacob", "2026-10-02");
    db.set_household_group(&e.id, 1, Some("bills")).unwrap();
    let mut s = repayment("30", "chelsea", false);
    s.date = "2026-10-03".into();
    db.save(s).unwrap();
    let r = refund(&mut db, &e, "100");
    let report = db.shared_statement(Some("2026-11")).unwrap();
    assert_eq!((report.bills_cents, report.closing_cents), (-3000, -3000));
    db.set_household_group(&r.id, 1, Some("everyday")).unwrap();
    assert_eq!(
        db.shared_statement(Some("2026-11")).unwrap().everyday_cents,
        -3000
    );
    db.set_household_group(&r.id, 2, None).unwrap();
    assert_eq!(
        db.shared_statement(Some("2026-11")).unwrap().bills_cents,
        -3000
    );
}
#[test]
fn paypal_cashout_is_not_another_repayment_and_private_activity_stays_out() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    opening(&mut db, "100");
    let mut receipt = repayment("100", "chelsea", false);
    receipt.date = "2026-10-01".into();
    db.save(receipt.clone()).unwrap();
    let mut deposit = expense("99", "jacob");
    deposit.date = "2026-10-02".into();
    deposit.kind = "paypal_cashout".into();
    deposit.category_id = None;
    deposit.account_id = Some("checking".into());
    deposit.split_mode = "none".into();
    deposit.paypal = Some(PayPalInput {
        receipts: vec![ReceiptInput {
            id: receipt.id,
            revision: 1,
            amount: "100".into(),
        }],
        fee: "1".into(),
        fee_category_id: Some("groceries".into()),
        other: "0".into(),
        other_note: String::new(),
    });
    db.save(deposit).unwrap();
    let mut personal = expense("999", "jacob");
    personal.split_mode = "personal".into();
    personal.description = "Secret personal purchase".into();
    db.save(personal.clone()).unwrap();
    assert!(db
        .set_household_group(&personal.id, 1, Some("bills"))
        .is_err());
    let report = db.shared_statement(None).unwrap();
    assert_eq!(report.rows.len(), 2);
    assert_eq!(report.closing_cents, 0);
    assert!(!report.render("html").unwrap().contains("Secret"));
}
#[test]
fn exports_escape_markup_and_spreadsheet_formulas_and_omit_private_notes() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    opening(&mut db, "-0.01");
    let mut e = expense("0.01", "jacob");
    e.date = "2026-10-02".into();
    e.description = "=HYPERLINK(\"x\") <script>alert(1)</script>".into();
    e.note = "PRIVATE-NOTE".into();
    db.save(e).unwrap();
    let r = db.shared_statement(None).unwrap();
    let html = r.render("html").unwrap();
    if let Ok(directory) = std::env::var("FINANCE_QA_EXPORT_DIR") {
        std::fs::write(
            std::path::Path::new(&directory).join("shared-statement.html"),
            &html,
        )
        .unwrap();
    }
    assert!(!html.contains("<script>"));
    assert!(html.contains("&lt;script&gt;"));
    assert!(html.contains("$-0.01"));
    assert!(!html.contains("PRIVATE-NOTE"));
    assert!(!html.contains("amex"));
    let csv = r.render("csv").unwrap();
    assert!(csv.contains("'=HYPERLINK"));
    assert!(!csv.contains("PRIVATE-NOTE"));
    assert!(!csv.contains("Private opening note"));
    let export = dir.path().join("exports");
    let a = r.export(&export, "html").unwrap();
    let b = r.export(&export, "html").unwrap();
    assert_ne!(a, b);
    assert_eq!(std::fs::read_to_string(a).unwrap(), html);
    assert!(r.export(&export, "../bad").is_err());
    assert_eq!(std::fs::read_dir(export).unwrap().count(), 2);
}
#[test]
fn schema19_upgrade_restore_and_isolation_preserve_reporting_groups() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = buy(&mut db, "100", "jacob", "2026-10-02");
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_shared_report_schema(&c);
    c.pragma_update(None, "user_version", 19).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.shared_statement(None).unwrap().everyday_cents, 3000);
    db.set_household_group(&e.id, 1, Some("bills")).unwrap();
    let backup = db.backup().unwrap();
    db.set_household_group(&e.id, 2, None).unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(db.shared_statement(None).unwrap().bills_cents, 3000);
    let demo = Store::open(dir.path(), "demo").unwrap();
    assert!(!demo
        .shared_statement(None)
        .unwrap()
        .rows
        .iter()
        .any(|r| r.entry.as_ref().is_some_and(|x| x.id == e.id)));
    assert!(db.shared_statement(Some("2026-99")).is_err());
}

#[test]
fn failed_group_audit_rolls_back_tag_and_revision_then_retry_updates_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = buy(&mut db, "100", "jacob", "2026-10-02");
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute_batch("CREATE TRIGGER reject_group BEFORE INSERT ON audit WHEN NEW.action='household_group' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    assert!(db.set_household_group(&e.id, 1, Some("bills")).is_err());
    let r = db.shared_statement(None).unwrap();
    assert_eq!(r.rows[0].group, "everyday");
    assert_eq!(r.rows[0].entry.as_ref().unwrap().revision, 1);
    c.execute_batch("DROP TRIGGER reject_group;").unwrap();
    db.set_household_group(&e.id, 1, Some("bills")).unwrap();
    assert!(db.set_household_group(&e.id, 1, Some("bills")).is_err());
    assert_eq!(db.shared_statement(None).unwrap().closing_cents, 3000);
}

#[test]
fn corrupt_reporting_group_cannot_replace_live_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = buy(&mut db, "100", "jacob", "2026-10-02");
    db.set_household_group(&e.id, 1, Some("bills")).unwrap();
    let backup = db.backup().unwrap();
    let path = dir.path().join("backups").join("personal").join(&backup);
    let c = rusqlite::Connection::open(path).unwrap();
    c.execute_batch(
        "PRAGMA ignore_check_constraints=ON; UPDATE household_groups SET group_name='other';",
    )
    .unwrap();
    drop(c);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.shared_statement(None).unwrap().bills_cents, 3000);
}
