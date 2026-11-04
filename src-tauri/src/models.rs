use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EntryInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget_override: Option<crate::db::budget_periods::Choice>,
    pub id: String,
    pub revision: i64,
    pub kind: String,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub payer: String,
    pub category_id: Option<String>,
    pub account_id: Option<String>,
    pub destination_account_id: Option<String>,
    pub split_mode: String,
    pub split_value: String,
    pub note: String,
    #[serde(default)]
    pub original_event_id: Option<String>,
    #[serde(default)]
    pub lines: Vec<LineInput>,
    #[serde(default)]
    pub paypal: Option<PayPalInput>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_override: Option<crate::db::budget_periods::Choice>,
    pub id: String,
    pub revision: i64,
    pub kind: String,
    pub date: String,
    pub description: String,
    pub amount_cents: i64,
    pub payer: String,
    pub category_id: Option<String>,
    pub account_id: Option<String>,
    pub destination_account_id: Option<String>,
    pub split_mode: String,
    pub split_value: String,
    pub jacob_cents: i64,
    pub chelsea_cents: i64,
    pub household_delta_cents: i64,
    pub note: String,
    pub original_event_id: Option<String>,
    pub lines: Vec<EntryLine>,
    pub pending: Option<crate::db::classification::Pending>,
    pub movement_link: Option<String>,
    pub activity_dates: Vec<crate::db::movements::ActivityDate>,
    pub paypal: Option<PayPalInput>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LineInput {
    pub id: String,
    pub label: String,
    pub category_id: String,
    pub amount: String,
    pub split_mode: String,
    pub split_value: String,
    #[serde(default)]
    pub original_line_id: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntryLine {
    pub id: String,
    pub label: String,
    pub category_id: String,
    pub amount_cents: i64,
    pub split_mode: String,
    pub split_value: String,
    pub jacob_cents: i64,
    pub chelsea_cents: i64,
    pub original_line_id: Option<String>,
}
impl EntryLine {
    pub fn input(&self) -> LineInput {
        LineInput {
            id: self.id.clone(),
            label: self.label.clone(),
            category_id: self.category_id.clone(),
            amount: format!("{}.{:02}", self.amount_cents / 100, self.amount_cents % 100),
            split_mode: self.split_mode.clone(),
            split_value: self.split_value.clone(),
            original_line_id: self.original_line_id.clone(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub activity_cents: i64,
    pub revision: i64,
    pub archived: bool,
    pub tracking_mode: String,
    pub balance: Option<Balance>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    pub checkpoint_date: String,
    pub checkpoint_cents: i64,
    pub known_change_cents: i64,
    pub estimated_cents: i64,
    pub through_date: String,
}
pub fn imported_mode() -> String {
    "imported".into()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub rollover_cents: i64,
    pub available_cents: i64,
    pub rollover_mode: String,
    pub rollover_token: String,
    pub id: String,
    pub name: String,
    pub group_name: String,
    pub color: String,
    pub limit_cents: i64,
    pub spent_cents: i64,
    pub provisional_cents: i64,
    pub goal_excluded_cents: i64,
    pub allowance_cents: i64,
    pub default_limit_cents: i64,
    pub revision: i64,
    pub archived: bool,
    pub icon: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub id: String,
    pub revision: i64,
    pub name: String,
    pub kind: String,
    pub archived: bool,
    #[serde(default = "imported_mode")]
    pub tracking_mode: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    pub id: String,
    pub revision: i64,
    pub name: String,
    pub group_name: String,
    pub color: String,
    pub icon: String,
    pub default_limit: String,
    pub archived: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub period: Option<crate::db::periods::Status>,
    pub workspace: String,
    pub month: String,
    pub entries: Vec<Entry>,
    pub household_entries: Vec<Entry>,
    pub accounts: Vec<Account>,
    pub categories: Vec<Category>,
    pub spent_cents: i64,
    pub consumption_cents: i64,
    pub debt_payment_cents: i64,
    pub cash_reward_cents: i64,
    pub card_reward_cents: i64,
    pub income_cents: i64,
    pub budget_cents: i64,
    pub budget_configured: bool,
    pub remaining_cents: i64,
    pub household_cents: i64,
    pub household_month_spent_cents: i64,
    pub monthly_count: i64,
    pub incomplete_imports: i64,
    pub provisional_allowance_cents: i64,
    pub goal_excluded_cents: i64,
    pub allowance_cents: i64,
    pub pending_funding_count: i64,
    pub funding_review_entries: Vec<Entry>,
    pub unclassified_count: i64,
    pub data_path: String,
    pub backups: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayPalInput {
    pub receipts: Vec<ReceiptInput>,
    pub fee: String,
    pub fee_category_id: Option<String>,
    pub other: String,
    pub other_note: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptInput {
    pub id: String,
    pub revision: i64,
    pub amount: String,
}

impl Entry {
    pub fn reporting_month(&self) -> &str {
        self.budget_override
            .as_ref()
            .and_then(|c| c.month.as_deref())
            .unwrap_or(&self.date[..7])
    }
}
