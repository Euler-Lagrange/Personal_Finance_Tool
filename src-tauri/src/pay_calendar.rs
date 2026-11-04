//! Reviewed civil-date payroll calendars. Document text never executes instructions.
use crate::payroll::{date, State};
use chrono::{Datelike, Duration};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub source_id: String,
    pub location: String,
    pub quote: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Period {
    pub id: String,
    pub name: String,
    pub pay_date: String,
    pub weeks: Vec<String>,
    pub frequency: String,
    pub benefits: bool,
    pub note: String,
    pub evidence: Vec<Evidence>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Holiday {
    pub date: String,
    pub name: Option<String>,
    pub evidence: Option<Evidence>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    pub source_id: Option<String>,
    pub periods: Vec<Period>,
    pub holidays: Vec<Holiday>,
    pub remove_periods: Vec<String>,
    pub reason: String,
    pub confirmed: bool,
}
pub fn validate_evidence(e: &Evidence) -> Result<()> {
    uuid::Uuid::parse_str(&e.source_id).map_err(|_| "Invalid calendar source.")?;
    if e.location.is_empty()
        || e.location.len() > 150
        || e.quote.trim().is_empty()
        || e.quote.len() > 4000
    {
        return Err("Choose a source location and a short supporting quote.".into());
    }
    Ok(())
}
pub fn validate_period(p: &Period) -> Result<()> {
    uuid::Uuid::parse_str(&p.id).map_err(|_| "Invalid pay period identifier.")?;
    date(&p.pay_date)?;
    if p.name.trim().is_empty()
        || p.name.len() > 120
        || p.note.len() > 2000
        || p.weeks.is_empty()
        || p.weeks.len() > 8
        || !["weekly", "biweekly", "semimonthly", "monthly"].contains(&p.frequency.as_str())
    {
        return Err("A period needs a name, 1–8 workweeks and a withholding frequency.".into());
    }
    let mut seen = BTreeSet::new();
    for week in &p.weeks {
        let start = date(week)?;
        if start.weekday().num_days_from_monday() != 0
            || !seen.insert(week)
            || start + Duration::days(6) > date("2100-12-31")?
        {
            return Err(
                "Assign distinct Monday-start workweeks within the supported calendar.".into(),
            );
        }
        // A payroll date may precede the end of its week only as a reviewed exception.
        if (date(&p.pay_date)? - start).num_days().abs() > 366 {
            return Err("Pay date must be within a year of every assigned workweek.".into());
        }
    }
    if p.evidence.len() > 8 {
        return Err("Use at most eight supporting locations for a period.".into());
    }
    for e in &p.evidence {
        validate_evidence(e)?;
    }
    Ok(())
}
pub fn validate_state(state: &State) -> Result<()> {
    if state.periods.len() > 12_000 || state.holiday_evidence.len() > 10_000 {
        return Err("Payroll calendar exceeds the supported size.".into());
    }
    let mut weeks = BTreeSet::new();
    for (id, p) in &state.periods {
        validate_period(p)?;
        if id != &p.id {
            return Err("Pay period identity mismatch.".into());
        }
        for week in &p.weeks {
            if !weeks.insert(week) {
                return Err(format!("Workweek {week} is assigned to more than one paycheck. Resolve the conflicting dates before applying."));
            }
        }
    }
    for (day, e) in &state.holiday_evidence {
        if !state.holidays.contains_key(day) {
            return Err("Holiday evidence has no holiday.".into());
        }
        validate_evidence(e)?;
    }
    Ok(())
}
pub fn apply(state: &mut State, review: &Review) -> Result<()> {
    if review.periods.is_empty() && review.holidays.is_empty() && review.remove_periods.is_empty() {
        return Err("Add a calendar change before applying this review.".into());
    }
    if !review.confirmed || review.reason.trim().is_empty() || review.reason.len() > 2000 {
        return Err(
            "Review the dates, explain any conflict decisions and confirm before applying.".into(),
        );
    }
    if review.periods.len() > 100
        || review.holidays.len() > 100
        || review.remove_periods.len() > 100
    {
        return Err("Review up to 100 periods or holidays at a time.".into());
    }
    if let Some(id) = &review.source_id {
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid source identifier.")?;
    }
    let check_source = |e: &Option<Evidence>| -> Result<()> {
        if review.source_id.as_deref() != e.as_ref().map(|e| e.source_id.as_str()) {
            return Err("Each imported calendar change needs evidence from the selected source. Manual changes must be labeled manual.".into());
        }
        Ok(())
    };
    let mut ids = BTreeSet::new();
    for id in &review.remove_periods {
        if !ids.insert(id) || !state.periods.contains_key(id) {
            return Err("Choose existing periods once for removal.".into());
        }
    }
    for p in &review.periods {
        if !ids.insert(&p.id) {
            return Err("A period occurs twice in this review.".into());
        }
        validate_period(p)?;
        if review.source_id.is_some() && p.evidence.is_empty() {
            return Err("Choose supporting source evidence for each imported period.".into());
        }
        for e in &p.evidence {
            check_source(&Some(e.clone()))?;
        }
    }
    let mut dates = BTreeSet::new();
    for h in &review.holidays {
        date(&h.date)?;
        if !dates.insert(&h.date) {
            return Err("A holiday occurs twice in this review.".into());
        }
        if h.name
            .as_ref()
            .is_some_and(|n| n.trim().is_empty() || n.len() > 120)
        {
            return Err("Enter a holiday name up to 120 characters.".into());
        }
        check_source(&h.evidence)?;
    }
    for id in &review.remove_periods {
        state.periods.remove(id);
    }
    for p in &review.periods {
        let mut p = p.clone();
        p.weeks.sort();
        state.periods.insert(p.id.clone(), p);
    }
    for h in &review.holidays {
        let year = date(&h.date)?.year();
        state.holiday_years.remove(&year);
        state.holiday_evidence.remove(&h.date);
        if let Some(name) = &h.name {
            state.holidays.insert(h.date.clone(), name.trim().into());
            if let Some(e) = &h.evidence {
                state.holiday_evidence.insert(h.date.clone(), e.clone());
            }
        } else {
            state.holidays.remove(&h.date);
        }
    }
    validate_state(state)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Chunk {
    pub location: String,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Suggestion {
    pub kind: String,
    pub date: String,
    pub pay_date: String,
    pub name: String,
    pub frequency: String,
    pub benefits: bool,
    pub location: String,
    pub quote: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub chunks: Vec<Chunk>,
    pub suggestions: Vec<Suggestion>,
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pay_observations: Vec<PayProposal>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PayProposal {
    pub input: crate::pay_forecast::ObservationInput,
    pub location: String,
    pub quote: String,
}
impl Document {
    pub fn validate(&self) -> Result<()> {
        if self.chunks.len() > 5000
            || self.pay_observations.len() > 1000
            || self.suggestions.len() > 1000
            || self.warnings.len() > 100
            || self.chunks.iter().map(|c| c.text.len()).sum::<usize>() > 1_000_000
        {
            return Err("Calendar text exceeds local review limits.".into());
        }
        let mut locations = BTreeSet::new();
        for p in &self.pay_observations {
            crate::pay_forecast::observation(p.input.clone())?;
            if p.input.reviewed
                || p.input.period_id.is_some()
                || !p.input.evidence.is_empty()
                || p.quote.is_empty()
                || !self
                    .chunks
                    .iter()
                    .any(|c| c.location == p.location && c.text.contains(&p.quote))
            {
                return Err("Invalid known-pay source proposal.".into());
            }
        }
        for c in &self.chunks {
            if c.location.is_empty()
                || c.location.len() > 150
                || c.text.len() > 4000
                || !locations.insert(&c.location)
            {
                return Err("Invalid calendar evidence location.".into());
            }
        }
        for s in &self.suggestions {
            if !["week", "holiday"].contains(&s.kind.as_str())
                || date(&s.date).is_err()
                || (s.kind == "week" && date(&s.pay_date).is_err())
                || s.name.len() > 120
                || s.frequency.len() > 30
                || s.quote.len() > 4000
            {
                return Err("Invalid calendar proposal.".into());
            }
            if !self
                .chunks
                .iter()
                .any(|c| c.location == s.location && c.text.contains(&s.quote))
                || s.quote.is_empty()
            {
                return Err("Calendar suggestion lost its source quote.".into());
            }
        }
        Ok(())
    }
}
pub fn suggest_table(doc: &mut Document, headers: &[String], rows: &[Vec<String>], prefix: &str) {
    let columns: BTreeMap<_, _> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim().to_lowercase().replace(' ', "_"), i))
        .collect();
    let get = |r: &[String], name: &str| {
        columns
            .get(name)
            .and_then(|&i| r.get(i))
            .cloned()
            .unwrap_or_default()
    };
    let ambiguous = columns.len() != headers.len();
    if ambiguous {
        doc.warnings.push(format!("{prefix} has repeated column names. Enter the dates manually after comparing both values."));
    }
    let mut seen = BTreeSet::new();
    for (i, row) in rows.iter().enumerate() {
        let location = format!("{prefix} row {}", i + 2);
        let quote = row.join(" | ");
        doc.chunks.push(Chunk {
            location: location.clone(),
            text: quote.clone(),
        });
        if ambiguous {
            continue;
        }
        let kind = get(row, "kind");
        if kind == "pay" {
            let net = get(row, "net_pay");
            let benefits = get(row, "benefits").trim().to_lowercase();
            let input = crate::pay_forecast::ObservationInput {
                id: uuid::Uuid::new_v4().to_string(),
                period_id: None,
                pay_date: get(row, "pay_date"),
                worked: get(row, "hours_worked"),
                sick: get(row, "sick_hours").parse().unwrap_or(-1),
                rate: get(row, "hourly_rate"),
                gross: get(row, "gross_pay"),
                net: if net.trim().is_empty() {
                    None
                } else {
                    Some(net)
                },
                other_gross: "0".into(),
                reimbursement: "0".into(),
                deductions: vec![],
                detail_complete: false,
                frequency: get(row, "frequency"),
                benefits: benefits == "yes",
                regime: get(row, "regime"),
                reviewed: false,
                evidence: vec![],
                note: String::new(),
            };
            if ["yes", "no"].contains(&benefits.as_str())
                && crate::pay_forecast::observation(input.clone()).is_ok()
            {
                doc.pay_observations.push(PayProposal {
                    input,
                    location,
                    quote,
                });
            } else {
                let warning="Some pay rows have missing/invalid fields. Their text is retained; review and enter those facts manually.".to_string();
                if !doc.warnings.contains(&warning) {
                    doc.warnings.push(warning);
                }
            }
            continue;
        }
        let day = get(
            row,
            if kind == "holiday" {
                "date"
            } else {
                "week_start"
            },
        );
        let pay_date = get(row, "pay_date");
        let name = get(row, "name");
        if date(&day).is_ok()
            && (kind == "holiday"
                || (kind == "week" && !pay_date.is_empty() && date(&pay_date).is_ok()))
        {
            let frequency = get(row, "frequency");
            let benefits_value = get(row, "benefits").trim().to_lowercase();
            let benefits = benefits_value != "no";
            if kind == "week" && !["yes", "no"].contains(&benefits_value.as_str()) {
                let warning = "Some proposed weeks have no recognized benefits flag. Normal deductions are suggested; confirm or change that choice during review.".to_string();
                if !doc.warnings.contains(&warning) {
                    doc.warnings.push(warning);
                }
            }
            let key = (
                kind.clone(),
                day.clone(),
                pay_date.clone(),
                name.clone(),
                frequency.clone(),
                benefits,
            );
            if seen.insert(key) {
                doc.suggestions.push(Suggestion {
                    kind: if kind == "holiday" { "holiday" } else { "week" }.into(),
                    date: day,
                    pay_date,
                    name,
                    frequency,
                    benefits,
                    location,
                    quote,
                });
            }
        }
    }
}
