use super::*;
use crate::imports::{parse, types::*};
pub(super) fn stage(db: &mut Store, text: &str, account: &str) -> SourceDetail {
    let p = parse::prepare("test.csv", text.as_bytes(), None).unwrap();
    assert!(p.error.is_empty(), "{}", p.error);
    let id = db.ingest("test.csv", text.as_bytes().to_vec(), p).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(&id, d.source.revision, account, m)
        .unwrap();
    db.import_detail(&id).unwrap()
}
pub(super) fn add(row: &ReviewRow) -> Decision {
    let c = &row.candidate;
    Decision {
        row_id: row.id.clone(),
        action: "add".into(),
        input: Some(EntryInput {
            budget_override: None,
            id: row.id.clone(),
            date: c.date.clone().unwrap_or_default(),
            description: c.description.clone(),
            split_mode: "personal".into(),
            amount: format!(
                "{}.{:02}",
                c.amount_cents.unwrap_or(0) / 100,
                c.amount_cents.unwrap_or(0) % 100
            ),
            ..expense("1", "jacob")
        }),
        match_id: None,
        match_revision: None,
        confirmed: true,
        separate: false,
        rule_signature: None,
    }
}
pub(super) fn commit(
    db: &mut Store,
    d: &SourceDetail,
    decisions: Vec<Decision>,
) -> Result<Receipt, String> {
    db.commit_import(
        &d.source.id,
        d.source.revision,
        &Uuid::new_v4().to_string(),
        decisions,
    )
}
pub(super) fn csv(rows: &str) -> String {
    format!("Date,Description,Amount\n{rows}")
}
#[test]
fn csv_mapping_preserves_signs_quotes_dates_and_pending_status() {
    let p=parse::prepare("export.csv",b"\xef\xbb\xbfTransaction Date,Description,Amount,Status\n11/02/2026,\"Market, Inc\",\"$1,234.56\",Posted\n11/03/2026,Payment,(624.00),Pending\n",None).unwrap();
    assert!(p.error.is_empty());
    let mut m = parse::default_mapping(&p.dataset);
    assert!(parse::validate_mapping(&m, &p.dataset).is_err());
    m.amount_mode = "outflow_positive".into();
    let c = parse::candidate(&p.dataset.rows[0], &m, false);
    assert_eq!(c.date.as_deref(), Some("2026-11-02"));
    assert_eq!(c.amount_cents, Some(123456));
    assert_eq!(c.direction, "out");
    assert_eq!(c.description, "Market, Inc");
    let c = parse::candidate(&p.dataset.rows[1], &m, false);
    assert_eq!(c.amount_cents, Some(62400));
    assert_eq!(c.direction, "in");
    assert_eq!(c.status, "pending");
    for invalid in ["12.345", "1,23.00", "NaN", "1e2", "--10.00"] {
        assert_eq!(parse::signed_cents(invalid), None);
    }
    m.amount_mode = "inflow_positive".into();
    assert_eq!(
        parse::candidate(&p.dataset.rows[0], &m, false).direction,
        "in"
    );
}
#[test]
fn separate_columns_and_missing_year_require_explicit_choices() {
    let d=parse::prepare("bank.tsv",b"Date\tDescription\tDebit\tCredit\n02/11\tPurchase\t12.34\t\n03/11\tAmbiguous\t12.34\t12.34\n",None).unwrap().dataset;
    let mut m = parse::default_mapping(&d);
    m.amount_mode = "separate".into();
    m.debit_column = Some(2);
    m.credit_column = Some(3);
    m.date_format = "day_first".into();
    let c = parse::candidate(&d.rows[0], &m, false);
    assert_eq!(c.date, None);
    assert_eq!(c.status, "unknown");
    m.year = Some(2026);
    m.posted_confirmed = true;
    let c = parse::candidate(&d.rows[0], &m, false);
    assert_eq!(c.date.as_deref(), Some("2026-11-02"));
    assert_eq!(c.amount_cents, Some(1234));
    assert_eq!(c.status, "posted");
    assert_eq!(parse::candidate(&d.rows[1], &m, false).amount_cents, None);
}

