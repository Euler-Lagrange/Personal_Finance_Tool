use super::*;
use crate::db::{balances::CheckpointInput, card_statements, cash_forecast::*, cash_plans};
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn cp(db: &mut Store, account: &str, date: &str, amount: &str) {
    db.save_checkpoint(CheckpointInput {
        id: op(),
        revision: 0,
        account_id: account.into(),
        date: date.into(),
        amount: amount.into(),
        purpose: "confirmed".into(),
        note: "Synthetic opening".into(),
    })
    .unwrap();
}
#[allow(clippy::too_many_arguments)]
fn plan(
    db: &mut Store,
    kind: &str,
    amount: &str,
    anchor: &str,
    cadence: &str,
    account: Option<&str>,
    destination: Option<&str>,
    payer: &str,
) -> String {
    let id = op();
    db.save_cash_schedule(
        &op(),
        cash_plans::Schedule {
            id: id.clone(),
            revision: 0,
            anchor: anchor.into(),
            cadence: cadence.into(),
            second_day: None,
            end_date: None,
            archived: false,
            plan: cash_plans::Plan {
                name: format!("Synthetic {kind}"),
                kind: kind.into(),
                amount: amount.into(),
                account_id: account.map(str::to_string),
                destination_account_id: destination.map(str::to_string),
                payer: payer.into(),
            },
        },
    )
    .unwrap();
    id
}
fn config(db: &mut Store, first: &str) {
    db.save_card_statement_config(
        &op(),
        card_statements::Config {
            account_id: "amex".into(),
            revision: 0,
            first_month: first.into(),
            closing_day: 20,
            due_day: 15,
            due_month_offset: 1,
            date_basis: "posted".into(),
            archived: false,
        },
    )
    .unwrap();
    db.save_forecast_settings(
        &op(),
        Settings {
            revision: 0,
            funding: vec![Funding {
                card_id: "amex".into(),
                checking_id: "checking".into(),
            }],
        },
    )
    .unwrap();
}
fn bill(db: &mut Store, name: &str, amount: &str, first: &str, account: &str) -> String {
    let id = op();
    let mut d = super::bills::draft(name, amount);
    d.details.account_id = Some(account.into());
    db.save_bill_template(&id, 0, first, 1, None, false, d)
        .unwrap();
    id
}
#[test]
fn forecast_virtual_schedules_full_shared_bills_and_goal_transfers_do_not_write_money_or_occurrences(
) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    cp(&mut db, "checking", "2026-09-30", "1000");
    plan(
        &mut db,
        "income",
        "1000",
        "2026-10-02",
        "biweekly",
        Some("checking"),
        None,
        "jacob",
    );
    let savings = op();
    db.save_account(AccountInput {
        id: savings.clone(),
        revision: 0,
        name: "Synthetic Gift fund".into(),
        kind: "savings".into(),
        archived: false,
        tracking_mode: "manual".into(),
    })
    .unwrap();
    plan(
        &mut db,
        "transfer",
        "100",
        "2026-10-05",
        "monthly",
        Some("checking"),
        Some(&savings),
        "jacob",
    );
    plan(
        &mut db,
        "settlement",
        "60",
        "2026-10-06",
        "once",
        None,
        None,
        "chelsea",
    );
    bill(&mut db, "Full shared rent", "200", "2026-10-05", "checking");
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    let before: i64 = conn
        .query_row("SELECT COUNT(*) FROM audit", [], |r| r.get(0))
        .unwrap();
    let v = db.cash_forecast_at("checking", 31, "2026-09-30").unwrap();
    assert_eq!(v.rows.iter().filter(|r| r.source == "income").count(), 3);
    assert_eq!(
        v.rows
            .iter()
            .find(|r| r.source == "bill")
            .unwrap()
            .amount_cents,
        Some(-20000)
    );
    assert!(!v.rows.iter().any(|r| r.source == "settlement"));
    assert_eq!(v.ending_known_cents, Some(370000));
    assert_eq!(v.before_next_pay_cents, Some(100000));
    assert_eq!(v.next_pay_date.as_deref(), Some("2026-10-02"));
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM audit", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        before
    );
    assert_eq!(conn.query_row("SELECT (SELECT COUNT(*) FROM events)+(SELECT COUNT(*) FROM cash_occurrences)+(SELECT COUNT(*) FROM bill_occurrences)",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(
        serde_json::to_string(&v).unwrap(),
        serde_json::to_string(&db.cash_forecast_at("checking", 31, "2026-09-30").unwrap()).unwrap()
    );
}
#[test]
fn forecast_saved_override_cancel_match_and_possible_actual_exclude_replayed_income() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    cp(&mut db, "checking", "2026-09-01", "500");
    let id = plan(
        &mut db,
        "income",
        "100",
        "2026-09-20",
        "weekly",
        Some("checking"),
        None,
        "jacob",
    );
    let v = db.cash_month("2026-10").unwrap();
    let first = &v.occurrences[0];
    db.save_cash_occurrence(
        &op(),
        cash_plans::Edit {
            id: first.id.clone(),
            revision: 1,
            due_date: "2026-11-06".into(),
            plan: first.plan.clone(),
            cancelled: false,
            note: "Moved to November".into(),
        },
    )
    .unwrap();
    let second = &v.occurrences[1];
    db.save_cash_occurrence(
        &op(),
        cash_plans::Edit {
            id: second.id.clone(),
            revision: 1,
            due_date: second.due_date.clone(),
            plan: second.plan.clone(),
            cancelled: true,
            note: "Cancelled".into(),
        },
    )
    .unwrap();
    let mut e = expense("120", "jacob");
    e.kind = "income".into();
    e.account_id = Some("checking".into());
    e.date = "2026-09-29".into();
    e.category_id = None;
    e.split_mode = "personal".into();
    db.save(e).unwrap();
    let view = db.cash_forecast_at("checking", 45, "2026-09-30").unwrap();
    assert!(view
        .rows
        .iter()
        .any(|r| r.id == first.id && r.date == "2026-11-06"));
    assert!(!view.rows.iter().any(|r| r.id == second.id));
    assert!(view
        .rows
        .iter()
        .filter(|r| r.date == "2026-09-27")
        .all(|r| !r.included));
    assert!(!view
        .rows
        .iter()
        .any(|r| r.id.starts_with(&format!("cash:{id}:2026-10-04"))));
    assert_eq!(view.opening.balance_cents, Some(62000));
    let actual = plan(
        &mut db,
        "income",
        "50",
        "2026-09-30",
        "once",
        Some("checking"),
        None,
        "jacob",
    );
    let occurrence = db
        .cash_month("2026-09")
        .unwrap()
        .occurrences
        .into_iter()
        .find(|o| o.schedule_id == actual)
        .unwrap();
    let mut e = expense("50", "jacob");
    e.kind = "income".into();
    e.account_id = Some("checking".into());
    e.category_id = None;
    e.date = "2026-09-30".into();
    e.split_mode = "personal".into();
    db.record_cash(
        &op(),
        cash_plans::Record {
            id: occurrence.id.clone(),
            revision: 1,
            entry: e,
            confirmed: true,
        },
    )
    .unwrap();
    assert!(!db
        .cash_forecast_at("checking", 30, "2026-09-30")
        .unwrap()
        .rows
        .iter()
        .any(|r| r.id == occurrence.id));
}
#[test]
fn forecast_card_remaining_and_unbilled_future_bills_are_incremental_not_cumulative() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    cp(&mut db, "checking", "2026-09-30", "1000");
    cp(&mut db, "amex", "2026-09-30", "150");
    config(&mut db, "2026-09");
    super::card_payments::statement(&mut db, "2026-09", "100");
    super::card_payments::approve(&mut db, "2026-09");
    bill(&mut db, "Card utility", "20", "2026-10-10", "amex");
    let v = db.cash_forecast_at("checking", 90, "2026-09-30").unwrap();
    let card: Vec<_> = v
        .rows
        .iter()
        .filter(|r| r.source.starts_with("card_"))
        .collect();
    assert_eq!(
        card.iter().map(|r| r.amount_cents).collect::<Vec<_>>(),
        vec![Some(-10000), Some(-7000), Some(-2000)]
    );
    assert!(!v.rows.iter().any(|r| r.source == "bill"));
    assert_eq!(v.ending_known_cents, Some(81000));
    let p = super::card_payments::payment(&mut db, "2026-10-01", "60");
    let unknown = db.cash_forecast_at("checking", 60, "2026-10-02").unwrap();
    assert_eq!(
        unknown
            .rows
            .iter()
            .find(|r| r.source == "card_payment")
            .unwrap()
            .amount_cents,
        None
    );
    super::card_payments::allocate(&mut db, &p.id, &[("2026-09", "60")]);
    let partial = db.cash_forecast_at("checking", 60, "2026-10-02").unwrap();
    assert_eq!(partial.opening.balance_cents, Some(94000));
    assert_eq!(
        partial
            .rows
            .iter()
            .find(|r| r.source == "card_payment")
            .unwrap()
            .amount_cents,
        Some(-4000)
    );
    assert_eq!(
        partial
            .rows
            .iter()
            .find(|r| r.source == "card_estimate")
            .unwrap()
            .amount_cents,
        Some(-7000)
    );
    assert_eq!(partial.ending_known_cents, Some(83000));
}
#[test]
fn forecast_future_recorded_pay_and_card_purchase_are_included_once_not_as_duplicate_plans() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    cp(&mut db, "checking", "2026-09-30", "1000");
    cp(&mut db, "amex", "2026-09-30", "0");
    config(&mut db, "2026-10");
    plan(
        &mut db,
        "income",
        "100",
        "2026-10-05",
        "once",
        Some("checking"),
        None,
        "jacob",
    );
    let mut e = expense("100", "jacob");
    e.kind = "income".into();
    e.account_id = Some("checking".into());
    e.category_id = None;
    e.date = "2026-10-05".into();
    e.split_mode = "personal".into();
    db.save(e).unwrap();
    let mut e = expense("25", "jacob");
    e.date = "2026-10-07".into();
    e.split_mode = "personal".into();
    db.save(e).unwrap();
    let v = db.cash_forecast_at("checking", 60, "2026-09-30").unwrap();
    assert_eq!(
        v.rows
            .iter()
            .find(|r| r.source == "card_estimate")
            .unwrap()
            .amount_cents,
        Some(-2500)
    );
    assert!(
        !v.rows
            .iter()
            .find(|r| r.source == "income")
            .unwrap()
            .included
    );
    assert_eq!(v.ending_known_cents, Some(107500));
}
#[test]
fn forecast_unknown_balances_coverage_overdue_and_same_day_outflow_order_are_explicit() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    plan(
        &mut db,
        "income",
        "100",
        "2026-10-05",
        "once",
        Some("checking"),
        None,
        "jacob",
    );
    bill(&mut db, "Bill first", "50", "2026-10-05", "checking");
    bill(&mut db, "Overdue", "20", "2026-09-01", "checking");
    db.bill_month("2026-09").unwrap();
    let unknown = db.cash_forecast_at("checking", 7, "2026-10-01").unwrap();
    assert!(unknown.incomplete);
    assert_eq!(unknown.ending_known_cents, None);
    cp(&mut db, "checking", "2026-09-30", "80");
    let known = db.cash_forecast_at("checking", 7, "2026-10-01").unwrap();
    assert!(!known.opening.complete);
    assert!(!known.opening.gaps.is_empty());
    assert_eq!(known.before_next_pay_cents, Some(3000));
    assert_eq!(known.lowest_known_cents, Some(3000));
    assert_eq!(known.ending_known_cents, Some(13000));
    assert!(known
        .rows
        .iter()
        .filter(|r| r.date.as_str() <= "2026-10-01")
        .all(|r| !r.included));
    assert!(db.cash_forecast("amex", 30).is_err());
    assert!(db.cash_forecast("checking", 91).is_err());
}
#[test]
fn forecast_settings_retry_stale_and_invalid_restore_preserve_accounts_and_choices() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = Settings {
        revision: 0,
        funding: vec![Funding {
            card_id: "amex".into(),
            checking_id: "checking".into(),
        }],
    };
    let operation = op();
    db.save_forecast_settings(&operation, s.clone()).unwrap();
    db.save_forecast_settings(&operation, s.clone()).unwrap();
    assert!(db.save_forecast_settings(&op(), s.clone()).is_err());
    assert!(db
        .save_forecast_settings(
            &operation,
            Settings {
                revision: 1,
                funding: vec![]
            }
        )
        .is_err());
    let mut invalid = s.clone();
    invalid.revision = 1;
    invalid.funding[0].checking_id = "savings".into();
    assert!(db.save_forecast_settings(&op(), invalid).is_err());
    let good = db.backup().unwrap();
    db.restore(&good).unwrap();
    assert_eq!(db.forecast_settings().unwrap().revision, 1);
    let bad = db.backup().unwrap();
    let conn = rusqlite::Connection::open(dir.path().join("backups/personal").join(&bad)).unwrap();
    conn.execute(
        "UPDATE cash_forecast_settings SET input_json=?1",
        [r#"{"revision":1,"funding":[{"cardId":"checking","checkingId":"amex"}]}"#],
    )
    .unwrap();
    drop(conn);
    assert!(db.restore(&bad).is_err());
    assert_eq!(db.forecast_settings().unwrap().funding[0].card_id, "amex");
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    super::remove_cash_forecast_schema(&conn);
    conn.pragma_update(None, "user_version", 26).unwrap();
    drop(conn);
    let db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.forecast_settings().unwrap().revision, 0);
}
#[test]
fn forecast_paypal_holding_is_not_cash_and_an_explicit_cashout_can_match_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    cp(&mut db, "checking", "2026-09-30", "100");
    db.save_household_opening(crate::db::household::OpeningInput {
        revision: 0,
        date: "2026-09-30".into(),
        amount: "50".into(),
        note: "Synthetic outstanding share".into(),
        reconciled: true,
    })
    .unwrap();
    let mut receipt = repayment("50", "chelsea", false);
    receipt.date = "2026-10-01".into();
    db.save(receipt.clone()).unwrap();
    let baseline = db.cash_forecast_at("checking", 7, "2026-10-01").unwrap();
    assert_eq!(baseline.ending_known_cents, Some(10000));
    let id = plan(
        &mut db,
        "paypal_cashout",
        "50",
        "2026-10-03",
        "once",
        Some("checking"),
        None,
        "jacob",
    );
    assert_eq!(
        db.cash_forecast_at("checking", 7, "2026-10-01")
            .unwrap()
            .ending_known_cents,
        Some(15000)
    );
    let o = db
        .cash_month("2026-10")
        .unwrap()
        .occurrences
        .into_iter()
        .find(|o| o.schedule_id == id)
        .unwrap();
    let mut cash = expense("50", "jacob");
    cash.kind = "paypal_cashout".into();
    cash.date = "2026-10-03".into();
    cash.account_id = Some("checking".into());
    cash.category_id = None;
    cash.split_mode = "none".into();
    cash.paypal = Some(crate::models::PayPalInput {
        receipts: vec![crate::models::ReceiptInput {
            id: receipt.id,
            revision: 1,
            amount: "50".into(),
        }],
        fee: "0".into(),
        fee_category_id: None,
        other: "0".into(),
        other_note: String::new(),
    });
    db.save(cash.clone()).unwrap();
    assert_eq!(db.cash_candidates(&o.id).unwrap()[0].id, cash.id);
    db.match_cash(
        &op(),
        cash_plans::Match {
            id: o.id.clone(),
            revision: 1,
            event_id: cash.id.clone(),
            event_revision: 1,
            confirmed: true,
        },
    )
    .unwrap();
    let v = db.cash_forecast_at("checking", 7, "2026-10-04").unwrap();
    assert_eq!(v.ending_known_cents, Some(15000));
    assert!(!v.rows.iter().any(|r| r.id == o.id));
    assert!(db.delete(&cash.id, 1).is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().income_cents, 0);
}

