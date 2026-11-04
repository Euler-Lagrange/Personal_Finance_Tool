use super::*;
use crate::db::bills::*;
use crate::imports::{parse, types::Decision};

pub(super) fn draft(name: &str, amount: &str) -> Draft {
    Draft {
        lines: Vec::new(),
        amount: amount.into(),
        details: Details {
            name: name.into(),
            merchant: "utility".into(),
            category_id: "home".into(),
            account_id: Some("amex".into()),
            payer: "jacob".into(),
            split_mode: "shared".into(),
            split_value: String::new(),
            autopay: true,
            payment_kind: "expense".into(),
        },
    }
}
fn schedule(db: &mut Store, name: &str, amount: &str) -> String {
    let id = Uuid::new_v4().to_string();
    db.save_bill_template(&id, 0, "2026-10-31", 1, None, false, draft(name, amount))
        .unwrap();
    id
}
fn row(db: &mut Store, id: &str) -> Occurrence {
    db.bill_month("2026-11")
        .unwrap()
        .into_iter()
        .find(|o| o.bill_id == id)
        .unwrap()
}
fn payment(amount: &str) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.date = "2026-11-01".into();
    e.category_id = Some("home".into());
    e.description = "Utility payment".into();
    e
}
fn update(o: &Occurrence, actual: Option<&str>, cancelled: bool) -> OccurrenceInput {
    OccurrenceInput {
        id: o.id.clone(),
        revision: o.revision,
        due_date: o.due_date.clone(),
        actual_amount: actual.map(str::to_string),
        cancelled,
        note: String::new(),
        plan: Draft {
            lines: o
                .plan
                .lines
                .iter()
                .map(crate::models::EntryLine::input)
                .collect(),
            details: o.plan.details.clone(),
            amount: format!(
                "{}.{:02}",
                o.plan.amount_cents / 100,
                o.plan.amount_cents % 100
            ),
        },
    }
}
fn link(o: &Occurrence, e: &EntryInput, amount: &str) -> LinkInput {
    LinkInput {
        id: Uuid::new_v4().to_string(),
        occurrence_id: o.id.clone(),
        revision: o.revision,
        event_id: e.id.clone(),
        event_revision: 1,
        amount: amount.into(),
    }
}

