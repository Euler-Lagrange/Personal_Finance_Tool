use super::*;
use crate::imports::types::{Candidate, Match};

pub(super) struct Movement {
    kind: String,
    from: String,
    to: String,
    available: bool,
}
fn account(conn: &Connection, id: &str) -> Result<(String, bool)> {
    conn.query_row(
        "SELECT kind,archived=0 FROM accounts WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .map_err(|_| "Choose an existing counterpart account for each payment or transfer code.".into())
}
pub(super) fn validate_policy(
    conn: &Connection,
    source: &str,
    policy: &classification::Policy,
) -> Result<()> {
    policy.validate()?;
    let (kind, _) = account(conn, source)?;
    for code in &policy.types {
        if let Some(other) = &code.account_id {
            let (other_kind, _) = account(conn, other)?;
            let cash = |k: &str| matches!(k, "checking" | "savings");
            if source == other
                || match code.kind.as_str() {
                    "card_payment" => {
                        !((kind == "credit" && cash(&other_kind))
                            || (cash(&kind) && other_kind == "credit"))
                    }
                    "transfer" => !(cash(&kind) && cash(&other_kind)),
                    _ => true,
                }
            {
                return Err("A card payment needs one bank and one credit-card account; a transfer needs two different bank accounts.".into());
            }
        }
    }
    Ok(())
}
pub(super) fn movement(
    conn: &Connection,
    source: &str,
    c: &Candidate,
    policy: &classification::Policy,
) -> Result<Option<Movement>> {
    let Some(code) = policy.types.iter().find(|t| {
        t.code == c.source_type && matches!(t.kind.as_str(), "card_payment" | "transfer")
    }) else {
        return Ok(None);
    };
    let other = code
        .account_id
        .as_ref()
        .ok_or("Choose the counterpart account.")?;
    let (kind, active) = account(conn, source)?;
    let (_, other_active) = account(conn, other)?;
    if code.kind == "card_payment"
        && ((kind == "credit" && c.direction != "in") || (kind != "credit" && c.direction != "out"))
    {
        return Ok(None);
    }
    let (from, to) = if c.direction == "out" {
        (source, other.as_str())
    } else {
        (other.as_str(), source)
    };
    Ok(Some(Movement {
        kind: code.kind.clone(),
        from: from.into(),
        to: to.into(),
        available: active && other_active,
    }))
}
fn counterpart_pending(
    conn: &Connection,
    source: &str,
    c: &Candidate,
    movement: &Movement,
) -> Result<bool> {
    let other = if movement.from == source {
        &movement.to
    } else {
        &movement.from
    };
    let (kind, _) = account(conn, other)?;
    let amount = c.amount_cents.unwrap();
    let change = if (other == &movement.to) == (kind != "credit") {
        amount
    } else {
        -amount
    };
    conn.query_row("SELECT EXISTS(SELECT 1 FROM account_activity a JOIN events e ON e.id=a.event_id WHERE a.account_id=?1 AND e.kind='unclassified' AND a.change_cents=?2)",
        params![other,change], |r| r.get(0)).map_err(err)
}
pub(super) fn date_compatible(
    conn: &Connection,
    id: &str,
    source: &str,
    c: &Candidate,
) -> Result<bool> {
    let Some(date) = &c.posted_date else {
        return Ok(true);
    };
    let conflict: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM activity_dates WHERE event_id=?1 AND account_id=?2 AND date!=?3) OR EXISTS(SELECT 1 FROM import_account_dates p JOIN import_rows r ON r.id=p.row_id JOIN import_sources s ON s.id=r.source_id WHERE r.event_id=?1 AND s.account_id=?2 AND r.disposition='linked' AND p.date!=?3)", params![id,source,date], |r| r.get(0)).map_err(err)?;
    Ok(!conflict)
}
pub(super) enum Treatment {
    New,
    Link(Match),
    Hold,
}
// Exact source code + declared counterpart + one unrepresented compatible movement.
// A new stable ID may distinguish already represented same-amount records, but never two candidates.
pub(super) fn treatment(
    conn: &Connection,
    source: &str,
    c: &Candidate,
    movement: &Movement,
    new_identity: bool,
) -> Result<Treatment> {
    if !movement.available {
        return Ok(if new_identity {
            Treatment::New
        } else {
            Treatment::Hold
        });
    }
    let matches = imports::review_matches_for(conn, source, c)?;
    let mut unidentified = Vec::new();
    for m in &matches {
        let represented: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM import_occurrences WHERE account_id=?1 AND event_id=?2)", params![source,m.id], |r| r.get(0)).map_err(err)?;
        if !represented {
            unidentified.push(m);
        }
    }
    if unidentified.len() == 1 && (matches.len() == 1 || c.stable_id.is_some()) {
        let m = unidentified[0];
        let valid: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM events WHERE id=?1 AND kind=?2 AND account_id=?3 AND destination_account_id=?4)", params![m.id,movement.kind,movement.from,movement.to], |r| r.get(0)).map_err(err)?;
        let nearby = NaiveDate::parse_from_str(&m.date, "%Y-%m-%d")
            .map_err(err)?
            .signed_duration_since(
                NaiveDate::parse_from_str(c.date.as_ref().unwrap(), "%Y-%m-%d").map_err(err)?,
            )
            .num_days()
            .abs()
            <= 3;
        if valid
            && nearby
            && date_compatible(conn, &m.id, source, c)?
            && !counterpart_pending(conn, source, c, movement)?
        {
            return Ok(Treatment::Link(Match {
                id: m.id.clone(),
                revision: m.revision,
                date: m.date.clone(),
                description: m.description.clone(),
                kind: m.kind.clone(),
                amount_cents: m.amount_cents,
            }));
        }
    }
    if new_identity && unidentified.is_empty() {
        Ok(Treatment::New)
    } else {
        Ok(Treatment::Hold)
    }
}
pub(super) fn record_input(
    conn: &Connection,
    source: &str,
    id: &str,
    c: &Candidate,
    movement: &Movement,
) -> Result<(EntryInput, Option<classification::Pending>)> {
    let needs_review = !movement.available || counterpart_pending(conn, source, c, movement)?;
    let amount = c.amount_cents.unwrap();
    let pending = needs_review.then(|| classification::Pending {
        direction: c.direction.clone(),
        verified_expense: false,
        category_id: None,
        kind_hint: Some(movement.kind.clone()),
    });
    let from_name: String = conn
        .query_row(
            "SELECT name FROM accounts WHERE id=?1",
            [&movement.from],
            |r| r.get(0),
        )
        .map_err(err)?;
    let to_name: String = conn
        .query_row(
            "SELECT name FROM accounts WHERE id=?1",
            [&movement.to],
            |r| r.get(0),
        )
        .map_err(err)?;
    let note = format!(
        "Verified source code {}: {} from {} to {}.{}",
        c.source_type,
        if movement.kind == "card_payment" {
            "Card payment"
        } else {
            "Bank transfer"
        },
        from_name,
        to_name,
        if !movement.available {
            " Counterpart account is archived; review before completing the movement."
        } else if needs_review {
            " The other account already has possible pending activity; reconcile the two records."
        } else {
            " The other account's source may arrive later."
        }
    );
    Ok((
        EntryInput {
            budget_override: None,
            id: id.into(),
            revision: 0,
            kind: if needs_review {
                "unclassified".into()
            } else {
                movement.kind.clone()
            },
            date: c.date.clone().unwrap(),
            description: c.description.trim().into(),
            amount: format!("{}.{:02}", amount / 100, amount % 100),
            payer: "jacob".into(),
            category_id: None,
            account_id: Some(if needs_review {
                source.into()
            } else {
                movement.from.clone()
            }),
            destination_account_id: (!needs_review).then(|| movement.to.clone()),
            split_mode: "none".into(),
            split_value: String::new(),
            note,
            original_event_id: None,
            lines: Vec::new(),
            paypal: None,
        },
        pending,
    ))
}
pub(super) fn link_date(
    conn: &Connection,
    row: &str,
    source: &str,
    target: &str,
    c: &Candidate,
) -> Result<()> {
    if !date_compatible(conn, target, source, c)? {
        return Err(
            "The source posting date conflicts with the recorded movement. Review the match."
                .into(),
        );
    }
    if let Some(date) = &c.posted_date {
        conn.execute(
            "INSERT INTO import_account_dates VALUES (?1,?2)",
            params![row, date],
        )
        .map_err(err)?;
    }
    Ok(())
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    let definition: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='view' AND name='effective_activity_dates'",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    let expected = include_str!("../migrations/016_payment_codes.sql")
        .split("CREATE VIEW ")
        .nth(1)
        .unwrap();
    if definition.trim().trim_end_matches(';')
        != format!("CREATE VIEW {}", expected.trim().trim_end_matches(';'))
    {
        return Err("Backup account-date calculation is inconsistent.".into());
    }
    let mut policies = conn.prepare("SELECT s.account_id,c.policy_json FROM import_classification c JOIN import_sources s ON s.id=c.source_id UNION ALL SELECT account_id,policy_json FROM import_classification_profiles").map_err(err)?;
    for row in policies
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
    {
        let (account, raw) = row.map_err(err)?;
        validate_policy(conn, &account, &serde_json::from_str(&raw).map_err(err)?)?;
    }
    let mut dates = conn.prepare("SELECT p.date,r.candidate_json,r.disposition,r.event_id FROM import_account_dates p JOIN import_rows r ON r.id=p.row_id").map_err(err)?;
    for row in dates
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(err)?
    {
        let (date, raw, disposition, event) = row.map_err(err)?;
        let candidate: Candidate = serde_json::from_str(&raw).map_err(err)?;
        if !classification::reliable(&candidate)
            || candidate.posted_date.as_deref() != Some(&date)
            || disposition != "linked"
            || event.is_none()
        {
            return Err("Backup import posting-date evidence is inconsistent.".into());
        }
    }
    conn.prepare("SELECT event_id,account_id,date FROM effective_activity_dates LIMIT 0")
        .map_err(err)?;
    Ok(())
}
