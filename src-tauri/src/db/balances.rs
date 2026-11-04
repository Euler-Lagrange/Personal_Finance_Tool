use super::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointInput {
    pub id: String,
    pub revision: i64,
    pub account_id: String,
    pub date: String,
    pub amount: String,
    pub purpose: String,
    pub note: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    pub revision: i64,
    pub account_id: String,
    pub date: String,
    pub balance_cents: i64,
    pub purpose: String,
    pub note: String,
}
fn signed(value: &str) -> Result<i64> {
    let value = value.trim();
    if let Some(magnitude) = value.strip_prefix('-') {
        Ok(-money::cents(magnitude)?)
    } else {
        money::cents(value)
    }
}
fn check_date(date: &str) -> Result<()> {
    if date.len() != 10
        || !("1900-01-01"..="2100-12-31").contains(&date)
        || NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err()
    {
        return Err("Choose a valid balance date.".into());
    }
    Ok(())
}
impl Store {
    pub fn balance_checkpoints(&self, account: &str) -> Result<Vec<Checkpoint>> {
        let mut stmt=self.conn.prepare("SELECT id,revision,account_id,date,balance_cents,purpose,note FROM balance_checkpoints WHERE account_id=?1 ORDER BY date DESC").map_err(err)?;
        let rows = stmt
            .query_map([account], |r| {
                Ok(Checkpoint {
                    id: r.get(0)?,
                    revision: r.get(1)?,
                    account_id: r.get(2)?,
                    date: r.get(3)?,
                    balance_cents: r.get(4)?,
                    purpose: r.get(5)?,
                    note: r.get(6)?,
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        Ok(rows)
    }
    pub fn save_checkpoint(&mut self, mut input: CheckpointInput) -> Result<()> {
        Uuid::parse_str(&input.id).map_err(|_| "Invalid balance identifier.")?;
        check_date(&input.date)?;
        if input.date > Local::now().format("%Y-%m-%d").to_string() {
            return Err("A confirmed balance cannot be dated in the future.".into());
        }
        let cents = signed(&input.amount)?;
        input.note = input.note.trim().into();
        if !["opening", "confirmed"].contains(&input.purpose.as_str()) || input.note.len() > 2000 {
            return Err("Choose a balance purpose and keep notes under 2,000 characters.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let old: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,account_id FROM balance_checkpoints WHERE id=?1",
                [&input.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if old.as_ref().map(|c| c.0).unwrap_or(0) != input.revision {
            return Err("This balance changed. Reopen it before saving.".into());
        }
        if old.as_ref().is_some_and(|c| c.1 != input.account_id) {
            return Err("A saved balance cannot move to another account.".into());
        }
        let (archived, mode): (bool, String) = tx
            .query_row(
                "SELECT archived,tracking_mode FROM accounts WHERE id=?1",
                [&input.account_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "Choose an existing account.")?;
        if archived && old.is_none() {
            return Err("Restore this account before adding a balance.".into());
        }
        if mode == "untracked" {
            return Err(
                "Enable imported or manual balance tracking before saving a balance.".into(),
            );
        }
        let duplicate:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM balance_checkpoints WHERE account_id=?1 AND date=?2 AND id!=?3)",params![input.account_id,input.date,input.id],|r|r.get(0)).map_err(err)?;
        if duplicate {
            return Err(
                "A balance already exists for this date. Edit that checkpoint instead.".into(),
            );
        }
        tx.execute("INSERT INTO balance_checkpoints VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,date=excluded.date,balance_cents=excluded.balance_cents,purpose=excluded.purpose,note=excluded.note",params![input.id,input.revision+1,input.account_id,input.date,cents,input.purpose,input.note]).map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('balance_checkpoint',?1)",
            [serde_json::to_string(&input).map_err(err)?],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
    pub fn delete_checkpoint(&mut self, id: &str, revision: i64) -> Result<()> {
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if tx
            .execute(
                "DELETE FROM balance_checkpoints WHERE id=?1 AND revision=?2",
                params![id, revision],
            )
            .map_err(err)?
            != 1
        {
            return Err(
                "This balance changed or no longer exists. Refresh before removing it.".into(),
            );
        }
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('balance_checkpoint_delete',?1)",
            [id],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}
pub(super) fn balance(
    conn: &Connection,
    account: &Account,
    through: &str,
) -> Result<Option<Balance>> {
    if account.tracking_mode == "untracked" {
        return Ok(None);
    }
    let latest:Option<(String,i64)>=conn.query_row("SELECT date,balance_cents FROM balance_checkpoints WHERE account_id=?1 AND date<=?2 ORDER BY date DESC LIMIT 1",params![account.id,through],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
    let Some((date, confirmed)) = latest else {
        return Ok(None);
    };
    // End-of-day checkpoints already include every movement through their date.
    let changes:i64=conn.query_row("SELECT COALESCE(SUM(a.change_cents),0) FROM account_activity a JOIN events e ON e.id=a.event_id LEFT JOIN effective_activity_dates d ON d.event_id=a.event_id AND d.account_id=a.account_id WHERE a.account_id=?1 AND COALESCE(d.date,e.date)>?2 AND COALESCE(d.date,e.date)<=?3",params![account.id,date,through],|r|r.get(0)).map_err(err)?;
    let estimated = confirmed
        .checked_add(changes)
        .ok_or("Estimated balance exceeds supported range.")?;
    Ok(Some(Balance {
        checkpoint_date: date,
        checkpoint_cents: confirmed,
        known_change_cents: changes,
        estimated_cents: estimated,
        through_date: through.into(),
    }))
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let bad:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM accounts WHERE tracking_mode NOT IN ('imported','manual','untracked'))",[],|r|r.get(0)).map_err(err)?;
    if bad {
        return Err("Backup has an invalid account tracking mode.".into());
    }
    let mut stmt = conn
        .prepare("SELECT id,revision,date,balance_cents,purpose,note FROM balance_checkpoints")
        .map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?)
            .map_err(|_| "Invalid backup balance identifier.")?;
        let revision: i64 = r.get(1).map_err(err)?;
        let date: String = r.get(2).map_err(err)?;
        check_date(&date)?;
        let amount: i64 = r.get(3).map_err(err)?;
        let purpose: String = r.get(4).map_err(err)?;
        let note: String = r.get(5).map_err(err)?;
        if revision <= 0
            || !(-money::MAX_CENTS..=money::MAX_CENTS).contains(&amount)
            || !["opening", "confirmed"].contains(&purpose.as_str())
            || note.len() > 2000
        {
            return Err("Backup contains an invalid balance checkpoint.".into());
        }
    }
    Ok(())
}
