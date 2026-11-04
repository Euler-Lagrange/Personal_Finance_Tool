use super::*;
use crate::{
    assistance::{
        proposal::{Evidence, Field},
        settings::Config,
    },
    db::{ai_documents::*, ai_jobs},
};
use serde_json::json;
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn fields(kind: &str) -> Vec<Field> {
    let pairs = if kind == "bill" {
        vec![
            ("amount_due", "86.00"),
            ("due_date", "2026-11-05"),
            ("subtotal", "80.00"),
            ("tax", "5.00"),
            ("fees", "1.00"),
        ]
    } else {
        vec![
            ("statement_balance", "126.00"),
            ("closing_date", "2026-10-20"),
            ("due_date", "2026-11-15"),
            ("previous_balance", "100.00"),
            ("payments", "50.00"),
            ("credits", "0.00"),
            ("purchases", "76.00"),
            ("fees", "0.00"),
            ("interest", "0.00"),
        ]
    };
    pairs
        .into_iter()
        .map(|(k, v)| Field {
            key: k.into(),
            value: Some(v.into()),
            evidence: Evidence {
                page: Some(1),
                quote: format!("{k}: {v}"),
            },
        })
        .collect()
}
fn job(db: &mut Store, source: &str, kind: &str) -> String {
    let config = Config {
        enabled: true,
        revision: 1,
        model: "synthetic-model".into(),
    };
    let input = ai_jobs::Input {
        source_id: source.into(),
        source_revision: db.import_detail(source).unwrap().source.revision,
        provider: "claude".into(),
        task: kind.into(),
        scope: "text".into(),
        text: "Synthetic document fixture".into(),
    };
    let token = db.ai_prepare(&input, &config).unwrap().token;
    let id = op();
    db.ai_begin(
        &ai_jobs::Start {
            id: id.clone(),
            input,
            token,
            confirmed: true,
        },
        &config,
        "test-session",
    )
    .unwrap();
    db.ai_finish(
        &id,
        Ok(json!({"fields":fields(kind),"rows":[],"warnings":[]})),
    )
    .unwrap();
    id
}
fn input(db: &Store, source: &str, job: &str, target: &str, kind: &str) -> Input {
    Input {
        job_id: job.into(),
        source_revision: db.import_detail(source).unwrap().source.revision,
        fields: fields(kind),
        target_id: target.into(),
        month: if kind == "bill" { "" } else { "2026-10" }.into(),
        note: "Checked synthetic original and target".into(),
        currency_confirmed: true,
    }
}
fn save(db: &Store, input: Input) -> Save {
    let token = db.ai_document_preview(input.clone()).unwrap().token;
    Save {
        input,
        token,
        confirmed: true,
    }
}
#[test]
fn ai_document_review_checks_evidence_arithmetic_consent_and_applies_bill_exactly_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let source = super::pdf_documents::ingest(&mut db, "bill");
    let j = job(&mut db, &source, "bill");
    let o = super::pdf_documents::bill(&mut db, "2026-11");
    let i = input(&db, &source, &j, &o.id, "bill");
    for what in [
        "consent",
        "evidence",
        "arithmetic",
        "date",
        "missing",
        "account",
        "month",
    ] {
        let mut bad = i.clone();
        match what {
            "consent" => bad.currency_confirmed = false,
            "evidence" => bad.fields[0].evidence.quote.clear(),
            "arithmetic" => bad.fields[0].value = Some("87.00".into()),
            "date" => bad.fields[1].value = Some("2026-02-30".into()),
            "missing" => bad.fields[0].value = None,
            "account" => bad.target_id = "missing".into(),
            _ => bad.month = "2026-11".into(),
        };
        assert!(db.ai_document_preview(bad).is_err(), "{what}");
    }
    let mut s = save(&db, i.clone());
    s.confirmed = false;
    assert!(db.ai_document_apply(&op(), s).is_err());
    let mut s = save(&db, i.clone());
    s.input.note = "Changed after preview".into();
    assert!(db.ai_document_apply(&op(), s).is_err());
    let s = save(&db, i.clone());
    let raw = serde_json::to_string(&s).unwrap();
    let operation = op();
    db.ai_document_apply(&operation, s).unwrap();
    db.ai_document_apply(&operation, serde_json::from_str(&raw).unwrap())
        .unwrap();
    let now = db.bill_month("2026-11").unwrap().remove(0);
    assert_eq!(now.actual_cents, Some(8600));
    assert_eq!(now.remaining_cents, 8600);
    assert_eq!(now.evidence.len(), 1);
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
    assert_eq!(
        db.ai_document_application(&source)
            .unwrap()
            .unwrap()
            .review
            .target
            .new_amount_cents,
        8600
    );
    assert!(db
        .ai_document_preview(input(&db, &source, &j, &o.id, "bill"))
        .is_err());
    let detail = db.import_detail(&source).unwrap();
    assert!(db
        .configure_import(&source, detail.source.revision, "amex", detail.mapping)
        .is_err());
    let p = crate::imports::parse::prepare(
        "bill.pdf",
        include_bytes!("../../fixtures/pdf/bill.pdf"),
        None,
    )
    .unwrap();
    assert!(db.import_sheet(&source, detail.source.revision, p).is_err());
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    let other = Store::open(dir.path(), "demo").unwrap();
    assert!(other.ai_document_preview(i).is_err());
}
#[test]
fn ai_document_stale_bill_payment_and_atomic_failure_preserve_prior_money() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let source = super::pdf_documents::ingest(&mut db, "bill");
    let j = job(&mut db, &source, "bill");
    let o = super::pdf_documents::bill(&mut db, "2026-11");
    let i = input(&db, &source, &j, &o.id, "bill");
    let stale = save(&db, i.clone());
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
    assert!(db
        .ai_document_apply(&op(), stale)
        .unwrap_err()
        .contains("changed"));
    let mut low = i.clone();
    low.fields
        .retain(|f| ["amount_due", "due_date"].contains(&f.key.as_str()));
    low.fields[0].value = Some("9.00".into());
    assert!(db
        .ai_document_preview(low)
        .err()
        .unwrap()
        .contains("below linked"));
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute_batch("CREATE TRIGGER fail_ai_doc BEFORE INSERT ON audit WHEN NEW.action='ai_document_applied' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    let s = save(&db, i.clone());
    assert!(db.ai_document_apply(&op(), s).is_err());
    assert!(db.ai_document_application(&source).unwrap().is_none());
    assert_eq!(db.bill_month("2026-11").unwrap()[0].actual_cents, None);
    assert_eq!(
        db.import_detail(&source).unwrap().source.revision,
        i.source_revision
    );
    c.execute_batch("DROP TRIGGER fail_ai_doc").unwrap();
    let s = save(&db, i);
    db.ai_document_apply(&op(), s).unwrap();
    let now = db.bill_month("2026-11").unwrap().remove(0);
    assert_eq!(now.remaining_cents, 7600);
    assert_eq!(now.paid_cents, 1000);
    assert_eq!(db.snapshot("2026-11").unwrap().entries.len(), 1);
}
#[test]
fn ai_document_duplicate_evidence_is_blocked_across_local_templates_and_observations() {
    for ai_first in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path(), "personal").unwrap();
        let source = super::pdf_documents::ingest(&mut db, "bill");
        let template = super::pdf_documents::approve(&mut db, &source, "bill");
        let j = job(&mut db, &source, "bill");
        let o = super::pdf_documents::bill(&mut db, "2026-11");
        if ai_first {
            let s = save(&db, input(&db, &source, &j, &o.id, "bill"));
            db.ai_document_apply(&op(), s).unwrap();
            assert!(db
                .preview_pdf_application(super::pdf_documents::request(&db, &template, &o.id, ""))
                .is_err());
        } else {
            let i = super::pdf_documents::request(&db, &template, &o.id, "");
            super::pdf_documents::apply(&mut db, i);
            assert!(db
                .ai_document_preview(input(&db, &source, &j, &o.id, "bill"))
                .is_err());
        }
        let other = db
            .new_import_observation(
                &source,
                db.import_detail(&source).unwrap().source.revision,
                &op(),
            )
            .unwrap();
        let j = job(&mut db, &other, "bill");
        assert!(db
            .ai_document_preview(input(&db, &other, &j, &o.id, "bill"))
            .is_err());
        let b = db.backup().unwrap();
        db.restore(&b).unwrap();
        assert_eq!(db.bill_month("2026-11").unwrap()[0].evidence.len(), 1);
    }
}
#[test]
fn ai_document_statement_uses_signed_balances_and_existing_payment_protection() {
    for credit in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path(), "personal").unwrap();
        super::pdf_documents::setup_card(&mut db);
        let source = super::pdf_documents::ingest(&mut db, "statement");
        let j = job(&mut db, &source, "statement");
        let mut i = input(&db, &source, &j, "amex", "statement");
        if credit {
            i.fields.retain(|f| {
                ["statement_balance", "closing_date", "due_date"].contains(&f.key.as_str())
            });
            i.fields[0].value = Some("-12.34".into());
        }
        let s = save(&db, i);
        db.ai_document_apply(&op(), s).unwrap();
        let view = db.card_statement_month("2026-10").unwrap();
        assert_eq!(
            view.statements[0].confirmed_balance_cents,
            Some(if credit { -1234 } else { 12600 })
        );
        assert_eq!(
            view.statements[0].draft.evidence_source_id.as_deref(),
            Some(source.as_str())
        );
        assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
        if !credit {
            super::card_payments::approve(&mut db, "2026-10");
            let p = super::card_payments::payment(&mut db, "2026-10-25", "126");
            super::card_payments::allocate(&mut db, &p.id, &[("2026-10", "126")]);
            assert_eq!(
                db.card_payment_view("amex").unwrap().obligations[0].remaining_cents,
                Some(0)
            );
            assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
        }
        let b = db.backup().unwrap();
        db.restore(&b).unwrap();
    }
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    super::pdf_documents::setup_card(&mut db);
    super::card_payments::statement(&mut db, "2026-10", "100");
    super::card_payments::approve(&mut db, "2026-10");
    let source = super::pdf_documents::ingest(&mut db, "statement");
    let j = job(&mut db, &source, "statement");
    assert!(db
        .ai_document_preview(input(&db, &source, &j, "amex", "statement"))
        .is_err());
}
#[test]
fn ai_document_corrupt_proof_restore_is_rejected_without_changing_live_obligation() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let source = super::pdf_documents::ingest(&mut db, "bill");
    let j = job(&mut db, &source, "bill");
    let o = super::pdf_documents::bill(&mut db, "2026-11");
    let s = save(&db, input(&db, &source, &j, &o.id, "bill"));
    db.ai_document_apply(&op(), s).unwrap();
    for sql in ["UPDATE ai_document_applications SET review_json=json_set(review_json,'$.target.newAmountCents',99900)","UPDATE ai_document_applications SET input_json=json_set(input_json,'$.input.fields[0].value','99.00')","UPDATE ai_document_applications SET proposal_hash='wrong'","UPDATE ai_document_applications SET source_id='missing'","UPDATE ai_document_applications SET target_id='missing'","DELETE FROM ai_document_applications","DELETE FROM audit WHERE action='ai_document_applied'"]{let b=db.backup().unwrap();let c=rusqlite::Connection::open(dir.path().join("backups/personal").join(&b)).unwrap();c.pragma_update(None,"foreign_keys",false).unwrap();c.execute_batch(sql).unwrap();drop(c);assert!(db.restore(&b).is_err(),"{sql}");assert_eq!(db.bill_month("2026-11").unwrap()[0].actual_cents,Some(8600));}
}
#[test]
fn ai_document_schema32_upgrade_preserves_completed_jobs_and_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let source = super::pdf_documents::ingest(&mut db, "bill");
    let j = job(&mut db, &source, "bill");
    let o = super::pdf_documents::bill(&mut db, "2026-11");
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    super::remove_ai_documents_schema(&c);
    c.pragma_update(None, "user_version", 32).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = save(&db, input(&db, &source, &j, &o.id, "bill"));
    db.ai_document_apply(&op(), s).unwrap();
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
    assert_eq!(
        db.bill_month("2026-11").unwrap()[0].actual_cents,
        Some(8600)
    );
}
