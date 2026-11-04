use super::*;
use crate::{
    db::{balances::CheckpointInput, goals::*},
    models::LineInput,
};

pub(super) fn setup(db: &mut Store, name: &str, balance: Option<&str>) -> GoalInput {
    let account_id = Uuid::new_v4().to_string();
    db.save_account(AccountInput {
        id: account_id.clone(),
        revision: 0,
        name: format!("{name} account"),
        kind: "savings".into(),
        archived: false,
        tracking_mode: "manual".into(),
    })
    .unwrap();
    if let Some(amount) = balance {
        checkpoint(db, &account_id, amount);
    }
    let mut goal = GoalInput {
        id: Uuid::new_v4().to_string(),
        revision: 0,
        name: name.into(),
        account_id,
        target: "1000".into(),
        target_date: Some("2027-12-31".into()),
        monthly: "100".into(),
        policy: "goal_only".into(),
        archived: false,
    };
    db.save_goal(goal.clone()).unwrap();
    goal.revision = 1;
    goal
}
fn checkpoint(db: &mut Store, account: &str, amount: &str) -> String {
    let id = Uuid::new_v4().to_string();
    db.save_checkpoint(CheckpointInput {
        id: id.clone(),
        revision: 0,
        account_id: account.into(),
        date: "2026-09-30".into(),
        amount: amount.into(),
        purpose: "opening".into(),
        note: String::new(),
    })
    .unwrap();
    id
}
pub(super) fn purchase(db: &mut Store, amount: &str, mode: &str) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.date = "2026-10-10".into();
    e.split_mode = mode.into();
    e.category_id = Some("gifts".into());
    db.save(e.clone()).unwrap();
    e.revision = 1;
    e
}
pub(super) fn withdrawal(db: &mut Store, goal: &GoalInput, amount: &str) -> EntryInput {
    let mut e = expense(amount, "jacob");
    e.kind = "transfer".into();
    e.date = "2026-10-09".into();
    e.category_id = None;
    e.account_id = Some(goal.account_id.clone());
    e.destination_account_id = Some("checking".into());
    e.split_mode = "none".into();
    db.save(e.clone()).unwrap();
    e.revision = 1;
    e
}
pub(super) fn funding(
    goal: &GoalInput,
    amount: &str,
    withdrawal: Option<&EntryInput>,
) -> FundingInput {
    FundingInput {
        id: Uuid::new_v4().to_string(),
        line_id: "main".into(),
        goal_id: goal.id.clone(),
        goal_revision: goal.revision,
        amount: amount.into(),
        withdrawal_id: withdrawal.map(|w| w.id.clone()),
    }
}
pub(super) fn request(db: &Store, e: &EntryInput, rows: Vec<FundingInput>) -> FundingRequest {
    FundingRequest {
        id: Uuid::new_v4().to_string(),
        event_id: e.id.clone(),
        revision: db.funding_view(&e.id).unwrap().entry.revision,
        confirmed: true,
        rows,
    }
}
fn refund(db: &mut Store, e: &EntryInput, amount: &str, date: &str) -> EntryInput {
    let mut r = expense(amount, "jacob");
    r.kind = "refund".into();
    r.date = date.into();
    r.original_event_id = Some(e.id.clone());
    r.account_id = Some("amex".into());
    r.category_id = None;
    r.split_mode = "none".into();
    db.save(r.clone()).unwrap();
    r.revision = 1;
    r
}

