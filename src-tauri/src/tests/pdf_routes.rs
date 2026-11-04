use super::pdf_documents::{apply, approve, bill, ingest, request, setup_card};
use super::*;
use crate::{
    db::{pdf_documents::Sample, pdf_routes::Input},
    imports::parse,
};
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn variant(kind: &str, changes: &[(&str, &str)]) -> Vec<u8> {
    let original: &[u8] = if kind == "bill" {
        include_bytes!("../../fixtures/pdf/bill.pdf")
    } else {
        include_bytes!("../../fixtures/pdf/statement.pdf")
    };
    let mut doc = lopdf::Document::load_mem(original).unwrap();
    for (_, id) in doc.get_pages() {
        let mut content = lopdf::content::Content::decode(&doc.get_page_content(id)).unwrap();
        for operation in &mut content.operations {
            for operand in &mut operation.operands {
                if let lopdf::Object::String(bytes, _) = operand {
                    let mut text = String::from_utf8(bytes.clone()).unwrap();
                    for (from, to) in changes {
                        text = text.replace(from, to);
                    }
                    *bytes = text.into_bytes();
                }
            }
        }
        doc.change_page_content(id, content.encode().unwrap())
            .unwrap();
    }
    // Each synthetic export has a different fingerprint, even if values match.
    doc.trailer
        .set("SyntheticExport", lopdf::Object::string_literal(op()));
    let mut bytes = vec![];
    doc.save_to(&mut bytes).unwrap();
    bytes
}
fn add(db: &mut Store, bytes: Vec<u8>) -> String {
    let p = parse::prepare("next.pdf", &bytes, None).unwrap();
    assert!(p.error.is_empty(), "{}", p.error);
    db.ingest("next.pdf", bytes, p).unwrap()
}
fn next_bill() -> Vec<u8> {
    variant(
        "bill",
        &[
            ("10/20/2026", "11/20/2026"),
            ("11/05/2026", "12/05/2026"),
            ("80.00", "90.00"),
            ("86.00", "96.00"),
        ],
    )
}
fn input(db: &Store, source: &str, revision: i64, enabled: bool) -> Input {
    let application_id = db.pdf_document(source).unwrap().applied.unwrap().id;
    let marker = db
        .pdf_route_view(&application_id)
        .unwrap()
        .suggested_marker
        .unwrap();
    Input {
        application_id,
        revision,
        marker,
        enabled,
        confirmed: true,
    }
}
fn setup(db: &mut Store) -> (String, Sample) {
    let id = ingest(db, "bill");
    let s = approve(db, &id, "bill");
    let o = bill(db, "2026-11");
    apply(db, request(db, &s, &o.id, ""));
    db.configure_pdf_route(&op(), input(db, &id, 0, true))
        .unwrap();
    (id, s)
}
fn held(db: &Store, id: &str, text: &str) {
    let d = db.import_detail(id).unwrap();
    assert!(
        d.dataset.notes.iter().any(|n| n.contains(text)),
        "{:?}",
        d.dataset.notes
    );
    assert!(db.pdf_document(id).unwrap().applied.is_none());
}
#[test]
fn approved_bill_destination_updates_next_month_without_spending_and_survives_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (id, _) = setup(&mut db);
    let bytes = next_bill();
    let next = add(&mut db, bytes.clone());
    let b = db.bill_month("2026-12").unwrap().remove(0);
    assert_eq!(b.actual_cents, Some(9600));
    assert_eq!(b.due_date, "2026-12-05");
    assert_eq!(b.paid_cents, 0);
    assert_eq!(b.evidence.len(), 1);
    assert_eq!(add(&mut db, bytes), next);
    assert!(db.snapshot("2026-12").unwrap().entries.is_empty());
    assert!(db.pdf_document(&next).unwrap().applied.is_some());
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    drop(db);
    let db = Store::open(dir.path(), "personal").unwrap();
    assert!(
        db.pdf_route_view(&input(&db, &id, 1, true).application_id)
            .unwrap()
            .route
            .unwrap()
            .enabled
    );
    assert!(Store::open(dir.path(), "demo")
        .unwrap()
        .pdf_document(&next)
        .is_err());
}
#[test]
fn route_opt_in_marker_pause_revision_and_retry_controls_are_enforced() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (id, _) = setup(&mut db);
    let mut i = input(&db, &id, 1, true);
    i.confirmed = false;
    assert!(db.configure_pdf_route(&op(), i).is_err());
    for text in [
        "Currency: USD",
        "Amount due: $86.00",
        "SYNTHETIC UTILITY",
        "Account: WRONG-9999",
    ] {
        let mut i = input(&db, &id, 1, true);
        i.marker.text = text.into();
        assert!(db.configure_pdf_route(&op(), i).is_err(), "{text}");
    }
    let operation = op();
    for _ in 0..2 {
        db.configure_pdf_route(&operation, input(&db, &id, 1, false))
            .unwrap();
    }
    assert!(db
        .configure_pdf_route(&operation, input(&db, &id, 1, true))
        .is_err());
    let next = add(&mut db, next_bill());
    assert!(db.pdf_document(&next).unwrap().applied.is_none());
    assert!(db
        .configure_pdf_route(&op(), input(&db, &id, 1, true))
        .is_err());
    db.configure_pdf_route(&op(), input(&db, &id, 2, true))
        .unwrap();
    let wrong = add(&mut db, variant("bill", &[("TEST-1234", "TEST-9999")]));
    assert!(db.pdf_document(&wrong).unwrap().applied.is_none());
    let next = add(&mut db, next_bill());
    assert!(db.pdf_document(&next).unwrap().applied.is_some());
}
#[test]
fn conflicting_manual_due_date_is_not_overwritten_by_automatic_bill_update() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    let o = db.bill_month("2026-12").unwrap().remove(0);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute(
        "UPDATE bill_occurrences SET due_date='2026-12-04' WHERE id=?1",
        [&o.id],
    )
    .unwrap();
    drop(c);
    let next = add(&mut db, next_bill());
    held(&db, &next, "confirmed");
    assert_eq!(db.bill_month("2026-12").unwrap()[0].due_date, "2026-12-04");
}
#[test]
fn bill_conflicts_layout_drift_and_atomic_failure_hold_evidence_without_partial_updates() {
    for (sql, reason) in [
        ("UPDATE bill_occurrences SET actual_cents=9800 WHERE period='2026-12'", "confirmed"),
        ("UPDATE bill_occurrences SET cancelled=1 WHERE period='2026-12'", "cancelled"),
        ("UPDATE bill_templates SET archived=1", "archived"),
        ("CREATE TRIGGER fail_auto BEFORE INSERT ON pdf_receipts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;", "synthetic failure"),
    ] {
        let dir = tempfile::tempdir().unwrap(); let mut db = Store::open(dir.path(), "personal").unwrap(); setup(&mut db);
        if !sql.contains("TRIGGER") { db.bill_month("2026-12").unwrap(); }
        let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap(); c.execute_batch(sql).unwrap();
        let next = add(&mut db, next_bill()); held(&db, &next, reason);
        assert_eq!(db.import_detail(&next).unwrap().source.revision, 1);
        assert!(db.snapshot("2026-12").unwrap().entries.is_empty());
        if sql.contains("TRIGGER") {
            let count: i64 = c.query_row("SELECT count(*) FROM bill_occurrences WHERE period='2026-12'", [], |r| r.get(0)).unwrap();
            assert_eq!(count, 0); c.execute_batch("DROP TRIGGER fail_auto").unwrap();
            let next = add(&mut db, next_bill()); assert!(db.pdf_document(&next).unwrap().applied.is_some());
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup(&mut db);
    let drift = ingest(&mut db, "drift");
    held(&db, &drift, "positions changed");
    let due = add(&mut db, variant("bill", &[("11/05/2026", "12/25/2026")]));
    held(&db, &due, "seven days");
    let bad_sum = add(&mut db, variant("bill", &[("86.00", "95.00")]));
    held(&db, &bad_sum, "arithmetic");
}
#[test]
fn automatic_statement_requires_exact_complete_calculation_and_preserves_account() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup_card(&mut db);
    let id = ingest(&mut db, "statement");
    let sample = approve(&mut db, &id, "statement");
    let r = request(&db, &sample, "amex", "2026-10");
    apply(&mut db, r);
    db.configure_pdf_route(&op(), input(&db, &id, 0, true))
        .unwrap();
    let incomplete = add(&mut db, variant("statement", &[]));
    held(&db, &incomplete, "incomplete");
    db.save_checkpoint(crate::db::balances::CheckpointInput {
        id: op(),
        revision: 0,
        account_id: "amex".into(),
        date: "2026-10-20".into(),
        amount: "126".into(),
        purpose: "confirmed".into(),
        note: "Synthetic cutoff".into(),
    })
    .unwrap();
    let next = add(&mut db, variant("statement", &[]));
    assert!(db.pdf_document(&next).unwrap().applied.is_some());
    assert_eq!(
        db.import_detail(&next)
            .unwrap()
            .source
            .account_id
            .as_deref(),
        Some("amex")
    );
    let d = db.import_detail(&next).unwrap();
    assert!(db
        .configure_import(&next, d.source.revision, "citi", d.mapping)
        .is_err());
    let conflict = add(
        &mut db,
        variant("statement", &[("126.00", "136.00"), ("86.00", "96.00")]),
    );
    held(&db, &conflict, "confirmed issuer");
    assert_eq!(
        db.card_statement_month("2026-10").unwrap().statements[0].confirmed_balance_cents,
        Some(12600)
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
}
#[test]
fn changed_template_requires_new_approval_and_restore_rejects_forged_destination() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (id, mut s) = setup(&mut db);
    for sql in [
        "UPDATE pdf_routes SET target_id='missing'",
        "UPDATE pdf_routes SET marker_json='{\"page\":1,\"text\":\"wrong123\"}'",
        "UPDATE pdf_route_receipts SET payload_hash='bad'",
    ] {
        let backup = db.backup().unwrap();
        let c =
            rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
        c.execute_batch(sql).unwrap();
        drop(c);
        assert!(db.restore(&backup).is_err(), "{sql}");
        assert_eq!(
            db.bill_month("2026-11").unwrap()[0].actual_cents,
            Some(8600)
        );
    }
    s.revision = 1;
    s.source_revision = db.import_detail(&id).unwrap().source.revision;
    s.definition.name = "Revised layout".into();
    let p = db.preview_pdf_template(s.clone()).unwrap();
    db.approve_pdf_template(
        &op(),
        crate::db::pdf_documents::Approval {
            input: s,
            token: p.token,
            confirmed: true,
        },
    )
    .unwrap();
    let next = add(&mut db, next_bill());
    held(&db, &next, "version changed");
    assert!(db
        .configure_pdf_route(&op(), input(&db, &id, 1, true))
        .is_err());
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
}
#[test]
fn schema29_upgrade_preserves_existing_pdf_evidence() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "bill");
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    super::remove_pdf_routes_schema(&c);
    c.pragma_update(None, "user_version", 29).unwrap();
    drop(c);
    let db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.pdf_document(&id).unwrap().pages.len(), 1);
}