#[test]
fn bill_schedule_clamps_short_months_without_drift_and_never_creates_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = Uuid::new_v4().to_string();
    db.save_bill_template(
        &id,
        0,
        "2024-01-31",
        1,
        Some("2024-03-31".into()),
        false,
        draft("Rent", "100"),
    )
    .unwrap();
    assert!(db.bill_month("2023-12").unwrap().is_empty());
    assert_eq!(db.bill_month("2024-02").unwrap()[0].due_date, "2024-02-29");
    assert_eq!(db.bill_month("2024-03").unwrap()[0].due_date, "2024-03-31");
    assert!(db.bill_month("2024-04").unwrap().is_empty());
    let first = db.bill_month("2024-02").unwrap().remove(0);
    assert_eq!(db.bill_month("2024-02").unwrap()[0].id, first.id);
    assert_eq!(first.paid_cents, 0);
    assert_eq!(first.remaining_cents, 10000);
    assert_eq!(db.snapshot("2024-02").unwrap().spent_cents, 0);
    assert_eq!(db.snapshot("2024-02").unwrap().household_cents, 0);
    let annual = Uuid::new_v4().to_string();
    db.save_bill_template(
        &annual,
        0,
        "2024-02-29",
        12,
        None,
        false,
        draft("Annual insurance", "1200"),
    )
    .unwrap();
    assert_eq!(db.bill_month("2025-02").unwrap()[0].due_date, "2025-02-28");
    assert!(db.bill_month("2025-03").unwrap().is_empty());
}
#[test]
fn prepared_bills_keep_historical_plans_and_actual_changes_compare_confirmed_bills() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = schedule(&mut db, "Electric", "100");
    let old = db.bill_month("2026-10").unwrap().remove(0);
    db.save_bill_occurrence(update(&old, Some("95"), false))
        .unwrap();
    let november = row(&mut db, &id);
    db.save_bill_template(
        &id,
        1,
        "2026-10-31",
        1,
        None,
        false,
        draft("Electric", "110"),
    )
    .unwrap();
    assert_eq!(row(&mut db, &id).plan.amount_cents, 10000);
    assert_eq!(
        db.bill_month("2026-12").unwrap()[0].plan.amount_cents,
        11000
    );
    assert_eq!(november.previous_cents, Some(9500));
    db.save_bill_occurrence(update(&november, Some("115"), false))
        .unwrap();
    assert!(db
        .save_bill_occurrence(update(&november, Some("120"), false))
        .is_err());
    db.save_bill_template(
        &id,
        2,
        "2026-10-31",
        1,
        None,
        true,
        draft("Electric", "110"),
    )
    .unwrap();
    assert!(db.bill_month("2027-01").unwrap().is_empty());
    assert_eq!(row(&mut db, &id).actual_cents, Some(11500));
}
#[test]
fn bill_payment_is_atomic_idempotent_and_partial_payment_does_not_settle_full_bill() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = schedule(&mut db, "Utility", "100");
    let o = row(&mut db, &id);
    let e = payment("60");
    let op = Uuid::new_v4().to_string();
    db.record_bill_payment(&o.id, o.revision, &op, e.clone())
        .unwrap();
    db.record_bill_payment(&o.id, o.revision, &op, e.clone())
        .unwrap();
    let partial = row(&mut db, &id);
    assert_eq!(partial.paid_cents, 6000);
    assert_eq!(partial.remaining_cents, 4000);
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 1);
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 4200);
    let too_much = payment("41");
    assert!(db
        .record_bill_payment(
            &partial.id,
            partial.revision,
            &Uuid::new_v4().to_string(),
            too_much
        )
        .is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 1);
    db.record_bill_payment(
        &partial.id,
        partial.revision,
        &Uuid::new_v4().to_string(),
        payment("40"),
    )
    .unwrap();
    assert_eq!(row(&mut db, &id).remaining_cents, 0);
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 7000);
    let backup = db.backup().unwrap();
    drop(db);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(row(&mut db, &id).payments.len(), 2);
}
#[test]
fn combined_payment_allocations_never_duplicate_or_overallocate_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = schedule(&mut db, "Water", "40");
    let b = schedule(&mut db, "Rent fees", "60");
    let c = schedule(&mut db, "Other", "10");
    let e = payment("100");
    db.save(e.clone()).unwrap();
    let first = row(&mut db, &a);
    db.link_bill_payment(link(&first, &e, "40")).unwrap();
    let second = row(&mut db, &b);
    assert_eq!(
        db.bill_candidates(&second.id, false).unwrap()[0].available_cents,
        6000
    );
    db.link_bill_payment(link(&second, &e, "60")).unwrap();
    assert_eq!(row(&mut db, &a).remaining_cents, 0);
    assert_eq!(row(&mut db, &b).remaining_cents, 0);
    let third = row(&mut db, &c);
    assert!(db.link_bill_payment(link(&third, &e, "1")).is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 1);
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 7000);
    assert!(db.delete(&e.id, 1).is_err());
    let mut edited = e.clone();
    edited.revision = 1;
    edited.amount = "110".into();
    assert!(db.save(edited).is_err());
    let mut description = e.clone();
    description.revision = 1;
    description.description = "Utility corrected name".into();
    db.save(description).unwrap();
    let first = row(&mut db, &a);
    db.unlink_bill_payment(&first.id, first.revision, &first.payments[0].id)
        .unwrap();
    let second = row(&mut db, &b);
    db.unlink_bill_payment(&second.id, second.revision, &second.payments[0].id)
        .unwrap();
    db.delete(&e.id, 2).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 0);
}
#[test]
fn actual_corrections_cancellations_and_wrong_payers_preserve_existing_money() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = schedule(&mut db, "Utility", "100");
    let o = row(&mut db, &id);
    let mut wrong = payment("10");
    wrong.payer = "chelsea".into();
    wrong.account_id = None;
    assert!(db
        .record_bill_payment(&o.id, o.revision, &Uuid::new_v4().to_string(), wrong)
        .is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 0);
    db.record_bill_payment(
        &o.id,
        o.revision,
        &Uuid::new_v4().to_string(),
        payment("60"),
    )
    .unwrap();
    let o = row(&mut db, &id);
    assert!(db
        .save_bill_occurrence(update(&o, Some("59"), false))
        .is_err());
    assert!(db.save_bill_occurrence(update(&o, None, true)).is_err());
    db.save_bill_occurrence(update(&o, Some("80"), false))
        .unwrap();
    assert_eq!(row(&mut db, &id).remaining_cents, 2000);
    let o = row(&mut db, &id);
    db.unlink_bill_payment(&o.id, o.revision, &o.payments[0].id)
        .unwrap();
    let o = row(&mut db, &id);
    db.save_bill_occurrence(update(&o, None, true)).unwrap();
    assert!(row(&mut db, &id).cancelled);
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 4200);
}
#[test]
fn chelsea_paid_bill_updates_shares_without_jacob_account_activity() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = Uuid::new_v4().to_string();
    let mut p = draft("Chelsea utility", "48");
    p.details.payer = "chelsea".into();
    p.details.account_id = None;
    db.save_bill_template(&id, 0, "2026-11-01", 1, None, false, p)
        .unwrap();
    let o = row(&mut db, &id);
    let mut e = payment("48");
    e.payer = "chelsea".into();
    e.account_id = None;
    db.record_bill_payment(&o.id, o.revision, &Uuid::new_v4().to_string(), e)
        .unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(s.spent_cents, 3360);
    assert_eq!(s.household_cents, -3360);
    assert!(s.accounts.iter().all(|a| a.activity_cents == 0));
}
#[test]
fn imported_payment_links_existing_bill_payment_and_refund_does_not_invent_a_new_obligation() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = schedule(&mut db, "Utility", "100");
    let o = row(&mut db, &id);
    let e = payment("100");
    db.record_bill_payment(&o.id, o.revision, &Uuid::new_v4().to_string(), e.clone())
        .unwrap();
    let bytes = b"Date,Description,Amount\n2026-11-01,Utility,100\n";
    let prepared = parse::prepare("card.csv", bytes, None).unwrap();
    let source = db.ingest("card.csv", bytes.to_vec(), prepared).unwrap();
    let d = db.import_detail(&source).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(&source, 1, "amex", m).unwrap();
    let d = db.import_detail(&source).unwrap();
    assert_eq!(d.rows[0].matches[0].id, e.id);
    db.commit_import(
        &source,
        d.source.revision,
        &Uuid::new_v4().to_string(),
        vec![Decision {
            row_id: d.rows[0].id.clone(),
            action: "link".into(),
            input: None,
            match_id: Some(e.id.clone()),
            match_revision: Some(1),
            confirmed: true,
            separate: false,
            rule_signature: None,
        }],
    )
    .unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 7000);
    let mut r = e.clone();
    r.id = Uuid::new_v4().to_string();
    r.kind = "refund".into();
    r.original_event_id = Some(e.id.clone());
    r.amount = "20".into();
    db.save(r).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 5600);
    assert_eq!(row(&mut db, &id).remaining_cents, 0);
}
#[test]
fn bill_evidence_does_not_post_expenses_and_recovery_rejects_bad_allocations() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = schedule(&mut db, "Utility", "100");
    let o = row(&mut db, &id);
    let bytes = b"%PDF-1.4\nSynthetic invoice evidence\n%%EOF";
    let p = parse::prepare("invoice.pdf", bytes, None).unwrap();
    let source = db.ingest("invoice.pdf", bytes.to_vec(), p).unwrap();
    db.bill_evidence(&o.id, o.revision, &source, false).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 0);
    assert_eq!(row(&mut db, &id).evidence.len(), 1);
    let o = row(&mut db, &id);
    db.record_bill_payment(
        &o.id,
        o.revision,
        &Uuid::new_v4().to_string(),
        payment("50"),
    )
    .unwrap();
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(row(&mut db, &id).paid_cents, 5000);
    assert_eq!(row(&mut db, &id).evidence.len(), 1);
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    conn.execute("UPDATE bill_payments SET amount_cents=6000", [])
        .unwrap();
    drop(conn);
    assert!(db.restore(&backup).is_err());
    assert_eq!(row(&mut db, &id).paid_cents, 5000);
}
#[test]
fn version_five_upgrade_preserves_refunds_and_restores_the_legacy_backup() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = payment("100");
    db.save(e.clone()).unwrap();
    let mut r = e.clone();
    r.id = Uuid::new_v4().to_string();
    r.kind = "refund".into();
    r.original_event_id = Some(e.id);
    r.amount = "25".into();
    db.save(r).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_identity_schema(&conn);
    conn.execute_batch("DROP TABLE paypal_allocations; DROP TABLE paypal_cashouts; DROP TABLE household_opening; DROP TABLE balance_checkpoints; ALTER TABLE accounts DROP COLUMN tracking_mode; DROP TABLE event_lines; DROP TABLE bill_evidence;DROP TABLE bill_receipts;DROP TABLE bill_payments;DROP TABLE bill_occurrences;DROP TABLE bill_templates;PRAGMA user_version=5;").unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 5250);
    assert!(db.bill_templates().unwrap().is_empty());
    let backup = db
        .list_backups()
        .unwrap()
        .into_iter()
        .find(|name| {
            let conn =
                rusqlite::Connection::open(dir.path().join("backups/personal").join(name)).unwrap();
            conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap()
                == 5
        })
        .unwrap();
    db.restore(&backup).unwrap();
    assert!(db.bill_month("2026-11").unwrap().is_empty());
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 5250);
}

