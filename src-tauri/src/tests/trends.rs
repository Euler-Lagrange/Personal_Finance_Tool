use super::*;
use crate::{
    db::budget_periods::Choice,
    models::{LineInput, PayPalInput},
};
fn buy(db: &mut Store, date: &str, name: &str, amount: &str, payer: &str) -> EntryInput {
    let mut e = expense(amount, payer);
    e.date = date.into();
    e.description = name.into();
    db.save(e.clone()).unwrap();
    e.revision = 1;
    e
}
fn close(db: &mut Store, month: &str) {
    let r = db.close_review(month).unwrap();
    assert!(r.blockers.is_empty());
    db.close_month(crate::db::periods::CloseInput {
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
fn reconciles(db: &Store) {
    let report = db.trends_report(2026).unwrap();
    let annual = db.annual_report(2026).unwrap();
    for (i, m) in report.months.iter().enumerate() {
        assert_eq!(
            m.spent_cents,
            annual.months[i].totals.as_ref().map(|t| t.spent_cents)
        );
        if let Some(n) = m.spent_cents {
            assert_eq!(
                report
                    .categories
                    .iter()
                    .map(|s| s.months[i].unwrap())
                    .sum::<i64>(),
                n
            );
            assert_eq!(
                report
                    .merchants
                    .iter()
                    .map(|s| s.months[i].unwrap())
                    .sum::<i64>(),
                n
            );
            assert_eq!(
                report
                    .entries
                    .iter()
                    .filter(|e| e.month == m.month)
                    .map(|e| e.amount_cents)
                    .sum::<i64>(),
                n
            );
        }
    }
}
#[test]
fn sharing_itemized_refunds_and_nonspending_reconcile_without_duplicates() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = buy(&mut db, "2026-09-10", "Market #1", "100", "jacob");
    buy(&mut db, "2026-09-11", " MARKET  1 ", "50", "chelsea");
    buy(&mut db, "2026-09-12", "Market #2", "20", "jacob");
    let mut r = expense("100", "jacob");
    r.kind = "refund".into();
    r.original_event_id = Some(e.id);
    r.date = "2026-10-02".into();
    r.description = "Unrelated refund descriptor".into();
    r.category_id = None;
    r.split_mode = "none".into();
    db.save(r).unwrap();
    let mut item = expense("30", "jacob");
    item.date = "2026-10-04".into();
    item.description = "Department store".into();
    item.lines = vec![
        ("food", "10", "groceries", "personal"),
        ("gift", "20", "gifts", "equal"),
    ]
    .into_iter()
    .map(|(id, amount, category, split)| LineInput {
        id: id.into(),
        label: id.into(),
        amount: amount.into(),
        category_id: category.into(),
        split_mode: split.into(),
        split_value: String::new(),
        original_line_id: None,
    })
    .collect();
    db.save(item).unwrap();
    for kind in ["card_payment", "income", "reward", "settlement"] {
        let mut x = expense("624", "jacob");
        x.date = "2026-10-05".into();
        x.kind = kind.into();
        if kind == "settlement" {
            x.amount = "5".into();
        }
        x.category_id = None;
        x.split_mode = "none".into();
        x.account_id = Some("checking".into());
        if kind == "card_payment" {
            x.destination_account_id = Some("amex".into());
        }
        db.save(x).unwrap();
    }
    close(&mut db, "2026-08");
    close(&mut db, "2026-09");
    close(&mut db, "2026-10");
    reconciles(&db);
    let report = db.trends_report(2026).unwrap();
    let market = report
        .merchants
        .iter()
        .find(|s| s.id == "normalized:market 1")
        .unwrap();
    assert_eq!(
        (
            market.months[8],
            market.months[9],
            market.total_cents,
            market.closed_average_cents
        ),
        (Some(10500), Some(-7000), 3500, Some(1167))
    );
    assert_eq!(report.months[7].spent_cents, Some(0));
    assert_eq!(report.months[6].spent_cents, None);
    assert_eq!(report.months[11].spent_cents, None);
    assert_eq!(report.entries.len(), 5);
    assert_eq!(report.months[9].spent_cents, Some(-5000));
    assert!(report
        .entries
        .iter()
        .any(|e| e.kind == "refund" && e.merchant_id == market.id));
}
#[test]
fn goals_debt_and_paypal_fee_remain_actual_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let goal = goals::setup(&mut db, "Gift", Some("1000"));
    let w = goals::withdrawal(&mut db, &goal, "200");
    let e = goals::purchase(&mut db, "300", "personal");
    db.save_funding(goals::request(
        &db,
        &e,
        vec![goals::funding(&goal, "200", Some(&w))],
    ))
    .unwrap();
    let mut debt = expense("50", "jacob");
    debt.kind = "debt_payment".into();
    debt.date = "2026-10-12".into();
    debt.split_mode = "personal".into();
    debt.account_id = Some("checking".into());
    debt.description = "Student loan".into();
    db.save(debt).unwrap();
    let mut cash = expense("99", "jacob");
    cash.kind = "paypal_cashout".into();
    cash.date = "2026-10-13".into();
    cash.description = "PayPal cash-out".into();
    cash.account_id = Some("checking".into());
    cash.category_id = None;
    cash.split_mode = "none".into();
    cash.paypal = Some(PayPalInput {
        receipts: vec![],
        fee: "1".into(),
        fee_category_id: Some("groceries".into()),
        other: "100".into(),
        other_note: "Existing synthetic funds".into(),
    });
    db.save(cash).unwrap();
    reconciles(&db);
    let report = db.trends_report(2026).unwrap();
    assert_eq!(report.months[9].spent_cents, Some(35100));
    assert_eq!(db.snapshot("2026-10").unwrap().allowance_cents, 15100);
    assert_eq!(
        report
            .entries
            .iter()
            .find(|e| e.kind == "paypal_cashout")
            .unwrap()
            .amount_cents,
        100
    );
    assert!(!report.entries.iter().any(|e| e.kind == "transfer"));
}
#[test]
fn override_archived_history_current_names_and_read_only_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    close(&mut db, "2026-09");
    let mut e = expense("100", "jacob");
    e.date = "2026-09-10".into();
    e.description = "Late shop".into();
    e.budget_override = Some(Choice {
        month: Some("2026-10".into()),
        reason: "Late arrival".into(),
    });
    db.save(e.clone()).unwrap();
    close(&mut db, "2026-10");
    e.revision = 1;
    e.description = "Corrected merchant label".into();
    db.save(e.clone()).unwrap();
    let c = db
        .snapshot("2026-10")
        .unwrap()
        .categories
        .into_iter()
        .find(|c| c.id == "groceries")
        .unwrap();
    db.save_category(CategoryInput {
        id: c.id,
        revision: c.revision,
        name: c.name,
        group_name: c.group_name,
        color: c.color,
        icon: c.icon,
        default_limit: "0".into(),
        archived: true,
    })
    .unwrap();
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    let before: i64 = conn
        .query_row("SELECT COUNT(*) FROM audit", [], |r| r.get(0))
        .unwrap();
    let report = db.trends_report(2026).unwrap();
    assert_eq!(report.months[8].spent_cents, Some(0));
    assert_eq!(report.months[9].spent_cents, Some(7000));
    assert_eq!(report.entries[0].date, "2026-09-10");
    assert_eq!(report.entries[0].month, "2026-10");
    assert_eq!(report.merchants[0].name, "Corrected merchant label");
    assert_eq!(report.categories[0].id, "groceries");
    reconciles(&db);
    assert_eq!(
        before,
        conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM audit", [], |r| r.get(0))
            .unwrap()
    );
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    reconciles(&db);
    assert!(db.trends_report(1899).is_err());
    assert!(db.trends_report(2101).is_err());
    assert!(db.trends_report(2025).unwrap().entries.is_empty());
}
#[test]
fn unresolved_activity_is_not_confirmed_spending_and_identity_does_not_merge_twins() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = classification::stage(
        &mut db,
        "2026-10-10,Unknown,10,id-1,OTHER,Posted\n",
        "checking",
    );
    classification::process(&mut db, &id, classification::policy("ask"));
    buy(&mut db, "2026-10-11", "Twin", "5", "jacob");
    buy(&mut db, "2026-10-11", "Twin", "5", "jacob");
    let r = db.trends_report(2026).unwrap();
    assert_eq!(r.months[9].unresolved_count, 1);
    assert_eq!(r.incomplete_import_count, 1);
    assert_eq!(r.entries.len(), 2);
    assert_eq!(r.merchants[0].total_cents, 700);
    assert_eq!(r.months[9].spent_cents, Some(700));
    reconciles(&db);
}
