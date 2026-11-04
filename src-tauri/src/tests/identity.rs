use super::*;
use crate::{
    db::identity::CoverageInput,
    imports::{
        parse,
        types::{Decision, SourceDetail},
    },
};
fn stage(db: &mut Store, csv: &str, stable: bool) -> String {
    let p = parse::prepare("source.csv", csv.as_bytes(), None).unwrap();
    let id = db.ingest("source.csv", csv.as_bytes().to_vec(), p).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    if stable {
        m.stable_id_column = Some(3);
        m.stable_ids_confirmed = true;
    }
    db.configure_import(&id, d.source.revision, "amex", m)
        .unwrap();
    id
}
fn cover(db: &mut Store, id: &str, start: &str, end: &str, observed: &str, completeness: &str) {
    let d = db.import_detail(id).unwrap();
    db.confirm_import_coverage(
        id,
        d.source.revision,
        CoverageInput {
            start_date: start.into(),
            end_date: end.into(),
            date_basis: "transaction".into(),
            completeness: completeness.into(),
            profile: "Amex CSV".into(),
            observed_at: observed.into(),
            inclusive: true,
        },
    )
    .unwrap();
}
fn add(row: &crate::imports::types::ReviewRow) -> Decision {
    let mut e = expense(
        &format!(
            "{}.{:02}",
            row.candidate.amount_cents.unwrap() / 100,
            row.candidate.amount_cents.unwrap() % 100
        ),
        "jacob",
    );
    e.id = row.id.clone();
    e.date = row.candidate.date.clone().unwrap();
    e.description = row.candidate.description.clone();
    e.split_mode = "personal".into();
    Decision {
        row_id: row.id.clone(),
        action: "add".into(),
        input: Some(e),
        match_id: None,
        match_revision: None,
        confirmed: true,
        separate: true,
        rule_signature: None,
    }
}
fn post(db: &mut Store, id: &str, exclude: Option<usize>) -> String {
    let d = db.import_detail(id).unwrap();
    let decisions = d
        .rows
        .iter()
        .filter(|r| r.disposition == "pending")
        .enumerate()
        .map(|(i, r)| {
            let mut decision = add(r);
            decision.input.as_mut().unwrap().account_id = d.source.account_id.clone();
            if Some(i) == exclude {
                decision.action = "exclude".into();
                decision.input = None;
            }
            decision
        })
        .collect();
    let op = Uuid::new_v4().to_string();
    db.commit_import(id, d.source.revision, &op, decisions)
        .unwrap();
    op
}
fn reconcile(db: &mut Store, id: &str) -> String {
    let d = db.import_detail(id).unwrap();
    let op = Uuid::new_v4().to_string();
    db.reconcile_import(id, d.source.revision, &op).unwrap();
    op
}
fn actions(d: &SourceDetail) -> Vec<&str> {
    d.overlap.items.iter().map(|i| i.action.as_str()).collect()
}
#[test]
fn three_complete_overlaps_reuse_identities_preserve_twins_and_add_only_new_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-28,Cafe,10\n2026-10-28,Cafe,10\n2026-10-29,Market,20\n",
        false,
    );
    cover(
        &mut db,
        &a,
        "2026-08-01",
        "2026-10-30",
        "2026-10-30T23:00:00Z",
        "complete",
    );
    post(&mut db, &a, None);
    assert!(db.import_detail(&a).unwrap().coverage.unwrap().accepted);
    let b=stage(&mut db,"Date,Description,Amount\n2026-10-28,Cafe,10\n2026-10-28,Cafe,10\n2026-10-29,Market,20\n2026-10-31,Book,30\n",false);
    cover(
        &mut db,
        &b,
        "2026-08-02",
        "2026-10-31",
        "2026-10-31T23:00:00Z",
        "complete",
    );
    assert_eq!(
        actions(&db.import_detail(&b).unwrap()),
        ["link", "link", "link", "new"]
    );
    let d = db.import_detail(&b).unwrap();
    let op = Uuid::new_v4().to_string();
    let r = db.reconcile_import(&b, d.source.revision, &op).unwrap();
    assert_eq!((r.linked, r.added), (3, 0));
    assert!(
        db.reconcile_import(&b, d.source.revision, &op)
            .unwrap()
            .already_processed
    );
    post(&mut db, &b, None);
    let c=stage(&mut db,"Date,Description,Amount\n2026-10-28,Cafe,10\n2026-10-28,Cafe,10\n2026-10-29,Market,20\n2026-10-31,Book,30\n2026-11-01,Train,40\n",false);
    cover(
        &mut db,
        &c,
        "2026-08-03",
        "2026-11-01",
        "2026-11-01T23:00:00Z",
        "complete",
    );
    assert_eq!(
        actions(&db.import_detail(&c).unwrap()),
        ["link", "link", "link", "link", "new"]
    );
    reconcile(&mut db, &c);
    post(&mut db, &c, None);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 7000);
    assert_eq!(db.snapshot("2026-10").unwrap().entries.len(), 4);
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 4000);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert!(db.import_detail(&c).unwrap().coverage.unwrap().accepted);
}
#[test]
fn stable_ids_preserve_equal_purchases_and_hold_conflicting_or_duplicate_ids() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(
        &mut db,
        "Date,Description,Amount,ID\n2026-10-30,Cafe,10,A\n",
        true,
    );
    post(&mut db, &a, None);
    let b = stage(
        &mut db,
        "Date,Description,Amount,ID\n2026-10-30,Cafe,10,A\n2026-10-30,Cafe,10,B\n",
        true,
    );
    assert_eq!(actions(&db.import_detail(&b).unwrap()), ["link", "new"]);
    reconcile(&mut db, &b);
    post(&mut db, &b, None);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 2000);
    let c=stage(&mut db,"Date,Description,Amount,ID\n2026-10-30,Cafe changed,11,A\n2026-10-30,Cafe,10,C\n2026-10-30,Cafe,10,C\n",true);
    assert_eq!(
        actions(&db.import_detail(&c).unwrap()),
        ["review", "review", "review"]
    );
    let d = db.import_detail(&c).unwrap();
    assert!(db
        .commit_import(
            &c,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            vec![add(&d.rows[0])]
        )
        .is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 2000);
}
#[test]
fn reduced_counts_never_resurrect_an_excluded_twin_in_a_later_complete_export() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-31,Cafe,10\n2026-10-31,Cafe,10\n",
        false,
    );
    cover(
        &mut db,
        &a,
        "2026-10-01",
        "2026-10-31",
        "2026-10-31T23:00:00Z",
        "complete",
    );
    post(&mut db, &a, Some(1));
    let b = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-31,Cafe,10\n",
        false,
    );
    cover(
        &mut db,
        &b,
        "2026-10-01",
        "2026-11-01",
        "2026-11-01T23:00:00Z",
        "complete",
    );
    assert!(!db.import_detail(&b).unwrap().overlap.notices.is_empty());
    reconcile(&mut db, &b);
    let c = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-31,Cafe,10\n2026-10-31,Cafe,10\n2026-11-02,Book,20\n",
        false,
    );
    cover(
        &mut db,
        &c,
        "2026-10-01",
        "2026-11-02",
        "2026-11-02T23:00:00Z",
        "complete",
    );
    assert_eq!(
        actions(&db.import_detail(&c).unwrap()),
        ["link", "review", "new"]
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 1000);
}
#[test]
fn late_additions_stable_interiors_and_old_replays_have_distinct_identity_states() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-10,Old,10\n2026-10-30,Recent,20\n",
        false,
    );
    cover(
        &mut db,
        &a,
        "2026-10-01",
        "2026-10-31",
        "2026-10-31T23:00:00Z",
        "complete",
    );
    post(&mut db, &a, None);
    let b=stage(&mut db,"Date,Description,Amount\n2026-10-10,Old,10\n2026-10-10,Old,10\n2026-10-30,Recent,20\n2026-10-30,Recent,20\n",false);
    cover(
        &mut db,
        &b,
        "2026-10-01",
        "2026-11-01",
        "2026-11-01T23:00:00Z",
        "complete",
    );
    assert_eq!(
        actions(&db.import_detail(&b).unwrap()),
        ["link", "review", "link", "new"]
    );
    let c=stage(&mut db,"Date,Description,Amount\n2026-10-30,Recent,20\n2026-10-30,Recent,20\n2026-10-30,Replay,1\n",false);
    cover(
        &mut db,
        &c,
        "2026-10-01",
        "2026-10-30",
        "2026-10-30T23:00:00Z",
        "complete",
    );
    assert_eq!(
        actions(&db.import_detail(&c).unwrap()),
        ["link", "review", "review"]
    );
}
#[test]
fn source_occurrences_survive_manual_display_edits_and_undo_dependencies() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-30,Market,10\n",
        false,
    );
    cover(
        &mut db,
        &a,
        "2026-10-01",
        "2026-10-31",
        "2026-10-31T23:00:00Z",
        "complete",
    );
    let first = post(&mut db, &a, None);
    let d = db.import_detail(&a).unwrap();
    let mut e = add(&d.rows[0]).input.unwrap();
    e.revision = 1;
    e.description = "Corrected merchant note".into();
    e.amount = "15".into();
    db.save(e).unwrap();
    let b = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-30,Market,10\n2026-11-01,New,25\n",
        false,
    );
    cover(
        &mut db,
        &b,
        "2026-10-01",
        "2026-11-01",
        "2026-11-01T23:00:00Z",
        "complete",
    );
    assert_eq!(actions(&db.import_detail(&b).unwrap()), ["link", "new"]);
    db.save_rule(crate::db::rules::Rule {
        id: Uuid::new_v4().to_string(),
        revision: 0,
        name: "Market".into(),
        merchant: "Market".into(),
        match_mode: "prefix".into(),
        account_id: None,
        description_contains: String::new(),
        category_scope: "any".into(),
        category_action: "set".into(),
        category_id: Some("groceries".into()),
        ownership_action: "set".into(),
        split_mode: "personal".into(),
        split_value: String::new(),
        enabled: true,
    })
    .unwrap();
    let reviewed = db.import_detail(&b).unwrap();
    let mut decision = add(&reviewed.rows[0]);
    decision.action = "apply_rule".into();
    decision.input = None;
    decision.rule_signature = Some(reviewed.rows[0].suggestion.signature.clone());
    assert!(
        db.commit_import(
            &b,
            reviewed.source.revision,
            &Uuid::new_v4().to_string(),
            vec![decision]
        )
        .is_err(),
        "A rule must not recreate an edited occurrence"
    );
    assert!(!reviewed.rows[0].suggestion.ready);
    let second = reconcile(&mut db, &b);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 1500);
    assert!(db.undo_import(&first).unwrap_err().contains("later import"));
    db.undo_import(&second).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 1500);
}
#[test]
fn partial_and_different_profiles_require_review_instead_of_count_matching() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-30,Cafe,10\n",
        false,
    );
    cover(
        &mut db,
        &a,
        "2026-10-01",
        "2026-10-31",
        "2026-10-31T23:00:00Z",
        "complete",
    );
    post(&mut db, &a, None);
    for (i, kind) in ["partial", "incremental"].iter().enumerate() {
        let b = stage(
            &mut db,
            &format!("Date,Description,Amount\n2026-10-30,Cafe,10\n2026-11-01,New,{i}.01\n"),
            false,
        );
        cover(
            &mut db,
            &b,
            "2026-10-01",
            "2026-11-01",
            "2026-11-01T23:00:00Z",
            kind,
        );
        assert_eq!(
            db.import_detail(&b).unwrap().overlap.items[0].action,
            "review"
        );
    }
}
#[test]
fn empty_complete_ranges_are_valid_evidence_not_row_date_inferences() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(&mut db, "Date,Description,Amount\n", false);
    cover(
        &mut db,
        &a,
        "2026-10-01",
        "2026-10-31",
        "2026-10-31T23:00:00Z",
        "complete",
    );
    let c = db.import_detail(&a).unwrap().coverage.unwrap();
    assert!(c.accepted);
    assert!(c.newest_activity_date.is_none());
    let b = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-10,Old,10\n2026-10-30,Late,20\n",
        false,
    );
    cover(
        &mut db,
        &b,
        "2026-10-01",
        "2026-11-01",
        "2026-11-01T23:00:00Z",
        "complete",
    );
    assert_eq!(actions(&db.import_detail(&b).unwrap()), ["review", "new"]);
}

