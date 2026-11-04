use super::*;

fn name(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 100 || value.chars().any(char::is_control) {
        return Err("Enter a name between 1 and 100 characters.".into());
    }
    Ok(value.into())
}

impl Store {
    pub fn save_account(&mut self, mut input: AccountInput) -> Result<()> {
        input.name = name(&input.name)?;
        if !["checking", "credit", "savings"].contains(&input.kind.as_str()) {
            return Err("Choose checking, savings, or credit card.".into());
        }
        if !["imported", "manual", "untracked"].contains(&input.tracking_mode.as_str()) {
            return Err("Choose an account tracking mode.".into());
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let old: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,kind FROM accounts WHERE id=?1",
                [&input.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if old.as_ref().map(|x| x.0).unwrap_or(0) != input.revision {
            return Err("This account changed. Reopen it before saving.".into());
        }
        if old.as_ref().is_some_and(|x| x.1 != input.kind) {
            return Err(
                "An existing account's type cannot change. Add a new account instead.".into(),
            );
        }
        if old.is_none() {
            Uuid::parse_str(&input.id).map_err(|_| "Invalid account identifier.")?;
            if input.archived {
                return Err("New accounts must be active.".into());
            }
        }
        let duplicate: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE name=?1 COLLATE NOCASE AND id!=?2)",
                params![input.name, input.id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if duplicate {
            return Err(
                "An account with this name already exists. Check archived accounts too.".into(),
            );
        }
        tx.execute("INSERT INTO accounts(id,name,kind,revision,archived,tracking_mode) VALUES (?1,?2,?3,?4,?5,?6)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name,revision=excluded.revision,archived=excluded.archived,tracking_mode=excluded.tracking_mode",
            params![input.id,input.name,input.kind,input.revision+1,input.archived,input.tracking_mode]).map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('account_setup',?1)",
            [serde_json::to_string(&input).map_err(err)?],
        )
        .map_err(err)?;
        periods::commit(tx)
    }

    pub fn save_category(&mut self, mut input: CategoryInput) -> Result<()> {
        input.name = name(&input.name)?;
        if !["Needs", "Wants", "Other"].contains(&input.group_name.as_str()) {
            return Err("Choose Needs, Wants, or Other.".into());
        }
        if input.color.len() != 7
            || !input.color.starts_with('#')
            || !input.color[1..].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Choose a valid category color.".into());
        }
        if ![
            "auto",
            "tag",
            "home",
            "groceries",
            "transport",
            "health",
            "household",
            "dining",
            "hobbies",
            "personal",
            "gifts",
            "electric",
            "water",
            "gas",
            "internet",
            "phone",
            "subscriptions",
            "insurance",
            "savings",
            "education",
        ]
        .contains(&input.icon.as_str())
        {
            return Err("Choose a supported category icon.".into());
        }
        if input.id == "uncategorized"
            && (input.archived || input.name != "Uncategorized" || input.group_name != "Other")
        {
            return Err("Uncategorized must stay active in Other for unassigned expenses.".into());
        }
        let limit = money::cents(&input.default_limit)?;
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let old: Option<i64> = tx
            .query_row(
                "SELECT revision FROM categories WHERE id=?1",
                [&input.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if old.unwrap_or(0) != input.revision {
            return Err("This category changed. Reopen it before saving.".into());
        }
        if old.is_none() {
            Uuid::parse_str(&input.id).map_err(|_| "Invalid category identifier.")?;
            if input.archived {
                return Err("New categories must be active.".into());
            }
        }
        let duplicate: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE name=?1 COLLATE NOCASE AND id!=?2)",
                params![input.name, input.id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if duplicate {
            return Err(
                "A category with this name already exists. Check archived categories too.".into(),
            );
        }
        tx.execute("INSERT INTO categories(id,name,group_name,color,default_limit_cents,revision,archived,icon) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name,group_name=excluded.group_name,color=excluded.color,default_limit_cents=excluded.default_limit_cents,revision=excluded.revision,archived=excluded.archived,icon=excluded.icon",
            params![input.id,input.name,input.group_name,input.color,limit,input.revision+1,input.archived,input.icon]).map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('category_setup',?1)",
            [serde_json::to_string(&input).map_err(err)?],
        )
        .map_err(err)?;
        periods::commit(tx)
    }

    pub fn apply_budget_template(
        &mut self,
        month: &str,
        source_month: Option<&str>,
        replace: bool,
    ) -> Result<usize> {
        validate_month(month)?;
        if let Some(source) = source_month {
            validate_month(source)?;
            if source >= month {
                return Err("Copy limits from an earlier month.".into());
            }
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        if let Some(source) = source_month {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM budget_months WHERE month=?1)",
                    [source],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if !exists {
                return Err(
                    "That month has no saved budget. Choose another month or use defaults.".into(),
                );
            }
        }
        // Only active categories carry forward; never move spending or surplus.
        // Explicit zero limits are existing limits and are preserved unless replace is chosen.
        let rows = {
            let mut stmt = tx.prepare("SELECT c.id,CASE WHEN ?1 IS NULL THEN c.default_limit_cents ELSE COALESCE(b.limit_cents,0) END
                FROM categories c LEFT JOIN budgets b ON b.category_id=c.id AND b.month=?1 WHERE c.archived=0").map_err(err)?;
            let collected = stmt
                .query_map([source_month], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                })
                .map_err(err)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(err)?;
            collected
        };
        let mut changed = 0;
        for (category, limit) in rows {
            changed += tx.execute("INSERT INTO budgets(month,category_id,limit_cents) VALUES (?1,?2,?3)
                ON CONFLICT(month,category_id) DO UPDATE SET limit_cents=excluded.limit_cents WHERE ?4",
                params![month,category,limit,replace]).map_err(err)?;
        }
        tx.execute("INSERT OR IGNORE INTO budget_months VALUES (?1)", [month])
            .map_err(err)?;
        let payload = serde_json::json!({"month":month,"sourceMonth":source_month,"replace":replace,"updatedCategories":changed});
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES ('budget_template',?1)",
            [payload.to_string()],
        )
        .map_err(err)?;
        periods::commit(tx)?;
        Ok(changed)
    }
}
