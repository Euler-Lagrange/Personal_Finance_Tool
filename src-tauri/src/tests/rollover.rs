use super::*;
use crate::db::{
    periods::{CloseInput, ReopenInput},
    rollover::{BudgetPlan, Choice},
};
fn plan(db: &Store, month: &str, category: &str, amount: &str, mode: &str) -> BudgetPlan {
    let c = db
        .snapshot(month)
        .unwrap()
        .categories
        .into_iter()
        .find(|c| c.id == category)
        .unwrap();
    BudgetPlan {
        id: Uuid::new_v4().to_string(),
        month: month.into(),
        category: category.into(),
        amount: amount.into(),
        mode: mode.into(),
        policy_token: c.rollover_token,
        previous_limit_cents: c.limit_cents,
    }
}
fn buy(db: &mut Store, month: &str, amount: &str) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.date = format!("{month}-10");
    e.split_mode = "personal".into();
    db.save(e.clone()).unwrap();
    e.revision = 1;
    e
}
fn input(db: &mut Store, month: &str, target: Option<&str>) -> CloseInput {
    let r = db.close_review_target(month, target).unwrap();
    assert!(r.blockers.is_empty(), "{:?}", r.blockers);
    CloseInput {
        id: Uuid::new_v4().to_string(),
        month: month.into(),
        revision: r.revision,
        token: r.token,
        acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
        note: "Synthetic close".into(),
        carry: Some(Choice {
            target_month: r.carry.target_month,
            reason: "Reviewed carry or historical correction".into(),
        }),
    }
}
fn close(db: &mut Store, month: &str, target: Option<&str>) {
    let i = input(db, month, target);
    db.close_month(i).unwrap();
}
fn reopen(db: &mut Store, month: &str) {
    let r = db.close_review(month).unwrap();
    db.reopen_month(ReopenInput {
        id: Uuid::new_v4().to_string(),
        month: month.into(),
        revision: r.revision,
        reason: "Correct historical budget".into(),
    })
    .unwrap();
}
fn incoming(db: &Store, month: &str, category: &str) -> i64 {
    db.snapshot(month)
        .unwrap()
        .categories
        .into_iter()
        .find(|c| c.id == category)
        .unwrap()
        .rollover_cents
}

#[test]
fn reset_is_default_and_carry_preserves_signed_remainder_without_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.set_budget("2026-08", "groceries", "100").unwrap();
    buy(&mut db, "2026-08", "30");
    close(&mut db, "2026-08", None);
    assert_eq!(incoming(&db, "2026-09", "groceries"), 0);
    db.save_budget_plan(plan(&db, "2026-09", "groceries", "100", "carry"))
        .unwrap();
    buy(&mut db, "2026-09", "30");
    close(&mut db, "2026-09", None);
    assert_eq!(incoming(&db, "2026-10", "groceries"), 7000);
    db.set_budget("2026-10", "groceries", "100").unwrap();
    buy(&mut db, "2026-10", "200");
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(
        (s.spent_cents, s.budget_cents, s.remaining_cents),
        (20000, 17000, -3000)
    );
    close(&mut db, "2026-10", None);
    assert_eq!(incoming(&db, "2026-11", "groceries"), -3000);
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (s.spent_cents, s.income_cents, s.household_cents),
        (0, 0, 0)
    );
    assert_eq!(s.budget_cents, -3000);
}

#[test]
fn copied_base_limits_and_archived_categories_keep_carry_separate() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_budget_plan(plan(&db, "2026-08", "groceries", "100", "carry"))
        .unwrap();
    close(&mut db, "2026-08", None);
    db.apply_budget_template("2026-09", Some("2026-08"), false)
        .unwrap();
    let s = db.snapshot("2026-09").unwrap();
    let c = s.categories.iter().find(|c| c.id == "groceries").unwrap();
    assert_eq!(
        (c.limit_cents, c.rollover_cents, c.available_cents),
        (10000, 10000, 20000)
    );
    close(&mut db, "2026-09", None);
    let mut c = category_input(&db, "groceries");
    c.archived = true;
    c.name = "Food history".into();
    db.save_category(c).unwrap();
    assert_eq!(incoming(&db, "2026-10", "groceries"), 20000);
    let snap = db.annual_report(2026).unwrap();
    assert_eq!(
        snap.months[8]
            .totals
            .as_ref()
            .unwrap()
            .categories
            .iter()
            .find(|c| c.id == "groceries")
            .unwrap()
            .name,
        "Groceries"
    );
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(incoming(&db, "2026-10", "groceries"), 20000);
}

