use super::*;
use crate::{
    db::{
        balances::CheckpointInput,
        classification::{Policy, Preferences, TypeCode},
        identity::{CoverageInput, CoverageRequest},
        movements::ReconcileInput,
    },
    imports::{parse, types::Receipt},
    models::Entry,
};
fn policy(kind: &str, other: &str) -> Policy {
    Policy {
        ordinary_card_charges: true,
        ownership: "personal".into(),
        types: vec![TypeCode {
            code: "PAYMENT".into(),
            kind: kind.into(),
            account_id: Some(other.into()),
        }],
    }
}
fn coverage() -> CoverageInput {
    CoverageInput {
        start_date: "2026-10-01".into(),
        end_date: "2026-10-31".into(),
        date_basis: "transaction".into(),
        completeness: "complete".into(),
        profile: "Synthetic verified movement".into(),
        observed_at: "2026-11-01T18:00:00Z".into(),
        inclusive: true,
    }
}
fn stage(db: &mut Store, account: &str, body: &str) -> String {
    let bytes = format!("Date,Description,Amount,ID,Posted,Type\n{body}").into_bytes();
    let prepared = parse::prepare("synthetic.csv", &bytes, None).unwrap();
    let id = db.ingest("synthetic.csv", bytes, prepared).unwrap();
    let d = db.import_detail(&id).unwrap();
    let mut m = d.mapping;
    m.amount_mode = "outflow_positive".into();
    m.posted_confirmed = true;
    m.stable_id_column = Some(3);
    m.stable_ids_confirmed = true;
    m.posted_date_column = Some(4);
    m.type_column = Some(5);
    db.configure_import(&id, d.source.revision, account, m)
        .unwrap();
    let rev = db.import_detail(&id).unwrap().source.revision;
    db.confirm_import_coverage(&id, rev, coverage()).unwrap();
    id
}
fn process(db: &mut Store, id: &str, p: Policy) -> (String, Receipt) {
    let rev = db.import_detail(id).unwrap().source.revision;
    let op = Uuid::new_v4().to_string();
    let receipt = db
        .process_import_with_preferences(
            id,
            rev,
            &op,
            p,
            Some(Preferences {
                remember: true,
                automatic: true,
            }),
        )
        .unwrap();
    (op, receipt)
}
fn unknown() -> Policy {
    Policy {
        ordinary_card_charges: false,
        ownership: "ask".into(),
        types: vec![],
    }
}
fn entries(db: &Store) -> Vec<Entry> {
    db.snapshot("2026-10").unwrap().entries
}
fn activity(db: &Store, account: &str) -> i64 {
    db.snapshot("2026-10")
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.id == account)
        .unwrap()
        .activity_cents
}
fn date(entry: &Entry, account: &str) -> String {
    entry
        .activity_dates
        .iter()
        .find(|d| d.account_id == account)
        .unwrap()
        .date
        .clone()
}
fn reconcile(a: &Entry, b: &Entry) -> ReconcileInput {
    ReconcileInput {
        operation_id: Uuid::new_v4().to_string(),
        event_id: a.id.clone(),
        revision: a.revision,
        match_id: b.id.clone(),
        match_revision: b.revision,
        confirmed: true,
    }
}