fn coverage_input() -> CoverageInput {
    CoverageInput {
        start_date: "2026-10-01".into(),
        end_date: "2026-10-31".into(),
        date_basis: "transaction".into(),
        completeness: "complete".into(),
        profile: "Amex CSV".into(),
        observed_at: "2026-10-31T23:00:00Z".into(),
        inclusive: true,
    }
}
#[test]
fn posted_basis_uses_only_final_day_as_settling_window_and_profiles_stay_separate() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a=stage(&mut db,"Date,Description,Amount,Posted Date\n2026-10-28,Cafe,10,2026-10-30\n2026-10-29,Market,20,2026-10-31\n",false);
    let d = db.import_detail(&a).unwrap();
    assert_eq!(d.mapping.posted_date_column, Some(3));
    let mut c = coverage_input();
    c.date_basis = "posted".into();
    db.confirm_import_coverage(&a, d.source.revision, c.clone())
        .unwrap();
    post(&mut db, &a, None);
    let b=stage(&mut db,"Date,Description,Amount,Posted Date\n2026-10-28,Cafe,10,2026-10-30\n2026-10-28,Cafe,10,2026-10-30\n2026-10-29,Market,20,2026-10-31\n2026-10-29,Market,20,2026-10-31\n",false);
    c.end_date = "2026-11-01".into();
    c.observed_at = "2026-11-01T23:00:00Z".into();
    db.confirm_import_coverage(&b, db.import_detail(&b).unwrap().source.revision, c.clone())
        .unwrap();
    assert_eq!(
        actions(&db.import_detail(&b).unwrap()),
        ["link", "review", "link", "new"]
    );
    c.profile = "Different filters".into();
    db.confirm_import_coverage(&b, db.import_detail(&b).unwrap().source.revision, c.clone())
        .unwrap();
    assert_eq!(
        actions(&db.import_detail(&b).unwrap()),
        ["review", "review", "review", "review"]
    );
    c.profile = "Amex CSV".into();
    c.date_basis = "transaction".into();
    db.confirm_import_coverage(&b, db.import_detail(&b).unwrap().source.revision, c)
        .unwrap();
    assert_eq!(
        actions(&db.import_detail(&b).unwrap()),
        ["review", "review", "review", "review"]
    );
}
#[test]
fn confirmed_ids_are_scoped_to_accounts_and_removed_occurrences_stay_removed() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(
        &mut db,
        "Date,Description,Amount,ID\n2026-10-30,Cafe,10,A\n",
        true,
    );
    let first = post(&mut db, &a, None);
    let d = db.import_detail(&a).unwrap();
    let e = d.rows[0].event_id.clone().unwrap();
    db.delete(&e, 1).unwrap();
    let b = stage(
        &mut db,
        "Date,Description,Amount,ID\n2026-10-30,Cafe,10,A\n2026-10-31,Book,20,B\n",
        true,
    );
    assert_eq!(actions(&db.import_detail(&b).unwrap()), ["exclude", "new"]);
    let later = reconcile(&mut db, &b);
    assert!(db.undo_import(&first).unwrap_err().contains("later import"));
    db.undo_import(&later).unwrap();
    let d = db.import_detail(&b).unwrap();
    db.configure_import(&b, d.source.revision, "checking", d.mapping)
        .unwrap();
    assert_eq!(actions(&db.import_detail(&b).unwrap()), ["new", "new"]);
    post(&mut db, &b, None);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 3000);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
}
#[test]
fn coverage_confirmation_is_explicit_revision_guarded_and_invalidated_by_remapping() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-30,Cafe,10\n",
        false,
    );
    let d = db.import_detail(&a).unwrap();
    assert!(d.coverage.is_none());
    for field in ["range", "time", "basis", "inclusive", "profile"] {
        let mut c = coverage_input();
        match field {
            "range" => c.start_date = "2026-11-01".into(),
            "time" => c.observed_at = "2026-10-01T23:00:00Z".into(),
            "basis" => c.date_basis = "posted".into(),
            "inclusive" => c.inclusive = false,
            _ => c.profile = "".into(),
        }
        assert!(db
            .confirm_import_coverage(&a, d.source.revision, c)
            .is_err());
        assert!(db.import_detail(&a).unwrap().coverage.is_none());
    }
    db.confirm_import_coverage(&a, d.source.revision, coverage_input())
        .unwrap();
    assert!(db
        .confirm_import_coverage(&a, d.source.revision, coverage_input())
        .is_err());
    let d = db.import_detail(&a).unwrap();
    db.configure_import(&a, d.source.revision, "amex", d.mapping)
        .unwrap();
    assert!(db.import_detail(&a).unwrap().coverage.is_none());
    let d = db.import_detail(&a).unwrap();
    db.confirm_import_coverage(&a, d.source.revision, coverage_input())
        .unwrap();
    post(&mut db, &a, None);
    let d = db.import_detail(&a).unwrap();
    assert!(db
        .confirm_import_coverage(&a, d.source.revision, coverage_input())
        .unwrap_err()
        .contains("Processed coverage"));
}
#[test]
fn non_usd_and_unreliable_ids_cannot_be_reconciled_or_posted_as_usd() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a=stage(&mut db,"Date,Description,Amount,ID,Currency\n2026-10-30,Cafe,10,A,EUR\n2026-10-30,Market,20,,USD\n",true);
    let d = db.import_detail(&a).unwrap();
    assert_eq!(actions(&d), ["review", "review"]);
    assert!(db
        .commit_import(
            &a,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            vec![add(&d.rows[0])]
        )
        .err()
        .unwrap()
        .contains("USD"));
    assert!(db
        .reconcile_import(&a, d.source.revision, &Uuid::new_v4().to_string())
        .is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
}
#[test]
fn corrupted_coverage_or_alias_provenance_cannot_replace_active_records() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(
        &mut db,
        "Date,Description,Amount,ID\n2026-10-30,Cafe,10,A\n",
        true,
    );
    let d = db.import_detail(&a).unwrap();
    db.confirm_import_coverage(&a, d.source.revision, coverage_input())
        .unwrap();
    post(&mut db, &a, None);
    for sql in [
        "UPDATE import_coverage SET layout_hash='fake'",
        "UPDATE import_stable_ids SET stable_id='invented'",
        "UPDATE import_coverage SET date_basis='posted'",
        "UPDATE import_occurrences SET account_id='checking'",
    ] {
        let backup = db.backup().unwrap();
        let c =
            rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
        c.execute_batch(sql).unwrap();
        drop(c);
        assert!(db.restore(&backup).is_err(), "{sql}");
        assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 1000);
    }
}
#[test]
fn schema_ten_upgrade_backfills_old_occurrences_and_preserves_source_decisions() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-30,Cafe,10\n2026-10-30,Cafe,10\n",
        false,
    );
    post(&mut db, &a, Some(1));
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_identity_schema(&c);
    c.execute_batch("PRAGMA user_version=10").unwrap();
    c.backup(
        "main",
        dir.path().join("backups/personal/legacy-v10.sqlite"),
        None,
    )
    .unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let d = db.import_detail(&a).unwrap();
    assert_eq!((d.source.imported_count, d.source.excluded_count), (1, 1));
    assert!(d.coverage.is_none());
    db.confirm_import_coverage(&a, d.source.revision, coverage_input())
        .unwrap();
    assert!(db.import_detail(&a).unwrap().coverage.unwrap().accepted);
    let b = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-30,Cafe,10\n2026-10-30,Cafe,10\n2026-11-01,Book,20\n",
        false,
    );
    cover(
        &mut db,
        &b,
        "2026-10-01",
        "2026-11-01",
        "2026-11-01T23:00:00Z",
        "complete",
    );
    assert_eq!(
        actions(&db.import_detail(&b).unwrap()),
        ["link", "exclude", "new"]
    );
    reconcile(&mut db, &b);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 1000);
    db.restore("legacy-v10.sqlite").unwrap();
    assert!(db.import_detail(&a).unwrap().coverage.is_none());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 1000);
}

