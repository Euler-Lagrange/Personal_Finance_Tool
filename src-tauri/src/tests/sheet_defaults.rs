use super::*;
use rusqlite::Connection;

// Synthetic schema-35 factory state, deliberately independent of the new preset.
fn legacy(dir: &std::path::Path) {
    drop(Store::open(dir, "personal").unwrap());
    let c = Connection::open(dir.join("personal.sqlite")).unwrap();
    super::remove_ai_usage_schema(&c);
    c.execute_batch(
        "DELETE FROM categories;
        INSERT INTO categories(id,name,group_name,color,default_limit_cents) VALUES
        ('home','Home & utilities','Needs','#7488c1',0),
        ('groceries','Groceries','Needs','#5b9985',0),
        ('transport','Transportation','Needs','#719bae',0),
        ('health','Health & care','Needs','#b394b5',0),
        ('household','Household & pets','Needs','#af9b71',0),
        ('dining','Dining together','Wants','#d29a71',0),
        ('hobbies','Hobbies','Wants','#9a87ba',0),
        ('personal','Personal spending','Wants','#89a4ac',0),
        ('gifts','Gifts','Wants','#bc8e96',0),
        ('uncategorized','Uncategorized','Other','#9b9fa9',0);
        PRAGMA user_version=35;",
    )
    .unwrap();
}

#[test]
fn sheet_defaults_fresh_and_empty_upgrade_match_without_creating_activity() {
    for upgraded in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        if upgraded {
            legacy(dir.path());
        }
        let mut db = Store::open(dir.path(), "personal").unwrap();
        let s = db.snapshot("2026-11").unwrap();
        assert_eq!(s.categories.len(), 26);
        assert_eq!(
            s.categories
                .iter()
                .filter(|c| c.group_name == "Needs")
                .count(),
            19
        );
        assert_eq!(
            s.categories
                .iter()
                .filter(|c| c.group_name == "Wants")
                .count(),
            6
        );
        assert_eq!(
            s.categories
                .iter()
                .filter(|c| c.group_name == "Needs")
                .map(|c| c.default_limit_cents)
                .sum::<i64>(),
            452000
        );
        assert_eq!(
            s.categories
                .iter()
                .filter(|c| c.group_name == "Wants")
                .map(|c| c.default_limit_cents)
                .sum::<i64>(),
            131200
        );
        for name in [
            "Rent/Water/Trash",
            "Heating Gas",
            "Gas",
            "Electric",
            "Pet Insurance",
            "CSU/Work Expenses",
            "Dates/Restaurants",
            "Solo Dining",
            "Otter Gifts",
            "Needs Flex Expenses",
            "Wants Flex Expenses",
            "Debt Flex Slot",
            "Debt Flex Slot 2",
            "Flex Slot",
        ] {
            assert!(s.categories.iter().any(|c| c.name == name), "{name}");
        }
        assert_eq!(
            (
                s.monthly_count,
                s.budget_cents,
                s.income_cents,
                s.spent_cents
            ),
            (0, 0, 0, 0)
        );
        assert!(s.categories.iter().all(|c| !c.archived && c.icon != "auto"));
        assert!(!s.categories.iter().any(|c| c.name.contains("Savings")
            || c.name.contains("Refund")
            || c.name.contains("Rollover")));
        db.apply_budget_template("2026-11", None, false).unwrap();
        assert_eq!(db.snapshot("2026-11").unwrap().budget_cents, 583200);
        let mut c = category_input(&db, "groceries");
        c.default_limit = "650".into();
        db.save_category(c).unwrap();
        drop(db);
        let mut db = Store::open(dir.path(), "personal").unwrap();
        assert_eq!(db.snapshot("2026-11").unwrap().categories.len(), 26);
        assert_eq!(category_input(&db, "groceries").default_limit, "650.00");
        assert_eq!(db.snapshot("2026-11").unwrap().budget_cents, 583200);
        db.apply_budget_template("2026-12", None, false).unwrap();
        assert_eq!(db.snapshot("2026-12").unwrap().budget_cents, 578200);
    }
}

