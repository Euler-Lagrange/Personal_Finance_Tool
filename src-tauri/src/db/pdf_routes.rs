use super::*;
use crate::imports::{pdf, types::Dataset};
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    pub template_id: String,
    pub template_version: i64,
    pub revision: i64,
    pub application_id: String,
    pub kind: String,
    pub target_id: String,
    pub marker: pdf::Anchor,
    pub enabled: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub application_id: String,
    pub revision: i64,
    pub marker: pdf::Anchor,
    pub enabled: bool,
    pub confirmed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub target_name: String,
    pub template_version: i64,
    pub route: Option<Route>,
    pub suggested_marker: Option<pdf::Anchor>,
    pub issue: Option<String>,
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn norm(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn data(c: &Connection, source: &str) -> Result<Dataset> {
    let raw: String = c
        .query_row(
            "SELECT dataset_json FROM import_sources WHERE id=?1",
            [source],
            |r| r.get(0),
        )
        .map_err(err)?;
    serde_json::from_str(&raw).map_err(err)
}
fn marker_matches(marker: &pdf::Anchor, pages: &[pdf::Page]) -> bool {
    marker.page > 0
        && pages.get(marker.page as usize - 1).is_some_and(|p| {
            p.lines
                .iter()
                .filter(|l| norm(l) == norm(&marker.text))
                .count()
                == 1
        })
}
fn marker_check(marker: &pdf::Anchor, t: &pdf::Definition, pages: &[pdf::Page]) -> Result<()> {
    if marker.text.len() < 4
        || marker.text.len() > 200
        || !marker.text.chars().any(|c| c.is_ascii_digit())
        || norm(&marker.text) == norm(&t.identity.text)
        || norm(&marker.text) == norm(&t.currency.text)
        || t.fields
            .iter()
            .any(|f| norm(&marker.text).starts_with(&norm(&f.label)))
        || !marker_matches(marker, pages)
    {
        return Err("Choose one exact account-specific line containing an identifying digit, separate from identity/currency and extracted values.".into());
    }
    Ok(())
}
fn base(
    c: &Connection,
    application: &str,
) -> Result<(
    pdf_documents::Template,
    String,
    String,
    pdf_documents::Review,
)> {
    let (tid,version,kind,target,source,raw):(String,i64,String,String,String,String)=c.query_row("SELECT template_id,template_version,kind,target_id,source_id,proof_json FROM pdf_applications WHERE id=?1",[application],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(|_|"Apply a document manually before enabling destination reuse.")?;
    let t = pdf_documents::template(c, &tid, Some(version))?;
    let target = if kind == "bill" {
        c.query_row(
            "SELECT bill_id FROM bill_occurrences WHERE id=?1",
            [target],
            |r| r.get(0),
        )
        .map_err(err)?
    } else {
        target
    };
    Ok((t, target, source, serde_json::from_str(&raw).map_err(err)?))
}
fn route(c: &Connection, id: &str) -> Result<Option<Route>> {
    let raw:Option<(i64,i64,String,String,String,String,bool)>=c.query_row("SELECT template_version,revision,application_id,kind,target_id,marker_json,enabled FROM pdf_routes WHERE template_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional().map_err(err)?;
    raw.map(
        |(template_version, revision, application_id, kind, target_id, raw, enabled)| {
            Ok(Route {
                template_id: id.into(),
                template_version,
                revision,
                application_id,
                kind,
                target_id,
                marker: serde_json::from_str(&raw).map_err(err)?,
                enabled,
            })
        },
    )
    .transpose()
}
fn eligibility(c: &Connection, t: &pdf_documents::Template) -> Result<()> {
    let latest = pdf_documents::template(c, &t.id, None)?;
    if latest.revision != t.revision || !latest.enabled {
        return Err("Template changed or is paused. Apply a current template version before enabling reuse.".into());
    }
    if t.definition.sum_parts.is_empty() {
        return Err(
            "Configure and approve component arithmetic before enabling automatic updates.".into(),
        );
    }
    Ok(())
}
impl Store {
    pub fn pdf_route_view(&self, application: &str) -> Result<View> {
        let (t, _, source, review) = base(&self.conn, application)?;
        let pages = data(&self.conn, &source)?.pdf_pages;
        let suggested_marker = pages.iter().find_map(|p| {
            p.lines
                .iter()
                .find(|l| {
                    let v = norm(l);
                    (v.contains("account") || v.contains("ending"))
                        && l.chars().any(|c| c.is_ascii_digit())
                })
                .map(|text| pdf::Anchor {
                    page: p.number,
                    text: text.clone(),
                })
        });
        Ok(View {
            target_name: review.target_name,
            template_version: t.revision,
            route: route(&self.conn, &t.id)?,
            suggested_marker,
            issue: eligibility(&self.conn, &t).err(),
        })
    }
    pub fn configure_pdf_route(&mut self, operation: &str, input: Input) -> Result<()> {
        Uuid::parse_str(operation).map_err(err)?;
        let h = crate::imports::parse::hash(json(&input)?.as_bytes());
        let old: Option<String> = self
            .conn
            .query_row(
                "SELECT payload_hash FROM pdf_route_receipts WHERE id=?1",
                [operation],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(old) = old {
            return if old == h {
                Ok(())
            } else {
                Err("This route operation was already used for different changes.".into())
            };
        }
        if !input.confirmed {
            return Err("Confirm the destination and account-specific marker first.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let (t, target, source, _) = base(&tx, &input.application_id)?;
        if route(&tx, &t.id)?.map_or(0, |r| r.revision) != input.revision {
            return Err("Destination reuse changed. Reload its settings.".into());
        }
        if input.enabled {
            eligibility(&tx, &t)?;
            marker_check(&input.marker, &t.definition, &data(&tx, &source)?.pdf_pages)?;
        } else if route(&tx, &t.id)?.is_none() {
            return Err("No saved destination reuse to pause.".into());
        }
        // A pause retains its already approved provenance and marker.
        let r = if input.enabled {
            Route {
                template_id: t.id,
                template_version: t.revision,
                revision: input.revision + 1,
                application_id: input.application_id.clone(),
                kind: t.definition.kind,
                target_id: target,
                marker: input.marker.clone(),
                enabled: true,
            }
        } else {
            let mut r = route(&tx, &t.id)?.unwrap();
            r.revision += 1;
            r.enabled = false;
            r
        };
        tx.execute("INSERT INTO pdf_routes VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(template_id) DO UPDATE SET template_version=excluded.template_version,revision=excluded.revision,application_id=excluded.application_id,kind=excluded.kind,target_id=excluded.target_id,marker_json=excluded.marker_json,enabled=excluded.enabled",params![r.template_id,r.template_version,r.revision,r.application_id,r.kind,r.target_id,json(&r.marker)?,r.enabled]).map_err(err)?;
        tx.execute(
            "INSERT INTO pdf_route_receipts VALUES(?1,?2)",
            params![operation, h],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES('pdf_destination_reuse',?1)",
            [json(&r)?],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}
fn apply_route(c: &Connection, source: &str, r: &Route) -> Result<()> {
    let t = pdf_documents::template(c, &r.template_id, None)?;
    if t.revision != r.template_version {
        return Err("Template version changed. Review and approve destination reuse again.".into());
    }
    eligibility(c, &t)?;
    let extraction = pdf::evaluate(&t.definition, &data(c, source)?.pdf_pages, Some(&t.layout))?;
    if !extraction.errors.is_empty() {
        return Err(extraction.errors.join(" "));
    }
    let (target, month) = if r.kind == "bill" {
        let due = extraction
            .date("due_date")
            .ok_or("Missing bill due date.")?;
        let month = &due[..7];
        let plan = bills::templates(c)?
            .into_iter()
            .find(|p| p.id == r.target_id)
            .ok_or("Bill schedule is missing.")?;
        let scheduled = bills::due(&plan, month)?
            .ok_or("Bill schedule is ended, archived or does not occur in this month.")?;
        let offset = (NaiveDate::parse_from_str(due, "%Y-%m-%d").map_err(err)?
            - NaiveDate::parse_from_str(&scheduled, "%Y-%m-%d").map_err(err)?)
        .num_days()
        .abs();
        if offset > 7 {
            return Err(
                "Bill due date moved more than seven days. Review the occurrence manually.".into(),
            );
        }
        let old: Option<String> = c
            .query_row(
                "SELECT id FROM bill_occurrences WHERE bill_id=?1 AND period=?2",
                params![r.target_id, month],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)?;
        let id = if let Some(id) = old {
            let o = bills::occurrence(c, &id)?;
            if o.cancelled
                || o.actual_cents
                    .is_some_and(|n| Some(n) != extraction.cents("amount_due"))
                || (o.actual_cents.is_some() && o.due_date != due)
                || (o.due_date != scheduled && o.due_date != due)
            {
                return Err(
                    "The bill is cancelled or has different confirmed values. Review it manually."
                        .into(),
                );
            }
            id
        } else {
            let id = Uuid::new_v4().to_string();
            c.execute("INSERT INTO bill_occurrences(id,bill_id,period,revision,due_date,plan_json) VALUES(?1,?2,?3,1,?4,?5)",params![id,r.target_id,month,scheduled,json(&plan.plan)?]).map_err(err)?;
            id
        };
        (id, String::new())
    } else {
        let close = extraction
            .date("closing_date")
            .ok_or("Missing statement closing date.")?;
        let month = close[..7].to_string();
        let cfg = card_statements::configs(c)?
            .into_iter()
            .find(|v| v.account_id == r.target_id && !v.archived)
            .ok_or("Card cycle is inactive or unconfigured.")?;
        let active: bool = c
            .query_row(
                "SELECT archived=0 FROM accounts WHERE id=?1",
                [&cfg.account_id],
                |row| row.get(0),
            )
            .map_err(err)?;
        if !active {
            return Err("Card account is archived.".into());
        }
        if let Some((d, _)) = card_statements::stored(c, &r.target_id, &month)? {
            if let Some(balance) = d.balance {
                let n = if let Some(v) = balance.strip_prefix('-') {
                    -money::cents(v)?
                } else {
                    money::cents(&balance)?
                };
                if Some(n) != extraction.cents("statement_balance")
                    || d.closing_date != close
                    || Some(d.due_date.as_str()) != extraction.date("due_date")
                {
                    return Err(
                        "Statement has different confirmed issuer values. Review it manually."
                            .into(),
                    );
                }
            }
        }
        (r.target_id.clone(), month)
    };
    let revision = c
        .query_row(
            "SELECT revision FROM import_sources WHERE id=?1",
            [source],
            |row| row.get(0),
        )
        .map_err(err)?;
    let input = pdf_documents::Request {
        source_id: source.into(),
        source_revision: revision,
        template_id: r.template_id.clone(),
        template_revision: r.template_version,
        target_id: target,
        month,
        note: format!(
            "Automatic reuse of approved destination (route revision {}).",
            r.revision
        ),
    };
    let (review, _) = pdf_documents::preview(c, &input)?;
    if r.kind == "statement"
        && !review
            .calculation
            .as_ref()
            .is_some_and(|v| v.complete && v.balance_cents == Some(review.new_amount_cents))
    {
        return Err("Statement calculation is incomplete or differs from the issuer total. Review the evidence manually.".into());
    }
    pdf_documents::apply_reviewed(
        c,
        &Uuid::new_v4().to_string(),
        pdf_documents::Apply {
            input,
            token: review.token,
            confirmed: true,
        },
    )
}
pub(super) fn auto_apply(c: &Connection, source: &str) -> Result<()> {
    let format: String = c
        .query_row(
            "SELECT format FROM import_sources WHERE id=?1",
            [source],
            |r| r.get(0),
        )
        .map_err(err)?;
    if format != "pdf" {
        return Ok(());
    }
    let mut d = data(c, source)?;
    let mut q = c
        .prepare("SELECT template_id FROM pdf_routes WHERE enabled=1 ORDER BY template_id")
        .map_err(err)?;
    let ids = q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    let mut matches = vec![];
    for id in ids {
        let r = route(c, &id)?.ok_or("Missing PDF route.")?;
        let t = pdf_documents::template(c, &id, None)?;
        if t.enabled
            && marker_matches(&r.marker, &d.pdf_pages)
            && marker_matches(&t.definition.identity, &d.pdf_pages)
        {
            matches.push(r);
        }
    }
    if matches.is_empty() {
        return Ok(());
    }
    c.execute_batch("SAVEPOINT pdf_destination_update")
        .map_err(err)?;
    let result = if matches.len() == 1 {
        apply_route(c, source, &matches[0])
    } else {
        Err(
            "Multiple approved destinations recognize this document. Review its target manually."
                .into(),
        )
    };
    if let Err(reason) = result {
        c.execute_batch("ROLLBACK TO pdf_destination_update; RELEASE pdf_destination_update")
            .map_err(err)?;
        d.notes
            .push(format!("Automatic bill/statement update held: {reason}"));
        c.execute(
            "UPDATE import_sources SET dataset_json=?1 WHERE id=?2",
            params![json(&d)?, source],
        )
        .map_err(err)?;
    } else {
        c.execute_batch("RELEASE pdf_destination_update")
            .map_err(err)?;
    }
    Ok(())
}
pub(super) fn validate(c: &Connection) -> Result<()> {
    let mut q = c
        .prepare("SELECT template_id FROM pdf_routes")
        .map_err(err)?;
    let ids = q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for id in ids {
        let r = route(c, &id)?.ok_or("Missing PDF route.")?;
        let (t, target, source, _) = base(c, &r.application_id)?;
        if r.revision < 1
            || t.id != r.template_id
            || t.revision != r.template_version
            || t.definition.kind != r.kind
            || target != r.target_id
            || t.definition.sum_parts.is_empty()
        {
            return Err("Invalid PDF destination provenance.".into());
        }
        marker_check(&r.marker, &t.definition, &data(c, &source)?.pdf_pages)?;
    }
    let mut q = c
        .prepare("SELECT id,payload_hash FROM pdf_route_receipts")
        .map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?).map_err(err)?;
        let h: String = r.get(1).map_err(err)?;
        if h.len() != 64 || !h.bytes().all(|v| v.is_ascii_hexdigit()) {
            return Err("Invalid PDF route operation history.".into());
        }
    }
    Ok(())
}
