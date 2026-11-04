use super::*;
use crate::{
    assistance::{
        proposal::{Evidence, Row},
        settings::Config,
    },
    db::{ai_jobs, ai_rows, identity::CoverageInput},
    imports::types::SourceDetail,
};
use serde_json::json;
fn rows() -> Vec<Row> {
    [
        ("100.00", "Store", "out"),
        ("100.00", "Store", "out"),
        ("200.00", "Utility", "out"),
        ("124.00", "Groceries", "out"),
        ("100.00", "Fuel", "out"),
        ("624.00", "CARD PAYMENT", "in"),
    ]
    .iter()
    .map(|(amount, description, direction)| Row {
        date: Some("2026-10-01".into()),
        description: (*description).into(),
        amount: Some((*amount).into()),
        direction: (*direction).into(),
        status: "posted".into(),
        currency: Some("USD".into()),
        evidence: Evidence {
            page: Some(1),
            quote: format!("{description} {amount}"),
        },
    })
    .collect()
}
fn setup(db: &mut Store) -> (String, String) {
    let id = super::pdf_documents::ingest(db, "bill");
    let config = Config {
        enabled: true,
        revision: 1,
        model: "synthetic-model".into(),
    };
    let input = ai_jobs::Input {
        source_id: id.clone(),
        source_revision: 1,
        provider: "claude".into(),
        task: "transactions".into(),
        scope: "text".into(),
        text: "Synthetic transaction fixture".into(),
    };
    let token = db.ai_prepare(&input, &config).unwrap().token;
    let job = Uuid::new_v4().to_string();
    db.ai_begin(
        &ai_jobs::Start {
            id: job.clone(),
            input,
            token,
            confirmed: true,
        },
        &config,
        "one",
    )
    .unwrap();
    db.ai_finish(&job, Ok(json!({"fields":[],"rows":rows(),"warnings":[]})))
        .unwrap();
    (id, job)
}
fn review(db: &Store, id: &str, job: &str) -> ai_rows::Save {
    let input = ai_rows::Input {
        job_id: job.into(),
        source_revision: db.import_detail(id).unwrap().source.revision,
        rows: rows(),
    };
    let token = db.ai_rows_preview(input.clone()).unwrap().token;
    ai_rows::Save {
        input,
        token,
        confirmed: true,
    }
}
fn configure(db: &mut Store, id: &str) -> SourceDetail {
    let d = db.import_detail(id).unwrap();
    db.configure_import(id, d.source.revision, "amex", d.mapping)
        .unwrap();
    db.import_detail(id).unwrap()
}
#[test]
fn ai_rows_require_review_and_preserve_exact_retry_corrections_without_posting_money() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let (id, job) = setup(&mut db);
    let mut s = review(&db, &id, &job);
    let op = Uuid::new_v4().to_string();
    s.confirmed = false;
    assert!(db.ai_rows_stage(&op, s).is_err());
    let mut s = review(&db, &id, &job);
    s.input.rows[0].description = "Corrected store".into();
    assert!(db.ai_rows_stage(&op, s).is_err());
    let mut s = review(&db, &id, &job);
    s.input.rows[0].description = "Corrected store".into();
    s.token = db.ai_rows_preview(s.input.clone()).unwrap().token;
    let encoded = serde_json::to_string(&s).unwrap();
    db.ai_rows_stage(&op, s).unwrap();
    db.ai_rows_stage(&op, serde_json::from_str(&encoded).unwrap())
        .unwrap();
    assert_eq!(
        db.ai_rows_binding(&id).unwrap().unwrap().rows[0].description,
        "Corrected store"
    );
    assert_eq!(
        db.ai_jobs(&id).unwrap()[0].proposal.as_ref().unwrap().rows[0].description,
        "Store"
    );
    let detail = db.import_detail(&id).unwrap();
    assert_eq!(detail.rows.len(), 6);
    assert!(detail.dataset.assisted);
    assert_eq!(detail.source.state, "unconfigured");
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
    let bytes = include_bytes!("../../fixtures/pdf/bill.pdf");
    assert!(db
        .import_sheet(
            &id,
            detail.source.revision,
            crate::imports::parse::prepare("bill.pdf", bytes, None).unwrap()
        )
        .is_err());
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
    assert_eq!(
        db.ai_rows_binding(&id).unwrap().unwrap().rows[0].description,
        "Corrected store"
    );
}
#[test]
fn ai_rows_keep_twins_and_full_card_payment_counts_spending_once_through_overlap_and_restore() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let (id, job) = setup(&mut db);
    db.ai_rows_stage(&Uuid::new_v4().to_string(), review(&db, &id, &job))
        .unwrap();
    let detail = configure(&mut db, &id);
    assert!(detail.rows.iter().all(|r| !r.bulk_expense_reason.is_empty()
        && r.candidate
            .warnings
            .iter()
            .any(|s| s.contains("AI-assisted"))));
    let mut bulk = super::imports::add(&detail.rows[0]);
    bulk.action = "bulk_expense".into();
    assert!(super::imports::commit(&mut db, &detail, vec![bulk]).is_err());
    let c = CoverageInput {
        start_date: "2026-10-01".into(),
        end_date: "2026-10-31".into(),
        date_basis: "transaction".into(),
        completeness: "complete".into(),
        profile: "AI reviewed".into(),
        observed_at: "2026-11-01T12:00:00Z".into(),
        inclusive: true,
    };
    assert!(db
        .confirm_import_coverage(&id, detail.source.revision, c)
        .is_err());
    for index in 0..6 {
        let detail = db.import_detail(&id).unwrap();
        let row = &detail.rows[index];
        let mut decision = super::imports::add(row);
        decision.separate = true;
        if index == 5 {
            let e = decision.input.as_mut().unwrap();
            e.kind = "card_payment".into();
            e.account_id = Some("checking".into());
            e.destination_account_id = Some("amex".into());
            e.category_id = None;
            e.split_mode = "none".into();
        }
        super::imports::commit(&mut db, &detail, vec![decision]).unwrap();
    }
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 62400);
    assert_eq!(s.entries.len(), 6);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        0
    );
    assert!(db.ai_rows_preview(review_input(&db, &id, &job)).is_err());
    let csv="Date,Description,Amount,Status,Currency\n2026-10-01,Store,100.00,posted,USD\n2026-10-01,Store,100.00,posted,USD\n2026-10-01,Utility,200.00,posted,USD\n2026-10-01,Groceries,124.00,posted,USD\n2026-10-01,Fuel,100.00,posted,USD\n2026-10-01,CARD PAYMENT,-624.00,posted,USD\n";
    let overlap = super::imports::stage(&mut db, csv, "amex");
    assert!(overlap.rows.iter().all(|r| !r.matches.is_empty()));
    let mut used = std::collections::HashSet::new();
    let links = overlap
        .rows
        .iter()
        .map(|r| {
            let m = r.matches.iter().find(|m| !used.contains(&m.id)).unwrap();
            used.insert(m.id.clone());
            crate::imports::types::Decision {
                row_id: r.id.clone(),
                action: "link".into(),
                input: None,
                match_id: Some(m.id.clone()),
                match_revision: Some(m.revision),
                confirmed: true,
                separate: false,
                rule_signature: None,
            }
        })
        .collect();
    assert_eq!(
        super::imports::commit(&mut db, &overlap, links)
            .unwrap()
            .linked,
        6
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 62400);
    let detail = db.import_detail(&id).unwrap();
    let child = Uuid::new_v4().to_string();
    db.new_import_observation(&id, detail.source.revision, &child)
        .unwrap();
    assert!(db.import_detail(&child).unwrap().dataset.assisted);
    assert_eq!(db.ai_rows_binding(&child).unwrap().unwrap().rows.len(), 6);
    let mut refund = expense("10.00", "jacob");
    refund.kind = "refund".into();
    refund.date = "2026-11-01".into();
    refund.split_mode = "refund".into();
    refund.original_event_id = detail.rows[0].event_id.clone();
    db.save(refund).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, -1000);
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 62400);
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, -1000);
}
fn review_input(db: &Store, id: &str, job: &str) -> ai_rows::Input {
    ai_rows::Input {
        job_id: job.into(),
        source_revision: db.import_detail(id).unwrap().source.revision,
        rows: rows(),
    }
}
#[test]
fn ai_rows_audit_failure_stale_source_and_cross_workspace_leave_rows_unchanged() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let (id, job) = setup(&mut db);
    let s = review(&db, &id, &job);
    let demo = Store::open(d.path(), "demo").unwrap();
    assert!(demo.ai_rows_preview(s.input.clone()).is_err());
    db.dismiss_import(&id, 1, true).unwrap();
    assert!(db.ai_rows_stage(&Uuid::new_v4().to_string(), s).is_err());
    db.dismiss_import(&id, 2, false).unwrap();
    let c = rusqlite::Connection::open(d.path().join("personal.sqlite")).unwrap();
    c.execute_batch("CREATE TRIGGER fail_ai_rows BEFORE INSERT ON audit WHEN NEW.action='ai_rows_staged' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    let s = review(&db, &id, &job);
    assert!(db.ai_rows_stage(&Uuid::new_v4().to_string(), s).is_err());
    assert!(db.ai_rows_binding(&id).unwrap().is_none());
    assert!(db.import_detail(&id).unwrap().rows.is_empty());
    c.execute_batch("DROP TRIGGER fail_ai_rows;").unwrap();
    db.ai_rows_stage(&Uuid::new_v4().to_string(), review(&db, &id, &job))
        .unwrap();
    assert_eq!(db.import_detail(&id).unwrap().rows.len(), 6);
}
#[test]
fn ai_rows_corrupt_flags_raw_cells_candidates_and_review_proofs_cannot_replace_current_data() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let (id, job) = setup(&mut db);
    db.ai_rows_stage(&Uuid::new_v4().to_string(), review(&db, &id, &job))
        .unwrap();
    configure(&mut db, &id);
    for sql in ["UPDATE import_sources SET dataset_json=json_set(dataset_json,'$.assisted',json('false'))","UPDATE import_rows SET raw_json='[\"forged\"]' WHERE ordinal=0","UPDATE import_rows SET candidate_json=json_set(candidate_json,'$.warnings',json('[]')) WHERE ordinal=0","UPDATE ai_row_reviews SET proposal_hash='forged'","DELETE FROM ai_row_bindings"] {
        let b=db.backup().unwrap();let c=rusqlite::Connection::open(d.path().join("backups/personal").join(&b)).unwrap();c.execute_batch(sql).unwrap();drop(c);assert!(db.restore(&b).is_err(),"{sql}");assert!(db.import_detail(&id).unwrap().dataset.assisted);
    }
}
#[test]
fn ai_rows_schema31_upgrade_preserves_saved_request_results() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let (id, _) = setup(&mut db);
    drop(db);
    let c = rusqlite::Connection::open(d.path().join("personal.sqlite")).unwrap();
    super::remove_ai_rows_schema(&c);
    c.pragma_update(None, "user_version", 31).unwrap();
    drop(c);
    let db = Store::open(d.path(), "personal").unwrap();
    assert_eq!(db.ai_jobs(&id).unwrap()[0].status, "completed");
    assert!(db.ai_rows_binding(&id).unwrap().is_none());
}

