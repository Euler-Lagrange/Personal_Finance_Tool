use crate::{migrations, models::*, money};
pub mod ai_configuration;
pub mod ai_documents;
pub mod ai_jobs;
pub mod ai_rows;
pub mod balances;
pub mod bills;
pub mod budget_periods;
pub mod card_payments;
pub mod card_statements;
pub mod cash_forecast;
pub mod cash_plans;
pub mod classification;
pub mod document_values;
pub mod goals;
pub mod handoff;
pub mod household;
pub mod identity;
mod imports;
pub mod lines;
pub mod managed_backup;
pub mod movements;
pub mod observations;
pub mod pay_calendar;
pub mod pay_cash;
mod payment_codes;
pub mod payroll;
pub mod pdf_documents;
pub mod pdf_routes;
pub mod pdf_tables;
pub mod periods;
pub mod purchase_review;
mod recovery;
pub mod refunds;
pub mod rollover;
pub mod rules;
mod setup;
pub mod shared_reports;
mod transfer;
pub mod trends;
use chrono::{Local, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub struct Store {
    conn: Connection,
    path: PathBuf,
    backups: PathBuf,
    workspace: String,
}

impl Store {
    pub fn open(root: &Path, workspace: &str) -> Result<Self> {
        if !["demo", "personal"].contains(&workspace) {
            return Err("Unknown workspace.".into());
        }
        fs::create_dir_all(root).map_err(err)?;
        let path = root.join(format!("{workspace}.sqlite"));
        let backups = root.join("backups").join(workspace);
        fs::create_dir_all(&backups).map_err(err)?;
        let conn = Connection::open(&path).map_err(err)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
            .map_err(err)?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(err)?;
        if version > migrations::CURRENT_VERSION {
            return Err("This workspace needs a newer app version.".into());
        }
        let mut store = Self {
            conn,
            path,
            backups,
            workspace: workspace.into(),
        };
        if version == 0 {
            store.initialize()?;
        }
        let identity: String = store
            .conn
            .query_row(
                "SELECT value FROM metadata WHERE key='workspace'",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if identity != workspace {
            return Err("Workspace identity does not match.".into());
        }
        if (1..migrations::CURRENT_VERSION).contains(&version) {
            store.backup()?;
            migrations::upgrade(&mut store.conn)?;
        }
        Ok(store)
    }

    fn initialize(&mut self) -> Result<()> {
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute_batch(include_str!("schema.sql")).map_err(err)?;
        tx.execute_batch(include_str!("migrations/004_imports.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/005_rules_refunds.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/006_bills.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/007_lines.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/008_balances.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/009_rewards_debt.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/010_household_paypal.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/011_import_identity.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/012_import_observations.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/013_classification.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/014_movements.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/015_classification_profiles.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/016_payment_codes.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/017_purchase_review.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/018_conditional_rules.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/019_goals.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/020_shared_reports.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/021_month_close.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/022_rollover.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/023_budget_periods.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/024_cash_plans.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/025_card_statements.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/026_card_payments.sql"))
            .map_err(err)?;
        tx.execute(
            "INSERT INTO metadata VALUES ('workspace',?1)",
            [&self.workspace],
        )
        .map_err(err)?;
        for (id, name, kind) in [
            ("checking", "Capital One 360", "checking"),
            ("capital-one", "Capital One", "credit"),
            ("amex", "American Express", "credit"),
            ("discover", "Discover", "credit"),
            ("citi", "Citi", "credit"),
        ] {
            tx.execute(
                "INSERT INTO accounts(id,name,kind) VALUES (?1,?2,?3)",
                params![id, name, kind],
            )
            .map_err(err)?;
        }
        crate::category_defaults::seed(&tx).map_err(err)?;
        tx.execute_batch(include_str!("migrations/027_cash_forecast.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/028_pdf_documents.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/029_pdf_tables.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/030_pdf_routes.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/031_assistance.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/032_ai_rows.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/033_ai_documents.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/034_ai_mapping.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/035_handoff.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/037_ai_usage.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/038_payroll_hours.sql"))
            .map_err(err)?;
        tx.execute_batch(include_str!("migrations/039_payroll_sources.sql"))
            .map_err(err)?;
        tx.pragma_update(None, "user_version", migrations::CURRENT_VERSION)
            .map_err(err)?;
        periods::commit(tx)?;
        if self.workspace == "demo" {
            self.seed_demo()?;
            self.apply_budget_template(&Local::now().format("%Y-%m").to_string(), None, false)?;
        }
        Ok(())
    }

    fn seed_demo(&mut self) -> Result<()> {
        let month = Local::now().format("%Y-%m").to_string();
        let samples = [
            (
                "01",
                "Apartment & utilities",
                "1954.79",
                "jacob",
                "home",
                Some("checking"),
                "shared",
            ),
            (
                "02",
                "Whole Foods Market",
                "126.69",
                "jacob",
                "groceries",
                Some("amex"),
                "shared",
            ),
            (
                "04",
                "Dinner at Juniper",
                "68.72",
                "jacob",
                "dining",
                Some("capital-one"),
                "shared",
            ),
            (
                "06",
                "Pet supplies",
                "94.85",
                "chelsea",
                "household",
                None,
                "shared",
            ),
            (
                "08",
                "Weekend coffee",
                "12.50",
                "jacob",
                "solo-dining",
                Some("citi"),
                "personal",
            ),
            (
                "10",
                "Board game night",
                "79.00",
                "jacob",
                "hobbies",
                Some("discover"),
                "personal",
            ),
            (
                "12",
                "Trader Joe's",
                "98.24",
                "chelsea",
                "groceries",
                None,
                "shared",
            ),
            (
                "15",
                "Neighborhood restaurant",
                "48.00",
                "chelsea",
                "dining",
                None,
                "shared",
            ),
            (
                "17",
                "New hobby supplies",
                "224.00",
                "jacob",
                "hobbies",
                Some("amex"),
                "personal",
            ),
            (
                "19",
                "Grocery run",
                "165.73",
                "jacob",
                "groceries",
                Some("capital-one"),
                "shared",
            ),
        ];
        let today: u32 = Local::now().format("%d").to_string().parse().unwrap();
        for (day, description, amount, payer, category, account, split) in samples {
            let day = day.parse::<u32>().unwrap().min(today);
            self.save_impl(EntryInput {
                budget_override: None,
                id: Uuid::new_v4().to_string(),
                revision: 0,
                kind: "expense".into(),
                date: format!("{month}-{day:02}"),
                description: description.into(),
                amount: amount.into(),
                payer: payer.into(),
                category_id: Some(category.into()),
                account_id: account.map(str::to_string),
                destination_account_id: None,
                split_mode: split.into(),
                split_value: String::new(),
                original_event_id: None,
                paypal: None,
                lines: Vec::new(),
                note: "Illustrative sample expense".into(),
            })?;
        }
        self.save_impl(EntryInput {
            budget_override: None,
            id: Uuid::new_v4().to_string(),
            revision: 0,
            kind: "income".into(),
            date: format!("{month}-01"),
            description: "Sample paycheck".into(),
            amount: "5300.00".into(),
            payer: "jacob".into(),
            category_id: None,
            account_id: Some("checking".into()),
            destination_account_id: None,
            split_mode: "personal".into(),
            split_value: String::new(),
            original_event_id: None,
            paypal: None,
            lines: Vec::new(),
            note: "Illustrative sample income".into(),
        })?;
        Ok(())
    }

    pub fn save(&mut self, input: EntryInput) -> Result<()> {
        self.backup()?;
        self.save_impl(input)
    }

    fn save_impl(&mut self, input: EntryInput) -> Result<()> {
        let tx = self.conn.transaction().map_err(err)?;
        if !classification::retry(&tx, &input)? {
            Self::write_entry(&tx, input)?;
        }
        periods::commit(tx)
    }

    fn write_entry(tx: &rusqlite::Transaction<'_>, input: EntryInput) -> Result<()> {
        movements::protect_entry(tx, &input.id)?;
        let saved_dates = movements::preserved_dates(tx, &input)?;
        let resolving = classification::check_resolution(tx, &input)?;
        Self::write_entry_inner(tx, input.clone())?;
        if resolving {
            classification::finish_resolution(tx, &input)?;
        }
        budget_periods::write(tx, &input)?;
        movements::write_dates(tx, &input.id, &saved_dates)?;
        Ok(())
    }

    fn write_entry_inner(tx: &rusqlite::Transaction<'_>, mut input: EntryInput) -> Result<()> {
        Uuid::parse_str(&input.id).map_err(|_| "Invalid entry identifier.")?;
        cash_plans::protect_entry(tx, &input)?;
        pay_cash::protect_entry(tx, &input)?;
        if input.date.len() != 10 || NaiveDate::parse_from_str(&input.date, "%Y-%m-%d").is_err() {
            return Err("Choose a valid date.".into());
        }
        input.description = input.description.trim().into();
        if input.description.is_empty() || input.description.len() > 200 || input.note.len() > 2000
        {
            return Err(
                "Add a description (up to 200 characters) and a note under 2,000 characters."
                    .into(),
            );
        }
        if !["jacob", "chelsea"].contains(&input.payer.as_str()) {
            return Err("Choose who paid.".into());
        }
        let amount = money::cents(&input.amount)?;
        if amount == 0 {
            return Err("Amount must be greater than zero.".into());
        }
        if matches!(input.kind.as_str(), "reward" | "debt_payment")
            && input.date > Local::now().format("%Y-%m-%d").to_string()
        {
            return Err("Record rewards or debt payments only after they happen.".into());
        }
        if input.kind != "refund" && input.original_event_id.is_some() {
            return Err("Only refunds can link an original purchase.".into());
        }
        if input.kind == "refund" {
            return refunds::save(tx, input);
        }
        if !matches!(input.kind.as_str(), "expense" | "debt_payment") && !input.lines.is_empty() {
            return Err("Only purchases, debt payments and refunds have charge lines.".into());
        }
        household::protect_receipt(tx, &input)?;
        if input.kind != "paypal_cashout" && input.paypal.is_some() {
            return Err("Only PayPal cash-outs have receipt allocations.".into());
        }
        let allocated = if input.kind == "paypal_cashout" {
            household::cashout_lines(tx, &input)?
        } else if matches!(input.kind.as_str(), "expense" | "debt_payment") {
            lines::expense(tx, &input)?
        } else {
            Vec::new()
        };
        if let Some(first) = allocated.first() {
            input.category_id = Some(first.category_id.clone());
        }
        goals::protect_entry(tx, &input, &allocated)?;
        refunds::protect_original(tx, &input)?;
        bills::protect_entry(tx, &input)?;
        let is_transfer = matches!(input.kind.as_str(), "transfer" | "card_payment");
        if !is_transfer && input.destination_account_id.is_some() {
            return Err("Only transfers and card payments have a destination account.".into());
        }
        let existing: Option<(i64, String, Option<String>, Option<String>)> = tx
            .query_row(
                "SELECT revision,kind,account_id,category_id FROM events WHERE id=?1",
                [&input.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .map_err(err)?;
        if existing.as_ref().map(|x| x.0).unwrap_or(0) != input.revision {
            return Err("This entry changed. Reopen it before saving.".into());
        }
        if existing
            .as_ref()
            .is_some_and(|x| x.1 != input.kind && x.1 != "unclassified")
        {
            return Err("An existing entry's type cannot change.".into());
        }
        let account_kind: Option<String> = match &input.account_id {
            Some(id) => {
                let (kind, archived): (String, bool) = tx
                    .query_row(
                        "SELECT kind,archived FROM accounts WHERE id=?1",
                        [id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .map_err(|_| "Choose a valid account.")?;
                if archived && existing.as_ref().and_then(|e| e.2.as_ref()) != Some(id) {
                    return Err("This account is archived. Choose an active account.".into());
                }
                Some(kind)
            }
            None => None,
        };
        let (jacob, chelsea, household, change) = match input.kind.as_str() {
            "transfer" | "card_payment" => {
                transfer::validate(tx, &input, account_kind.as_deref())?;
                (0, 0, 0, -amount)
            }
            "expense" | "debt_payment" => {
                let category = input.category_id.as_ref().ok_or("Choose a category.")?;
                let archived: bool = tx
                    .query_row(
                        "SELECT archived FROM categories WHERE id=?1",
                        [category],
                        |r| r.get(0),
                    )
                    .map_err(|_| "Choose a valid category.")?;
                if archived && existing.as_ref().and_then(|e| e.3.as_ref()) != Some(category) {
                    return Err("This category is archived. Choose an active category.".into());
                }
                if input.payer == "jacob" && account_kind.is_none() {
                    return Err("Choose the account you paid from.".into());
                }
                if input.payer == "chelsea" && account_kind.is_some() {
                    return Err("Chelsea-paid expenses must not move a Jacob account.".into());
                }
                let j = allocated.iter().map(|l| l.jacob_cents).sum::<i64>();
                let c = amount - j;
                (
                    j,
                    c,
                    if input.payer == "jacob" { c } else { -j },
                    if account_kind.as_deref() == Some("credit") {
                        amount
                    } else {
                        -amount
                    },
                )
            }
            "paypal_cashout" => {
                if input.payer != "jacob"
                    || !matches!(account_kind.as_deref(), Some("checking" | "savings"))
                {
                    return Err("Choose the bank account that received the PayPal cash-out.".into());
                }
                input.category_id = allocated.first().map(|l| l.category_id.clone());
                input.split_mode = "none".into();
                input.split_value.clear();
                (allocated.iter().map(|l| l.jacob_cents).sum(), 0, 0, amount)
            }
            "reward" => {
                if input.payer != "jacob" || account_kind.is_none() {
                    return Err(
                        "Choose the account that actually received the reward or credit.".into(),
                    );
                }
                input.category_id = None;
                input.split_mode = "none".into();
                input.split_value.clear();
                (
                    0,
                    0,
                    0,
                    if account_kind.as_deref() == Some("credit") {
                        -amount
                    } else {
                        amount
                    },
                )
            }
            "income" => {
                if input.payer != "jacob"
                    || !matches!(account_kind.as_deref(), Some("checking" | "savings"))
                {
                    return Err(
                        "Income must be received into your checking or savings account.".into(),
                    );
                }
                input.category_id = None;
                input.split_mode = "personal".into();
                input.split_value.clear();
                (0, 0, 0, amount)
            }
            "settlement" => {
                if input.date > Local::now().format("%Y-%m-%d").to_string() {
                    return Err("Only record a repayment after it happens.".into());
                }
                if account_kind.as_deref() == Some("credit") {
                    return Err("A repayment cannot use a credit card.".into());
                }
                if input.payer == "jacob" && account_kind.is_none() {
                    return Err("Choose the bank account used to pay Chelsea.".into());
                }
                let previous_delta: Option<i64> = tx
                    .query_row(
                        "SELECT household_delta_cents FROM events WHERE id=?1",
                        [&input.id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(err)?;
                let next_delta = if input.payer == "chelsea" {
                    -amount
                } else {
                    amount
                };
                let balance: i64 = tx
                    .query_row(
                        "SELECT COALESCE(SUM(household_delta_cents),0) FROM events WHERE id!=?1",
                        [&input.id],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                let balance = balance + household::opening_cents(tx)?;
                let available = if input.payer == "chelsea" {
                    balance
                } else {
                    -balance
                };
                // Cash-out/account/note edits do not settle the debt a second time.
                // Later expenses may have reversed the balance since this repayment.
                if previous_delta != Some(next_delta) && amount > available {
                    return Err("Repayment exceeds the amount this person currently owes.".into());
                }
                input.category_id = None;
                input.split_mode = "none".into();
                input.split_value.clear();
                (
                    0,
                    0,
                    if input.payer == "chelsea" {
                        -amount
                    } else {
                        amount
                    },
                    if input.payer == "chelsea" {
                        amount
                    } else {
                        -amount
                    },
                )
            }
            _ => return Err("Unsupported entry type.".into()),
        };
        household::check_date(tx, &input.date, household)?;
        tx.execute("INSERT INTO events (id,revision,kind,date,description,amount_cents,payer,category_id,account_id,split_mode,split_value,jacob_cents,chelsea_cents,household_delta_cents,note,destination_account_id)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
            ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,revision=excluded.revision,date=excluded.date,description=excluded.description,amount_cents=excluded.amount_cents,payer=excluded.payer,category_id=excluded.category_id,account_id=excluded.account_id,split_mode=excluded.split_mode,split_value=excluded.split_value,jacob_cents=excluded.jacob_cents,chelsea_cents=excluded.chelsea_cents,household_delta_cents=excluded.household_delta_cents,note=excluded.note,destination_account_id=excluded.destination_account_id",
            params![input.id,input.revision+1,input.kind,input.date,input.description,amount,input.payer,input.category_id,input.account_id,input.split_mode,input.split_value,jacob,chelsea,household,input.note,input.destination_account_id]).map_err(err)?;
        lines::replace(tx, &input.id, &allocated)?;
        household::write_cashout(tx, &input)?;
        tx.execute(
            "DELETE FROM account_activity WHERE event_id=?1",
            [&input.id],
        )
        .map_err(err)?;
        if let Some(account) = &input.account_id {
            tx.execute(
                "INSERT INTO account_activity VALUES (?1,?2,?3)",
                params![input.id, account, change],
            )
            .map_err(err)?;
        }
        if let Some(destination) = &input.destination_account_id {
            tx.execute(
                "INSERT INTO account_activity VALUES (?1,?2,?3)",
                params![
                    input.id,
                    destination,
                    if input.kind == "card_payment" {
                        -amount
                    } else {
                        amount
                    }
                ],
            )
            .map_err(err)?;
        }
        tx.execute(
            "INSERT INTO audit(event_id,action,payload) VALUES (?1,?2,?3)",
            params![
                input.id,
                if input.revision == 0 {
                    "create"
                } else {
                    "edit"
                },
                serde_json::to_string(&input).map_err(err)?
            ],
        )
        .map_err(err)?;
        Ok(())
    }

    pub fn delete(&mut self, id: &str, revision: i64) -> Result<()> {
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let original: Option<String> = tx
            .query_row(
                "SELECT original_event_id FROM events WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
            .flatten();
        movements::protect_entry(&tx, id)?;
        refunds::protect_delete(&tx, id)?;
        bills::protect_delete(&tx, id)?;
        cash_plans::protect_delete(&tx, id)?;
        pay_cash::protect_delete(&tx, id)?;
        card_payments::protect_delete(&tx, id)?;
        household::protect_delete(&tx, id)?;
        goals::protect_delete(&tx, id)?;
        let entry: String = tx
            .query_row(
                "SELECT description FROM events WHERE id=?1 AND revision=?2",
                params![id, revision],
                |r| r.get(0),
            )
            .map_err(|_| "Entry changed or no longer exists. Refresh and try again.")?;
        tx.execute(
            "DELETE FROM events WHERE id=?1 AND revision=?2",
            params![id, revision],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(event_id,action,payload) VALUES (?1,'delete',?2)",
            params![id, entry],
        )
        .map_err(err)?;
        if let Some(original) = original {
            refunds::recalculate(&tx, &original, None)?;
        }
        periods::commit(tx)
    }

    pub fn set_budget(&mut self, month: &str, category: &str, amount: &str) -> Result<()> {
        validate_month(month)?;
        let limit = money::cents(amount)?;
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let archived: bool = tx
            .query_row(
                "SELECT archived FROM categories WHERE id=?1",
                [category],
                |r| r.get(0),
            )
            .map_err(|_| "Choose a valid category.")?;
        if archived {
            return Err("Restore this category before changing its monthly limit.".into());
        }
        tx.execute("INSERT INTO budgets VALUES (?1,?2,?3) ON CONFLICT(month,category_id) DO UPDATE SET limit_cents=excluded.limit_cents",params![month,category,limit]).map_err(err)?;
        tx.execute("INSERT OR IGNORE INTO budget_months VALUES (?1)", [month])
            .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('budget',?1)",
            [format!("{month}:{category}:{limit}")],
        )
        .map_err(err)?;
        periods::commit(tx)
    }

    fn entries(&self, month: Option<&str>) -> Result<Vec<Entry>> {
        let mut statement=self.conn.prepare("SELECT id,revision,kind,date,description,amount_cents,payer,category_id,account_id,split_mode,split_value,jacob_cents,chelsea_cents,household_delta_cents,note,destination_account_id,original_event_id FROM events e WHERE ?1 IS NULL OR COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1 ORDER BY date DESC, rowid DESC").map_err(err)?;
        let rows = statement
            .query_map([month], |r| {
                Ok(Entry {
                    budget_override: None,
                    id: r.get(0)?,
                    revision: r.get(1)?,
                    kind: r.get(2)?,
                    date: r.get(3)?,
                    description: r.get(4)?,
                    amount_cents: r.get(5)?,
                    payer: r.get(6)?,
                    category_id: r.get(7)?,
                    account_id: r.get(8)?,
                    split_mode: r.get(9)?,
                    split_value: r.get(10)?,
                    jacob_cents: r.get(11)?,
                    chelsea_cents: r.get(12)?,
                    household_delta_cents: r.get(13)?,

                    note: r.get(14)?,
                    destination_account_id: r.get(15)?,
                    original_event_id: r.get(16)?,
                    paypal: None,
                    pending: None,
                    movement_link: None,
                    activity_dates: Vec::new(),
                    lines: Vec::new(),
                })
            })
            .map_err(err)?;
        let mut entries = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
        for entry in &mut entries {
            entry.budget_override = budget_periods::read(&self.conn, &entry.id)?;
            entry.lines = lines::read(&self.conn, &entry.id)?;
            entry.paypal = household::read_cashout(&self.conn, &entry.id)?;
            entry.pending = classification::pending(&self.conn, &entry.id)?;
            entry.movement_link = movements::active(&self.conn, &entry.id)?;
            entry.activity_dates = movements::dates(&self.conn, &entry.id)?;
        }
        Ok(entries)
    }

    pub fn snapshot(&self, month: &str) -> Result<Snapshot> {
        validate_month(month)?;
        let entries = self.entries(Some(month))?;
        let funding = goals::projection(&self.conn, month)?;
        let goal_excluded_cents: i64 = funding.exclusions.values().sum();
        let all_entries = self.entries(None)?;
        let funding_review_entries = all_entries
            .iter()
            .filter(|e| funding.pending_events.contains(&e.id))
            .cloned()
            .collect();
        let household_entries: Vec<Entry> = all_entries
            .into_iter()
            .filter(|e| e.household_delta_cents != 0)
            .collect();
        let mut statement=self.conn.prepare("SELECT a.id,a.name,a.kind,COALESCE(SUM(t.change_cents),0),a.revision,a.archived,a.tracking_mode FROM accounts a LEFT JOIN account_activity t ON t.account_id=a.id GROUP BY a.id ORDER BY a.archived,a.kind,a.name").map_err(err)?;
        let mut accounts = statement
            .query_map([], |r| {
                Ok(Account {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    activity_cents: r.get(3)?,
                    revision: r.get(4)?,
                    archived: r.get(5)?,
                    tracking_mode: r.get(6)?,
                    balance: None,
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        for account in &mut accounts {
            account.balance = balances::balance(
                &self.conn,
                account,
                &Local::now().format("%Y-%m-%d").to_string(),
            )?;
        }
        let mut statement=self.conn.prepare("SELECT c.id,c.name,c.group_name,c.color,COALESCE(b.limit_cents,0),COALESCE((SELECT SUM(CASE WHEN e.kind='refund' THEN -l.jacob_cents ELSE l.jacob_cents END) FROM events e JOIN event_lines l ON l.event_id=e.id WHERE l.category_id=c.id AND e.kind IN ('expense','debt_payment','refund','paypal_cashout') AND COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1),0),c.default_limit_cents,c.revision,c.archived,c.icon FROM categories c LEFT JOIN budgets b ON b.category_id=c.id AND b.month=?1 ORDER BY c.rowid").map_err(err)?;
        let mut categories = statement
            .query_map([month], |r| {
                Ok(Category {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    group_name: r.get(2)?,
                    color: r.get(3)?,
                    limit_cents: r.get(4)?,
                    rollover_cents: 0,
                    available_cents: 0,
                    rollover_mode: rollover::reset(),
                    rollover_token: String::new(),
                    spent_cents: r.get(5)?,
                    provisional_cents: 0,
                    goal_excluded_cents: 0,
                    allowance_cents: 0,
                    default_limit_cents: r.get(6)?,
                    revision: r.get(7)?,
                    archived: r.get(8)?,
                    icon: r.get(9)?,
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        for c in &mut categories {
            c.rollover_cents = rollover::incoming(&self.conn, &c.id, month)?;
            c.available_cents = c.limit_cents + c.rollover_cents;
            c.rollover_mode = rollover::mode(&self.conn, &c.id, month)?;
            c.rollover_token = rollover::policy_token(&self.conn, &c.id)?;
            c.goal_excluded_cents = funding.exclusions.get(&c.id).copied().unwrap_or(0);
            c.allowance_cents = c.spent_cents - c.goal_excluded_cents;
            c.provisional_cents = self.conn.query_row("SELECT COALESCE(SUM(e.amount_cents),0) FROM pending_activity p JOIN events e ON e.id=p.event_id WHERE p.verified_expense=1 AND p.category_id=?1 AND COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?2", params![c.id,month], |r|r.get(0)).map_err(err)?;
        }
        let spent_cents = entries
            .iter()
            .filter(|e| {
                matches!(
                    e.kind.as_str(),
                    "expense" | "debt_payment" | "refund" | "paypal_cashout"
                )
            })
            .map(|e| {
                if e.kind == "refund" {
                    -e.jacob_cents
                } else {
                    e.jacob_cents
                }
            })
            .sum::<i64>();
        let provisional_allowance_cents = entries
            .iter()
            .filter(|e| e.pending.as_ref().is_some_and(|p| p.verified_expense))
            .map(|e| e.amount_cents)
            .sum::<i64>();
        let unclassified_count = entries.iter().filter(|e| e.kind == "unclassified").count() as i64;
        let income_cents = entries
            .iter()
            .filter(|e| e.kind == "income")
            .map(|e| e.amount_cents)
            .sum();
        let debt_payment_cents:i64=self.conn.query_row("SELECT COALESCE(SUM(CASE WHEN e.kind='debt_payment' THEN e.jacob_cents WHEN e.kind='refund' AND p.kind='debt_payment' THEN -e.jacob_cents ELSE 0 END),0) FROM events e LEFT JOIN events p ON p.id=e.original_event_id WHERE COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1",[month],|r|r.get(0)).map_err(err)?;
        let (cash_reward_cents,card_reward_cents):(i64,i64)=self.conn.query_row("SELECT COALESCE(SUM(CASE WHEN a.kind!='credit' THEN e.amount_cents ELSE 0 END),0),COALESCE(SUM(CASE WHEN a.kind='credit' THEN e.amount_cents ELSE 0 END),0) FROM events e JOIN accounts a ON a.id=e.account_id WHERE e.kind='reward' AND COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1",[month],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
        let budget_cents = categories.iter().map(|c| c.available_cents).sum::<i64>();
        let household_cents = household_entries
            .iter()
            .map(|e| e.household_delta_cents)
            .sum::<i64>()
            + household::opening_cents(&self.conn)?;
        let household_month_spent_cents = entries
            .iter()
            .filter(|e| {
                matches!(
                    e.kind.as_str(),
                    "expense" | "debt_payment" | "refund" | "paypal_cashout"
                ) && e.household_delta_cents != 0
            })
            .map(|e| {
                if e.kind == "refund" {
                    -e.amount_cents
                } else {
                    e.amount_cents
                }
            })
            .sum();
        Ok(Snapshot {
            period: periods::status(&self.conn,month)?,
            workspace: self.workspace.clone(),
            month: month.into(),
            monthly_count: entries.len() as i64,
            incomplete_imports: self.conn.query_row("SELECT COUNT(*) FROM import_sources s WHERE dismissed=0 AND (configured=0 OR error!='' OR EXISTS(SELECT 1 FROM import_rows r WHERE r.source_id=s.id AND (disposition='pending' OR EXISTS(SELECT 1 FROM pending_activity p WHERE p.event_id=r.event_id))))",[],|r|r.get(0)).map_err(err)?,
            entries,
            household_entries,
            accounts,
            categories,
            spent_cents,
            consumption_cents:spent_cents-debt_payment_cents,
            debt_payment_cents,cash_reward_cents,card_reward_cents,
            income_cents,
            budget_cents,
            budget_configured: self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM budget_months WHERE month=?1)",
                    [month],
                    |r| r.get(0),
                )
                .map_err(err)?,
            provisional_allowance_cents, unclassified_count,
            goal_excluded_cents,
            allowance_cents: spent_cents - goal_excluded_cents,
            pending_funding_count: funding.pending,
            funding_review_entries,
            remaining_cents: budget_cents - spent_cents + goal_excluded_cents - provisional_allowance_cents,
            household_cents,
            household_month_spent_cents,
            data_path: self.path.display().to_string(),
            backups: self.list_backups()?,
        })
    }

    pub fn list_backups(&self) -> Result<Vec<String>> {
        let mut names = Vec::new();
        for entry in fs::read_dir(&self.backups).map_err(err)? {
            let entry = entry.map_err(err)?;
            if entry.file_type().map_err(err)?.is_file()
                && entry.path().extension().is_some_and(|s| s == "sqlite")
            {
                names.push(entry.file_name().to_string_lossy().to_string());
            }
        }
        names.sort();
        names.reverse();
        Ok(names)
    }

    pub fn backup(&self) -> Result<String> {
        let name = format!(
            "{}-{}.sqlite",
            Utc::now().format("%Y%m%d-%H%M%S-%3f"),
            Uuid::new_v4()
        );
        self.conn
            .backup("main", self.backups.join(&name), None)
            .map_err(err)?;
        // Only files returned from this workspace's managed backup directory are rotated.
        for old in self
            .list_backups()?
            .into_iter()
            .filter(|n| !n.ends_with(".handoff.sqlite") && !n.ends_with(".managed.sqlite"))
            .skip(20)
        {
            fs::remove_file(self.backups.join(old)).map_err(err)?;
        }
        Ok(name)
    }

    pub fn restore(&mut self, name: &str) -> Result<()> {
        if !self.list_backups()?.iter().any(|n| n == name) {
            return Err("Choose a backup from this workspace.".into());
        }
        let source = Connection::open_with_flags(
            self.backups.join(name),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(err)?;
        // Copy first, then validate this exact immutable candidate. A source file
        // changing during validation must not slip different data into the restore.
        let mut validated = Connection::open_in_memory().map_err(err)?;
        {
            let copy = rusqlite::backup::Backup::new(&source, &mut validated).map_err(err)?;
            copy.run_to_completion(100, Duration::from_millis(5), None)
                .map_err(err)?;
        }
        drop(source);
        let check: String = validated
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .map_err(err)?;
        if check != "ok" {
            return Err("Backup integrity check failed. Current data was not changed.".into());
        }
        let version: i64 = validated
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(err)?;
        let identity: String = validated
            .query_row(
                "SELECT value FROM metadata WHERE key='workspace'",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !(1..=migrations::CURRENT_VERSION).contains(&version) || identity != self.workspace {
            return Err("Backup does not match this workspace or app version.".into());
        }
        let foreign_error = validated
            .prepare("PRAGMA foreign_key_check")
            .map_err(err)?
            .exists([])
            .map_err(err)?;
        if foreign_error {
            return Err("Backup contains broken references.".into());
        }
        // Migrate older backups before replacing any live data.
        migrations::upgrade(&mut validated)?;
        recovery::validate(&validated)?;
        validated
            .execute(
                "UPDATE ai_jobs SET status='interrupted',finished_at=?1 WHERE status='running'",
                [Utc::now().to_rfc3339()],
            )
            .map_err(err)?;
        // Preserve current data before SQLite atomically replaces the destination database.
        self.backup()?;
        let backup = rusqlite::backup::Backup::new(&validated, &mut self.conn).map_err(err)?;
        backup
            .run_to_completion(100, Duration::from_millis(5), None)
            .map_err(err)?;
        drop(backup);
        self.conn
            .execute(
                "INSERT INTO audit(action,payload) VALUES ('restore',?1)",
                [name],
            )
            .map_err(err)?;
        Ok(())
    }
}

fn validate_month(month: &str) -> Result<()> {
    if month.len() != 7 || NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d").is_err() {
        return Err("Choose a valid month.".into());
    }
    Ok(())
}
