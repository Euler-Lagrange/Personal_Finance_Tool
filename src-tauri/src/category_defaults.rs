//! Jacob's S5 monthly-sheet preset. Amounts are planned limits, not actual spending.
use rusqlite::{params, Connection, OptionalExtension};

// Stable IDs keep new-workspace examples and integrations working. In an upgraded
// workspace an occupied ID is never repurposed once there is recorded activity.
pub const SHEETS: &[(&str, &str, &str, &str, i64, &str)] = &[
    (
        "home",
        "Rent/Water/Trash",
        "Needs",
        "#7488c1",
        131000,
        "home",
    ),
    ("internet", "Internet", "Needs", "#719bae", 7000, "internet"),
    (
        "heating-gas",
        "Heating Gas",
        "Needs",
        "#b58464",
        4800,
        "gas",
    ),
    (
        "electric", "Electric", "Needs", "#ac985b", 10000, "electric",
    ),
    (
        "cell-phone",
        "Cell Phone",
        "Needs",
        "#719bae",
        9800,
        "phone",
    ),
    (
        "subscriptions",
        "Subscriptions",
        "Needs",
        "#9a87ba",
        6200,
        "subscriptions",
    ),
    ("gym", "Gym", "Needs", "#5b9985", 8900, "health"),
    (
        "car-renters-insurance",
        "Car/Renter's Insurance",
        "Needs",
        "#7488c1",
        11000,
        "insurance",
    ),
    (
        "life-disability-insurance",
        "Life/Disability Insurance",
        "Needs",
        "#b394b5",
        7100,
        "insurance",
    ),
    (
        "pet-insurance",
        "Pet Insurance",
        "Needs",
        "#af9b71",
        8600,
        "household",
    ),
    (
        "auto-loan",
        "Auto Loan",
        "Needs",
        "#719bae",
        92000,
        "transport",
    ),
    ("debt-flex", "Debt Flex Slot", "Needs", "#9b9fa9", 0, "tag"),
    (
        "debt-flex-2",
        "Debt Flex Slot 2",
        "Needs",
        "#9b9fa9",
        0,
        "tag",
    ),
    (
        "student-loans",
        "Student Loans",
        "Needs",
        "#7488c1",
        14000,
        "education",
    ),
    (
        "work",
        "CSU/Work Expenses",
        "Needs",
        "#9a87ba",
        20600,
        "education",
    ),
    ("transport", "Gas", "Needs", "#719bae", 5000, "transport"),
    (
        "groceries",
        "Groceries",
        "Needs",
        "#5b9985",
        70000,
        "groceries",
    ),
    (
        "health",
        "RX/Counseling",
        "Needs",
        "#b394b5",
        10000,
        "health",
    ),
    (
        "household",
        "Needs Flex Expenses",
        "Needs",
        "#af9b71",
        36000,
        "household",
    ),
    (
        "dining",
        "Dates/Restaurants",
        "Wants",
        "#d29a71",
        42500,
        "dining",
    ),
    ("hobbies", "Hobbies", "Wants", "#9a87ba", 27000, "hobbies"),
    ("gifts", "Otter Gifts", "Wants", "#bc8e96", 10000, "gifts"),
    (
        "solo-dining",
        "Solo Dining",
        "Wants",
        "#d29a71",
        10000,
        "dining",
    ),
    ("flex", "Flex Slot", "Wants", "#89a4ac", 0, "tag"),
    (
        "personal",
        "Wants Flex Expenses",
        "Wants",
        "#89a4ac",
        41700,
        "personal",
    ),
    (
        "uncategorized",
        "Uncategorized",
        "Other",
        "#9b9fa9",
        0,
        "tag",
    ),
];

const LEGACY: &[(&str, &str, &str, &str, i64)] = &[
    ("home", "Home & utilities", "Needs", "#7488c1", 165000),
    ("groceries", "Groceries", "Needs", "#5b9985", 70000),
    ("transport", "Transportation", "Needs", "#719bae", 15000),
    ("health", "Health & care", "Needs", "#b394b5", 20000),
    ("household", "Household & pets", "Needs", "#af9b71", 36000),
    ("dining", "Dining together", "Wants", "#d29a71", 42500),
    ("hobbies", "Hobbies", "Wants", "#9a87ba", 27000),
    ("personal", "Personal spending", "Wants", "#89a4ac", 30000),
    ("gifts", "Gifts", "Wants", "#bc8e96", 10000),
    ("uncategorized", "Uncategorized", "Other", "#9b9fa9", 0),
];

