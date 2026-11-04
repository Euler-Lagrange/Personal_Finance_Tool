use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    // An absent choice preserves the record; an explicit null month clears it.
    pub month: Option<String>,
    pub reason: String,
}
pub(super) fn read(conn: &Connection, id: &str) -> Result<Option<Choice>> {
    conn.query_row(
        "SELECT month,reason FROM budget_period_overrides WHERE event_id=?1",
        [id],
        |r| {
            Ok(Choice {
                month: Some(r.get(0)?),
                reason: r.get(1)?,
            })
        },
    )
    .optional()
    .map_err(err)
}
fn check(choice: &Choice, date: &str) -> Result<()> {
    if choice.reason.trim().is_empty() || choice.reason.len() > 2000 {
        return Err("Explain the budget-month override in 1 to 2,000 characters.".into());
    }
    if let Some(month) = &choice.month {
        validate_month(month)?;
        if month.as_str() <= &date[..7] {
            return Err(
                "Choose a later budget month, or clear the override to use the transaction month."
                    .into(),
            );
        }
    }
    Ok(())
}
pub(super) fn write(conn: &Connection, input: &EntryInput) -> Result<()> {
    if let Some(choice) = &input.budget_override {
        check(choice, &input.date)?;
        if let Some(month) = &choice.month {
            conn.execute("INSERT INTO budget_period_overrides VALUES (?1,?2,?3) ON CONFLICT(event_id) DO UPDATE SET month=excluded.month,reason=excluded.reason",params![input.id,month,choice.reason.trim()]).map_err(err)?;
            conn.execute("INSERT OR IGNORE INTO budget_months VALUES (?1)", [month])
                .map_err(err)?;
        } else {
            conn.execute(
                "DELETE FROM budget_period_overrides WHERE event_id=?1",
                [&input.id],
            )
            .map_err(err)?;
        }
    } else if let Some(saved) = read(conn, &input.id)? {
        // An ordinary edit preserves the explicit choice. A new actual date must
        // still precede it; changing dates never silently clears an override.
        check(&saved, &input.date)?;
    }
    Ok(())
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let mut stmt=conn.prepare("SELECT o.event_id,o.month,o.reason,e.date FROM budget_period_overrides o JOIN events e ON e.id=o.event_id").map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let id: String = r.get(0).map_err(err)?;
        let choice = Choice {
            month: Some(r.get(1).map_err(err)?),
            reason: r.get(2).map_err(err)?,
        };
        let date: String = r.get(3).map_err(err)?;
        if date.len() != 10 || NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_err() {
            return Err("Invalid actual date for budget override.".into());
        }
        check(&choice, &date)?;
        let pending: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pending_activity WHERE event_id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if pending {
            return Err(
                "Unclassified activity cannot have a confirmed budget-period override.".into(),
            );
        }
    }
    Ok(())
}