fn combined_statement() -> Vec<u8> {
    use lopdf::{content::Operation, Object};
    let bytes = variant("statement", &[]);
    let mut doc = lopdf::Document::load_mem(&bytes).unwrap();
    let id = *doc.get_pages().values().next().unwrap();
    let mut content = lopdf::content::Content::decode(&doc.get_page_content(id)).unwrap();
    content.operations.extend([
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), 10.into()]),
        Operation::new("Td", vec![48.into(), 300.into()]),
        Operation::new("TL", vec![16.into()]),
    ]);
    for line in [
        "Transactions",
        "10/01/2026 | Market | 86.00",
        "End transactions",
    ] {
        content
            .operations
            .push(Operation::new("Tj", vec![Object::string_literal(line)]));
        content.operations.push(Operation::new("T*", vec![]));
    }
    content.operations.push(Operation::new("ET", vec![]));
    doc.change_page_content(id, content.encode().unwrap())
        .unwrap();
    let mut bytes = vec![];
    doc.save_to(&mut bytes).unwrap();
    bytes
}
#[test]
fn one_pdf_can_stage_activity_and_update_statement_without_changing_account_or_evidence() {
    use crate::db::pdf_tables::{Request, Save};
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup_card(&mut db);
    db.save_checkpoint(crate::db::balances::CheckpointInput {
        id: op(),
        revision: 0,
        account_id: "amex".into(),
        date: "2026-10-20".into(),
        amount: "126".into(),
        purpose: "confirmed".into(),
        note: "Synthetic cutoff".into(),
    })
    .unwrap();
    let id = add(&mut db, combined_statement());
    let sample = approve(&mut db, &id, "statement");
    let r = Request {
        source_id: id.clone(),
        source_revision: 1,
        template_id: op(),
        template_revision: 0,
        definition: Some(crate::imports::pdf_table::Definition {
            name: "Card rows".into(),
            identity: "SYNTHETIC CARD".into(),
            currency: "Currency: USD".into(),
            start: "Transactions".into(),
            end: "End transactions".into(),
            headers: vec!["Date".into(), "Description".into(), "Amount".into()],
            separator: "pipe".into(),
            automatic: true,
        }),
    };
    let p = db.preview_pdf_table(r.clone()).unwrap();
    db.save_pdf_table(
        &op(),
        Save {
            request: r,
            token: p.token,
            confirmed: true,
        },
    )
    .unwrap();
    let req = request(&db, &sample, "amex", "2026-10");
    apply(&mut db, req);
    db.configure_pdf_route(&op(), input(&db, &id, 0, true))
        .unwrap();
    let bytes = combined_statement();
    let next = add(&mut db, bytes.clone());
    assert!(db.pdf_document(&next).unwrap().applied.is_some());
    let d = db.import_detail(&next).unwrap();
    assert_eq!(d.rows.len(), 1);
    let mut mapping = d.mapping;
    mapping.amount_mode = "outflow_positive".into();
    mapping.posted_confirmed = true;
    db.configure_import(&next, d.source.revision, "amex", mapping)
        .unwrap();
    let d = db.import_detail(&next).unwrap();
    assert_eq!(d.rows[0].raw[2], "86.00");
    assert!(db
        .configure_import(&next, d.source.revision, "citi", d.mapping)
        .is_err());
    let p = parse::prepare("same.pdf", &bytes, None).unwrap();
    assert!(db.import_sheet(&next, d.source.revision, p).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
    assert_eq!(db.import_detail(&next).unwrap().rows.len(), 1);
}

#[test]
fn competing_approved_destinations_hold_for_manual_choice() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (first, _) = setup(&mut db);
    db.configure_pdf_route(&op(), input(&db, &first, 1, false))
        .unwrap();
    let other = add(&mut db, variant("bill", &[]));
    let s = approve(&mut db, &other, "bill");
    let b = bill(&mut db, "2026-11");
    let r = request(&db, &s, &b.id, "");
    apply(&mut db, r);
    db.configure_pdf_route(&op(), input(&db, &other, 0, true))
        .unwrap();
    db.configure_pdf_route(&op(), input(&db, &first, 2, true))
        .unwrap();
    let next = add(&mut db, next_bill());
    held(&db, &next, "Multiple approved destinations");
    assert!(db
        .bill_month("2026-12")
        .unwrap()
        .iter()
        .all(|b| b.actual_cents.is_none()));
}
