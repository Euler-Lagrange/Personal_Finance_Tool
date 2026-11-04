use super::*;
use crate::assistance::proposal::{self, Field, Proposal};
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub job_id: String,
    pub source_revision: i64,
    pub fields: Vec<Field>,
    pub target_id: String,
    pub month: String,
    pub note: String,
    pub currency_confirmed: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Save {
    pub input: Input,
    pub token: String,
    pub confirmed: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub token: String,
    pub kind: String,
    pub source_account: Option<String>,
    pub target: document_values::Review,
    pub warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub job_id: String,
    pub input: Input,
    pub review: Review,
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn hash<T: Serialize>(v: &T) -> Result<String> {
    Ok(crate::imports::parse::hash(json(v)?.as_bytes()))
}
fn target(i: &Input) -> document_values::Target {
    document_values::Target {
        target_id: i.target_id.clone(),
        month: i.month.clone(),
        note: i.note.clone(),
    }
}
fn values(
    i: &Input,
    kind: &str,
    pages: Option<u32>,
) -> Result<(document_values::Values, Vec<String>)> {
    if !i.currency_confirmed {
        return Err(
            "Confirm that the document amounts are USD and belong to the selected bill or card."
                .into(),
        );
    }
    proposal::validate(
        &Proposal {
            configuration: None,
            fields: i.fields.clone(),
            rows: vec![],
            warnings: vec![],
        },
        kind,
        pages,
    )?;
    let get = |key: &str| {
        i.fields
            .iter()
            .find(|f| f.key == key)
            .and_then(|f| f.value.as_deref())
    };
    let cents = |key: &str| -> Result<Option<i64>> {
        get(key)
            .map(|v| {
                if let Some(v) = v.strip_prefix('-') {
                    money::cents(v).map(|n| -n)
                } else {
                    money::cents(v)
                }
            })
            .transpose()
    };
    let total = cents(if kind == "bill" {
        "amount_due"
    } else {
        "statement_balance"
    })?
    .ok_or("Resolve the document total before applying.")?;
    let due = get("due_date")
        .ok_or("Resolve the document due date before applying.")?
        .into();
    let closing = if kind == "statement" {
        Some(
            get("closing_date")
                .ok_or("Resolve the statement closing date before applying.")?
                .into(),
        )
    } else {
        None
    };
    let parts = if kind == "bill" {
        vec![("subtotal", 1), ("tax", 1), ("fees", 1)]
    } else {
        vec![
            ("previous_balance", 1),
            ("payments", -1),
            ("credits", -1),
            ("purchases", 1),
            ("fees", 1),
            ("interest", 1),
        ]
    };
    let component_values = parts
        .iter()
        .map(|(key, sign)| Ok(cents(key)?.map(|n| n * sign)))
        .collect::<Result<Vec<_>>>()?;
    let mut warnings = vec![];
    if component_values.iter().all(Option::is_some) {
        if component_values.iter().flatten().sum::<i64>() != total {
            return Err("The reviewed components do not add up to the document total. Correct them against the original before applying.".into());
        }
    } else {
        warnings.push("A complete component arithmetic check is unavailable. Verify the total against the original document.".into());
    }
    Ok((
        document_values::Values {
            kind: kind.into(),
            amount_cents: total,
            due_date: due,
            closing_date: closing,
        },
        warnings,
    ))
}
pub(super) fn used(c: &Connection, fingerprint: &str) -> Result<bool> {
    c.query_row("SELECT EXISTS(SELECT 1 FROM pdf_applications WHERE fingerprint=?1 UNION ALL SELECT 1 FROM ai_document_applications WHERE fingerprint=?1)",[fingerprint],|r|r.get(0)).map_err(err)
}
fn preview(
    c: &Connection,
    i: &Input,
) -> Result<(
    Review,
    document_values::Values,
    Option<card_statements::Draft>,
)> {
    let j = ai_jobs::job(c, &i.job_id)?;
    let kind = &j.request.input.task;
    if j.status != "completed"
        || !["bill", "statement"].contains(&kind.as_str())
        || j.proposal.is_none()
    {
        return Err("Choose a completed bill or statement proposal.".into());
    }
    let (fp, revision, account, dismissed): (String, i64, Option<String>, bool) = c
        .query_row(
            "SELECT fingerprint,revision,account_id,dismissed FROM import_sources WHERE id=?1",
            [&j.source_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(err)?;
    if dismissed || revision != i.source_revision || fp != j.request.fingerprint {
        return Err("Source changed or was dismissed. Reopen the document review.".into());
    }
    if used(c, &fp)? {
        return Err("This document's evidence was already applied. Review its saved application or edit the existing bill/statement directly.".into());
    }
    let (v, warnings) = values(i, kind, j.request.page_count)?;
    let (review, draft) = document_values::preview(c, account.as_deref(), &target(i), &v)?;
    let token = hash(&(i, &fp, &account, &j.proposal, &review, &warnings))?;
    Ok((
        Review {
            token,
            kind: kind.clone(),
            source_account: account,
            target: review,
            warnings,
        },
        v,
        draft,
    ))
}
impl Store {
    pub fn ai_document_preview(&self, input: Input) -> Result<Review> {
        Ok(preview(&self.conn, &input)?.0)
    }
    pub fn ai_document_apply(&mut self, operation: &str, s: Save) -> Result<()> {
        Uuid::parse_str(operation).map_err(|_| "Invalid document review identifier.")?;
        let h = hash(&s)?;
        let old: Option<String> = self
            .conn
            .query_row(
                "SELECT payload_hash FROM ai_document_applications WHERE id=?1",
                [operation],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(old) = old {
            if old != h {
                return Err("This document review ID was already used for other changes.".into());
            }
            return Ok(());
        }
        if !s.confirmed {
            return Err(
                "Confirm the reviewed fields, source and target changes before applying.".into(),
            );
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let (r, v, draft) = preview(&tx, &s.input)?;
        if r.token != s.token {
            return Err("Document fields or target changed. Preview and confirm again.".into());
        }
        let j = ai_jobs::job(&tx, &s.input.job_id)?;
        document_values::write(&tx, &j.source_id, &target(&s.input), &v, draft)?;
        tx.execute(
            "INSERT INTO ai_document_applications VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                operation,
                s.input.job_id,
                j.source_id,
                j.request.fingerprint,
                r.kind,
                s.input.target_id,
                s.input.month,
                json(&s)?,
                json(&r)?,
                h,
                hash(&j.proposal)?
            ],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES('ai_document_applied',?1)",
            [operation],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
    pub fn ai_document_application(&self, source: &str) -> Result<Option<Applied>> {
        let raw:Option<(String,String,String)>=self.conn.query_row("SELECT job_id,input_json,review_json FROM ai_document_applications WHERE source_id=?1",[source],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(err)?;
        raw.map(|(job_id, s, r)| {
            let s: Save = serde_json::from_str(&s).map_err(err)?;
            Ok(Applied {
                job_id,
                input: s.input,
                review: serde_json::from_str(&r).map_err(err)?,
            })
        })
        .transpose()
    }
}
pub(super) fn protect_account(c: &Connection, source: &str, account: &str) -> Result<()> {
    let old:Option<Option<String>>=c.query_row("SELECT s.account_id FROM import_sources s JOIN ai_document_applications a ON a.source_id=s.id WHERE s.id=?1",[source],|r|r.get(0)).optional().map_err(err)?;
    if old.is_some_and(|v| v.as_deref() != Some(account)) {
        return Err(
            "This source supports an applied AI document. Its account cannot be changed.".into(),
        );
    }
    Ok(())
}
pub(super) fn protect_source(c: &Connection, source: &str) -> Result<()> {
    let used: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_document_applications WHERE source_id=?1)",
            [source],
            |r| r.get(0),
        )
        .map_err(err)?;
    if used {
        return Err("This source supports an applied AI document. Preserve its original extraction and evidence.".into());
    }
    Ok(())
}
pub(super) fn validate(c: &Connection) -> Result<()> {
    let orphan:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM audit WHERE action='ai_document_applied' AND payload NOT IN (SELECT id FROM ai_document_applications))",[],|r|r.get(0)).map_err(err)?;
    if orphan {
        return Err("Applied AI document history is missing.".into());
    }
    let duplicate:bool=c.query_row("SELECT EXISTS(SELECT fingerprint FROM (SELECT fingerprint FROM pdf_applications UNION ALL SELECT fingerprint FROM ai_document_applications) GROUP BY fingerprint HAVING COUNT(*)>1)",[],|r|r.get(0)).map_err(err)?;
    if duplicate {
        return Err("Document evidence was applied more than once.".into());
    }
    let mut q=c.prepare("SELECT id,job_id,source_id,fingerprint,kind,target_id,month,input_json,review_json,payload_hash,proposal_hash FROM ai_document_applications").map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let id: String = row.get(0).map_err(err)?;
        Uuid::parse_str(&id).map_err(err)?;
        let audited: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM audit WHERE action='ai_document_applied' AND payload=?1",
                [&id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let j = ai_jobs::job(c, &row.get::<_, String>(1).map_err(err)?)?;
        let source: String = row.get(2).map_err(err)?;
        let fp: String = row.get(3).map_err(err)?;
        let kind: String = row.get(4).map_err(err)?;
        let target: String = row.get(5).map_err(err)?;
        let month: String = row.get(6).map_err(err)?;
        let s: Save = serde_json::from_str(&row.get::<_, String>(7).map_err(err)?).map_err(err)?;
        let r: Review =
            serde_json::from_str(&row.get::<_, String>(8).map_err(err)?).map_err(err)?;
        let (v, warnings) = values(&s.input, &kind, j.request.page_count)?;
        let revision: i64 = c
            .query_row(
                "SELECT revision FROM import_sources WHERE id=?1",
                [&source],
                |r| r.get(0),
            )
            .map_err(err)?;
        let exists: bool = if kind == "bill" {
            c.query_row(
                "SELECT EXISTS(SELECT 1 FROM bill_occurrences WHERE id=?1)",
                [&target],
                |r| r.get(0),
            )
            .map_err(err)?
        } else {
            validate_month(&month)?;
            card_statements::validate_calculation(
                r.target
                    .calculation
                    .as_ref()
                    .ok_or("Missing reviewed statement calculation.")?,
                v.closing_date.as_deref().ok_or("Missing closing date.")?,
            )?;
            c.query_row(
                "SELECT EXISTS(SELECT 1 FROM card_statements WHERE account_id=?1 AND month=?2)",
                params![target, month],
                |r| r.get(0),
            )
            .map_err(err)?
        };
        if !exists
            || audited != 1
            || j.status != "completed"
            || j.id != s.input.job_id
            || j.source_id != source
            || j.request.fingerprint != fp
            || kind != j.request.input.task
            || kind != r.kind
            || target != s.input.target_id
            || month != s.input.month
            || s.input.source_revision >= revision
            || s.input.source_revision < j.request.input.source_revision
            || !s.confirmed
            || (kind == "bill" && (!month.is_empty() || r.target.calculation.is_some()))
            || r.target.new_amount_cents != v.amount_cents
            || r.target.due_date != v.due_date
            || r.warnings != warnings
            || s.token != r.token
            || r.token
                != hash(&(
                    &s.input,
                    &fp,
                    &r.source_account,
                    &j.proposal,
                    &r.target,
                    &r.warnings,
                ))?
            || row.get::<_, String>(9).map_err(err)? != hash(&s)?
            || row.get::<_, String>(10).map_err(err)? != hash(&j.proposal)?
        {
            return Err("Reviewed AI document evidence is inconsistent.".into());
        }
    }
    Ok(())
}
