use super::*;
use crate::{
    db::pdf_documents::*,
    imports::{parse, pdf},
};
fn op() -> String {
    Uuid::new_v4().to_string()
}
pub(super) fn definition(kind: &str) -> pdf::Definition {
    let fields = if kind == "bill" {
        vec![
            ("amount_due", "Amount due"),
            ("due_date", "Due date"),
            ("invoice_date", "Invoice date"),
            ("subtotal", "Subtotal"),
            ("tax", "Tax"),
            ("fees", "Fees"),
        ]
    } else {
        vec![
            ("statement_balance", "Statement balance"),
            ("closing_date", "Closing date"),
            ("due_date", "Due date"),
            ("minimum_due", "Minimum due"),
            ("previous_balance", "Previous balance"),
            ("payments", "Payments"),
            ("purchases", "Purchases"),
        ]
    };
    pdf::Definition {
        name: format!("Synthetic {kind}"),
        kind: kind.into(),
        page_count: 1,
        identity: pdf::Anchor {
            page: 1,
            text: if kind == "bill" {
                "SYNTHETIC UTILITY"
            } else {
                "SYNTHETIC CARD"
            }
            .into(),
        },
        currency: pdf::Anchor {
            page: 1,
            text: "Currency: USD".into(),
        },
        fields: fields
            .into_iter()
            .map(|(key, label)| pdf::Field {
                key: key.into(),
                page: 1,
                label: label.into(),
                placement: "inline".into(),
                date_format: "mdy".into(),
            })
            .collect(),
        sum_parts: if kind == "bill" {
            vec![("subtotal", 1), ("tax", 1), ("fees", 1)]
        } else {
            vec![("previous_balance", 1), ("payments", -1), ("purchases", 1)]
        }
        .into_iter()
        .map(|(key, sign)| pdf::Part {
            key: key.into(),
            sign,
        })
        .collect(),
    }
}
pub(super) fn ingest(db: &mut Store, kind: &str) -> String {
    let bytes: &[u8] = match kind {
        "bill" => include_bytes!("../../fixtures/pdf/bill.pdf"),
        "statement" => include_bytes!("../../fixtures/pdf/statement.pdf"),
        _ => include_bytes!("../../fixtures/pdf/drift.pdf"),
    };
    let p = parse::prepare("synthetic.pdf", bytes, None).unwrap();
    assert!(p.error.is_empty(), "{}", p.error);
    db.ingest("synthetic.pdf", bytes.to_vec(), p).unwrap()
}
pub(super) fn approve(db: &mut Store, id: &str, kind: &str) -> Sample {
    let i = Sample {
        source_id: id.into(),
        source_revision: db.import_detail(id).unwrap().source.revision,
        id: op(),
        revision: 0,
        definition: definition(kind),
    };
    let r = db.preview_pdf_template(i.clone()).unwrap();
    assert!(r.extraction.errors.is_empty(), "{:?}", r.extraction.errors);
    db.approve_pdf_template(
        &op(),
        Approval {
            input: i.clone(),
            token: r.token,
            confirmed: true,
        },
    )
    .unwrap();
    i
}
#[test]
fn local_pdf_sample_extracts_money_dates_and_arithmetic_with_page_text_evidence() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "bill");
    let i = approve(&mut db, &id, "bill");
    let view = db.pdf_document(&id).unwrap();
    assert_eq!(view.templates[0].revision, 1);
    assert_eq!(view.pages[0].lines[0], "SYNTHETIC UTILITY");
    let e = pdf::evaluate(&i.definition, &view.pages, Some(&view.templates[0].layout)).unwrap();
    assert_eq!(e.cents("amount_due"), Some(8600));
    assert_eq!(e.date("due_date"), Some("2026-11-05"));
    assert_eq!(
        e.values
            .iter()
            .find(|v| v.key == "amount_due")
            .unwrap()
            .line,
        9
    );
    let path = db
        .export_original_pdf(&dir.path().join("exports"), &id)
        .unwrap();
    assert_eq!(
        std::fs::read(&path).unwrap(),
        include_bytes!("../../fixtures/pdf/bill.pdf")
    );
    assert_eq!(
        db.export_original_pdf(&dir.path().join("exports"), &id)
            .unwrap(),
        path
    );
    let statement = ingest(&mut db, "statement");
    approve(&mut db, &statement, "statement");
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
}

