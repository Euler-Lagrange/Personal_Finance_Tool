use super::*;
use chrono::{Datelike, Duration as Days, Months};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub account_id: String,
    pub revision: i64,
    pub first_month: String,
    pub closing_day: u32,
    pub due_day: u32,
    pub due_month_offset: u32,
    pub date_basis: String,
    pub archived: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub account_id: String,
    pub month: String,
    pub revision: i64,
    pub closing_date: String,
    pub due_date: String,
    pub date_basis: String,
    pub dates_confirmed: bool,
    pub balance: Option<String>,
    pub note: String,
    pub evidence_source_id: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Range {
    pub start: String,
    pub end: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calculation {
    pub input_fingerprint: String,
    pub through_date: String,
    pub checkpoint_date: Option<String>,
    pub checkpoint_cents: Option<i64>,
    pub change_cents: i64,
    pub balance_cents: Option<i64>,
    pub complete: bool,
    pub assumed_date_count: i64,
    pub unresolved_count: i64,
    pub gaps: Vec<Range>,
    pub coverage_sources: Vec<Evidence>,
    pub warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub calculation: Calculation,
    pub token: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Save {
    pub draft: Draft,
    pub token: String,
    pub confirmed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    pub draft: Draft,
    pub calculation: Calculation,
    pub confirmed_balance_cents: Option<i64>,
    pub difference_cents: Option<i64>,
    pub changed_since_review: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub configs: Vec<Config>,
    pub statements: Vec<Statement>,
    pub evidence: Vec<(String, Evidence)>,
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn hash<T: Serialize>(v: &T) -> Result<String> {
    Ok(crate::imports::parse::hash(json(v)?.as_bytes()))
}
fn date(s: &str) -> Result<NaiveDate> {
    if s.len() != 10 || !("1900-01-01"..="2100-12-31").contains(&s) {
        return Err("Choose a valid date between 1900 and 2100.".into());
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "Choose a valid calendar date.".into())
}
fn signed(s: &str) -> Result<i64> {
    match s.trim().strip_prefix('-') {
        Some(v) => Ok(-money::cents(v)?),
        None => money::cents(s),
    }
}
fn check_config(c: &Config) -> Result<()> {
    validate_month(&c.first_month)?;
    date(&format!("{}-01", c.first_month))?;
    if !(1..=31).contains(&c.closing_day)
        || !(1..=31).contains(&c.due_day)
        || c.due_month_offset > 2
        || (c.due_month_offset == 0 && c.due_day < c.closing_day)
        || !["posted", "transaction"].contains(&c.date_basis.as_str())
        || c.revision < 0
    {
        return Err(
            "Choose days 1–31, a due month offset of 0–2, and an activity date basis.".into(),
        );
    }
    Ok(())
}
fn card(conn: &Connection, account: &str) -> Result<()> {
    let ok: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE id=?1 AND kind='credit')",
            [account],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !ok {
        return Err("Choose an existing credit card.".into());
    }
    Ok(())
}
pub(super) fn configs(conn: &Connection) -> Result<Vec<Config>> {
    let mut q = conn.prepare("SELECT account_id,revision,config_json FROM card_statement_configs ORDER BY account_id").map_err(err)?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    rows.into_iter()
        .map(|(id, rev, s)| {
            let c: Config = serde_json::from_str(&s).map_err(err)?;
            if c.account_id != id || c.revision != rev {
                return Err("Invalid card configuration history.".into());
            }
            Ok(c)
        })
        .collect()
}
fn clamped(first: NaiveDate, day: u32) -> Result<String> {
    let last = first
        .checked_add_months(Months::new(1))
        .and_then(|d| d.pred_opt())
        .ok_or("Statement date is out of range.")?;
    Ok(first
        .with_day(day.min(last.day()))
        .ok_or("Invalid statement day.")?
        .to_string())
}
pub(super) fn default_draft(c: &Config, month: &str) -> Result<Draft> {
    let first = date(&format!("{month}-01"))?;
    let due = first
        .checked_add_months(Months::new(c.due_month_offset))
        .ok_or("Due date is out of range.")?;
    let d = Draft {
        account_id: c.account_id.clone(),
        month: month.into(),
        revision: 0,
        closing_date: clamped(first, c.closing_day)?,
        due_date: clamped(due, c.due_day)?,
        date_basis: c.date_basis.clone(),
        dates_confirmed: false,
        balance: None,
        note: String::new(),
        evidence_source_id: None,
    };
    check_draft(&d, false)?;
    Ok(d)
}
fn check_draft(d: &Draft, confirming: bool) -> Result<()> {
    validate_month(&d.month)?;
    let slot = date(&format!("{}-01", d.month))?;
    let close = date(&d.closing_date)?;
    let due = date(&d.due_date)?;
    // A cycle may move a few days across a month boundary; its original slot stays stable.
    if (close - slot).num_days().abs() > 62
        || due < close
        || (due - close).num_days() > 93
        || d.revision < 0
        || !["posted", "transaction"].contains(&d.date_basis.as_str())
        || d.note.len() > 2000
    {
        return Err("Use a nearby cycle cutoff and a due date within 93 days after it; keep notes under 2,000 characters.".into());
    }
    if let Some(v) = &d.balance {
        signed(v)?;
    }
    if d.balance.is_some() && !d.dates_confirmed {
        return Err(
            "Confirm the issuer's closing and due dates before confirming its balance.".into(),
        );
    }
    if confirming && d.dates_confirmed && close > Local::now().date_naive() {
        return Err("A future statement cannot be confirmed as issued.".into());
    }
    Ok(())
}
pub(super) fn stored(
    conn: &Connection,
    account: &str,
    month: &str,
) -> Result<Option<(Draft, Calculation)>> {
    let raw: Option<(i64, String, String, Option<String>)> = conn.query_row("SELECT revision,input_json,review_json,evidence_source_id FROM card_statements WHERE account_id=?1 AND month=?2", params![account, month], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional().map_err(err)?;
    raw.map(|(rev, input, review, evidence)| {
        let d: Draft = serde_json::from_str(&input).map_err(err)?;
        if d.account_id != account
            || d.month != month
            || d.revision != rev
            || d.evidence_source_id != evidence
        {
            return Err("Invalid statement history.".into());
        }
        Ok((d, serde_json::from_str(&review).map_err(err)?))
    })
    .transpose()
}
fn evidence_check(conn: &Connection, d: &Draft) -> Result<()> {
    if let Some(id) = &d.evidence_source_id {
        let ok: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM import_sources WHERE id=?1 AND account_id=?2)",
                params![id, d.account_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !ok {
            return Err("Choose statement evidence assigned to this card.".into());
        }
    }
    Ok(())
}
pub(super) fn calculate(conn: &Connection, d: &Draft) -> Result<Calculation> {
    let today = Local::now().date_naive().to_string();
    let through = d.closing_date.clone().min(today.clone());
    let checkpoint: Option<(String, i64)> = conn.query_row("SELECT b.date,b.balance_cents FROM balance_checkpoints b JOIN accounts a ON a.id=b.account_id WHERE b.account_id=?1 AND b.date<=?2 AND a.tracking_mode!='untracked' ORDER BY b.date DESC LIMIT 1", params![d.account_id, through], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(err)?;
    let mut c = Calculation {
        input_fingerprint: hash(&checkpoint)?,
        through_date: through.clone(),
        checkpoint_date: checkpoint.as_ref().map(|p| p.0.clone()),
        checkpoint_cents: checkpoint.as_ref().map(|p| p.1),
        change_cents: 0,
        balance_cents: None,
        complete: false,
        assumed_date_count: 0,
        unresolved_count: 0,
        gaps: vec![],
        coverage_sources: vec![],
        warnings: vec![],
    };
    if d.closing_date > today {
        c.warnings
            .push("Future cutoff: only activity known through today is included.".into());
    }
    if d.date_basis == "transaction" {
        c.warnings.push("Transaction-date calculation is an assumption; issuer liability normally follows posting dates.".into());
    }
    let Some((start, initial)) = checkpoint else {
        c.warnings.push("No end-of-day balance checkpoint at or before this cutoff. A complete export alone cannot establish the statement balance.".into());
        return Ok(c);
    };
    let basis = if d.date_basis == "posted" {
        "ad.date"
    } else {
        "e.date"
    };
    let sql = format!("SELECT a.change_cents, EXISTS(SELECT 1 FROM pending_activity p WHERE p.event_id=e.id), EXISTS(SELECT 1 FROM activity_dates x WHERE x.event_id=e.id AND x.account_id=a.account_id) OR (SELECT COUNT(DISTINCT p.date)=1 FROM import_account_dates p JOIN import_rows r ON r.id=p.row_id JOIN import_sources s ON s.id=r.source_id WHERE r.event_id=e.id AND s.account_id=a.account_id AND r.disposition='linked') FROM account_activity a JOIN events e ON e.id=a.event_id JOIN effective_activity_dates ad ON ad.event_id=a.event_id AND ad.account_id=a.account_id WHERE a.account_id=?1 AND {basis}>?2 AND {basis}<=?3");
    let mut q = conn.prepare(&sql).map_err(err)?;
    let mut rows = q
        .query(params![d.account_id, start, through])
        .map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        c.change_cents = c
            .change_cents
            .checked_add(row.get::<_, i64>(0).map_err(err)?)
            .ok_or("Statement amount exceeds supported range.")?;
        c.unresolved_count += i64::from(row.get::<_, bool>(1).map_err(err)?);
        c.assumed_date_count += i64::from(!row.get::<_, bool>(2).map_err(err)?);
    }
    c.balance_cents = Some(
        initial
            .checked_add(c.change_cents)
            .ok_or("Statement amount exceeds supported range.")?,
    );
    let mut q = conn.prepare("SELECT r.candidate_json FROM import_rows r JOIN import_sources s ON s.id=r.source_id WHERE s.account_id=?1 AND r.disposition='pending' AND s.dismissed=0").map_err(err)?;
    let pending = q
        .query_map([&d.account_id], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for raw in pending {
        let row: crate::imports::types::Candidate = serde_json::from_str(&raw).map_err(err)?;
        let rd = if d.date_basis == "posted" {
            row.posted_date
        } else {
            row.date
        };
        if rd.is_none_or(|v| v > start && v <= through) {
            c.unresolved_count += 1;
        }
    }
    let mut q = conn.prepare("SELECT s.id,s.name FROM import_sources s JOIN import_coverage c ON c.source_id=s.id WHERE s.account_id=?1 AND c.end_date>?2 AND c.start_date<=?3 ORDER BY c.start_date,c.end_date,s.id").map_err(err)?;
    let sources = q
        .query_map(params![d.account_id, start, through], |r| {
            Ok(Evidence {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let mut ranges = Vec::new();
    for source in sources {
        if let Some(cov) = identity::coverage(conn, &source.id)? {
            // Excluded posted rows may represent omitted money, even when the source is otherwise reviewed.
            let excluded: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM import_rows WHERE source_id=?1 AND disposition='excluded' AND json_extract(candidate_json,'$.status')!='pending')", [&source.id], |r| r.get(0)).map_err(err)?;
            if cov.accepted
                && cov.input.inclusive
                && cov.input.date_basis == d.date_basis
                && !excluded
            {
                ranges.push((date(&cov.input.start_date)?, date(&cov.input.end_date)?));
                c.coverage_sources.push(source);
            }
        }
    }
    let mut cursor = date(&start)?
        .checked_add_signed(Days::days(1))
        .ok_or("Checkpoint is out of range.")?;
    let end = date(&through)?;
    for (a, b) in ranges {
        if cursor > end {
            break;
        }
        if b < cursor {
            continue;
        }
        if a > cursor {
            c.gaps.push(Range {
                start: cursor.to_string(),
                end: (a - Days::days(1)).min(end).to_string(),
            });
        }
        cursor = cursor.max(b + Days::days(1));
    }
    if cursor <= end {
        c.gaps.push(Range {
            start: cursor.to_string(),
            end: through,
        });
    }
    if !c.gaps.is_empty() {
        c.warnings.push(
            "Accepted, complete coverage is missing between the checkpoint and cutoff.".into(),
        );
    }
    if c.assumed_date_count > 0 {
        c.warnings.push(format!(
            "{} movements have no verified account posting date.",
            c.assumed_date_count
        ));
    }
    if c.unresolved_count > 0 {
        c.warnings.push(format!(
            "{} recorded or imported items still need classification/review.",
            c.unresolved_count
        ));
    }
    c.input_fingerprint = fingerprint(conn, d, &start, &c.through_date)?;
    c.complete = c.warnings.is_empty();
    Ok(c)
}
fn fingerprint(conn: &Connection, d: &Draft, start: &str, through: &str) -> Result<String> {
    let basis = if d.date_basis == "posted" {
        "ad.date"
    } else {
        "e.date"
    };
    let mut inputs = Vec::new();
    for sql in [
        format!("SELECT json_array(e.id,e.revision,e.date,ad.date,a.change_cents) FROM account_activity a JOIN events e ON e.id=a.event_id JOIN effective_activity_dates ad ON ad.event_id=a.event_id AND ad.account_id=a.account_id WHERE a.account_id=?1 AND {basis}>?2 AND {basis}<=?3 ORDER BY e.id"),
        "SELECT json_array(id,revision,date,balance_cents) FROM balance_checkpoints WHERE account_id=?1 AND date=?2 AND date<=?3 ORDER BY id".into(),
        "SELECT json_array(s.id,s.revision,c.start_date,c.end_date,c.date_basis,c.completeness,c.profile,c.observed_at,c.inclusive,c.layout_hash) FROM import_sources s JOIN import_coverage c ON c.source_id=s.id WHERE s.account_id=?1 AND c.end_date>?2 AND c.start_date<=?3 ORDER BY s.id".into(),
    ] {
        let mut q=conn.prepare(&sql).map_err(err)?;
        inputs.push(q.query_map(params![d.account_id,start,through], |r|r.get::<_,String>(0)).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?);
    }
    hash(&inputs)
}
pub(super) fn protect_source_account(conn: &Connection, source: &str, account: &str) -> Result<()> {
    let used: bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM card_statements WHERE evidence_source_id=?1 AND account_id!=?2)",params![source,account],|r|r.get(0)).map_err(err)?;
    if used {
        return Err("Remove this source from its saved statement reviews before assigning it to another account.".into());
    }
    Ok(())
}
pub(super) fn review(conn: &Connection, d: &Draft) -> Result<Review> {
    check_draft(d, true)?;
    card(conn, &d.account_id)?;
    evidence_check(conn, d)?;
    let cfg = configs(conn)?
        .into_iter()
        .find(|c| c.account_id == d.account_id)
        .ok_or("Configure this card first.")?;
    let old = stored(conn, &d.account_id, &d.month)?;
    if old.as_ref().map(|p| p.0.revision).unwrap_or(0) != d.revision {
        return Err("This statement changed. Reopen it before reviewing.".into());
    }
    if old.is_none() && (cfg.archived || d.month < cfg.first_month) {
        return Err("This cycle is outside the card's active configuration.".into());
    }
    let calculation = calculate(conn, d)?;
    let token = hash(&(d, cfg, &calculation))?;
    Ok(Review { calculation, token })
}
fn retry(conn: &Connection, operation: &str, h: &str) -> Result<bool> {
    Uuid::parse_str(operation).map_err(|_| "Invalid statement operation.")?;
    let prior: Option<String> = conn
        .query_row(
            "SELECT payload_hash FROM card_statement_receipts WHERE id=?1",
            [operation],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(prior) = prior {
        if prior != h {
            return Err("This operation was already used for different statement changes.".into());
        }
        return Ok(true);
    }
    Ok(false)
}
fn receipt<T: Serialize>(
    conn: &Connection,
    operation: &str,
    h: &str,
    action: &str,
    input: &T,
) -> Result<()> {
    conn.execute(
        "INSERT INTO card_statement_receipts VALUES (?1,?2)",
        params![operation, h],
    )
    .map_err(err)?;
    conn.execute(
        "INSERT INTO audit(action,payload) VALUES (?1,?2)",
        params![action, json(&(operation, input))?],
    )
    .map_err(err)?;
    Ok(())
}
impl Store {
    pub fn card_statement_month(&self, month: &str) -> Result<View> {
        validate_month(month)?;
        date(&format!("{month}-01"))?;
        let all = configs(&self.conn)?;
        let mut statements = Vec::new();
        for cfg in &all {
            let old = stored(&self.conn, &cfg.account_id, month)?;
            let (draft, prior) = if let Some((d, c)) = old {
                (d, Some(c))
            } else if !cfg.archived && month >= cfg.first_month.as_str() {
                (default_draft(cfg, month)?, None)
            } else {
                continue;
            };
            let calculation = calculate(&self.conn, &draft)?;
            let confirmed = draft.balance.as_deref().map(signed).transpose()?;
            let difference = confirmed
                .zip(calculation.balance_cents)
                .map(|(a, b)| {
                    a.checked_sub(b)
                        .ok_or("Statement difference exceeds supported range.")
                })
                .transpose()?;
            let changed = prior
                .as_ref()
                .map(|p| Ok::<_, String>(hash(p)? != hash(&calculation)?))
                .transpose()?
                .unwrap_or(false);
            statements.push(Statement {
                draft,
                calculation,
                confirmed_balance_cents: confirmed,
                difference_cents: difference,
                changed_since_review: changed,
            });
        }
        let mut q = self.conn.prepare("SELECT account_id,id,name FROM import_sources WHERE account_id IS NOT NULL ORDER BY created_at DESC,id").map_err(err)?;
        let evidence = q
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    Evidence {
                        id: r.get(1)?,
                        name: r.get(2)?,
                    },
                ))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        Ok(View {
            configs: all,
            statements,
            evidence,
        })
    }
    pub fn save_card_statement_config(&mut self, operation: &str, mut input: Config) -> Result<()> {
        let h = hash(&("config", &input))?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        check_config(&input)?;
        // Reject same-month configurations that place the due date before closing.
        default_draft(&input, &input.first_month)?;
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if retry(&tx, operation, &h)? {
            return Ok(());
        }
        card(&tx, &input.account_id)?;
        let old = configs(&tx)?
            .into_iter()
            .find(|c| c.account_id == input.account_id);
        if old.as_ref().map(|c| c.revision).unwrap_or(0) != input.revision {
            return Err("This card configuration changed. Reopen it before saving.".into());
        }
        let archived: bool = tx
            .query_row(
                "SELECT archived FROM accounts WHERE id=?1",
                [&input.account_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if old.is_none() && archived {
            return Err("Restore this card before configuring statements.".into());
        }
        input.revision += 1;
        tx.execute("INSERT INTO card_statement_configs VALUES (?1,?2,?3) ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,config_json=excluded.config_json", params![input.account_id,input.revision,json(&input)?]).map_err(err)?;
        receipt(&tx, operation, &h, "card_statement_config", &input)?;
        periods::commit(tx)
    }
    pub fn review_card_statement(&self, input: Draft) -> Result<Review> {
        review(&self.conn, &input)
    }
    pub fn save_card_statement(&mut self, operation: &str, input: Save) -> Result<()> {
        let h = hash(&("statement", &input))?;
        if retry(&self.conn, operation, &h)? {
            return Ok(());
        }
        if !input.confirmed || input.draft.note.trim().is_empty() {
            return Err(
                "Review the calculation and provide a reason or statement reference before saving."
                    .into(),
            );
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if retry(&tx, operation, &h)? {
            return Ok(());
        }
        let (d, calculation) = write_review(&tx, input)?;
        receipt(
            &tx,
            operation,
            &h,
            "card_statement_review",
            &(d, calculation),
        )?;
        periods::commit(tx)
    }
}
pub(super) fn write_review(tx: &Connection, input: Save) -> Result<(Draft, Calculation)> {
    if !input.confirmed || input.draft.note.trim().is_empty() {
        return Err("Confirm the statement review and provide a reference.".into());
    }
    super::card_payments::protect_statement(tx, &input.draft)?;
    let r = review(tx, &input.draft)?;
    if r.token != input.token {
        return Err("Statement inputs changed. Calculate and review again before saving.".into());
    }
    let mut d = input.draft;
    d.revision += 1;
    tx.execute("INSERT INTO card_statements VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(account_id,month) DO UPDATE SET revision=excluded.revision,input_json=excluded.input_json,review_json=excluded.review_json,evidence_source_id=excluded.evidence_source_id", params![d.account_id,d.month,d.revision,json(&d)?,json(&r.calculation)?,d.evidence_source_id]).map_err(err)?;
    Ok((d, r.calculation))
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    for c in configs(conn)? {
        card(conn, &c.account_id)?;
        check_config(&c)?;
        default_draft(&c, &c.first_month)?;
        if c.revision < 1 {
            return Err("Invalid card configuration revision.".into());
        }
    }
    let mut q = conn
        .prepare("SELECT account_id,month FROM card_statements")
        .map_err(err)?;
    let ids = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (account, month) in ids {
        let (d, c) = stored(conn, &account, &month)?.ok_or("Missing statement history.")?;
        check_draft(&d, false)?;
        evidence_check(conn, &d)?;
        if d.revision < 1 || d.note.trim().is_empty() {
            return Err("Invalid statement history.".into());
        }
        validate_calculation(&c, &d.closing_date)?;
    }
    let mut q = conn
        .prepare("SELECT id,payload_hash FROM card_statement_receipts")
        .map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?).map_err(err)?;
        let h: String = r.get(1).map_err(err)?;
        if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid statement receipt.".into());
        }
    }
    Ok(())
}

pub(super) fn validate_calculation(c: &Calculation, closing_date: &str) -> Result<()> {
    date(&c.through_date)?;
    if c.through_date.as_str() > closing_date
        || c.checkpoint_date.is_some() != c.checkpoint_cents.is_some()
        || c.balance_cents
            != c.checkpoint_cents
                .and_then(|v| v.checked_add(c.change_cents))
        || (c.checkpoint_cents.is_none()
            && (c.change_cents != 0
                || c.complete
                || !c.gaps.is_empty()
                || !c.coverage_sources.is_empty()))
        || c.input_fingerprint.len() != 64
        || !c.input_fingerprint.bytes().all(|b| b.is_ascii_hexdigit())
        || c.complete != c.warnings.is_empty()
        || c.assumed_date_count < 0
        || c.unresolved_count < 0
    {
        return Err("Invalid statement calculation history.".into());
    }
    if let Some(v) = &c.checkpoint_date {
        date(v)?;
        if v > &c.through_date {
            return Err("Invalid statement checkpoint history.".into());
        }
    }
    for gap in &c.gaps {
        date(&gap.start)?;
        date(&gap.end)?;
        if gap.start > gap.end || gap.end > c.through_date {
            return Err("Invalid statement coverage history.".into());
        }
    }
    Ok(())
}
