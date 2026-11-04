use super::*;
use crate::{
    db::{balances::CheckpointInput, bills::*},
    imports::{parse, types::Decision},
    models::LineInput,
};

fn entry(kind: &str, amount: &str, account: &str) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.kind = kind.into();
    e.date = "2026-11-01".into();
    e.account_id = Some(account.into());
    e
}
fn activity(db: &Store, account: &str) -> i64 {
    db.snapshot("2026-11")
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.id == account)
        .unwrap()
        .activity_cents
}
fn checkpoint(db: &mut Store, account: &str, amount: &str) {
    db.save_checkpoint(CheckpointInput {
        id: Uuid::new_v4().to_string(),
        revision: 0,
        account_id: account.into(),
        date: "2026-10-31".into(),
        amount: amount.into(),
        purpose: "opening".into(),
        note: String::new(),
    })
    .unwrap();
}
fn plan() -> Draft {
    Draft {
        amount: "100".into(),
        lines: vec![],
        details: Details {
            name: "Loan".into(),
            merchant: "loan".into(),
            category_id: "home".into(),
            account_id: Some("checking".into()),
            payer: "jacob".into(),
            split_mode: "shared".into(),
            split_value: String::new(),
            autopay: true,
            payment_kind: "debt_payment".into(),
        },
    }
}
#[test]
fn cash_and_card_rewards_affect_only_actual_receiving_account_and_separate_reports() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    checkpoint(&mut db, "checking", "1000");
    checkpoint(&mut db, "amex", "500");
    db.save(entry("reward", "30", "checking")).unwrap();
    db.save(entry("reward", "25", "amex")).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (s.spent_cents, s.income_cents, s.household_cents),
        (0, 0, 0)
    );
    assert_eq!((s.cash_reward_cents, s.card_reward_cents), (3000, 2500));
    assert!(s
        .entries
        .iter()
        .all(|e| e.lines.is_empty() && e.category_id.is_none() && e.split_mode == "none"));
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .balance
            .as_ref()
            .unwrap()
            .estimated_cents,
        103000
    );
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .balance
            .as_ref()
            .unwrap()
            .estimated_cents,
        47500
    );
    assert!(s.categories.iter().all(|c| c.spent_cents == 0));
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(activity(&db, "amex"), -2500);
}
#[test]
fn reward_edits_reverse_old_account_and_month_and_reject_invalid_or_retyped_entries() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut r = entry("reward", "25", "amex");
    db.save(r.clone()).unwrap();
    r.revision = 1;
    r.account_id = Some("checking".into());
    r.date = "2026-10-31".into();
    r.amount = "30".into();
    db.save(r.clone()).unwrap();
    assert_eq!(activity(&db, "amex"), 0);
    assert_eq!(activity(&db, "checking"), 3000);
    assert_eq!(db.snapshot("2026-11").unwrap().card_reward_cents, 0);
    assert_eq!(db.snapshot("2026-10").unwrap().cash_reward_cents, 3000);
    r.revision = 2;
    r.kind = "income".into();
    assert!(db.save(r.clone()).is_err());
    for case in 0..5 {
        let mut e = entry("reward", "1", "amex");
        match case {
            0 => e.payer = "chelsea".into(),
            1 => e.account_id = None,
            2 => e.date = "2099-01-01".into(),
            3 => e.original_event_id = Some(r.id.clone()),
            _ => e.destination_account_id = Some("checking".into()),
        };
        assert!(db.save(e).is_err());
    }
    assert!(db.save(entry("income", "1", "amex")).is_err());
    assert!(db.delete(&r.id, 1).is_err());
    db.delete(&r.id, 2).unwrap();
    assert_eq!(activity(&db, "checking"), 0);
}
#[test]
fn itemized_shared_debt_uses_budget_and_refunds_keep_debt_treatment_across_months() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = entry("debt_payment", "100", "checking");
    e.date = "2026-10-31".into();
    e.lines = vec![
        LineInput {
            id: "principal".into(),
            label: "Payment part".into(),
            category_id: "home".into(),
            amount: "60".into(),
            split_mode: "inherit".into(),
            split_value: String::new(),
            original_line_id: None,
        },
        LineInput {
            id: "fee".into(),
            label: "Fee".into(),
            category_id: "groceries".into(),
            amount: "40".into(),
            split_mode: "personal".into(),
            split_value: String::new(),
            original_line_id: None,
        },
    ];
    db.save(e.clone()).unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(
        (
            s.spent_cents,
            s.debt_payment_cents,
            s.consumption_cents,
            s.household_cents
        ),
        (8200, 8200, 0, 1800)
    );
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "home")
            .unwrap()
            .spent_cents,
        4200
    );
    let mut r = entry("refund", "30", "checking");
    r.original_event_id = Some(e.id.clone());
    r.lines = vec![LineInput {
        id: "refund".into(),
        label: String::new(),
        category_id: "home".into(),
        amount: "30".into(),
        split_mode: "refund".into(),
        split_value: String::new(),
        original_line_id: Some("principal".into()),
    }];
    db.save(r.clone()).unwrap();
    db.save(entry("expense", "10", "amex")).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (
            s.spent_cents,
            s.debt_payment_cents,
            s.consumption_cents,
            s.household_cents
        ),
        (-1400, -2100, 700, 1200)
    );
    assert_eq!(activity(&db, "checking"), -7000);
    assert!(db.delete(&e.id, 1).is_err());
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    db.delete(&r.id, 1).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().debt_payment_cents, 0);
}
#[test]
fn debt_payment_by_chelsea_and_invalid_future_debt_preserve_account_isolation() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = entry("debt_payment", "100", "checking");
    e.payer = "chelsea".into();
    e.account_id = None;
    db.save(e.clone()).unwrap();
    assert_eq!(activity(&db, "checking"), 0);
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (
            s.spent_cents,
            s.debt_payment_cents,
            s.consumption_cents,
            s.household_cents
        ),
        (7000, 7000, 0, -7000)
    );
    let mut future = entry("debt_payment", "100", "checking");
    future.date = "2099-01-01".into();
    assert!(db.save(future).is_err());
    e.revision = 1;
    e.payer = "jacob".into();
    e.account_id = Some("checking".into());
    db.save(e.clone()).unwrap();
    assert_eq!(activity(&db, "checking"), -10000);
    db.delete(&e.id, 2).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, 0);
}
#[test]
fn loan_bill_payment_retry_link_protection_and_backup_keep_payment_kind() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = Uuid::new_v4().to_string();
    db.save_bill_template(&id, 0, "2026-11-01", 1, None, false, plan())
        .unwrap();
    let b = db.bill_month("2026-11").unwrap().remove(0);
    assert_eq!(b.plan.details.payment_kind, "debt_payment");
    let mut e = entry("debt_payment", "100", "checking");
    e.category_id = Some("home".into());
    let op = Uuid::new_v4().to_string();
    db.record_bill_payment(&b.id, b.revision, &op, e.clone())
        .unwrap();
    db.record_bill_payment(&b.id, b.revision, &op, e.clone())
        .unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (s.entries.len(), s.debt_payment_cents, s.consumption_cents),
        (1, 7000, 0)
    );
    assert!(db.delete(&e.id, 1).is_err());
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(db.bill_month("2026-11").unwrap()[0].paid_cents, 10000);
    let mut bad = plan();
    bad.details.payment_kind = "card_payment".into();
    assert!(db
        .save_bill_template(
            &Uuid::new_v4().to_string(),
            0,
            "2026-11-01",
            1,
            None,
            false,
            bad
        )
        .is_err());
}
#[test]
fn reviewed_reward_and_debt_imports_retry_match_and_undo_without_income_or_double_counting() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    for (kind, amount, raw) in [("reward", "25", "-25"), ("debt_payment", "100", "100")] {
        let csv = format!("Date,Description,Amount\n2026-11-01,{kind},{raw}\n");
        let p = parse::prepare("test.csv", csv.as_bytes(), None).unwrap();
        let id = db.ingest("test.csv", csv.into_bytes(), p).unwrap();
        let d = db.import_detail(&id).unwrap();
        let mut mapping = d.mapping;
        mapping.amount_mode = "outflow_positive".into();
        mapping.posted_confirmed = true;
        db.configure_import(&id, d.source.revision, "amex", mapping)
            .unwrap();
        let d = db.import_detail(&id).unwrap();
        let mut e = entry(kind, amount, "amex");
        e.id = d.rows[0].id.clone();
        let decision = Decision {
            row_id: e.id.clone(),
            action: "add".into(),
            input: Some(e),
            match_id: None,
            match_revision: None,
            confirmed: true,
            separate: false,
            rule_signature: None,
        };
        let mut wrong: Decision =
            serde_json::from_value(serde_json::to_value(&decision).unwrap()).unwrap();
        wrong.input.as_mut().unwrap().kind = if kind == "reward" {
            "debt_payment"
        } else {
            "reward"
        }
        .into();
        assert!(db
            .commit_import(
                &id,
                d.source.revision,
                &Uuid::new_v4().to_string(),
                vec![wrong]
            )
            .is_err());
        assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
        let op = Uuid::new_v4().to_string();
        db.commit_import(
            &id,
            d.source.revision,
            &op,
            vec![serde_json::from_value(serde_json::to_value(&decision).unwrap()).unwrap()],
        )
        .unwrap();
        db.commit_import(&id, d.source.revision, &op, vec![decision])
            .unwrap();
        let s = db.snapshot("2026-11").unwrap();
        assert_eq!(s.entries.len(), 1);
        assert_eq!(s.income_cents, 0);
        if kind == "reward" {
            assert_eq!((s.spent_cents, s.card_reward_cents), (0, 2500));
        } else {
            assert_eq!(
                (s.spent_cents, s.debt_payment_cents, s.consumption_cents),
                (7000, 7000, 0)
            );
        }
        let csv = format!("Date,Description,Amount\n2026-11-02,Duplicate {kind},{raw}\n");
        let p = parse::prepare("other.csv", csv.as_bytes(), None).unwrap();
        let id2 = db.ingest("other.csv", csv.into_bytes(), p).unwrap();
        let d2 = db.import_detail(&id2).unwrap();
        let mut mapping = d2.mapping;
        mapping.amount_mode = "outflow_positive".into();
        mapping.posted_confirmed = true;
        db.configure_import(&id2, d2.source.revision, "amex", mapping)
            .unwrap();
        let d2 = db.import_detail(&id2).unwrap();
        assert_eq!(d2.rows[0].matches.len(), 1);
        assert_eq!(d2.rows[0].matches[0].kind, kind);
        db.undo_import(&op).unwrap();
        assert_eq!(activity(&db, "amex"), 0);
    }
}
#[test]
fn schema_eight_migration_preserves_bill_payment_lines_balances_refunds_and_legacy_plan_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    checkpoint(&mut db, "checking", "1000");
    let id = Uuid::new_v4().to_string();
    let mut p = plan();
    p.details.payment_kind = "expense".into();
    db.save_bill_template(&id, 0, "2026-11-01", 1, None, false, p)
        .unwrap();
    let b = db.bill_month("2026-11").unwrap().remove(0);
    let e = entry("expense", "100", "checking");
    db.record_bill_payment(&b.id, b.revision, &Uuid::new_v4().to_string(), e.clone())
        .unwrap();
    let mut r = entry("refund", "20", "checking");
    r.original_event_id = Some(e.id);
    db.save(r).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    // Use the actual old CHECK constraints, not merely a lower version number.
    let old = include_str!("../migrations/009_rewards_debt.sql")
        .replace(",'reward','debt_payment'", "")
        .replace("'expense','debt_payment','refund'", "'expense','refund'");
    conn.pragma_update(None, "foreign_keys", false).unwrap();
    remove_identity_schema(&conn);
    conn.execute_batch(&old).unwrap();
    conn.execute_batch("DROP TABLE paypal_allocations; DROP TABLE paypal_cashouts; DROP TABLE household_opening; UPDATE bill_templates SET plan_json=json_remove(plan_json,'$.paymentKind'); UPDATE bill_occurrences SET plan_json=json_remove(plan_json,'$.paymentKind'); PRAGMA user_version=8;").unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (s.spent_cents, s.debt_payment_cents, s.consumption_cents),
        (5600, 0, 5600)
    );
    assert_eq!(s.entries.len(), 2);
    assert_eq!(db.bill_month("2026-11").unwrap()[0].paid_cents, 10000);
    assert_eq!(
        db.bill_month("2026-11").unwrap()[0]
            .plan
            .details
            .payment_kind,
        "expense"
    );
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .balance
            .as_ref()
            .unwrap()
            .estimated_cents,
        92000
    );
    db.save(entry("reward", "25", "amex")).unwrap();
    db.save(entry("debt_payment", "50", "checking")).unwrap();
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().debt_payment_cents, 3500);
}
#[test]
fn corrupted_reward_activity_and_debt_allocations_cannot_replace_current_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let reward = entry("reward", "25", "amex");
    db.save(reward.clone()).unwrap();
    db.save(entry("debt_payment", "100", "checking")).unwrap();
    for sql in [format!("UPDATE account_activity SET change_cents=2500 WHERE event_id='{}'",reward.id),"UPDATE event_lines SET jacob_cents=6000,chelsea_cents=4000 WHERE event_id IN (SELECT id FROM events WHERE kind='debt_payment')".into()] {
        let backup=db.backup().unwrap(); let conn=rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap(); conn.execute_batch(&sql).unwrap(); drop(conn); assert!(db.restore(&backup).is_err()); assert_eq!(activity(&db,"amex"),-2500); assert_eq!(db.snapshot("2026-11").unwrap().debt_payment_cents,7000);
    }
}
