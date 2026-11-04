use super::*;
use crate::{
    db::{
        classification::{Policy, Preferences, TypeCode},
        identity::{CoverageInput, CoverageRequest},
        observations::Pattern,
    },
    imports::parse,
};

fn request(profile: &str) -> CoverageRequest {
    CoverageRequest {
        input: CoverageInput {
            start_date: "2026-10-01".into(),
            end_date: "2026-10-30".into(),
            date_basis: "transaction".into(),
            completeness: "complete".into(),
            profile: profile.into(),
            observed_at: "2026-10-30T23:00:00Z".into(),
            inclusive: true,
        },
        pattern: Some(Pattern {
            kind: "manual".into(),
            days: None,
        }),
        process_saved_defaults: true,
    }
}
fn policy() -> Policy {
    Policy {
        ordinary_card_charges: true,
        ownership: "shared".into(),
        types: vec![TypeCode {
            account_id: None,
            code: "REWARD".into(),
            kind: "reward".into(),
        }],
    }
}
fn stage(db: &mut Store, body: &str, account: &str) -> String {
    let bytes = format!("Date,Description,Amount,ID,Type,Status\n{body}").into_bytes();
    let prepared = parse::prepare("fixture.csv", &bytes, None).unwrap();
    let id = db.ingest("fixture.csv", bytes, prepared).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.type_column = Some(4);
    m.status_column = Some(5);
    m.stable_id_column = Some(3);
    m.stable_ids_confirmed = true;
    db.configure_import(&id, d.source.revision, account, m)
        .unwrap();
    id
}
fn finalize(db: &mut Store, id: &str, r: CoverageRequest) -> crate::imports::types::Receipt {
    let rev = db.import_detail(id).unwrap().source.revision;
    db.finalize_import_coverage(id, rev, &Uuid::new_v4().to_string(), r)
        .unwrap()
}
fn remember(db: &mut Store, id: &str, p: Policy, automatic: bool) -> String {
    let rev = db.import_detail(id).unwrap().source.revision;
    let operation = Uuid::new_v4().to_string();
    db.process_import_with_preferences(
        id,
        rev,
        &operation,
        p,
        Some(Preferences {
            remember: true,
            automatic,
        }),
    )
    .unwrap();
    operation
}
fn seed(db: &mut Store) -> String {
    let id = stage(db, "2026-10-10,Market,100,A,,posted\n", "amex");
    assert_eq!(finalize(db, &id, request("Monthly CSV")).added, 0);
    remember(db, &id, policy(), true);
    id
}

#[test]
fn saved_defaults_process_next_export_and_preserve_edits_through_overlap_and_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let first = seed(&mut db);
    let original = db.snapshot("2026-10").unwrap().entries.remove(0);
    let mut edit = expense("100", "jacob");
    edit.id = original.id.clone();
    edit.revision = original.revision;
    edit.date = original.date.clone();
    edit.description = "Manually corrected description".into();
    edit.account_id = Some("amex".into());
    edit.split_mode = "personal".into();
    db.save(edit).unwrap();
    let next = stage(&mut db, "2026-10-10,Market,100,A,,posted\n2026-10-12,New store,20,B,,posted\n2026-10-13,Card reward,-5,C,REWARD,posted\n2026-10-14,Payment,-30,D,PAYMENT,posted\n2026-10-15,Future charge,9,E,,pending\n2026-10-16,Bad amount,??,F,,posted\n", "amex");
    let before = db.import_detail(&next).unwrap();
    assert!(before.coverage.is_none());
    assert!(before.classification_profile.unwrap().automatic);
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 1);
    let receipt = finalize(&mut db, &next, request("Monthly CSV"));
    assert_eq!((receipt.added, receipt.linked, receipt.excluded), (3, 1, 1));
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 11400);
    assert_eq!(s.household_cents, 600);
    assert_eq!(s.card_reward_cents, 500);
    assert_eq!(s.unclassified_count, 1);
    assert_eq!(s.income_cents, 0);
    let e = s.entries.iter().find(|e| e.id == original.id).unwrap();
    assert_eq!(e.description, "Manually corrected description");
    assert_eq!(e.category_id.as_deref(), Some("groceries"));
    assert_eq!(e.split_mode, "personal");
    assert_eq!(db.import_detail(&next).unwrap().source.pending_count, 1);
    db.restore(&db.backup().unwrap()).unwrap();
    assert!(
        db.import_detail(&first)
            .unwrap()
            .classification_profile
            .unwrap()
            .automatic
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 11400);
}

