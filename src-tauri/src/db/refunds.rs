use super::*;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Purchase {
    pub id: String,
    pub date: String,
    pub description: String,
    pub amount_cents: i64,
    pub remaining_cents: i64,
    pub jacob_cents: i64,
    pub chelsea_cents: i64,
    pub payer: String,
    pub category_id: String,
    pub account_id: Option<String>,
    pub lines: Vec<RefundableLine>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefundableLine {
    #[serde(flatten)]
    pub line: EntryLine,
    pub remaining_cents: i64,
}
impl Store {
    pub fn refund_purchases(&self, editing: Option<&str>) -> Result<Vec<Purchase>> {
        let mut stmt=self.conn.prepare("SELECT e.id,e.date,e.description,e.amount_cents,e.amount_cents-COALESCE((SELECT SUM(r.amount_cents) FROM events r WHERE r.original_event_id=e.id AND (?1 IS NULL OR r.id!=?1)),0),e.jacob_cents,e.chelsea_cents,e.payer,e.category_id,e.account_id FROM events e WHERE e.kind IN ('expense','debt_payment') ORDER BY e.date DESC,e.rowid DESC").map_err(err)?;
        let result = stmt
            .query_map([editing], |r| {
                Ok(Purchase {
                    id: r.get(0)?,
                    date: r.get(1)?,
                    description: r.get(2)?,
                    amount_cents: r.get(3)?,
                    remaining_cents: r.get(4)?,
                    jacob_cents: r.get(5)?,
                    chelsea_cents: r.get(6)?,
                    payer: r.get(7)?,
                    category_id: r.get(8)?,
                    account_id: r.get(9)?,
                    lines: Vec::new(),
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err);
        let mut purchases: Vec<Purchase> = result?;
        for p in &mut purchases {
            for line in lines::read(&self.conn, &p.id)? {
                let refunded:i64=self.conn.query_row("SELECT COALESCE(SUM(l.amount_cents),0) FROM event_lines l JOIN events r ON r.id=l.event_id WHERE r.original_event_id=?1 AND l.original_line_id=?2 AND (?3 IS NULL OR r.id!=?3)",params![p.id,line.id,editing],|r|r.get(0)).map_err(err)?;
                p.lines.push(RefundableLine {
                    remaining_cents: line.amount_cents - refunded,
                    line,
                });
            }
        }
        Ok(purchases)
    }
}
pub(super) fn protect_delete(tx: &Connection, id: &str) -> Result<()> {
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE original_event_id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if exists {
        return Err(
            "This purchase has linked refunds. Remove those refunds before removing the purchase."
                .into(),
        );
    }
    Ok(())
}
pub(super) fn protect_original(tx: &Connection, input: &EntryInput) -> Result<()> {
    let has: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE original_event_id=?1)",
            [&input.id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !has {
        return Ok(());
    }
    let same:bool=tx.query_row("SELECT kind=?2 AND amount_cents=?3 AND payer=?4 AND category_id IS ?5 AND account_id IS ?6 AND split_mode=?7 AND split_value=?8 AND date=?9 FROM events WHERE id=?1",params![input.id,input.kind,money::cents(&input.amount)?,input.payer,input.category_id,input.account_id,input.split_mode,input.split_value,input.date],|r|r.get(0)).map_err(err)?;
    if !same {
        return Err("This purchase has linked refunds. Its amount, date, account, category, and split are protected. Remove its refunds before changing those fields; description and notes remain editable.".into());
    }
    Ok(())
}
fn share(cumulative: i64, jacob: i64, total: i64) -> i64 {
    ((cumulative as i128 * jacob as i128 + total as i128 / 2) / total as i128) as i64
}

pub(super) fn save(tx: &rusqlite::Transaction<'_>, mut input: EntryInput) -> Result<()> {
    let original = input
        .original_event_id
        .clone()
        .ok_or("Choose the original purchase.")?;
    let old: Option<(i64, String, Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT revision,kind,original_event_id,account_id FROM events WHERE id=?1",
            [&input.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(err)?;
    if old.as_ref().map(|e| e.0).unwrap_or(0) != input.revision {
        return Err("This refund changed. Reopen it before saving.".into());
    }
    if old.as_ref().is_some_and(|e| {
        e.1 != "unclassified" && (e.1 != "refund" || e.2.as_deref() != Some(&original))
    }) {
        return Err("A saved refund cannot change its original purchase. Remove it and add a corrected refund.".into());
    }
    let (date,total,jacob,payer,category):(String,i64,i64,String,String)=tx.query_row("SELECT date,amount_cents,jacob_cents,payer,category_id FROM events WHERE id=?1 AND kind IN ('expense','debt_payment')",[&original],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|_|"Choose an existing expense as the original purchase.")?;
    if input.date < date || input.date > Local::now().format("%Y-%m-%d").to_string() {
        return Err("Refund date must be on or after the purchase and not in the future.".into());
    }
    let amount = money::cents(&input.amount)?;
    let allocations = refund_lines(tx, &input, &original)?;
    let others:i64=tx.query_row("SELECT COALESCE(SUM(amount_cents),0) FROM events WHERE original_event_id=?1 AND id!=?2",params![original,input.id],|r|r.get(0)).map_err(err)?;
    if amount > total - others {
        return Err("Refund exceeds the original purchase's remaining refundable amount.".into());
    }
    if input.destination_account_id.is_some() {
        return Err("A refund has one receiving account, not a transfer destination.".into());
    }
    let account_kind = if payer == "chelsea" {
        if input.account_id.is_some() {
            return Err(
                "A Chelsea-paid purchase refunds Chelsea and cannot change your accounts.".into(),
            );
        }
        None
    } else {
        let id = input
            .account_id
            .as_ref()
            .ok_or("Choose the account that received the refund.")?;
        let (kind, archived): (String, bool) = tx
            .query_row(
                "SELECT kind,archived FROM accounts WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "Choose a valid receiving account.")?;
        if archived && old.as_ref().and_then(|e| e.3.as_ref()) != Some(id) {
            return Err("Restore this account or choose an active receiving account.".into());
        }
        Some(kind)
    };
    input.payer = payer;
    input.category_id = Some(
        allocations
            .first()
            .map(|l| l.category_id.clone())
            .unwrap_or(category),
    );
    input.split_mode = "refund".into();
    input.split_value.clear();
    let j = share(amount, jacob, total);
    let c = amount - j;
    let household = if input.payer == "jacob" { -c } else { j };
    tx.execute("INSERT INTO events(id,revision,kind,date,description,amount_cents,payer,category_id,account_id,split_mode,split_value,jacob_cents,chelsea_cents,household_delta_cents,note,original_event_id) VALUES (?1,?2,'refund',?3,?4,?5,?6,?7,?8,'refund','',?9,?10,?11,?12,?13) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,original_event_id=excluded.original_event_id,payer=excluded.payer,category_id=excluded.category_id,split_mode=excluded.split_mode,split_value=excluded.split_value,revision=excluded.revision,date=excluded.date,description=excluded.description,amount_cents=excluded.amount_cents,account_id=excluded.account_id,jacob_cents=excluded.jacob_cents,chelsea_cents=excluded.chelsea_cents,household_delta_cents=excluded.household_delta_cents,note=excluded.note",params![input.id,input.revision+1,input.date,input.description,amount,input.payer,input.category_id,input.account_id,j,c,household,input.note,original]).map_err(err)?;
    tx.execute(
        "DELETE FROM account_activity WHERE event_id=?1",
        [&input.id],
    )
    .map_err(err)?;
    if let Some(account) = &input.account_id {
        tx.execute(
            "INSERT INTO account_activity VALUES (?1,?2,?3)",
            params![
                input.id,
                account,
                if account_kind.as_deref() == Some("credit") {
                    -amount
                } else {
                    amount
                }
            ],
        )
        .map_err(err)?;
    }
    lines::replace(tx, &input.id, &allocations)?;
    recalculate(tx, &original, Some(&input.id))?;
    tx.execute(
        "INSERT INTO audit(event_id,action,payload) VALUES (?1,'refund',?2)",
        params![input.id, serde_json::to_string(&input).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}

fn refund_lines(conn: &Connection, input: &EntryInput, original: &str) -> Result<Vec<EntryLine>> {
    let source = lines::read(conn, original)?;
    let requested = if input.lines.is_empty() {
        if source.len() != 1 {
            return Err("Enter refund amounts for the original charge lines.".into());
        }
        vec![LineInput {
            id: "main".into(),
            label: String::new(),
            category_id: String::new(),
            amount: input.amount.clone(),
            split_mode: "inherit".into(),
            split_value: String::new(),
            original_line_id: Some(source[0].id.clone()),
        }]
    } else {
        input.lines.clone()
    };
    if requested.len() > 100 {
        return Err("Too many refund lines.".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for l in requested {
        let id = l
            .original_line_id
            .ok_or("Choose an original charge line for each refund amount.")?;
        let p = source
            .iter()
            .find(|p| p.id == id)
            .ok_or("Refund line is not part of this purchase.")?;
        if !seen.insert(id.clone()) {
            return Err("Combine repeated amounts for the same refund line.".into());
        }
        let amount = money::cents(&l.amount)?;
        if amount == 0 {
            return Err(
                "Refund line amounts must be greater than zero; omit unchanged lines.".into(),
            );
        }
        let other:i64=conn.query_row("SELECT COALESCE(SUM(l.amount_cents),0) FROM event_lines l JOIN events r ON r.id=l.event_id WHERE r.original_event_id=?1 AND r.id!=?2 AND l.original_line_id=?3",params![original,input.id,id],|r|r.get(0)).map_err(err)?;
        if amount > p.amount_cents - other {
            return Err("Refund exceeds this charge line's remaining refundable amount.".into());
        }
        result.push(EntryLine {
            id: id.clone(),
            label: p.label.clone(),
            category_id: p.category_id.clone(),
            amount_cents: amount,
            split_mode: "inherit".into(),
            split_value: String::new(),
            jacob_cents: 0,
            chelsea_cents: amount,
            original_line_id: Some(id),
        });
    }
    if result.iter().map(|l| l.amount_cents).sum::<i64>() != money::cents(&input.amount)? {
        return Err("Refund lines must add up exactly to the refund amount.".into());
    }
    Ok(result)
}
// Cumulative rounding is independent for each original line in stable refund creation order.
fn expected(conn: &Connection, original: &str) -> Result<Vec<(String, Vec<EntryLine>)>> {
    let source = lines::read(conn, original)?;
    let mut stmt = conn
        .prepare("SELECT id FROM events WHERE original_event_id=?1 ORDER BY rowid")
        .map_err(err)?;
    let ids = stmt
        .query_map([original], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let mut totals = std::collections::HashMap::<String, (i64, i64)>::new();
    let mut result = Vec::new();
    for id in ids {
        let mut rows = lines::read(conn, &id)?;
        if rows.is_empty() {
            return Err("Refund has no charge allocations.".into());
        }
        let mut seen = std::collections::HashSet::new();
        for l in &mut rows {
            let original_id = l
                .original_line_id
                .as_ref()
                .ok_or("Refund line has no original charge.")?;
            let p = source
                .iter()
                .find(|p| &p.id == original_id)
                .ok_or("Refund line has an invalid original charge.")?;
            if !seen.insert(original_id.clone())
                || l.category_id != p.category_id
                || l.label != p.label
                || l.split_mode != "inherit"
                || !l.split_value.is_empty()
                || l.amount_cents <= 0
            {
                return Err("Refund line details do not match the original charge.".into());
            }
            let (sum, prev) = totals.entry(original_id.clone()).or_default();
            *sum += l.amount_cents;
            if *sum > p.amount_cents {
                return Err("Refund total exceeds its original charge line.".into());
            }
            let target = share(*sum, p.jacob_cents, p.amount_cents);
            l.jacob_cents = target - *prev;
            l.chelsea_cents = l.amount_cents - l.jacob_cents;
            *prev = target;
        }
        result.push((id, rows));
    }
    Ok(result)
}
pub(super) fn recalculate(tx: &Connection, original: &str, own: Option<&str>) -> Result<()> {
    let payer: String = tx
        .query_row("SELECT payer FROM events WHERE id=?1", [original], |r| {
            r.get(0)
        })
        .map_err(err)?;
    for (id, rows) in expected(tx, original)? {
        let j = rows.iter().map(|l| l.jacob_cents).sum::<i64>();
        let c = rows.iter().map(|l| l.chelsea_cents).sum::<i64>();
        let old: (i64, i64) = tx
            .query_row(
                "SELECT jacob_cents,chelsea_cents FROM events WHERE id=?1",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        if old != (j, c) || rows != lines::read(tx, &id)? {
            tx.execute("UPDATE events SET jacob_cents=?1,chelsea_cents=?2,household_delta_cents=?3,revision=revision+?4 WHERE id=?5",params![j,c,if payer=="jacob"{-c}else{j},if own==Some(id.as_str()){0}else{1},id]).map_err(err)?;
            lines::replace(tx, &id, &rows)?;
            tx.execute(
                "INSERT INTO audit(event_id,action,payload) VALUES (?1,'refund_rounding',?2)",
                params![id, format!("{original}:{j}:{c}")],
            )
            .map_err(err)?;
        }
    }
    Ok(())
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let bad:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM events r LEFT JOIN events p ON p.id=r.original_event_id WHERE (r.kind='refund' AND (p.kind IS NULL OR p.kind NOT IN ('expense','debt_payment') OR r.payer!=p.payer OR r.date<p.date OR r.split_mode!='refund' OR r.split_value!='' OR (r.payer='jacob' AND r.account_id IS NULL) OR (r.payer='chelsea' AND r.account_id IS NOT NULL) OR r.household_delta_cents!=CASE WHEN r.payer='jacob' THEN -r.chelsea_cents ELSE r.jacob_cents END)) OR (r.kind!='refund' AND r.original_event_id IS NOT NULL))",[],|r|r.get(0)).map_err(err)?;
    if bad {
        return Err("Backup refund links or balances are inconsistent.".into());
    }
    let mut stmt = conn
        .prepare("SELECT DISTINCT original_event_id FROM events WHERE kind='refund'")
        .map_err(err)?;
    let originals = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for original in originals {
        for (id, rows) in expected(conn, &original)? {
            if rows != lines::read(conn, &id)? {
                return Err("Backup refund line allocations are inconsistent.".into());
            }
        }
    }
    Ok(())
}