pub(super) fn bill(db: &mut Store, month: &str) -> crate::db::bills::Occurrence {
    db.save_bill_template(
        &op(),
        0,
        &format!("{month}-02"),
        1,
        None,
        false,
        super::bills::draft("Synthetic utility", "100"),
    )
    .unwrap();
    db.bill_month(month).unwrap().remove(0)
}
pub(super) fn request(db: &Store, sample: &Sample, target: &str, month: &str) -> Request {
    Request {
        source_id: sample.source_id.clone(),
        source_revision: db.import_detail(&sample.source_id).unwrap().source.revision,
        template_id: sample.id.clone(),
        template_revision: sample.revision + 1,
        target_id: target.into(),
        month: month.into(),
        note: "Checked synthetic original PDF and target".into(),
    }
}
pub(super) fn apply(db: &mut Store, input: Request) {
    let r = db.preview_pdf_application(input.clone()).unwrap();
    db.apply_pdf_application(
        &op(),
        Apply {
            input,
            token: r.token,
            confirmed: true,
        },
    )
    .unwrap();
}
pub(super) fn setup_card(db: &mut Store) {
    db.save_card_statement_config(
        &op(),
        crate::db::card_statements::Config {
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
#[test]
fn minimum_abbreviations_cannot_be_mapped_as_statement_or_bill_total() {
    for kind in ["statement", "bill"] {
        for label in [
            "Minimum payment due",
            "Min due",
            "Min. Payment",
            "MINIMUM DUE",
        ] {
            let mut d = definition(kind);
            d.fields[0].label = label.into();
            assert!(pdf::validate_definition(&d).is_err(), "{label}");
        }
    }
}
#[test]
fn malformed_ambiguous_missing_drift_and_arithmetic_pdf_values_require_review() {
    let pages = pdf::extract(include_bytes!("../../fixtures/pdf/bill.pdf"))
        .unwrap()
        .pdf_pages;
    let d = definition("bill");
    let valid = pdf::evaluate(&d, &pages, None).unwrap();
    for (index, text) in [
        (8, "Amount due: $86.01"),
        (8, "Amount due: $8,6.00"),
        (8, "Amount due: $86.00 CR"),
        (8, "Amount due: -$86.00"),
        (4, "Due date: 02/30/2026"),
        (4, "Due date: 11/05/26"),
        (1, "Currency: CAD"),
        (0, "Different supplier"),
    ] {
        let mut p = pages.clone();
        p[0].lines[index] = text.into();
        assert!(
            !pdf::evaluate(&d, &p, Some(&valid.layout))
                .unwrap()
                .errors
                .is_empty(),
            "{text}"
        );
    }
    let mut duplicate = pages.clone();
    duplicate[0].lines.push("Amount due: $86.00".into());
    assert!(!pdf::evaluate(&d, &duplicate, None)
        .unwrap()
        .errors
        .is_empty());
    let drift = pdf::extract(include_bytes!("../../fixtures/pdf/drift.pdf"))
        .unwrap()
        .pdf_pages;
    assert!(pdf::evaluate(&d, &drift, Some(&valid.layout))
        .unwrap()
        .errors
        .iter()
        .any(|e| e.contains("positions")));
    assert!(pdf::evaluate(&d, &drift, None).unwrap().errors.is_empty());
    assert!(pdf::extract(b"%PDF-broken").is_err());
    assert!(pdf::extract(b"not a PDF").is_err());
    let bad = parse::prepare("broken.pdf", b"%PDF-broken", None).unwrap();
    assert!(!bad.error.is_empty());
    assert!(bad.dataset.pdf_pages.is_empty());
    let mut oversized = pages.clone();
    oversized[0].lines[0] = "x".repeat(4001);
    assert!(pdf::validate_pages(&oversized).is_err());
}
#[test]
fn next_line_and_selected_date_format_are_explicit_and_credit_balances_stay_signed() {
    let mut pages = pdf::extract(include_bytes!("../../fixtures/pdf/bill.pdf"))
        .unwrap()
        .pdf_pages;
    let mut d = definition("bill");
    d.fields[0].placement = "next_line".into();
    pages[0].lines[8] = "Amount due:".into();
    pages[0].lines.insert(9, "$86.00".into());
    d.fields
        .iter_mut()
        .find(|f| f.key == "due_date")
        .unwrap()
        .date_format = "dmy".into();
    pages[0].lines[4] = "Due date: 05/11/2026".into();
    let e = pdf::evaluate(&d, &pages, None).unwrap();
    assert!(e.errors.is_empty(), "{:?}", e.errors);
    assert_eq!(e.date("due_date"), Some("2026-11-05"));
    assert_eq!(e.values[0].line, 10);
    let mut d = definition("statement");
    d.sum_parts.clear();
    let mut p = pdf::extract(include_bytes!("../../fixtures/pdf/statement.pdf"))
        .unwrap()
        .pdf_pages;
    p[0].lines[8] = "Statement balance: -$12.34".into();
    let e = pdf::evaluate(&d, &p, None).unwrap();
    assert!(e.errors.is_empty());
    assert_eq!(e.cents("statement_balance"), Some(-1234));
}
#[test]
fn bill_pdf_updates_one_obligation_without_spending_retries_or_duplicate_observations() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "bill");
    let sample = approve(&mut db, &id, "bill");
    let o = bill(&mut db, "2026-11");
    let i = request(&db, &sample, &o.id, "");
    let r = db.preview_pdf_application(i.clone()).unwrap();
    assert_eq!(r.new_amount_cents, 8600);
    assert_eq!(r.prior_amount_cents, None);
    let operation = op();
    for _ in 0..2 {
        db.apply_pdf_application(
            &operation,
            Apply {
                input: i.clone(),
                token: r.token.clone(),
                confirmed: true,
            },
        )
        .unwrap();
    }
    let now = db.bill_month("2026-11").unwrap().remove(0);
    assert_eq!(now.actual_cents, Some(8600));
    assert_eq!(now.due_date, "2026-11-05");
    assert_eq!(now.paid_cents, 0);
    assert_eq!(now.remaining_cents, 8600);
    assert_eq!(now.evidence.len(), 1);
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
    assert!(db.pdf_document(&id).unwrap().applied.is_some());
    let revision = db.import_detail(&id).unwrap().source.revision;
    let other = db.new_import_observation(&id, revision, &op()).unwrap();
    let mut duplicate = request(&db, &sample, &o.id, "");
    duplicate.source_id = other.clone();
    duplicate.source_revision = db.import_detail(&other).unwrap().source.revision;
    assert!(db
        .preview_pdf_application(duplicate)
        .err()
        .unwrap()
        .contains("already applied"));
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    drop(db);
    let db = Store::open(dir.path(), "personal").unwrap();
    assert!(db.pdf_document(&id).unwrap().applied.is_some());
    let demo = Store::open(dir.path(), "demo").unwrap();
    assert!(demo.pdf_document(&id).is_err());
}
#[test]
fn stale_bill_review_partial_payment_and_failed_receipt_leave_no_partial_pdf_application() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "bill");
    let sample = approve(&mut db, &id, "bill");
    let o = bill(&mut db, "2026-11");
    let i = request(&db, &sample, &o.id, "");
    let r = db.preview_pdf_application(i.clone()).unwrap();
    let mut e = expense("90", "jacob");
    e.date = "2026-11-01".into();
    e.category_id = Some("home".into());
    db.save(e.clone()).unwrap();
    db.link_bill_payment(crate::db::bills::LinkInput {
        id: op(),
        occurrence_id: o.id.clone(),
        revision: o.revision,
        event_id: e.id.clone(),
        event_revision: 1,
        amount: "90".into(),
    })
    .unwrap();
    let failed = db
        .apply_pdf_application(
            &op(),
            Apply {
                input: i.clone(),
                token: r.token,
                confirmed: true,
            },
        )
        .unwrap_err();
    assert!(failed.contains("below linked"), "{failed}");
    let now = db.bill_month("2026-11").unwrap().remove(0);
    db.unlink_bill_payment(&o.id, now.revision, &now.payments[0].id)
        .unwrap();
    let r = db.preview_pdf_application(i.clone()).unwrap();
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_pdf BEFORE INSERT ON pdf_receipts BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END;").unwrap();
    assert!(db
        .apply_pdf_application(
            &op(),
            Apply {
                input: i.clone(),
                token: r.token.clone(),
                confirmed: true
            }
        )
        .is_err());
    assert!(db.pdf_document(&id).unwrap().applied.is_none());
    assert_eq!(
        db.import_detail(&id).unwrap().source.revision,
        i.source_revision
    );
    assert_eq!(db.bill_month("2026-11").unwrap()[0].actual_cents, None);
    conn.execute_batch("DROP TRIGGER fail_pdf;").unwrap();
    db.apply_pdf_application(
        &op(),
        Apply {
            input: i,
            token: r.token,
            confirmed: true,
        },
    )
    .unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().entries.len(), 1);
}
#[test]
fn template_versions_pause_stale_reviews_and_mapping_protection_preserve_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "bill");
    let mut sample = approve(&mut db, &id, "bill");
    let o = bill(&mut db, "2026-11");
    let i = request(&db, &sample, &o.id, "");
    db.set_pdf_template_enabled(&op(), &sample.id, 1, false)
        .unwrap();
    assert!(db.preview_pdf_application(i.clone()).is_err());
    db.set_pdf_template_enabled(&op(), &sample.id, 1, true)
        .unwrap();
    let r = db.preview_pdf_application(i.clone()).unwrap();
    sample.revision = 1;
    sample.definition.name = "Version two".into();
    let p = db.preview_pdf_template(sample.clone()).unwrap();
    db.approve_pdf_template(
        &op(),
        Approval {
            input: sample.clone(),
            token: p.token,
            confirmed: true,
        },
    )
    .unwrap();
    assert!(db
        .apply_pdf_application(
            &op(),
            Apply {
                input: i,
                token: r.token,
                confirmed: true
            }
        )
        .is_err());
    let prepared = parse::prepare(
        "bill.pdf",
        include_bytes!("../../fixtures/pdf/bill.pdf"),
        None,
    )
    .unwrap();
    assert!(db
        .import_sheet(&id, sample.source_revision, prepared)
        .is_err());
    let i = request(&db, &sample, &o.id, "");
    apply(&mut db, i);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(db.pdf_document(&id).unwrap().templates[0].revision, 2);
}
#[test]
fn statement_pdf_uses_existing_statement_review_and_preserves_payment_accounting() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup_card(&mut db);
    let id = ingest(&mut db, "statement");
    let sample = approve(&mut db, &id, "statement");
    let i = request(&db, &sample, "amex", "2026-10");
    apply(&mut db, i);
    let view = db.card_statement_month("2026-10").unwrap();
    let s = &view.statements[0];
    assert_eq!(s.confirmed_balance_cents, Some(12600));
    assert_eq!(s.draft.closing_date, "2026-10-20");
    assert_eq!(s.draft.due_date, "2026-11-15");
    assert_eq!(s.draft.evidence_source_id.as_deref(), Some(id.as_str()));
    assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
    super::card_payments::approve(&mut db, "2026-10");
    let p = super::card_payments::payment(&mut db, "2026-10-25", "126");
    super::card_payments::allocate(&mut db, &p.id, &[("2026-10", "126")]);
    assert_eq!(
        db.card_payment_view("amex").unwrap().obligations[0].remaining_cents,
        Some(0)
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
}
#[test]
fn reviewed_card_obligation_blocks_conflicting_pdf_balance() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup_card(&mut db);
    super::card_payments::statement(&mut db, "2026-10", "100");
    super::card_payments::approve(&mut db, "2026-10");
    let id = ingest(&mut db, "statement");
    let sample = approve(&mut db, &id, "statement");
    assert!(db
        .preview_pdf_application(request(&db, &sample, "amex", "2026-10"))
        .is_err());
    assert_eq!(
        db.card_statement_month("2026-10").unwrap().statements[0].confirmed_balance_cents,
        Some(10000)
    );
}
#[test]
fn restore_rejects_forged_pdf_text_application_values_and_missing_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "bill");
    let sample = approve(&mut db, &id, "bill");
    let o = bill(&mut db, "2026-11");
    apply(&mut db, request_placeholder(&sample, &o.id));
    for sql in ["UPDATE import_sources SET dataset_json=json_set(dataset_json,'$.pdfPages[0].lines[8]','Amount due: $999.00')", "UPDATE pdf_applications SET proof_json=json_set(proof_json,'$.newAmountCents',99900)","DELETE FROM pdf_receipts WHERE id IN (SELECT id FROM pdf_applications)"] {
        let backup=db.backup().unwrap();let c=rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();c.execute_batch(sql).unwrap();drop(c);
        assert!(db.restore(&backup).is_err(),"{sql}");assert_eq!(db.bill_month("2026-11").unwrap()[0].actual_cents,Some(8600));
    }
}
fn request_placeholder(sample: &Sample, target: &str) -> Request {
    Request {
        source_id: sample.source_id.clone(),
        source_revision: sample.source_revision,
        template_id: sample.id.clone(),
        template_revision: 1,
        target_id: target.into(),
        month: String::new(),
        note: "Verified synthetic bill".into(),
    }
}

