//! Shared obligation guards for local PDF templates and explicitly reviewed AI fields.
use super::*;
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub target_id: String,
    pub month: String,
    pub note: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Values {
    pub kind: String,
    pub amount_cents: i64,
    pub due_date: String,
    pub closing_date: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub target_name: String,
    pub prior_amount_cents: Option<i64>,
    pub new_amount_cents: i64,
    pub prior_due_date: String,
    pub due_date: String,
    pub calculation: Option<card_statements::Calculation>,
    pub state_hash: String,
    pub as_of: String,
}
fn hash<T: Serialize>(v: &T) -> Result<String> {
    Ok(crate::imports::parse::hash(
        serde_json::to_string(v).map_err(err)?.as_bytes(),
    ))
}
fn decimal(n: i64) -> String {
    format!(
        "{}{}.{:02}",
        if n < 0 { "-" } else { "" },
        n.abs() / 100,
        n.abs() % 100
    )
}
fn append_note(old: &str, note: &str) -> Result<String> {
    let text = if old.is_empty() {
        note.to_string()
    } else {
        format!("{old}\n{note}")
    };
    if text.len() > 2000 {
        return Err(
            "The combined reference note exceeds 2,000 characters. Shorten it before applying."
                .into(),
        );
    }
    Ok(text)
}
fn date(v: &str) -> Result<NaiveDate> {
    if v.len() != 10 || !("1900-01-01"..="2100-12-31").contains(&v) {
        return Err("Choose a valid document date between 1900 and 2100.".into());
    }
    NaiveDate::parse_from_str(v, "%Y-%m-%d").map_err(err)
}
pub(super) fn preview(
    c: &Connection,
    account: Option<&str>,
    i: &Target,
    v: &Values,
) -> Result<(Review, Option<card_statements::Draft>)> {
    date(&v.due_date)?;
    if !["bill", "statement"].contains(&v.kind.as_str())
        || !(-money::MAX_CENTS..=money::MAX_CENTS).contains(&v.amount_cents)
        || (v.kind == "bill" && v.amount_cents < 0)
    {
        return Err("Invalid document total or kind.".into());
    }
    if i.note.trim().is_empty() || i.note.len() > 1000 {
        return Err("Enter a document reference/review note up to 1,000 characters.".into());
    }
    let (target_name, prior, prior_due, calculation, draft, state_hash) = if v.kind == "bill" {
        if !i.month.is_empty() {
            return Err(
                "Bill applications use an existing occurrence, not a separate month.".into(),
            );
        }
        let o = bills::occurrence(c, &i.target_id)?;
        if o.cancelled {
            return Err("Restore the cancelled bill before applying a document.".into());
        }
        if account.is_some() && account != o.plan.details.account_id.as_deref() {
            return Err("Document account does not match the bill's payment account.".into());
        }
        if v.amount_cents < o.paid_cents {
            return Err(
                "The document total is below linked bill payments. Reconcile those payments first."
                    .into(),
            );
        }
        let first =
            NaiveDate::parse_from_str(&format!("{}-01", o.period), "%Y-%m-%d").map_err(err)?;
        if (date(&v.due_date)? - first).num_days().abs() > 62 {
            return Err("Choose the bill occurrence near the document's due date.".into());
        }
        append_note(&o.note, &i.note)?;
        (
            o.plan.details.name.clone(),
            o.actual_cents,
            o.due_date.clone(),
            None,
            None,
            hash(&o)?,
        )
    } else {
        validate_month(&i.month)?;
        if account.is_some_and(|a| a != i.target_id) {
            return Err("Document account does not match the selected card.".into());
        }
        let cfg = card_statements::configs(c)?
            .into_iter()
            .find(|cfg| cfg.account_id == i.target_id)
            .ok_or("Configure this card's statement cycle first.")?;
        let old = card_statements::stored(c, &i.target_id, &i.month)?;
        let mut d = if let Some((d, _)) = &old {
            d.clone()
        } else {
            card_statements::default_draft(&cfg, &i.month)?
        };
        let prior = d
            .balance
            .as_deref()
            .map(|s| {
                if let Some(s) = s.strip_prefix('-') {
                    money::cents(s).map(|v| -v)
                } else {
                    money::cents(s)
                }
            })
            .transpose()?;
        let prior_due = d.due_date.clone();
        d.closing_date = v.closing_date.clone().ok_or("Missing statement cutoff.")?;
        date(&d.closing_date)?;
        d.due_date = v.due_date.clone();
        d.dates_confirmed = true;
        d.balance = Some(decimal(v.amount_cents));
        d.note = append_note(&d.note, &i.note)?;
        d.evidence_source_id = None;
        let checked = card_statements::review(c, &d)?;
        card_payments::protect_statement(c, &d)?;
        let name: String = c
            .query_row(
                "SELECT name FROM accounts WHERE id=?1",
                [&i.target_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        (
            format!("{name} - {}", i.month),
            prior,
            prior_due,
            Some(checked.calculation),
            Some(d),
            hash(&(cfg, old, checked.token))?,
        )
    };
    Ok((
        Review {
            target_name,
            prior_amount_cents: prior,
            new_amount_cents: v.amount_cents,
            prior_due_date: prior_due,
            due_date: v.due_date.clone(),
            calculation,
            state_hash,
            as_of: Local::now().date_naive().to_string(),
        },
        draft,
    ))
}
// Call only in the same transaction after re-previewing and validating user consent.
pub(super) fn write(
    c: &Connection,
    source: &str,
    i: &Target,
    v: &Values,
    draft: Option<card_statements::Draft>,
) -> Result<()> {
    if let Some(mut d) = draft {
        c.execute(
            "UPDATE import_sources SET account_id=?1,revision=revision+1 WHERE id=?2",
            params![i.target_id, source],
        )
        .map_err(err)?;
        d.evidence_source_id = Some(source.into());
        let r = card_statements::review(c, &d)?;
        card_statements::write_review(
            c,
            card_statements::Save {
                draft: d,
                token: r.token,
                confirmed: true,
            },
        )?;
    } else {
        let o = bills::occurrence(c, &i.target_id)?;
        c.execute("UPDATE bill_occurrences SET actual_cents=?1,due_date=?2,note=?3,revision=revision+1 WHERE id=?4",params![v.amount_cents,v.due_date,append_note(&o.note,&i.note)?,i.target_id]).map_err(err)?;
        c.execute(
            "INSERT OR IGNORE INTO bill_evidence VALUES(?1,?2)",
            params![i.target_id, source],
        )
        .map_err(err)?;
        c.execute(
            "UPDATE import_sources SET account_id=?1,revision=revision+1 WHERE id=?2",
            params![o.plan.details.account_id, source],
        )
        .map_err(err)?;
    }
    Ok(())
}
