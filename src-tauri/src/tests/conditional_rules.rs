use super::*;
use crate::{
    db::{
        classification::Policy,
        identity::CoverageInput,
        rules::{CategoryContext, Rule},
    },
    imports::{parse, types::*},
};
fn rule(scope: &str, category: &str) -> Rule {
    Rule {
        id: Uuid::new_v4().to_string(),
        revision: 0,
        name: format!("Bistro {scope}"),
        merchant: "Bistro".into(),
        match_mode: "prefix".into(),
        account_id: None,
        description_contains: String::new(),
        category_scope: scope.into(),
        category_action: "set".into(),
        category_id: Some(category.into()),
        ownership_action: "leave".into(),
        split_mode: String::new(),
        split_value: String::new(),
        enabled: true,
    }
}
fn stage(db: &mut Store, text: &str) -> String {
    let prepared = parse::prepare("conditional.csv", text.as_bytes(), None).unwrap();
    let id = db
        .ingest("conditional.csv", text.as_bytes().to_vec(), prepared)
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut mapping = d.mapping;
    mapping.posted_confirmed = true;
    mapping.amount_mode = "outflow_positive".into();
    db.configure_import(&id, d.source.revision, "amex", mapping)
        .unwrap();
    id
}
fn coverage(db: &mut Store, id: &str) {
    let d = db.import_detail(id).unwrap();
    db.confirm_import_coverage(
        id,
        d.source.revision,
        CoverageInput {
            start_date: "2026-10-01".into(),
            end_date: "2026-10-30".into(),
            date_basis: "transaction".into(),
            completeness: "complete".into(),
            profile: "Conditional synthetic".into(),
            observed_at: "2026-10-30T23:00:00Z".into(),
            inclusive: true,
        },
    )
    .unwrap();
}
fn category(db: &Store, id: &str, mode: &str, value: &str) -> Option<String> {
    let row = db.import_detail(id).unwrap().rows[0].id.clone();
    db.suggest_categories(
        id,
        vec![CategoryContext {
            row_id: row,
            split_mode: mode.into(),
            split_value: value.into(),
            amount: "100.00".into(),
        }],
    )
    .unwrap()
    .remove(0)
    .category_id
}
fn bulk(row: &ReviewRow) -> Decision {
    let mut input = expense(
        &format!(
            "{}.{:02}",
            row.candidate.amount_cents.unwrap() / 100,
            row.candidate.amount_cents.unwrap() % 100
        ),
        "jacob",
    );
    input.id = row.id.clone();
    input.date = row.candidate.date.clone().unwrap();
    input.description = row.candidate.description.clone();
    Decision {
        row_id: row.id.clone(),
        action: "bulk_expense".into(),
        input: Some(input),
        match_id: None,
        match_revision: None,
        confirmed: true,
        separate: false,
        rule_signature: None,
    }
}
#[test]
fn conditional_categories_follow_effective_source_sharing_and_unknown_sharing_stays_provisional() {
    for ownership in ["personal", "shared", "ask"] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path(), "personal").unwrap();
        db.save_rule(rule("personal", "personal")).unwrap();
        db.save_rule(rule("shared", "dining")).unwrap();
        let id = stage(
            &mut db,
            "Date,Description,Amount\n2026-10-10,Bistro main,100\n",
        );
        coverage(&mut db, &id);
        let d = db.import_detail(&id).unwrap();
        db.process_import(
            &id,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            Policy {
                ordinary_card_charges: true,
                ownership: ownership.into(),
                types: vec![],
            },
        )
        .unwrap();
        let s = db.snapshot("2026-10").unwrap();
        let e = &s.entries[0];
        match ownership {
            "personal" => {
                assert_eq!(e.category_id.as_deref(), Some("personal"));
                assert_eq!(s.spent_cents, 10000);
            }
            "shared" => {
                assert_eq!(e.category_id.as_deref(), Some("dining"));
                assert_eq!(s.spent_cents, 7000);
            }
            _ => {
                assert_eq!(
                    e.pending.as_ref().unwrap().category_id.as_deref(),
                    Some("uncategorized")
                );
                assert_eq!(s.provisional_allowance_cents, 10000);
                assert_eq!(s.household_cents, 0);
            }
        }
        assert_eq!(
            s.accounts
                .iter()
                .find(|a| a.id == "amex")
                .unwrap()
                .activity_cents,
            10000
        );
        db.restore(&db.backup().unwrap()).unwrap();
    }
}
#[test]
fn explicit_sharing_suggestions_resolve_ask_and_preserve_percentage_intent_and_manual_fields() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    for (scope, cat) in [
        ("personal", "personal"),
        ("shared", "dining"),
        ("chelsea", "gifts"),
    ] {
        db.save_rule(rule(scope, cat)).unwrap();
    }
    let mut ask = rule("any", "personal");
    ask.category_action = "leave".into();
    ask.ownership_action = "ask".into();
    db.save_rule(ask).unwrap();
    let id = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-10,Bistro main,0.01\n",
    );
    assert!(
        db.import_detail(&id).unwrap().rows[0]
            .suggestion
            .category_ask
    );
    for (mode, value, expected) in [
        ("personal", "", "personal"),
        ("shared", "", "dining"),
        ("equal", "", "dining"),
        ("percent", "70", "dining"),
        ("percent", "100", "personal"),
        ("percent", "0", "gifts"),
        ("exact", "100", "personal"),
        ("exact", "20", "dining"),
    ] {
        assert_eq!(category(&db, &id, mode, value).as_deref(), Some(expected));
    }
    assert_eq!(category(&db, &id, "ask", ""), None);
    let d = db.import_detail(&id).unwrap();
    let mut decision = bulk(&d.rows[0]);
    decision.input.as_mut().unwrap().category_id = Some("health".into());
    decision.input.as_mut().unwrap().note = "Explicit manual category".into();
    db.commit_import(
        &id,
        d.source.revision,
        &Uuid::new_v4().to_string(),
        vec![decision],
    )
    .unwrap();
    assert_eq!(category(&db, &id, "shared", "").as_deref(), Some("dining"));
    let e = &db.snapshot("2026-10").unwrap().entries[0];
    assert_eq!(e.category_id.as_deref(), Some("health"));
    assert_eq!(e.note, "Explicit manual category");
}
#[test]
fn conditional_specificity_ties_conflicts_and_ownership_rules_are_deterministic() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_rule(rule("any", "groceries")).unwrap();
    db.save_rule(rule("shared", "dining")).unwrap();
    let id = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-10,Bistro main,100\n",
    );
    assert_eq!(category(&db, &id, "shared", "").as_deref(), Some("dining"));
    let mut specific = rule("any", "health");
    specific.account_id = Some("amex".into());
    db.save_rule(specific).unwrap();
    assert_eq!(category(&db, &id, "shared", "").as_deref(), Some("health"));
    assert_eq!(category(&db, &id, "ask", "").as_deref(), Some("health"));
    let mut conflicting = rule("shared", "gifts");
    conflicting.account_id = Some("amex".into());
    db.save_rule(conflicting).unwrap();
    let mut conflicting = rule("shared", "dining");
    conflicting.account_id = Some("amex".into());
    db.save_rule(conflicting).unwrap();
    assert_eq!(category(&db, &id, "shared", ""), None);
    let mut invalid = rule("shared", "dining");
    invalid.ownership_action = "set".into();
    invalid.split_mode = "shared".into();
    assert!(db
        .save_rule(invalid)
        .err()
        .unwrap()
        .contains("leaves sharing"));
}
#[test]
fn saved_sharing_rule_overrides_source_default_before_conditional_category_evaluation() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_rule(rule("personal", "personal")).unwrap();
    db.save_rule(rule("shared", "dining")).unwrap();
    let mut sharing = rule("any", "dining");
    sharing.category_action = "leave".into();
    sharing.ownership_action = "set".into();
    sharing.split_mode = "shared".into();
    db.save_rule(sharing).unwrap();
    let id = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-10,Bistro main,100\n",
    );
    assert!(db.import_detail(&id).unwrap().rows[0].suggestion.ready);
    coverage(&mut db, &id);
    let d = db.import_detail(&id).unwrap();
    db.process_import(
        &id,
        d.source.revision,
        &Uuid::new_v4().to_string(),
        Policy {
            ordinary_card_charges: true,
            ownership: "personal".into(),
            types: vec![],
        },
    )
    .unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.entries[0].category_id.as_deref(), Some("dining"));
    assert_eq!(s.entries[0].split_mode, "shared");
    assert_eq!(s.household_cents, 3000);
}
#[test]
fn held_batch_checks_type_identity_values_and_rolls_back_unrelated_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = stage(
        &mut db,
        "Date,Description,Amount,Type\n2026-10-10,Market,10,SALE\n2026-10-11,Payment,20,PAYMENT\n",
    );
    let d = db.import_detail(&id).unwrap();
    let mut mapping = d.mapping;
    mapping.type_column = Some(3);
    db.configure_import(&id, d.source.revision, "amex", mapping)
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    assert!(d.rows[0].bulk_expense_reason.is_empty());
    assert!(d.rows[1].bulk_expense_reason.contains("source type"));
    let first = bulk(&d.rows[0]);
    let invalid = bulk(&d.rows[1]);
    assert!(db
        .commit_import(
            &id,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            vec![first, invalid]
        )
        .is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
    let mut corrected = bulk(&d.rows[0]);
    corrected.input.as_mut().unwrap().amount = "11.00".into();
    assert!(db
        .commit_import(
            &id,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            vec![corrected]
        )
        .err()
        .unwrap()
        .contains("source values"));
    let op = Uuid::new_v4().to_string();
    db.commit_import(&id, d.source.revision, &op, vec![bulk(&d.rows[0])])
        .unwrap();
    assert!(
        db.commit_import(&id, d.source.revision, &op, vec![bulk(&d.rows[0])])
            .unwrap()
            .already_processed
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 700);
    let other = stage(&mut db, "Date,Description,Amount\n2026-10-10,Market,10\n");
    let d = db.import_detail(&other).unwrap();
    assert!(!d.rows[0].bulk_expense_reason.is_empty());
    assert!(db
        .commit_import(
            &other,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            vec![bulk(&d.rows[0])]
        )
        .is_err());
    db.undo_import(&op).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
}
#[test]
fn held_batch_rejects_screenshot_foreign_currency_and_extraction_uncertainty() {
    for (image, currency, warn) in [
        (true, "USD", false),
        (false, "EUR", false),
        (false, "USD", true),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path(), "personal").unwrap();
        let id = stage(&mut db, "Date,Description,Amount\n2026-10-10,Market,10\n");
        let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
        // Synthetic persisted extraction cases; no real documents or financial data.
        if image {
            c.execute("UPDATE import_sources SET dataset_json=json_set(dataset_json,'$.image',json('true')) WHERE id=?1",[&id]).unwrap();
        }
        c.execute("UPDATE import_rows SET candidate_json=json_set(candidate_json,'$.currency',?1) WHERE source_id=?2",rusqlite::params![currency,id]).unwrap();
        if warn {
            c.execute("UPDATE import_rows SET candidate_json=json_set(candidate_json,'$.warnings',json('[\"Unreadable amount\"]')) WHERE source_id=?1",[&id]).unwrap();
        }
        let d = db.import_detail(&id).unwrap();
        assert!(!d.rows[0].bulk_expense_reason.is_empty());
        assert!(db
            .commit_import(
                &id,
                d.source.revision,
                &Uuid::new_v4().to_string(),
                vec![bulk(&d.rows[0])]
            )
            .is_err());
        assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
    }
}
#[test]
fn conditional_schema_upgrade_and_corrupt_rule_restore_preserve_current_data() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut legacy = rule("any", "groceries");
    legacy.ownership_action = "set".into();
    legacy.split_mode = "personal".into();
    db.save_rule(legacy).unwrap();
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_conditional_rule_schema(&c);
    c.pragma_update(None, "user_version", 17).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.list_rules().unwrap()[0].category_scope, "any");
    db.save_rule(rule("shared", "dining")).unwrap();
    db.restore(&db.backup().unwrap()).unwrap();
    let backup = db.backup().unwrap();
    let c = rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    c.execute(
        "UPDATE merchant_rules SET ownership_action='ask' WHERE category_scope='shared'",
        [],
    )
    .unwrap();
    drop(c);
    assert!(db
        .restore(&backup)
        .err()
        .unwrap()
        .contains("leaves sharing"));
    assert_eq!(db.list_rules().unwrap().len(), 2);
}