#[test]
fn verified_codes_link_both_import_orders_once_and_keep_separate_posting_dates() {
    for card_first in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path(), "personal").unwrap();
        for _ in 0..5 {
            let mut e = expense("124.80", "jacob");
            e.date = "2026-10-05".into();
            e.split_mode = "personal".into();
            db.save(e).unwrap();
        }
        for (account, day, amount) in [
            ("checking", "2026-10-10", "1000"),
            ("amex", "2026-10-12", "624"),
        ] {
            db.save_checkpoint(CheckpointInput {
                id: Uuid::new_v4().to_string(),
                revision: 0,
                account_id: account.into(),
                date: day.into(),
                amount: amount.into(),
                purpose: "opening".into(),
                note: String::new(),
            })
            .unwrap();
        }
        let bank = stage(
            &mut db,
            "checking",
            "2026-10-10,Card payment,624,BANK,2026-10-11,PAYMENT\n",
        );
        let card = stage(
            &mut db,
            "amex",
            "2026-10-12,Payment received,-624,CARD,2026-10-13,PAYMENT\n",
        );
        let (first, second, first_policy, second_policy) = if card_first {
            (
                &card,
                &bank,
                policy("card_payment", "checking"),
                policy("card_payment", "amex"),
            )
        } else {
            (
                &bank,
                &card,
                policy("card_payment", "amex"),
                policy("card_payment", "checking"),
            )
        };
        let (original, r) = process(&mut db, first, first_policy);
        assert_eq!((r.added, r.linked), (1, 0));
        let second_rev = db.import_detail(second).unwrap().source.revision;
        let (link, r) = process(&mut db, second, second_policy.clone());
        assert_eq!((r.added, r.linked), (0, 1));
        assert!(
            db.process_import_with_preferences(
                second,
                second_rev,
                &link,
                second_policy,
                Some(Preferences {
                    remember: true,
                    automatic: true
                })
            )
            .unwrap()
            .already_processed
        );
        let s = db.snapshot("2026-10").unwrap();
        assert_eq!(s.spent_cents, 62400);
        assert_eq!(s.income_cents, 0);
        assert_eq!(s.household_cents, 0);
        assert_eq!(
            s.accounts
                .iter()
                .find(|a| a.id == "checking")
                .unwrap()
                .balance
                .as_ref()
                .unwrap()
                .estimated_cents,
            37600
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
            0
        );
        assert_eq!(activity(&db, "checking"), -62400);
        assert_eq!(activity(&db, "amex"), 0);
        let movement = s.entries.iter().find(|e| e.kind == "card_payment").unwrap();
        assert_eq!(date(movement, "checking"), "2026-10-11");
        assert_eq!(date(movement, "amex"), "2026-10-13");
        assert!(db.undo_import(&original).is_err());
        db.restore(&db.backup().unwrap()).unwrap();
        let again = db.import_detail(second).unwrap();
        assert_eq!(
            again.rows[0].event_id.as_deref(),
            Some(movement.id.as_str())
        );
        db.undo_import(&link).unwrap();
        assert_eq!(entries(&db).len(), 6);
        let movement = entries(&db)
            .into_iter()
            .find(|e| e.kind == "card_payment")
            .unwrap();
        assert_eq!(
            date(&movement, if card_first { "checking" } else { "amex" }),
            movement.date
        );
        db.undo_import(&original).unwrap();
        assert_eq!(entries(&db).len(), 5);
        assert_eq!(activity(&db, "amex"), 62400);
    }
}

#[test]
fn known_code_after_unknown_opposite_leg_requires_reconciliation_without_an_extra_leg() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let bank = stage(
        &mut db,
        "checking",
        "2026-10-10,Unknown debit,624,B,2026-10-11,\n",
    );
    process(&mut db, &bank, unknown());
    let card = stage(
        &mut db,
        "amex",
        "2026-10-12,Payment received,-624,C,2026-10-13,PAYMENT\n",
    );
    process(&mut db, &card, policy("card_payment", "checking"));
    assert_eq!(activity(&db, "checking"), -62400);
    assert_eq!(activity(&db, "amex"), -62400);
    let es = entries(&db);
    assert_eq!(es.len(), 2);
    assert!(es.iter().all(|e| e.kind == "unclassified"));
    let a = es
        .iter()
        .find(|e| e.account_id.as_deref() == Some("amex"))
        .unwrap();
    let b = es
        .iter()
        .find(|e| e.account_id.as_deref() == Some("checking"))
        .unwrap();
    assert_eq!(
        a.pending.as_ref().unwrap().kind_hint.as_deref(),
        Some("card_payment")
    );
    assert!(a.note.contains("other account"));
    let r = reconcile(a, b);
    db.reconcile_movement(r.clone()).unwrap();
    assert_eq!(entries(&db).len(), 1);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
    db.restore(&db.backup().unwrap()).unwrap();
    db.undo_movement(&r.operation_id).unwrap();
    assert_eq!(entries(&db).len(), 2);
    assert_eq!(activity(&db, "checking"), -62400);
}