#[test]
fn partial_goal_funding_changes_allowance_not_spending_or_accounts_and_snapshots_policy() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut goal = setup(&mut db, "Gift", Some("1000"));
    let w = withdrawal(&mut db, &goal, "200");
    let e = purchase(&mut db, "300", "personal");
    db.set_budget("2026-10", "gifts", "500").unwrap();
    let before = db.snapshot("2026-10").unwrap();
    let f = funding(&goal, "200", Some(&w));
    let req = request(&db, &e, vec![f.clone()]);
    db.save_funding(req.clone()).unwrap();
    db.save_funding(req).unwrap();
    let after = db.snapshot("2026-10").unwrap();
    assert_eq!(
        (
            after.spent_cents,
            after.consumption_cents,
            after.goal_excluded_cents,
            after.allowance_cents,
            after.remaining_cents
        ),
        (30000, 30000, 20000, 10000, 40000)
    );
    assert_eq!(
        before
            .accounts
            .iter()
            .map(|a| (&a.id, a.activity_cents))
            .collect::<Vec<_>>(),
        after
            .accounts
            .iter()
            .map(|a| (&a.id, a.activity_cents))
            .collect::<Vec<_>>()
    );
    let c = after.categories.iter().find(|c| c.id == "gifts").unwrap();
    assert_eq!(
        (c.spent_cents, c.goal_excluded_cents, c.allowance_cents),
        (30000, 20000, 10000)
    );
    goal.policy = "count_monthly".into();
    db.save_goal(goal.clone()).unwrap();
    goal.revision += 1;
    assert_eq!(db.snapshot("2026-10").unwrap().goal_excluded_cents, 20000);
    let mut saved = f.clone();
    saved.goal_revision = goal.revision;
    db.save_funding(request(&db, &e, vec![saved])).unwrap();
    assert_eq!(db.funding_view(&e.id).unwrap().rows[0].policy, "goal_only");
    let w2 = withdrawal(&mut db, &goal, "100");
    let e2 = purchase(&mut db, "100", "personal");
    db.save_funding(request(&db, &e2, vec![funding(&goal, "100", Some(&w2))]))
        .unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!((s.spent_cents, s.allowance_cents), (40000, 20000));
    db.restore(&db.backup().unwrap()).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().allowance_cents, 20000);
}

#[test]
fn multiple_goals_and_shared_category_lines_never_exclude_chelseas_share() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = setup(&mut db, "Gift", Some("1000"));
    let b = setup(&mut db, "PTO", Some("1000"));
    let wa = withdrawal(&mut db, &a, "100");
    let wb = withdrawal(&mut db, &b, "200");
    let mut e = expense("300", "jacob");
    e.date = "2026-10-10".into();
    e.lines = vec![
        LineInput {
            id: "gift".into(),
            label: "Gift".into(),
            category_id: "gifts".into(),
            amount: "120".into(),
            split_mode: "inherit".into(),
            split_value: String::new(),
            original_line_id: None,
        },
        LineInput {
            id: "trip".into(),
            label: "Trip".into(),
            category_id: "dining".into(),
            amount: "180".into(),
            split_mode: "inherit".into(),
            split_value: String::new(),
            original_line_id: None,
        },
    ];
    db.save(e.clone()).unwrap();
    let mut f1 = funding(&a, "50", Some(&wa));
    f1.line_id = "gift".into();
    let mut f2 = funding(&b, "100", Some(&wb));
    f2.line_id = "trip".into();
    db.save_funding(request(&db, &e, vec![f1.clone(), f2.clone()]))
        .unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(
        (
            s.spent_cents,
            s.goal_excluded_cents,
            s.allowance_cents,
            s.household_cents
        ),
        (21000, 15000, 6000, 9000)
    );
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "gifts")
            .unwrap()
            .allowance_cents,
        3400
    );
    let mut over = f1;
    over.amount = "85".into();
    assert!(db.save_funding(request(&db, &e, vec![over, f2])).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().allowance_cents, 6000);
    let mut r = expense("120", "jacob");
    r.kind = "refund".into();
    r.date = "2026-11-01".into();
    r.original_event_id = Some(e.id.clone());
    r.lines = vec![LineInput {
        id: "gift".into(),
        label: String::new(),
        category_id: String::new(),
        amount: "120".into(),
        split_mode: "inherit".into(),
        split_value: String::new(),
        original_line_id: Some("gift".into()),
    }];
    db.save(r).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (s.spent_cents, s.goal_excluded_cents, s.allowance_cents),
        (-8400, -5000, -3400)
    );
    assert_eq!(s.household_cents, 5400);
}