#[test]
fn held_batch_preserves_real_twins_and_blocks_replaying_the_same_source() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = stage(
        &mut db,
        "Date,Description,Amount\n2026-10-10,Market,10\n2026-10-10,Market,10\n",
    );
    let d = db.import_detail(&id).unwrap();
    assert!(d.rows.iter().all(|r| r.bulk_expense_reason.is_empty()));
    let op = Uuid::new_v4().to_string();
    db.commit_import(
        &id,
        d.source.revision,
        &op,
        d.rows.iter().map(bulk).collect(),
    )
    .unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.monthly_count, 2);
    assert_eq!(s.spent_cents, 1400);
    assert_eq!(s.household_cents, 600);
    assert!(db
        .commit_import(
            &id,
            db.import_detail(&id).unwrap().source.revision,
            &Uuid::new_v4().to_string(),
            d.rows.iter().map(bulk).collect()
        )
        .is_err());
    db.restore(&db.backup().unwrap()).unwrap();
    db.undo_import(&op).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
}
#[test]
fn saved_nonpurchase_type_cannot_be_bypassed_by_purchase_rules_or_bulk() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut purchase = rule("any", "dining");
    purchase.ownership_action = "set".into();
    purchase.split_mode = "shared".into();
    db.save_rule(purchase).unwrap();
    let id = stage(
        &mut db,
        "Date,Description,Amount,Type\n2026-10-10,Bistro,10,SALE\n",
    );
    let d = db.import_detail(&id).unwrap();
    let mut mapping = d.mapping;
    mapping.type_column = Some(3);
    db.configure_import(&id, d.source.revision, "amex", mapping)
        .unwrap();
    coverage(&mut db, &id);
    let op = Uuid::new_v4().to_string();
    db.process_import(
        &id,
        db.import_detail(&id).unwrap().source.revision,
        &op,
        Policy {
            ordinary_card_charges: true,
            ownership: "personal".into(),
            types: vec![crate::db::classification::TypeCode {
                code: "SALE".into(),
                kind: "ask".into(),
                account_id: None,
            }],
        },
    )
    .unwrap();
    db.undo_import(&op).unwrap();
    let d = db.import_detail(&id).unwrap();
    assert!(db
        .commit_import(
            &id,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            vec![bulk(&d.rows[0])]
        )
        .is_err());
    let row = &d.rows[0];
    let mut decision = bulk(row);
    decision.action = "apply_rule".into();
    decision.input = None;
    decision.rule_signature = Some(row.suggestion.signature.clone());
    assert!(db
        .commit_import(
            &id,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            vec![decision]
        )
        .is_err());
    assert!(!db.import_detail(&id).unwrap().rows[0].suggestion.ready);
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
}