#[test]
fn linked_posting_date_survives_movement_undo_then_disappears_with_its_source_link() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let bank = stage(
        &mut db,
        "checking",
        "2026-10-10,Card payment,624,B,2026-10-11,PAYMENT\n",
    );
    process(&mut db, &bank, policy("card_payment", "amex"));
    let card = stage(
        &mut db,
        "amex",
        "2026-10-12,Payment received,-624,C,2026-10-13,PAYMENT\n",
    );
    let (link, _) = process(&mut db, &card, policy("card_payment", "checking"));
    let extra = stage(
        &mut db,
        "checking",
        "2026-10-10,Extra source record,624,EXTRA,2026-10-11,\n",
    );
    process(&mut db, &extra, unknown());
    let es = entries(&db);
    let pending = es.iter().find(|e| e.kind == "unclassified").unwrap();
    let full = es.iter().find(|e| e.kind == "card_payment").unwrap();
    let r = reconcile(pending, full);
    db.reconcile_movement(r.clone()).unwrap();
    db.restore(&db.backup().unwrap()).unwrap();
    db.undo_movement(&r.operation_id).unwrap();
    let full = entries(&db)
        .into_iter()
        .find(|e| e.kind == "card_payment")
        .unwrap();
    assert_eq!(date(&full, "amex"), "2026-10-13");
    db.undo_import(&link).unwrap();
    let full = entries(&db)
        .into_iter()
        .find(|e| e.kind == "card_payment")
        .unwrap();
    assert_eq!(date(&full, "amex"), "2026-10-10");
    db.restore(&db.backup().unwrap()).unwrap();
}

#[test]
fn equal_payments_and_competing_rows_stay_distinct_without_blocking_unrelated_purchases() {
    for twin_bank in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Store::open(dir.path(), "personal").unwrap();
        let bank = stage(
            &mut db,
            "checking",
            if twin_bank {
                "2026-10-10,Payment,624,B1,2026-10-11,PAYMENT\n2026-10-10,Payment,624,B2,2026-10-11,PAYMENT\n"
            } else {
                "2026-10-10,Payment,624,B1,2026-10-11,PAYMENT\n"
            },
        );
        process(&mut db, &bank, policy("card_payment", "amex"));
        let card = stage(
            &mut db,
            "amex",
            if twin_bank {
                "2026-10-12,Payment received,-624,C1,2026-10-13,PAYMENT\n2026-10-14,Market,12,M,2026-10-14,\n"
            } else {
                "2026-10-12,Payment received,-624,C1,2026-10-13,PAYMENT\n2026-10-12,Payment received,-624,C2,2026-10-13,PAYMENT\n2026-10-14,Market,12,M,2026-10-14,\n"
            },
        );
        let (_, r) = process(&mut db, &card, policy("card_payment", "checking"));
        assert_eq!((r.added, r.linked), (1, 0));
        assert_eq!(
            entries(&db)
                .iter()
                .filter(|e| e.kind == "card_payment")
                .count(),
            if twin_bank { 2 } else { 1 }
        );
        assert_eq!(
            db.import_detail(&card).unwrap().source.pending_count,
            if twin_bank { 1 } else { 2 }
        );
        assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 1200);
    }
}

#[test]
fn long_posting_delay_never_creates_a_second_payment_just_outside_the_match_window() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let bank = stage(
        &mut db,
        "checking",
        "2026-10-10,Payment,624,B,2026-10-11,PAYMENT\n",
    );
    process(&mut db, &bank, policy("card_payment", "amex"));
    let card = stage(
        &mut db,
        "amex",
        "2026-10-17,Payment received,-624,C,2026-10-18,PAYMENT\n",
    );
    let (_, r) = process(&mut db, &card, policy("card_payment", "checking"));
    assert_eq!((r.added, r.linked), (0, 0));
    assert_eq!(entries(&db).len(), 1);
    assert_eq!(activity(&db, "checking"), -62400);
    assert_eq!(db.import_detail(&card).unwrap().source.pending_count, 1);
    let detail = db.import_detail(&card).unwrap();
    assert_eq!(detail.rows[0].matches.len(), 1);
    let target = &detail.rows[0].matches[0];
    let op = Uuid::new_v4().to_string();
    db.commit_import(
        &card,
        detail.source.revision,
        &op,
        vec![crate::imports::types::Decision {
            row_id: detail.rows[0].id.clone(),
            action: "link".into(),
            input: None,
            match_id: Some(target.id.clone()),
            match_revision: Some(target.revision),
            confirmed: true,
            separate: false,
            rule_signature: None,
        }],
    )
    .unwrap();
    assert_eq!(activity(&db, "checking"), -62400);
    assert_eq!(date(&entries(&db)[0], "amex"), "2026-10-18");
    db.restore(&db.backup().unwrap()).unwrap();
    db.undo_import(&op).unwrap();
    assert_eq!(date(&entries(&db)[0], "amex"), "2026-10-10");
}

