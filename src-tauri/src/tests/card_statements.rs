use super::*;
use crate::db::{balances::CheckpointInput, card_statements::*, identity::CoverageInput};
use crate::imports::{parse, types::Decision};

#[test]
fn source_assignment_and_offsetting_corrections_require_explicit_statement_review() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    cp(&mut db, "2026-09-30", "0");
    let source = stage(
        &mut db,
        "Date,Description,Amount,Posted\n2026-10-01,Pending evidence,40,2026-10-01\n",
        "2026-10-01",
        "2026-10-20",
        "posted",
    );
    let mut a = expense("10", "jacob");
    a.date = "2026-10-03".into();
    db.save(a.clone()).unwrap();
    let mut b = expense("20", "jacob");
    b.date = "2026-10-04".into();
    db.save(b.clone()).unwrap();
    let mut d = draft(&db, "2026-10");
    d.evidence_source_id = Some(source.clone());
    d.note = "Reviewed source".into();
    save(&mut db, d);
    let detail = db.import_detail(&source).unwrap();
    assert!(db
        .configure_import(&source, detail.source.revision, "citi", detail.mapping)
        .unwrap_err()
        .contains("saved statement"));
    let d = draft(&db, "2026-10");
    let old = db.review_card_statement(d.clone()).unwrap();
    a.revision = 1;
    a.amount = "11".into();
    db.save(a).unwrap();
    b.revision = 1;
    b.amount = "19".into();
    db.save(b).unwrap();
    let now = db.review_card_statement(d.clone()).unwrap();
    assert_eq!(old.calculation.balance_cents, now.calculation.balance_cents);
    assert_ne!(old.token, now.token);
    assert!(db.card_statement_month("2026-10").unwrap().statements[0].changed_since_review);
    assert!(db
        .save_card_statement(
            &op(),
            Save {
                draft: d.clone(),
                token: old.token,
                confirmed: true
            }
        )
        .is_err());
    let mut d = d;
    d.evidence_source_id = None;
    save(&mut db, d);
    let detail = db.import_detail(&source).unwrap();
    db.configure_import(&source, detail.source.revision, "citi", detail.mapping)
        .unwrap();
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
}
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn config() -> Config {
    Config {
        account_id: "amex".into(),
        revision: 0,
        first_month: "2026-01".into(),
        closing_day: 20,
        due_day: 15,
        due_month_offset: 1,
        date_basis: "posted".into(),
        archived: false,
    }
}
fn setup(db: &mut Store) {
    db.save_card_statement_config(&op(), config()).unwrap();
}
fn draft(db: &Store, month: &str) -> Draft {
    db.card_statement_month(month)
        .unwrap()
        .statements
        .remove(0)
        .draft
}
fn cp(db: &mut Store, day: &str, amount: &str) {
    db.save_checkpoint(CheckpointInput {
        id: op(),
        revision: 0,
        account_id: "amex".into(),
        date: day.into(),
        amount: amount.into(),
        purpose: "confirmed".into(),
        note: "Synthetic end-of-day balance".into(),
    })
    .unwrap();
}
fn save(db: &mut Store, d: Draft) {
    let r = db.review_card_statement(d.clone()).unwrap();
    db.save_card_statement(
        &op(),
        Save {
            draft: d,
            token: r.token,
            confirmed: true,
        },
    )
    .unwrap();
}
fn stage(db: &mut Store, csv: &str, start: &str, end: &str, basis: &str) -> String {
    let p = parse::prepare("card.csv", csv.as_bytes(), None).unwrap();
    let id = db.ingest("card.csv", csv.as_bytes().to_vec(), p).unwrap();
    let detail = db.import_detail(&id).unwrap();
    let mut m = detail.mapping;
    m.posted_date_column = Some(3);
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(&id, detail.source.revision, "amex", m)
        .unwrap();
    let rev = db.import_detail(&id).unwrap().source.revision;
    db.confirm_import_coverage(
        &id,
        rev,
        CoverageInput {
            start_date: start.into(),
            end_date: end.into(),
            date_basis: basis.into(),
            completeness: "complete".into(),
            profile: "Synthetic card".into(),
            observed_at: "2026-11-01T18:00:00Z".into(),
            inclusive: true,
        },
    )
    .unwrap();
    id
}
fn post(db: &mut Store, id: &str) -> String {
    let detail = db.import_detail(id).unwrap();
    let decisions = detail
        .rows
        .iter()
        .map(|r| {
            let mut e = expense(
                &format!(
                    "{}.{:02}",
                    r.candidate.amount_cents.unwrap() / 100,
                    r.candidate.amount_cents.unwrap() % 100
                ),
                "jacob",
            );
            e.id = r.id.clone();
            e.date = r.candidate.date.clone().unwrap();
            e.description = r.candidate.description.clone();
            e.split_mode = "personal".into();
            Decision {
                row_id: r.id.clone(),
                action: "add".into(),
                input: Some(e),
                match_id: None,
                match_revision: None,
                confirmed: true,
                separate: true,
                rule_signature: None,
            }
        })
        .collect();
    let operation = op();
    db.commit_import(id, detail.source.revision, &operation, decisions)
        .unwrap();
    operation
}
#[test]
fn cutoff_uses_checkpoint_and_posting_dates_not_current_balance_or_budget_period() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    cp(&mut db, "2026-09-30", "100");
    let source=stage(&mut db,"Date,Description,Amount,Posted\n2026-09-30,Before transaction after checkpoint,25,2026-10-01\n2026-10-19,At cutoff,50,2026-10-20\n2026-10-20,After cutoff,75,2026-10-21\n","2026-10-01","2026-10-31","posted");
    let d = draft(&db, "2026-10");
    assert!(
        db.review_card_statement(d.clone())
            .unwrap()
            .calculation
            .unresolved_count
            > 0
    );
    post(&mut db, &source);
    let c = db.review_card_statement(d.clone()).unwrap().calculation;
    assert_eq!(c.balance_cents, Some(17500));
    assert!(c.complete);
    assert_eq!(c.change_cents, 7500);
    assert!(c.gaps.is_empty());
    let entry = db
        .snapshot("2026-10")
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.description == "At cutoff")
        .unwrap();
    let mut e = expense("50", "jacob");
    e.id = entry.id;
    e.revision = entry.revision;
    e.date = entry.date;
    e.description = entry.description;
    e.split_mode = "personal".into();
    e.budget_override = Some(crate::db::budget_periods::Choice {
        month: Some("2026-11".into()),
        reason: "Synthetic later budget".into(),
    });
    db.save(e).unwrap();
    assert_eq!(
        db.review_card_statement(d)
            .unwrap()
            .calculation
            .balance_cents,
        Some(17500)
    );
    let b = db
        .snapshot("2026-10")
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.id == "amex")
        .unwrap()
        .balance
        .unwrap();
    assert_eq!(b.estimated_cents, 25000);
}
#[test]
fn coverage_must_be_accepted_compatible_and_cover_entire_checkpoint_interval() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    let d = draft(&db, "2026-10");
    assert_eq!(
        db.review_card_statement(d.clone())
            .unwrap()
            .calculation
            .balance_cents,
        None
    );
    cp(&mut db, "2026-09-30", "0");
    let a = stage(
        &mut db,
        "Date,Description,Amount,Posted\n2026-10-10,First,10,2026-10-10\n",
        "2026-10-01",
        "2026-10-10",
        "posted",
    );
    assert_eq!(
        db.review_card_statement(d.clone())
            .unwrap()
            .calculation
            .gaps,
        vec![Range {
            start: "2026-10-01".into(),
            end: "2026-10-20".into()
        }]
    );
    post(&mut db, &a);
    let c = db.review_card_statement(d.clone()).unwrap().calculation;
    assert_eq!(c.gaps[0].start, "2026-10-11");
    let b = stage(
        &mut db,
        "Date,Description,Amount,Posted\n2026-10-15,Second,20,2026-10-15\n",
        "2026-10-12",
        "2026-10-20",
        "posted",
    );
    post(&mut db, &b);
    let c = db.review_card_statement(d.clone()).unwrap().calculation;
    assert_eq!(
        c.gaps,
        vec![Range {
            start: "2026-10-11".into(),
            end: "2026-10-11".into()
        }]
    );
    assert!(!c.complete);
    // Same-day checkpoint needs no subsequent coverage; it includes all that day's activity.
    cp(&mut db, "2026-10-20", "88");
    let c = db.review_card_statement(d.clone()).unwrap().calculation;
    assert!(c.complete);
    assert_eq!(c.balance_cents, Some(8800));
    let mut transaction = d;
    transaction.date_basis = "transaction".into();
    assert!(
        !db.review_card_statement(transaction)
            .unwrap()
            .calculation
            .complete
    );
}
#[test]
fn payments_refunds_rewards_change_cutoff_liability_without_new_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    cp(&mut db, "2026-09-30", "100");
    let mut e = expense("624", "jacob");
    e.date = "2026-10-01".into();
    e.split_mode = "personal".into();
    let original = e.id.clone();
    db.save(e).unwrap();
    let mut payment = expense("624", "jacob");
    payment.kind = "card_payment".into();
    payment.date = "2026-10-15".into();
    payment.account_id = Some("checking".into());
    payment.destination_account_id = Some("amex".into());
    payment.category_id = None;
    payment.split_mode = "none".into();
    db.save(payment).unwrap();
    let mut refund = expense("20", "jacob");
    refund.kind = "refund".into();
    refund.date = "2026-10-18".into();
    refund.original_event_id = Some(original);
    refund.split_mode = "personal".into();
    db.save(refund).unwrap();
    let mut reward = expense("5", "jacob");
    reward.kind = "reward".into();
    reward.date = "2026-10-19".into();
    reward.category_id = None;
    reward.split_mode = "none".into();
    db.save(reward).unwrap();
    let c = db
        .review_card_statement(draft(&db, "2026-10"))
        .unwrap()
        .calculation;
    assert_eq!(c.balance_cents, Some(7500));
    assert_eq!(c.assumed_date_count, 4);
    assert!(!c.complete);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 60400);
    let mut d = draft(&db, "2026-10");
    d.dates_confirmed = true;
    d.balance = Some("75".into());
    d.note = "Issuer PDF reviewed".into();
    save(&mut db, d);
    let mut late = expense("10", "jacob");
    late.kind = "reward".into();
    late.date = "2026-10-21".into();
    late.category_id = None;
    late.split_mode = "none".into();
    db.save(late).unwrap();
    let v = db.card_statement_month("2026-10").unwrap();
    assert_eq!(v.statements[0].confirmed_balance_cents, Some(7500));
    assert_eq!(v.statements[0].difference_cents, Some(0));
    assert!(!v.statements[0].changed_since_review);
}
#[test]
fn statement_confirmation_is_guarded_idempotent_atomic_and_survives_later_corrections() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    cp(&mut db, "2026-09-30", "100");
    let mut d = draft(&db, "2026-10");
    d.dates_confirmed = true;
    d.balance = Some("120".into());
    d.note = "Synthetic issuer statement".into();
    let r = db.review_card_statement(d.clone()).unwrap();
    let token = r.token;
    let operation = op();
    let mut e = expense("20", "jacob");
    e.date = "2026-10-01".into();
    db.save(e).unwrap();
    assert!(db
        .save_card_statement(
            &operation,
            Save {
                draft: d.clone(),
                token,
                confirmed: true
            }
        )
        .unwrap_err()
        .contains("changed"));
    let token = db.review_card_statement(d.clone()).unwrap().token;
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_statement BEFORE INSERT ON card_statement_receipts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    assert!(db
        .save_card_statement(
            &operation,
            Save {
                draft: d.clone(),
                token: token.clone(),
                confirmed: true
            }
        )
        .is_err());
    assert_eq!(draft(&db, "2026-10").revision, 0);
    conn.execute_batch("DROP TRIGGER fail_statement;").unwrap();
    for _ in 0..2 {
        db.save_card_statement(
            &operation,
            Save {
                draft: d.clone(),
                token: token.clone(),
                confirmed: true,
            },
        )
        .unwrap();
    }
    assert_eq!(draft(&db, "2026-10").revision, 1);
    d.balance = Some("121".into());
    assert!(db
        .save_card_statement(
            &operation,
            Save {
                draft: d.clone(),
                token,
                confirmed: true
            }
        )
        .is_err());
    assert!(db.review_card_statement(d).is_err());
    cp(&mut db, "2026-10-10", "130");
    let v = db.card_statement_month("2026-10").unwrap();
    assert!(v.statements[0].changed_since_review);
    assert_eq!(v.statements[0].confirmed_balance_cents, Some(12000));
    assert_eq!(v.statements[0].difference_cents, Some(-1000));
    assert_eq!(db.snapshot("2026-10").unwrap().entries.len(), 1);
}
#[test]
fn configs_clamp_preserve_saved_cycles_handle_credit_balances_and_validate_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut cfg = config();
    cfg.first_month = "2024-01".into();
    cfg.closing_day = 31;
    cfg.due_day = 31;
    db.save_card_statement_config(&op(), cfg.clone()).unwrap();
    let mut d = draft(&db, "2024-02");
    assert_eq!(
        (&*d.closing_date, &*d.due_date),
        ("2024-02-29", "2024-03-31")
    );
    d.balance = Some("-12.34".into());
    d.dates_confirmed = true;
    d.note = "Credit balance".into();
    save(&mut db, d);
    cfg.revision = 1;
    cfg.closing_day = 20;
    db.save_card_statement_config(&op(), cfg.clone()).unwrap();
    assert_eq!(draft(&db, "2024-02").closing_date, "2024-02-29");
    assert_eq!(draft(&db, "2025-02").closing_date, "2025-02-20");
    assert_eq!(
        db.card_statement_month("2024-02").unwrap().statements[0].confirmed_balance_cents,
        Some(-1234)
    );
    let future = draft(&db, "2099-01");
    assert!(
        !db.review_card_statement(future.clone())
            .unwrap()
            .calculation
            .complete
    );
    let mut future = future;
    future.dates_confirmed = true;
    assert!(db.review_card_statement(future).is_err());
    cfg.revision = 2;
    cfg.archived = true;
    db.save_card_statement_config(&op(), cfg).unwrap();
    assert!(db
        .card_statement_month("2025-02")
        .unwrap()
        .statements
        .is_empty());
    assert_eq!(
        db.card_statement_month("2024-02").unwrap().statements.len(),
        1
    );
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    let corrupt = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&corrupt)).unwrap();
    conn.execute(
        "UPDATE card_statements SET review_json=json_set(review_json,'$.changeCents',900)",
        [],
    )
    .unwrap();
    drop(conn);
    assert!(db.restore(&corrupt).is_err());
    let demo = Store::open(dir.path(), "demo").unwrap();
    assert!(demo
        .card_statement_month("2024-02")
        .unwrap()
        .configs
        .is_empty());
}
#[test]
fn schema24_upgrade_preserves_closed_reports_and_rejects_missing_statement_tables() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let r = db.close_review("2026-09").unwrap();
    db.close_month(crate::db::periods::CloseInput {
        id: op(),
        month: "2026-09".into(),
        revision: r.revision,
        token: r.token,
        acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
        note: String::new(),
        carry: None,
    })
    .unwrap();
    let before = db.shared_statement_view(Some("2026-09")).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_card_statement_schema(&conn);
    conn.pragma_update(None, "user_version", 24).unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.shared_statement_view(Some("2026-09")).unwrap(), before);
    setup(&mut db);
    let backup = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    conn.execute_batch("DROP TABLE card_statement_receipts;")
        .unwrap();
    drop(conn);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.card_statement_month("2026-10").unwrap().configs.len(), 1);
}