#[test]
fn refund_reversal_is_cumulative_in_received_month_without_inventing_goal_deposits() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let a = setup(&mut db, "Gift", Some("10"));
    let b = setup(&mut db, "PTO", Some("10"));
    let wa = withdrawal(&mut db, &a, "1");
    let wb = withdrawal(&mut db, &b, "1");
    let e = purchase(&mut db, "0.05", "shared");
    db.save_funding(request(
        &db,
        &e,
        vec![
            funding(&a, "0.01", Some(&wa)),
            funding(&b, "0.02", Some(&wb)),
        ],
    ))
    .unwrap();
    let before = db
        .goals()
        .unwrap()
        .iter()
        .map(|g| (g.id.clone(), g.balance.as_ref().unwrap().estimated_cents))
        .collect::<Vec<_>>();
    let mut refunds = Vec::new();
    for _ in 0..5 {
        refunds.push(refund(&mut db, &e, "0.01", "2026-11-01"));
    }
    let oct = db.snapshot("2026-10").unwrap();
    let nov = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (
            oct.spent_cents,
            oct.goal_excluded_cents,
            oct.allowance_cents
        ),
        (4, 3, 1)
    );
    assert_eq!(
        (
            nov.spent_cents,
            nov.goal_excluded_cents,
            nov.allowance_cents
        ),
        (-4, -3, -1)
    );
    let after = db
        .goals()
        .unwrap()
        .iter()
        .map(|g| (g.id.clone(), g.balance.as_ref().unwrap().estimated_cents))
        .collect::<Vec<_>>();
    assert_eq!(before, after);
    assert!(db.save_funding(request(&db, &e, vec![])).is_err());
    let latest = db
        .snapshot("2026-11")
        .unwrap()
        .entries
        .iter()
        .find(|r| r.id == refunds[0].id)
        .unwrap()
        .revision;
    db.delete(&refunds[0].id, latest).unwrap();
    let nov = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (
            nov.spent_cents,
            nov.goal_excluded_cents,
            nov.allowance_cents
        ),
        (-3, -2, -1)
    );
    db.restore(&db.backup().unwrap()).unwrap();
}

#[test]
fn unknown_or_insufficient_funding_stays_flagged_without_allowance_credit() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = setup(&mut db, "Gift", None);
    let w = withdrawal(&mut db, &g, "200");
    let e = purchase(&mut db, "300", "personal");
    let mut f = funding(&g, "200", None);
    db.save_funding(request(&db, &e, vec![f.clone()])).unwrap();
    assert!(db.funding_view(&e.id).unwrap().rows[0]
        .reason
        .contains("Link the actual"));
    f.withdrawal_id = Some(w.id.clone());
    db.save_funding(request(&db, &e, vec![f.clone()])).unwrap();
    assert!(db.funding_view(&e.id).unwrap().rows[0]
        .reason
        .contains("known account balance"));
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(
        (
            s.goal_excluded_cents,
            s.pending_funding_count,
            s.allowance_cents
        ),
        (0, 1, 30000)
    );
    let cp = checkpoint(&mut db, &g.account_id, "1000");
    assert_eq!(db.snapshot("2026-10").unwrap().goal_excluded_cents, 0); // New facts never auto-approve a held assignment.
    db.save_funding(request(&db, &e, vec![f])).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().goal_excluded_cents, 20000);
    db.save_checkpoint(CheckpointInput {
        id: cp,
        revision: 1,
        account_id: g.account_id.clone(),
        date: "2026-09-30".into(),
        amount: "100".into(),
        purpose: "opening".into(),
        note: "Corrected balance".into(),
    })
    .unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(
        (
            s.goal_excluded_cents,
            s.pending_funding_count,
            s.allowance_cents
        ),
        (0, 1, 30000)
    );
    assert!(db.funding_view(&e.id).unwrap().rows[0]
        .reason
        .contains("insufficient"));
}

#[test]
fn funding_rejects_reused_withdrawals_stale_or_foreign_rows_and_rolls_back_the_whole_change() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = setup(&mut db, "Gift", Some("1000"));
    let other = setup(&mut db, "PTO", Some("1000"));
    let w = withdrawal(&mut db, &g, "200");
    let e = purchase(&mut db, "300", "personal");
    let e2 = purchase(&mut db, "100", "personal");
    let f = funding(&g, "150", Some(&w));
    let original = request(&db, &e, vec![f.clone()]);
    db.save_funding(original.clone()).unwrap();
    assert!(db
        .save_funding(request(&db, &e2, vec![funding(&g, "51", Some(&w))]))
        .is_err());
    let mut bad = funding(&other, "1", Some(&w));
    bad.line_id = "missing".into();
    assert!(db
        .save_funding(request(&db, &e, vec![f.clone(), bad.clone()]))
        .is_err());
    bad.line_id = "main".into();
    assert!(db
        .save_funding(request(&db, &e, vec![f.clone(), bad]))
        .is_err());
    let mut stale = request(&db, &e, vec![]);
    stale.revision = 1;
    assert!(db.save_funding(stale).is_err());
    let mut changed = original.clone();
    changed.rows[0].amount = "151".into();
    assert!(db.save_funding(changed).is_err());
    let mut edit = e.clone();
    edit.revision = db.funding_view(&e.id).unwrap().entry.revision;
    edit.note = "Keep manual choice".into();
    db.save(edit).unwrap();
    db.save_funding(original).unwrap();
    assert_eq!(
        db.funding_view(&e.id).unwrap().entry.note,
        "Keep manual choice"
    );
    assert_eq!(db.funding_view(&e.id).unwrap().rows[0].amount_cents, 15000);
    assert!(db.funding_view(&e2.id).unwrap().rows.is_empty());
}

