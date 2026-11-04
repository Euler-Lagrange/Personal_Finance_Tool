use super::*;
use crate::db::{
    classification::Policy,
    identity::CoverageInput,
    purchase_review::{Changes, Request, Selection},
};
use crate::imports::parse;
fn stage(db: &mut Store, shared: &str) -> (String, String) {
    let bytes=b"Date,Description,Amount\n2026-10-10,Neighborhood Market,100\n2026-10-11,NEIGHBORHOOD-MARKET,50\n2026-10-12,Market 2,20\n".to_vec();
    let prepared = parse::prepare("review.csv", &bytes, None).unwrap();
    let id = db.ingest("review.csv", bytes, prepared).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.posted_confirmed = true;
    m.amount_mode = "outflow_positive".into();
    db.configure_import(&id, d.source.revision, "amex", m)
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    db.confirm_import_coverage(
        &id,
        d.source.revision,
        CoverageInput {
            start_date: "2026-10-01".into(),
            end_date: "2026-10-30".into(),
            date_basis: "transaction".into(),
            completeness: "complete".into(),
            profile: "Synthetic review".into(),
            observed_at: "2026-10-30T23:00:00Z".into(),
            inclusive: true,
        },
    )
    .unwrap();
    let d = db.import_detail(&id).unwrap();
    let op = Uuid::new_v4().to_string();
    db.process_import(
        &id,
        d.source.revision,
        &op,
        Policy {
            ordinary_card_charges: true,
            ownership: shared.into(),
            types: vec![],
        },
    )
    .unwrap();
    (id, op)
}
fn request(db: &Store, source: &str, category: Option<&str>, sharing: Option<&str>) -> Request {
    Request {
        id: Uuid::new_v4().to_string(),
        source_id: source.into(),
        source_revision: db.import_detail(source).unwrap().source.revision,
        rows: db
            .purchase_review(source)
            .unwrap()
            .items
            .iter()
            .take(2)
            .map(|r| Selection {
                row_id: r.row_id.clone(),
                event_id: r.entry.id.clone(),
                revision: r.entry.revision,
            })
            .collect(),
        changes: Changes {
            category_id: category.map(String::from),
            split_mode: sharing.map(String::from),
            split_value: String::new(),
        },
        confirmed: true,
    }
}
#[test]
fn merchant_review_changes_only_selected_fields_and_undo_restores_import_eligibility() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, import) = stage(&mut db, "personal");
    let request = request(&db, &source, Some("groceries"), Some("shared"));
    let snapshot = db.snapshot("2026-10").unwrap();
    db.review_purchases(request.clone()).unwrap();
    db.review_purchases(request.clone()).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 12500);
    assert_eq!(s.household_cents, 4500);
    assert_eq!(s.income_cents, 0);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        17000
    );
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "groceries")
            .unwrap()
            .spent_cents,
        10500
    );
    assert_eq!(
        s.entries
            .iter()
            .find(|e| e.description == "Market 2")
            .unwrap()
            .category_id
            .as_deref(),
        Some("uncategorized")
    );
    assert!(db.undo_import(&import).is_err());
    let mut reused = request.clone();
    reused.changes.category_id = Some("hobbies".into());
    assert!(db.review_purchases(reused).is_err());
    db.restore(&db.backup().unwrap()).unwrap();
    db.undo_purchase_review(&request.id).unwrap();
    db.undo_purchase_review(&request.id).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, snapshot.spent_cents);
    assert_eq!(s.household_cents, 0);
    assert!(db.review_purchases(request).is_err());
    db.undo_import(&import).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
}
#[test]
fn category_only_review_preserves_pending_ownership_then_sharing_resolves_without_new_account_effects(
) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, _) = stage(&mut db, "ask");
    let first = request(&db, &source, Some("groceries"), None);
    db.review_purchases(first).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.provisional_allowance_cents, 17000);
    assert_eq!(s.spent_cents, 0);
    assert_eq!(s.household_cents, 0);
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "groceries")
            .unwrap()
            .provisional_cents,
        15000
    );
    let second = request(&db, &source, None, Some("equal"));
    db.review_purchases(second.clone()).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.provisional_allowance_cents, 2000);
    assert_eq!(s.spent_cents, 7500);
    assert_eq!(s.household_cents, 7500);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        17000
    );
    db.restore(&db.backup().unwrap()).unwrap();
    db.undo_purchase_review(&second.id).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.provisional_allowance_cents, 17000);
    assert_eq!(s.household_cents, 0);
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "groceries")
            .unwrap()
            .provisional_cents,
        15000
    );
    db.restore(&db.backup().unwrap()).unwrap();
}
#[test]
fn merchant_review_rejects_stale_duplicate_or_wrong_source_selections_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, _) = stage(&mut db, "personal");
    let original = request(&db, &source, Some("groceries"), Some("shared"));
    let mut stale = original.clone();
    stale.rows[1].revision += 1;
    assert!(db.review_purchases(stale).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 17000);
    assert_eq!(
        db.purchase_review(&source).unwrap().items[0].entry.revision,
        1
    );
    let mut duplicate = original.clone();
    duplicate.rows[1] = duplicate.rows[0].clone();
    assert!(db.review_purchases(duplicate).is_err());
    let mut wrong = original.clone();
    wrong.rows[1].row_id = Uuid::new_v4().to_string();
    assert!(db.review_purchases(wrong).is_err());
    let mut nochange = original.clone();
    nochange.changes.category_id = None;
    nochange.changes.split_mode = None;
    assert!(db.review_purchases(nochange).is_err());
    let mut no_confirm = original.clone();
    no_confirm.confirmed = false;
    assert!(db.review_purchases(no_confirm).is_err());
    let dbpath = dir.path().join("personal.sqlite");
    let c = rusqlite::Connection::open(dbpath).unwrap();
    c.execute_batch("CREATE TRIGGER reject_review BEFORE INSERT ON purchase_reviews BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END;").unwrap();
    assert!(db
        .review_purchases(original.clone())
        .unwrap_err()
        .contains("synthetic disk failure"));
    assert_eq!(
        db.purchase_review(&source).unwrap().items[0].entry.revision,
        1
    );
    c.execute_batch("DROP TRIGGER reject_review;").unwrap();
    db.review_purchases(original).unwrap();
}
#[test]
fn merchant_review_undo_protects_later_edits_and_new_source_links() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, _) = stage(&mut db, "personal");
    let req = request(&db, &source, Some("groceries"), None);
    db.review_purchases(req.clone()).unwrap();
    let snapshot = db.backup().unwrap();
    let e = db
        .snapshot("2026-10")
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.id == req.rows[0].event_id)
        .unwrap();
    let mut edit = expense("100.00", "jacob");
    edit.id = e.id;
    edit.revision = e.revision;
    edit.date = e.date;
    edit.description = e.description;
    edit.category_id = e.category_id;
    edit.split_mode = "personal".into();
    edit.note = "Keep this later correction".into();
    db.save(edit).unwrap();
    assert!(db.undo_purchase_review(&req.id).is_err());
    db.review_purchases(req.clone()).unwrap(); // a lost response never replays edits
    assert_eq!(
        db.snapshot("2026-10")
            .unwrap()
            .entries
            .iter()
            .find(|e| e.id == req.rows[0].event_id)
            .unwrap()
            .note,
        "Keep this later correction"
    );
    db.restore(&snapshot).unwrap();
    let new_id = Uuid::new_v4().to_string();
    let d = db.import_detail(&source).unwrap();
    db.new_import_observation(&source, d.source.revision, &new_id)
        .unwrap();
    let d = db.import_detail(&new_id).unwrap();
    let mut m = d.mapping;
    m.posted_confirmed = true;
    db.configure_import(&new_id, d.source.revision, "amex", m)
        .unwrap();
    let d = db.import_detail(&new_id).unwrap();
    let row = &d.rows[0];
    let e = &db.purchase_review(&source).unwrap().items[0].entry;
    db.commit_import(
        &new_id,
        d.source.revision,
        &Uuid::new_v4().to_string(),
        vec![crate::imports::types::Decision {
            row_id: row.id.clone(),
            action: "link".into(),
            input: None,
            match_id: Some(e.id.clone()),
            match_revision: Some(e.revision),
            confirmed: true,
            separate: false,
            rule_signature: None,
        }],
    )
    .unwrap();
    assert!(db.undo_purchase_review(&req.id).is_err());
}
#[test]
fn merchant_review_excludes_protected_or_itemized_purchases_and_preserves_normalization_numbers() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, _) = stage(&mut db, "personal");
    let initial = db.purchase_review(&source).unwrap();
    assert_eq!(initial.items[0].merchant, initial.items[1].merchant);
    assert_ne!(initial.items[0].merchant, initial.items[2].merchant);
    let req = request(&db, &source, Some("groceries"), Some("shared"));
    db.review_purchases(req).unwrap();
    let previous = db.purchase_review(&source).unwrap().previous;
    assert_eq!(
        previous
            .iter()
            .find(|c| c.merchant == "neighborhood market")
            .unwrap()
            .split_mode,
        "shared"
    );
    let e = db.purchase_review(&source).unwrap().items[0].entry.clone();
    let mut refund = expense("10.00", "jacob");
    refund.kind = "refund".into();
    refund.original_event_id = Some(e.id);
    refund.date = "2026-10-20".into();
    refund.description = "Synthetic return".into();
    refund.split_mode = "original".into();
    db.save(refund).unwrap();
    let view = db.purchase_review(&source).unwrap();
    assert!(view.items[0].reason.contains("refunds"));
    let request = request(&db, &source, Some("hobbies"), None);
    assert!(db.review_purchases(request).is_err());
}
#[test]
fn merchant_review_migration_recovery_and_workspace_isolation() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, _) = stage(&mut db, "personal");
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_purchase_review_schema(&c);
    c.pragma_update(None, "user_version", 16).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 17000);
    let req = request(&db, &source, Some("groceries"), None);
    db.review_purchases(req.clone()).unwrap();
    let mut demo = Store::open(dir.path(), "demo").unwrap();
    assert!(demo.review_purchases(req.clone()).is_err());
    let backup = db.backup().unwrap();
    let corrupt =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    corrupt
        .execute("UPDATE purchase_reviews SET snapshot_json='[]'", [])
        .unwrap();
    drop(corrupt);
    assert!(db.restore(&backup).unwrap_err().contains("checksum"));
    assert_eq!(
        db.purchase_review(&source).unwrap().items[0].entry.revision,
        2
    );
    db.undo_purchase_review(&req.id).unwrap();
}

