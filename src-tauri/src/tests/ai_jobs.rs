use super::*;
use crate::{
    assistance::{
        client::{self, Failure},
        settings::Config,
    },
    db::ai_jobs::*,
};
use serde_json::json;
fn config() -> Config {
    Config {
        revision: 1,
        enabled: true,
        model: "synthetic-model".into(),
    }
}
fn input(id: &str) -> Input {
    Input {
        source_id: id.into(),
        source_revision: 1,
        provider: "claude".into(),
        task: "bill".into(),
        scope: "text".into(),
        text: "Amount due: 86.00\nDue date: 2026-11-05".into(),
    }
}
fn start(db: &Store, i: Input, c: &Config) -> Start {
    let token = db.ai_prepare(&i, c).unwrap().token;
    Start {
        id: Uuid::new_v4().to_string(),
        input: i,
        token,
        confirmed: true,
    }
}
fn response() -> serde_json::Value {
    json!({"fields":[{"key":"amount_due","value":"86.00","evidence":{"page":1,"quote":"Amount due: 86.00"}},{"key":"due_date","value":"2026-11-05","evidence":{"page":1,"quote":"Due date: 2026-11-05"}}],"rows":[],"warnings":[]})
}
#[test]
fn assistance_consent_binds_settings_text_source_and_workspace_before_network_work() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let id = super::pdf_documents::ingest(&mut db, "bill");
    let c = config();
    let mut s = start(&db, input(&id), &c);
    s.confirmed = false;
    assert!(db.ai_begin(&s, &c, "session").is_err());
    s.confirmed = true;
    s.input.text.push_str("edited");
    assert!(db.ai_begin(&s, &c, "session").is_err());
    s = start(&db, input(&id), &c);
    let mut changed = c.clone();
    changed.revision += 1;
    assert!(db.ai_begin(&s, &changed, "session").is_err());
    changed = c.clone();
    changed.enabled = false;
    assert!(db.ai_begin(&s, &changed, "session").is_err());
    let mut demo = Store::open(d.path(), "demo").unwrap();
    assert!(demo.ai_begin(&s, &c, "session").is_err());
    let detail = db.import_detail(&id).unwrap();
    let bytes = include_bytes!("../../fixtures/pdf/bill.pdf");
    db.import_sheet(
        &id,
        detail.source.revision,
        crate::imports::parse::prepare("bill.pdf", bytes, None).unwrap(),
    )
    .unwrap();
    assert!(db.ai_begin(&s, &c, "session").is_err());
    assert!(db.ai_jobs(&id).unwrap().is_empty());
}
#[test]
fn assistance_repeat_ids_cannot_send_twice_and_completed_proposals_do_not_change_money() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let id = super::pdf_documents::ingest(&mut db, "bill");
    let c = config();
    let mut s = start(&db, input(&id), &c);
    let (_, material) = db.ai_begin(&s, &c, "one").unwrap();
    assert!(material.unwrap().attachment.is_none());
    assert!(db.ai_begin(&s, &c, "one").unwrap().1.is_none());
    let j = db.ai_finish(&s.id, Ok(response())).unwrap();
    assert_eq!(j.status, "completed");
    assert!(j.proposal.is_some());
    drop(db);
    let mut db = Store::open(d.path(), "personal").unwrap();
    db.ai_interrupt("two").unwrap();
    assert!(db
        .ai_begin(&s, &Config::default(), "two")
        .unwrap()
        .1
        .is_none());
    s.input.text.push('!');
    assert!(db.ai_begin(&s, &c, "two").is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 0);
    assert!(db.import_detail(&id).unwrap().rows.is_empty());
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
    assert_eq!(db.ai_jobs(&id).unwrap()[0].status, "completed");
}
#[test]
fn assistance_cancel_restart_and_restore_discard_late_results_without_retrying() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let id = super::pdf_documents::ingest(&mut db, "bill");
    let c = config();
    let s = start(&db, input(&id), &c);
    db.ai_begin(&s, &c, "one").unwrap();
    db.ai_cancel(&s.id).unwrap();
    assert_eq!(
        db.ai_finish(&s.id, Ok(response())).unwrap().status,
        "cancelled"
    );
    assert!(db.ai_begin(&s, &c, "one").unwrap().1.is_none());
    let next = start(&db, input(&id), &c);
    db.ai_begin(&next, &c, "one").unwrap();
    db.ai_interrupt("one").unwrap();
    assert_eq!(db.ai_jobs(&id).unwrap()[0].status, "running");
    db.ai_interrupt("two").unwrap();
    assert_eq!(
        db.ai_finish(&next.id, Ok(response())).unwrap().status,
        "interrupted"
    );
    let third = start(&db, input(&id), &c);
    db.ai_begin(&third, &c, "two").unwrap();
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
    assert_eq!(
        db.ai_finish(&third.id, Ok(response())).unwrap().status,
        "interrupted"
    );
}
#[test]
fn assistance_preserves_server_wait_and_distinguishes_billing_from_malformed_proposals() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let id = super::pdf_documents::ingest(&mut db, "bill");
    let c = config();
    let s = start(&db, input(&id), &c);
    db.ai_begin(&s, &c, "one").unwrap();
    let mut bad = response();
    bad["fields"][0]["value"] = json!("NaN");
    let j = db.ai_finish(&s.id, Ok(bad)).unwrap();
    assert_eq!(j.failure.unwrap().kind, "invalid_output");
    let next = start(&db, input(&id), &c);
    db.ai_begin(&next, &c, "one").unwrap();
    let f = client::http_failure(429, br#"{"error":{"type":"insufficient_quota"}}"#, Some(60));
    let j = db
        .ai_finish(&next.id, Err::<serde_json::Value, _>(f))
        .unwrap();
    assert_eq!(j.failure.unwrap().kind, "billing");
    assert!(j.retry_not_before.is_none());
    let next = start(&db, input(&id), &c);
    db.ai_begin(&next, &c, "one").unwrap();
    let j = db
        .ai_finish(
            &next.id,
            Err::<serde_json::Value, _>(Failure {
                kind: "rate_limit".into(),
                message: "Wait".into(),
                retry_after: Some(172800),
            }),
        )
        .unwrap();
    assert!(j.retry_not_before.unwrap() > chrono::Utc::now().timestamp() + 86400);
    let next = start(&db, input(&id), &c);
    assert!(db.ai_begin(&next, &c, "one").is_err());
    let now = chrono::DateTime::parse_from_rfc3339("2026-11-03T12:00:00Z")
        .unwrap()
        .to_utc();
    assert_eq!(
        client::retry_seconds("Tue, 03 Nov 2026 12:01:00 GMT", now),
        Some(60)
    );
    assert_eq!(client::retry_seconds("172800", now), Some(172800));
}
#[test]
fn assistance_original_attachment_is_exact_and_corrupt_restore_is_rejected() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let id = super::pdf_documents::ingest(&mut db, "bill");
    let c = config();
    let mut i = input(&id);
    i.scope = "original".into();
    i.text = String::new();
    let s = start(&db, i, &c);
    let (_, material) = db.ai_begin(&s, &c, "one").unwrap();
    use base64::Engine;
    let a = material.unwrap().attachment.unwrap();
    assert_eq!(a.mime, "application/pdf");
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(a.data)
            .unwrap(),
        include_bytes!("../../fixtures/pdf/bill.pdf")
    );
    db.ai_finish(&s.id, Ok(response())).unwrap();
    let b = db.backup().unwrap();
    let conn = rusqlite::Connection::open(d.path().join("backups/personal").join(&b)).unwrap();
    conn.execute(
        "UPDATE ai_jobs SET request_json=json_set(request_json,'$.input.text','forged source')",
        [],
    )
    .unwrap();
    drop(conn);
    assert!(db.restore(&b).is_err());
    assert_eq!(db.ai_jobs(&id).unwrap()[0].request.input.text, "");
}
#[test]
fn assistance_records_token_usage_and_upgrades_from_thirty_six() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let id = super::pdf_documents::ingest(&mut db, "bill");
    let c = config();
    let s = start(&db, input(&id), &c);
    db.ai_begin(&s, &c, "one").unwrap();
    let usage = client::Usage {
        input_tokens: 1200,
        output_tokens: 340,
    };
    let j = db
        .ai_finish(
            &s.id,
            Ok(client::Outcome {
                proposal: response(),
                usage: Some(usage.clone()),
            }),
        )
        .unwrap();
    assert_eq!(j.status, "completed");
    assert_eq!(j.usage, Some(usage.clone()));
    assert_eq!(db.ai_jobs(&id).unwrap()[0].usage, Some(usage));
    let plain = start(&db, input(&id), &c);
    db.ai_begin(&plain, &c, "one").unwrap();
    assert!(db
        .ai_finish(&plain.id, Ok(response()))
        .unwrap()
        .usage
        .is_none());
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
    let jobs = db.ai_jobs(&id).unwrap();
    let kept = jobs.iter().find(|j| j.id == s.id).unwrap();
    assert_eq!(kept.usage.as_ref().unwrap().output_tokens, 340);
    drop(db);
    let conn = rusqlite::Connection::open(d.path().join("personal.sqlite")).unwrap();
    super::remove_ai_usage_schema(&conn);
    conn.execute_batch("PRAGMA user_version=36;").unwrap();
    drop(conn);
    let db = Store::open(d.path(), "personal").unwrap();
    let jobs = db.ai_jobs(&id).unwrap();
    assert_eq!(jobs.len(), 2);
    assert!(jobs
        .iter()
        .all(|j| j.status == "completed" && j.usage.is_none()));
}
#[test]
fn assistance_upgrade_from_thirty_preserves_existing_evidence() {
    let d = tempfile::tempdir().unwrap();
    let mut db = Store::open(d.path(), "personal").unwrap();
    let id = super::pdf_documents::ingest(&mut db, "bill");
    drop(db);
    let conn = rusqlite::Connection::open(d.path().join("personal.sqlite")).unwrap();
    super::remove_ai_rows_schema(&conn);
    conn.execute_batch("DROP TABLE ai_jobs;PRAGMA user_version=30;")
        .unwrap();
    drop(conn);
    let db = Store::open(d.path(), "personal").unwrap();
    assert!(db.ai_jobs(&id).unwrap().is_empty());
    assert_eq!(db.import_detail(&id).unwrap().source.format, "pdf");
}

