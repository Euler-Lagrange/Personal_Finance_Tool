use super::*;
use crate::db::{card_payments::*, card_statements as statements};
use crate::imports::{parse, types::Decision};
use chrono::{Months, NaiveDate};
#[test]
fn extreme_corrupt_obligation_is_rejected_without_panicking_or_replacing_active_records() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    statement(&mut db, "2026-09", "100");
    approve(&mut db, "2026-09");
    let corrupt = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&corrupt)).unwrap();
    conn.execute(
        "UPDATE card_obligations SET base_cents=-9223372036854775808",
        [],
    )
    .unwrap();
    drop(conn);
    assert!(db.restore(&corrupt).is_err());
    assert_eq!(
        db.card_payment_view("amex").unwrap().obligations[0].remaining_cents,
        Some(10000)
    );
}
fn op() -> String {
    Uuid::new_v4().to_string()
}
#[test]
fn recalculated_obligation_requires_review_and_later_allocations_preserve_closed_reports() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    db.save_checkpoint(crate::db::balances::CheckpointInput {
        id: op(),
        revision: 0,
        account_id: "amex".into(),
        date: "2026-09-30".into(),
        amount: "100".into(),
        purpose: "confirmed".into(),
        note: "Synthetic checkpoint".into(),
    })
    .unwrap();
    let mut d = db
        .card_statement_month("2026-10")
        .unwrap()
        .statements
        .remove(0)
        .draft;
    d.dates_confirmed = true;
    d.note = "Reviewed calculated balance with coverage gap".into();
    let r = db.review_card_statement(d.clone()).unwrap();
    db.save_card_statement(
        &op(),
        statements::Save {
            draft: d,
            token: r.token,
            confirmed: true,
        },
    )
    .unwrap();
    approve(&mut db, "2026-10");
    let p = payment(&mut db, "2026-10-25", "60");
    allocate(&mut db, &p.id, &[("2026-10", "60")]);
    let mut e = expense("20", "jacob");
    e.date = "2026-10-15".into();
    e.split_mode = "personal".into();
    db.save(e).unwrap();
    let v = db.card_payment_view("amex").unwrap();
    assert!(v.obligations[0].needs_review);
    assert!(!v.obligations[0].can_review);
    let d = db
        .card_statement_month("2026-10")
        .unwrap()
        .statements
        .remove(0)
        .draft;
    let r = db.review_card_statement(d.clone()).unwrap();
    db.save_card_statement(
        &op(),
        statements::Save {
            draft: d,
            token: r.token,
            confirmed: true,
        },
    )
    .unwrap();
    let v = db.card_payment_view("amex").unwrap();
    assert_eq!(v.obligations[0].base_cents, Some(10000));
    assert_eq!(v.obligations[0].proposed_base_cents, Some(12000));
    approve(&mut db, "2026-10");
    assert_eq!(
        db.card_payment_view("amex").unwrap().obligations[0].remaining_cents,
        Some(6000)
    );
    let r = db.close_review("2026-10").unwrap();
    db.close_month(crate::db::periods::CloseInput {
        id: op(),
        month: "2026-10".into(),
        revision: r.revision,
        token: r.token,
        acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
        note: "Synthetic close".into(),
        carry: None,
    })
    .unwrap();
    let before = db.shared_statement_view(Some("2026-10")).unwrap();
    let p = payment(&mut db, "2026-11-01", "60");
    allocate(&mut db, &p.id, &[("2026-10", "60")]);
    assert_eq!(db.shared_statement_view(Some("2026-10")).unwrap(), before);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 2000);
    assert_eq!(
        db.card_payment_view("amex").unwrap().obligations[0].remaining_cents,
        Some(0)
    );
}
fn setup(db: &mut Store) {
    db.save_card_statement_config(
        &op(),
        statements::Config {
            account_id: "amex".into(),
            revision: 0,
            first_month: "2026-01".into(),
            closing_day: 20,
            due_day: 15,
            due_month_offset: 1,
            date_basis: "posted".into(),
            archived: false,
        },
    )
    .unwrap();
}
pub(super) fn statement(db: &mut Store, month: &str, amount: &str) {
    let mut d = db
        .card_statement_month(month)
        .unwrap()
        .statements
        .remove(0)
        .draft;
    d.dates_confirmed = true;
    d.balance = Some(amount.into());
    d.note = "Synthetic issuer statement".into();
    d.due_date = NaiveDate::parse_from_str(&format!("{month}-15"), "%Y-%m-%d")
        .unwrap()
        .checked_add_months(Months::new(1))
        .unwrap()
        .to_string();
    let r = db.review_card_statement(d.clone()).unwrap();
    db.save_card_statement(
        &op(),
        statements::Save {
            draft: d,
            token: r.token,
            confirmed: true,
        },
    )
    .unwrap();
}
fn obligation(db: &Store, month: &str) -> ObligationInput {
    let v = db.card_payment_view("amex").unwrap();
    let o = v.obligations.iter().find(|o| o.month == month).unwrap();
    ObligationInput {
        account_id: "amex".into(),
        month: month.into(),
        revision: o.revision,
        token: v.token,
        note: "Issuer carry reviewed".into(),
        confirmed: true,
    }
}
pub(super) fn approve(db: &mut Store, month: &str) {
    db.save_card_obligation(&op(), obligation(db, month))
        .unwrap();
}
pub(super) fn payment(db: &mut Store, date: &str, amount: &str) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.kind = "card_payment".into();
    e.date = date.into();
    e.account_id = Some("checking".into());
    e.destination_account_id = Some("amex".into());
    e.category_id = None;
    e.split_mode = "none".into();
    db.save(e.clone()).unwrap();
    e.revision = 1;
    e
}
fn credit(db: &mut Store, date: &str, amount: &str) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.kind = "reward".into();
    e.date = date.into();
    e.category_id = None;
    e.split_mode = "none".into();
    db.save(e.clone()).unwrap();
    e.revision = 1;
    e
}
fn request(db: &Store, id: &str, allocs: &[(&str, &str)]) -> PaymentInput {
    let v = db.card_payment_view("amex").unwrap();
    let p = v.payments.iter().find(|p| p.id == id).unwrap();
    PaymentInput {
        account_id: "amex".into(),
        event_id: id.into(),
        event_revision: p.revision,
        revision: p.review_revision,
        token: v.token,
        allocations: allocs
            .iter()
            .map(|(m, a)| Allocation {
                month: (*m).into(),
                amount: (*a).into(),
            })
            .collect(),
        note: "Posting date and issuer treatment reviewed".into(),
        confirmed: true,
    }
}
pub(super) fn allocate(db: &mut Store, id: &str, allocs: &[(&str, &str)]) {
    db.save_card_payment_review(&op(), request(db, id, allocs))
        .unwrap();
}
#[test]
fn shared_payment_capacity_and_partial_balances_count_carried_debt_only_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    statement(&mut db, "2026-09", "100");
    approve(&mut db, "2026-09");
    statement(&mut db, "2026-10", "150");
    let v = db.card_payment_view("amex").unwrap();
    assert_eq!(v.obligations[1].proposed_new_cents, Some(5000));
    assert_eq!(
        v.obligations[1].proposed_carry,
        vec![Carry {
            month: "2026-09".into(),
            amount_cents: 10000
        }]
    );
    approve(&mut db, "2026-10");
    let p = payment(&mut db, "2026-10-25", "120");
    allocate(&mut db, &p.id, &[("2026-09", "70"), ("2026-10", "50")]);
    let v = db.card_payment_view("amex").unwrap();
    assert_eq!(
        v.obligations
            .iter()
            .map(|o| o.remaining_cents.unwrap())
            .collect::<Vec<_>>(),
        vec![3000, 0]
    );
    assert!(v.obligations.iter().all(|o| !o.needs_review));
    assert_eq!(v.obligations[1].statement_remaining_cents, Some(3000));
    assert_eq!(v.obligations[1].carried_remaining_cents, 3000);
    assert!(db
        .save_card_payment_review(
            &op(),
            request(&db, &p.id, &[("2026-09", "100"), ("2026-10", "50")])
        )
        .unwrap_err()
        .contains("actual payment"));
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 0);
    assert_eq!(s.income_cents, 0);
    assert_eq!(s.entries.len(), 1);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        -12000
    );
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(
        db.card_payment_view("amex").unwrap().obligations[0].remaining_cents,
        Some(3000)
    );
}
#[test]
fn credit_review_is_explicit_and_partial_credit_cannot_be_used_twice() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    statement(&mut db, "2026-09", "100");
    approve(&mut db, "2026-09");
    let c = credit(&mut db, "2026-10-01", "30");
    let v = db.card_payment_view("amex").unwrap();
    assert_eq!(v.obligations[0].remaining_cents, Some(10000));
    assert!(v.obligations[0]
        .warnings
        .iter()
        .any(|s| s.contains("post-close credits")));
    allocate(&mut db, &c.id, &[]);
    let v = db.card_payment_view("amex").unwrap();
    assert_eq!(v.obligations[0].remaining_cents, Some(10000));
    assert!(!v.obligations[0]
        .warnings
        .iter()
        .any(|s| s.contains("post-close credits")));
    allocate(&mut db, &c.id, &[("2026-09", "20")]);
    assert_eq!(
        db.card_payment_view("amex").unwrap().obligations[0].remaining_cents,
        Some(8000)
    );
    let mut bad = request(&db, &c.id, &[("2026-09", "20"), ("2026-09", "10")]);
    assert!(db.save_card_payment_review(&op(), bad).is_err());
    bad = request(&db, &c.id, &[("2026-09", "31")]);
    assert!(db.save_card_payment_review(&op(), bad).is_err());
    db.clear_card_payment_review(&op(), request(&db, &c.id, &[]))
        .unwrap();
    assert!(db.card_payment_view("amex").unwrap().obligations[0]
        .warnings
        .iter()
        .any(|s| s.contains("post-close credits")));
}
#[test]
fn late_allocation_before_next_cutoff_invalidates_carry_then_reconciles_without_changing_money() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    statement(&mut db, "2026-09", "100");
    approve(&mut db, "2026-09");
    statement(&mut db, "2026-10", "150");
    approve(&mut db, "2026-10");
    let p = payment(&mut db, "2026-10-10", "40");
    allocate(&mut db, &p.id, &[("2026-09", "40")]);
    let v = db.card_payment_view("amex").unwrap();
    assert!(v.obligations[1].needs_review);
    assert_eq!(v.obligations[1].proposed_new_cents, Some(9000));
    assert!(db
        .save_card_payment_review(&op(), request(&db, &p.id, &[("2026-10", "40")]))
        .unwrap_err()
        .contains("already included"));
    approve(&mut db, "2026-10");
    let v = db.card_payment_view("amex").unwrap();
    assert_eq!(
        v.obligations
            .iter()
            .map(|o| o.remaining_cents.unwrap())
            .sum::<i64>(),
        15000
    );
    assert!(v.obligations.iter().all(|o| !o.needs_review));
    let p2 = payment(&mut db, "2026-10-25", "150");
    allocate(&mut db, &p2.id, &[("2026-09", "60"), ("2026-10", "90")]);
    assert!(db
        .card_payment_view("amex")
        .unwrap()
        .obligations
        .iter()
        .all(|o| o.remaining_cents == Some(0)));
    let old = payment(&mut db, "2026-09-20", "1");
    assert!(db
        .save_card_payment_review(&op(), request(&db, &old.id, &[("2026-09", "1")]))
        .unwrap_err()
        .contains("already included"));
}
#[test]
fn three_cycles_split_overlap_and_block_unresolved_or_excess_prior_debt() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    statement(&mut db, "2026-07", "100");
    statement(&mut db, "2026-08", "150");
    assert!(!db.card_payment_view("amex").unwrap().obligations[1].can_review);
    approve(&mut db, "2026-07");
    approve(&mut db, "2026-08");
    statement(&mut db, "2026-09", "200");
    approve(&mut db, "2026-09");
    let v = db.card_payment_view("amex").unwrap();
    assert_eq!(
        v.obligations
            .iter()
            .map(|o| o.new_cents.unwrap())
            .collect::<Vec<_>>(),
        vec![10000, 5000, 5000]
    );
    assert_eq!(v.obligations[2].proposed_carry.len(), 2);
    statement(&mut db, "2026-10", "80");
    let v = db.card_payment_view("amex").unwrap();
    assert!(!v.obligations[3].can_review);
    assert!(v.obligations[3]
        .blockers
        .iter()
        .any(|s| s.contains("exceed this statement")));
    assert!(db
        .clear_card_obligation(&op(), obligation(&db, "2026-07"))
        .unwrap_err()
        .contains("carries this debt"));
}
#[test]
fn guarded_financial_edits_retries_stale_views_and_rollback_leave_no_partial_allocations() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    statement(&mut db, "2026-09", "100");
    approve(&mut db, "2026-09");
    let mut p = payment(&mut db, "2026-10-01", "60");
    let req = request(&db, &p.id, &[("2026-09", "60")]);
    let operation = op();
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_card_receipt BEFORE INSERT ON card_payment_receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;").unwrap();
    let raw = serde_json::to_string(&req).unwrap();
    assert!(db.save_card_payment_review(&operation, req).is_err());
    assert_eq!(
        db.card_payment_view("amex").unwrap().obligations[0].remaining_cents,
        Some(10000)
    );
    conn.execute_batch("DROP TRIGGER fail_card_receipt;")
        .unwrap();
    for _ in 0..2 {
        db.save_card_payment_review(&operation, serde_json::from_str(&raw).unwrap())
            .unwrap();
    }
    p.amount = "61".into();
    assert!(db
        .save(p.clone())
        .unwrap_err()
        .contains("statement payment"));
    p.amount = "60".into();
    p.date = "2026-10-02".into();
    assert!(db.save(p.clone()).is_err());
    p.date = "2026-10-01".into();
    p.note = "Nonfinancial note".into();
    db.save(p.clone()).unwrap();
    p.revision = 2;
    assert!(db
        .delete(&p.id, p.revision)
        .unwrap_err()
        .contains("statement payment"));
    assert!(db
        .clear_card_obligation(&op(), obligation(&db, "2026-09"))
        .is_err());
    let mut d = db
        .card_statement_month("2026-09")
        .unwrap()
        .statements
        .remove(0)
        .draft;
    d.balance = Some("101".into());
    let r = db.review_card_statement(d.clone()).unwrap();
    assert!(db
        .save_card_statement(
            &op(),
            statements::Save {
                draft: d,
                token: r.token,
                confirmed: true
            }
        )
        .unwrap_err()
        .contains("obligation review"));
    let stale = request(&db, &p.id, &[]);
    credit(&mut db, "2026-10-03", "1");
    assert!(db
        .save_card_payment_review(&op(), stale)
        .unwrap_err()
        .contains("changed"));
    db.clear_card_payment_review(&op(), request(&db, &p.id, &[]))
        .unwrap();
    db.delete(&p.id, p.revision).unwrap();
    db.clear_card_obligation(&op(), obligation(&db, "2026-09"))
        .unwrap();
    statement(&mut db, "2026-09", "101");
    let raw: String = conn
        .query_row(
            "SELECT payload FROM audit WHERE action='card_payment_review' ORDER BY id LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let history: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(history[1]["stamp"]["amount"], 6000);
    assert_eq!(history[1]["stamp"]["date"], "2026-10-01");
    assert_eq!(history[1]["request"]["allocations"][0]["amount"], "60");
}
#[test]
fn import_source_posting_date_cannot_rewrite_a_reviewed_payment_and_undo_requires_release() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    statement(&mut db, "2026-09", "100");
    approve(&mut db, "2026-09");
    let p = payment(&mut db, "2026-10-01", "60");
    allocate(&mut db, &p.id, &[("2026-09", "60")]);
    let bytes = b"Date,Description,Amount,Posted\n2026-10-01,Card payment,-60,2026-10-02\n";
    let prepared = parse::prepare("card-payment.csv", bytes, None).unwrap();
    let id = db
        .ingest("card-payment.csv", bytes.to_vec(), prepared)
        .unwrap();
    let detail = db.import_detail(&id).unwrap();
    let mut m = detail.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_date_column = Some(3);
    m.posted_confirmed = true;
    db.configure_import(&id, detail.source.revision, "amex", m)
        .unwrap();
    let detail = db.import_detail(&id).unwrap();
    let decision = Decision {
        row_id: detail.rows[0].id.clone(),
        action: "link".into(),
        input: None,
        match_id: Some(p.id.clone()),
        match_revision: Some(1),
        confirmed: true,
        separate: false,
        rule_signature: None,
    };
    let raw = serde_json::to_string(&decision).unwrap();
    assert!(db
        .commit_import(&id, detail.source.revision, &op(), vec![decision])
        .err()
        .unwrap()
        .contains("account dates"));
    assert_eq!(
        db.import_detail(&id).unwrap().rows[0].disposition,
        "pending"
    );
    db.clear_card_payment_review(&op(), request(&db, &p.id, &[]))
        .unwrap();
    let commit = op();
    let detail = db.import_detail(&id).unwrap();
    db.commit_import(
        &id,
        detail.source.revision,
        &commit,
        vec![serde_json::from_str(&raw).unwrap()],
    )
    .unwrap();
    allocate(&mut db, &p.id, &[("2026-09", "60")]);
    let v = db.card_payment_view("amex").unwrap();
    assert_eq!(v.payments[0].card_date, "2026-10-02");
    assert_eq!(v.payments[0].bank_date.as_deref(), Some("2026-10-01"));
    assert!(!v.payments[0].date_assumed);
    assert!(db
        .undo_import(&commit)
        .unwrap_err()
        .contains("account dates"));
    db.clear_card_payment_review(&op(), request(&db, &p.id, &[]))
        .unwrap();
    db.undo_import(&commit).unwrap();
    assert_eq!(
        db.card_payment_view("amex").unwrap().payments[0].card_date,
        "2026-10-01"
    );
}
#[test]
fn schema25_upgrade_corrupt_restore_and_sample_isolation_preserve_statement_reviews() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    statement(&mut db, "2026-09", "100");
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_card_payment_schema(&conn);
    conn.pragma_update(None, "user_version", 25).unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    approve(&mut db, "2026-09");
    let p = payment(&mut db, "2026-10-01", "20");
    allocate(&mut db, &p.id, &[("2026-09", "20")]);
    let good = db.backup().unwrap();
    db.restore(&good).unwrap();
    let corrupt = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&corrupt)).unwrap();
    conn.execute("UPDATE card_payment_allocations SET amount_cents=3000", [])
        .unwrap();
    drop(conn);
    assert!(db.restore(&corrupt).is_err());
    assert_eq!(
        db.card_payment_view("amex").unwrap().obligations[0].remaining_cents,
        Some(8000)
    );
    let corrupt = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&corrupt)).unwrap();
    conn.execute_batch("DROP TABLE card_payment_receipts;")
        .unwrap();
    drop(conn);
    assert!(db.restore(&corrupt).is_err());
    let demo = Store::open(dir.path(), "demo").unwrap();
    assert!(demo
        .card_payment_view("amex")
        .unwrap()
        .obligations
        .is_empty());
}