#[test]
fn category_only_batch_preserves_an_existing_exact_dollar_override_and_preview_matches_saved_totals(
) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, _) = stage(&mut db, "personal");
    let first = db.purchase_review(&source).unwrap().items[0].entry.clone();
    let mut edit = expense("100.00", "jacob");
    edit.id = first.id.clone();
    edit.revision = first.revision;
    edit.date = first.date;
    edit.description = first.description;
    edit.split_mode = "exact".into();
    edit.split_value = "23.45".into();
    edit.note = "Deliberate exact-dollar override".into();
    db.save(edit).unwrap();
    let req = request(&db, &source, Some("hobbies"), None);
    let preview = db.preview_purchases(req.clone()).unwrap();
    assert_eq!(preview.before_allowance_cents, 7345);
    assert_eq!(preview.after_allowance_cents, 7345);
    assert_eq!(preview.household_change_cents, 0);
    db.review_purchases(req.clone()).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    let saved = s.entries.iter().find(|e| e.id == first.id).unwrap();
    assert_eq!(saved.jacob_cents, 2345);
    assert_eq!(saved.split_value, "23.45");
    assert_eq!(saved.note, "Deliberate exact-dollar override");
    db.undo_purchase_review(&req.id).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 9345);
}

#[test]
fn itemized_and_line_override_purchases_remain_in_review_with_explanation() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, _) = stage(&mut db, "personal");
    let first = db.purchase_review(&source).unwrap().items[0].entry.clone();
    let mut edit = expense("100", "jacob");
    edit.id = first.id;
    edit.revision = first.revision;
    edit.date = first.date;
    edit.description = first.description;
    edit.lines = vec![
        crate::models::LineInput {
            id: "food".into(),
            label: "Food".into(),
            category_id: "groceries".into(),
            amount: "80".into(),
            split_mode: "inherit".into(),
            split_value: String::new(),
            original_line_id: None,
        },
        crate::models::LineInput {
            id: "gift".into(),
            label: "Gift".into(),
            category_id: "gifts".into(),
            amount: "20".into(),
            split_mode: "personal".into(),
            split_value: String::new(),
            original_line_id: None,
        },
    ];
    db.save(edit).unwrap();
    let view = db.purchase_review(&source).unwrap();
    assert!(view.items[0].reason.contains("Itemized"));
    let req = request(&db, &source, Some("hobbies"), Some("equal"));
    assert!(db.preview_purchases(req.clone()).is_err());
    assert!(db.review_purchases(req).is_err());
    assert_eq!(
        db.purchase_review(&source).unwrap().items[0]
            .entry
            .lines
            .len(),
        2
    );
}
