use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn digest(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
pub fn reset() -> String {
    "reset".into()
}
pub(super) fn mode(conn: &Connection, category: &str, month: &str) -> Result<String> {
    Ok(conn.query_row("SELECT mode FROM rollover_policies WHERE category_id=?1 AND effective_month<=?2 ORDER BY effective_month DESC LIMIT 1",params![category,month],|r|r.get(0)).optional().map_err(err)?.unwrap_or_else(reset))
}
pub(super) fn policy_token(conn: &Connection, category: &str) -> Result<String> {
    let mut stmt=conn.prepare("SELECT effective_month,mode FROM rollover_policies WHERE category_id=?1 ORDER BY effective_month").map_err(err)?;
    let rows = stmt
        .query_map([category], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(digest(&serde_json::to_string(&rows).map_err(err)?))
}
pub(super) fn incoming(conn: &Connection, category: &str, month: &str) -> Result<i64> {
    conn.query_row("SELECT COALESCE(SUM(amount_cents),0) FROM budget_carry_entries WHERE target_month=?1 AND category_id=?2",params![month,category],|r|r.get(0)).map_err(err)
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetPlan {
    pub previous_limit_cents: i64,
    pub id: String,
    pub month: String,
    pub category: String,
    pub amount: String,
    pub mode: String,
    pub policy_token: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub target_month: String,
    pub reason: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarryLine {
    pub category_id: String,
    pub name: String,
    pub mode: String,
    pub remainder_cents: i64,
    pub output_cents: i64,
    pub previous_cents: i64,
    pub delta_cents: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub source_month: String,
    pub target_month: String,
    pub category_id: String,
    pub name: String,
    pub amount_cents: i64,
    pub reason: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub target_month: String,
    pub target_closed: bool,
    pub target_fingerprint: String,
    pub lines: Vec<CarryLine>,
    pub history: Vec<History>,
}
fn next(month: &str) -> Result<String> {
    Ok(
        NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d")
            .map_err(err)?
            .checked_add_months(chrono::Months::new(1))
            .ok_or("Month is out of range.")?
            .format("%Y-%m")
            .to_string(),
    )
}
fn closed(conn: &Connection, month: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM month_closes WHERE month=?1 AND closed=1)",
        [month],
        |r| r.get(0),
    )
    .map_err(err)
}
pub(super) fn preview(
    conn: &Connection,
    month: &str,
    totals: &periods::Totals,
    target: Option<&str>,
    previously_closed: bool,
) -> Result<Preview> {
    let next_month = next(month)?;
    let current = Local::now().format("%Y-%m").to_string();
    let default = if previously_closed || closed(conn, &next_month)? {
        std::cmp::max(current, next_month)
    } else {
        next_month
    };
    let target = target.unwrap_or(&default);
    validate_month(target)?;
    if target <= month {
        return Err("Carry adjustments must go to a later open month.".into());
    }
    let mut lines = Vec::new();
    for c in &totals.categories {
        let previous:i64=conn.query_row("SELECT COALESCE(SUM(amount_cents),0) FROM budget_carry_entries WHERE source_month=?1 AND category_id=?2",params![month,c.id],|r|r.get(0)).map_err(err)?;
        let remainder = c.limit_cents + c.rollover_cents - c.allowance_cents;
        let output = if c.rollover_mode == "carry" {
            remainder
        } else {
            0
        };
        if output != 0 || previous != 0 || c.rollover_mode == "carry" {
            lines.push(CarryLine {
                category_id: c.id.clone(),
                name: c.name.clone(),
                mode: c.rollover_mode.clone(),
                remainder_cents: remainder,
                output_cents: output,
                previous_cents: previous,
                delta_cents: output - previous,
            });
        }
    }
    let mut stmt=conn.prepare("SELECT x.source_month,x.target_month,x.category_id,c.name,x.amount_cents,x.reason FROM budget_carry_entries x JOIN categories c ON c.id=x.category_id WHERE x.source_month=?1 OR x.target_month=?1 ORDER BY x.rowid").map_err(err)?;
    let history = stmt
        .query_map([month], |r| {
            Ok(History {
                source_month: r.get(0)?,
                target_month: r.get(1)?,
                category_id: r.get(2)?,
                name: r.get(3)?,
                amount_cents: r.get(4)?,
                reason: r.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(Preview {
        target_month: target.into(),
        target_closed: closed(conn, target)?,
        target_fingerprint: periods::fingerprint(conn, target)?,
        lines,
        history,
    })
}
pub(super) fn apply(
    conn: &Connection,
    source: &str,
    operation: &str,
    preview: &Preview,
    choice: Option<&Choice>,
) -> Result<()> {
    let changed: Vec<_> = preview
        .lines
        .iter()
        .filter(|l| l.delta_cents != 0)
        .collect();
    if changed.is_empty() {
        return Ok(());
    }
    let choice = choice.ok_or("Confirm the rollover destination and reason before closing.")?;
    if preview.target_closed
        || choice.target_month != preview.target_month
        || choice.reason.trim().is_empty()
        || choice.reason.len() > 2000
    {
        return Err("Choose an open destination month and enter a short rollover reason.".into());
    }
    for l in changed {
        conn.execute(
            "INSERT INTO budget_carry_entries VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                Uuid::new_v4().to_string(),
                operation,
                source,
                choice.target_month,
                l.category_id,
                l.delta_cents,
                l.previous_cents,
                l.output_cents,
                choice.reason.trim(),
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(err)?;
    }
    conn.execute(
        "INSERT OR IGNORE INTO budget_months VALUES (?1)",
        [&choice.target_month],
    )
    .map_err(err)?;
    Ok(())
}
impl Store {
    pub fn save_budget_plan(&mut self, input: BudgetPlan) -> Result<()> {
        Uuid::parse_str(&input.id).map_err(err)?;
        let payload = serde_json::to_string(&input).map_err(err)?;
        let hash = digest(&payload);
        let receipt: Option<String> = self
            .conn
            .query_row(
                "SELECT payload_hash FROM budget_receipts WHERE id=?1",
                [&input.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(old) = receipt {
            return if old == hash {
                Ok(())
            } else {
                Err("Budget operation identifier was reused for different choices.".into())
            };
        }
        validate_month(&input.month)?;
        let amount = money::cents(&input.amount)?;
        if !["reset", "carry"].contains(&input.mode.as_str()) {
            return Err("Choose reset or carry.".into());
        }
        if input.policy_token != policy_token(&self.conn, &input.category)? {
            return Err("Rollover settings changed. Reopen this budget before saving.".into());
        }
        let old_limit:i64=self.conn.query_row("SELECT COALESCE((SELECT limit_cents FROM budgets WHERE month=?1 AND category_id=?2),0)",params![input.month,input.category],|r|r.get(0)).map_err(err)?;
        if old_limit != input.previous_limit_cents {
            return Err("Monthly limit changed. Reopen this budget before saving.".into());
        }
        let active: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1 AND archived=0)",
                [&input.category],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !active {
            return Err("Restore this category before changing its budget.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if mode(&tx, &input.category, &input.month)? != input.mode {
            tx.execute("INSERT INTO rollover_policies VALUES (?1,?2,?3) ON CONFLICT(category_id,effective_month) DO UPDATE SET mode=excluded.mode",params![input.category,input.month,input.mode]).map_err(err)?;
        }
        tx.execute("INSERT INTO budgets VALUES (?1,?2,?3) ON CONFLICT(month,category_id) DO UPDATE SET limit_cents=excluded.limit_cents",params![input.month,input.category,amount]).map_err(err)?;
        tx.execute(
            "INSERT OR IGNORE INTO budget_months VALUES (?1)",
            [&input.month],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO budget_receipts VALUES (?1,?2)",
            params![input.id, hash],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('budget_plan',?1)",
            [payload],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let mut stmt = conn
        .prepare("SELECT category_id,effective_month,mode FROM rollover_policies")
        .map_err(err)?;
    let mut q = stmt.query([]).map_err(err)?;
    while let Some(r) = q.next().map_err(err)? {
        validate_month(&r.get::<_, String>(1).map_err(err)?)?;
        if !["reset", "carry"].contains(&r.get::<_, String>(2).map_err(err)?.as_str()) {
            return Err("Invalid rollover policy.".into());
        }
    }
    let mut totals = BTreeMap::<(String, String), i64>::new();
    let mut stmt=conn.prepare("SELECT id,source_month,target_month,category_id,amount_cents,previous_cents,output_cents,reason,created_at FROM budget_carry_entries ORDER BY rowid").map_err(err)?;
    let mut q = stmt.query([]).map_err(err)?;
    while let Some(r) = q.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?).map_err(err)?;
        let source: String = r.get(1).map_err(err)?;
        let target: String = r.get(2).map_err(err)?;
        validate_month(&source)?;
        validate_month(&target)?;
        let cat: String = r.get(3).map_err(err)?;
        let amount: i64 = r.get(4).map_err(err)?;
        let previous: i64 = r.get(5).map_err(err)?;
        let output: i64 = r.get(6).map_err(err)?;
        let reason: String = r.get(7).map_err(err)?;
        chrono::DateTime::parse_from_rfc3339(&r.get::<_, String>(8).map_err(err)?).map_err(err)?;
        let running = totals.entry((source.clone(), cat)).or_default();
        if source >= target
            || amount == 0
            || *running != previous
            || previous.checked_add(amount) != Some(output)
            || reason.trim().is_empty()
            || reason.len() > 2000
        {
            return Err("Invalid rollover correction history.".into());
        }
        *running = output;
    }
    let mut stmt = conn
        .prepare("SELECT month,snapshot_json FROM month_closes WHERE closed=1")
        .map_err(err)?;
    let mut q = stmt.query([]).map_err(err)?;
    while let Some(r) = q.next().map_err(err)? {
        let m: String = r.get(0).map_err(err)?;
        let snap: periods::ClosedSnapshot =
            serde_json::from_str(&r.get::<_, String>(1).map_err(err)?).map_err(err)?;
        for c in snap.totals.categories {
            let output = if c.rollover_mode == "carry" {
                c.limit_cents + c.rollover_cents - c.allowance_cents
            } else {
                0
            };
            if totals.get(&(m.clone(), c.id)).copied().unwrap_or(0) != output {
                return Err("Closed rollover totals do not reconcile.".into());
            }
        }
    }
    let mut stmt = conn
        .prepare("SELECT id,payload_hash FROM budget_receipts")
        .map_err(err)?;
    let mut q = stmt.query([]).map_err(err)?;
    while let Some(r) = q.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?).map_err(err)?;
        let h: String = r.get(1).map_err(err)?;
        if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid budget operation receipt.".into());
        }
    }
    Ok(())
}