#[test]
fn sheet_defaults_legacy_sample_retires_only_untouched_broad_defaults_atomically() {
    let dir = tempfile::tempdir().unwrap();
    legacy(dir.path());
    let mut c = Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute_batch(
        "UPDATE metadata SET value='demo' WHERE key='workspace';
        UPDATE categories SET default_limit_cents=CASE id
          WHEN 'home' THEN 165000 WHEN 'groceries' THEN 70000
          WHEN 'transport' THEN 15000 WHEN 'health' THEN 20000
          WHEN 'household' THEN 36000 WHEN 'dining' THEN 42500
          WHEN 'hobbies' THEN 27000 WHEN 'personal' THEN 30000
          WHEN 'gifts' THEN 10000 ELSE 0 END;
        INSERT INTO budgets VALUES ('2026-10','home',165000);
        INSERT INTO budget_months VALUES ('2026-10');
        CREATE TRIGGER reject_preset BEFORE INSERT ON audit
        WHEN NEW.action='sheets_category_defaults' BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    )
    .unwrap();
    assert!(crate::migrations::upgrade(&mut c).is_err());
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        35
    );
    assert_eq!(
        c.query_row("SELECT COUNT(*) FROM categories", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        10
    );
    assert_eq!(
        c.query_row(
            "SELECT default_limit_cents FROM categories WHERE id='home'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        165000
    );
    c.execute_batch("DROP TRIGGER reject_preset;").unwrap();
    crate::migrations::upgrade(&mut c).unwrap();
    assert_eq!(
        c.query_row("SELECT SUM(default_limit_cents) FROM categories", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        583200
    );
    assert_eq!(
        c.query_row(
            "SELECT default_limit_cents FROM categories WHERE id='home'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        c.query_row(
            "SELECT limit_cents FROM budgets WHERE category_id='home'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        165000
    );
    assert_eq!(
        c.query_row("SELECT name FROM categories WHERE id='home'", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "Home & utilities"
    );
    let count: i64 = c
        .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
        .unwrap();
    crate::migrations::upgrade(&mut c).unwrap();
    assert_eq!(
        c.query_row("SELECT COUNT(*) FROM categories", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        count
    );
}

#[test]
fn sheet_defaults_upgrade_preserves_edits_archives_collisions_and_closed_history() {
    let dir = tempfile::tempdir().unwrap();
    legacy(dir.path());
    // Work with legacy data through the current core, then exercise the upgrade on
    // restart. Supply newer infrastructure without applying the category preset;
    // a current-version fixture must have a complete schema.
    let c = Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute_batch(include_str!("../migrations/037_ai_usage.sql"))
        .unwrap();
    c.execute_batch(include_str!("../migrations/038_payroll_hours.sql"))
        .unwrap();
    c.execute_batch(include_str!("../migrations/039_payroll_sources.sql"))
        .unwrap();
    c.pragma_update(None, "user_version", crate::migrations::CURRENT_VERSION)
        .unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut grocery = category_input(&db, "groceries");
    grocery.default_limit = "612.34".into();
    grocery.icon = "gifts".into();
    db.save_category(grocery).unwrap();
    let mut hobby = category_input(&db, "hobbies");
    hobby.archived = true;
    db.save_category(hobby).unwrap();
    let electric_id = Uuid::new_v4().to_string();
    db.save_category(CategoryInput {
        id: electric_id.clone(),
        revision: 0,
        name: "ELECTRIC".into(),
        group_name: "Needs".into(),
        color: "#123456".into(),
        icon: "water".into(),
        default_limit: "88".into(),
        archived: false,
    })
    .unwrap();
    let mut e = expense("100", "jacob");
    e.category_id = Some("home".into());
    e.date = "2026-10-01".into();
    db.save(e.clone()).unwrap();
    db.set_budget("2026-10", "home", "1234").unwrap();
    db.set_budget("2026-11", "groceries", "0").unwrap();
    let r = db.close_review("2026-10").unwrap();
    db.close_month(crate::db::periods::CloseInput {
        carry: None,
        id: Uuid::new_v4().to_string(),
        month: "2026-10".into(),
        revision: r.revision,
        token: r.token,
        acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
        note: "Synthetic close".into(),
    })
    .unwrap();
    let before = serde_json::to_value(db.annual_report(2026).unwrap()).unwrap();
    drop(db);
    let c = Connection::open(dir.path().join("personal.sqlite")).unwrap();
    let closed: String = c
        .query_row(
            "SELECT snapshot_json FROM month_closes WHERE month='2026-10'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    super::remove_ai_usage_schema(&c);
    c.pragma_update(None, "user_version", 35).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    assert_eq!(category_input(&db, "groceries").default_limit, "612.34");
    assert_eq!(category_input(&db, "groceries").icon, "gifts");
    assert!(category_input(&db, "hobbies").archived);
    assert_eq!(category_input(&db, &electric_id).default_limit, "88.00");
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(
        s.categories
            .iter()
            .filter(|c| c.name.eq_ignore_ascii_case("electric"))
            .count(),
        1
    );
    assert!(s
        .categories
        .iter()
        .any(|c| c.name == "Rent/Water/Trash" && c.id != "home"));
    assert_eq!(category_input(&db, "home").name, "Home & utilities");
    assert_eq!(
        (s.spent_cents, s.budget_cents, s.household_cents),
        (7000, 123400, 3000)
    );
    assert!(!db.close_review("2026-10").unwrap().changed);
    assert_eq!(
        before["months"][9],
        serde_json::to_value(db.annual_report(2026).unwrap()).unwrap()["months"][9]
    );
    let c = Connection::open(dir.path().join("personal.sqlite")).unwrap();
    assert_eq!(
        closed,
        c.query_row(
            "SELECT snapshot_json FROM month_closes WHERE month='2026-10'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap()
    );
    drop(c);
    db.apply_budget_template("2026-11", None, false).unwrap();
    assert_eq!(
        db.snapshot("2026-11")
            .unwrap()
            .categories
            .iter()
            .find(|c| c.id == "groceries")
            .unwrap()
            .limit_cents,
        0
    );
    e.revision = 1;
    e.amount = "200".into();
    assert!(db.save(e).unwrap_err().contains("closed"));
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert!(!db.close_review("2026-10").unwrap().changed);
}