#[test]
fn assistance_counts_original_pdf_pages_when_local_text_is_unavailable() {
    use lopdf::{dictionary, Document, Object, Stream};
    fn blank_pdf(count: usize) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages = doc.new_object_id();
        let contents = doc.add_object(Stream::new(dictionary! {}, Vec::new()));
        let mut kids = Vec::new();
        for _ in 0..count {
            let page = doc.add_object(dictionary! {
                "Type" => "Page", "Parent" => pages,
                "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
                "Resources" => dictionary! {}, "Contents" => contents,
            });
            kids.push(Object::Reference(page));
        }
        doc.objects.insert(
            pages,
            dictionary! {"Type" => "Pages", "Kids" => kids, "Count" => count as i64}.into(),
        );
        let catalog = doc.add_object(dictionary! {"Type" => "Catalog", "Pages" => pages});
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    // Start with the failing boundary: the local extractor refuses >100 pages,
    // so using its empty page vector incorrectly allowed a 601-page attachment.
    for pages in [601, 1, 100, 600] {
        let bytes = blank_pdf(pages);
        let prepared = crate::imports::parse::prepare("blank.pdf", &bytes, None).unwrap();
        assert!(prepared.dataset.pdf_pages.is_empty());
        let source = db.ingest("blank.pdf", bytes, prepared).unwrap();
        let mut i = input(&source);
        i.scope = "original".into();
        i.text.clear();
        if pages > 600 {
            assert!(db
                .ai_prepare(&i, &config())
                .err()
                .expect("oversized original was accepted")
                .contains("600"));
            assert!(db.ai_jobs(&source).unwrap().is_empty());
            i.scope = "text".into();
            i.text = "Reviewed excerpt: Amount due 10.00".into();
            assert!(db.ai_prepare(&i, &config()).is_ok());
        } else {
            let s = start(&db, i, &config());
            let (job, material) = db.ai_begin(&s, &config(), "pdf-pages").unwrap();
            assert_eq!(job.request.page_count, Some(pages as u32));
            assert!(material.unwrap().attachment.is_some());
            db.ai_cancel(&s.id).unwrap();
        }
    }
}
