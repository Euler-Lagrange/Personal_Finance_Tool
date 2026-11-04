use super::*;
use crate::imports::{
    parse,
    types::{Candidate, Decision},
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub direction: String,
    pub verified_expense: bool,
    pub category_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind_hint: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeCode {
    pub code: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub ordinary_card_charges: bool,
    pub ownership: String,
    pub types: Vec<TypeCode>,
}
impl Policy {
    pub fn validate(&self) -> Result<()> {
        if !["personal", "shared", "ask"].contains(&self.ownership.as_str())
            || self.types.len() > 100
        {
            return Err(
                "Choose an import sharing default and at most 100 source type codes.".into(),
            );
        }
        let mut codes = HashSet::new();
        for t in &self.types {
            if t.code.is_empty()
                || t.code.len() > 200
                || !codes.insert(&t.code)
                || ![
                    "expense",
                    "reward",
                    "income",
                    "ask",
                    "card_payment",
                    "transfer",
                ]
                .contains(&t.kind.as_str())
                || matches!(t.kind.as_str(), "card_payment" | "transfer") != t.account_id.is_some()
                || t.account_id
                    .as_ref()
                    .is_some_and(|id| id.is_empty() || id.len() > 100)
            {
                return Err(
                    "Source type codes must be unique exact values with supported treatments."
                        .into(),
                );
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub remember: bool,
    pub automatic: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub profile: String,
    pub policy: Policy,
    pub automatic: bool,
}
// The format, exact mapping, account and named download profile must all agree.
// Hints may populate the editor before coverage is confirmed, but never authorize writes.
fn profile_context(
    conn: &Connection,
    source: &str,
    allow_hint: bool,
) -> Result<Option<(String, String, String)>> {
    let (account, data, mapping, configured): (Option<String>,String,String,bool) = conn.query_row(
        "SELECT account_id,dataset_json,mapping_json,configured FROM import_sources WHERE id=?1", [source],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)?;
    let Some(account) = account.filter(|_| configured) else {
        return Ok(None);
    };
    let profile = if let Some(c) = identity::coverage(conn, source)? {
        c.input.profile
    } else if allow_hint {
        match observations::profile(conn, source)? {
            Some(p) => p.profile,
            None => return Ok(None),
        }
    } else {
        return Ok(None);
    };
    let layout = identity::layout_hash(
        &serde_json::from_str(&data).map_err(err)?,
        serde_json::from_str(&mapping).map_err(err)?,
    )?;
    Ok(Some((
        account,
        observations::profile_key(conn, source, &layout)?,
        profile,
    )))
}
pub(super) fn profile(
    conn: &Connection,
    source: &str,
    allow_hint: bool,
) -> Result<Option<Profile>> {
    let Some((account, layout, profile)) = profile_context(conn, source, allow_hint)? else {
        return Ok(None);
    };
    let saved: Option<(String,bool)> = conn.query_row(
        "SELECT policy_json,automatic FROM import_classification_profiles WHERE account_id=?1 AND layout_hash=?2 AND profile=?3",
        params![account,layout,profile], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
    saved
        .map(|(json, automatic)| {
            let policy: Policy = serde_json::from_str(&json).map_err(err)?;
            policy.validate()?;
            Ok(Profile {
                profile,
                policy,
                automatic,
            })
        })
        .transpose()
}
pub(super) fn remember(
    conn: &Connection,
    source: &str,
    policy: &Policy,
    preferences: &Preferences,
) -> Result<()> {
    if !preferences.remember {
        return Ok(());
    }
    policy.validate()?;
    let (account, layout, profile) = profile_context(conn, source, false)?
        .ok_or("Confirm the download range before saving reusable defaults.")?;
    conn.execute("INSERT INTO import_classification_profiles VALUES (?1,?2,?3,?4,?5) ON CONFLICT(account_id,layout_hash,profile) DO UPDATE SET policy_json=excluded.policy_json,automatic=excluded.automatic",
        params![account,layout,profile,serde_json::to_string(policy).map_err(err)?,preferences.automatic]).map_err(err)?;
    Ok(())
}

pub(super) fn policy(conn: &Connection, source: &str) -> Result<Option<Policy>> {
    let value: Option<String> = conn
        .query_row(
            "SELECT policy_json FROM import_classification WHERE source_id=?1",
            [source],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    value
        .map(|v| serde_json::from_str(&v).map_err(err))
        .transpose()
}
pub(super) fn pending(conn: &Connection, id: &str) -> Result<Option<Pending>> {
    conn.query_row(
        "SELECT direction,verified_expense,category_id,kind_hint FROM pending_activity WHERE event_id=?1",
        [id],
        |r| {
            Ok(Pending {
                direction: r.get(0)?,
                verified_expense: r.get(1)?,
                category_id: r.get(2)?,
                kind_hint: r.get(3)?,
            })
        },
    )
    .optional()
    .map_err(err)
}

// A classification never repairs a missing number, date, status, or uncertain OCR extraction.
pub(super) fn reliable(c: &Candidate) -> bool {
    c.posted_date.as_ref().is_none_or(|d| {
        d.len() == 10
            && NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok()
            && d <= &Local::now().format("%Y-%m-%d").to_string()
    }) && c.status == "posted"
        && c.currency == "USD"
        && c.warnings.is_empty()
        && c.amount_cents
            .is_some_and(|a| a > 0 && a <= money::MAX_CENTS)
        && c.date.as_ref().is_some_and(|d| {
            d.len() == 10
                && NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok()
                && d <= &Local::now().format("%Y-%m-%d").to_string()
        })
        && !c.description.trim().is_empty()
        && c.description.len() <= 200
        && ["in", "out"].contains(&c.direction.as_str())
}
pub(super) fn decisions(
    conn: &Connection,
    source: &str,
    plan: &identity::Plan,
    policy: &Policy,
) -> Result<Vec<Decision>> {
    let account: String = conn
        .query_row(
            "SELECT account_id FROM import_sources WHERE id=?1",
            [source],
            |r| r.get(0),
        )
        .map_err(err)?;
    payment_codes::validate_policy(conn, &account, policy)?;
    if identity::coverage(conn, source)?.is_none() {
        return Err(
            "Confirm the actual download range before processing verified activity.".into(),
        );
    }
    let mut stmt=conn.prepare("SELECT id,candidate_json FROM import_rows WHERE source_id=?1 AND disposition='pending' ORDER BY ordinal").map_err(err)?;
    let rows = stmt
        .query_map([source], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?;
    let mut result = Vec::new();
    for row in rows {
        let (id, raw) = row.map_err(err)?;
        let c: Candidate = serde_json::from_str(&raw).map_err(err)?;
        let item = plan.items.iter().find(|i| i.row_id == id);
        let mut linked = None;
        let action = if c.status == "pending" {
            "exclude"
        } else if item.is_some_and(|i| i.action == "link") {
            if !reliable(&c)
                || !payment_codes::date_compatible(
                    conn,
                    item.unwrap().event_id.as_deref().unwrap(),
                    &account,
                    &c,
                )?
            {
                continue;
            }
            "identity_link"
        } else if item.is_some_and(|i| i.action == "exclude") {
            "identity_exclude"
        } else if reliable(&c) && item.is_some_and(|i| i.action == "new" || i.code_match_allowed) {
            let new_identity = item.unwrap().action == "new";
            if let Some(m) = payment_codes::movement(conn, &account, &c, policy)? {
                match payment_codes::treatment(conn, &account, &c, &m, new_identity)? {
                    payment_codes::Treatment::New => "automatic",
                    payment_codes::Treatment::Link(target) => {
                        linked = Some(target);
                        "code_link"
                    }
                    payment_codes::Treatment::Hold => continue,
                }
            } else if new_identity {
                "automatic"
            } else {
                continue;
            }
        } else {
            continue;
        };
        result.push(Decision {
            row_id: id,
            action: action.into(),
            input: None,
            match_id: linked.as_ref().map(|m| m.id.clone()),
            match_revision: linked.map(|m| m.revision),
            confirmed: true,
            separate: true,
            rule_signature: None,
        });
    }
    let mut targets: HashMap<String, usize> = HashMap::new();
    for d in &result {
        if d.action == "code_link" {
            *targets.entry(d.match_id.clone().unwrap()).or_default() += 1;
        }
    }
    result.retain(|d| d.action != "code_link" || targets[d.match_id.as_ref().unwrap()] == 1);
    Ok(result)
}
pub(super) fn classify(
    conn: &Connection,
    account: &str,
    account_kind: &str,
    id: &str,
    c: &Candidate,
    policy: &Policy,
    rules: &[rules::Rule],
) -> Result<(EntryInput, Option<Pending>)> {
    if !reliable(c) {
        return Err("This source row needs review before recording account activity.".into());
    }
    if let Some(movement) = payment_codes::movement(conn, account, c, policy)? {
        return payment_codes::record_input(conn, account, id, c, &movement);
    }
    let s = rules::suggest_for(conn, rules, account, c, None, &policy.ownership)?;
    // Explicit source codes outrank the card default. Unknown/nonpurchase codes never become spending.
    let code = policy.types.iter().find(|t| t.code == c.source_type);
    let kind = code.map(|t| t.kind.as_str()).unwrap_or_else(|| {
        if policy.ordinary_card_charges
            && account_kind == "credit"
            && c.direction == "out"
            && c.source_type.trim().is_empty()
        {
            "expense"
        } else {
            "ask"
        }
    });
    let kind = match (kind, c.direction.as_str(), account_kind) {
        ("expense", "out", _) => "expense",
        ("reward", "in", _) => "reward",
        ("income", "in", "checking" | "savings") => "income",
        _ => "unclassified",
    };
    let ask = s.ownership_ask || (!s.ownership_set && policy.ownership == "ask");
    let category =
        if s.category_ask { None } else { s.category_id }.unwrap_or_else(|| "uncategorized".into());
    let pending = if kind == "unclassified" || (kind == "expense" && ask) {
        Some(Pending {
            direction: c.direction.clone(),
            verified_expense: kind == "expense",
            category_id: (kind == "expense").then_some(category.clone()),
            kind_hint: None,
        })
    } else {
        None
    };
    let amount = c.amount_cents.unwrap();
    let input = EntryInput {
        budget_override: None,
        id: id.into(),
        revision: 0,
        kind: if pending.is_some() {
            "unclassified"
        } else {
            kind
        }
        .into(),
        date: c.date.clone().unwrap(),
        description: c.description.trim().into(),
        amount: format!("{}.{:02}", amount / 100, amount % 100),
        payer: "jacob".into(),
        category_id: (kind == "expense" && pending.is_none()).then_some(category),
        account_id: Some(account.into()),
        destination_account_id: None,
        split_mode: if kind == "expense" && s.ownership_set {
            s.split_mode
        } else if kind == "expense" && !ask {
            policy.ownership.clone()
        } else {
            "none".into()
        },
        split_value: if kind == "expense" && s.ownership_set {
            s.split_value
        } else {
            String::new()
        },
        note: String::new(),
        original_event_id: None,
        lines: Vec::new(),
        paypal: None,
    };
    Ok((input, pending))
}
pub(super) fn record(
    tx: &rusqlite::Transaction<'_>,
    input: &EntryInput,
    p: &Pending,
    account_kind: &str,
) -> Result<()> {
    if input.budget_override.is_some() {
        return Err("Classify the transaction before choosing a budget-period override.".into());
    }
    let amount = money::cents(&input.amount)?;
    tx.execute("INSERT INTO events(id,revision,kind,date,description,amount_cents,payer,category_id,account_id,split_mode,split_value,jacob_cents,chelsea_cents,household_delta_cents,note) VALUES (?1,?6,'unclassified',?2,?3,?4,'jacob',NULL,?5,'none','',0,0,0,?7)",params![input.id,input.date,input.description,amount,input.account_id,input.revision+1,input.note]).map_err(err)?;
    tx.execute(
        "INSERT INTO pending_activity(event_id,direction,verified_expense,category_id,kind_hint) VALUES (?1,?2,?3,?4,?5)",
        params![input.id, p.direction, p.verified_expense, p.category_id, p.kind_hint],
    )
    .map_err(err)?;
    let change = if (p.direction == "out") == (account_kind == "credit") {
        amount
    } else {
        -amount
    };
    tx.execute(
        "INSERT INTO account_activity VALUES (?1,?2,?3)",
        params![input.id, input.account_id, change],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO audit(event_id,action,payload) VALUES (?1,'record_unclassified',?2)",
        params![input.id, serde_json::to_string(p).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}
fn payload(input: &EntryInput) -> Result<String> {
    Ok(parse::hash(
        serde_json::to_string(input).map_err(err)?.as_bytes(),
    ))
}
pub(super) fn retry(conn: &Connection, input: &EntryInput) -> Result<bool> {
    let prior:Option<(String,i64)>=conn.query_row("SELECT r.payload_hash,e.revision FROM activity_resolutions r JOIN events e ON e.id=r.event_id WHERE r.event_id=?1 AND r.prior_revision=?2",params![input.id,input.revision],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
    if let Some((hash, revision)) = prior {
        if hash != payload(input)? || revision != input.revision + 1 {
            return Err("This activity was already classified or edited. Reopen the entry.".into());
        }
        return Ok(true);
    }
    Ok(false)
}
pub(super) fn check_resolution(conn: &Connection, input: &EntryInput) -> Result<bool> {
    if input.kind == "unclassified" {
        return Err("Use verified imports to record unclassified activity.".into());
    }
    let Some(p) = pending(conn, &input.id)? else {
        return Ok(false);
    };
    let (revision,date,amount,account,kind):(i64,String,i64,String,String)=conn.query_row("SELECT e.revision,e.date,e.amount_cents,e.account_id,a.kind FROM events e JOIN accounts a ON a.id=e.account_id WHERE e.id=?1 AND e.kind='unclassified'",[&input.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(err)?;
    if revision != input.revision
        || date != input.date
        || amount != money::cents(&input.amount)?
        || imports::event_direction(input, &account, &kind)? != p.direction
    {
        return Err("Classification must preserve the verified account, date, amount and direction. Refresh the activity before continuing.".into());
    }
    // Avoid manufacturing a second opposite leg while another import already records it.
    // Linking/merging those independently imported legs is a separate, explicit review step.
    if matches!(input.kind.as_str(), "transfer" | "card_payment") {
        let other = if input.account_id.as_deref() == Some(&account) {
            input.destination_account_id.as_deref()
        } else {
            input.account_id.as_deref()
        }
        .ok_or("Choose both accounts.")?;
        let duplicates:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM account_activity a JOIN events e ON e.id=a.event_id WHERE a.account_id=?1 AND e.id!=?2 AND e.amount_cents=?3 AND abs(julianday(e.date)-julianday(?4))<=3)",params![other,input.id,amount,date],|r|r.get(0)).map_err(err)?;
        if duplicates {
            return Err("The other account already has possible matching activity. Keep this item awaiting review until the two records can be reconciled together.".into());
        }
    }
    Ok(true)
}
pub(super) fn finish_resolution(tx: &rusqlite::Transaction<'_>, input: &EntryInput) -> Result<()> {
    tx.execute(
        "DELETE FROM pending_activity WHERE event_id=?1",
        [&input.id],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO activity_resolutions VALUES (?1,?2,?3)",
        params![input.id, input.revision, payload(input)?],
    )
    .map_err(err)?;
    Ok(())
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let invalid:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM events e LEFT JOIN pending_activity p ON p.event_id=e.id WHERE (e.kind='unclassified')!=(p.event_id IS NOT NULL) OR (e.kind='unclassified' AND (e.payer!='jacob' OR e.account_id IS NULL OR e.household_delta_cents!=0 OR e.jacob_cents!=0 OR e.chelsea_cents!=0 OR e.category_id IS NOT NULL OR e.split_mode!='none' OR e.split_value!='' OR NOT EXISTS(SELECT 1 FROM import_rows r WHERE r.event_id=e.id))))",[],|r|r.get(0)).map_err(err)?;
    if invalid {
        return Err(
            "Backup unclassified activity is inconsistent. Current data was not changed.".into(),
        );
    }
    let invalid_receipts:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM activity_resolutions r JOIN events e ON e.id=r.event_id WHERE r.prior_revision>=e.revision OR e.kind='unclassified' OR length(r.payload_hash)!=64)",[],|r|r.get(0)).map_err(err)?;
    if invalid_receipts {
        return Err("Backup activity resolution history is inconsistent.".into());
    }
    payment_codes::validate(conn)?;
    let mut stmt = conn
        .prepare("SELECT policy_json FROM import_classification UNION ALL SELECT policy_json FROM import_classification_profiles")
        .map_err(err)?;
    for row in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
        let p: Policy = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
        p.validate()?;
    }
    Ok(())
}

impl Store {
    pub fn activity_source(&self, event_id: &str) -> Result<crate::imports::types::SourceDetail> {
        let id: String = self
            .conn
            .query_row(
                "SELECT source_id FROM import_rows WHERE event_id=?1 ORDER BY rowid DESC LIMIT 1",
                [event_id],
                |r| r.get(0),
            )
            .map_err(|_| "No source is linked to this activity.")?;
        self.import_detail(&id)
    }
}