#[test]
fn funding_protects_purchase_and_withdrawal_history_but_allows_notes_and_explicit_release() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = setup(&mut db, "Gift", Some("1000"));
    let mut w = withdrawal(&mut db, &g, "200");
    let mut e = purchase(&mut db, "300", "personal");
    db.save_funding(request(&db, &e, vec![funding(&g, "200", Some(&w))]))
        .unwrap();
    e.revision += 1;
    let mut changed = e.clone();
    changed.amount = "301".into();
    assert!(db.save(changed).err().unwrap().contains("Goal funding"));
    assert!(db.delete(&e.id, e.revision).is_err());
    assert!(db.delete(&w.id, w.revision).is_err());
    w.date = "2026-10-08".into();
    assert!(db.save(w.clone()).is_err());
    w.date = "2026-10-09".into();
    w.description = "Confirmed withdrawal".into();
    db.save(w.clone()).unwrap();
    w.revision += 1;
    db.save_funding(request(&db, &e, vec![])).unwrap();
    e.revision += 1;
    e.amount = "301".into();
    db.save(e).unwrap();
    db.delete(&w.id, w.revision).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().goal_excluded_cents, 0);
}

#[test]
fn direct_savings_purchases_and_later_goal_card_payments_support_funding_without_duplicate_cash() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = setup(&mut db, "Gift", Some("1000"));
    let mut direct = expense("100", "jacob");
    direct.date = "2026-10-10".into();
    direct.account_id = Some(g.account_id.clone());
    direct.split_mode = "personal".into();
    db.save(direct.clone()).unwrap();
    db.save_funding(request(&db, &direct, vec![funding(&g, "100", None)]))
        .unwrap();
    let e = purchase(&mut db, "200", "personal");
    let mut payment = expense("200", "jacob");
    payment.kind = "card_payment".into();
    payment.category_id = None;
    payment.account_id = Some(g.account_id.clone());
    payment.destination_account_id = Some("amex".into());
    payment.split_mode = "none".into();
    payment.date = "2026-10-20".into();
    db.save(payment.clone()).unwrap();
    assert!(db
        .funding_view(&e.id)
        .unwrap()
        .withdrawals
        .iter()
        .any(|w| w.id == payment.id));
    db.save_funding(request(&db, &e, vec![funding(&g, "200", Some(&payment))]))
        .unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(
        (s.spent_cents, s.goal_excluded_cents, s.allowance_cents),
        (30000, 30000, 0)
    );
    assert_eq!(
        db.goals().unwrap()[0]
            .balance
            .as_ref()
            .unwrap()
            .estimated_cents,
        70000
    );
    let mut other = purchase(&mut db, "10", "personal");
    other.account_id = Some("citi".into());
    db.save(other.clone()).unwrap();
    assert!(db
        .save_funding(request(&db, &other, vec![funding(&g, "1", Some(&payment))]))
        .is_err());
}

#[test]
fn goal_setup_history_and_interest_keep_real_accounts_and_transfers_separate() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut g = setup(&mut db, "Gift", Some("1000"));
    let h = setup(&mut db, "PTO", Some("1000"));
    let mut duplicate = g.clone();
    duplicate.id = Uuid::new_v4().to_string();
    duplicate.revision = 0;
    duplicate.name = "Duplicate".into();
    assert!(db.save_goal(duplicate).is_err());
    let mut move_goal = g.clone();
    move_goal.account_id = h.account_id.clone();
    assert!(db.save_goal(move_goal).is_err());
    let mut contribution = withdrawal(&mut db, &g, "100");
    contribution.account_id = Some("checking".into());
    contribution.destination_account_id = Some(g.account_id.clone());
    db.save(contribution.clone()).unwrap();
    let mut between = withdrawal(&mut db, &g, "100");
    between.destination_account_id = Some(h.account_id.clone());
    db.save(between.clone()).unwrap();
    let e = purchase(&mut db, "10", "personal");
    assert!(db
        .save_funding(request(&db, &e, vec![funding(&g, "10", Some(&between))]))
        .is_err());
    let mut income = expense("5", "jacob");
    income.kind = "income".into();
    income.date = "2026-10-15".into();
    income.category_id = None;
    income.account_id = Some(g.account_id.clone());
    income.split_mode = "personal".into();
    db.save(income.clone()).unwrap();
    db.label_goal_interest(&g.id, &income.id, 1, true).unwrap();
    assert!(db.label_goal_interest(&h.id, &income.id, 2, true).is_err());
    let activity = db.goal_activity(&g.id).unwrap();
    assert!(activity.iter().any(|a| a.purpose == "Interest"));
    assert!(activity.iter().any(|a| a.purpose == "Between goals"));
    assert!(activity.iter().any(|a| a.purpose == "Contribution"));
    assert_eq!(db.snapshot("2026-10").unwrap().income_cents, 500);
    income.revision = 2;
    income.account_id = Some("checking".into());
    assert!(db.save(income).is_err());
    g.archived = true;
    db.save_goal(g.clone()).unwrap();
    assert!(
        db.goals()
            .unwrap()
            .iter()
            .find(|x| x.id == g.id)
            .unwrap()
            .archived
    );
    db.restore(&db.backup().unwrap()).unwrap();
}