#[test]
fn no_text_pdf_stays_evidence_and_schema27_upgrade_preserves_legacy_evidence_and_spending() {
    let mut doc = lopdf::Document::load_mem(include_bytes!("../../fixtures/pdf/bill.pdf")).unwrap();
    for id in doc.get_pages().values() {
        doc.get_object_mut(*id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .remove(b"Contents");
    }
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    let p = parse::prepare("scan.pdf", &bytes, None).unwrap();
    assert!(p.error.contains("No text layer"));
    assert!(p.dataset.pdf_pages.is_empty());
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let blank = db.ingest("scan.pdf", bytes, p).unwrap();
    assert!(db.pdf_document(&blank).unwrap().pages.is_empty());
    let id = ingest(&mut db, "bill");
    let mut e = expense("15", "jacob");
    e.date = "2026-10-10".into();
    db.save(e).unwrap();
    let before = db.snapshot("2026-10").unwrap().spent_cents;
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    super::remove_pdf_schema(&c);
    c.execute(
        "UPDATE import_sources SET dataset_json=json_remove(dataset_json,'$.pdfPages') WHERE id=?1",
        [&id],
    )
    .unwrap();
    c.pragma_update(None, "user_version", 27).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, before);
    assert!(db.pdf_document(&id).unwrap().pages.is_empty());
    let old = db.backup().unwrap();
    db.restore(&old).unwrap();
    let p = parse::prepare(
        "bill.pdf",
        include_bytes!("../../fixtures/pdf/bill.pdf"),
        None,
    )
    .unwrap();
    db.import_sheet(&id, db.import_detail(&id).unwrap().source.revision, p)
        .unwrap();
    approve(&mut db, &id, "bill");
}
#[test]
fn bill_payment_after_preview_requires_fresh_review_and_reduces_remaining_only_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "bill");
    let sample = approve(&mut db, &id, "bill");
    let o = bill(&mut db, "2026-11");
    let i = request(&db, &sample, &o.id, "");
    let old = db.preview_pdf_application(i.clone()).unwrap();
    let mut e = expense("10", "jacob");
    e.date = "2026-11-01".into();
    e.category_id = Some("home".into());
    db.save(e.clone()).unwrap();
    db.link_bill_payment(crate::db::bills::LinkInput {
        id: op(),
        occurrence_id: o.id.clone(),
        revision: o.revision,
        event_id: e.id,
        event_revision: 1,
        amount: "10".into(),
    })
    .unwrap();
    let err = db
        .apply_pdf_application(
            &op(),
            Apply {
                input: i.clone(),
                token: old.token,
                confirmed: true,
            },
        )
        .unwrap_err();
    assert!(err.contains("changed"), "{err}");
    apply(&mut db, i);
    let o = db.bill_month("2026-11").unwrap().remove(0);
    assert_eq!(o.remaining_cents, 7600);
    assert_eq!(o.paid_cents, 1000);
    assert_eq!(db.snapshot("2026-11").unwrap().entries.len(), 1);
}
#[test]
fn corrupted_pdf_statement_calculation_is_rejected_without_changing_issuer_balance() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    setup_card(&mut db);
    let id = ingest(&mut db, "statement");
    let sample = approve(&mut db, &id, "statement");
    let i = request(&db, &sample, "amex", "2026-10");
    apply(&mut db, i);
    let b = db.backup().unwrap();
    let c = rusqlite::Connection::open(dir.path().join("backups/personal").join(&b)).unwrap();
    c.execute_batch("UPDATE pdf_applications SET proof_json=json_set(proof_json,'$.calculation.balanceCents',12600);").unwrap();
    drop(c);
    assert!(db.restore(&b).is_err());
    assert_eq!(
        db.card_statement_month("2026-10").unwrap().statements[0].confirmed_balance_cents,
        Some(12600)
    );
}

#[test]
fn original_pdf_preview_returns_exact_bytes_and_rejects_other_workspaces_or_corrupt_evidence() {
    use base64::Engine;
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "bill");
    let original = db.pdf_original(&id).unwrap();
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(original)
            .unwrap(),
        include_bytes!("../../fixtures/pdf/bill.pdf")
    );
    assert!(Store::open(dir.path(), "demo")
        .unwrap()
        .pdf_original(&id)
        .is_err());
    let bytes = b"Date,Description,Amount\n2026-10-01,Market,1";
    let p = parse::prepare("table.csv", bytes, None).unwrap();
    let csv = db.ingest("table.csv", bytes.to_vec(), p).unwrap();
    assert!(db.pdf_original(&csv).is_err());
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute("UPDATE import_evidence SET content=?1 WHERE fingerprint=(SELECT fingerprint FROM import_sources WHERE id=?2)",rusqlite::params![b"%PDF-corrupt".to_vec(),id]).unwrap();
    assert!(db.pdf_original(&id).unwrap_err().contains("invalid"));
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
}