#[test]
fn account_pairs_codes_signs_and_archived_counterparts_are_validated_without_inventing_income() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let card=stage(&mut db,"amex","2026-10-10,Wrong sign,15,A,2026-10-11,PAYMENT\n2026-10-10,Lower code,-16,B,2026-10-11,payment\n");
    let rev = db.import_detail(&card).unwrap().source.revision;
    for p in [
        policy("card_payment", "citi"),
        policy("card_payment", "amex"),
        policy("transfer", "checking"),
        policy("card_payment", "missing"),
    ] {
        assert!(db
            .process_import(&card, rev, &Uuid::new_v4().to_string(), p)
            .is_err());
    }
    process(&mut db, &card, policy("card_payment", "checking"));
    assert_eq!(db.snapshot("2026-10").unwrap().unclassified_count, 2);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
    assert_eq!(db.snapshot("2026-10").unwrap().income_cents, 0);
    db.save_account(AccountInput {
        id: "checking".into(),
        revision: 1,
        name: "Capital One 360".into(),
        kind: "checking".into(),
        archived: true,
        tracking_mode: "imported".into(),
    })
    .unwrap();
    let archived = stage(
        &mut db,
        "amex",
        "2026-10-15,Payment,-20,C,2026-10-16,PAYMENT\n",
    );
    process(&mut db, &archived, policy("card_payment", "checking"));
    assert_eq!(activity(&db, "checking"), 0);
    assert!(entries(&db).iter().any(|e| e.note.contains("archived")
        && e.pending.as_ref().unwrap().kind_hint.as_deref() == Some("card_payment")));
    db.restore(&db.backup().unwrap()).unwrap();
}

#[test]
fn saved_transfer_convention_follows_direction_and_automatic_coverage_uses_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let savings = Uuid::new_v4().to_string();
    db.save_account(AccountInput {
        id: savings.clone(),
        revision: 0,
        name: "Gift savings".into(),
        kind: "savings".into(),
        archived: false,
        tracking_mode: "imported".into(),
    })
    .unwrap();
    let first = stage(
        &mut db,
        "checking",
        "2026-10-10,To savings,100,B,2026-10-11,PAYMENT\n",
    );
    process(&mut db, &first, policy("transfer", &savings));
    let second = stage(
        &mut db,
        &savings,
        "2026-10-12,From checking,-100,S,2026-10-13,PAYMENT\n",
    );
    let (_, r) = process(&mut db, &second, policy("transfer", "checking"));
    assert_eq!(r.linked, 1);
    let next = stage(
        &mut db,
        "checking",
        "2026-10-20,From savings,-25,RETURN,2026-10-21,PAYMENT\n",
    );
    let rev = db.import_detail(&next).unwrap().source.revision;
    let r = db
        .finalize_import_coverage(
            &next,
            rev,
            &Uuid::new_v4().to_string(),
            CoverageRequest {
                input: coverage(),
                pattern: None,
                process_saved_defaults: true,
            },
        )
        .unwrap();
    assert_eq!(r.added, 1);
    assert_eq!(activity(&db, "checking"), -7500);
    assert_eq!(activity(&db, &savings), 7500);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 0);
    assert_eq!(db.snapshot("2026-10").unwrap().income_cents, 0);
}

