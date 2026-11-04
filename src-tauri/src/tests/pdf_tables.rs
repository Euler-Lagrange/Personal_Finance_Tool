use super::*;
use crate::{
    db::{identity::CoverageInput, pdf_tables::*},
    imports::{
        parse, pdf, pdf_table as table,
        types::{Decision, SourceDetail},
    },
};
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn definition() -> table::Definition {
    table::Definition {
        name: "Synthetic card table".into(),
        identity: "SYNTHETIC CARD ACTIVITY".into(),
        currency: "Currency: USD".into(),
        start: "Transactions".into(),
        end: "End transactions".into(),
        headers: vec!["Date".into(), "Description".into(), "Amount".into()],
        separator: "pipe".into(),
        automatic: true,
    }
}
fn bytes(kind: &str) -> &'static [u8] {
    match kind {
        "one" => include_bytes!("../../fixtures/pdf/transactions.pdf"),
        "two" => include_bytes!("../../fixtures/pdf/transactions_overlap.pdf"),
        _ => include_bytes!("../../fixtures/pdf/transactions_drift.pdf"),
    }
}
fn ingest(db: &mut Store, kind: &str) -> String {
    let p = parse::prepare("table.pdf", bytes(kind), None).unwrap();
    assert!(p.error.is_empty());
    db.ingest("table.pdf", bytes(kind).to_vec(), p).unwrap()
}
fn save(db: &mut Store, r: Request) {
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
}
fn approve(db: &mut Store, id: &str) -> Request {
    let r = Request {
        source_id: id.into(),
        source_revision: db.import_detail(id).unwrap().source.revision,
        template_id: op(),
        template_revision: 0,
        definition: Some(definition()),
    };
    save(db, r.clone());
    Request {
        template_revision: 1,
        definition: None,
        ..r
    }
}
fn configure(db: &mut Store, id: &str) -> SourceDetail {
    let d = db.import_detail(id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(id, d.source.revision, "amex", m)
        .unwrap();
    db.import_detail(id).unwrap()
}
fn coverage(db: &mut Store, id: &str) {
    let d = db.import_detail(id).unwrap();
    db.confirm_import_coverage(
        id,
        d.source.revision,
        CoverageInput {
            start_date: "2026-10-01".into(),
            end_date: "2026-10-31".into(),
            date_basis: "transaction".into(),
            completeness: "complete".into(),
            profile: "Synthetic monthly PDF".into(),
            observed_at: "2026-11-01T12:00:00Z".into(),
            inclusive: true,
        },
    )
    .unwrap();
}
#[test]
fn pdf_table_preserves_every_row_twins_page_evidence_and_blocks_partial_or_ambiguous_layouts() {
    let pages = pdf::extract(bytes("one")).unwrap().pdf_pages;
    let d = definition();
    let e = table::extract(&d, &pages).unwrap();
    assert_eq!(e.rows.len(), 6);
    assert_eq!(e.rows[0], e.rows[1]);
    assert_eq!(e.rows[5][2], "-624.00");
    assert_eq!(e.evidence[3].page, 2);
    assert_eq!(e.evidence[3].first_line, 5);
    assert!(table::extract(&d, &pdf::extract(bytes("drift")).unwrap().pdf_pages).is_err());
    for index in [0, 1, 3, 7] {
        let mut p = pages.clone();
        p[0].lines[index] = "Changed".into();
        assert!(table::extract(&d, &p).is_err());
    }
    let mut p = pages.clone();
    p[0].lines.push("Transactions".into());
    assert!(table::extract(&d, &p).is_err());
    let mut p = pages.clone();
    p[1].lines.remove(7);
    assert!(table::extract(&d, &p).is_err());
    let mut d = definition();
    d.headers.push("Amount".into());
    assert!(table::extract(&d, &pages).is_err());
}
#[test]
fn fixed_table_layouts_preserve_unicode_and_empty_cells_without_executing_patterns() {
    for sep in ["pipe", "tab", "spaces", "lines"] {
        let mut d = definition();
        d.separator = sep.into();
        let row = match sep {
            "pipe" => vec!["10/01/2026 | Caf\u{e9} | 12.34"],
            "tab" => vec!["10/01/2026\tCaf\u{e9}\t12.34"],
            "spaces" => vec!["10/01/2026  Caf\u{e9}  12.34"],
            _ => vec!["10/01/2026", "Caf\u{e9}", "12.34"],
        };
        let mut lines = vec![d.identity.clone(), d.currency.clone(), d.start.clone()];
        lines.extend(row.into_iter().map(str::to_string));
        lines.push(d.end.clone());
        let e = table::extract(&d, &[pdf::Page { number: 1, lines }]).unwrap();
        assert_eq!(e.rows[0][1], "Caf\u{e9}");
    }
    let mut d = definition();
    d.separator = ".*".into();
    assert!(table::validate(&d).is_err());
}
#[test]
fn approval_staging_retries_and_automatic_recognition_create_no_money() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "one");
    let r = approve(&mut db, &id);
    assert!(db.import_detail(&id).unwrap().rows.is_empty());
    let p = db.preview_pdf_table(r.clone()).unwrap();
    let operation = op();
    for _ in 0..2 {
        db.save_pdf_table(
            &operation,
            Save {
                request: r.clone(),
                token: p.token.clone(),
                confirmed: true,
            },
        )
        .unwrap();
    }
    assert_eq!(db.import_detail(&id).unwrap().rows.len(), 6);
    let second = ingest(&mut db, "two");
    assert_eq!(db.import_detail(&second).unwrap().rows.len(), 6);
    assert!(db
        .import_detail(&second)
        .unwrap()
        .source
        .account_id
        .is_none());
    assert_eq!(ingest(&mut db, "two"), second);
    let drift = ingest(&mut db, "drift");
    let d = db.import_detail(&drift).unwrap();
    assert!(d.rows.is_empty());
    assert!(d.dataset.notes.iter().any(|s| s.contains("needs review")));
    assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    drop(db);
    let db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(
        db.pdf_table_view(&second).unwrap().binding.unwrap().version,
        1
    );
    assert!(Store::open(dir.path(), "demo")
        .unwrap()
        .pdf_table_view(&second)
        .is_err());
}
#[test]
fn overlapping_pdf_purchases_and_full_card_payment_share_one_ledger_and_keep_equal_twins() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "one");
    let r = approve(&mut db, &id);
    save(&mut db, r);
    configure(&mut db, &id);
    coverage(&mut db, &id);
    let d = db.import_detail(&id).unwrap();
    let mut decisions: Vec<Decision> = d.rows.iter().map(super::imports::add).collect();
    for v in &mut decisions {
        v.separate = true;
    }
    let e = decisions[5].input.as_mut().unwrap();
    e.kind = "card_payment".into();
    e.account_id = Some("checking".into());
    e.destination_account_id = Some("amex".into());
    e.category_id = None;
    e.split_mode = "none".into();
    let receipt = super::imports::commit(&mut db, &d, decisions).unwrap();
    assert_eq!(receipt.added, 6);
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
    let id2 = ingest(&mut db, "two");
    configure(&mut db, &id2);
    coverage(&mut db, &id2);
    let d = db.import_detail(&id2).unwrap();
    assert!(d.overlap.items.iter().all(|i| i.action == "link"));
    db.reconcile_import(&id2, d.source.revision, &op()).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 62400);
    assert_eq!(db.snapshot("2026-10").unwrap().entries.len(), 6);
    let rev = db.import_detail(&id2).unwrap().source.revision;
    let observation = db.new_import_observation(&id2, rev, &op()).unwrap();
    assert!(db.pdf_table_view(&observation).unwrap().binding.is_some());
    configure(&mut db, &observation);
    coverage(&mut db, &observation);
    let d = db.import_detail(&observation).unwrap();
    db.reconcile_import(&observation, d.source.revision, &op())
        .unwrap();
    let q = db.close_review("2026-10").unwrap();
    assert!(q.blockers.is_empty(), "{:?}", q.blockers);
    db.close_month(crate::db::periods::CloseInput {
        id: op(),
        month: "2026-10".into(),
        revision: q.revision,
        token: q.token,
        acknowledgements: q.warnings.into_iter().map(|w| w.id).collect(),
        note: "Synthetic PDF month".into(),
        carry: None,
    })
    .unwrap();
    let before = db.shared_statement_view(Some("2026-10")).unwrap();
    let book = db
        .snapshot("2026-10")
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.description == "Books")
        .unwrap();
    let mut refund = expense("25", "jacob");
    refund.kind = "refund".into();
    refund.date = "2026-11-01".into();
    refund.original_event_id = Some(book.id);
    refund.split_mode = "refund".into();
    db.save(refund).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, -2500);
    assert_eq!(db.shared_statement_view(Some("2026-10")).unwrap(), before);
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
}
#[test]
fn paused_competing_templates_and_changed_versions_never_silently_stage() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "one");
    let r = approve(&mut db, &id);
    db.set_pdf_table_enabled(&op(), &r.template_id, 1, false)
        .unwrap();
    let second = ingest(&mut db, "two");
    assert!(db.import_detail(&second).unwrap().rows.is_empty());
    db.set_pdf_table_enabled(&op(), &r.template_id, 1, true)
        .unwrap();
    let preview = db.preview_pdf_table(r.clone()).unwrap();
    let mut next = r.clone();
    next.definition = Some(definition());
    save(&mut db, next);
    assert!(db
        .save_pdf_table(
            &op(),
            Save {
                request: r,
                token: preview.token,
                confirmed: true
            }
        )
        .is_err());
    approve(&mut db, &id);
    let drift = ingest(&mut db, "drift");
    assert!(db.import_detail(&drift).unwrap().rows.is_empty());
    assert!(db
        .import_detail(&drift)
        .unwrap()
        .dataset
        .notes
        .iter()
        .any(|n| n.contains("Multiple")));
}
#[test]
fn interrupted_table_staging_and_corrupt_restore_leave_current_data_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "one");
    let r = approve(&mut db, &id);
    let p = db.preview_pdf_table(r.clone()).unwrap();
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute_batch("CREATE TRIGGER fail_table BEFORE INSERT ON pdf_table_bindings BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    assert!(db
        .save_pdf_table(
            &op(),
            Save {
                request: r.clone(),
                token: p.token,
                confirmed: true
            }
        )
        .is_err());
    assert!(db.import_detail(&id).unwrap().rows.is_empty());
    assert_eq!(
        db.import_detail(&id).unwrap().source.revision,
        r.source_revision
    );
    c.execute_batch("DROP TRIGGER fail_table;").unwrap();
    drop(c);
    save(&mut db, r);
    for sql in [
        "UPDATE pdf_table_bindings SET proof_json=json_set(proof_json,'$.rows[0][2]','999')",
        "DELETE FROM pdf_table_bindings",
        "UPDATE import_rows SET raw_json='[\"10/02/2026\",\"Forged\",\"999\"]' WHERE ordinal=0",
    ] {
        let b = db.backup().unwrap();
        let c = rusqlite::Connection::open(dir.path().join("backups/personal").join(&b)).unwrap();
        c.execute_batch(sql).unwrap();
        drop(c);
        assert!(db.restore(&b).is_err(), "{sql}");
        assert_eq!(db.import_detail(&id).unwrap().rows[0].raw[2], "100.00");
    }
}
#[test]
fn schema28_upgrade_preserves_pdf_documents_and_evidence_then_enables_tables() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = ingest(&mut db, "one");
    let mut e = expense("10", "jacob");
    e.date = "2026-10-10".into();
    db.save(e).unwrap();
    let before = db.snapshot("2026-10").unwrap().spent_cents;
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    super::remove_pdf_table_schema(&c);
    c.pragma_update(None, "user_version", 28).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, before);
    let r = approve(&mut db, &id);
    save(&mut db, r);
    assert_eq!(db.import_detail(&id).unwrap().rows.len(), 6);
}
