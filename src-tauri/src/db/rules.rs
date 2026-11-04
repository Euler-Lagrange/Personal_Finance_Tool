use super::*;
use crate::imports::{parse, types::Candidate};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub revision: i64,
    pub name: String,
    pub merchant: String,
    pub match_mode: String,
    pub account_id: Option<String>,
    pub description_contains: String,
    #[serde(default = "any_scope", skip_serializing_if = "is_any_scope")]
    pub category_scope: String,
    pub category_action: String,
    pub category_id: Option<String>,
    pub ownership_action: String,
    pub split_mode: String,
    pub split_value: String,
    pub enabled: bool,
}
fn any_scope() -> String {
    "any".into()
}
fn is_any_scope(value: &str) -> bool {
    value == "any"
}
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub category_id: Option<String>,
    pub split_mode: String,
    pub split_value: String,
    pub category_ask: bool,
    pub ownership_ask: bool,
    pub ownership_set: bool,
    pub explanations: Vec<String>,
    pub signature: String,
    pub ready: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub count: usize,
    pub examples: Vec<String>,
}
pub fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn matches(r: &Rule, account: &str, description: &str) -> bool {
    let merchant = normalize(&r.merchant);
    let value = normalize(description);
    r.enabled
        && r.account_id.as_deref().is_none_or(|a| a == account)
        && (if r.match_mode == "exact" {
            value == merchant
        } else {
            value == merchant || value.starts_with(&format!("{merchant} "))
        })
        && (r.description_contains.is_empty()
            || value.contains(&normalize(&r.description_contains)))
}
fn score(r: &Rule) -> i32 {
    (if r.account_id.is_some() { 4 } else { 0 })
        + (if !r.description_contains.is_empty() {
            8
        } else {
            0
        })
        + (if r.match_mode == "exact" { 2 } else { 1 })
}
pub(super) fn list(conn: &Connection) -> Result<Vec<Rule>> {
    let mut stmt=conn.prepare("SELECT id,revision,name,merchant,match_mode,account_id,description_contains,category_action,category_id,ownership_action,split_mode,split_value,enabled,category_scope FROM merchant_rules ORDER BY name,id").map_err(err)?;
    let result = stmt
        .query_map([], |r| {
            Ok(Rule {
                id: r.get(0)?,
                revision: r.get(1)?,
                name: r.get(2)?,
                merchant: r.get(3)?,
                match_mode: r.get(4)?,
                account_id: r.get(5)?,
                description_contains: r.get(6)?,
                category_scope: r.get(13)?,
                category_action: r.get(7)?,
                category_id: r.get(8)?,
                ownership_action: r.get(9)?,
                split_mode: r.get(10)?,
                split_value: r.get(11)?,
                enabled: r.get(12)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err);
    result
}
fn validate_rule(conn: &Connection, r: &mut Rule) -> Result<()> {
    Uuid::parse_str(&r.id).map_err(|_| "Invalid rule identifier.")?;
    r.name = r.name.trim().into();
    r.merchant = normalize(&r.merchant);
    r.description_contains = normalize(&r.description_contains);
    if r.name.is_empty()
        || r.name.len() > 100
        || r.merchant.len() < 2
        || r.merchant.len() > 200
        || r.description_contains.len() > 200
    {
        return Err("Use a rule name under 100 characters and a merchant phrase between 2 and 200 characters.".into());
    }
    if !["exact", "prefix"].contains(&r.match_mode.as_str())
        || !["set", "leave", "ask"].contains(&r.category_action.as_str())
        || !["set", "leave", "ask"].contains(&r.ownership_action.as_str())
    {
        return Err("Choose valid rule matching and actions.".into());
    }
    if !["any", "personal", "shared", "chelsea"].contains(&r.category_scope.as_str())
        || (r.category_scope != "any"
            && (r.category_action == "leave" || r.ownership_action != "leave"))
    {
        return Err("A sharing-dependent category rule sets or asks for a category and leaves sharing unchanged.".into());
    }
    if let Some(account) = &r.account_id {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE id=?1)",
                [account],
                |v| v.get(0),
            )
            .map_err(err)?;
        if !exists {
            return Err("Choose an existing account.".into());
        }
    }
    if r.category_action == "set" {
        let id = r
            .category_id
            .as_deref()
            .ok_or("Choose a category for this rule.")?;
        let active: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1 AND archived=0)",
                [id],
                |v| v.get(0),
            )
            .map_err(err)?;
        if !active && r.enabled {
            return Err("Choose an active category or disable this rule.".into());
        }
    } else {
        r.category_id = None;
    }
    if r.ownership_action == "set" {
        if !["personal", "shared", "equal", "chelsea", "percent"].contains(&r.split_mode.as_str()) {
            return Err("Choose a supported ownership preset.".into());
        }
        money::allocation(10000, &r.split_mode, &r.split_value)?;
        if r.split_mode != "percent" {
            r.split_value.clear();
        }
    } else {
        r.split_mode.clear();
        r.split_value.clear();
    }
    if r.category_action == "leave" && r.ownership_action == "leave" {
        return Err("Choose at least one field to set or ask about.".into());
    }
    Ok(())
}
impl Store {
    pub fn list_rules(&self) -> Result<Vec<Rule>> {
        list(&self.conn)
    }
    pub fn preview_rule(&self, mut rule: Rule) -> Result<Preview> {
        validate_rule(&self.conn, &mut rule)?;
        let mut stmt=self.conn.prepare("SELECT s.name,s.account_id,r.candidate_json FROM import_rows r JOIN import_sources s ON s.id=r.source_id WHERE r.disposition='pending' AND s.dismissed=0 AND s.account_id IS NOT NULL").map_err(err)?;
        let mut rows = stmt.query([]).map_err(err)?;
        let mut preview = Preview {
            count: 0,
            examples: vec![],
        };
        while let Some(row) = rows.next().map_err(err)? {
            let account: String = row.get(1).map_err(err)?;
            let c: Candidate =
                serde_json::from_str(&row.get::<_, String>(2).map_err(err)?).map_err(err)?;
            if c.direction == "out" && matches(&rule, &account, &c.description) {
                preview.count += 1;
                if preview.examples.len() < 8 {
                    preview.examples.push(format!(
                        "{} · {}",
                        row.get::<_, String>(0).map_err(err)?,
                        c.description
                    ));
                }
            }
        }
        Ok(preview)
    }
    pub fn save_rule(&mut self, mut rule: Rule) -> Result<()> {
        validate_rule(&self.conn, &mut rule)?;
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let current: Option<i64> = tx
            .query_row(
                "SELECT revision FROM merchant_rules WHERE id=?1",
                [&rule.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if current.unwrap_or(0) != rule.revision {
            return Err("This rule changed. Reopen it before saving.".into());
        }
        rule.revision += 1;
        tx.execute("INSERT INTO merchant_rules(id,revision,name,merchant,match_mode,account_id,description_contains,category_action,category_id,ownership_action,split_mode,split_value,enabled,category_scope) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,name=excluded.name,merchant=excluded.merchant,match_mode=excluded.match_mode,account_id=excluded.account_id,description_contains=excluded.description_contains,category_action=excluded.category_action,category_id=excluded.category_id,ownership_action=excluded.ownership_action,split_mode=excluded.split_mode,split_value=excluded.split_value,enabled=excluded.enabled,category_scope=excluded.category_scope",params![rule.id,rule.revision,rule.name,rule.merchant,rule.match_mode,rule.account_id,rule.description_contains,rule.category_action,rule.category_id,rule.ownership_action,rule.split_mode,rule.split_value,rule.enabled,rule.category_scope]).map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('rule',?1)",
            [serde_json::to_string(&rule).map_err(err)?],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}
pub(super) fn suggest_for(
    conn: &Connection,
    rules: &[Rule],
    account: &str,
    c: &Candidate,
    selected: Option<(&str, &str)>,
    fallback: &str,
) -> Result<Suggestion> {
    let matched: Vec<_> = rules
        .iter()
        .filter(|r| matches(r, account, &c.description))
        .collect();
    let mut s = Suggestion {
        split_mode: "personal".into(),
        signature: parse::hash(serde_json::to_string(&matched).map_err(err)?.as_bytes()),
        ..Suggestion::default()
    };
    if c.direction != "out" {
        return Ok(s);
    }
    let ownership: Vec<_> = matched
        .iter()
        .filter(|r| r.ownership_action != "leave")
        .collect();
    let highest = ownership.iter().map(|r| score(r)).max();
    let top: Vec<_> = ownership
        .into_iter()
        .filter(|r| Some(score(r)) == highest)
        .collect();
    if let Some(first) = top.first() {
        s.ownership_ask = top.iter().any(|r| {
            r.ownership_action == "ask"
                || r.split_mode != first.split_mode
                || r.split_value != first.split_value
        });
        s.ownership_set = !s.ownership_ask;
        if !s.ownership_ask {
            s.split_mode = first.split_mode.clone();
            s.split_value = first.split_value.clone();
        }
        for r in &top {
            s.explanations
                .push(format!("Sharing: {} (v{})", r.name, r.revision));
        }
    }
    let ownership_has_rules = !top.is_empty();
    let effective = selected.unwrap_or_else(|| {
        if s.ownership_ask {
            ("ask", "")
        } else if s.ownership_set {
            (&s.split_mode, &s.split_value)
        } else {
            (fallback, "")
        }
    });
    let scope = sharing_scope(effective.0, effective.1, c.amount_cents)?;
    let categories: Vec<_> = matched
        .iter()
        .filter(|r| {
            r.category_action != "leave"
                && (r.category_scope == "any"
                    || scope.as_deref() == Some(r.category_scope.as_str()))
        })
        .collect();
    let highest = categories
        .iter()
        .map(|r| (score(r), r.category_scope != "any"))
        .max();
    let top: Vec<_> = categories
        .into_iter()
        .filter(|r| Some((score(r), r.category_scope != "any")) == highest)
        .collect();
    if let Some(first) = top.first() {
        s.category_ask = top
            .iter()
            .any(|r| r.category_action == "ask" || r.category_id != first.category_id);
        if !s.category_ask {
            s.category_id = first.category_id.clone();
        }
        for r in &top {
            s.explanations
                .push(format!("Category: {} (v{})", r.name, r.revision));
        }
    }
    if scope.is_none() {
        let general = matched
            .iter()
            .filter(|r| r.category_action != "leave" && r.category_scope == "any")
            .map(|r| score(r))
            .max();
        if matched.iter().any(|r| {
            r.category_action != "leave"
                && r.category_scope != "any"
                && general.is_none_or(|score_value| score(r) >= score_value)
        }) {
            s.category_id = None;
            s.category_ask = true;
            s.explanations
                .push("Choose sharing to resolve this merchant's category suggestion.".into());
        }
    }
    if let Some(category) = &s.category_id {
        let active: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1 AND archived=0)",
                [category],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !active {
            s.category_id = None;
            s.category_ask = true;
            s.explanations
                .push("Category is archived; choose another.".into());
        }
    }
    if s.category_ask || (s.ownership_ask && selected.is_none()) {
        s.explanations
            .push("Ask or conflicting rules: review this field explicitly.".into());
    }
    // Rules classify purchases only; they cannot infer payments/refunds or clear OCR/status warnings.
    let source_type = c.source_type.to_lowercase();
    let purchase_type = ["", "purchase", "charge", "sale", "debit"].contains(&source_type.trim());
    s.ready = s.category_id.is_some()
        && ownership_has_rules
        && !s.category_ask
        && !s.ownership_ask
        && c.amount_cents.is_some_and(|v| v > 0)
        && c.date
            .as_ref()
            .is_some_and(|d| d <= &Local::now().format("%Y-%m-%d").to_string())
        && !c.description.trim().is_empty()
        && c.description.len() <= 200
        && c.status == "posted"
        && c.warnings.is_empty()
        && purchase_type;
    Ok(s)
}
fn sharing_scope(mode: &str, value: &str, amount: Option<i64>) -> Result<Option<String>> {
    let scope = match mode {
        "" | "ask" | "none" => return Ok(None),
        "personal" => "personal",
        "chelsea" => "chelsea",
        "shared" | "equal" => "shared",
        "percent" => {
            let percent = money::cents(value)?;
            if percent > 10000 {
                return Err("Choose a percentage between 0 and 100.".into());
            }
            if percent == 0 {
                "chelsea"
            } else if percent == 10000 {
                "personal"
            } else {
                "shared"
            }
        }
        "exact" => {
            let total = amount.ok_or(
                "Enter the purchase amount before using an exact-dollar sharing suggestion.",
            )?;
            let (jacob, chelsea) = money::allocation(total, mode, value)?;
            if jacob == 0 {
                "chelsea"
            } else if chelsea == 0 {
                "personal"
            } else {
                "shared"
            }
        }
        _ => return Err("Choose a valid sharing state.".into()),
    };
    Ok(Some(scope.into()))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryContext {
    pub row_id: String,
    pub split_mode: String,
    pub split_value: String,
    pub amount: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSuggestion {
    pub row_id: String,
    pub category_id: Option<String>,
    pub category_ask: bool,
    pub explanations: Vec<String>,
}
impl Store {
    pub fn suggest_categories(
        &self,
        source: &str,
        contexts: Vec<CategoryContext>,
    ) -> Result<Vec<ContextSuggestion>> {
        if contexts.is_empty() || contexts.len() > 5000 {
            return Err("Choose up to 5,000 source rows.".into());
        }
        let account: String = self
            .conn
            .query_row(
                "SELECT account_id FROM import_sources WHERE id=?1 AND configured=1",
                [source],
                |r| r.get(0),
            )
            .map_err(|_| "Confirm the source account first.")?;
        let rules = list(&self.conn)?;
        let mut result = Vec::new();
        for context in contexts {
            let raw: String = self
                .conn
                .query_row(
                    "SELECT candidate_json FROM import_rows WHERE id=?1 AND source_id=?2",
                    params![context.row_id, source],
                    |r| r.get(0),
                )
                .map_err(|_| "Source row changed. Reload review.")?;
            let mut candidate: Candidate = serde_json::from_str(&raw).map_err(err)?;
            if !context.amount.is_empty() {
                candidate.amount_cents = Some(money::cents(&context.amount)?);
            }
            let suggestion = suggest_for(
                &self.conn,
                &rules,
                &account,
                &candidate,
                Some((&context.split_mode, &context.split_value)),
                "ask",
            )?;
            result.push(ContextSuggestion {
                row_id: context.row_id,
                category_id: suggestion.category_id,
                category_ask: suggestion.category_ask,
                explanations: suggestion.explanations,
            });
        }
        Ok(result)
    }
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    for mut r in list(conn)? {
        r.enabled = false;
        validate_rule(conn, &mut r)?;
    }
    Ok(())
}