#[test]
fn ai_image_rows_hold_unknown_status_and_currency_until_explicit_correction() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::RgbaImage::from_pixel(3, 3, image::Rgba([80, 100, 120, 255]))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let bytes = bytes.into_inner();
    let p = crate::imports::types::Prepared {
        fingerprint: crate::imports::parse::fingerprint(&bytes, "image").unwrap(),
        mime: "image/png".into(),
        format: "image".into(),
        dataset: crate::imports::types::Dataset {
            image: true,
            ..Default::default()
        },
        error: String::new(),
    };
    let id = db.ingest("synthetic.png", bytes, p).unwrap();
    let c = Config {
        enabled: true,
        revision: 1,
        model: "synthetic-model".into(),
    };
    let input = ai_jobs::Input {
        source_id: id.clone(),
        source_revision: 1,
        provider: "openai".into(),
        task: "transactions".into(),
        scope: "original".into(),
        text: String::new(),
    };
    let token = db.ai_prepare(&input, &c).unwrap().token;
    let job = Uuid::new_v4().to_string();
    db.ai_begin(
        &ai_jobs::Start {
            id: job.clone(),
            input,
            token,
            confirmed: true,
        },
        &c,
        "one",
    )
    .unwrap();
    let mut unknown = rows()[0].clone();
    unknown.currency = None;
    unknown.status = "unknown".into();
    unknown.evidence.page = None;
    db.ai_finish(
        &job,
        Ok(json!({"fields":[],"rows":[unknown.clone()],"warnings":[]})),
    )
    .unwrap();
    let input = ai_rows::Input {
        job_id: job.clone(),
        source_revision: 1,
        rows: vec![unknown],
    };
    let token = db.ai_rows_preview(input.clone()).unwrap().token;
    db.ai_rows_stage(
        &Uuid::new_v4().to_string(),
        ai_rows::Save {
            input,
            token,
            confirmed: true,
        },
    )
    .unwrap();
    let detail = configure(&mut db, &id);
    assert!(detail.preview_url.unwrap().starts_with("data:image/png"));
    let detail = db.import_detail(&id).unwrap();
    assert!(
        super::imports::commit(&mut db, &detail, vec![super::imports::add(&detail.rows[0])])
            .is_err()
    );
    let input = ai_rows::Input {
        job_id: job,
        source_revision: detail.source.revision,
        rows: vec![Row {
            evidence: Evidence {
                page: None,
                quote: "Store 100.00 USD posted".into(),
            },
            ..rows()[0].clone()
        }],
    };
    let token = db.ai_rows_preview(input.clone()).unwrap().token;
    db.ai_rows_stage(
        &Uuid::new_v4().to_string(),
        ai_rows::Save {
            input,
            token,
            confirmed: true,
        },
    )
    .unwrap();
    let detail = configure(&mut db, &id);
    super::imports::commit(&mut db, &detail, vec![super::imports::add(&detail.rows[0])]).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 10000);
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
    assert!(db.import_detail(&id).unwrap().dataset.assisted);
}
