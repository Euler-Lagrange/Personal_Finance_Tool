use super::*;
use crate::imports::{parse, types::*, MAX_FILE_BYTES, MAX_ROWS};
use base64::Engine;
use std::collections::{HashMap, HashSet};

fn json<T: serde::Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(err)
}
fn decode<T: serde::de::DeserializeOwned>(value: String) -> Result<T> {
    serde_json::from_str(&value).map_err(|_| "Saved import data could not be read.".into())
}

#[derive(Default)]
struct CommitOptions {
    policy: Option<classification::Policy>,
    preferences: Option<classification::Preferences>,
    coverage: Option<identity::CoverageRequest>,
}
fn bulk_expense_reason(
    c: &Candidate,
    image: bool,
    identity: Option<&str>,
    has_matches: bool,
    policy: Option<&classification::Policy>,
) -> String {
    if image {
        return "Image and AI-assisted readings require individual confirmation.".into();
    }
    if !classification::reliable(c) || c.direction != "out" {
        return "Verify the posted USD purchase date, amount and direction individually.".into();
    }
    if identity != Some("new") || has_matches {
        return "Resolve source identity or possible existing matches individually.".into();
    }
    let purchase =
        if let Some(code) = policy.and_then(|p| p.types.iter().find(|t| t.code == c.source_type)) {
            code.kind == "expense"
        } else {
            ["", "purchase", "charge", "sale", "debit"]
                .contains(&c.source_type.trim().to_lowercase().as_str())
        };
    if !purchase {
        return "This source type needs individual classification before purchase batching.".into();
    }
    String::new()
}
impl Store {
    pub fn ingest(&mut self, name: &str, bytes: Vec<u8>, prepared: Prepared) -> Result<String> {
        if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
            return Err("File exceeds the 10 MB limit.".into());
        }
        if let Some(id) = self
            .conn
            .query_row(
                "SELECT id FROM import_sources WHERE fingerprint=?1 ORDER BY created_at DESC,rowid DESC LIMIT 1",
                [&prepared.fingerprint],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
        {
            return Ok(id);
        }
        let size: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(length(content)),0) FROM import_evidence",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if size + bytes.len() as i64 > 250 * 1024 * 1024 {
            return Err("Local import evidence has reached 250 MB. Larger evidence libraries are not supported in this preview.".into());
        }
        let name = std::path::Path::new(name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Import");
        if name.len() > 255 {
            return Err("Filename is too long.".into());
        }
        let mapping = parse::default_mapping(&prepared.dataset);
        let id = Uuid::new_v4().to_string();
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO import_evidence VALUES (?1,?2,?3,?4)",
            params![prepared.fingerprint, prepared.mime, prepared.format, bytes],
        )
        .map_err(err)?;
        tx.execute("INSERT INTO import_sources(id,fingerprint,name,mime,format,dataset_json,mapping_json,error) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",params![id,prepared.fingerprint,name,prepared.mime,prepared.format,json(&prepared.dataset)?,json(&mapping)?,prepared.error]).map_err(err)?;
        materialize(&tx, &id, &prepared.dataset, &mapping)?;
        pdf_tables::auto_stage(&tx, &id)?;
        pdf_routes::auto_apply(&tx, &id)?;
        periods::commit(tx)?;
        Ok(id)
    }
    pub fn import_list(&self) -> Result<Vec<SourceSummary>> {
        let mut stmt=self.conn.prepare("SELECT s.id,s.revision,s.name,s.format,s.account_id,s.error,s.created_at,s.dismissed,s.configured,
          COUNT(r.id),COALESCE(SUM(r.disposition='pending'),0),COALESCE(SUM(r.disposition='imported'),0),COALESCE(SUM(r.disposition='linked'),0),COALESCE(SUM(r.disposition='excluded'),0),COALESCE(SUM(EXISTS(SELECT 1 FROM pending_activity p WHERE p.event_id=r.event_id)),0)
          FROM import_sources s LEFT JOIN import_rows r ON r.source_id=s.id GROUP BY s.id ORDER BY s.created_at DESC,s.id").map_err(err)?;
        let result = stmt
            .query_map([], |r| {
                let pending: i64 = r.get(10)?;
                let classification: i64 = r.get(14)?;
                let error: String = r.get(5)?;
                let configured: bool = r.get(8)?;
                let dismissed: bool = r.get(7)?;
                Ok(SourceSummary {
                    id: r.get(0)?,
                    revision: r.get(1)?,
                    name: r.get(2)?,
                    format: r.get(3)?,
                    account_id: r.get(4)?,
                    state: if dismissed {
                        "dismissed"
                    } else if !error.is_empty() {
                        "error"
                    } else if !configured {
                        "unconfigured"
                    } else if pending > 0 || classification > 0 {
                        "review"
                    } else {
                        "complete"
                    }
                    .into(),
                    error,
                    row_count: r.get(9)?,
                    pending_count: pending,
                    classification_count: classification,
                    imported_count: r.get(11)?,
                    linked_count: r.get(12)?,
                    excluded_count: r.get(13)?,
                    created_at: r.get(6)?,
                })
            })
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err);
        result
    }
    pub fn import_detail(&self, id: &str) -> Result<SourceDetail> {
        let source = self
            .import_list()?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or("Import no longer exists.")?;
        let (dataset, mapping, mime, content): (String, String, String, Vec<u8>) = self
            .conn
            .query_row(
                "SELECT s.dataset_json,s.mapping_json,s.mime,e.content FROM import_sources s JOIN import_evidence e ON e.fingerprint=s.fingerprint WHERE s.id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(err)?;
        let dataset: Dataset = decode(dataset)?;
        let mapping = decode(mapping)?;
        let preview_url = if source.format == "image" {
            Some(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(content)
            ))
        } else {
            None
        };
        let overlap = identity::plan(&self.conn, id)?;
        let identity_actions: HashMap<&str, &str> = overlap
            .items
            .iter()
            .map(|i| (i.row_id.as_str(), i.action.as_str()))
            .collect();
        let mut stmt=self.conn.prepare("SELECT id,ordinal,raw_json,candidate_json,disposition,event_id FROM import_rows WHERE source_id=?1 ORDER BY ordinal").map_err(err)?;
        let mut cursor = stmt.query([id]).map_err(err)?;
        let mut rows = Vec::new();
        let pending_entries: HashMap<String, Entry> = self
            .entries(None)?
            .into_iter()
            .filter(|e| e.pending.is_some())
            .map(|e| (e.id.clone(), e))
            .collect();
        let rules = rules::list(&self.conn)?;
        let source_policy = classification::policy(&self.conn, id)?;
        while let Some(r) = cursor.next().map_err(err)? {
            let candidate: Candidate = decode(r.get(3).map_err(err)?)?;
            let matches = if let Some(account) = source.account_id.as_deref() {
                review_matches_for(&self.conn, account, &candidate)?
            } else {
                vec![]
            };
            let mut suggestion = rules::suggest_for(
                &self.conn,
                &rules,
                source.account_id.as_deref().unwrap_or(""),
                &candidate,
                None,
                source_policy
                    .as_ref()
                    .map_or("personal", |p| p.ownership.as_str()),
            )?;
            let row_id: String = r.get(0).map_err(err)?;
            let bulk_reason = bulk_expense_reason(
                &candidate,
                dataset.image || dataset.assisted,
                identity_actions.get(row_id.as_str()).copied(),
                !matches.is_empty(),
                source_policy.as_ref(),
            );
            if !bulk_reason.is_empty() {
                suggestion.ready = false;
            }
            rows.push(ReviewRow {
                merchant: rules::normalize(&candidate.description),
                bulk_expense_reason: bulk_reason,
                pending_entry: r
                    .get::<_, Option<String>>(5)
                    .map_err(err)?
                    .and_then(|id| pending_entries.get(&id).cloned()),
                suggestion,
                id: row_id,
                ordinal: r.get(1).map_err(err)?,
                raw: decode(r.get(2).map_err(err)?)?,
                candidate,
                disposition: r.get(4).map_err(err)?,
                event_id: r.get(5).map_err(err)?,
                matches,
            });
        }
        let undo_id=self.conn.query_row("SELECT id FROM import_commits WHERE source_id=?1 AND undone=0 ORDER BY created_at DESC,rowid DESC LIMIT 1",[id],|r|r.get(0)).optional().map_err(err)?;
        Ok(SourceDetail {
            classification_profile: classification::profile(&self.conn, id, true)?,
            classification_policy: classification::policy(&self.conn, id)?,
            source,
            dataset,
            mapping,
            rows,
            preview_url,
            undo_id,
            coverage: identity::coverage(&self.conn, id)?,
            overlap,
            observation: observations::observation(&self.conn, id)?,
            download_profile: observations::profile(&self.conn, id)?,
        })
    }
    pub fn import_content(&self, id: &str) -> Result<(String, Vec<u8>)> {
        self.conn
            .query_row(
                "SELECT s.name,e.content FROM import_sources s JOIN import_evidence e ON e.fingerprint=s.fingerprint WHERE s.id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)
    }
    pub fn import_sheet(&mut self, id: &str, revision: i64, prepared: Prepared) -> Result<()> {
        ai_rows::protect_reextract(&self.conn, id)?;
        pdf_tables::protect_reextract(&self.conn, id)?;
        pdf_documents::protect_source(&self.conn, id)?;
        let tx = self.conn.transaction().map_err(err)?;
        editable(&tx, id, revision)?;
        let mapping = parse::default_mapping(&prepared.dataset);
        tx.execute("UPDATE import_sources SET dataset_json=?1,mapping_json=?2,error=?3,configured=0,revision=revision+1 WHERE id=?4",params![json(&prepared.dataset)?,json(&mapping)?,prepared.error,id]).map_err(err)?;
        identity::invalidate_coverage(&tx, id)?;
        tx.execute("DELETE FROM import_classification WHERE source_id=?1", [id])
            .map_err(err)?;
        materialize(&tx, id, &prepared.dataset, &mapping)?;
        periods::commit(tx)
    }
    pub fn import_profile(&self, id: &str, account: &str) -> Result<Option<Mapping>> {
        let d: Dataset = decode(
            self.conn
                .query_row(
                    "SELECT dataset_json FROM import_sources WHERE id=?1",
                    [id],
                    |r| r.get(0),
                )
                .map_err(err)?,
        )?;
        self.conn
            .query_row(
                "SELECT mapping_json FROM import_profiles WHERE account_id=?1 AND header_key=?2",
                params![account, parse::hash(json(&d.headers)?.as_bytes())],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
            .map(decode)
            .transpose()
    }
    pub fn configure_import(
        &mut self,
        id: &str,
        revision: i64,
        account: &str,
        mapping: Mapping,
    ) -> Result<()> {
        let tx = self.conn.transaction().map_err(err)?;
        configure(&tx, id, revision, account, &mapping)?;
        periods::commit(tx)
    }
    pub fn dismiss_import(&mut self, id: &str, revision: i64, dismissed: bool) -> Result<()> {
        if self.conn.execute("UPDATE import_sources SET dismissed=?1,revision=revision+1 WHERE id=?2 AND revision=?3",params![dismissed,id,revision]).map_err(err)?!=1{return Err("Import changed. Refresh and try again.".into());}
        Ok(())
    }
    pub fn commit_import(
        &mut self,
        id: &str,
        revision: i64,
        commit_id: &str,
        decisions: Vec<Decision>,
    ) -> Result<Receipt> {
        self.commit_import_impl(id, revision, commit_id, decisions, CommitOptions::default())
    }
    #[cfg(test)]
    pub fn process_import(
        &mut self,
        id: &str,
        revision: i64,
        commit_id: &str,
        policy: classification::Policy,
    ) -> Result<Receipt> {
        self.process_import_with_preferences(id, revision, commit_id, policy, None)
    }
    pub fn process_import_with_preferences(
        &mut self,
        id: &str,
        revision: i64,
        commit_id: &str,
        policy: classification::Policy,
        preferences: Option<classification::Preferences>,
    ) -> Result<Receipt> {
        policy.validate()?;
        self.commit_import_impl(
            id,
            revision,
            commit_id,
            Vec::new(),
            CommitOptions {
                policy: Some(policy),
                preferences,
                coverage: None,
            },
        )
    }
    pub fn finalize_import_coverage(
        &mut self,
        id: &str,
        revision: i64,
        commit_id: &str,
        coverage: identity::CoverageRequest,
    ) -> Result<Receipt> {
        self.commit_import_impl(
            id,
            revision,
            commit_id,
            Vec::new(),
            CommitOptions {
                coverage: Some(coverage),
                ..Default::default()
            },
        )
    }
    fn commit_import_impl(
        &mut self,
        id: &str,
        revision: i64,
        commit_id: &str,
        mut decisions: Vec<Decision>,
        options: CommitOptions,
    ) -> Result<Receipt> {
        let CommitOptions {
            mut policy,
            preferences,
            coverage,
        } = options;
        Uuid::parse_str(commit_id).map_err(|_| "Invalid import operation.")?;
        if (decisions.is_empty() && policy.is_none() && coverage.is_none())
            || decisions.len() > MAX_ROWS
        {
            return Err("Choose between 1 and 5,000 rows.".into());
        }
        let identity_only = policy.is_none()
            && coverage.is_none()
            && decisions
                .iter()
                .all(|d| matches!(d.action.as_str(), "identity_link" | "identity_exclude"));
        let payload_hash = parse::hash(
            if let Some(c) = &coverage {
                format!("{id}:coverage:{}", json(c)?)
            } else if let Some(p) = &policy {
                if let Some(settings) = &preferences {
                    format!("{id}:automatic:{}:{}", json(p)?, json(settings)?)
                } else {
                    format!("{id}:automatic:{}", json(p)?)
                }
            } else {
                format!("{id}:{}", json(&decisions)?)
            }
            .as_bytes(),
        );
        let previous: Option<(String, String, bool)> = self
            .conn
            .query_row(
                "SELECT payload_hash,receipt_json,undone FROM import_commits WHERE id=?1",
                [commit_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(err)?;
        if let Some((hash, receipt, undone)) = previous {
            if hash != payload_hash || undone {
                return Err(
                    "This operation was already used or undone. Refresh the import.".into(),
                );
            }
            let mut receipt: Receipt = decode(receipt)?;
            receipt.already_processed = true;
            return Ok(receipt);
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let account:String=tx.query_row("SELECT account_id FROM import_sources WHERE id=?1 AND revision=?2 AND configured=1 AND dismissed=0",params![id,revision],|r|r.get(0)).map_err(|_|"Import changed or needs account/column setup. Refresh and try again.")?;
        let account_kind: String = tx
            .query_row(
                "SELECT kind FROM accounts WHERE id=?1 AND archived=0",
                [&account],
                |r| r.get(0),
            )
            .map_err(|_| "This account is archived. Restore it before importing.")?;
        if let Some(c) = coverage {
            identity::write_coverage(&tx, id, revision, c.input, c.pattern)?;
            policy = classification::profile(&tx, id, false)?
                .filter(|p| p.automatic && c.process_saved_defaults)
                .map(|p| p.policy);
        }
        let mut seen = HashSet::new();
        let identity_plan = identity::plan(&tx, id)?;
        let rules = rules::list(&tx)?;
        if let Some(p) = &policy {
            decisions = classification::decisions(&tx, id, &identity_plan, p)?;
        }
        let source_policy = classification::policy(&tx, id)?;
        let source_dataset: Dataset = decode(
            tx.query_row(
                "SELECT dataset_json FROM import_sources WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?,
        )?;
        let mut pending_details = HashMap::new();
        for decision in &mut decisions {
            if decision.action == "bulk_expense" {
                let raw: String = tx
                    .query_row(
                        "SELECT candidate_json FROM import_rows WHERE id=?1 AND source_id=?2",
                        params![decision.row_id, id],
                        |r| r.get(0),
                    )
                    .map_err(|_| "Source row changed. Reload review.")?;
                let c: Candidate = decode(raw)?;
                let identity = identity_plan
                    .items
                    .iter()
                    .find(|i| i.row_id == decision.row_id)
                    .map(|i| i.action.as_str());
                let why = bulk_expense_reason(
                    &c,
                    source_dataset.image || source_dataset.assisted,
                    identity,
                    !matches_for(&tx, &account, &c)?.is_empty(),
                    source_policy.as_ref(),
                );
                if !why.is_empty() {
                    return Err(why);
                }
                let input = decision
                    .input
                    .as_ref()
                    .ok_or("Complete the purchase choices.")?;
                if input.kind != "expense"
                    || input.account_id.as_deref() != Some(&account)
                    || input.payer != "jacob"
                    || Some(input.date.as_str()) != c.date.as_deref()
                    || Some(money::cents(&input.amount)?) != c.amount_cents
                    || input.description != c.description
                    || !input.lines.is_empty()
                {
                    return Err("Bulk purchases must preserve the verified source values. Correct uncertain rows individually.".into());
                }
                decision.action = "add".into();
            }
            if decision.action == "code_link" {
                decision.action = "link".into();
            }
            if decision.action == "automatic" {
                let p = policy
                    .as_ref()
                    .ok_or("Use the verified processing action for automatic classification.")?;
                let raw: String = tx
                    .query_row(
                        "SELECT candidate_json FROM import_rows WHERE id=?1 AND source_id=?2",
                        params![decision.row_id, id],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                let c: Candidate = decode(raw)?;
                let (input, pending) = classification::classify(
                    &tx,
                    &account,
                    &account_kind,
                    &decision.row_id,
                    &c,
                    p,
                    &rules,
                )?;
                if let Some(details) = pending {
                    pending_details.insert(decision.row_id.clone(), details);
                }
                decision.input = Some(input);
                decision.action = "add".into();
            }
            if decision.action == "apply_rule" {
                if !identity_plan
                    .items
                    .iter()
                    .any(|i| i.row_id == decision.row_id && i.action == "new")
                {
                    return Err("Source identity needs reconciliation or individual review before applying merchant rules.".into());
                }
                let raw: String = tx
                    .query_row(
                        "SELECT candidate_json FROM import_rows WHERE id=?1 AND source_id=?2",
                        params![decision.row_id, id],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                let c: Candidate = decode(raw)?;
                let why = bulk_expense_reason(
                    &c,
                    source_dataset.image || source_dataset.assisted,
                    Some("new"),
                    !matches_for(&tx, &account, &c)?.is_empty(),
                    source_policy.as_ref(),
                );
                if !why.is_empty() {
                    return Err(why);
                }
                let s = rules::suggest_for(
                    &tx,
                    &rules,
                    &account,
                    &c,
                    None,
                    source_policy
                        .as_ref()
                        .map_or("personal", |p| p.ownership.as_str()),
                )?;
                if !s.ready || decision.rule_signature.as_deref() != Some(s.signature.as_str()) {
                    return Err("Rule suggestions changed or this row requires individual review. Reload the source before applying rules.".into());
                }
                let amount = c.amount_cents.ok_or("Amount needs review.")?;
                decision.input = Some(EntryInput {
                    budget_override: None,
                    id: decision.row_id.clone(),
                    revision: 0,
                    kind: "expense".into(),
                    date: c.date.ok_or("Date needs review.")?,
                    description: c.description,
                    amount: format!("{}.{:02}", amount / 100, amount % 100),
                    payer: "jacob".into(),
                    category_id: s.category_id,
                    account_id: Some(account.clone()),
                    destination_account_id: None,
                    original_event_id: None,
                    paypal: None,
                    lines: Vec::new(),
                    split_mode: s.split_mode,
                    split_value: s.split_value,
                    note: s
                        .explanations
                        .join("; ")
                        .chars()
                        .scan(0, |size, ch| {
                            *size += ch.len_utf8();
                            (*size <= 2000).then_some(ch)
                        })
                        .collect(),
                });
                decision.action = "add".into();
            }
        }
        let mut trusted = HashMap::new();
        for d in &mut decisions {
            if matches!(d.action.as_str(), "identity_link" | "identity_exclude") {
                let expected = if d.action == "identity_link" {
                    "link"
                } else {
                    "exclude"
                };
                let item = identity_plan
                    .items
                    .iter()
                    .find(|i| i.row_id == d.row_id && i.action == expected)
                    .ok_or("Occurrence evidence changed. Refresh before reconciling.")?
                    .clone();
                d.action = expected.into();
                d.match_id = item.event_id.clone();
                d.match_revision = item.event_revision;
                trusted.insert(d.row_id.clone(), item);
            }
        }
        let mut linked_ids = HashSet::new();
        // Validate against pre-commit data, so legitimate equal rows in this batch are not mistaken for reimports.
        for d in &decisions {
            if !seen.insert(d.row_id.clone()) {
                return Err("A row was selected twice.".into());
            }
            let (candidate,disposition):(String,String)=tx.query_row("SELECT candidate_json,disposition FROM import_rows WHERE id=?1 AND source_id=?2",params![d.row_id,id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|"Import row no longer exists.")?;
            if disposition != "pending" {
                return Err(
                    "A selected row was already processed. Refresh before continuing.".into(),
                );
            }
            if !d.confirmed {
                return Err(
                    "Confirm the selected rows against their source before importing.".into(),
                );
            }
            let candidate: Candidate = decode(candidate)?;
            if d.action == "exclude" {
                continue;
            }
            if candidate.currency != "USD" {
                return Err(
                    "Only verified USD source rows can post. Correct the currency mapping first."
                        .into(),
                );
            }
            if candidate.status != "posted" {
                return Err("Pending or unknown-status rows must stay on hold. Confirm posted status in the source mapping first.".into());
            }
            if d.action == "link" {
                let match_id = d
                    .match_id
                    .as_deref()
                    .ok_or("Choose an existing transaction.")?;
                if !linked_ids.insert(match_id) {
                    return Err(
                        "Two rows cannot both link to the same transaction in one source.".into(),
                    );
                }
                let duplicate:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM import_rows WHERE source_id=?1 AND event_id=?2 AND disposition IN ('linked','imported'))",params![id,match_id],|r|r.get(0)).map_err(err)?;
                if duplicate
                    || (!trusted.contains_key(&d.row_id)
                        && !review_matches_for(&tx, &account, &candidate)?
                            .iter()
                            .any(|m| m.id == match_id && Some(m.revision) == d.match_revision))
                {
                    return Err("Matching transaction changed or is already represented in this source. Refresh and review.".into());
                }
            } else if d.action == "add" {
                let input = d
                    .input
                    .as_ref()
                    .ok_or("Complete the transaction details.")?;
                if input.id != d.row_id || input.revision != 0 {
                    return Err("Imported rows can only create their own new transaction.".into());
                }
                if input.date > Local::now().format("%Y-%m-%d").to_string() {
                    return Err("Future transactions must stay on hold.".into());
                }
                let direction = if let Some(p) = pending_details.get(&d.row_id) {
                    p.direction.as_str()
                } else {
                    event_direction(input, &account, &account_kind)?
                };
                if candidate.direction != "unknown" && candidate.direction != direction {
                    return Err("Transaction type conflicts with the source debit/credit direction. Correct the mapping first.".into());
                }
                let amount = money::cents(&input.amount)?;
                let corrected = Candidate {
                    date: Some(input.date.clone()),
                    amount_cents: Some(amount),
                    direction: direction.into(),
                    ..candidate.clone()
                };
                if !d.separate && !matches_for(&tx, &account, &corrected)?.is_empty() {
                    return Err("Possible duplicate found. Link the existing record or confirm that this is a separate transaction.".into());
                }
            } else {
                return Err("Unsupported import decision.".into());
            }
        }
        let mut receipt = Receipt {
            added: 0,
            linked: 0,
            excluded: 0,
            already_processed: false,
        };
        tx.execute("INSERT INTO import_commits(id,source_id,payload_hash,receipt_json) VALUES (?1,?2,?3,'{}')",params![commit_id,id,payload_hash]).map_err(err)?;
        for d in decisions {
            let (disposition, event_id, event_revision) = match d.action.as_str() {
                "add" => {
                    let input = d.input.unwrap();
                    if let Some(p) = pending_details.get(&d.row_id) {
                        classification::record(&tx, &input, p, &account_kind)?;
                    } else {
                        Self::write_entry(&tx, input)?;
                    }
                    let raw: String = tx
                        .query_row(
                            "SELECT candidate_json FROM import_rows WHERE id=?1",
                            [&d.row_id],
                            |r| r.get(0),
                        )
                        .map_err(err)?;
                    let candidate: Candidate = decode(raw)?;
                    if candidate.warnings.is_empty() {
                        if let Some(date) = candidate.posted_date {
                            movements::write_dates(
                                &tx,
                                &d.row_id,
                                &[movements::ActivityDate {
                                    account_id: account.clone(),
                                    date,
                                }],
                            )?;
                        }
                    }
                    receipt.added += 1;
                    ("imported", Some(d.row_id.clone()), Some(1))
                }
                "link" => {
                    let is_movement: bool = tx
                        .query_row(
                            "SELECT kind IN ('transfer','card_payment') FROM events WHERE id=?1",
                            [d.match_id.as_deref().unwrap()],
                            |r| r.get(0),
                        )
                        .map_err(err)?;
                    if is_movement {
                        let raw: String = tx
                            .query_row(
                                "SELECT candidate_json FROM import_rows WHERE id=?1",
                                [&d.row_id],
                                |r| r.get(0),
                            )
                            .map_err(err)?;
                        let candidate: Candidate = decode(raw)?;
                        if classification::reliable(&candidate) {
                            payment_codes::link_date(
                                &tx,
                                &d.row_id,
                                &account,
                                d.match_id.as_deref().unwrap(),
                                &candidate,
                            )?;
                        }
                    }
                    receipt.linked += 1;
                    ("linked", d.match_id, d.match_revision)
                }
                _ => {
                    receipt.excluded += 1;
                    ("excluded", None, None)
                }
            };
            tx.execute("UPDATE import_rows SET disposition=?1,event_id=?2,event_revision=?3,commit_id=?4 WHERE id=?5",params![disposition,event_id,event_revision,commit_id,d.row_id]).map_err(err)?;
        }
        identity::attach(&tx, id, commit_id, &identity_plan, &seen, &trusted)?;
        if let Some(p) = &policy {
            tx.execute("INSERT INTO import_classification VALUES (?1,?2) ON CONFLICT(source_id) DO UPDATE SET policy_json=excluded.policy_json",params![id,json(p)?]).map_err(err)?;
            if let Some(settings) = &preferences {
                classification::remember(&tx, id, p, settings)?;
            }
        }
        tx.execute(
            "UPDATE import_commits SET receipt_json=?1,identity_only=?3 WHERE id=?2",
            params![json(&receipt)?, commit_id, identity_only],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE import_sources SET revision=revision+1 WHERE id=?1",
            [id],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('import',?1)",
            [format!("{commit_id}:{}", json(&receipt)?)],
        )
        .map_err(err)?;
        periods::commit(tx)?;
        Ok(receipt)
    }
    pub fn undo_import(&mut self, commit_id: &str) -> Result<()> {
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let (source, undone): (String, bool) = tx
            .query_row(
                "SELECT source_id,undone FROM import_commits WHERE id=?1",
                [commit_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "Import operation no longer exists.")?;
        if undone {
            return Ok(());
        }
        movements::protect_import_undo(&tx, commit_id)?;
        identity::protect_undo(&tx, commit_id)?;
        let mut stmt=tx.prepare("SELECT r.event_id,r.event_revision FROM import_rows r LEFT JOIN events e ON e.id=r.event_id WHERE r.commit_id=?1 AND r.disposition='imported' ORDER BY CASE WHEN e.kind='refund' THEN 0 ELSE 1 END,e.rowid DESC").map_err(err)?;
        let events = stmt
            .query_map([commit_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        drop(stmt);
        for (event, revision) in &events {
            let current: Option<i64> = tx
                .query_row("SELECT revision FROM events WHERE id=?1", [event], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(err)?;
            let referenced: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM import_rows WHERE event_id=?1 AND commit_id!=?2)",
                    params![event, commit_id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if current != Some(*revision) || referenced {
                return Err("Undo is unavailable because an imported transaction was edited, deleted, or linked by another import. Review those records individually.".into());
            }
            let later_refund:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM events own JOIN events later ON later.original_event_id=own.original_event_id AND later.rowid>own.rowid WHERE own.id=?1 AND NOT EXISTS(SELECT 1 FROM import_rows r WHERE r.event_id=later.id AND r.commit_id=?2 AND r.disposition='imported'))",params![event,commit_id],|r|r.get(0)).map_err(err)?;
            if later_refund {
                return Err("Undo would change a later refund outside this import. Review those refunds individually.".into());
            }
        }
        for (event, _) in events {
            refunds::protect_delete(&tx, &event)?;
            bills::protect_delete(&tx, &event)?;
            cash_plans::protect_delete(&tx, &event)?;
            super::pay_cash::protect_delete(&tx, &event)?;
            super::card_payments::protect_delete(&tx, &event)?;
            household::protect_delete(&tx, &event)?;
            goals::protect_delete(&tx, &event)?;
            let original: Option<String> = tx
                .query_row(
                    "SELECT original_event_id FROM events WHERE id=?1",
                    [&event],
                    |r| r.get(0),
                )
                .map_err(err)?;
            tx.execute("DELETE FROM events WHERE id=?1", [event])
                .map_err(err)?;
            if let Some(original) = original {
                refunds::recalculate(&tx, &original, None)?;
            }
        }
        tx.execute("DELETE FROM import_account_dates WHERE row_id IN (SELECT id FROM import_rows WHERE commit_id=?1)",[commit_id]).map_err(err)?;
        tx.execute("UPDATE import_rows SET disposition='pending',event_id=NULL,event_revision=NULL,commit_id=NULL,occurrence_id=NULL WHERE commit_id=?1",[commit_id]).map_err(err)?;
        identity::undo_identity(&tx, commit_id)?;
        tx.execute(
            "UPDATE import_commits SET undone=1 WHERE id=?1",
            [commit_id],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE import_sources SET revision=revision+1 WHERE id=?1",
            [source],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('undo_import',?1)",
            [commit_id],
        )
        .map_err(err)?;
        periods::commit(tx)
    }
}
pub(super) fn editable(tx: &Connection, id: &str, revision: i64) -> Result<()> {
    let current: i64 = tx
        .query_row(
            "SELECT revision FROM import_sources WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|_| "Import no longer exists.")?;
    if current != revision {
        return Err("Import changed. Refresh and try again.".into());
    }
    let processed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM import_rows WHERE source_id=?1 AND disposition!='pending')",[id],|r|r.get(0)).map_err(err)?;
    if processed {
        return Err("Account and columns are locked after rows are processed. Undo those operations before remapping.".into());
    }
    Ok(())
}
pub(super) fn materialize(
    tx: &Connection,
    id: &str,
    dataset: &Dataset,
    mapping: &Mapping,
) -> Result<()> {
    tx.execute("DELETE FROM import_rows WHERE source_id=?1", [id])
        .map_err(err)?;
    for (i, row) in dataset.rows.iter().enumerate() {
        tx.execute("INSERT INTO import_rows(id,source_id,ordinal,raw_json,candidate_json) VALUES (?1,?2,?3,?4,?5)",params![Uuid::new_v4().to_string(),id,i as i64,json(row)?,json(&parse::dataset_candidate(row,mapping,dataset))?]).map_err(err)?;
    }
    Ok(())
}
pub(super) fn matches_for(conn: &Connection, account: &str, c: &Candidate) -> Result<Vec<Match>> {
    match_candidates(conn, account, c, false)
}
pub(super) fn review_matches_for(
    conn: &Connection,
    account: &str,
    c: &Candidate,
) -> Result<Vec<Match>> {
    match_candidates(conn, account, c, true)
}
fn match_candidates(
    conn: &Connection,
    account: &str,
    c: &Candidate,
    distant_movements: bool,
) -> Result<Vec<Match>> {
    let (Some(date), Some(amount)) = (c.date.as_ref(), c.amount_cents) else {
        return Ok(vec![]);
    };
    let mut stmt=conn.prepare("SELECT e.id,e.revision,e.date,e.description,e.kind,e.amount_cents FROM events e JOIN account_activity a ON a.event_id=e.id JOIN accounts k ON k.id=a.account_id WHERE a.account_id=?1 AND e.amount_cents=?2 AND (ABS(julianday(e.date)-julianday(?3))<=3 OR (?5 AND e.kind IN ('card_payment','transfer'))) AND (?4='unknown' OR (CASE WHEN (CASE WHEN k.kind='credit' THEN -a.change_cents ELSE a.change_cents END)>0 THEN 'in' ELSE 'out' END)=?4) ORDER BY abs(julianday(e.date)-julianday(?3)),e.date,e.id LIMIT 50").map_err(err)?;
    let result = stmt
        .query_map(
            params![account, amount, date, c.direction, distant_movements],
            |r| {
                Ok(Match {
                    id: r.get(0)?,
                    revision: r.get(1)?,
                    date: r.get(2)?,
                    description: r.get(3)?,
                    kind: r.get(4)?,
                    amount_cents: r.get(5)?,
                })
            },
        )
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err);
    result
}
pub(super) fn event_direction(
    input: &EntryInput,
    account: &str,
    kind: &str,
) -> Result<&'static str> {
    let direction = match input.kind.as_str() {
        "refund" | "reward" | "paypal_cashout" if input.account_id.as_deref() == Some(account) => {
            Some("in")
        }
        "expense" | "debt_payment"
            if input.payer == "jacob" && input.account_id.as_deref() == Some(account) =>
        {
            Some("out")
        }
        "income" if kind != "credit" && input.account_id.as_deref() == Some(account) => Some("in"),
        "transfer" | "card_payment" if input.account_id.as_deref() == Some(account) => Some("out"),
        "transfer" | "card_payment" if input.destination_account_id.as_deref() == Some(account) => {
            Some("in")
        }
        "settlement" if input.account_id.as_deref() == Some(account) => {
            Some(if input.payer == "chelsea" {
                "in"
            } else {
                "out"
            })
        }
        _ => None,
    };
    direction.ok_or("The transaction must include the account this source belongs to, with a supported transaction type.".into())
}

pub(super) fn validate(conn: &Connection) -> Result<()> {
    for query in ["SELECT id,fingerprint,name,mime,format,account_id,revision,dataset_json,mapping_json,error,configured,dismissed,created_at FROM import_sources LIMIT 0","SELECT id,source_id,ordinal,raw_json,candidate_json,disposition,event_id,event_revision,commit_id FROM import_rows LIMIT 0","SELECT id,source_id,payload_hash,receipt_json,undone,created_at FROM import_commits LIMIT 0","SELECT account_id,header_key,mapping_json FROM import_profiles LIMIT 0"] {conn.prepare(query).map_err(|_|"Backup is missing import data. Current data was not changed.")?;}
    let invalid:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM import_rows r JOIN import_sources s ON s.id=r.source_id LEFT JOIN import_commits c ON c.id=r.commit_id WHERE r.ordinal<0 OR (r.disposition='pending' AND (r.event_id IS NOT NULL OR r.event_revision IS NOT NULL OR r.commit_id IS NOT NULL)) OR (r.disposition!='pending' AND (r.commit_id IS NULL OR c.source_id!=r.source_id OR c.undone!=0 OR s.configured!=1 OR s.account_id IS NULL)) OR (r.disposition IN ('imported','linked') AND (r.event_id IS NULL OR r.event_revision IS NULL OR r.event_revision<1)) OR (r.disposition='excluded' AND (r.event_id IS NOT NULL OR r.event_revision IS NOT NULL)) OR (r.disposition='imported' AND r.event_id!=r.id))",[],|r|r.get(0)).map_err(err)?;
    if invalid {
        return Err(
            "Backup import decisions are inconsistent. Current data was not changed.".into(),
        );
    }
    let mut stmt = conn
        .prepare("SELECT dataset_json,mapping_json FROM import_sources")
        .map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let d: Dataset = decode(row.get(0).map_err(err)?)?;
        if d.rows.len() > MAX_ROWS || d.headers.len() > 80 {
            return Err("Backup import dataset is too large.".into());
        }
        crate::imports::pdf::validate_pages(&d.pdf_pages)?;
        let _: Mapping = decode(row.get(1).map_err(err)?)?;
    }
    let mut stmt = conn
        .prepare("SELECT raw_json,candidate_json FROM import_rows")
        .map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let _: Vec<String> = decode(r.get(0).map_err(err)?)?;
        let _: Candidate = decode(r.get(1).map_err(err)?)?;
    }
    let mut stmt = conn
        .prepare("SELECT receipt_json FROM import_commits")
        .map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        let _: Receipt = decode(r.get(0).map_err(err)?)?;
    }
    Ok(())
}

pub(super) fn configure(
    c: &Connection,
    id: &str,
    revision: i64,
    account: &str,
    mapping: &Mapping,
) -> Result<()> {
    editable(c, id, revision)?;
    let active: bool = c
        .query_row(
            "SELECT archived=0 FROM accounts WHERE id=?1",
            [account],
            |r| r.get(0),
        )
        .map_err(|_| "Choose an account for this export.")?;
    if !active {
        return Err("Choose an active account.".into());
    }
    let d: Dataset = decode(
        c.query_row(
            "SELECT dataset_json FROM import_sources WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?,
    )?;
    parse::validate_mapping(mapping, &d)?;
    super::card_statements::protect_source_account(c, id, account)?;
    pdf_documents::protect_account(c, id, account)?;
    c.execute("UPDATE import_sources SET account_id=?1,mapping_json=?2,configured=1,dismissed=0,revision=revision+1 WHERE id=?3",params![account,json(mapping)?,id]).map_err(err)?;
    // Missing screenshot years and posted confirmation are confirmed for each document.
    let mut reusable = mapping.clone();
    reusable.year = None;
    reusable.posted_confirmed = false;
    c.execute("INSERT INTO import_profiles VALUES (?1,?2,?3) ON CONFLICT(account_id,header_key) DO UPDATE SET mapping_json=excluded.mapping_json",params![account,parse::hash(json(&d.headers)?.as_bytes()),json(&reusable)?]).map_err(err)?;
    identity::invalidate_coverage(c, id)?;
    c.execute("DELETE FROM import_classification WHERE source_id=?1", [id])
        .map_err(err)?;
    materialize(c, id, &d, mapping)?;

    Ok(())
}
