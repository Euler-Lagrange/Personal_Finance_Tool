use super::*;
use crate::imports::parse;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoalInput {
    pub id: String,
    pub revision: i64,
    pub name: String,
    pub account_id: String,
    pub target: String,
    pub target_date: Option<String>,
    pub monthly: String,
    pub policy: String,
    pub archived: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub revision: i64,
    pub name: String,
    pub account_id: String,
    pub account_name: String,
    pub account_archived: bool,
    pub target_cents: i64,
    pub target_date: Option<String>,
    pub monthly_cents: i64,
    pub policy: String,
    pub archived: bool,
    pub balance: Option<Balance>,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FundingInput {
    pub id: String,
    pub line_id: String,
    pub goal_id: String,
    pub goal_revision: i64,
    pub amount: String,
    pub withdrawal_id: Option<String>,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FundingRequest {
    pub id: String,
    pub event_id: String,
    pub revision: i64,
    pub confirmed: bool,
    pub rows: Vec<FundingInput>,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Funding {
    pub id: String,
    pub event_id: String,
    pub line_id: String,
    pub goal_id: String,
    pub amount_cents: i64,
    pub policy: String,
    pub withdrawal_id: Option<String>,
    pub reviewed: bool,
    pub reason: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Withdrawal {
    pub id: String,
    pub goal_id: String,
    pub date: String,
    pub description: String,
    pub amount_cents: i64,
    pub available_cents: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FundingView {
    pub entry: Entry,
    pub rows: Vec<Funding>,
    pub withdrawals: Vec<Withdrawal>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub revision: i64,
    pub date: String,
    pub description: String,
    pub change_cents: i64,
    pub purpose: String,
    pub can_label_interest: bool,
}

fn date(value: &str) -> Result<()> {
    if value.len() != 10
        || !("1900-01-01"..="2100-12-31").contains(&value)
        || NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err()
    {
        return Err("Choose a valid goal date.".into());
    }
    Ok(())
}
fn account(conn: &Connection, id: &str) -> Result<Account> {
    conn.query_row(
        "SELECT id,name,kind,revision,archived,tracking_mode FROM accounts WHERE id=?1",
        [id],
        |r| {
            Ok(Account {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                revision: r.get(3)?,
                archived: r.get(4)?,
                tracking_mode: r.get(5)?,
                activity_cents: 0,
                balance: None,
            })
        },
    )
    .map_err(|_| "Choose an existing savings account.".into())
}
fn rows(conn: &Connection, event: Option<&str>) -> Result<Vec<Funding>> {
    let mut stmt=conn.prepare("SELECT id,event_id,line_id,goal_id,amount_cents,policy,withdrawal_id,reviewed FROM goal_funding WHERE ?1 IS NULL OR event_id=?1 ORDER BY id").map_err(err)?;
    let result = stmt
        .query_map([event], |r| {
            Ok(Funding {
                id: r.get(0)?,
                event_id: r.get(1)?,
                line_id: r.get(2)?,
                goal_id: r.get(3)?,
                amount_cents: r.get(4)?,
                policy: r.get(5)?,
                withdrawal_id: r.get(6)?,
                reviewed: r.get(7)?,
                reason: String::new(),
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(result)
}

// Allocation validates the physical source separately from budget treatment. A
// missing source is a saved review task; a contradictory or overused source is rejected.
fn source(conn: &Connection, f: &Funding) -> Result<Option<(String, String)>> {
    let (goal_account,_purchase_date,purchase_account):(String,String,Option<String>)=conn.query_row(
        "SELECT g.account_id,e.date,e.account_id FROM savings_goals g JOIN events e ON e.id=?2 WHERE g.id=?1",params![f.goal_id,f.event_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
    let evidence = if let Some(withdrawal) = &f.withdrawal_id {
        let valid:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM events e JOIN accounts d ON d.id=e.destination_account_id WHERE e.id=?1 AND e.account_id=?2 AND e.date<=?3 AND ((e.kind='transfer' AND d.kind='checking') OR (e.kind='card_payment' AND e.destination_account_id IS ?4)))",params![withdrawal,goal_account,Local::now().format("%Y-%m-%d").to_string(),purchase_account],|r|r.get(0)).map_err(err)?;
        if !valid {
            return Err("Funding needs an actual withdrawal to checking or a payment from this goal to the purchase card.".into());
        }
        let (used,total):(i64,i64)=conn.query_row("SELECT COALESCE(SUM(f.amount_cents),0),e.amount_cents FROM events e LEFT JOIN goal_funding f ON f.withdrawal_id=e.id WHERE e.id=?1 GROUP BY e.id",[withdrawal],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
        if used > total {
            return Err("This savings withdrawal is already allocated. Funding cannot exceed the actual withdrawal.".into());
        }
        withdrawal
    } else if purchase_account.as_deref() == Some(&goal_account) {
        &f.event_id
    } else {
        return Ok(None);
    };
    let effective:String=conn.query_row("SELECT COALESCE(d.date,e.date) FROM events e LEFT JOIN effective_activity_dates d ON d.event_id=e.id AND d.account_id=?2 WHERE e.id=?1",params![evidence,goal_account],|r|r.get(0)).map_err(err)?;
    Ok(Some((goal_account, effective)))
}
fn basis_reason(conn: &Connection, f: &Funding) -> Result<String> {
    let Some((id, through)) = source(conn, f)? else {
        return Ok(
            "Link the actual savings withdrawal, or pay directly from this goal account.".into(),
        );
    };
    let a = account(conn, &id)?;
    let Some(balance) = balances::balance(conn, &a, &through)? else {
        return Ok("Add a known account balance on or before the funding date, then recheck this assignment.".into());
    };
    if balance.estimated_cents < 0 {
        return Ok("Known savings activity leaves insufficient funds on the funding date. Correct or confirm the account balance.".into());
    }
    let held:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM import_rows r JOIN import_sources s ON s.id=r.source_id WHERE s.account_id=?1 AND s.dismissed=0 AND r.disposition='pending' AND COALESCE(json_extract(r.candidate_json,'$.status'),'')!='pending' AND (json_extract(r.candidate_json,'$.date') IS NULL OR (json_extract(r.candidate_json,'$.date')>?2 AND json_extract(r.candidate_json,'$.date')<=?3)))",params![id,balance.checkpoint_date,through],|r|r.get(0)).map_err(err)?;
    if held {
        return Ok(
            "Resolve held savings activity between the balance checkpoint and funding date.".into(),
        );
    }
    Ok(String::new())
}
fn reviewed_rows(conn: &Connection, event: Option<&str>) -> Result<Vec<Funding>> {
    let mut result = rows(conn, event)?;
    for f in &mut result {
        f.reason = basis_reason(conn, f)?;
        if f.reason.is_empty() && !f.reviewed {
            f.reason =
                "Recheck and save this funding assignment before using its goal budget.".into();
        }
    }
    Ok(result)
}
impl Store {
    pub fn goals(&self) -> Result<Vec<Goal>> {
        let mut stmt=self.conn.prepare("SELECT g.id,g.revision,g.name,g.account_id,g.target_cents,g.target_date,g.monthly_cents,g.policy,g.archived,a.name,a.archived FROM savings_goals g JOIN accounts a ON a.id=g.account_id ORDER BY g.archived,g.name,g.id").map_err(err)?;
        let mut result = stmt
            .query_map([], |r| {
                Ok(Goal {
                    id: r.get(0)?,
                    revision: r.get(1)?,
                    name: r.get(2)?,
                    account_id: r.get(3)?,
                    target_cents: r.get(4)?,
                    target_date: r.get(5)?,
                    monthly_cents: r.get(6)?,
                    policy: r.get(7)?,
                    archived: r.get(8)?,
                    account_name: r.get(9)?,
                    account_archived: r.get(10)?,
                    balance: None,
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        for g in &mut result {
            g.balance = balances::balance(
                &self.conn,
                &account(&self.conn, &g.account_id)?,
                &Local::now().format("%Y-%m-%d").to_string(),
            )?;
        }
        Ok(result)
    }
    pub fn save_goal(&mut self, mut input: GoalInput) -> Result<()> {
        Uuid::parse_str(&input.id).map_err(|_| "Invalid goal identifier.")?;
        input.name = input.name.trim().into();
        if input.name.is_empty()
            || input.name.chars().count() > 100
            || input.name.chars().any(char::is_control)
            || !["goal_only", "count_monthly"].contains(&input.policy.as_str())
        {
            return Err(
                "Give the goal a name under 100 characters and choose its allowance policy.".into(),
            );
        }
        let target = money::cents(&input.target)?;
        let monthly = money::cents(&input.monthly)?;
        if target == 0 {
            return Err("Enter a goal target greater than zero.".into());
        }
        if let Some(d) = &input.target_date {
            date(d)?;
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let old: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,account_id FROM savings_goals WHERE id=?1",
                [&input.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if old.as_ref().map_or(0, |r| r.0) != input.revision {
            return Err("This goal changed. Reopen it before saving.".into());
        }
        if old.as_ref().is_some_and(|r| r.1 != input.account_id) {
            return Err("A saved goal stays attached to its account. Create a different goal for another account.".into());
        }
        let a = account(&tx, &input.account_id)?;
        if a.kind != "savings" || (old.is_none() && (a.archived || input.archived)) {
            return Err("New goals require an active savings account.".into());
        }
        let duplicate:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM savings_goals WHERE id!=?1 AND (account_id=?2 OR name=?3 COLLATE NOCASE))",params![input.id,input.account_id,input.name],|r|r.get(0)).map_err(err)?;
        if duplicate {
            return Err(
                "Each goal needs its own name and separate account. Check archived goals too."
                    .into(),
            );
        }
        tx.execute("INSERT INTO savings_goals VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,name=excluded.name,target_cents=excluded.target_cents,target_date=excluded.target_date,monthly_cents=excluded.monthly_cents,policy=excluded.policy,archived=excluded.archived",params![input.id,input.revision+1,input.name,input.account_id,target,input.target_date,monthly,input.policy,input.archived]).map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('goal',?1)",
            [serde_json::to_string(&input).map_err(err)?],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
    pub fn funding_view(&self, event: &str) -> Result<FundingView> {
        let entry = self
            .entries(None)?
            .into_iter()
            .find(|e| e.id == event && matches!(e.kind.as_str(), "expense" | "debt_payment"))
            .ok_or("Choose a recorded purchase with confirmed sharing.")?;
        let mut stmt=self.conn.prepare("SELECT e.id,g.id,e.date,e.description,e.amount_cents,e.amount_cents-COALESCE((SELECT SUM(amount_cents) FROM goal_funding f WHERE f.withdrawal_id=e.id AND f.event_id!=?1),0) FROM events e JOIN savings_goals g ON g.account_id=e.account_id WHERE e.date<=?2 AND ((e.kind='transfer' AND (SELECT kind FROM accounts WHERE id=e.destination_account_id)='checking') OR (e.kind='card_payment' AND e.destination_account_id IS ?3)) ORDER BY e.date DESC,e.rowid DESC").map_err(err)?;
        let withdrawals = stmt
            .query_map(
                params![
                    event,
                    Local::now().format("%Y-%m-%d").to_string(),
                    entry.account_id
                ],
                |r| {
                    Ok(Withdrawal {
                        id: r.get(0)?,
                        goal_id: r.get(1)?,
                        date: r.get(2)?,
                        description: r.get(3)?,
                        amount_cents: r.get(4)?,
                        available_cents: r.get(5)?,
                    })
                },
            )
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        Ok(FundingView {
            entry,
            rows: reviewed_rows(&self.conn, Some(event))?,
            withdrawals,
        })
    }
    pub fn save_funding(&mut self, request: FundingRequest) -> Result<()> {
        Uuid::parse_str(&request.id).map_err(|_| "Invalid funding operation.")?;
        if !request.confirmed || request.rows.len() > 100 {
            return Err(
                "Confirm up to 100 funding assignments against your savings activity.".into(),
            );
        }
        let hash = parse::hash(serde_json::to_string(&request).map_err(err)?.as_bytes());
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let prior: Option<String> = tx
            .query_row(
                "SELECT payload_hash FROM goal_funding_receipts WHERE id=?1",
                [&request.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(prior) = prior {
            return if prior == hash {
                Ok(())
            } else {
                Err("Funding choices changed. Start a new review operation.".into())
            };
        }
        let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE id=?1 AND revision=?2 AND kind IN ('expense','debt_payment') AND date<=?3)",params![request.event_id,request.revision,Local::now().format("%Y-%m-%d").to_string()],|r|r.get(0)).map_err(err)?;
        if !valid {
            return Err(
                "Purchase changed or is not a completed purchase. Reopen its funding review."
                    .into(),
            );
        }
        let refunded: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM events WHERE original_event_id=?1)",
                [&request.event_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if refunded {
            return Err("This purchase has refunds. Remove its refunds before changing the original funding policy.".into());
        }
        let old = rows(&tx, Some(&request.event_id))?;
        tx.execute(
            "DELETE FROM goal_funding WHERE event_id=?1",
            [&request.event_id],
        )
        .map_err(err)?;
        let mut ids = HashSet::new();
        let mut totals = HashMap::<String, i64>::new();
        let lines = lines::read(&tx, &request.event_id)?;
        for input in &request.rows {
            Uuid::parse_str(&input.id).map_err(|_| "Invalid funding identifier.")?;
            if !ids.insert(&input.id) {
                return Err("A funding row was selected twice.".into());
            }
            let amount = money::cents(&input.amount)?;
            let line = lines
                .iter()
                .find(|l| l.id == input.line_id)
                .ok_or("Choose an original purchase line for this funding.")?;
            let total = totals.entry(input.line_id.clone()).or_default();
            *total += amount;
            if amount == 0 || *total > line.jacob_cents {
                return Err("Funding cannot exceed Jacob's share of a purchase line.".into());
            }
            let (revision,policy,archived,account_archived):(i64,String,bool,bool)=tx.query_row("SELECT g.revision,g.policy,g.archived,a.archived FROM savings_goals g JOIN accounts a ON a.id=g.account_id WHERE g.id=?1",[&input.goal_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|_|"Choose an existing savings goal.")?;
            if revision != input.goal_revision {
                return Err("Goal settings changed. Reload the funding review.".into());
            }
            let previous = old
                .iter()
                .find(|f| f.id == input.id && f.goal_id == input.goal_id);
            if (archived || account_archived) && previous.is_none() {
                return Err("Restore this goal and account before adding new funding.".into());
            }
            let policy = previous.map_or(policy.as_str(), |f| f.policy.as_str());
            tx.execute(
                "INSERT INTO goal_funding VALUES (?1,?2,?3,?4,?5,?6,?7,0)",
                params![
                    input.id,
                    request.event_id,
                    input.line_id,
                    input.goal_id,
                    amount,
                    policy,
                    input.withdrawal_id
                ],
            )
            .map_err(err)?;
        }
        for f in rows(&tx, Some(&request.event_id))? {
            let reviewed = basis_reason(&tx, &f)?.is_empty();
            tx.execute(
                "UPDATE goal_funding SET reviewed=?2 WHERE id=?1",
                params![f.id, reviewed],
            )
            .map_err(err)?;
        }
        tx.execute(
            "UPDATE events SET revision=revision+1 WHERE id=?1",
            [&request.event_id],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO goal_funding_receipts VALUES (?1,?2,?3)",
            params![request.id, hash, request.event_id],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(event_id,action,payload) VALUES (?1,'goal_funding',?2)",
            params![
                request.event_id,
                serde_json::to_string(&request).map_err(err)?
            ],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
    pub fn goal_activity(&self, goal: &str) -> Result<Vec<Activity>> {
        let mut stmt=self.conn.prepare("SELECT e.id,e.revision,COALESCE(d.date,e.date),e.description,a.change_cents,e.kind,e.account_id,g.account_id,EXISTS(SELECT 1 FROM goal_interest i WHERE i.event_id=e.id AND i.goal_id=g.id),EXISTS(SELECT 1 FROM savings_goals h WHERE h.id!=g.id AND h.account_id=CASE WHEN e.account_id=g.account_id THEN e.destination_account_id ELSE e.account_id END) FROM savings_goals g JOIN account_activity a ON a.account_id=g.account_id JOIN events e ON e.id=a.event_id LEFT JOIN effective_activity_dates d ON d.event_id=e.id AND d.account_id=g.account_id WHERE g.id=?1 ORDER BY COALESCE(d.date,e.date) DESC,e.rowid DESC").map_err(err)?;
        let result = stmt
            .query_map([goal], |r| {
                let kind: String = r.get(5)?;
                let outgoing =
                    r.get::<_, Option<String>>(6)?.as_ref() == Some(&r.get::<_, String>(7)?);
                let purpose = match kind.as_str() {
                    "transfer" if r.get::<_, bool>(9)? => "Between goals",
                    "transfer" if outgoing => "Withdrawal",
                    "transfer" => "Contribution",
                    "income" if r.get::<_, bool>(8)? => "Interest",
                    "income" => "Income / deposit",
                    "expense" | "debt_payment" => "Purchase / debt",
                    "refund" => "Refund received",
                    "card_payment" => "Card payment",
                    "unclassified" => "Awaiting classification",
                    _ => "Account activity",
                };
                Ok(Activity {
                    id: r.get(0)?,
                    revision: r.get(1)?,
                    date: r.get(2)?,
                    description: r.get(3)?,
                    change_cents: r.get(4)?,
                    purpose: purpose.into(),
                    can_label_interest: kind == "income",
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        Ok(result)
    }
    pub fn label_goal_interest(
        &mut self,
        goal: &str,
        event: &str,
        revision: i64,
        interest: bool,
    ) -> Result<()> {
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM events e JOIN savings_goals g ON g.account_id=e.account_id WHERE e.id=?1 AND e.revision=?2 AND e.kind='income' AND g.id=?3)",params![event,revision,goal],|r|r.get(0)).map_err(err)?;
        if !valid {
            return Err("Choose an unchanged income deposit in this savings account.".into());
        }
        tx.execute("DELETE FROM goal_interest WHERE event_id=?1", [event])
            .map_err(err)?;
        if interest {
            tx.execute(
                "INSERT INTO goal_interest VALUES (?1,?2)",
                params![event, goal],
            )
            .map_err(err)?;
        }
        tx.execute("UPDATE events SET revision=revision+1 WHERE id=?1", [event])
            .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(event_id,action,payload) VALUES (?1,'goal_interest',?2)",
            params![event, format!("{goal}:{interest}")],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}

#[derive(Default)]
pub(super) struct Projection {
    pub exclusions: HashMap<String, i64>,
    pub pending: i64,
    pub pending_events: HashSet<String>,
}
pub(super) fn projection(conn: &Connection, month: &str) -> Result<Projection> {
    let mut result = Projection::default();
    let mut funded = HashMap::<(String, String), i64>::new();
    for f in reviewed_rows(conn, None)? {
        let purchase_date: String = conn
            .query_row("SELECT COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7)) FROM events e WHERE id=?1", [&f.event_id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        if !f.reason.is_empty() {
            let affects_refund: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM events e JOIN event_lines l ON l.event_id=e.id WHERE e.original_event_id=?1 AND l.original_line_id=?2 AND l.jacob_cents>0 AND COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7))=?3)",params![f.event_id,f.line_id,month],|r|r.get(0)).map_err(err)?;
            if &purchase_date[..7] == month || affects_refund {
                result.pending += 1;
                result.pending_events.insert(f.event_id.clone());
            }
            continue;
        }
        if f.policy == "goal_only" {
            *funded.entry((f.event_id, f.line_id)).or_default() += f.amount_cents;
        }
    }
    for ((event, line), funded) in funded {
        let (category,jacob,purchase_date):(String,i64,String)=conn.query_row("SELECT l.category_id,l.jacob_cents,COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7)) FROM event_lines l JOIN events e ON e.id=l.event_id WHERE l.event_id=?1 AND l.id=?2",params![event,line],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
        if &purchase_date[..7] == month {
            *result.exclusions.entry(category.clone()).or_default() += funded;
        }
        // Cumulative personal-share reversal cannot create more allowance room than
        // the actual refund. Combining goal-only allocations avoids per-goal penny drift.
        let mut stmt=conn.prepare("SELECT COALESCE((SELECT month FROM budget_period_overrides o WHERE o.event_id=e.id),substr(e.date,1,7)),l.jacob_cents FROM events e JOIN event_lines l ON l.event_id=e.id WHERE e.original_event_id=?1 AND l.original_line_id=?2 ORDER BY e.rowid").map_err(err)?;
        let mut refunds = stmt.query(params![event, line]).map_err(err)?;
        let (mut total, mut previous) = (0, 0);
        while let Some(r) = refunds.next().map_err(err)? {
            let date: String = r.get(0).map_err(err)?;
            total += r.get::<_, i64>(1).map_err(err)?;
            let target =
                ((total as i128 * funded as i128 + jacob as i128 / 2) / jacob as i128) as i64;
            if &date[..7] == month {
                *result.exclusions.entry(category.clone()).or_default() -= target - previous;
            }
            previous = target;
        }
    }
    Ok(result)
}
pub(super) fn protect_delete(conn: &Connection, id: &str) -> Result<()> {
    let linked: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM goal_funding WHERE event_id=?1 OR withdrawal_id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if linked {
        return Err("This entry supports goal funding. Remove its funding assignments before deleting or undoing it.".into());
    }
    Ok(())
}
pub(super) fn protect_entry(
    conn: &Connection,
    input: &EntryInput,
    allocated: &[EntryLine],
) -> Result<()> {
    let linked: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM goal_funding WHERE event_id=?1 OR withdrawal_id=?1)",
            [&input.id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if linked {
        let same:bool=conn.query_row("SELECT kind=?2 AND date=?3 AND amount_cents=?4 AND payer=?5 AND account_id IS ?6 AND destination_account_id IS ?7 AND category_id IS ?8 AND split_mode=?9 AND split_value=?10 FROM events WHERE id=?1",params![input.id,input.kind,input.date,money::cents(&input.amount)?,input.payer,input.account_id,input.destination_account_id,input.category_id,input.split_mode,input.split_value],|r|r.get(0)).map_err(err)?;
        if !same || lines::read(conn, &input.id)? != allocated {
            return Err("Goal funding protects this entry's money, dates and allocations. Remove its funding assignments first; description and notes remain editable.".into());
        }
    }
    let invalid_interest:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM goal_interest i JOIN savings_goals g ON g.id=i.goal_id WHERE i.event_id=?1 AND (?2!='income' OR g.account_id IS NOT ?3))",params![input.id,input.kind,input.account_id],|r|r.get(0)).map_err(err)?;
    if invalid_interest {
        return Err(
            "Remove the interest label before moving this income to another account.".into(),
        );
    }
    Ok(())
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let mut stmt=conn.prepare("SELECT g.id,g.revision,g.name,g.target_cents,g.target_date,g.monthly_cents,g.policy,a.kind FROM savings_goals g JOIN accounts a ON a.id=g.account_id").map_err(err)?;
    let mut goals = stmt.query([]).map_err(err)?;
    while let Some(r) = goals.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?)
            .map_err(|_| "Invalid backup goal identifier.")?;
        let name: String = r.get(2).map_err(err)?;
        let target: i64 = r.get(3).map_err(err)?;
        let monthly: i64 = r.get(5).map_err(err)?;
        if r.get::<_, i64>(1).map_err(err)? < 1
            || name.trim().is_empty()
            || name.chars().count() > 100
            || name.chars().any(char::is_control)
            || !(1..=money::MAX_CENTS).contains(&target)
            || !(0..=money::MAX_CENTS).contains(&monthly)
            || !["goal_only", "count_monthly"]
                .contains(&r.get::<_, String>(6).map_err(err)?.as_str())
            || r.get::<_, String>(7).map_err(err)? != "savings"
        {
            return Err("Backup has invalid savings goal settings.".into());
        }
        if let Some(d) = r.get::<_, Option<String>>(4).map_err(err)? {
            date(&d)?;
        }
    }
    let invalid:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM goal_funding f LEFT JOIN event_lines l ON l.event_id=f.event_id AND l.id=f.line_id JOIN events e ON e.id=f.event_id WHERE e.kind NOT IN ('expense','debt_payment') OR l.id IS NULL OR f.amount_cents<=0 OR f.policy NOT IN ('goal_only','count_monthly') OR f.reviewed NOT IN (0,1) OR (SELECT SUM(x.amount_cents) FROM goal_funding x WHERE x.event_id=f.event_id AND x.line_id=f.line_id)>l.jacob_cents) OR EXISTS(SELECT 1 FROM goal_interest i JOIN savings_goals g ON g.id=i.goal_id JOIN events e ON e.id=i.event_id WHERE e.kind!='income' OR e.account_id IS NOT g.account_id)",[],|r|r.get(0)).map_err(err)?;
    if invalid {
        return Err(
            "Backup goal funding or interest labels do not match the recorded activity.".into(),
        );
    }
    for f in rows(conn, None)? {
        Uuid::parse_str(&f.id).map_err(|_| "Invalid backup funding identifier.")?;
        source(conn, &f)?;
    }
    let mut stmt = conn
        .prepare("SELECT id,payload_hash FROM goal_funding_receipts")
        .map_err(err)?;
    let mut receipts = stmt.query([]).map_err(err)?;
    while let Some(r) = receipts.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?)
            .map_err(|_| "Invalid backup funding receipt.")?;
        let hash: String = r.get(1).map_err(err)?;
        if hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("Invalid backup funding receipt hash.".into());
        }
    }
    Ok(())
}