#[test]
fn schema18_upgrade_and_corrupt_funding_recovery_preserve_the_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let e = purchase(&mut db, "300", "personal");
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_goal_schema(&c);
    c.pragma_update(None, "user_version", 18).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert!(db.goals().unwrap().is_empty());
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 30000);
    let g = setup(&mut db, "Gift", Some("1000"));
    let w = withdrawal(&mut db, &g, "200");
    db.save_funding(request(&db, &e, vec![funding(&g, "200", Some(&w))]))
        .unwrap();
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    let backup = db.backup().unwrap();
    let c = rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    c.execute("UPDATE goal_funding SET amount_cents=40000", [])
        .unwrap();
    drop(c);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().goal_excluded_cents, 20000);
    let mut demo = Store::open(dir.path(), "demo").unwrap();
    assert!(demo.goals().unwrap().is_empty());
    assert!(demo.save_funding(request(&db, &e, vec![])).is_err());
}

#[test]
fn failed_funding_receipt_rolls_back_every_assignment_and_retries_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = setup(&mut db, "Gift", Some("1000"));
    let w = withdrawal(&mut db, &g, "200");
    let e = purchase(&mut db, "300", "personal");
    let request = request(&db, &e, vec![funding(&g, "200", Some(&w))]);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute_batch("CREATE TRIGGER fail_funding BEFORE INSERT ON goal_funding_receipts BEGIN SELECT RAISE(ABORT,'simulated funding receipt failure'); END;").unwrap();
    assert!(db.save_funding(request.clone()).is_err());
    let view = db.funding_view(&e.id).unwrap();
    assert_eq!(view.entry.revision, 1);
    assert!(view.rows.is_empty());
    assert_eq!(db.snapshot("2026-10").unwrap().goal_excluded_cents, 0);
    c.execute_batch("DROP TRIGGER fail_funding;").unwrap();
    drop(c);
    db.save_funding(request.clone()).unwrap();
    db.save_funding(request).unwrap();
    assert_eq!(db.funding_view(&e.id).unwrap().entry.revision, 2);
}

#[test]
fn held_savings_source_blocks_unsupported_funding_until_explicit_recheck() {
    use crate::imports::{parse, types::Decision};
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = setup(&mut db, "Gift", Some("1000"));
    let w = withdrawal(&mut db, &g, "200");
    let e = purchase(&mut db, "300", "personal");
    let bytes = b"Date,Description,Amount\n2026-10-05,Unknown savings debit,55\n";
    let prepared = parse::prepare("savings.csv", bytes, None).unwrap();
    let source = db.ingest("savings.csv", bytes.to_vec(), prepared).unwrap();
    let d = db.import_detail(&source).unwrap();
    let mut mapping = d.mapping;
    mapping.posted_confirmed = true;
    mapping.amount_mode = "outflow_positive".into();
    db.configure_import(&source, d.source.revision, &g.account_id, mapping)
        .unwrap();
    let f = funding(&g, "200", Some(&w));
    db.save_funding(request(&db, &e, vec![f.clone()])).unwrap();
    assert!(db.funding_view(&e.id).unwrap().rows[0]
        .reason
        .contains("held savings"));
    assert_eq!(db.snapshot("2026-10").unwrap().goal_excluded_cents, 0);
    let d = db.import_detail(&source).unwrap();
    db.commit_import(
        &source,
        d.source.revision,
        &Uuid::new_v4().to_string(),
        vec![Decision {
            row_id: d.rows[0].id.clone(),
            action: "exclude".into(),
            input: None,
            match_id: None,
            match_revision: None,
            confirmed: true,
            separate: false,
            rule_signature: None,
        }],
    )
    .unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().goal_excluded_cents, 0);
    db.save_funding(request(&db, &e, vec![f])).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().goal_excluded_cents, 20000);
}