#[test]
fn importing_an_older_accepted_observation_does_not_replace_the_newer_baseline() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let newer = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-30,Cafe,10\n2026-10-30,Cafe,10\n",
        false,
    );
    cover(
        &mut db,
        &newer,
        "2026-10-01",
        "2026-11-02",
        "2026-11-02T23:00:00Z",
        "complete",
    );
    post(&mut db, &newer, None);
    let older = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-30,Cafe,10\n",
        false,
    );
    cover(
        &mut db,
        &older,
        "2026-10-01",
        "2026-11-01",
        "2026-11-01T23:00:00Z",
        "complete",
    );
    reconcile(&mut db, &older);
    assert!(db.import_detail(&older).unwrap().coverage.unwrap().accepted);
    let latest = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-30,Cafe,10\n2026-10-30,Cafe,10\n2026-11-02,Book,20\n",
        false,
    );
    cover(
        &mut db,
        &latest,
        "2026-10-01",
        "2026-11-02",
        "2026-11-02T23:30:00Z",
        "complete",
    );
    assert_eq!(
        actions(&db.import_detail(&latest).unwrap()),
        ["link", "link", "new"]
    );
    let d = db.import_detail(&latest).unwrap();
    assert!(db
        .reconcile_import(&latest, d.source.revision - 1, &Uuid::new_v4().to_string())
        .is_err());
    assert_eq!(db.import_detail(&latest).unwrap().source.pending_count, 3);
    reconcile(&mut db, &latest);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 2000);
}
#[test]
fn image_sources_cannot_claim_complete_coverage() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let csv = "Date,Description,Amount\n2026-10-30,Cafe,10\n";
    let mut prepared = parse::prepare("screen.csv", csv.as_bytes(), None).unwrap();
    prepared.dataset.image = true;
    let id = db
        .ingest("screen.csv", csv.as_bytes().to_vec(), prepared)
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.posted_confirmed = true;
    m.amount_mode = "outflow_positive".into();
    db.configure_import(&id, d.source.revision, "amex", m)
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    assert!(db
        .confirm_import_coverage(&id, d.source.revision, coverage_input())
        .unwrap_err()
        .contains("Images"));
    let mut c = coverage_input();
    c.completeness = "partial".into();
    db.confirm_import_coverage(&id, d.source.revision, c)
        .unwrap();
    assert!(!db.import_detail(&id).unwrap().coverage.unwrap().accepted);
}