#[test]
fn two_digit_years_follow_the_selected_date_order() {
    let d = parse::prepare(
        "short-date.csv",
        b"Date,Description,Amount\n11/02/26,Market,10.00\n",
        None,
    )
    .unwrap()
    .dataset;
    let mut m = parse::default_mapping(&d);
    m.amount_mode = "outflow_positive".into();
    assert_eq!(
        parse::candidate(&d.rows[0], &m, false).date.as_deref(),
        Some("2026-11-02")
    );
    m.date_format = "day_first".into();
    assert_eq!(
        parse::candidate(&d.rows[0], &m, false).date.as_deref(),
        Some("2026-02-11")
    );
}
#[test]
fn repeated_files_do_not_repeat_rows_and_equal_purchases_are_preserved() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let text = csv("2026-11-02,Coffee,10.00\n2026-11-02,Coffee,10.00\n");
    let d = stage(&mut db, &text, "amex");
    assert_eq!(db.snapshot("2026-11").unwrap().incomplete_imports, 1);
    let p = parse::prepare("renamed.csv", text.as_bytes(), None).unwrap();
    assert_eq!(
        db.ingest("renamed.csv", text.as_bytes().to_vec(), p)
            .unwrap(),
        d.source.id
    );
    assert_eq!(db.import_list().unwrap().len(), 1);
    assert_ne!(d.rows[0].id, d.rows[1].id);
    let key = Uuid::new_v4().to_string();
    let decisions = || d.rows.iter().map(add).collect();
    assert_eq!(
        db.commit_import(&d.source.id, d.source.revision, &key, decisions())
            .unwrap()
            .added,
        2
    );
    assert!(
        db.commit_import(&d.source.id, d.source.revision, &key, decisions())
            .unwrap()
            .already_processed
    );
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 2000);
    assert_eq!(db.snapshot("2026-11").unwrap().incomplete_imports, 0);
    drop(db);
    let db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(
        db.import_detail(&d.source.id)
            .unwrap()
            .source
            .imported_count,
        2
    );
}
#[test]
fn atomic_batch_rolls_back_on_bad_last_row_and_retry_is_safe() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let d = stage(&mut db, &csv("2026-11-02,A,10\n2026-11-02,B,20\n"), "amex");
    let mut bad = add(&d.rows[1]);
    bad.input.as_mut().unwrap().category_id = Some("missing".into());
    assert!(commit(&mut db, &d, vec![add(&d.rows[0]), bad]).is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 0);
    assert_eq!(
        db.import_detail(&d.source.id).unwrap().source.pending_count,
        2
    );
    assert_eq!(
        commit(&mut db, &d, d.rows.iter().map(add).collect())
            .unwrap()
            .added,
        2
    );
}
#[test]
fn source_matches_manual_entry_and_screenshot_without_counting_twice() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut manual = expense("12.34", "jacob");
    manual.date = "2026-11-01".into();
    manual.split_mode = "personal".into();
    db.save(manual.clone()).unwrap();
    let d = stage(
        &mut db,
        &csv("2026-11-02,Merchant descriptor,12.34\n"),
        "amex",
    );
    assert_eq!(d.rows[0].matches.len(), 1);
    assert!(commit(&mut db, &d, vec![add(&d.rows[0])]).is_err());
    let mut link = add(&d.rows[0]);
    link.action = "link".into();
    link.input = None;
    link.match_id = Some(manual.id);
    link.match_revision = Some(1);
    assert_eq!(commit(&mut db, &d, vec![link]).unwrap().linked, 1);
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 1);
    let image = vec![255; 4 * 4 * 4];
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::RgbaImage::from_raw(4, 4, image)
        .unwrap()
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let bytes = bytes.into_inner();
    let p = Prepared {
        fingerprint: parse::fingerprint(&bytes, "image").unwrap(),
        format: "image".into(),
        mime: "image/png".into(),
        dataset: parse::ocr_lines(vec!["11/02/2026 Merchant 12.34".into()]),
        error: String::new(),
    };
    let id = db.ingest("screen.png", bytes, p).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(&id, 1, "amex", m).unwrap();
    let d = db.import_detail(&id).unwrap();
    assert_eq!(d.rows[0].matches.len(), 1);
    assert!(!d.rows[0].candidate.warnings.is_empty());
    assert!(d.preview_url.is_some());
}
#[test]
fn card_and_checking_payment_sources_link_one_payment_not_the_purchase_sum() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    for amount in ["100", "100", "100", "100", "224"] {
        let mut e = expense(amount, "jacob");
        e.date = "2026-11-02".into();
        e.split_mode = "personal".into();
        db.save(e).unwrap();
    }
    let d = stage(
        &mut db,
        &csv("2026-11-02,Payment thank you,-624.00\n"),
        "amex",
    );
    assert!(d.rows[0].matches.is_empty());
    let mut payment = add(&d.rows[0]);
    let e = payment.input.as_mut().unwrap();
    e.kind = "card_payment".into();
    e.account_id = Some("checking".into());
    e.destination_account_id = Some("amex".into());
    e.category_id = None;
    e.split_mode = "none".into();
    commit(&mut db, &d, vec![payment]).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(s.spent_cents, 62400);
    assert_eq!(s.income_cents, 0);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        0
    );
    let d = stage(&mut db, &csv("2026-11-03,AMEX AUTOPAY,624\n"), "checking");
    assert_eq!(d.rows[0].matches.len(), 1);
    let m = &d.rows[0].matches[0];
    assert_eq!(m.kind, "card_payment");
    let mut link = add(&d.rows[0]);
    link.action = "link".into();
    link.input = None;
    link.match_id = Some(m.id.clone());
    link.match_revision = Some(m.revision);
    commit(&mut db, &d, vec![link]).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(s.monthly_count, 6);
    assert_eq!(s.spent_cents, 62400);
    assert_eq!(s.income_cents, 0);
}
#[test]
fn pending_credits_wrong_account_and_wrong_direction_cannot_be_silently_imported() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let d = stage(&mut db, &csv("2026-11-02,Refund,-50\n"), "amex");
    assert!(commit(&mut db, &d, vec![add(&d.rows[0])]).is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().income_cents, 0);
    let d = stage(
        &mut db,
        "Date,Description,Amount,Status\n2026-11-02,Pending purchase,50,Pending\n",
        "amex",
    );
    assert!(commit(&mut db, &d, vec![add(&d.rows[0])]).is_err());
    let mut exclude = add(&d.rows[0]);
    exclude.action = "exclude".into();
    exclude.input = None;
    commit(&mut db, &d, vec![exclude]).unwrap();
    let d = stage(&mut db, &csv("2026-11-02,Other account,50\n"), "citi");
    assert!(commit(&mut db, &d, vec![add(&d.rows[0])]).is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 0);
}
#[test]
fn undo_reverts_only_untouched_created_events_and_leaves_source_evidence() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let d = stage(&mut db, &csv("2026-11-02,A,12.34\n"), "amex");
    let op = Uuid::new_v4().to_string();
    db.commit_import(&d.source.id, d.source.revision, &op, vec![add(&d.rows[0])])
        .unwrap();
    let backup = db.backup().unwrap();
    db.undo_import(&op).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 0);
    assert_eq!(
        db.import_detail(&d.source.id).unwrap().source.pending_count,
        1
    );
    assert!(db
        .commit_import(&d.source.id, d.source.revision, &op, vec![add(&d.rows[0])])
        .is_err());
    db.restore(&backup).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 1234);
    let mut edit = add(&d.rows[0]).input.unwrap();
    edit.revision = 1;
    edit.description = "Edited after import".into();
    db.save(edit).unwrap();
    assert!(db.undo_import(&op).is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 1);
}
#[test]
fn remap_and_stale_revision_cannot_erase_import_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let d = stage(&mut db, &csv("2026-11-02,A,10\n"), "amex");
    commit(&mut db, &d, vec![add(&d.rows[0])]).unwrap();
    let updated = db.import_detail(&d.source.id).unwrap();
    assert!(db
        .configure_import(
            &d.source.id,
            updated.source.revision,
            "citi",
            d.mapping.clone()
        )
        .is_err());
    assert!(commit(&mut db, &d, vec![add(&d.rows[0])]).is_err());
    let profile = db.import_profile(&d.source.id, "amex").unwrap().unwrap();
    assert_eq!(profile.amount_mode, "outflow_positive");
    assert!(!profile.posted_confirmed);
    assert_eq!(profile.year, None);
    let demo = Store::open(dir.path(), "demo").unwrap();
    assert!(demo.import_list().unwrap().is_empty());
}
#[test]
fn malformed_sources_ocr_ambiguity_and_image_fingerprints_are_safe() {
    assert!(parse::prepare("file.exe", b"bad", None).is_err());
    assert!(parse::prepare("empty.csv", b"", None).is_err());
    assert!(!parse::prepare("broken.xlsx", b"bad", None)
        .unwrap()
        .error
        .is_empty());
    let d = parse::ocr_lines(vec![
        "11/02/2026 Market $15.00 $945.00".into(),
        "11/03 Cropped merchant".into(),
        "Balance".into(),
    ]);
    assert_eq!(d.rows.len(), 3);
    assert!(d.rows[0][2].is_empty());
    let mut m = parse::default_mapping(&d);
    m.amount_mode = "outflow_positive".into();
    let c = parse::candidate(&d.rows[1], &m, true);
    assert!(c.date.is_none() && c.amount_cents.is_none());
    let img = image::RgbaImage::from_pixel(2, 2, image::Rgba([80, 100, 120, 255]));
    let mut png = std::io::Cursor::new(Vec::new());
    img.write_to(&mut png, image::ImageFormat::Png).unwrap();
    let mut bmp = std::io::Cursor::new(Vec::new());
    img.write_to(&mut bmp, image::ImageFormat::Bmp).unwrap();
    assert_eq!(
        parse::fingerprint(png.get_ref(), "image").unwrap(),
        parse::fingerprint(bmp.get_ref(), "image").unwrap()
    );
}

