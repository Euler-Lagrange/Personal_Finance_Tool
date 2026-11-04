use chrono::Local;
use rusqlite::Connection;

// Version 43 is a reader barrier for managed-restore receipts and protected local branches.
pub const CURRENT_VERSION: i64 = 43;

// The caller backs up the live database first, or migrates an isolated restore candidate.
pub fn upgrade(conn: &mut Connection) -> Result<(), String> {
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version == CURRENT_VERSION {
        return Ok(());
    }
    if !(1..CURRENT_VERSION).contains(&version) {
        return Err("Unsupported workspace version.".into());
    }
    conn.pragma_update(None, "foreign_keys", false)
        .map_err(|e| e.to_string())?;
    let result = (|| -> rusqlite::Result<()> {
        let tx = conn.transaction()?;
        if version == 1 {
            // Rebuild the CHECK-constrained table without renaming the original first,
            // so existing foreign-key declarations continue to reference accounts.
            tx.execute_batch("CREATE TABLE accounts_v2 (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('checking','credit','savings')),
            revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
            archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)));
            INSERT INTO accounts_v2(id,name,kind) SELECT id,name,kind FROM accounts;
            DROP TABLE accounts;
            ALTER TABLE accounts_v2 RENAME TO accounts;
            ALTER TABLE categories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0);
            ALTER TABLE categories ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));
            ALTER TABLE categories ADD COLUMN icon TEXT NOT NULL DEFAULT 'auto';
            CREATE TABLE budget_months (month TEXT PRIMARY KEY);")?;
            // Freeze v1's implicit limits for all recorded months and the current month.
            // Later default changes cannot rewrite those budgets.
            tx.execute("INSERT OR IGNORE INTO budgets(month,category_id,limit_cents)
            SELECT m.month,c.id,c.default_limit_cents FROM categories c CROSS JOIN
            (SELECT substr(date,1,7) AS month FROM events UNION SELECT month FROM budgets UNION SELECT ?1) m",
            [Local::now().format("%Y-%m").to_string()])?;
            tx.execute(
                "INSERT INTO budget_months SELECT DISTINCT month FROM budgets",
                [],
            )?;
        }
        if version < 3 {
            tx.execute_batch(include_str!("migrations/003_transfers.sql"))?;
        }
        if version < 4 {
            tx.execute_batch(include_str!("migrations/004_imports.sql"))?;
        }
        if version < 5 {
            tx.execute_batch(include_str!("migrations/005_rules_refunds.sql"))?;
        }
        if version < 6 {
            tx.execute_batch(include_str!("migrations/006_bills.sql"))?;
        }
        if version < 7 {
            tx.execute_batch(include_str!("migrations/007_lines.sql"))?;
        }
        if version < 8 {
            tx.execute_batch(include_str!("migrations/008_balances.sql"))?;
        }
        if version < 9 {
            tx.execute_batch(include_str!("migrations/009_rewards_debt.sql"))?;
        }
        if version < 10 {
            tx.execute_batch(include_str!("migrations/010_household_paypal.sql"))?;
        }
        if version < 11 {
            tx.execute_batch(include_str!("migrations/011_import_identity.sql"))?;
        }
        if version < 12 {
            tx.execute_batch(include_str!("migrations/012_import_observations.sql"))?;
        }
        if version < 13 {
            tx.execute_batch(include_str!("migrations/013_classification.sql"))?;
        }
        if version < 14 {
            tx.execute_batch(include_str!("migrations/014_movements.sql"))?;
        }
        if version < 15 {
            tx.execute_batch(include_str!("migrations/015_classification_profiles.sql"))?;
        }
        if version < 16 {
            tx.execute_batch(include_str!("migrations/016_payment_codes.sql"))?;
        }
        if version < 17 {
            tx.execute_batch(include_str!("migrations/017_purchase_review.sql"))?;
        }
        if version < 18 {
            tx.execute_batch(include_str!("migrations/018_conditional_rules.sql"))?;
        }
        if version < 19 {
            tx.execute_batch(include_str!("migrations/019_goals.sql"))?;
        }
        if tx.prepare("PRAGMA foreign_key_check")?.exists([])? {
            return Err(rusqlite::Error::InvalidQuery);
        }
        if version < 20 {
            tx.execute_batch(include_str!("migrations/020_shared_reports.sql"))?;
        }
        if version < 21 {
            tx.execute_batch(include_str!("migrations/021_month_close.sql"))?;
        }
        if version < 22 {
            tx.execute_batch(include_str!("migrations/022_rollover.sql"))?;
        }
        if version < 23 {
            tx.execute_batch(include_str!("migrations/023_budget_periods.sql"))?;
        }
        if version < 24 {
            tx.execute_batch(include_str!("migrations/024_cash_plans.sql"))?;
        }
        if version < 25 {
            tx.execute_batch(include_str!("migrations/025_card_statements.sql"))?;
        }
        if version < 26 {
            tx.execute_batch(include_str!("migrations/026_card_payments.sql"))?;
        }
        if version < 27 {
            tx.execute_batch(include_str!("migrations/027_cash_forecast.sql"))?;
        }
        if version < 28 {
            tx.execute_batch(include_str!("migrations/028_pdf_documents.sql"))?;
        }
        if version < 29 {
            tx.execute_batch(include_str!("migrations/029_pdf_tables.sql"))?;
        }
        if version < 30 {
            tx.execute_batch(include_str!("migrations/030_pdf_routes.sql"))?;
        }
        if version < 31 {
            tx.execute_batch(include_str!("migrations/031_assistance.sql"))?;
        }
        if version < 32 {
            tx.execute_batch(include_str!("migrations/032_ai_rows.sql"))?;
        }
        if version < 33 {
            tx.execute_batch(include_str!("migrations/033_ai_documents.sql"))?;
        }
        if version < 34 {
            tx.execute_batch(include_str!("migrations/034_ai_mapping.sql"))?;
        }
        if version < 35 {
            tx.execute_batch(include_str!("migrations/035_handoff.sql"))?;
        }
        if version < 36 {
            crate::category_defaults::upgrade(&tx)?;
        }
        if version < 37 {
            tx.execute_batch(include_str!("migrations/037_ai_usage.sql"))?;
        }
        if version < 38 {
            tx.execute_batch(include_str!("migrations/038_payroll_hours.sql"))?;
        }
        if version < 39 {
            tx.execute_batch(include_str!("migrations/039_payroll_sources.sql"))?;
        }
        tx.pragma_update(None, "user_version", CURRENT_VERSION)?;
        tx.commit()
    })();
    let foreign_keys = conn.pragma_update(None, "foreign_keys", true);
    result.map_err(|e| format!("Workspace upgrade failed: {e}"))?;
    foreign_keys.map_err(|e| e.to_string())
}