#[test]
fn reusable_defaults_are_scoped_to_account_mapping_profile_and_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    seed(&mut db);
    let other = stage(&mut db, "2026-10-11,Other card,15,B,,posted\n", "citi");
    assert!(db
        .import_detail(&other)
        .unwrap()
        .classification_profile
        .is_none());
    assert_eq!(finalize(&mut db, &other, request("Monthly CSV")).added, 0);
    let profile = stage(&mut db, "2026-10-12,Other filters,16,C,,posted\n", "amex");
    assert_eq!(
        finalize(&mut db, &profile, request("Other filters")).added,
        0
    );
    assert!(db
        .import_detail(&profile)
        .unwrap()
        .classification_profile
        .is_none());
    let layout = stage(&mut db, "2026-10-13,Other mapping,-17,D,,posted\n", "amex");
    let d = db.import_detail(&layout).unwrap();
    let mut mapping = d.mapping;
    mapping.amount_mode = "inflow_positive".into();
    db.configure_import(&layout, d.source.revision, "amex", mapping)
        .unwrap();
    assert_eq!(finalize(&mut db, &layout, request("Monthly CSV")).added, 0);
    let mut sample = Store::open(dir.path(), "demo").unwrap();
    let id = stage(
        &mut sample,
        "2026-10-14,Other workspace,18,E,,posted\n",
        "amex",
    );
    assert!(sample
        .import_detail(&id)
        .unwrap()
        .classification_profile
        .is_none());
    assert_eq!(finalize(&mut sample, &id, request("Monthly CSV")).added, 0);
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 1);
}

#[test]
fn coverage_and_processing_rollback_together_then_retry_once_and_undo_without_losing_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    seed(&mut db);
    let id = stage(&mut db, "2026-10-12,New store,20,B,,posted\n", "amex");
    let revision = db.import_detail(&id).unwrap().source.revision;
    let operation = Uuid::new_v4().to_string();
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_test BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;").unwrap();
    assert!(db
        .finalize_import_coverage(&id, revision, &operation, request("Monthly CSV"))
        .err()
        .unwrap()
        .contains("synthetic write failure"));
    let d = db.import_detail(&id).unwrap();
    assert!(d.coverage.is_none());
    assert!(d.undo_id.is_none());
    assert_eq!(d.source.revision, revision);
    assert_eq!(d.source.pending_count, 1);
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 1);
    conn.execute_batch("DROP TRIGGER fail_test;").unwrap();
    let r = db
        .finalize_import_coverage(&id, revision, &operation, request("Monthly CSV"))
        .unwrap();
    assert_eq!(r.added, 1);
    assert!(
        db.finalize_import_coverage(&id, revision, &operation, request("Monthly CSV"))
            .unwrap()
            .already_processed
    );
    let mut changed = request("Monthly CSV");
    changed.process_saved_defaults = false;
    assert!(db
        .finalize_import_coverage(&id, revision, &operation, changed)
        .is_err());
    assert!(db
        .finalize_import_coverage(
            &id,
            revision,
            &Uuid::new_v4().to_string(),
            request("Monthly CSV")
        )
        .is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 8400);
    db.undo_import(&operation).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 7000);
    assert!(
        db.import_detail(&id)
            .unwrap()
            .classification_profile
            .unwrap()
            .automatic
    );
    assert!(db
        .finalize_import_coverage(&id, revision, &operation, request("Monthly CSV"))
        .is_err());
    assert_eq!(finalize(&mut db, &id, request("Monthly CSV")).added, 1);
}

#[test]
fn pause_once_does_not_disable_profile_and_settings_can_be_saved_without_pending_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let first = seed(&mut db);
    let paused = stage(&mut db, "2026-10-12,Paused store,20,B,,posted\n", "amex");
    let mut req = request("Monthly CSV");
    req.process_saved_defaults = false;
    assert_eq!(finalize(&mut db, &paused, req).added, 0);
    assert!(
        db.import_detail(&paused)
            .unwrap()
            .classification_profile
            .unwrap()
            .automatic
    );
    assert_eq!(db.import_detail(&paused).unwrap().source.pending_count, 1);
    let revision = db.import_detail(&paused).unwrap().source.revision;
    let mut local_policy = policy();
    local_policy.ownership = "personal".into();
    db.process_import_with_preferences(
        &paused,
        revision,
        &Uuid::new_v4().to_string(),
        local_policy,
        Some(Preferences {
            remember: false,
            automatic: false,
        }),
    )
    .unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 9000);
    assert_eq!(
        db.import_detail(&paused)
            .unwrap()
            .classification_profile
            .unwrap()
            .policy
            .ownership,
        "shared"
    );
    remember(&mut db, &first, policy(), false);
    let third = stage(&mut db, "2026-10-13,Manual next,30,C,,posted\n", "amex");
    assert_eq!(finalize(&mut db, &third, request("Monthly CSV")).added, 0);
    assert!(
        !db.import_detail(&third)
            .unwrap()
            .classification_profile
            .unwrap()
            .automatic
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 9000);
}