pub fn seed(conn: &Connection) -> rusqlite::Result<()> {
    for (id, name, group, color, limit, icon) in SHEETS {
        conn.execute("INSERT INTO categories(id,name,group_name,color,default_limit_cents,icon) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, name, group, color, limit, icon])?;
    }
    Ok(())
}

// Runs inside the backed-up schema migration (also on isolated restore candidates).
// Do not copy limits into any month or relabel previously recorded activity.
pub fn upgrade(conn: &Connection) -> rusqlite::Result<()> {
    let demo: bool = conn.query_row(
        "SELECT value='demo' FROM metadata WHERE key='workspace'",
        [],
        |r| r.get(0),
    )?;
    let mut pristine = Vec::new();
    for (id, name, group, color, demo_limit) in LEGACY {
        let matches: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1 AND name=?2 AND group_name=?3 AND color=?4 AND default_limit_cents=?5 AND revision=1 AND archived=0 AND icon='auto')",
            params![id, name, group, color, if demo { *demo_limit } else { 0 }], |r| r.get(0))?;
        if matches {
            pristine.push(*id);
        }
    }
    // The factory-empty Personal workspace has no saved budgets or audited edits.
    // Any setup/financial history retains all old category identities and names.
    let factory_empty = pristine.len() == LEGACY.len() && conn.query_row(
        "SELECT (SELECT COUNT(*) FROM categories)=10 AND NOT EXISTS(SELECT 1 FROM audit) AND NOT EXISTS(SELECT 1 FROM events) AND NOT EXISTS(SELECT 1 FROM budgets) AND NOT EXISTS(SELECT 1 FROM month_closes) AND NOT EXISTS(SELECT 1 FROM merchant_rules) AND NOT EXISTS(SELECT 1 FROM bill_templates) AND NOT EXISTS(SELECT 1 FROM rollover_policies) AND NOT EXISTS(SELECT 1 FROM import_sources)",
        [], |r| r.get::<_, bool>(0))?;
    if !factory_empty {
        for (id, old_name, _, _, _) in LEGACY {
            if pristine.contains(id) && SHEETS.iter().any(|c| c.0 == *id && c.1 != *old_name) {
                conn.execute(
                    "UPDATE categories SET default_limit_cents=0,revision=revision+1 WHERE id=?1",
                    [id],
                )?;
            }
        }
    }
    for (id, name, group, color, limit, icon) in SHEETS {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM categories WHERE name=?1 COLLATE NOCASE LIMIT 1",
                [name],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(existing) = existing {
            // Only untouched factory defaults can be upgraded; includes matching
            // categories in Personal whose original default was zero.
            if existing == *id && pristine.contains(id) {
                conn.execute("UPDATE categories SET default_limit_cents=?2,icon=?3,revision=revision+1 WHERE id=?1", params![id, limit, icon])?;
            }
            continue;
        }
        if factory_empty && pristine.contains(id) {
            conn.execute("UPDATE categories SET name=?2,default_limit_cents=?3,icon=?4,revision=revision+1 WHERE id=?1", params![id,name,limit,icon])?;
            continue;
        }
        let occupied: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1)",
            [id],
            |r| r.get(0),
        )?;
        let mut new_id = id.to_string();
        if occupied {
            // Retain broad legacy categories for history/rules, but retire their
            // untouched starter defaults to avoid budgeting both broad and detailed
            // categories. Saved monthly limits and user-edited defaults stay intact.
            new_id = format!("sheets-{id}");
            if conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1)",
                [&new_id],
                |r| r.get::<_, bool>(0),
            )? {
                new_id = uuid::Uuid::new_v4().to_string();
            }
        }
        conn.execute("INSERT INTO categories(id,name,group_name,color,default_limit_cents,icon) VALUES (?1,?2,?3,?4,?5,?6)", params![new_id,name,group,color,limit,icon])?;
    }
    conn.execute("INSERT INTO audit(action,payload) VALUES ('sheets_category_defaults',?1)", [serde_json::json!({"source":"S5 monthly budget screenshot","factoryEmpty":factory_empty,"savedMonthsChanged":false}).to_string()])?;
    Ok(())
}