#[test]
fn forecast_checking_posted_dates_coverage_and_budget_periods_remain_independent() {
    use crate::imports::{parse, types::Decision};
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    cp(&mut db, "checking", "2026-09-30", "100");
    let csv = b"Date,Description,Amount,Posted\n2026-09-30,Boundary purchase,25,2026-10-01\n";
    let prepared = parse::prepare("bank.csv", csv, None).unwrap();
    let id = db.ingest("bank.csv", csv.to_vec(), prepared).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.posted_date_column = Some(3);
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    db.configure_import(&id, d.source.revision, "checking", m)
        .unwrap();
    let d = db.import_detail(&id).unwrap();
    db.confirm_import_coverage(
        &id,
        d.source.revision,
        crate::db::identity::CoverageInput {
            start_date: "2026-10-01".into(),
            end_date: "2026-10-03".into(),
            date_basis: "posted".into(),
            completeness: "complete".into(),
            profile: "Synthetic checking export".into(),
            observed_at: "2026-10-03T18:00:00Z".into(),
            inclusive: true,
        },
    )
    .unwrap();
    let pending = db.cash_forecast_at("checking", 7, "2026-10-03").unwrap();
    assert!(pending.opening.unresolved_count > 0);
    assert!(!pending.opening.complete);
    let d = db.import_detail(&id).unwrap();
    let r = &d.rows[0];
    let mut e = expense("25", "jacob");
    e.id = r.id.clone();
    e.date = "2026-09-30".into();
    e.account_id = Some("checking".into());
    e.description = "Boundary purchase".into();
    e.split_mode = "personal".into();
    e.budget_override = Some(crate::db::budget_periods::Choice {
        month: Some("2026-10".into()),
        reason: "Synthetic later budget".into(),
    });
    db.commit_import(
        &id,
        d.source.revision,
        &op(),
        vec![Decision {
            row_id: r.id.clone(),
            action: "add".into(),
            input: Some(e),
            match_id: None,
            match_revision: None,
            confirmed: true,
            separate: true,
            rule_signature: None,
        }],
    )
    .unwrap();
    let v = db.cash_forecast_at("checking", 7, "2026-10-03").unwrap();
    assert_eq!(v.opening.balance_cents, Some(7500));
    assert!(v.opening.complete);
    assert_eq!(v.opening.assumed_date_count, 0);
    assert_eq!(
        v.last_observed_at.as_deref(),
        Some("2026-10-03T18:00:00.000Z")
    );
    assert_eq!(db.snapshot("2026-10").unwrap().consumption_cents, 2500);
    let close = db.close_review("2026-10").unwrap();
    db.close_month(crate::db::periods::CloseInput {
        id: op(),
        month: "2026-10".into(),
        revision: close.revision,
        token: close.token,
        acknowledgements: close.warnings.into_iter().map(|w| w.id).collect(),
        note: String::new(),
        carry: None,
    })
    .unwrap();
    assert_eq!(
        db.cash_forecast_at("checking", 7, "2026-10-03")
            .unwrap()
            .opening
            .balance_cents,
        Some(7500)
    );
}
#[test]
fn forecast_carried_card_debt_is_not_added_twice_and_credit_balance_carries_forward() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    cp(&mut db, "checking", "2026-10-31", "1000");
    cp(&mut db, "amex", "2026-10-31", "150");
    config(&mut db, "2026-09");
    super::card_payments::statement(&mut db, "2026-09", "100");
    super::card_payments::approve(&mut db, "2026-09");
    super::card_payments::statement(&mut db, "2026-10", "150");
    super::card_payments::approve(&mut db, "2026-10");
    let v = db.cash_forecast_at("checking", 60, "2026-10-31").unwrap();
    let due: Vec<_> = v
        .rows
        .iter()
        .filter(|r| r.source == "card_payment")
        .collect();
    assert_eq!(
        due.iter().map(|r| r.amount_cents.unwrap()).sum::<i64>(),
        -15000
    );
    assert_eq!(due[0].date, "2026-11-01");
    assert!(due[0].reason.contains("Overdue"));
    assert_eq!(v.ending_known_cents, Some(85000));
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    cp(&mut db, "checking", "2026-09-30", "1000");
    cp(&mut db, "amex", "2026-09-30", "-50");
    config(&mut db, "2026-10");
    bill(&mut db, "Small monthly bill", "20", "2026-10-10", "amex");
    let v = db.cash_forecast_at("checking", 90, "2026-09-30").unwrap();
    assert!(v
        .rows
        .iter()
        .filter(|r| r.source == "card_estimate")
        .all(|r| r.amount_cents == Some(0)));
    assert_eq!(v.ending_known_cents, Some(100000));
}

#[test]
fn forecast_bill_matching_normalizes_punctuation_and_holds_possible_recorded_payment() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    cp(&mut db, "checking", "2026-09-30", "100");
    let mut b = super::bills::draft("Utility invoice", "20");
    b.details.account_id = Some("checking".into());
    b.details.merchant = "utility invoice".into();
    db.save_bill_template(&op(), 0, "2026-10-05", 1, None, false, b)
        .unwrap();
    let mut e = expense("20", "jacob");
    e.date = "2026-10-02".into();
    e.account_id = Some("checking".into());
    e.description = "Utility * Invoice".into();
    db.save(e).unwrap();
    let v = db.cash_forecast_at("checking", 7, "2026-10-02").unwrap();
    assert!(!v.rows.iter().find(|r| r.source == "bill").unwrap().included);
    assert_eq!(v.ending_known_cents, Some(8000));
}