#[test]
fn historical_multi_hop_corrections_are_delta_only_and_repeated_reclose_cannot_recarry() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_budget_plan(plan(&db, "2026-08", "groceries", "100", "carry"))
        .unwrap();
    close(&mut db, "2026-08", None);
    db.set_budget("2026-09", "groceries", "100").unwrap();
    buy(&mut db, "2026-09", "50");
    close(&mut db, "2026-09", None);
    db.set_budget("2026-10", "groceries", "100").unwrap();
    buy(&mut db, "2026-10", "80");
    close(&mut db, "2026-10", None);
    assert_eq!(incoming(&db, "2026-11", "groceries"), 17000);
    let september = db.annual_report(2026).unwrap().months[8]
        .totals
        .clone()
        .unwrap();
    reopen(&mut db, "2026-08");
    buy(&mut db, "2026-08", "20");
    let r = db.close_review("2026-08").unwrap();
    assert_eq!(r.carry.lines[0].delta_cents, -2000);
    assert_eq!(r.carry.lines[0].previous_cents, 10000);
    let req = input(&mut db, "2026-08", Some("2026-11"));
    let retry = serde_json::to_string(&req).unwrap();
    db.close_month(req).unwrap();
    db.close_month(serde_json::from_str(&retry).unwrap())
        .unwrap();
    assert_eq!(incoming(&db, "2026-11", "groceries"), 15000);
    assert_eq!(
        db.annual_report(2026).unwrap().months[8]
            .totals
            .as_ref()
            .unwrap(),
        &september
    );
    reopen(&mut db, "2026-08");
    close(&mut db, "2026-08", Some("2026-11"));
    assert_eq!(incoming(&db, "2026-11", "groceries"), 15000);
    // Deliberately reclose successors. Their original incoming edges remain unchanged;
    // the August correction already sent to November is not propagated again.
    reopen(&mut db, "2026-09");
    close(&mut db, "2026-09", Some("2026-11"));
    reopen(&mut db, "2026-10");
    close(&mut db, "2026-10", Some("2026-11"));
    assert_eq!(incoming(&db, "2026-11", "groceries"), 15000);
    reopen(&mut db, "2026-08");
    db.set_budget("2026-08", "groceries", "150").unwrap();
    close(&mut db, "2026-08", Some("2026-11"));
    assert_eq!(incoming(&db, "2026-11", "groceries"), 20000);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(incoming(&db, "2026-11", "groceries"), 20000);
}

#[test]
fn explicit_reopened_destination_can_receive_delta_and_closed_successors_stay_locked() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_budget_plan(plan(&db, "2026-08", "groceries", "100", "carry"))
        .unwrap();
    close(&mut db, "2026-08", None);
    close(&mut db, "2026-09", None);
    reopen(&mut db, "2026-08");
    buy(&mut db, "2026-08", "25");
    let r = db.close_review_target("2026-08", Some("2026-09")).unwrap();
    assert!(r.blockers.iter().any(|b| b.id == "carry_target"));
    reopen(&mut db, "2026-09");
    close(&mut db, "2026-08", Some("2026-09"));
    assert_eq!(incoming(&db, "2026-09", "groceries"), 7500);
    close(&mut db, "2026-09", Some("2026-10"));
    assert_eq!(incoming(&db, "2026-10", "groceries"), 7500);
    assert!(db.close_review_target("2026-09", Some("2026-08")).is_err());
}

#[test]
fn changing_policy_is_effective_dated_and_reset_reconciles_prior_carry() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    db.save_budget_plan(plan(&db, "2026-09", "groceries", "100", "carry"))
        .unwrap();
    close(&mut db, "2026-09", None);
    // A backdated default cannot change the financial policy of a closed month.
    assert!(db
        .save_budget_plan(plan(&db, "2026-09", "groceries", "100", "reset"))
        .is_err());
    db.save_budget_plan(plan(&db, "2026-10", "groceries", "100", "reset"))
        .unwrap();
    close(&mut db, "2026-10", None);
    assert_eq!(incoming(&db, "2026-11", "groceries"), 0);
    reopen(&mut db, "2026-09");
    db.save_budget_plan(plan(&db, "2026-09", "groceries", "100", "reset"))
        .unwrap();
    close(&mut db, "2026-09", Some("2026-11"));
    assert_eq!(incoming(&db, "2026-10", "groceries"), 10000);
    assert_eq!(incoming(&db, "2026-11", "groceries"), -10000);
}