#[test]
fn excel_dates_do_not_convert_numeric_amounts_to_dates() {
    let p = parse::prepare(
        "fixture.xlsx",
        include_bytes!("../fixtures/import.xlsx"),
        None,
    )
    .unwrap();
    assert!(p.error.is_empty(), "{}", p.error);
    assert_eq!(p.dataset.rows[0][0], "2026-11-02");
    assert_eq!(p.dataset.rows[0][2], "123.45");
}

#[test]
fn restore_rejects_damaged_evidence_or_decisions_without_touching_live_data() {
    for damage in [
        "UPDATE import_evidence SET content=X'000102'",
        "UPDATE import_rows SET candidate_json='broken'",
        "UPDATE import_rows SET commit_id=NULL WHERE disposition='imported'",
        "UPDATE import_commits SET receipt_json='{}'",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path(), "personal").unwrap();
        let d = stage(&mut db, &csv("2026-11-02,A,12.34\n"), "amex");
        commit(&mut db, &d, vec![add(&d.rows[0])]).unwrap();
        let backup = db.backup().unwrap();
        let conn =
            rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
        conn.execute_batch(damage).unwrap();
        drop(conn);
        assert!(db.restore(&backup).is_err(), "{damage}");
        assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 1234);
        assert_eq!(
            db.import_detail(&d.source.id)
                .unwrap()
                .source
                .imported_count,
            1
        );
    }
}

