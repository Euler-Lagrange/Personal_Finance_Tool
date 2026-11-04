use super::*;
use crate::{
    db::bills::{Details, Draft, OccurrenceInput},
    db::lines::allocate,
    models::{EntryLine, LineInput},
};
fn line(id: &str, amount: &str, category: &str, split: &str) -> LineInput {
    LineInput {
        id: id.into(),
        label: id.into(),
        category_id: category.into(),
        amount: amount.into(),
        split_mode: split.into(),
        split_value: String::new(),
        original_line_id: None,
    }
}
fn rent() -> Vec<LineInput> {
    [
        ("rent", "1786.00", "home"),
        ("trash", "27.00", "home"),
        ("pet", "25.00", "household"),
        ("sewage", "39.69", "home"),
        ("admin", "4.95", "home"),
        ("water", "72.15", "home"),
    ]
    .into_iter()
    .map(|(id, a, c)| line(id, a, c, "inherit"))
    .collect()
}
fn refund(e: &EntryInput, amount: &str, parts: &[(&str, &str)]) -> EntryInput {
    let mut r = e.clone();
    r.id = Uuid::new_v4().to_string();
    r.revision = 0;
    r.kind = "refund".into();
    r.original_event_id = Some(e.id.clone());
    r.date = "2026-11-01".into();
    r.amount = amount.into();
    r.split_mode = "refund".into();
    r.split_value.clear();
    r.lines = parts
        .iter()
        .map(|(id, a)| {
            let mut l = line(id, a, "uncategorized", "inherit");
            l.original_line_id = Some((*id).into());
            l
        })
        .collect();
    r
}
#[test]
fn uniform_rent_group_rounds_once_stable_under_reorder_and_has_exact_totals() {
    let parts = rent();
    let a = allocate(195479, "shared", "", &parts).unwrap();
    assert_eq!(a.iter().map(|l| l.jacob_cents).sum::<i64>(), 136835);
    assert_eq!(a.iter().map(|l| l.chelsea_cents).sum::<i64>(), 58644);
    for l in &a {
        assert_eq!(l.jacob_cents + l.chelsea_cents, l.amount_cents);
    }
    let mut reverse = parts;
    reverse.reverse();
    let b = allocate(195479, "shared", "", &reverse).unwrap();
    for l in &a {
        assert_eq!(b.iter().find(|r| r.id == l.id).unwrap(), l);
    }
    let tiny = [
        line("b", "0.01", "home", "inherit"),
        line("a", "0.01", "home", "inherit"),
    ];
    let a = allocate(2, "equal", "", &tiny).unwrap();
    assert_eq!(a[1].jacob_cents, 1);
    assert_eq!(a[0].jacob_cents, 0);
}
#[test]
fn overrides_and_group_exact_apply_to_inherited_subtotal_with_bounded_inputs() {
    let p = [
        line("shared", "100", "home", "inherit"),
        line("hers", "35", "personal", "chelsea"),
        line("gym", "130.37", "health", "equal"),
    ];
    let a = allocate(26537, "shared", "", &p).unwrap();
    assert_eq!(a.iter().map(|l| l.jacob_cents).sum::<i64>(), 13519);
    let b = allocate(26537, "exact", "20", &p).unwrap();
    assert_eq!(b[0].jacob_cents, 2000);
    assert!(allocate(26537, "exact", "110", &p).is_err());
    assert!(allocate(26536, "shared", "", &p).is_err());
    let mut bad = p.to_vec();
    bad[1].id = bad[0].id.clone();
    assert!(allocate(26537, "shared", "", &bad).is_err());
    assert!(allocate(1, "shared", "", &[line("a", "0", "home", "inherit")]).is_err());
}
#[test]
fn category_lines_flow_to_budgets_accounts_household_edits_restart_and_delete() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("1954.79", "jacob");
    e.lines = rent();
    db.save(e.clone()).unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.spent_cents, 136835);
    assert_eq!(s.household_cents, 58644);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        195479
    );
    assert_eq!(
        s.categories.iter().map(|c| c.spent_cents).sum::<i64>(),
        s.spent_cents
    );
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "household")
            .unwrap()
            .spent_cents,
        s.entries[0]
            .lines
            .iter()
            .find(|l| l.id == "pet")
            .unwrap()
            .jacob_cents
    );
    e.revision = 1;
    e.payer = "chelsea".into();
    e.account_id = None;
    db.save(e.clone()).unwrap();
    drop(db);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = db.snapshot(&month()).unwrap();
    assert_eq!(s.household_cents, -136835);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        0
    );
    let backup = db.backup().unwrap();
    db.delete(&e.id, 2).unwrap();
    assert_eq!(db.snapshot(&month()).unwrap().spent_cents, 0);
    db.restore(&backup).unwrap();
    assert_eq!(db.snapshot(&month()).unwrap().entries[0].lines.len(), 6);
}
#[test]
fn line_refunds_preserve_original_category_shares_and_prevent_cross_line_over_refunds() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("100", "jacob");
    e.date = "2026-10-01".into();
    e.lines = vec![
        line("food", "60", "groceries", "inherit"),
        line("gift", "40", "gifts", "personal"),
    ];
    db.save(e.clone()).unwrap();
    let a = refund(&e, "40", &[("gift", "40")]);
    db.save(a.clone()).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(s.spent_cents, -4000);
    assert_eq!(
        s.categories
            .iter()
            .find(|c| c.id == "gifts")
            .unwrap()
            .spent_cents,
        -4000
    );
    assert_eq!(s.income_cents, 0);
    assert!(db
        .save(refund(&e, "1", &[("gift", "1")]))
        .unwrap_err()
        .contains("charge line"));
    assert!(db.save(refund(&e, "1", &[])).is_err());
    let b = refund(&e, "60", &[("food", "60")]);
    db.save(b).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, -8200);
    assert_eq!(db.snapshot("2026-11").unwrap().household_cents, 0);
    e.revision = 1;
    e.lines[1].category_id = "personal".into();
    assert!(db.save(e).unwrap_err().contains("protected"));
    let snap = db.backup().unwrap();
    db.restore(&snap).unwrap();
}
#[test]
fn partial_line_refund_edits_recalculate_rounding_and_revisions() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("0.05", "jacob");
    e.date = "2026-10-01".into();
    e.lines = vec![
        line("a", "0.03", "groceries", "inherit"),
        line("b", "0.02", "gifts", "personal"),
    ];
    db.save(e.clone()).unwrap();
    let a = refund(&e, "0.01", &[("a", "0.01")]);
    db.save(a.clone()).unwrap();
    let b = refund(&e, "0.01", &[("a", "0.01")]);
    db.save(b.clone()).unwrap();
    let before = db.snapshot("2026-11").unwrap();
    let b_before = before.entries.iter().find(|r| r.id == b.id).unwrap();
    assert_eq!(b_before.jacob_cents, 0);
    db.delete(&a.id, 1).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    let b_after = s.entries.iter().find(|r| r.id == b.id).unwrap();
    assert_eq!(b_after.jacob_cents, 1);
    assert_eq!(b_after.revision, 2);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
}
#[test]
fn grouped_bill_preserves_plan_lines_and_records_only_one_payment() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let id = Uuid::new_v4().to_string();
    let draft = Draft {
        details: Details {
            name: "Apartment".into(),
            merchant: "rent".into(),
            category_id: "home".into(),
            account_id: Some("checking".into()),
            payer: "jacob".into(),
            split_mode: "shared".into(),
            split_value: String::new(),
            autopay: true,
            payment_kind: "expense".into(),
        },
        amount: "1954.79".into(),
        lines: rent(),
    };
    db.save_bill_template(&id, 0, "2026-11-01", 1, None, false, draft.clone())
        .unwrap();
    let o = db.bill_month("2026-11").unwrap().remove(0);
    assert_eq!(o.plan.lines.len(), 6);
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 0);
    db.save_bill_occurrence(OccurrenceInput {
        id: o.id.clone(),
        revision: o.revision,
        due_date: o.due_date,
        actual_amount: Some("1954.79".into()),
        cancelled: false,
        note: String::new(),
        plan: draft,
    })
    .unwrap();
    let o = db.bill_month("2026-11").unwrap().remove(0);
    let mut e = expense("1954.79", "jacob");
    e.date = "2026-11-01".into();
    e.lines = o.plan.lines.iter().map(EntryLine::input).collect();
    e.account_id = Some("checking".into());
    db.record_bill_payment(&o.id, o.revision, &Uuid::new_v4().to_string(), e.clone())
        .unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(s.entries.len(), 1);
    assert_eq!(s.spent_cents, 136835);
    assert_eq!(db.bill_month("2026-11").unwrap()[0].remaining_cents, 0);
    e.revision = 1;
    e.lines[1].split_mode = "personal".into();
    assert!(db.save(e).unwrap_err().contains("protected"));
    let snap = db.backup().unwrap();
    db.restore(&snap).unwrap();
}
#[test]
fn invalid_last_line_rolls_back_all_financial_effects_and_corrupt_restore_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("100", "jacob");
    e.lines = vec![
        line("a", "50", "groceries", "inherit"),
        line("b", "50", "missing", "inherit"),
    ];
    assert!(db.save(e.clone()).is_err());
    assert!(db.snapshot(&month()).unwrap().entries.is_empty());
    e.lines[1].category_id = "home".into();
    db.save(e).unwrap();
    let backup = db.backup().unwrap();
    let path = dir.path().join("backups/personal").join(&backup);
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.execute("UPDATE event_lines SET jacob_cents=jacob_cents+1,chelsea_cents=chelsea_cents-1 WHERE id='a'",[]).unwrap();
    drop(conn);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.snapshot(&month()).unwrap().spent_cents, 7000);
    let backup = db.backup().unwrap();
    let path = dir.path().join("backups/personal").join(&backup);
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.execute("UPDATE events SET category_id='gifts'", [])
        .unwrap();
    drop(conn);
    assert!(db.restore(&backup).is_err());
    assert_eq!(db.snapshot(&month()).unwrap().spent_cents, 7000);
}
#[test]
fn version_six_migration_backfills_single_category_history_and_refunds() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut e = expense("100", "jacob");
    e.date = "2026-10-01".into();
    db.save(e.clone()).unwrap();
    db.save(refund(&e, "25", &[])).unwrap();
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    remove_identity_schema(&conn);
    conn.execute_batch("DROP TABLE paypal_allocations; DROP TABLE paypal_cashouts; DROP TABLE household_opening; DROP TABLE balance_checkpoints; ALTER TABLE accounts DROP COLUMN tracking_mode; DROP TABLE event_lines; PRAGMA user_version=6;")
        .unwrap();
    drop(conn);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().entries[0].lines.len(), 1);
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, -1750);
    let snap = db.backup().unwrap();
    db.restore(&snap).unwrap();
}

