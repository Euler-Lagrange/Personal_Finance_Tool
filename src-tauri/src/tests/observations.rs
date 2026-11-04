use super::*;
use crate::{
    db::{identity::CoverageInput, observations::Pattern},
    imports::{parse, types::Decision},
};
const CSV: &str = "Date,Description,Amount\n2026-10-30,Market,10\n2026-10-30,Market,10\n";
fn stage(db: &mut Store, csv: &str) -> String {
    let p = parse::prepare("download.csv", csv.as_bytes(), None).unwrap();
    db.ingest("download.csv", csv.as_bytes().to_vec(), p)
        .unwrap()
}
fn configure(db: &mut Store, id: &str, account: &str) {
    let d = db.import_detail(id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(id, d.source.revision, account, m)
        .unwrap();
}
fn coverage(end: &str) -> CoverageInput {
    CoverageInput {
        start_date: "2026-10-01".into(),
        end_date: end.into(),
        date_basis: "transaction".into(),
        completeness: "complete".into(),
        profile: "Monthly CSV".into(),
        observed_at: format!("{end}T23:00:00Z"),
        inclusive: true,
    }
}
fn confirm(db: &mut Store, id: &str, c: CoverageInput) {
    let d = db.import_detail(id).unwrap();
    db.confirm_import_coverage(id, d.source.revision, c)
        .unwrap();
}
fn post(db: &mut Store, id: &str) {
    let d = db.import_detail(id).unwrap();
    let mut decisions = Vec::new();
    for r in d.rows {
        let mut e = expense("10", "jacob");
        e.id = r.id.clone();
        e.date = r.candidate.date.unwrap();
        e.description = r.candidate.description;
        e.split_mode = "personal".into();
        e.account_id = d.source.account_id.clone();
        decisions.push(Decision {
            row_id: r.id,
            action: "add".into(),
            input: Some(e),
            match_id: None,
            match_revision: None,
            confirmed: true,
            separate: true,
            rule_signature: None,
        });
    }
    db.commit_import(
        id,
        d.source.revision,
        &Uuid::new_v4().to_string(),
        decisions,
    )
    .unwrap();
}
fn clone_source(db: &mut Store, id: &str) -> String {
    db.new_import_observation(
        id,
        db.import_detail(id).unwrap().source.revision,
        &Uuid::new_v4().to_string(),
    )
    .unwrap()
}
#[test]
fn identical_downloads_share_evidence_keep_ranges_and_reconcile_without_new_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let first = stage(&mut db, CSV);
    configure(&mut db, &first, "amex");
    confirm(&mut db, &first, coverage("2026-10-31"));
    post(&mut db, &first);
    let d = db.import_detail(&first).unwrap();
    assert_eq!(stage(&mut db, CSV), first);
    let next = Uuid::new_v4().to_string();
    assert_eq!(
        db.new_import_observation(&first, d.source.revision, &next)
            .unwrap(),
        next
    );
    assert_eq!(
        db.new_import_observation(&first, d.source.revision, &next)
            .unwrap(),
        next
    );
    let n = db.import_detail(&next).unwrap();
    assert_eq!(n.source.state, "unconfigured");
    assert!(n.source.account_id.is_none() && n.coverage.is_none());
    assert!(!n.mapping.posted_confirmed);
    assert!(n.mapping.year.is_none());
    assert_eq!(
        n.observation.unwrap().suggested_account_id.as_deref(),
        Some("amex")
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 2000);
    configure(&mut db, &next, "amex");
    confirm(&mut db, &next, coverage("2026-11-02"));
    let n = db.import_detail(&next).unwrap();
    assert!(n.overlap.items.iter().all(|i| i.action == "link"));
    db.reconcile_import(&next, n.source.revision, &Uuid::new_v4().to_string())
        .unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 2000);
    assert_eq!(
        db.import_detail(&first)
            .unwrap()
            .coverage
            .unwrap()
            .input
            .end_date,
        "2026-10-31"
    );
    assert!(db.import_detail(&next).unwrap().coverage.unwrap().accepted);
    assert_eq!(stage(&mut db, CSV), next);
    let read_conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    let evidence: (i64, i64) = read_conn
        .query_row(
            "SELECT COUNT(*),SUM(length(content)) FROM import_evidence",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(evidence, (1, CSV.len() as i64));
    drop(read_conn);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert!(db.import_detail(&next).unwrap().coverage.unwrap().accepted);
    assert_eq!(
        db.import_content(&first).unwrap().1,
        db.import_content(&next).unwrap().1
    );
}
#[test]
fn empty_observations_can_cover_distinct_dates_and_accounts_without_invented_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let first = stage(&mut db, "Date,Description,Amount\n");
    configure(&mut db, &first, "amex");
    confirm(&mut db, &first, coverage("2026-10-31"));
    let second = clone_source(&mut db, &first);
    configure(&mut db, &second, "checking");
    confirm(&mut db, &second, coverage("2026-11-02"));
    let third = clone_source(&mut db, &first);
    configure(&mut db, &third, "amex");
    confirm(&mut db, &third, coverage("2026-11-02"));
    for id in [&first, &second, &third] {
        let d = db.import_detail(id).unwrap();
        assert!(d.rows.is_empty());
        assert!(d.coverage.unwrap().accepted);
    }
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
    assert_eq!(
        db.import_detail(&second)
            .unwrap()
            .source
            .account_id
            .as_deref(),
        Some("checking")
    );
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(db.import_list().unwrap().len(), 3);
}
#[test]
fn new_observation_identity_retries_stale_requests_and_workspace_isolation_are_safe() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let first = stage(&mut db, CSV);
    let original = db.import_detail(&first).unwrap().source.revision;
    configure(&mut db, &first, "amex");
    assert!(db
        .new_import_observation(&first, original, &Uuid::new_v4().to_string())
        .is_err());
    assert!(db.new_import_observation(&first, 2, "bad id").is_err());
    assert!(db.new_import_observation(&first, 2, &first).is_err());
    assert_eq!(db.import_list().unwrap().len(), 1);
    let second = clone_source(&mut db, &first);
    assert!(db.new_import_observation(&first, 99, &second).is_err());
    let demo = Store::open(dir.path(), "demo").unwrap();
    assert!(demo.import_list().unwrap().is_empty());
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
}
#[test]
fn saved_download_patterns_require_matching_filters_and_remain_account_layout_scoped() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let first = stage(&mut db, CSV);
    configure(&mut db, &first, "amex");
    let rev = db.import_detail(&first).unwrap().source.revision;
    let mut c = coverage("2026-11-02");
    let p = Pattern {
        kind: "trailing_days".into(),
        days: Some(90),
    };
    assert!(db
        .confirm_import_coverage_with_pattern(&first, rev, c.clone(), Some(p.clone()))
        .is_err());
    assert!(db.import_detail(&first).unwrap().coverage.is_none());
    assert!(db.import_detail(&first).unwrap().download_profile.is_none());
    assert_eq!(db.import_detail(&first).unwrap().source.revision, rev);
    c.start_date = "2026-08-05".into();
    db.confirm_import_coverage_with_pattern(&first, rev, c, Some(p))
        .unwrap();
    let second = clone_source(&mut db, &first);
    configure(&mut db, &second, "amex");
    let d = db.import_detail(&second).unwrap();
    assert!(d.coverage.is_none());
    let p = d.download_profile.unwrap();
    assert_eq!(
        (p.profile.as_str(), p.pattern.days),
        ("Monthly CSV", Some(90))
    );
    configure(&mut db, &second, "checking");
    assert!(db
        .import_detail(&second)
        .unwrap()
        .download_profile
        .is_none());
    let other = stage(&mut db, "Description,Date,Amount\nMarket,2026-10-30,10\n");
    configure(&mut db, &other, "amex");
    assert!(db.import_detail(&other).unwrap().download_profile.is_none());
    let text = "Date,Description,Amount\n2026-10-30,Market,10\n";
    let mut prepared = parse::prepare("ocr.csv", text.as_bytes(), None).unwrap();
    prepared.dataset.image = true;
    let image = db
        .ingest("ocr.csv", text.as_bytes().to_vec(), prepared)
        .unwrap();
    configure(&mut db, &image, "amex");
    assert!(
        db.import_detail(&image).unwrap().download_profile.is_none(),
        "An image cannot inherit a complete-export download profile"
    );
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(
        db.import_detail(&first)
            .unwrap()
            .download_profile
            .unwrap()
            .pattern
            .days,
        Some(90)
    );
}
#[test]
fn month_patterns_handle_leap_boundaries_and_invalid_settings_are_atomic() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = stage(&mut db, "Date,Description,Amount\n");
    configure(&mut db, &id, "amex");
    let mut c = coverage("2024-02-29");
    c.start_date = "2024-02-01".into();
    c.observed_at = "2024-03-05T23:00:00Z".into();
    db.confirm_import_coverage_with_pattern(
        &id,
        db.import_detail(&id).unwrap().source.revision,
        c,
        Some(Pattern {
            kind: "previous_month".into(),
            days: None,
        }),
    )
    .unwrap();
    let mut c = coverage("2026-11-02");
    c.start_date = "2026-11-01".into();
    let rev = db.import_detail(&id).unwrap().source.revision;
    db.confirm_import_coverage_with_pattern(
        &id,
        rev,
        c.clone(),
        Some(Pattern {
            kind: "month_to_date".into(),
            days: None,
        }),
    )
    .unwrap();
    for pattern in [
        Pattern {
            kind: "trailing_days".into(),
            days: None,
        },
        Pattern {
            kind: "trailing_days".into(),
            days: Some(0),
        },
        Pattern {
            kind: "trailing_days".into(),
            days: Some(367),
        },
        Pattern {
            kind: "manual".into(),
            days: Some(5),
        },
    ] {
        let d = db.import_detail(&id).unwrap();
        assert!(db
            .confirm_import_coverage_with_pattern(&id, d.source.revision, c.clone(), Some(pattern))
            .is_err());
        assert_eq!(
            db.import_detail(&id).unwrap().source.revision,
            d.source.revision
        );
    }
}
#[test]
fn corrupted_evidence_observation_ancestry_or_patterns_cannot_replace_current_data() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = stage(&mut db, CSV);
    configure(&mut db, &id, "amex");
    let mut c = coverage("2026-10-31");
    c.start_date = "2026-10-01".into();
    db.confirm_import_coverage_with_pattern(
        &id,
        db.import_detail(&id).unwrap().source.revision,
        c,
        Some(Pattern {
            kind: "month_to_date".into(),
            days: None,
        }),
    )
    .unwrap();
    post(&mut db, &id);
    let next = clone_source(&mut db, &id);
    for sql in [
        "UPDATE import_evidence SET content=X'0001'".into(),
        "UPDATE import_sources SET format='pdf'".into(),
        "UPDATE import_download_profiles SET pattern='trailing_days',days=NULL".into(),
        format!("UPDATE import_observations SET parent_revision=999 WHERE source_id='{next}'"),
        format!("INSERT INTO import_observations VALUES ('{id}','{next}',1)"),
    ] {
        let backup = db.backup().unwrap();
        let conn =
            rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
        conn.execute_batch(&sql).unwrap();
        drop(conn);
        assert!(db.restore(&backup).is_err(), "{sql}");
        assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 2000);
    }
}
#[test]
fn schema_eleven_upgrade_keeps_source_bytes_counts_decisions_and_confirmed_coverage() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = stage(&mut db, CSV);
    configure(&mut db, &id, "amex");
    confirm(&mut db, &id, coverage("2026-10-31"));
    post(&mut db, &id);
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_observation_schema(&conn);
    conn.execute_batch("PRAGMA user_version=11").unwrap();
    conn.backup(
        "main",
        dir.path().join("backups/personal/legacy-v11.sqlite"),
        None,
    )
    .unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.import_content(&id).unwrap().1, CSV.as_bytes());
    assert!(db.import_detail(&id).unwrap().coverage.unwrap().accepted);
    let next = clone_source(&mut db, &id);
    configure(&mut db, &next, "amex");
    confirm(&mut db, &next, coverage("2026-11-02"));
    let d = db.import_detail(&next).unwrap();
    db.reconcile_import(&next, d.source.revision, &Uuid::new_v4().to_string())
        .unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 2000);
    db.restore("legacy-v11.sqlite").unwrap();
    assert_eq!(db.import_list().unwrap().len(), 1);
    assert!(db.import_detail(&id).unwrap().coverage.unwrap().accepted);
    assert_eq!(db.import_content(&id).unwrap().1, CSV.as_bytes());
}
