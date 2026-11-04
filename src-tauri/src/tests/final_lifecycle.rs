use super::*;
use crate::db::{
    balances::CheckpointInput, bills::LinkInput, card_statements, identity::CoverageInput,
    periods::CloseInput,
};
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn checkpoint(db: &mut Store, account: &str, amount: &str) {
    db.save_checkpoint(CheckpointInput {
        id: op(),
        revision: 0,
        account_id: account.into(),
        date: "2026-09-30".into(),
        amount: amount.into(),
        purpose: "opening".into(),
        note: "Synthetic starting balance".into(),
    })
    .unwrap();
}
fn close(db: &mut Store, month: &str) {
    let r = db.close_review(month).unwrap();
    assert!(r.blockers.is_empty(), "{:?}", r.blockers);
    db.close_month(CloseInput {
        id: op(),
        month: month.into(),
        revision: r.revision,
        token: r.token,
        acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
        note: "Synthetic final lifecycle".into(),
        carry: None,
    })
    .unwrap();
}
#[test]
fn final_lifecycle_imports_624_payment_bill_goal_refund_closed_year_restore_and_laptop() {
    let desktop = tempfile::tempdir().unwrap();
    let laptop = tempfile::tempdir().unwrap();
    let mut db = Store::open(desktop.path(), "personal").unwrap();
    checkpoint(&mut db, "checking", "10000");
    checkpoint(&mut db, "amex", "0");
    let goal = super::goals::setup(&mut db, "Gift", Some("1000"));
    close(&mut db, "2026-09");
    let bill = op();
    db.save_bill_template(
        &bill,
        0,
        "2026-10-03",
        1,
        Some("2026-10-03".into()),
        false,
        super::bills::draft("Synthetic utility", "100"),
    )
    .unwrap();
    let csv=super::imports::csv("2026-10-01,Groceries,40.00\n2026-10-02,Household,60.00\n2026-10-03,Utility,100.00\n2026-10-10,Hobby,124.00\n2026-10-11,Gift,300.00\n2026-10-20,Card payment,-624.00\n");
    let first = super::imports::stage(&mut db, &csv, "amex");
    let source = first.source.id;
    db.confirm_import_coverage(
        &source,
        first.source.revision,
        CoverageInput {
            start_date: "2026-10-01".into(),
            end_date: "2026-10-31".into(),
            date_basis: "transaction".into(),
            completeness: "complete".into(),
            profile: "Synthetic lifecycle card".into(),
            observed_at: "2026-11-01T12:00:00Z".into(),
            inclusive: true,
        },
    )
    .unwrap();
    let d = db.import_detail(&source).unwrap();
    let mut decisions = vec![];
    let mut originals = vec![];
    for (i, row) in d.rows.iter().enumerate() {
        let mut decision = super::imports::add(row);
        decision.separate = true;
        let e = decision.input.as_mut().unwrap();
        if i == 2 {
            e.category_id = Some("home".into());
            e.split_mode = "shared".into();
        }
        if i == 4 {
            e.category_id = Some("gifts".into());
        }
        if i == 5 {
            e.kind = "card_payment".into();
            e.account_id = Some("checking".into());
            e.destination_account_id = Some("amex".into());
            e.category_id = None;
            e.split_mode = "none".into();
        }
        originals.push(e.clone());
        decisions.push(decision);
    }
    let raw = serde_json::to_string(&decisions).unwrap();
    let operation = op();
    db.commit_import(&source, d.source.revision, &operation, decisions)
        .unwrap();
    db.commit_import(
        &source,
        d.source.revision,
        &operation,
        serde_json::from_str(&raw).unwrap(),
    )
    .unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.entries.len(), 6);
    assert_eq!(
        (s.spent_cents, s.income_cents, s.household_cents),
        (59400, 0, 3000)
    );
    assert_eq!(
        s.entries
            .iter()
            .filter(|e| e.kind == "expense")
            .map(|e| e.amount_cents)
            .sum::<i64>(),
        62400
    );
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        0
    );
    // The imported utility is the payment. Linking the bill must not create another expense.
    let occurrence = db.bill_month("2026-10").unwrap().remove(0);
    db.link_bill_payment(LinkInput {
        id: op(),
        occurrence_id: occurrence.id.clone(),
        revision: occurrence.revision,
        event_id: originals[2].id.clone(),
        event_revision: 1,
        amount: "100".into(),
    })
    .unwrap();
    let occurrence = db.bill_month("2026-10").unwrap().remove(0);
    assert_eq!(
        (occurrence.paid_cents, occurrence.remaining_cents),
        (10000, 0)
    );
    db.bill_evidence(&occurrence.id, occurrence.revision, &source, false)
        .unwrap();
    let withdrawal = super::goals::withdrawal(&mut db, &goal, "300");
    db.save_funding(super::goals::request(
        &db,
        &originals[4],
        vec![super::goals::funding(&goal, "300", Some(&withdrawal))],
    ))
    .unwrap();
    let mut repayment = repayment("30", "chelsea", true);
    repayment.date = "2026-10-22".into();
    db.save(repayment).unwrap();
    db.set_budget("2026-10", "groceries", "500").unwrap();
    db.set_budget("2026-10", "home", "100").unwrap();
    db.set_budget("2026-10", "gifts", "100").unwrap();
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(
        (
            s.spent_cents,
            s.goal_excluded_cents,
            s.allowance_cents,
            s.income_cents,
            s.household_cents
        ),
        (59400, 30000, 29400, 0, 0)
    );
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "checking")
            .unwrap()
            .activity_cents,
        -29400
    );
    let shared = db.shared_statement(Some("2026-10")).unwrap();
    assert_eq!(
        (
            shared.bills_cents,
            shared.repayment_cents,
            shared.closing_cents
        ),
        (3000, -3000, 0)
    );
    // A cutoff before the payment still sees all $624, independently of personal shares/goals.
    db.save_card_statement_config(
        &op(),
        card_statements::Config {
            account_id: "amex".into(),
            revision: 0,
            first_month: "2026-10".into(),
            closing_day: 15,
            due_day: 10,
            due_month_offset: 1,
            date_basis: "transaction".into(),
            archived: false,
        },
    )
    .unwrap();
    let mut statement = db
        .card_statement_month("2026-10")
        .unwrap()
        .statements
        .remove(0)
        .draft;
    statement.dates_confirmed = true;
    statement.balance = Some("624".into());
    statement.note = "Synthetic issued cutoff".into();
    statement.evidence_source_id = Some(source.clone());
    let review = db.review_card_statement(statement.clone()).unwrap();
    assert_eq!(review.calculation.balance_cents, Some(62400));
    db.save_card_statement(
        &op(),
        card_statements::Save {
            draft: statement,
            token: review.token,
            confirmed: true,
        },
    )
    .unwrap();
    let forecast = db.cash_forecast("checking", 30).unwrap();
    assert_eq!(forecast.opening.balance_cents, Some(970600));
    assert!(forecast.incomplete);
    close(&mut db, "2026-10");
    let annual = db.annual_report(2026).unwrap();
    assert_eq!(annual.closed_months, 2);
    assert_eq!(annual.average_closed_spending_cents, Some(29700));
    // A later refund reverses its goal-only treatment but does not deposit cash into the goal.
    let mut refund = expense("50", "jacob");
    refund.kind = "refund".into();
    refund.date = "2026-11-02".into();
    refund.original_event_id = Some(originals[4].id.clone());
    db.save(refund).unwrap();
    let nov = db.snapshot("2026-11").unwrap();
    assert_eq!(
        (
            nov.spent_cents,
            nov.goal_excluded_cents,
            nov.allowance_cents
        ),
        (-5000, -5000, 0)
    );
    assert!(!db.close_review("2026-10").unwrap().changed);
    assert_eq!(
        db.goals()
            .unwrap()
            .iter()
            .find(|g| g.id == goal.id)
            .unwrap()
            .balance
            .as_ref()
            .unwrap()
            .estimated_cents,
        70000
    );
    assert_eq!(db.annual_report(2026).unwrap().actual_spending_cents, 54400);
    let p = crate::imports::parse::prepare("test.csv", csv.as_bytes(), None).unwrap();
    db.ingest("test.csv", csv.as_bytes().to_vec(), p).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().entries.len(), 8);
    let backup = db.backup().unwrap();
    drop(db);
    let mut db = Store::open(desktop.path(), "personal").unwrap();
    db.restore(&backup).unwrap();
    let exported = db
        .export_handoff(
            &op(),
            "Synthetic lifecycle to laptop",
            "synthetic testing passphrase".into(),
        )
        .unwrap();
    let bytes = std::fs::read(exported.path).unwrap();
    let mut other = Store::open(laptop.path(), "personal").unwrap();
    let r = other
        .preview_handoff(&bytes, "synthetic testing passphrase".into())
        .unwrap();
    other
        .apply_handoff(
            &op(),
            &bytes,
            "synthetic testing passphrase".into(),
            &r.token,
            true,
            true,
        )
        .unwrap();
    assert_eq!(other.import_content(&source).unwrap().1, csv.as_bytes());
    assert_eq!(
        other.annual_report(2026).unwrap().actual_spending_cents,
        54400
    );
    assert_eq!(other.annual_report(2026).unwrap().closed_months, 2);
    assert!(!other.close_review("2026-10").unwrap().changed);
    assert_eq!(other.bill_month("2026-10").unwrap()[0].remaining_cents, 0);
    assert_eq!(other.shared_statement(None).unwrap().closing_cents, 0);
    assert_eq!(other.snapshot("2026-11").unwrap().allowance_cents, 0);
    let protected = other
        .snapshot("2026-10")
        .unwrap()
        .entries
        .iter()
        .find(|e| e.id == originals[0].id)
        .unwrap()
        .revision;
    assert!(other.delete(&originals[0].id, protected).is_err());
    assert_eq!(
        Store::open(laptop.path(), "demo")
            .unwrap()
            .import_list()
            .unwrap()
            .len(),
        0
    );
}
