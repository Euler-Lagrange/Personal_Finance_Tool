use super::*;
use crate::{
    db::rules::Rule,
    imports::{parse, types::*},
};
fn purchase(db: &mut Store, amount: &str, payer: &str) -> EntryInput {
    let mut e = expense(amount, payer);
    e.date = "2026-10-01".into();
    db.save(e.clone()).unwrap();
    e
}
fn refund(e: &EntryInput, amount: &str) -> EntryInput {
    EntryInput {
        budget_override: None,
        id: Uuid::new_v4().to_string(),
        revision: 0,
        kind: "refund".into(),
        date: "2026-11-01".into(),
        description: "Returned purchase".into(),
        amount: amount.into(),
        original_event_id: Some(e.id.clone()),
        lines: Vec::new(),
        split_mode: "refund".into(),
        ..e.clone()
    }
}
fn entry(db: &Store, id: &str) -> crate::models::Entry {
    db.snapshot("2026-11")
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.id == id)
        .unwrap()
}
fn rule() -> Rule {
    Rule {
        id: Uuid::new_v4().to_string(),
        revision: 0,
        name: "Market groceries".into(),
        merchant: "Market".into(),
        match_mode: "prefix".into(),
        account_id: None,
        description_contains: String::new(),
        category_scope: "any".into(),
        category_action: "set".into(),
        category_id: Some("groceries".into()),
        ownership_action: "set".into(),
        split_mode: "shared".into(),
        split_value: String::new(),
        enabled: true,
    }
}
fn stage(db: &mut Store, text: &str) -> SourceDetail {
    let p = parse::prepare("test.csv", text.as_bytes(), None).unwrap();
    let id = db.ingest("test.csv", text.as_bytes().to_vec(), p).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(&id, d.source.revision, "amex", m)
        .unwrap();
    db.import_detail(&id).unwrap()
}
fn apply(row: &ReviewRow) -> Decision {
    Decision {
        row_id: row.id.clone(),
        action: "apply_rule".into(),
        input: None,
        match_id: None,
        match_revision: None,
        confirmed: true,
        separate: false,
        rule_signature: Some(row.suggestion.signature.clone()),
    }
}

