use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

fn hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
fn json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(err)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    #[serde(default)]
    pub rollover_cents: i64,
    #[serde(default = "rollover::reset")]
    pub rollover_mode: String,
    pub id: String,
    pub name: String,
    pub group: String,
    pub limit_cents: i64,
    pub spent_cents: i64,
    pub goal_excluded_cents: i64,
    pub allowance_cents: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    #[serde(default)]
    pub rollover_cents: i64,
    pub spent_cents: i64,
    pub consumption_cents: i64,
    pub debt_payment_cents: i64,
    pub income_cents: i64,
    pub cash_reward_cents: i64,
    pub card_reward_cents: i64,
    pub goal_excluded_cents: i64,
    pub allowance_cents: i64,
    pub budget_cents: i64,
    pub remaining_cents: i64,
    pub savings_contribution_cents: i64,
    pub categories: Vec<CategoryTotal>,
}
impl Totals {
    fn from_snapshot(s: &Snapshot, conn: &Connection) -> Result<Self> {
        let savings=conn.query_row("SELECT COALESCE(SUM(e.amount_cents),0) FROM events e JOIN accounts a ON a.id=e.account_id JOIN accounts b ON b.id=e.destination_account_id WHERE e.kind='transfer' AND a.kind='checking' AND b.kind='savings' AND COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1",[&s.month],|r|r.get(0)).map_err(err)?;
        Ok(Self {
            rollover_cents: s.categories.iter().map(|c| c.rollover_cents).sum(),
            spent_cents: s.spent_cents,
            consumption_cents: s.consumption_cents,
            debt_payment_cents: s.debt_payment_cents,
            income_cents: s.income_cents,
            cash_reward_cents: s.cash_reward_cents,
            card_reward_cents: s.card_reward_cents,
            goal_excluded_cents: s.goal_excluded_cents,
            allowance_cents: s.allowance_cents,
            budget_cents: s.budget_cents,
            remaining_cents: s.remaining_cents,
            savings_contribution_cents: savings,
            categories: s
                .categories
                .iter()
                .map(|c| CategoryTotal {
                    rollover_cents: c.rollover_cents,
                    rollover_mode: c.rollover_mode.clone(),
                    id: c.id.clone(),
                    name: c.name.clone(),
                    group: c.group_name.clone(),
                    limit_cents: c.limit_cents,
                    spent_cents: c.spent_cents,
                    goal_excluded_cents: c.goal_excluded_cents,
                    allowance_cents: c.allowance_cents,
                })
                .collect(),
        })
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    pub message: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payroll: Option<super::pay_cash::PaidMonth>,
    pub totals: Totals,
    pub acknowledgements: Vec<Check>,
    pub note: String,
    pub shared: serde_json::Value,
    pub shared_html: String,
    pub shared_csv: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub payroll: Option<super::pay_cash::PaidMonth>,
    pub carry: rollover::Preview,
    pub month: String,
    pub revision: i64,
    pub closed: bool,
    pub closed_at: Option<String>,
    pub changed: bool,
    pub token: String,
    pub blockers: Vec<Check>,
    pub warnings: Vec<Check>,
    pub totals: Totals,
    pub previous: Option<Totals>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseInput {
    #[serde(default)]
    pub carry: Option<rollover::Choice>,
    pub id: String,
    pub month: String,
    pub revision: i64,
    pub token: String,
    pub acknowledgements: Vec<String>,
    pub note: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReopenInput {
    pub id: String,
    pub month: String,
    pub revision: i64,
    pub reason: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualMonth {
    pub month: String,
    pub status: String,
    pub changed: bool,
    pub totals: Option<Totals>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annual {
    pub average_closed_totals: Option<Totals>,
    pub year: i32,
    pub months: Vec<AnnualMonth>,
    pub closed_months: i64,
    pub actual_spending_cents: i64,
    pub average_closed_spending_cents: Option<i64>,
}

fn rows(conn: &Connection, sql: &str, month: &str) -> Result<Vec<Vec<serde_json::Value>>> {
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let count = stmt.column_count();
    let mut q = stmt.query([month]).map_err(err)?;
    let mut result = Vec::new();
    while let Some(r) = q.next().map_err(err)? {
        let mut values = Vec::new();
        for i in 0..count {
            values.push(match r.get_ref(i).map_err(err)? {
                rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                rusqlite::types::ValueRef::Integer(n) => n.into(),
                rusqlite::types::ValueRef::Text(s) => {
                    String::from_utf8(s.to_vec()).map_err(err)?.into()
                }
                _ => return Err("Unexpected financial fingerprint value.".into()),
            });
        }
        result.push(values);
    }
    Ok(result)
}
pub(super) fn fingerprint(conn: &Connection, month: &str) -> Result<String> {
    let queries=[
        "SELECT date,amount_cents FROM household_opening WHERE substr(date,1,7)=?1",
        "SELECT id,account_id,date,balance_cents,purpose FROM balance_checkpoints WHERE substr(date,1,7)=?1 ORDER BY id",
        "SELECT a.event_id,a.account_id,a.change_cents,d.date FROM account_activity a JOIN effective_activity_dates d ON d.event_id=a.event_id AND d.account_id=a.account_id WHERE COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=a.event_id),substr(d.date,1,7))=?1 ORDER BY a.event_id,a.account_id",
        "SELECT id,kind,date,amount_cents,payer,category_id,account_id,destination_account_id,split_mode,split_value,jacob_cents,chelsea_cents,household_delta_cents,original_event_id FROM events e WHERE COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1 ORDER BY id",
        "SELECT l.event_id,l.id,l.category_id,l.amount_cents,l.split_mode,l.split_value,l.jacob_cents,l.chelsea_cents,l.original_line_id FROM event_lines l JOIN events e ON e.id=l.event_id WHERE COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1 ORDER BY l.event_id,l.id",
        "SELECT category_id,limit_cents FROM budgets WHERE month=?1 ORDER BY category_id",
        "SELECT p.event_id,p.direction,p.verified_expense,p.category_id,p.kind_hint FROM pending_activity p JOIN events e ON e.id=p.event_id WHERE COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1 ORDER BY p.event_id",
        "SELECT g.id,g.event_id,g.line_id,g.goal_id,g.amount_cents,g.policy,g.withdrawal_id,g.reviewed FROM goal_funding g JOIN events e ON e.id=g.event_id WHERE COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1 OR EXISTS(SELECT 1 FROM events r WHERE r.original_event_id=e.id AND COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=r.id),substr(r.date,1,7))=?1) ORDER BY g.id",
        "SELECT a.event_id,a.account_id,a.change_cents FROM account_activity a JOIN events e ON e.id=a.event_id WHERE COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1 ORDER BY a.event_id,a.account_id",
    ];
    let mut values = Vec::new();
    for q in queries {
        values.push(rows(conn, q, month)?);
    }
    // Empty v22 additions preserve v21 fingerprints and close snapshots exactly.
    for sql in [
        "SELECT event_id,month FROM budget_period_overrides WHERE month=?1 ORDER BY event_id",
        "SELECT p.category_id,p.mode FROM rollover_policies p WHERE p.mode='carry' AND p.effective_month=(SELECT MAX(x.effective_month) FROM rollover_policies x WHERE x.category_id=p.category_id AND x.effective_month<=?1) ORDER BY p.category_id",
        "SELECT id,source_month,target_month,category_id,amount_cents,previous_cents,output_cents FROM budget_carry_entries WHERE source_month=?1 OR target_month=?1 ORDER BY id",
    ] {
        let extra=rows(conn,sql,month)?;
        if !extra.is_empty() { values.push(extra); }
    }
    let funding = goals::projection(conn, month)?;
    let exclusions: BTreeMap<_, _> = funding.exclusions.into_iter().collect();
    Ok(hash(&json(&(values, exclusions, funding.pending))?))
}
// Every mutation transaction enters here, including imports and undo. A rejection
// drops the transaction before any partial operation can commit.
pub(super) fn commit(tx: rusqlite::Transaction<'_>) -> Result<()> {
    super::pay_cash::validate_references(&tx, &super::payroll::read(&tx)?.1)?;
    super::card_payments::protect_dates(&tx)?;
    verify_locked(&tx)?;
    tx.commit().map_err(err)
}
fn verify_locked(conn: &Connection) -> Result<()> {
    let mut stmt = conn
        .prepare("SELECT month,fingerprint FROM month_closes WHERE closed=1 ORDER BY month")
        .map_err(err)?;
    let locked = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (m, expected) in locked {
        if fingerprint(conn, &m)? != expected {
            return Err(format!("Month {m} is closed. Reopen it in Month close before making this change. Original transaction dates are preserved."));
        }
    }
    Ok(())
}
type CloseRecord = (i64, bool, String, ClosedSnapshot, String);
fn read(conn: &Connection, month: &str) -> Result<Option<CloseRecord>> {
    let r:Option<(i64,bool,String,String,String)>=conn.query_row("SELECT revision,closed,closed_at,snapshot_json,fingerprint FROM month_closes WHERE month=?1",[month],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(err)?;
    r.map(|(rev, closed, at, s, f)| {
        Ok((rev, closed, at, serde_json::from_str(&s).map_err(err)?, f))
    })
    .transpose()
}
fn retry(conn: &Connection, id: &str, payload: &str) -> Result<bool> {
    Uuid::parse_str(id).map_err(|_| "Invalid close operation identifier.")?;
    let old: Option<String> = conn
        .query_row(
            "SELECT payload_hash FROM close_receipts WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    match old {
        Some(h) if h != hash(payload) => {
            Err("This close operation identifier was already used for different choices.".into())
        }
        Some(_) => Ok(true),
        None => Ok(false),
    }
}
fn add(list: &mut Vec<Check>, id: impl Into<String>, message: impl Into<String>) {
    list.push(Check {
        id: id.into(),
        message: message.into(),
    });
}
fn month_end(month: &str) -> Result<String> {
    let start = NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d").map_err(err)?;
    let next = start
        .checked_add_months(chrono::Months::new(1))
        .ok_or("Month is out of range.")?;
    Ok(next.pred_opt().unwrap().format("%Y-%m-%d").to_string())
}
impl Store {
    pub fn close_review(&mut self, month: &str) -> Result<Review> {
        self.close_review_target(month, None)
    }
    pub fn close_review_target(&mut self, month: &str, target: Option<&str>) -> Result<Review> {
        validate_month(month)?;
        let bills = self.bill_month(month)?;
        let snapshot = self.snapshot(month)?;
        let totals = Totals::from_snapshot(&snapshot, &self.conn)?;
        let stored = read(&self.conn, month)?;
        let current = fingerprint(&self.conn, month)?;
        let revision = stored.as_ref().map(|r| r.0).unwrap_or(0);
        let mut blockers = Vec::new();
        let mut warnings = Vec::new();
        if month >= Local::now().format("%Y-%m").to_string().as_str() {
            add(
                &mut blockers,
                "unfinished",
                "Close a month after its last calendar day.",
            );
        }
        if snapshot.entries.iter().any(|e| e.pending.is_some()) {
            add(
                &mut blockers,
                "classification",
                "Resolve recorded transaction types and sharing before closing.",
            );
        }
        if snapshot.pending_funding_count > 0 {
            add(
                &mut blockers,
                "funding",
                format!(
                    "Review {} goal funding assignments affecting this month.",
                    snapshot.pending_funding_count
                ),
            );
        }
        let held:i64=self.conn.query_row("SELECT COUNT(*) FROM import_rows r JOIN import_sources s ON s.id=r.source_id WHERE s.dismissed=0 AND r.disposition='pending' AND COALESCE(json_extract(r.candidate_json,'$.status'),'')!='pending' AND (json_extract(r.candidate_json,'$.date') IS NULL OR substr(json_extract(r.candidate_json,'$.date'),1,7)=?1)",[month],|r|r.get(0)).map_err(err)?;
        if held > 0 {
            add(&mut blockers,"held",format!("Review or explicitly exclude {held} held import rows with unknown or matching dates."));
        }
        let unconfigured:i64=self.conn.query_row("SELECT COUNT(*) FROM import_sources WHERE dismissed=0 AND format!='pdf' AND configured=0 AND (json_array_length(json_extract(dataset_json,'$.rows'))>0 OR error!='')",[],|r|r.get(0)).map_err(err)?;
        if unconfigured > 0 {
            add(&mut blockers,"sources",format!("Configure or dismiss {unconfigured} transaction sources whose dates are not yet established."));
        }
        let uncategorized:i64=self.conn.query_row("SELECT COUNT(*) FROM event_lines l JOIN events e ON e.id=l.event_id WHERE COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1 AND l.category_id='uncategorized'",[month],|r|r.get(0)).map_err(err)?;
        if uncategorized > 0 {
            add(&mut warnings,"uncategorized",format!("{uncategorized} verified charge lines remain Uncategorized; their money already counts."));
        }
        let outstanding = bills
            .iter()
            .filter(|b| !b.cancelled && b.remaining_cents > 0)
            .count();
        let estimated = bills
            .iter()
            .filter(|b| !b.cancelled && b.actual_cents.is_none())
            .count();
        if outstanding > 0 || estimated > 0 {
            add(&mut warnings,"bills",format!("{outstanding} bills remain unpaid/partly paid and {estimated} amounts are estimates. Obligations continue after close."));
        }
        let end = month_end(month)?;
        let start = format!("{month}-01");
        for a in &snapshot.accounts {
            if a.archived || a.tracking_mode != "imported" {
                continue;
            }
            let mut stmt=self.conn.prepare("SELECT c.start_date,c.end_date FROM import_coverage c JOIN import_sources s ON s.id=c.source_id WHERE s.account_id=?1 AND s.dismissed=0 AND c.completeness='complete' AND c.date_basis='transaction' AND c.end_date>=?2 AND c.start_date<=?3 ORDER BY c.start_date,c.end_date").map_err(err)?;
            let intervals = stmt
                .query_map(params![a.id, start, end], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(err)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(err)?;
            let mut through = start.clone();
            let mut covered = false;
            for (from, to) in intervals {
                if from > through {
                    break;
                }
                if to >= end {
                    covered = true;
                    break;
                }
                if to >= through {
                    through = NaiveDate::parse_from_str(&to, "%Y-%m-%d")
                        .map_err(err)?
                        .succ_opt()
                        .ok_or("Coverage date is out of range.")?
                        .format("%Y-%m-%d")
                        .to_string();
                }
            }
            if !covered {
                add(&mut warnings,format!("coverage:{}",a.id),format!("{} has incomplete confirmed transaction-date coverage. Accept this gap only after checking the month.",a.name));
            }
        }
        add(&mut warnings,"reconciliation","I reviewed the month and understand that account balance reconciliation is optional; close does not certify bank balances.");
        let carry = rollover::preview(&self.conn, month, &totals, target, stored.is_some())?;
        if carry.lines.iter().any(|l| l.delta_cents != 0) {
            add(&mut warnings,"rollover","Apply the listed signed rollover differences to the selected open month. This changes allowance only.");
            if carry.target_closed {
                add(&mut blockers,"carry_target","The rollover destination is closed. Choose a later open month or explicitly reopen it.");
            }
        }
        let payroll = super::pay_cash::month_explanation(&self.conn, month)?;
        if payroll
            .plans
            .iter()
            .any(|p| !p.plan.cancelled && (!p.plan.complete || p.changed))
        {
            add(&mut warnings,"payroll","Review incomplete payroll deposits and any changed approved predictions. Closing retains this explanation but does not finalize timesheets.");
        }
        let token = hash(&json(&(
            month, revision, &current, &blockers, &warnings, &totals, &carry, &payroll,
        ))?);
        Ok(Review {
            payroll: if let Some(saved) = stored.as_ref().filter(|r| r.1) {
                saved.3.payroll.clone()
            } else {
                Some(payroll)
            },
            carry,
            month: month.into(),
            revision,
            closed: stored.as_ref().is_some_and(|r| r.1),
            closed_at: stored.as_ref().map(|r| r.2.clone()),
            changed: stored.as_ref().is_some_and(|r| r.4 != current),
            token,
            blockers,
            warnings,
            totals,
            previous: stored.map(|r| r.3.totals),
        })
    }
    pub fn close_month(&mut self, input: CloseInput) -> Result<()> {
        let payload = json(&("close", &input))?;
        if retry(&self.conn, &input.id, &payload)? {
            return Ok(());
        }
        let review = self.close_review_target(
            &input.month,
            input.carry.as_ref().map(|c| c.target_month.as_str()),
        )?;
        if review.closed {
            return Err("This month is already closed.".into());
        }
        if review.revision != input.revision || review.token != input.token {
            return Err("Month changed. Reload the close checklist before confirming.".into());
        }
        if !review.blockers.is_empty() {
            return Err("Resolve the blocking items before closing this month.".into());
        }
        let acknowledged: HashSet<_> = input.acknowledgements.iter().collect();
        if input.note.len() > 2000
            || review
                .warnings
                .iter()
                .any(|c| !acknowledged.contains(&c.id))
        {
            return Err(
                "Acknowledge every checklist item and keep the note under 2,000 characters.".into(),
            );
        }
        let statement = self.shared_statement(Some(&input.month))?;
        let mut shared = serde_json::to_value(&statement).map_err(err)?;
        if let Some(rows) = shared.get_mut("rows").and_then(|r| r.as_array_mut()) {
            for r in rows {
                r["payer"] = r["entry"]["payer"].clone();
                r["entry"] = serde_json::Value::Null;
            }
        }
        shared["closed"] = true.into();
        let snap = ClosedSnapshot {
            payroll: review.payroll,
            totals: review.totals,
            acknowledgements: review.warnings,
            note: input.note,
            shared,
            shared_html: statement.render("html")?,
            shared_csv: statement.render("csv")?,
        };
        let serialized = json(&snap)?;
        let financial = fingerprint(&self.conn, &input.month)?;
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute("INSERT INTO month_closes VALUES (?1,?2,1,?3,?4,?5,?6) ON CONFLICT(month) DO UPDATE SET revision=excluded.revision,closed=1,closed_at=excluded.closed_at,snapshot_json=excluded.snapshot_json,snapshot_hash=excluded.snapshot_hash,fingerprint=excluded.fingerprint",params![input.month,input.revision+1,Utc::now().to_rfc3339(),serialized,hash(&serialized),financial]).map_err(err)?;
        tx.execute(
            "INSERT INTO close_receipts VALUES (?1,?2,?3)",
            params![input.id, hash(&payload), input.month],
        )
        .map_err(err)?;
        rollover::apply(
            &tx,
            &input.month,
            &input.id,
            &review.carry,
            input.carry.as_ref(),
        )?;
        let final_fingerprint = fingerprint(&tx, &input.month)?;
        tx.execute(
            "UPDATE month_closes SET fingerprint=?1 WHERE month=?2",
            params![final_fingerprint, input.month],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('month_close',?1)",
            [payload],
        )
        .map_err(err)?;
        commit(tx)
    }
    pub fn reopen_month(&mut self, input: ReopenInput) -> Result<()> {
        let payload = json(&("reopen", &input))?;
        if retry(&self.conn, &input.id, &payload)? {
            return Ok(());
        }
        validate_month(&input.month)?;
        if input.reason.trim().is_empty() || input.reason.len() > 2000 {
            return Err("Enter a short reason for reopening this month.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if tx.execute("UPDATE month_closes SET closed=0,revision=revision+1 WHERE month=?1 AND revision=?2 AND closed=1",params![input.month,input.revision]).map_err(err)?!=1{return Err("Month changed or is already open. Reload before reopening.".into());}
        tx.execute(
            "INSERT INTO close_receipts VALUES (?1,?2,?3)",
            params![input.id, hash(&payload), input.month],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('month_reopen',?1)",
            [payload],
        )
        .map_err(err)?;
        commit(tx)
    }
    pub fn annual_report(&self, year: i32) -> Result<Annual> {
        if !(1900..=2100).contains(&year) {
            return Err("Choose a year between 1900 and 2100.".into());
        }
        let today = Local::now().format("%Y-%m").to_string();
        let mut report = Annual {
            average_closed_totals: None,
            year,
            months: Vec::new(),
            closed_months: 0,
            actual_spending_cents: 0,
            average_closed_spending_cents: None,
        };
        let mut completed = 0;
        for number in 1..=12 {
            let month = format!("{year:04}-{number:02}");
            let stored = read(&self.conn, &month)?;
            let tracked:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM budget_months WHERE month=?1 UNION ALL SELECT 1 FROM events e WHERE COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?1 UNION ALL SELECT 1 FROM month_closes WHERE month=?1)",[&month],|r|r.get(0)).map_err(err)?;
            let (status, totals, changed) = if month > today {
                ("future", None, false)
            } else if let Some((_, true, _, s, _)) = &stored {
                report.closed_months += 1;
                completed += s.totals.spent_cents;
                ("closed", Some(s.totals.clone()), false)
            } else if tracked {
                let t = Totals::from_snapshot(&self.snapshot(&month)?, &self.conn)?;
                let changed = if let Some(r) = stored {
                    r.4 != fingerprint(&self.conn, &month)?
                } else {
                    false
                };
                ("open", Some(t), changed)
            } else {
                ("missing", None, false)
            };
            if let Some(t) = &totals {
                report.actual_spending_cents += t.spent_cents;
            }
            report.months.push(AnnualMonth {
                month,
                status: status.into(),
                totals,
                changed,
            });
        }
        if report.closed_months > 0 {
            report.average_closed_spending_cents = Some(
                ((completed as i128
                    + if completed >= 0 {
                        report.closed_months as i128 / 2
                    } else {
                        -(report.closed_months as i128 / 2)
                    })
                    / report.closed_months as i128) as i64,
            );
        }
        report.average_closed_totals = averages(&report.months);
        Ok(report)
    }
    pub fn shared_statement_view(&self, month: Option<&str>) -> Result<serde_json::Value> {
        if let Some(m) = month {
            if let Some(s) = self.closed_shared(m)? {
                return Ok(s.shared);
            }
        }
        serde_json::to_value(self.shared_statement(month)?).map_err(err)
    }
    pub fn export_statement(
        &self,
        directory: &Path,
        month: Option<&str>,
        format: &str,
    ) -> Result<String> {
        if let Some(m) = month {
            if let Some(s) = self.closed_shared(m)? {
                let content = match format {
                    "html" => s.shared_html,
                    "csv" => s.shared_csv,
                    _ => return Err("Choose HTML or CSV.".into()),
                };
                return shared_reports::write_export(
                    directory,
                    &self.workspace,
                    month,
                    format,
                    &content,
                );
            }
        }
        self.shared_statement(month)?.export(directory, format)
    }
    pub fn closed_shared(&self, month: &str) -> Result<Option<ClosedSnapshot>> {
        Ok(read(&self.conn, month)?.filter(|r| r.1).map(|r| r.3))
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub closed: bool,
    pub changed: bool,
    pub closed_at: String,
}
pub(super) fn status(conn: &Connection, month: &str) -> Result<Option<Status>> {
    read(conn, month)?
        .map(|r| {
            Ok(Status {
                closed: r.1,
                changed: r.4 != fingerprint(conn, month)?,
                closed_at: r.2,
            })
        })
        .transpose()
}
fn rounded_average(sum: i64, count: i64) -> i64 {
    ((sum as i128
        + if sum >= 0 {
            count as i128 / 2
        } else {
            -(count as i128 / 2)
        })
        / count as i128) as i64
}
fn averages(months: &[AnnualMonth]) -> Option<Totals> {
    let totals: Vec<&Totals> = months
        .iter()
        .filter(|m| m.status == "closed")
        .filter_map(|m| m.totals.as_ref())
        .collect();
    let count = totals.len() as i64;
    if count == 0 {
        return None;
    }
    let avg = |f: fn(&Totals) -> i64| rounded_average(totals.iter().map(|t| f(t)).sum(), count);
    let mut categories = BTreeMap::<String, CategoryTotal>::new();
    for t in &totals {
        for c in &t.categories {
            let x = categories.entry(c.id.clone()).or_insert(CategoryTotal {
                id: c.id.clone(),
                name: c.name.clone(),
                group: c.group.clone(),
                rollover_cents: 0,
                rollover_mode: rollover::reset(),
                limit_cents: 0,
                spent_cents: 0,
                goal_excluded_cents: 0,
                allowance_cents: 0,
            });
            x.name = c.name.clone();
            x.group = c.group.clone();
            x.rollover_cents += c.rollover_cents;
            x.limit_cents += c.limit_cents;
            x.spent_cents += c.spent_cents;
            x.goal_excluded_cents += c.goal_excluded_cents;
            x.allowance_cents += c.allowance_cents;
        }
    }
    for c in categories.values_mut() {
        c.rollover_cents = rounded_average(c.rollover_cents, count);
        c.limit_cents = rounded_average(c.limit_cents, count);
        c.spent_cents = rounded_average(c.spent_cents, count);
        c.goal_excluded_cents = rounded_average(c.goal_excluded_cents, count);
        c.allowance_cents = rounded_average(c.allowance_cents, count);
    }
    Some(Totals {
        rollover_cents: avg(|t| t.rollover_cents),
        spent_cents: avg(|t| t.spent_cents),
        consumption_cents: avg(|t| t.consumption_cents),
        debt_payment_cents: avg(|t| t.debt_payment_cents),
        income_cents: avg(|t| t.income_cents),
        cash_reward_cents: avg(|t| t.cash_reward_cents),
        card_reward_cents: avg(|t| t.card_reward_cents),
        goal_excluded_cents: avg(|t| t.goal_excluded_cents),
        allowance_cents: avg(|t| t.allowance_cents),
        budget_cents: avg(|t| t.budget_cents),
        remaining_cents: avg(|t| t.remaining_cents),
        savings_contribution_cents: avg(|t| t.savings_contribution_cents),
        categories: categories.into_values().collect(),
    })
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let mut stmt=conn.prepare("SELECT month,revision,closed_at,snapshot_json,snapshot_hash,fingerprint FROM month_closes").map_err(err)?;
    let mut q = stmt.query([]).map_err(err)?;
    while let Some(r) = q.next().map_err(err)? {
        let month: String = r.get(0).map_err(err)?;
        validate_month(&month)?;
        let serialized: String = r.get(3).map_err(err)?;
        let expected: String = r.get(4).map_err(err)?;
        let snap: ClosedSnapshot = serde_json::from_str(&serialized).map_err(err)?;
        chrono::DateTime::parse_from_rfc3339(&r.get::<_, String>(2).map_err(err)?).map_err(err)?;
        if r.get::<_, i64>(1).map_err(err)? < 1
            || hash(&serialized) != expected
            || r.get::<_, String>(5).map_err(err)?.len() != 64
            || snap.totals.spent_cents - snap.totals.goal_excluded_cents
                != snap.totals.allowance_cents
            || snap
                .totals
                .categories
                .iter()
                .map(|c| c.spent_cents)
                .sum::<i64>()
                != snap.totals.spent_cents
        {
            return Err("Backup contains an invalid month-close snapshot.".into());
        }
    }
    let mut receipts = conn
        .prepare("SELECT id,payload_hash,month FROM close_receipts")
        .map_err(err)?;
    let mut q = receipts.query([]).map_err(err)?;
    while let Some(r) = q.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?).map_err(err)?;
        validate_month(&r.get::<_, String>(2).map_err(err)?)?;
        let h: String = r.get(1).map_err(err)?;
        if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid month-close operation receipt.".into());
        }
    }
    verify_locked(conn)
}