#[test]
fn goal_only_exclusions_and_later_refunds_flow_through_allowance_not_actual_spending() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = goals::setup(&mut db, "Gift", Some("1000"));
    let w = goals::withdrawal(&mut db, &g, "200");
    let e = goals::purchase(&mut db, "300", "personal");
    db.save_funding(goals::request(
        &db,
        &e,
        vec![goals::funding(&g, "200", Some(&w))],
    ))
    .unwrap();
    db.save_budget_plan(plan(&db, "2026-10", "gifts", "500", "carry"))
        .unwrap();
    close(&mut db, "2026-10", None);
    assert_eq!(incoming(&db, "2026-11", "gifts"), 40000);
    let mut r = expense("150", "jacob");
    r.kind = "refund".into();
    r.date = "2026-11-01".into();
    r.original_event_id = Some(e.id);
    db.save(r).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (
            s.spent_cents,
            s.goal_excluded_cents,
            s.allowance_cents,
            s.remaining_cents
        ),
        (-15000, -10000, -5000, 45000)
    );
    assert!(db.close_review("2026-10").unwrap().closed);
    let annual = db.annual_report(2026).unwrap();
    assert_eq!(annual.months[9].totals.as_ref().unwrap().spent_cents, 30000);
}

#[test]
fn budget_and_close_retry_tokens_reject_stale_choices_and_audit_failure_rolls_back_carry() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let p = plan(&db, "2026-10", "groceries", "100", "carry");
    let raw = serde_json::to_string(&p).unwrap();
    db.save_budget_plan(p).unwrap();
    db.save_budget_plan(serde_json::from_str(&raw).unwrap())
        .unwrap();
    let stale = plan(&db, "2026-10", "groceries", "200", "carry");
    db.set_budget("2026-10", "groceries", "150").unwrap();
    assert!(db.save_budget_plan(stale).is_err());
    let stale = input(&mut db, "2026-10", None);
    db.set_budget("2026-11", "groceries", "500").unwrap();
    assert!(db.close_month(stale).is_err());
    let i = input(&mut db, "2026-10", None);
    let raw = serde_json::to_string(&i).unwrap();
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute_batch("CREATE TRIGGER fail_close BEFORE INSERT ON audit WHEN NEW.action='month_close' BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
    assert!(db.close_month(i).is_err());
    assert_eq!(incoming(&db, "2026-11", "groceries"), 0);
    assert!(!db.close_review("2026-10").unwrap().closed);
    c.execute_batch("DROP TRIGGER fail_close").unwrap();
    db.close_month(serde_json::from_str(&raw).unwrap()).unwrap();
    assert_eq!(incoming(&db, "2026-11", "groceries"), 15000);
}

#[test]
fn upgrade_preserves_schema21_fingerprints_and_corrupt_carry_restore_keeps_live_data() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    buy(&mut db, "2026-08", "10");
    close(&mut db, "2026-08", None);
    let old = db.shared_statement_view(Some("2026-08")).unwrap();
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_rollover_schema(&c);
    c.pragma_update(None, "user_version", 21).unwrap();
    // Strip new default-only fields to model an actual schema-21 frozen snapshot.
    let mut snap: serde_json::Value = serde_json::from_str(
        &c.query_row(
            "SELECT snapshot_json FROM month_closes WHERE month='2026-08'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap(),
    )
    .unwrap();
    snap["totals"]
        .as_object_mut()
        .unwrap()
        .remove("rolloverCents");
    for cat in snap["totals"]["categories"].as_array_mut().unwrap() {
        cat.as_object_mut().unwrap().remove("rolloverCents");
        cat.as_object_mut().unwrap().remove("rolloverMode");
    }
    use sha2::{Digest, Sha256};
    let raw = snap.to_string();
    let hash = format!("{:x}", Sha256::digest(raw.as_bytes()));
    c.execute(
        "UPDATE month_closes SET snapshot_json=?1,snapshot_hash=?2",
        rusqlite::params![raw, hash],
    )
    .unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.shared_statement_view(Some("2026-08")).unwrap(), old);
    assert!(db.set_budget("2026-08", "groceries", "20").is_err());
    db.save_budget_plan(plan(&db, "2026-09", "groceries", "100", "carry"))
        .unwrap();
    close(&mut db, "2026-09", None);
    let valid = db.backup().unwrap();
    db.restore(&valid).unwrap();
    for damage in [
        "PRAGMA ignore_check_constraints=ON; UPDATE budget_carry_entries SET previous_cents=1;",
        "DROP TABLE budget_receipts;",
    ] {
        let backup = db.backup().unwrap();
        let c =
            rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
        c.execute_batch(damage).unwrap();
        drop(c);
        assert!(db.restore(&backup).is_err());
        assert_eq!(incoming(&db, "2026-10", "groceries"), 10000);
    }
}
