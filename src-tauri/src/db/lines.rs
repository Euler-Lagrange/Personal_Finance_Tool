use super::*;
use std::collections::HashSet;

// Compute a single group share, then distribute whole cents by largest remainder.
// The persisted line ID breaks ties, so reordering the form does not move pennies.
pub fn allocate(
    total: i64,
    mode: &str,
    value: &str,
    input: &[LineInput],
) -> Result<Vec<EntryLine>> {
    if input.is_empty() || input.len() > 100 {
        return Err("Use between 1 and 100 charge lines.".into());
    }
    let mut ids = HashSet::new();
    let mut result = Vec::new();
    for line in input {
        if line.id.is_empty()
            || line.id.len() > 100
            || !ids.insert(line.id.clone())
            || line.label.len() > 200
            || line.original_line_id.is_some()
        {
            return Err(
                "Charge lines need unique IDs, labels up to 200 characters, and no refund link."
                    .into(),
            );
        }
        let amount = money::cents(&line.amount)?;
        if amount == 0 {
            return Err("Each charge line must be greater than zero.".into());
        }
        let (j, c) = if line.split_mode == "inherit" {
            if !line.split_value.is_empty() {
                return Err("Inherited lines cannot have a separate split value.".into());
            }
            (0, amount)
        } else {
            money::allocation(amount, &line.split_mode, &line.split_value)?
        };
        result.push(EntryLine {
            id: line.id.clone(),
            label: line.label.trim().into(),
            category_id: line.category_id.clone(),
            amount_cents: amount,
            split_mode: line.split_mode.clone(),
            split_value: line.split_value.clone(),
            jacob_cents: j,
            chelsea_cents: c,
            original_line_id: None,
        });
    }
    if result.iter().map(|l| l.amount_cents).sum::<i64>() != total {
        return Err("Charge lines must add up exactly to the full amount.".into());
    }
    let inherited = result
        .iter()
        .filter(|l| l.split_mode == "inherit")
        .map(|l| l.amount_cents)
        .sum::<i64>();
    // Validate the selected group split even when every line overrides it.
    money::allocation(total, mode, value)?;
    if inherited > 0 {
        let (target, _) = money::allocation(inherited, mode, value)?;
        let mut quotas = Vec::new();
        let mut used = 0;
        for (i, line) in result
            .iter_mut()
            .enumerate()
            .filter(|(_, l)| l.split_mode == "inherit")
        {
            let product = line.amount_cents as i128 * target as i128;
            line.jacob_cents = (product / inherited as i128) as i64;
            used += line.jacob_cents;
            quotas.push((i, product % inherited as i128, line.id.clone()));
        }
        quotas.sort_by(|a, b| b.1.cmp(&a.1).then(a.2.cmp(&b.2)));
        for (i, _, _) in quotas.iter().take((target - used) as usize) {
            result[*i].jacob_cents += 1;
        }
        for line in &mut result {
            line.chelsea_cents = line.amount_cents - line.jacob_cents;
        }
    }
    Ok(result)
}
pub(super) fn read(conn: &Connection, id: &str) -> Result<Vec<EntryLine>> {
    let mut stmt=conn.prepare("SELECT id,label,category_id,amount_cents,split_mode,split_value,jacob_cents,chelsea_cents,original_line_id FROM event_lines WHERE event_id=?1 ORDER BY rowid").map_err(err)?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(EntryLine {
                id: r.get(0)?,
                label: r.get(1)?,
                category_id: r.get(2)?,
                amount_cents: r.get(3)?,
                split_mode: r.get(4)?,
                split_value: r.get(5)?,
                jacob_cents: r.get(6)?,
                chelsea_cents: r.get(7)?,
                original_line_id: r.get(8)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(rows)
}
pub(super) fn replace(conn: &Connection, id: &str, lines: &[EntryLine]) -> Result<()> {
    conn.execute("DELETE FROM event_lines WHERE event_id=?1", [id])
        .map_err(err)?;
    for l in lines {
        conn.execute(
            "INSERT INTO event_lines VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                id,
                l.id,
                l.label,
                l.category_id,
                l.amount_cents,
                l.split_mode,
                l.split_value,
                l.jacob_cents,
                l.chelsea_cents,
                l.original_line_id
            ],
        )
        .map_err(err)?;
    }
    Ok(())
}
pub(super) fn categories(conn: &Connection, lines: &[EntryLine], old: &[EntryLine]) -> Result<()> {
    for l in lines {
        let active: bool = conn
            .query_row(
                "SELECT archived=0 FROM categories WHERE id=?1",
                [&l.category_id],
                |r| r.get(0),
            )
            .map_err(|_| "Choose a valid category for each line.")?;
        if !active
            && !old
                .iter()
                .any(|p| p.id == l.id && p.category_id == l.category_id)
        {
            return Err(
                "This category is archived. Choose an active category for each new line.".into(),
            );
        }
    }
    Ok(())
}
pub(super) fn expense(conn: &Connection, input: &EntryInput) -> Result<Vec<EntryLine>> {
    let fallback = vec![LineInput {
        id: "main".into(),
        label: String::new(),
        category_id: input.category_id.clone().ok_or("Choose a category.")?,
        amount: input.amount.clone(),
        split_mode: "inherit".into(),
        split_value: String::new(),
        original_line_id: None,
    }];
    let lines = allocate(
        money::cents(&input.amount)?,
        &input.split_mode,
        &input.split_value,
        if input.lines.is_empty() {
            &fallback
        } else {
            &input.lines
        },
    )?;
    let old = read(conn, &input.id)?;
    categories(conn, &lines, &old)?;
    let protected:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE original_event_id=?1) OR EXISTS(SELECT 1 FROM bill_payments WHERE event_id=?1)",[&input.id],|r|r.get(0)).map_err(err)?;
    if protected && lines != old {
        return Err("This purchase's charge lines are protected by linked refunds or bill payments. Unlink those before changing its lines.".into());
    }
    Ok(lines)
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let bad:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM events e WHERE (e.kind IN ('expense','debt_payment','refund','paypal_cashout') AND (e.category_id IS NOT (SELECT category_id FROM event_lines WHERE event_id=e.id ORDER BY rowid LIMIT 1) OR (SELECT COALESCE(SUM(amount_cents),0) FROM event_lines WHERE event_id=e.id)!=CASE WHEN e.kind='paypal_cashout' THEN e.jacob_cents ELSE e.amount_cents END OR (SELECT COALESCE(SUM(jacob_cents),0) FROM event_lines WHERE event_id=e.id)!=e.jacob_cents OR (SELECT COALESCE(SUM(chelsea_cents),0) FROM event_lines WHERE event_id=e.id)!=e.chelsea_cents)) OR (e.kind NOT IN ('expense','debt_payment','refund','paypal_cashout') AND EXISTS(SELECT 1 FROM event_lines WHERE event_id=e.id)))",[],|r|r.get(0)).map_err(err)?;
    if bad {
        return Err("Backup charge lines do not reconcile to their transactions.".into());
    }
    let mut stmt = conn
        .prepare("SELECT id,amount_cents,split_mode,split_value FROM events WHERE kind IN ('expense','debt_payment')")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, amount, mode, value) in rows {
        let saved = read(conn, &id)?;
        if allocate(
            amount,
            &mode,
            &value,
            &saved.iter().map(EntryLine::input).collect::<Vec<_>>(),
        )? != saved
        {
            return Err("Backup line shares do not match their stored splits.".into());
        }
    }
    Ok(())
}
