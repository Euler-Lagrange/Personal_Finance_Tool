use super::*;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementRow {
    pub reporting_month: String,
    pub entry: Option<Entry>,
    pub date: String,
    pub description: String,
    pub kind: String,
    pub group: String,
    pub group_reason: String,
    pub override_group: Option<String>,
    pub full_cents: i64,
    pub jacob_cents: i64,
    pub chelsea_cents: i64,
    pub delta_cents: i64,
    pub balance_cents: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    pub generated_at: String,
    pub incomplete_sources: i64,
    pub workspace: String,
    pub month: Option<String>,
    pub opening_date: Option<String>,
    pub opening_cents: i64,
    pub opening_adjustment_cents: i64,
    pub closing_cents: i64,
    pub bills_cents: i64,
    pub everyday_cents: i64,
    pub unassigned_cents: i64,
    pub repayment_cents: i64,
    pub pending_count: i64,
    pub rows: Vec<StatementRow>,
}
// Include explicit shared intent even when penny rounding gives the other person zero.
fn relevant(e: &Entry) -> bool {
    if e.pending.is_some() {
        return false;
    }
    if e.kind == "settlement" {
        return true;
    }
    matches!(e.kind.as_str(), "expense" | "debt_payment" | "refund")
        && (e.household_delta_cents != 0
            || matches!(e.split_mode.as_str(), "shared" | "equal")
            || e.lines
                .iter()
                .any(|l| matches!(l.split_mode.as_str(), "shared" | "equal")))
}
fn group_for(
    e: &Entry,
    groups: &HashMap<String, String>,
    linked: &HashMap<String, i64>,
    all: &HashMap<String, Entry>,
) -> (String, String, Option<String>) {
    if let Some(g) = groups.get(&e.id) {
        return (
            g.clone(),
            "Chosen for this transaction".into(),
            Some(g.clone()),
        );
    }
    if e.kind == "settlement" {
        return (
            "unassigned".into(),
            "Repayment applies to the one household balance".into(),
            None,
        );
    }
    let original = e.original_event_id.as_ref().and_then(|id| all.get(id));
    let source = original.unwrap_or(e);
    if original.is_some() {
        if let Some(g) = groups.get(&source.id) {
            return (g.clone(), "Inherited from original purchase".into(), None);
        }
    }
    match linked.get(&source.id).copied().unwrap_or(0) {
        0 => (
            "everyday".into(),
            "No linked bill payment; can be changed".into(),
            None,
        ),
        n if n == source.amount_cents => {
            ("bills".into(), "Fully linked to bill payments".into(), None)
        }
        _ => (
            "unassigned".into(),
            "Partly linked to bills; choose a whole-transaction group or leave unassigned".into(),
            None,
        ),
    }
}
impl Store {
    pub fn shared_statement(&self, month: Option<&str>) -> Result<Statement> {
        if let Some(m) = month {
            validate_month(m)?;
        }
        let entries = self.entries(None)?;
        let all: HashMap<_, _> = entries.iter().map(|e| (e.id.clone(), e.clone())).collect();
        let mut stmt = self
            .conn
            .prepare("SELECT event_id,group_name FROM household_groups")
            .map_err(err)?;
        let groups: HashMap<String, String> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
        let mut stmt = self
            .conn
            .prepare("SELECT event_id,SUM(amount_cents) FROM bill_payments GROUP BY event_id")
            .map_err(err)?;
        let linked: HashMap<String, i64> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
        let opening = self.household_opening()?;
        let mut report = Statement {
            generated_at: Utc::now().to_rfc3339(),
            incomplete_sources: self.conn.query_row("SELECT COUNT(*) FROM import_sources s WHERE dismissed=0 AND (configured=0 OR error!='' OR EXISTS(SELECT 1 FROM import_rows r WHERE r.source_id=s.id AND r.disposition='pending'))",[],|r|r.get(0)).map_err(err)?,
            workspace: self.workspace.clone(),
            month: month.map(str::to_owned),
            opening_date: opening.as_ref().map(|o| o.date.clone()),
            opening_cents: 0,
            opening_adjustment_cents: 0,
            closing_cents: 0,
            bills_cents: 0,
            everyday_cents: 0,
            unassigned_cents: 0,
            repayment_cents: 0,
            pending_count: 0,
            rows: Vec::new(),
        };
        let mut rows = Vec::new();
        if let Some(o) = opening {
            rows.push(StatementRow {
                reporting_month: o.date[..7].to_string(),
                entry: None,
                date: o.date,
                description: "Reconciled opening balance".into(),
                kind: "opening".into(),
                group: "opening".into(),
                group_reason: "Starting household balance, not spending or income".into(),
                override_group: None,
                full_cents: 0,
                jacob_cents: 0,
                chelsea_cents: 0,
                delta_cents: o.amount_cents,
                balance_cents: 0,
            });
        }
        // entries are reverse chronological, including same-day creation order.
        for e in entries.into_iter().rev() {
            if e.pending.is_some() && month.is_none_or(|m| e.reporting_month() == m) {
                report.pending_count += 1;
            }
            if !relevant(&e) {
                continue;
            }
            let (group, reason, over) = group_for(&e, &groups, &linked, &all);
            let sign = if e.kind == "refund" { -1 } else { 1 };
            rows.push(StatementRow {
                reporting_month: e.reporting_month().into(),
                date: e.date.clone(),
                description: e.description.clone(),
                kind: e.kind.clone(),
                group,
                group_reason: reason,
                override_group: over,
                full_cents: e.amount_cents * sign,
                jacob_cents: e.jacob_cents * sign,
                chelsea_cents: e.chelsea_cents * sign,
                delta_cents: e.household_delta_cents,
                balance_cents: 0,
                entry: Some(e),
            });
        }
        // Stable sort preserves creation order for same-day entries.
        rows.sort_by(|a, b| {
            a.reporting_month
                .cmp(&b.reporting_month)
                .then_with(|| a.date.cmp(&b.date))
        });
        let mut balance = 0;
        for mut row in rows {
            balance += row.delta_cents;
            let period = row.reporting_month.as_str();
            if month.is_some_and(|m| period < m) {
                report.opening_cents = balance;
                continue;
            }
            if month.is_some_and(|m| period > m) {
                break;
            }
            row.balance_cents = balance;
            if row.kind == "opening" {
                report.opening_adjustment_cents += row.delta_cents;
            } else if row.kind == "settlement" {
                report.repayment_cents += row.delta_cents;
            } else {
                match row.group.as_str() {
                    "bills" => report.bills_cents += row.delta_cents,
                    "everyday" => report.everyday_cents += row.delta_cents,
                    _ => report.unassigned_cents += row.delta_cents,
                }
            }
            report.rows.push(row);
        }
        report.closing_cents = report
            .rows
            .last()
            .map(|r| r.balance_cents)
            .unwrap_or(report.opening_cents);
        Ok(report)
    }
    pub fn set_household_group(
        &mut self,
        event: &str,
        revision: i64,
        group: Option<&str>,
    ) -> Result<()> {
        if group.is_some_and(|g| !["bills", "everyday", "unassigned"].contains(&g)) {
            return Err("Choose Bills, Everyday, Unassigned, or Automatic.".into());
        }
        let e = self
            .entries(None)?
            .into_iter()
            .find(|e| e.id == event)
            .ok_or("Transaction no longer exists.")?;
        if !relevant(&e) {
            return Err(
                "Only confirmed household purchases, refunds and repayments can be grouped.".into(),
            );
        }
        if revision != e.revision {
            return Err("Transaction changed. Reload before changing its group.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if let Some(g) = group {
            tx.execute("INSERT INTO household_groups VALUES (?1,?2) ON CONFLICT(event_id) DO UPDATE SET group_name=excluded.group_name",params![event,g]).map_err(err)?;
        } else {
            tx.execute("DELETE FROM household_groups WHERE event_id=?1", [event])
                .map_err(err)?;
        }
        let changed = tx
            .execute(
                "UPDATE events SET revision=revision+1 WHERE id=?1 AND revision=?2",
                params![event, revision],
            )
            .map_err(err)?;
        if changed != 1 {
            return Err("Transaction changed. Reload before saving.".into());
        }
        tx.execute(
            "INSERT INTO audit(event_id,action,payload) VALUES (?1,'household_group',?2)",
            params![event, group.unwrap_or("automatic")],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let bad:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM household_groups g JOIN events e ON e.id=g.event_id WHERE g.group_name NOT IN ('bills','everyday','unassigned') OR e.kind NOT IN ('expense','debt_payment','refund','settlement') OR EXISTS(SELECT 1 FROM pending_activity p WHERE p.event_id=e.id))",[],|r|r.get(0)).map_err(err)?;
    if bad {
        return Err("Backup has invalid household reporting groups.".into());
    }
    Ok(())
}
fn decimal(n: i64) -> String {
    format!(
        "{}{}.{:02}",
        if n < 0 { "-" } else { "" },
        n.unsigned_abs() / 100,
        n.unsigned_abs() % 100
    )
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn csv_text(s: &str) -> String {
    // Spreadsheet programs may execute formulas even when the field is quoted.
    let clean = s.replace(['\r', '\n', '\t'], " ");
    if clean.trim_start().starts_with(['=', '+', '-', '@']) {
        format!("'{clean}")
    } else {
        clean
    }
}
impl Statement {
    pub fn render(&self, format: &str) -> Result<String> {
        let title = format!(
            "Jacob & Chelsea — {} — {} workspace",
            self.month.as_deref().unwrap_or("All recorded history"),
            self.workspace
        );
        let summary = [
            ("Balance before period", self.opening_cents),
            (
                "Opening adjustment in period",
                self.opening_adjustment_cents,
            ),
            ("Bills net change", self.bills_cents),
            ("Everyday net change", self.everyday_cents),
            ("Unassigned net change", self.unassigned_cents),
            ("Repayments net change", self.repayment_cents),
            ("Balance at period end", self.closing_cents),
        ];
        let warning=format!("USD. Positive balance/change means Chelsea owes Jacob; negative means Jacob owes Chelsea. Repayments do not create spending. Groups describe whole transactions, not separate debts. Monthly statements follow budget periods, including explicit late-entry overrides; actual dates remain shown. Refunds use their received month unless explicitly overridden. Recorded activity only; {} unresolved recorded movements in this period and {} incomplete import sources in the workspace. {}",self.pending_count,self.incomplete_sources,if self.opening_date.is_none(){"No reconciled opening balance is set."}else{"The reconciled opening is included once."});
        if format == "csv" {
            let mut w = csv::WriterBuilder::new()
                .flexible(true)
                .from_writer(Vec::new());
            w.write_record([csv_text(&title)]).map_err(err)?;
            w.write_record([warning]).map_err(err)?;
            for (label, n) in summary {
                w.write_record([label.to_string(), decimal(n)])
                    .map_err(err)?;
            }
            w.write_record([
                "Date",
                "Budget month",
                "Type",
                "Group",
                "Description",
                "Paid/received by",
                "Full amount USD",
                "Jacob share USD",
                "Chelsea share USD",
                "Household change USD",
                "Running balance USD",
            ])
            .map_err(err)?;
            for r in &self.rows {
                w.write_record([
                    r.date.clone(),
                    r.reporting_month.clone(),
                    r.kind.clone(),
                    r.group.clone(),
                    csv_text(&r.description),
                    r.entry
                        .as_ref()
                        .map(|e| e.payer.clone())
                        .unwrap_or_default(),
                    decimal(r.full_cents),
                    decimal(r.jacob_cents),
                    decimal(r.chelsea_cents),
                    decimal(r.delta_cents),
                    decimal(r.balance_cents),
                ])
                .map_err(err)?;
            }
            return String::from_utf8(w.into_inner().map_err(err)?).map_err(err);
        }
        if format != "html" {
            return Err("Choose HTML or CSV.".into());
        }
        let mut out=format!("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{}</title><style>body{{font:15px system-ui;color:#213039;margin:40px;max-width:1300px}}h1{{font-size:24px}}table{{border-collapse:collapse;width:100%;margin:24px 0}}th,td{{padding:9px;border-bottom:1px solid #ccd5da;text-align:left;vertical-align:top}}.n{{text-align:right;white-space:nowrap}}small,p{{line-height:1.6}}@media print{{body{{margin:0;font-size:10px}}thead{{display:table-header-group}}tr{{break-inside:avoid}}}}</style><h1>{}</h1><p>{}</p><p>Generated {}. No bank account details or private transaction notes are included.</p><table><tbody>",escape(&title),escape(&title),escape(&warning),escape(&self.generated_at));
        for (label, n) in summary {
            out += &format!("<tr><th>{label}</th><td class=n>${}</td></tr>", decimal(n));
        }
        out+="</tbody></table><table><thead><tr><th>Date</th><th>Type / group</th><th>Description</th><th>Paid / received by</th><th>Full amount</th><th>Jacob share</th><th>Chelsea share</th><th>Change</th><th>Running balance</th></tr></thead><tbody>";
        for r in &self.rows {
            out+=&format!("<tr><td>{}</td><td>{}<br>{}</td><td>{}</td><td>{}</td><td class=n>${}</td><td class=n>${}</td><td class=n>${}</td><td class=n>${}</td><td class=n>${}</td></tr>",format_args!("{}<br><small>Budget {}</small>",escape(&r.date),escape(&r.reporting_month)),escape(&r.kind),escape(&r.group),escape(&r.description),r.entry.as_ref().map(|e|escape(&e.payer)).unwrap_or_default(),decimal(r.full_cents),decimal(r.jacob_cents),decimal(r.chelsea_cents),decimal(r.delta_cents),decimal(r.balance_cents));
        }
        out+="</tbody></table><p>Open this file in a browser to print or save as PDF. This statement does not send or request a payment.</p></html>";
        Ok(out)
    }
    pub fn export(&self, directory: &Path, format: &str) -> Result<String> {
        let content = self.render(format)?;
        write_export(
            directory,
            &self.workspace,
            self.month.as_deref(),
            format,
            &content,
        )
    }
}

pub(super) fn write_export(
    directory: &Path,
    workspace: &str,
    month: Option<&str>,
    format: &str,
    content: &str,
) -> Result<String> {
    if !["html", "csv"].contains(&format) {
        return Err("Choose HTML or CSV.".into());
    }
    if let Some(m) = month {
        validate_month(m)?;
    }
    fs::create_dir_all(directory).map_err(err)?;
    let path = directory.join(format!(
        "Shared-{}-{}-{}.{}",
        workspace,
        month.unwrap_or("all"),
        Uuid::new_v4(),
        format
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(err)?;
    if let Err(e) = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
    {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(err(e));
    }
    Ok(path.to_string_lossy().into_owned())
}