#[test]
fn schema15_migration_and_corrupt_posting_evidence_preserve_current_data() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("10", "jacob");
    e.date = "2026-10-05".into();
    db.save(e).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_payment_code_schema(&conn);
    conn.pragma_update(None, "user_version", 15).unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 700);
    let bank = stage(
        &mut db,
        "checking",
        "2026-10-10,Payment,624,B,2026-10-11,PAYMENT\n",
    );
    process(&mut db, &bank, policy("card_payment", "amex"));
    let card = stage(
        &mut db,
        "amex",
        "2026-10-12,Payment,-624,C,2026-10-13,PAYMENT\n",
    );
    process(&mut db, &card, policy("card_payment", "checking"));
    let backup = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    conn.execute("UPDATE import_account_dates SET date='2026-10-01'", [])
        .unwrap();
    drop(conn);
    assert!(db.restore(&backup).is_err());
    assert_eq!(
        date(
            entries(&db)
                .iter()
                .find(|e| e.kind == "card_payment")
                .unwrap(),
            "amex"
        ),
        "2026-10-13"
    );
}

#[test]
fn verified_codes_do_not_override_stable_id_conflicts_or_collapse_new_identified_payments() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let first = stage(
        &mut db,
        "checking",
        "2026-10-10,Payment,624,B1,2026-10-11,PAYMENT\n",
    );
    process(&mut db, &first, policy("card_payment", "amex"));
    let distinct = stage(
        &mut db,
        "checking",
        "2026-10-10,Payment,624,B2,2026-10-11,PAYMENT\n",
    );
    let (_, r) = process(&mut db, &distinct, policy("card_payment", "amex"));
    assert_eq!((r.added, r.linked), (1, 0));
    let conflict = stage(
        &mut db,
        "checking",
        "2026-10-10,Payment corrected,625,B1,2026-10-11,PAYMENT\n",
    );
    let (_, r) = process(&mut db, &conflict, policy("card_payment", "amex"));
    assert_eq!((r.added, r.linked), (0, 0));
    assert_eq!(activity(&db, "checking"), -124800);
    assert_eq!(entries(&db).len(), 2);
    let duplicate=stage(&mut db,"amex","2026-10-12,Payment,-624,C,2026-10-13,PAYMENT\n2026-10-12,Payment,-624,C,2026-10-13,PAYMENT\n");
    let (_, r) = process(&mut db, &duplicate, policy("card_payment", "checking"));
    assert_eq!((r.added, r.linked), (0, 0));
    assert_eq!(entries(&db).len(), 2);
    let backup = db.backup().unwrap();
    let conn =
        rusqlite::Connection::open(dir.path().join("backups/personal").join(&backup)).unwrap();
    conn.execute_batch("DROP VIEW effective_activity_dates; CREATE VIEW effective_activity_dates AS SELECT event_id,account_id,'1900-01-01' AS date FROM account_activity;").unwrap();
    drop(conn);
    assert!(db.restore(&backup).is_err());
    assert_eq!(activity(&db, "checking"), -124800);
}

#[test]
fn changed_posting_evidence_holds_only_the_conflict_and_preserves_the_saved_account_date() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let bank = stage(
        &mut db,
        "checking",
        "2026-10-10,Payment,624,B,2026-10-11,PAYMENT\n",
    );
    process(&mut db, &bank, policy("card_payment", "amex"));
    let card = stage(
        &mut db,
        "amex",
        "2026-10-12,Payment,-624,C,2026-10-13,PAYMENT\n",
    );
    process(&mut db, &card, policy("card_payment", "checking"));
    let changed = stage(
        &mut db,
        "amex",
        "2026-10-12,Payment,-624,C,2026-10-14,PAYMENT\n2026-10-15,Market,5,M,2026-10-16,\n",
    );
    let (_, r) = process(&mut db, &changed, policy("card_payment", "checking"));
    assert_eq!((r.added, r.linked), (1, 0));
    assert_eq!(db.import_detail(&changed).unwrap().source.pending_count, 1);
    assert_eq!(
        date(
            entries(&db)
                .iter()
                .find(|e| e.kind == "card_payment")
                .unwrap(),
            "amex"
        ),
        "2026-10-13"
    );
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 500);
    db.restore(&db.backup().unwrap()).unwrap();
}