#[test]
fn remapping_clears_source_policy_and_invalid_saved_policy_cannot_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = seed(&mut db);
    while let Some(operation) = db.import_detail(&id).unwrap().undo_id {
        db.undo_import(&operation).unwrap();
    }
    let d = db.import_detail(&id).unwrap();
    assert!(d.classification_policy.is_some());
    db.configure_import(&id, d.source.revision, "citi", d.mapping)
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    assert!(d.classification_policy.is_none());
    assert!(d.classification_profile.is_none());
    let backup = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    conn.execute(
        "UPDATE import_classification_profiles SET policy_json='{}'",
        [],
    )
    .unwrap();
    drop(conn);
    assert!(db.restore(&backup).is_err());
    assert_eq!(
        db.import_detail(&id).unwrap().source.account_id.as_deref(),
        Some("citi")
    );
}

#[test]
fn schema14_upgrade_preserves_ledger_and_has_no_unapproved_automatic_profiles() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut prior = expense("40", "jacob");
    prior.date = "2026-10-10".into();
    db.save(prior).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_profile_schema(&conn);
    conn.pragma_update(None, "user_version", 14).unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = stage(&mut db, "2026-10-14,Fresh merchant,20,A,,posted\n", "amex");
    assert_eq!(finalize(&mut db, &id, request("Monthly CSV")).added, 0);
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 1);
    db.restore(&db.backup().unwrap()).unwrap();
}

#[test]
fn merchant_sharing_rules_never_turn_verified_rewards_into_shared_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    seed(&mut db);
    db.save_rule(crate::db::rules::Rule {
        id: Uuid::new_v4().to_string(),
        revision: 0,
        name: "Shared merchant".into(),
        merchant: "Market".into(),
        match_mode: "exact".into(),
        account_id: Some("amex".into()),
        description_contains: String::new(),
        category_scope: "any".into(),
        category_action: "set".into(),
        category_id: Some("groceries".into()),
        ownership_action: "set".into(),
        split_mode: "shared".into(),
        split_value: String::new(),
        enabled: true,
    })
    .unwrap();
    let id = stage(&mut db, "2026-10-20,Market,-5,R,REWARD,posted\n", "amex");
    assert_eq!(finalize(&mut db, &id, request("Monthly CSV")).added, 1);
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 7000);
    assert_eq!(s.household_cents, 3000);
    assert_eq!(s.card_reward_cents, 500);
    let reward = s.entries.iter().find(|e| e.kind == "reward").unwrap();
    assert_eq!(reward.split_mode, "none");
    assert!(reward.category_id.is_none());
    assert_eq!(reward.household_delta_cents, 0);
    db.restore(&db.backup().unwrap()).unwrap();
}

#[test]
fn empty_confirmed_export_can_save_reusable_defaults_without_inventing_activity() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = stage(&mut db, "", "amex");
    let r = finalize(&mut db, &id, request("Empty then active"));
    assert_eq!((r.added, r.linked, r.excluded), (0, 0, 0));
    assert!(db.import_detail(&id).unwrap().coverage.unwrap().accepted);
    let revision = db.import_detail(&id).unwrap().source.revision;
    let operation = remember(&mut db, &id, policy(), true);
    let retry = db
        .process_import_with_preferences(
            &id,
            revision,
            &operation,
            policy(),
            Some(Preferences {
                remember: true,
                automatic: true,
            }),
        )
        .unwrap();
    assert!(retry.already_processed);
    assert!(db
        .process_import_with_preferences(
            &id,
            revision,
            &operation,
            policy(),
            Some(Preferences {
                remember: true,
                automatic: false
            }),
        )
        .is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
    let next = stage(&mut db, "2026-10-30,First activity,20,A,,posted\n", "amex");
    assert_eq!(
        finalize(&mut db, &next, request("Empty then active")).added,
        1
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 1400);
}