#[test]
fn imported_expense_undo_requires_unlinking_bills_and_link_retries_are_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let bytes = b"Date,Description,Amount\n2026-11-01,Utility,100\n";
    let prepared = parse::prepare("card.csv", bytes, None).unwrap();
    let source = db.ingest("card.csv", bytes.to_vec(), prepared).unwrap();
    let d = db.import_detail(&source).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(&source, d.source.revision, "amex", m)
        .unwrap();
    let d = db.import_detail(&source).unwrap();
    let mut e = payment("100");
    e.id = d.rows[0].id.clone();
    let operation = Uuid::new_v4().to_string();
    db.commit_import(
        &source,
        d.source.revision,
        &operation,
        vec![Decision {
            row_id: e.id.clone(),
            action: "add".into(),
            input: Some(e.clone()),
            match_id: None,
            match_revision: None,
            confirmed: true,
            separate: false,
            rule_signature: None,
        }],
    )
    .unwrap();
    let id = schedule(&mut db, "Utility", "100");
    let o = row(&mut db, &id);
    let input = link(&o, &e, "100");
    let same = LinkInput {
        id: input.id.clone(),
        ..link(&o, &e, "100")
    };
    db.link_bill_payment(input).unwrap();
    db.link_bill_payment(same).unwrap();
    assert_eq!(row(&mut db, &id).payments.len(), 1);
    assert!(db.undo_import(&operation).unwrap_err().contains("bill"));
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 7000);
    let o = row(&mut db, &id);
    db.unlink_bill_payment(&o.id, o.revision, &o.payments[0].id)
        .unwrap();
    db.undo_import(&operation).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 0);
    assert_eq!(row(&mut db, &id).remaining_cents, 10000);
}