#[test]
fn imported_itemized_purchase_refund_and_narrow_undo_keep_category_totals_consistent() {
    use crate::imports::{parse, types::Decision};
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let bytes = b"Date,Description,Amount\n11/01/2026,Mixed shop,100.00\n";
    let prepared = parse::prepare("mixed.csv", bytes, None).unwrap();
    let id = db.ingest("mixed.csv", bytes.to_vec(), prepared).unwrap();
    let detail = db.import_detail(&id).unwrap();
    let mut mapping = detail.mapping;
    mapping.amount_mode = "outflow_positive".into();
    mapping.posted_confirmed = true;
    db.configure_import(&id, detail.source.revision, "amex", mapping)
        .unwrap();
    let detail = db.import_detail(&id).unwrap();
    let mut e = expense("100", "jacob");
    e.id = detail.rows[0].id.clone();
    e.date = "2026-11-01".into();
    e.lines = vec![
        line("food", "60", "groceries", "inherit"),
        line("gift", "40", "gifts", "personal"),
    ];
    let operation = Uuid::new_v4().to_string();
    db.commit_import(
        &id,
        detail.source.revision,
        &operation,
        vec![Decision {
            row_id: detail.rows[0].id.clone(),
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
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 8200);
    let r = refund(&e, "40", &[("gift", "40")]);
    db.save(r.clone()).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 4200);
    assert!(db.undo_import(&operation).is_err());
    db.delete(&r.id, 1).unwrap();
    db.undo_import(&operation).unwrap();
    let s = db.snapshot("2026-11").unwrap();
    assert_eq!(s.spent_cents, 0);
    assert!(s.categories.iter().all(|c| c.spent_cents == 0));
}
