use super::*;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Month {
    pub month: String,
    pub status: String,
    pub spent_cents: Option<i64>,
    pub unresolved_count: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub id: String,
    pub name: String,
    pub months: Vec<Option<i64>>,
    pub total_cents: i64,
    pub closed_average_cents: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub category_id: String,
    pub amount_cents: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub id: String,
    pub date: String,
    pub month: String,
    pub description: String,
    pub merchant_id: String,
    pub kind: String,
    pub amount_cents: i64,
    pub categories: Vec<Part>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub year: i32,
    pub months: Vec<Month>,
    pub categories: Vec<Series>,
    pub merchants: Vec<Series>,
    pub entries: Vec<Detail>,
    pub incomplete_import_count: i64,
}
fn series(id: String, name: String, annual: &periods::Annual) -> Series {
    Series {
        id,
        name,
        months: annual
            .months
            .iter()
            .map(|m| m.totals.as_ref().map(|_| 0))
            .collect(),
        total_cents: 0,
        closed_average_cents: None,
    }
}
fn finish(mut values: BTreeMap<String, Series>, annual: &periods::Annual) -> Vec<Series> {
    for s in values.values_mut() {
        s.total_cents = s.months.iter().flatten().sum();
        if annual.closed_months > 0 {
            let total: i128 = s
                .months
                .iter()
                .zip(&annual.months)
                .filter(|(_, m)| m.status == "closed")
                .map(|(v, _)| v.unwrap_or(0) as i128)
                .sum();
            let count = annual.closed_months as i128;
            s.closed_average_cents = Some(((total + total.signum() * (count / 2)) / count) as i64);
        }
    }
    let mut result: Vec<_> = values.into_values().collect();
    result.sort_by(|a, b| {
        b.total_cents
            .cmp(&a.total_cents)
            .then(a.name.cmp(&b.name))
            .then(a.id.cmp(&b.id))
    });
    result
}
impl Store {
    pub fn trends_report(&self, year: i32) -> Result<Report> {
        let annual = self.annual_report(year)?;
        let entries = self.entries(None)?;
        let by_id: HashMap<_, _> = entries.iter().map(|e| (e.id.as_str(), e)).collect();
        let mut categories = BTreeMap::new();
        let mut merchants = BTreeMap::new();
        let mut details = Vec::new();
        let mut months = Vec::new();
        for (index, month) in annual.months.iter().enumerate() {
            let current: Vec<_> = entries
                .iter()
                .filter(|e| e.reporting_month() == month.month)
                .collect();
            months.push(Month {
                month: month.month.clone(),
                status: month.status.clone(),
                spent_cents: month.totals.as_ref().map(|t| t.spent_cents),
                unresolved_count: if month.totals.is_some() {
                    current.iter().filter(|e| e.pending.is_some()).count()
                } else {
                    0
                },
            });
            let Some(totals) = &month.totals else {
                continue;
            };
            for c in &totals.categories {
                let value = categories
                    .entry(c.id.clone())
                    .or_insert_with(|| series(c.id.clone(), c.name.clone(), &annual));
                value.name = c.name.clone();
                value.months[index] = Some(c.spent_cents);
            }
            for e in current.into_iter().filter(|e| {
                matches!(
                    e.kind.as_str(),
                    "expense" | "refund" | "debt_payment" | "paypal_cashout"
                )
            }) {
                let merchant = if e.kind == "refund" {
                    by_id
                        .get(e.original_event_id.as_deref().unwrap_or(""))
                        .copied()
                        .ok_or("Refund is missing its original spending record.")?
                } else {
                    e
                };
                let normalized = rules::normalize(&merchant.description);
                // Punctuation-only descriptions must not all become one empty merchant.
                let key = if normalized.is_empty() {
                    format!("literal:{}", merchant.description.trim())
                } else {
                    format!("normalized:{normalized}")
                };
                let sign = if e.kind == "refund" { -1 } else { 1 };
                let amount = sign * e.jacob_cents;
                let value = merchants
                    .entry(key.clone())
                    .or_insert_with(|| series(key.clone(), merchant.description.clone(), &annual));
                *value.months[index].as_mut().unwrap() += amount;
                let mut parts = BTreeMap::<String, i64>::new();
                for line in &e.lines {
                    *parts.entry(line.category_id.clone()).or_default() += sign * line.jacob_cents;
                }
                if parts.values().sum::<i64>() != amount {
                    return Err(
                        "Spending detail does not reconcile with its category allocations.".into(),
                    );
                }
                details.push(Detail {
                    id: e.id.clone(),
                    date: e.date.clone(),
                    month: month.month.clone(),
                    description: e.description.clone(),
                    merchant_id: key,
                    kind: e.kind.clone(),
                    amount_cents: amount,
                    categories: parts
                        .into_iter()
                        .map(|(category_id, amount_cents)| Part {
                            category_id,
                            amount_cents,
                        })
                        .collect(),
                });
            }
            if merchants
                .values()
                .map(|s| s.months[index].unwrap_or(0))
                .sum::<i64>()
                != totals.spent_cents
            {
                return Err("Spending trends do not reconcile with the annual report. Review this month's close before relying on the report.".into());
            }
        }
        // Keep zero-net categories with real charges/refunds; omit unused setup categories.
        categories.retain(|id, s| {
            s.months.iter().flatten().any(|n| *n != 0)
                || details
                    .iter()
                    .any(|e| e.categories.iter().any(|p| &p.category_id == id))
        });
        details.sort_by(|a, b| {
            b.month
                .cmp(&a.month)
                .then(b.date.cmp(&a.date))
                .then(a.id.cmp(&b.id))
        });
        let incomplete_import_count = self.conn.query_row("SELECT COUNT(*) FROM import_sources s WHERE dismissed=0 AND (configured=0 OR error!='' OR EXISTS(SELECT 1 FROM import_rows r WHERE r.source_id=s.id AND (disposition='pending' OR EXISTS(SELECT 1 FROM pending_activity p WHERE p.event_id=r.event_id))))",[],|r|r.get(0)).map_err(err)?;
        Ok(Report {
            year,
            months,
            categories: finish(categories, &annual),
            merchants: finish(merchants, &annual),
            entries: details,
            incomplete_import_count,
        })
    }
}
