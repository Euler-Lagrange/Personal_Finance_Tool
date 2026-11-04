use super::*;

// SQLite integrity/FK checks alone do not establish that a database is an
// operational app backup or that its derived money records agree with events.
pub(super) fn validate(conn: &Connection) -> Result<()> {
    managed_backup::validate(conn)?;
    pay_calendar::validate(conn)?;
    payroll::validate(conn)?;
    ai_jobs::validate(conn)?;
    ai_rows::validate(conn)?;
    ai_documents::validate(conn)?;
    ai_configuration::validate(conn)?;
    handoff::validate(conn)?;
    pdf_documents::validate(conn)?;
    pdf_tables::validate(conn)?;
    pdf_routes::validate(conn)?;
    card_payments::validate(conn)?;
    cash_forecast::validate(conn)?;
    card_statements::validate(conn)?;
    cash_plans::validate(conn)?;
    budget_periods::validate(conn)?;
    periods::validate(conn)?;
    rollover::validate(conn)?;
    shared_reports::validate(conn)?;
    goals::validate(conn)?;
    purchase_review::validate(conn)?;
    movements::validate(conn)?;
    classification::validate(conn)?;
    observations::validate(conn)?;
    imports::validate(conn)?;
    identity::validate(conn)?;
    lines::validate(conn)?;
    refunds::validate(conn)?;
    rules::validate(conn)?;
    bills::validate(conn)?;
    balances::validate(conn)?;
    household::validate(conn)?;
    for query in [
        "SELECT key,value FROM metadata LIMIT 0",
        "SELECT id,name,kind,revision,archived FROM accounts LIMIT 0",
        "SELECT id,name,group_name,color,default_limit_cents,revision,archived,icon FROM categories LIMIT 0",
        "SELECT month,category_id,limit_cents FROM budgets LIMIT 0",
        "SELECT month FROM budget_months LIMIT 0",
        "SELECT id,revision,kind,date,description,amount_cents,payer,category_id,account_id,split_mode,split_value,jacob_cents,chelsea_cents,household_delta_cents,note,destination_account_id FROM events LIMIT 0",
        "SELECT event_id,account_id,change_cents FROM account_activity LIMIT 0",
        "SELECT id,event_id,action,payload,created_at FROM audit LIMIT 0",
    ] {
        conn.prepare(query).map_err(|_| "Backup is missing required app data. Current data was not changed.")?;
    }
    let inconsistent: bool = conn.query_row(
        "SELECT EXISTS(
          SELECT 1 FROM events e
          LEFT JOIN pending_activity p ON p.event_id=e.id
          LEFT JOIN accounts a ON a.id=e.account_id
          LEFT JOIN accounts d ON d.id=e.destination_account_id
          LEFT JOIN account_activity t ON t.event_id=e.id AND t.account_id=e.account_id
          LEFT JOIN account_activity u ON u.event_id=e.id AND u.account_id=e.destination_account_id
          WHERE (SELECT COUNT(*) FROM account_activity WHERE event_id=e.id) != CASE
                  WHEN e.kind IN ('transfer','card_payment') THEN 2 WHEN e.account_id IS NULL THEN 0 ELSE 1 END
             OR (e.account_id IS NOT NULL AND (t.event_id IS NULL OR t.account_id!=e.account_id
                 OR t.change_cents != CASE
                   WHEN e.kind='unclassified' THEN (CASE WHEN (p.direction='out')=(a.kind='credit') THEN e.amount_cents ELSE -e.amount_cents END)
                   WHEN e.kind IN ('refund','reward') AND a.kind='credit' THEN -e.amount_cents
                   WHEN e.kind IN ('refund','reward') THEN e.amount_cents
                   WHEN e.kind IN ('expense','debt_payment') AND a.kind='credit' THEN e.amount_cents
                   WHEN e.kind IN ('expense','debt_payment') THEN -e.amount_cents
                   WHEN e.kind IN ('income','paypal_cashout') OR e.payer='chelsea' THEN e.amount_cents
                   ELSE -e.amount_cents END))
             OR (e.kind IN ('transfer','card_payment') AND
                 (e.account_id IS NULL OR e.destination_account_id IS NULL OR e.account_id=e.destination_account_id
                  OR a.kind NOT IN ('checking','savings') OR e.payer!='jacob' OR e.household_delta_cents!=0
                  OR (e.kind='transfer' AND d.kind NOT IN ('checking','savings'))
                  OR (e.kind='card_payment' AND d.kind!='credit') OR u.event_id IS NULL
                  OR u.change_cents != CASE WHEN e.kind='card_payment' THEN -e.amount_cents ELSE e.amount_cents END))
             OR (e.kind IN ('expense','debt_payment') AND ((e.payer='jacob' AND e.account_id IS NULL)
                 OR (e.payer='chelsea' AND e.account_id IS NOT NULL)
                 OR e.household_delta_cents != CASE WHEN e.payer='jacob' THEN e.chelsea_cents ELSE -e.jacob_cents END))
             OR (e.kind='reward' AND (e.payer!='jacob' OR e.account_id IS NULL OR e.category_id IS NOT NULL OR e.jacob_cents!=0 OR e.chelsea_cents!=0 OR e.split_mode!='none' OR e.split_value!='' OR e.household_delta_cents!=0))
             OR (e.kind='income' AND (e.payer!='jacob' OR e.account_id IS NULL OR a.kind='credit' OR e.household_delta_cents!=0))
             OR (e.kind='settlement' AND ((e.payer='jacob' AND e.account_id IS NULL) OR a.kind='credit'
                 OR e.household_delta_cents != CASE WHEN e.payer='chelsea' THEN -e.amount_cents ELSE e.amount_cents END))
        )", [], |r| r.get(0)).map_err(err)?;
    if inconsistent {
        return Err("Backup account activity or shared balances do not match its transactions. Current data was not changed.".into());
    }
    Ok(())
}