#[test]
fn shared_refund_after_settlement_reverses_original_shares_in_received_month() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = purchase(&mut db, "137.76", "jacob");
    let mut paid = repayment("41.33", "chelsea", true);
    paid.date = "2026-10-02".into();
    db.save(paid).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().household_cents, 0);
    let r = refund(&e, "137.76");
    db.save(r).unwrap();
    let october = db.snapshot("2026-10").unwrap();
    assert_eq!(october.spent_cents, 9643);
    let november = db.snapshot("2026-11").unwrap();
    assert_eq!(november.spent_cents, -9643);
    assert_eq!(november.income_cents, 0);
    assert_eq!(november.household_cents, -4133);
    assert_eq!(
        november
            .accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        0
    );
    assert_eq!(
        november
            .categories
            .iter()
            .find(|c| c.id == "groceries")
            .unwrap()
            .spent_cents,
        -9643
    );
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, -4133);
}
#[test]
fn partial_refunds_round_cumulatively_and_edit_delete_revise_other_refunds() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = purchase(&mut db, "0.05", "jacob");
    let mut a = refund(&e, "0.01");
    let b = refund(&e, "0.01");
    db.save(a.clone()).unwrap();
    db.save(b.clone()).unwrap();
    assert_eq!(entry(&db, &a.id).jacob_cents, 1);
    assert_eq!(entry(&db, &b.id).jacob_cents, 1);
    a.revision = 1;
    a.amount = "0.02".into();
    db.save(a.clone()).unwrap();
    assert_eq!(entry(&db, &b.id).revision, 2);
    assert_eq!(entry(&db, &b.id).jacob_cents, 0);
    let c = refund(&e, "0.02");
    db.save(c.clone()).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(s.spent_cents, -4);
    assert_eq!(s.household_cents, 0);
    assert!(db.save(refund(&e, "0.01")).is_err());
    db.delete(&a.id, 2).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(s.spent_cents, -2);
    assert_eq!(s.household_cents, 0);
    assert_eq!(entry(&db, &b.id).revision, 3);
    let all = s
        .entries
        .iter()
        .map(|e| e.jacob_cents + e.chelsea_cents)
        .sum::<i64>();
    assert_eq!(all, 3);
}
#[test]
fn chelsea_refund_changes_shared_balance_without_touching_jacob_accounts() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = purchase(&mut db, "100", "chelsea");
    let r = refund(&e, "40");
    db.save(r).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(s.spent_cents, -2800);
    assert_eq!(s.household_cents, -4200);
    assert!(s.accounts.iter().all(|a| a.activity_cents == 0));
    let mut bad = refund(&e, "1");
    bad.account_id = Some("checking".into());
    assert!(db.save(bad).is_err());
}
#[test]
fn refund_validation_and_original_protection_leave_history_intact() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = purchase(&mut db, "100", "jacob");
    let mut r = refund(&e, "20");
    r.account_id = Some("checking".into());
    db.save(r.clone()).unwrap();
    assert_eq!(
        db.snapshot("2026-11")
            .unwrap()
            .accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        2000
    );
    assert!(db.save(refund(&e, "80.01")).is_err());
    let mut invalid = refund(&e, "1");
    invalid.date = "2026-09-30".into();
    assert!(db.save(invalid).is_err());
    assert!(db.delete(&e.id, 1).is_err());
    e.revision = 1;
    e.amount = "120".into();
    assert!(db.save(e.clone()).is_err());
    e.amount = "100".into();
    e.description = "Better description".into();
    db.save(e.clone()).unwrap();
    r.revision = 1;
    r.description = "Edited refund".into();
    db.save(r.clone()).unwrap();
    assert!(db.save(r.clone()).is_err());
    db.delete(&r.id, 2).unwrap();
    e.revision = 2;
    e.amount = "120".into();
    db.save(e).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 0);
}
#[test]
fn category_rules_are_independent_conflicts_ask_and_specific_rules_win() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut a = rule();
    a.ownership_action = "leave".into();
    db.save_rule(a.clone()).unwrap();
    let mut b = rule();
    b.category_action = "leave".into();
    b.ownership_action = "ask".into();
    db.save_rule(b).unwrap();
    let d = stage(
        &mut db,
        "Date,Description,Amount\n2026-11-01,MARKET #123,10\n",
    );
    assert_eq!(
        d.rows[0].suggestion.category_id.as_deref(),
        Some("groceries")
    );
    assert!(d.rows[0].suggestion.ownership_ask);
    assert!(!d.rows[0].suggestion.ready);
    let mut c = rule();
    c.account_id = Some("amex".into());
    db.save_rule(c).unwrap();
    let d = db.import_detail(&d.source.id).unwrap();
    assert!(d.rows[0].suggestion.ready);
    assert_eq!(d.rows[0].suggestion.split_mode, "shared");
    let mut conflict = rule();
    conflict.account_id = Some("amex".into());
    conflict.category_id = Some("hobbies".into());
    db.save_rule(conflict).unwrap();
    let d = db.import_detail(&d.source.id).unwrap();
    assert!(d.rows[0].suggestion.category_ask);
    assert_eq!(d.rows[0].suggestion.category_id, None);
    assert_eq!(crate::db::rules::normalize("MARKET #123"), "market 123");
    assert_ne!(
        crate::db::rules::normalize("MARKET #123"),
        crate::db::rules::normalize("MARKET #124")
    );
}
#[test]
fn rules_apply_atomically_preserve_manual_edits_and_reject_stale_rule_versions() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut r = rule();
    db.save_rule(r.clone()).unwrap();
    let d = stage(
        &mut db,
        "Date,Description,Amount\n2026-11-01,Market One,100\n2026-11-01,Market Two,20\n",
    );
    assert_eq!(db.preview_rule(r.clone()).unwrap().count, 2);
    r.revision = 1;
    r.split_mode = "personal".into();
    db.save_rule(r.clone()).unwrap();
    assert!(db
        .commit_import(
            &d.source.id,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            d.rows.iter().map(apply).collect()
        )
        .is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 0);
    let d = db.import_detail(&d.source.id).unwrap();
    let op = Uuid::new_v4().to_string();
    db.commit_import(
        &d.source.id,
        d.source.revision,
        &op,
        d.rows.iter().map(apply).collect(),
    )
    .unwrap();
    assert!(
        db.commit_import(
            &d.source.id,
            d.source.revision,
            &op,
            d.rows.iter().map(apply).collect()
        )
        .unwrap()
        .already_processed
    );
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 12000);
    let mut edit = expense("100", "jacob");
    edit.id = d.rows[0].id.clone();
    edit.date = "2026-11-01".into();
    edit.revision = 1;
    edit.category_id = Some("hobbies".into());
    edit.split_mode = "personal".into();
    db.save(edit).unwrap();
    r.revision = 2;
    r.category_id = Some("home".into());
    db.save_rule(r).unwrap();
    assert_eq!(
        entry(&db, &d.rows[0].id).category_id.as_deref(),
        Some("hobbies")
    );
    assert!(db.undo_import(&op).is_err());
}
#[test]
fn rule_suggestions_do_not_clear_credits_pending_ocr_or_payment_types() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_rule(rule()).unwrap();
    let d=stage(&mut db,"Date,Description,Amount,Status,Type\n2026-11-01,Market refund,-10,Posted,Refund\n2026-11-01,Market pending,10,Pending,Purchase\n2026-11-01,Market payment,10,Posted,Payment\n");
    assert!(d.rows.iter().all(|r| !r.suggestion.ready));
    assert!(db
        .commit_import(
            &d.source.id,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            vec![apply(&d.rows[2])]
        )
        .is_err());
    let bytes = include_bytes!("../fixtures/import-ocr.png").to_vec();
    let prepared = Prepared {
        fingerprint: parse::fingerprint(&bytes, "image").unwrap(),
        format: "image".into(),
        mime: "image/png".into(),
        error: String::new(),
        dataset: parse::ocr_lines(vec!["11/01/2026 Market 12.34".into()]),
    };
    let id = db.ingest("screenshot.png", bytes, prepared).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut mapping = d.mapping;
    mapping.amount_mode = "outflow_positive".into();
    mapping.posted_confirmed = true;
    db.configure_import(&id, d.source.revision, "amex", mapping)
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    assert_eq!(
        d.rows[0].suggestion.category_id.as_deref(),
        Some("groceries")
    );
    assert!(!d.rows[0].suggestion.ready);
    assert!(db
        .commit_import(
            &id,
            d.source.revision,
            &Uuid::new_v4().to_string(),
            vec![apply(&d.rows[0])]
        )
        .is_err());
}
#[test]
fn imported_refund_links_purchase_and_duplicate_sources_without_new_income() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = purchase(&mut db, "100", "jacob");
    let d = stage(&mut db, "Date,Description,Amount\n2026-11-01,Return,-25\n");
    let mut input = refund(&e, "25");
    input.id = d.rows[0].id.clone();
    let decision = Decision {
        row_id: input.id.clone(),
        action: "add".into(),
        input: Some(input),
        match_id: None,
        match_revision: None,
        confirmed: true,
        separate: false,
        rule_signature: None,
    };
    let op = Uuid::new_v4().to_string();
    db.commit_import(&d.source.id, d.source.revision, &op, vec![decision])
        .unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(s.spent_cents, -1750);
    assert_eq!(s.income_cents, 0);
    let second = stage(
        &mut db,
        "Date,Description,Amount\n2026-11-02,Refund merchant,-25\n",
    );
    assert_eq!(second.rows[0].matches.len(), 1);
    assert_eq!(second.rows[0].matches[0].kind, "refund");
    db.undo_import(&op).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 0);
}
#[test]
fn v4_upgrade_keeps_financial_history_and_restores_legacy_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("personal.sqlite");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("../fixtures/schema_v4.sql"))
        .unwrap();
    conn.execute_batch(include_str!("../migrations/004_imports.sql"))
        .unwrap();
    conn.execute_batch("INSERT INTO metadata VALUES ('workspace','personal');INSERT INTO accounts VALUES ('amex','Card','credit',1,0);INSERT INTO categories VALUES ('groceries','Groceries','Needs','#123456',0,1,0,'auto');INSERT INTO events VALUES ('86838cf9-0f3c-4c33-b3f6-49b3e4b4e891',1,'expense','2026-10-01','Market',10000,'jacob','groceries','amex','shared','',7000,3000,3000,'',NULL);INSERT INTO account_activity SELECT id,account_id,amount_cents FROM events;PRAGMA user_version=4;").unwrap();
    let bytes = b"Date,Description,Amount\n2026-10-01,Market,100\n";
    let p = parse::prepare("old.csv", bytes, None).unwrap();
    let mut mapping = parse::default_mapping(&p.dataset);
    mapping.amount_mode = "outflow_positive".into();
    mapping.posted_confirmed = true;
    let candidate = parse::candidate(&p.dataset.rows[0], &mapping, false);
    let source_id = Uuid::new_v4().to_string();
    let commit_id = Uuid::new_v4().to_string();
    let row_id = Uuid::new_v4().to_string();
    conn.execute("INSERT INTO import_sources(id,fingerprint,name,mime,format,content,account_id,dataset_json,mapping_json,configured) VALUES (?1,?2,'old.csv','text/csv','csv',?3,'amex',?4,?5,1)",rusqlite::params![source_id,p.fingerprint,bytes,serde_json::to_string(&p.dataset).unwrap(),serde_json::to_string(&mapping).unwrap()]).unwrap();
    conn.execute("INSERT INTO import_commits(id,source_id,payload_hash,receipt_json) VALUES (?1,?2,'old-hash',?3)",rusqlite::params![commit_id,source_id,r#"{"added":0,"linked":1,"excluded":0,"alreadyProcessed":false}"#]).unwrap();
    conn.execute("INSERT INTO import_rows(id,source_id,ordinal,raw_json,candidate_json,disposition,event_id,event_revision,commit_id) VALUES (?1,?2,0,?3,?4,'linked','86838cf9-0f3c-4c33-b3f6-49b3e4b4e891',1,?5)",rusqlite::params![row_id,source_id,serde_json::to_string(&p.dataset.rows[0]).unwrap(),serde_json::to_string(&candidate).unwrap(),commit_id]).unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 7000);
    assert!(db.list_rules().unwrap().is_empty());
    assert_eq!(db.import_detail(&source_id).unwrap().source.linked_count, 1);
    let backup = db.list_backups().unwrap().pop().unwrap();
    db.save_rule(rule()).unwrap();
    db.restore(&backup).unwrap();
    assert!(db.list_rules().unwrap().is_empty());
    assert_eq!(
        db.snapshot("2026-10").unwrap().entries[0].original_event_id,
        None
    );
    assert_eq!(
        db.import_detail(&source_id).unwrap().rows[0]
            .event_id
            .as_deref(),
        Some("86838cf9-0f3c-4c33-b3f6-49b3e4b4e891")
    );
    db.undo_import(&commit_id).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 7000);
}
#[test]
fn damaged_refund_backup_is_rejected_and_rules_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = purchase(&mut db, "100", "jacob");
    db.save(refund(&e, "30")).unwrap();
    db.save_rule(rule()).unwrap();
    let backup = db.backup().unwrap();
    drop(db);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.list_rules().unwrap().len(), 1);
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    conn.execute("UPDATE events SET jacob_cents=2000,chelsea_cents=1000,household_delta_cents=-1000 WHERE kind='refund'",[]).unwrap();
    drop(conn);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, -2100);
}