#[test]
fn v3_upgrade_and_restore_keep_transfers_and_add_empty_import_storage() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("personal.sqlite");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("../fixtures/schema_v3.sql"))
        .unwrap();
    conn.execute_batch("INSERT INTO metadata VALUES ('workspace','personal');INSERT INTO accounts VALUES ('checking','Bank','checking',1,0),('amex','Card','credit',1,0);INSERT INTO events(id,revision,kind,date,description,amount_cents,payer,account_id,destination_account_id,split_mode,split_value,jacob_cents,chelsea_cents,household_delta_cents,note) VALUES ('86838cf9-0f3c-4c33-b3f6-49b3e4b4e891',2,'card_payment','2026-11-02','Old payment',62400,'jacob','checking','amex','none','',0,0,0,'Original');INSERT INTO account_activity VALUES ('86838cf9-0f3c-4c33-b3f6-49b3e4b4e891','checking',-62400),('86838cf9-0f3c-4c33-b3f6-49b3e4b4e891','amex',-62400);PRAGMA user_version=3;").unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let legacy = db.list_backups().unwrap().pop().unwrap();
    for restore in [false, true] {
        if restore {
            db.restore(&legacy).unwrap();
        }
        assert!(db.import_list().unwrap().is_empty());
        let s = db.snapshot("2026-11").unwrap();
        assert_eq!(s.monthly_count, 1);
        assert_eq!(s.spent_cents, 0);
        assert_eq!(s.entries[0].revision, 2);
        assert_eq!(s.entries[0].note, "Original");
        assert_eq!(
            s.accounts
                .iter()
                .find(|a| a.id == "amex")
                .unwrap()
                .activity_cents,
            -62400
        );
    }
}

#[test]
fn links_protect_undo_and_one_source_cannot_link_two_occurrences_to_one_event() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let first = stage(&mut db, &csv("2026-11-02,A,12.34\n"), "amex");
    commit(&mut db, &first, vec![add(&first.rows[0])]).unwrap();
    let op = db.import_detail(&first.source.id).unwrap().undo_id.unwrap();
    let second = stage(
        &mut db,
        &csv("2026-11-02,Alias,12.34\n2026-11-02,Alias,12.34\n"),
        "amex",
    );
    let link = |row: &ReviewRow| {
        let mut d = add(row);
        d.action = "link".into();
        d.input = None;
        d.match_id = Some(first.rows[0].id.clone());
        d.match_revision = Some(1);
        d
    };
    assert!(commit(&mut db, &second, second.rows.iter().map(link).collect()).is_err());
    commit(&mut db, &second, vec![link(&second.rows[0])]).unwrap();
    assert!(db.undo_import(&op).is_err());
    let fresh = db.import_detail(&second.source.id).unwrap();
    assert!(commit(&mut db, &fresh, vec![link(&fresh.rows[1])]).is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 1);
}

#[test]
#[ignore = "Requires an installed Windows OCR language; run explicitly for native extraction QA"]
fn windows_ocr_reads_synthetic_transactions_locally() {
    let p = parse::prepare(
        "fixture.png",
        include_bytes!("../fixtures/import-ocr.png"),
        None,
    )
    .unwrap();
    assert!(p.error.is_empty(), "{}", p.error);
    assert!(
        p.dataset
            .rows
            .iter()
            .any(|r| r[1].contains("Neighborhood") && r[2].contains("42.18")),
        "{:?}",
        p.dataset.rows
    );
    assert!(
        p.dataset
            .rows
            .iter()
            .any(|r| r[1].contains("Payment") && r[2].contains("123.42")),
        "{:?}",
        p.dataset.rows
    );
}