#[test]
fn saved_midnight_coverage_restores_without_reinterpreting_the_source_timezone() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-30,Market,10\n",
        false,
    );
    cover(
        &mut db,
        &id,
        "2026-10-01",
        "2026-10-31",
        "2026-10-31T23:00:00Z",
        "complete",
    );
    post(&mut db, &id, None);
    // Recreate the persisted UTC timestamp of a legitimate 00:30 observation
    // made on Oct 31 in UTC+14. Old records never retained the source timezone.
    let original = chrono::DateTime::parse_from_rfc3339("2026-10-31T00:30:00+14:00").unwrap();
    assert_eq!(original.date_naive().to_string(), "2026-10-31");
    let normalized = original
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    conn.execute(
        "UPDATE import_coverage SET observed_at=?1 WHERE source_id=?2",
        rusqlite::params![normalized, id],
    )
    .unwrap();
    let backup = db.backup().unwrap();
    db.restore(&backup)
        .expect("a valid source-day observation must survive recovery on another timezone");
    assert!(db.import_detail(&id).unwrap().coverage.unwrap().accepted);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 1000);

    // A time too early to cover Oct 31 in any supported civil timezone is
    // corrupt, rather than a reason to accept arbitrary historical dates.
    conn.execute(
        "UPDATE import_coverage SET observed_at='2026-10-29T10:30:00.000Z' WHERE source_id=?1",
        [&id],
    )
    .unwrap();
    let invalid = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert!(db.restore(&invalid).is_err());
    assert!(db.import_detail(&id).unwrap().coverage.unwrap().accepted);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 1000);
    let exported = db
        .export_handoff(
            &Uuid::new_v4().to_string(),
            "Timezone fixture",
            "synthetic timezone passphrase".into(),
        )
        .unwrap();
    let bytes = std::fs::read(exported.path).unwrap();
    let laptop_dir = tempfile::tempdir().unwrap();
    let mut laptop = Store::open(laptop_dir.path(), "personal").unwrap();
    let review = laptop
        .preview_handoff(&bytes, "synthetic timezone passphrase".into())
        .unwrap();
    laptop
        .apply_handoff(
            &Uuid::new_v4().to_string(),
            &bytes,
            "synthetic timezone passphrase".into(),
            &review.token,
            true,
            true,
        )
        .unwrap();
    assert!(
        laptop
            .import_detail(&id)
            .unwrap()
            .coverage
            .unwrap()
            .accepted
    );
    assert_eq!(laptop.snapshot("2026-10").unwrap().spent_cents, 1000);
}