#[test]
fn imported_purchase_goal_funding_and_bill_matching_share_one_financial_event() {
    use crate::{
        db::bills::{Details, Draft, LinkInput},
        imports::{parse, types::Decision},
    };
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = setup(&mut db, "Annual bill", Some("1000"));
    let w = withdrawal(&mut db, &g, "200");
    let bytes = b"Date,Description,Amount\n2026-10-10,Annual subscription,300\n";
    let prepared = parse::prepare("card.csv", bytes, None).unwrap();
    let source = db.ingest("card.csv", bytes.to_vec(), prepared).unwrap();
    let d = db.import_detail(&source).unwrap();
    let mut m = d.mapping;
    m.posted_confirmed = true;
    m.amount_mode = "outflow_positive".into();
    db.configure_import(&source, d.source.revision, "amex", m)
        .unwrap();
    let d = db.import_detail(&source).unwrap();
    let mut e = expense("300", "jacob");
    e.id = d.rows[0].id.clone();
    e.date = "2026-10-10".into();
    e.description = "Annual subscription".into();
    e.category_id = Some("gifts".into());
    e.split_mode = "personal".into();
    let operation = Uuid::new_v4().to_string();
    db.commit_import(
        &source,
        d.source.revision,
        &operation,
        vec![Decision {
            row_id: e.id.clone(),
            action: "add".into(),
            input: Some(e.clone()),
            match_id: None,
            match_revision: None,
            confirmed: true,
            separate: false,
            rule_signature: None,
        }],
    )
    .unwrap();
    db.save_funding(request(&db, &e, vec![funding(&g, "200", Some(&w))]))
        .unwrap();
    let bill = Uuid::new_v4().to_string();
    db.save_bill_template(
        &bill,
        0,
        "2026-10-10",
        12,
        None,
        false,
        Draft {
            amount: "300".into(),
            lines: vec![],
            details: Details {
                name: "Annual subscription".into(),
                merchant: "Annual".into(),
                category_id: "gifts".into(),
                account_id: Some("amex".into()),
                payer: "jacob".into(),
                split_mode: "personal".into(),
                split_value: String::new(),
                autopay: true,
                payment_kind: "expense".into(),
            },
        },
    )
    .unwrap();
    let occurrence = db.bill_month("2026-10").unwrap().remove(0);
    db.link_bill_payment(LinkInput {
        id: Uuid::new_v4().to_string(),
        occurrence_id: occurrence.id.clone(),
        revision: occurrence.revision,
        event_id: e.id.clone(),
        event_revision: 2,
        amount: "300".into(),
    })
    .unwrap();
    assert_eq!(db.bill_month("2026-10").unwrap()[0].paid_cents, 30000);
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(
        (s.spent_cents, s.allowance_cents, s.monthly_count),
        (30000, 10000, 2)
    );
    assert!(db.undo_import(&operation).is_err());
    assert!(db.purchase_review(&source).unwrap().items[0]
        .reason
        .contains("goal funding"));
    db.restore(&db.backup().unwrap()).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().allowance_cents, 10000);
}

#[test]
fn invalidated_original_funding_flags_the_refund_month_too() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let g = setup(&mut db, "Gift", Some("1000"));
    let w = withdrawal(&mut db, &g, "200");
    let e = purchase(&mut db, "300", "personal");
    db.save_funding(request(&db, &e, vec![funding(&g, "200", Some(&w))]))
        .unwrap();
    refund(&mut db, &e, "100", "2026-11-01");
    let cp = db.balance_checkpoints(&g.account_id).unwrap().remove(0);
    db.delete_checkpoint(&cp.id, cp.revision).unwrap();
    let oct = db.snapshot("2026-10").unwrap();
    let nov = db.snapshot("2026-11").unwrap();
    assert_eq!(oct.pending_funding_count, 1);
    assert_eq!(nov.pending_funding_count, 1);
    assert_eq!(nov.funding_review_entries.len(), 1);
    assert_eq!(nov.funding_review_entries[0].id, e.id);
    assert_eq!((oct.goal_excluded_cents, nov.goal_excluded_cents), (0, 0));
}