#[test]
fn disabled_archived_and_unspecified_sharing_rules_require_review() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut r = rule();
    r.ownership_action = "leave".into();
    db.save_rule(r.clone()).unwrap();
    let d = stage(&mut db, "Date,Description,Amount\n2026-11-01,Market,10\n");
    assert!(!d.rows[0].suggestion.ready);
    assert_eq!(
        d.rows[0].suggestion.category_id.as_deref(),
        Some("groceries")
    );
    r.revision = 1;
    r.ownership_action = "set".into();
    r.enabled = false;
    db.save_rule(r.clone()).unwrap();
    assert_eq!(db.preview_rule(r.clone()).unwrap().count, 0);
    let hidden = db.import_detail(&d.source.id).unwrap();
    assert!(hidden.rows[0].suggestion.category_id.is_none());
    r.revision = 2;
    r.enabled = true;
    db.save_rule(r).unwrap();
    let c = db
        .snapshot("2026-11")
        .unwrap()
        .categories
        .into_iter()
        .find(|c| c.id == "groceries")
        .unwrap();
    db.save_category(CategoryInput {
        id: c.id,
        revision: c.revision,
        name: c.name,
        group_name: c.group_name,
        color: c.color,
        default_limit: "0".into(),
        archived: true,
        icon: c.icon,
    })
    .unwrap();
    let d = db.import_detail(&d.source.id).unwrap();
    assert!(d.rows[0].suggestion.category_ask);
    assert!(!d.rows[0].suggestion.ready);
}

#[test]
fn import_undo_preserves_later_refunds_and_allows_reverse_order_removal() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = purchase(&mut db, "0.05", "jacob");
    let d = stage(
        &mut db,
        "Date,Description,Amount\n2026-11-01,Return A,-0.01\n2026-11-02,Return B,-0.02\n",
    );
    let decisions = d
        .rows
        .iter()
        .map(|row| {
            let mut r = refund(&e, if row.ordinal == 0 { "0.01" } else { "0.02" });
            r.id = row.id.clone();
            r.date = row.candidate.date.clone().unwrap();
            Decision {
                row_id: r.id.clone(),
                action: "add".into(),
                input: Some(r),
                match_id: None,
                match_revision: None,
                confirmed: true,
                separate: false,
                rule_signature: None,
            }
        })
        .collect();
    let op = Uuid::new_v4().to_string();
    db.commit_import(&d.source.id, d.source.revision, &op, decisions)
        .unwrap();
    let later = refund(&e, "0.02");
    db.save(later.clone()).unwrap();
    assert!(db.undo_import(&op).unwrap_err().contains("later refund"));
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, -4);
    db.delete(&later.id, 1).unwrap();
    db.undo_import(&op).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 0);
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, 1);
}
