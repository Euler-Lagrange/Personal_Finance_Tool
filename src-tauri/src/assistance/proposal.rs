use super::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub page: Option<u32>,
    pub quote: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Field {
    pub key: String,
    pub value: Option<String>,
    pub evidence: Evidence,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Row {
    pub date: Option<String>,
    pub description: String,
    pub amount: Option<String>,
    pub direction: String,
    pub status: String,
    pub currency: Option<String>,
    pub evidence: Evidence,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Proposal {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configuration: Option<super::configuration::Configuration>,
    pub fields: Vec<Field>,
    pub rows: Vec<Row>,
    pub warnings: Vec<String>,
}
pub fn task(value: &str) -> Result<()> {
    if [
        "bill",
        "statement",
        "transactions",
        "mapping",
        "pdf_template",
        "pdf_table",
    ]
    .contains(&value)
    {
        Ok(())
    } else {
        Err("Choose bill fields, card statement fields or transactions.".into())
    }
}
pub fn instructions(task_name: &str) -> Result<String> {
    task(task_name)?;
    if ["mapping", "pdf_template", "pdf_table"].contains(&task_name) {
        return Ok(super::configuration::instructions(task_name));
    }
    Ok(format!("Extract {task_name} from the selected source only. Return fields for bills or statements, rows for transactions; leave the other array empty. Dates must be YYYY-MM-DD, dollar amounts decimal strings with exactly two fractional digits, never floating point or cents. Transaction amounts are unsigned magnitudes; direction is in, out or unknown relative to the account (a card payment is in, a purchase out). Status is posted, pending or unknown. Currency is the explicit ISO code or null. Never infer year, currency, posting status or missing amounts. Bill keys: amount_due, due_date, invoice_date, subtotal, tax, fees. Statement keys: statement_balance, closing_date, due_date, minimum_due, previous_balance, payments, credits, purchases, fees, interest. Quote the source for each field/row, with a one-based PDF page or null for text/images. Preserve repeated identical rows. Omit unrelated totals from transactions. Maximum 200 transactions and 20 warnings. These are proposals requiring human confirmation, not proof of complete coverage."))
}
pub fn schema(task: &str) -> Value {
    let nullable = json!({"type":["string","null"]});
    let evidence = json!({"type":"object","properties":{"page":{"type":["integer","null"]},"quote":{"type":"string"}},"required":["page","quote"],"additionalProperties":false});
    let mut schema = json!({"type":"object","properties":{
        "fields":{"type":"array","items":{"type":"object","properties":{"key":{"type":"string"},"value":nullable,"evidence":evidence},"required":["key","value","evidence"],"additionalProperties":false}},
        "rows":{"type":"array","items":{"type":"object","properties":{"date":nullable,"description":{"type":"string"},"amount":nullable,"direction":{"type":"string","enum":["in","out","unknown"]},"status":{"type":"string","enum":["posted","pending","unknown"]},"currency":nullable,"evidence":evidence},"required":["date","description","amount","direction","status","currency","evidence"],"additionalProperties":false}},
        "warnings":{"type":"array","items":{"type":"string"}}},"required":["fields","rows","warnings"],"additionalProperties":false});
    if ["mapping", "pdf_template", "pdf_table"].contains(&task) {
        schema["properties"]["configuration"] =
            json!({"anyOf":[super::configuration::schema(task),{"type":"null"}]});
        schema["required"]
            .as_array_mut()
            .unwrap()
            .push(json!("configuration"));
    }
    schema
}
fn text(s: &str, max: usize) -> Result<()> {
    if s.len() > max
        || s.chars()
            .any(|c| c.is_control() && !['\n', '\r', '\t'].contains(&c))
    {
        return Err("Proposal contains unsupported text.".into());
    }
    Ok(())
}
fn evidence(e: &Evidence, pages: Option<u32>) -> Result<()> {
    text(&e.quote, 2000)?;
    if e.quote.trim().is_empty() || e.page.is_some_and(|p| p == 0 || p > pages.unwrap_or(100)) {
        return Err("Proposal evidence is missing or has an invalid page.".into());
    }
    Ok(())
}
fn date(v: &str) -> Result<()> {
    let d = chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d")
        .map_err(|_| "Proposal date is invalid.")?;
    if d.format("%Y-%m-%d").to_string() != v {
        return Err("Proposal date must use YYYY-MM-DD.".into());
    }
    Ok(())
}
fn amount(v: &str) -> Result<i64> {
    let valid =
        regex::Regex::new(r"^-?\d{1,10}\.\d{2}$").map_err(|_| "Amount validation unavailable.")?;
    if !valid.is_match(v) {
        return Err("Proposal amount must be an exact decimal with two fractional digits.".into());
    }
    let cents = crate::money::cents(v.strip_prefix('-').unwrap_or(v))?;
    Ok(if v.starts_with('-') { -cents } else { cents })
}
pub fn validate(p: &Proposal, kind: &str, pages: Option<u32>) -> Result<()> {
    task(kind)?;
    if p.fields.len() > 10 || p.rows.len() > 200 || p.warnings.len() > 20 {
        return Err("Proposal exceeds supported limits. Use a smaller source.".into());
    }
    for w in &p.warnings {
        text(w, 1000)?;
    }
    if ["mapping", "pdf_template", "pdf_table"].contains(&kind) {
        if !p.fields.is_empty() || !p.rows.is_empty() {
            return Err("Unexpected rows or fields in configuration proposal.".into());
        }
        if let Some(c) = &p.configuration {
            if c.kind() != kind {
                return Err("Configuration task does not match.".into());
            }
            c.validate()?;
        } else if p.warnings.iter().all(|w| w.trim().is_empty()) {
            return Err("An unsupported configuration needs an explanation.".into());
        }
        return Ok(());
    }
    if p.configuration.is_some() {
        return Err("Unexpected configuration in extraction proposal.".into());
    }
    if kind == "transactions" {
        if !p.fields.is_empty() {
            return Err("Unexpected document fields in transaction proposal.".into());
        }
    } else if !p.rows.is_empty() {
        return Err("Unexpected transactions in document proposal.".into());
    }
    let keys = if kind == "bill" {
        vec![
            "amount_due",
            "due_date",
            "invoice_date",
            "subtotal",
            "tax",
            "fees",
        ]
    } else {
        vec![
            "statement_balance",
            "closing_date",
            "due_date",
            "minimum_due",
            "previous_balance",
            "payments",
            "credits",
            "purchases",
            "fees",
            "interest",
        ]
    };
    let mut seen = std::collections::HashSet::new();
    for f in &p.fields {
        if !keys.contains(&f.key.as_str()) || !seen.insert(&f.key) {
            return Err("Proposal contains an unknown or repeated field.".into());
        }
        if f.value.is_some() || !f.evidence.quote.is_empty() || f.evidence.page.is_some() {
            evidence(&f.evidence, pages)?;
        }
        if let Some(v) = &f.value {
            if f.key.ends_with("date") {
                date(v)?;
            } else {
                let n = amount(v)?;
                if n < 0 && !["statement_balance", "previous_balance"].contains(&f.key.as_str()) {
                    return Err("This document field requires a nonnegative amount.".into());
                }
            }
        }
    }
    for r in &p.rows {
        text(&r.description, 500)?;
        evidence(&r.evidence, pages)?;
        if r.description.trim().is_empty()
            || !["in", "out", "unknown"].contains(&r.direction.as_str())
            || !["posted", "pending", "unknown"].contains(&r.status.as_str())
        {
            return Err("Proposal transaction is invalid.".into());
        }
        if let Some(v) = &r.date {
            date(v)?;
        }
        if let Some(v) = &r.amount {
            if amount(v)? < 0 || v.starts_with('-') {
                return Err("Transaction amount must be an unsigned magnitude.".into());
            }
        }
        if r.currency
            .as_ref()
            .is_some_and(|s| s.len() != 3 || !s.bytes().all(|c| c.is_ascii_uppercase()))
        {
            return Err("Proposal currency is invalid.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Counts what the provider's structured-output compiler limits: properties with a union
    /// type (`anyOf` or a `type` array, at most 16 per request) and optional properties (at
    /// most 24). Also checks that every object closes `additionalProperties`.
    fn limits(v: &Value, unions: &mut usize, optional: &mut usize) {
        if v["type"] == "object" {
            assert_eq!(v["additionalProperties"], false, "{v}");
        }
        if let Some(props) = v["properties"].as_object() {
            let required: Vec<&str> = v["required"]
                .as_array()
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            for (name, p) in props {
                if p["type"].is_array() || p.get("anyOf").is_some() {
                    *unions += 1;
                }
                if !required.contains(&name.as_str()) {
                    *optional += 1;
                }
                limits(p, unions, optional);
            }
        }
        if let Some(items) = v.get("items") {
            limits(items, unions, optional);
        }
        if let Some(any) = v["anyOf"].as_array() {
            for a in any {
                limits(a, unions, optional);
            }
        }
    }
    #[test]
    fn every_task_schema_stays_within_provider_union_and_optional_limits() {
        for (task, expected) in [
            ("bill", 6),
            ("statement", 6),
            ("transactions", 6),
            ("mapping", 7),
            ("pdf_template", 7),
            ("pdf_table", 7),
        ] {
            let (mut unions, mut optional) = (0, 0);
            limits(&schema(task), &mut unions, &mut optional);
            assert_eq!(unions, expected, "{task} union-typed properties");
            assert!(unions <= 16, "{task}");
            assert_eq!(optional, 0, "{task} optional properties");
        }
    }
    #[test]
    fn proposals_preserve_unknowns_twins_and_signed_balances_but_reject_unsafe_values() {
        let row = json!({"date":null,"description":"Synthetic store","amount":null,"direction":"unknown","status":"unknown","currency":null,"evidence":{"page":null,"quote":"Store"}});
        let good = json!({"fields":[],"rows":[row.clone(),row],"warnings":[]});
        let p: Proposal = serde_json::from_value(good.clone()).unwrap();
        validate(&p, "transactions", None).unwrap();
        assert_eq!(p.rows.len(), 2);
        for (key, value) in [
            ("date", json!("2026-02-30")),
            ("amount", json!("-0.00")),
            ("amount", json!("1.001")),
            ("amount", json!("100000000000.00")),
            ("currency", json!("dollars")),
            ("direction", json!("expense")),
        ] {
            let mut bad = good.clone();
            bad["rows"][0][key] = value;
            assert!(validate(&serde_json::from_value(bad).unwrap(), "transactions", None).is_err());
        }
        let signed = json!({"fields":[{"key":"statement_balance","value":"-12.34","evidence":{"page":1,"quote":"Credit balance 12.34"}},{"key":"due_date","value":null,"evidence":{"page":null,"quote":""}}],"rows":[],"warnings":[]});
        validate(
            &serde_json::from_value(signed).unwrap(),
            "statement",
            Some(1),
        )
        .unwrap();
        let mut bad = good;
        bad["rows"][0]["evidence"]["page"] = json!(3);
        assert!(validate(
            &serde_json::from_value(bad).unwrap(),
            "transactions",
            Some(2)
        )
        .is_err());
        assert!(serde_json::from_value::<Proposal>(
            json!({"fields":[],"rows":[],"warnings":[],"execute":"command"})
        )
        .is_err());
    }
}
