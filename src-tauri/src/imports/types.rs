use crate::models::EntryInput;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Dataset {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub assisted: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pdf_pages: Vec<super::pdf::Page>,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub sheet_names: Vec<String>,
    pub sheet: String,
    pub image: bool,
    pub notes: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Mapping {
    pub date_column: Option<usize>,
    pub description_column: Option<usize>,
    pub amount_column: Option<usize>,
    pub debit_column: Option<usize>,
    pub credit_column: Option<usize>,
    pub status_column: Option<usize>,
    pub type_column: Option<usize>,
    #[serde(default)]
    pub posted_date_column: Option<usize>,
    #[serde(default)]
    pub stable_id_column: Option<usize>,
    #[serde(default)]
    pub currency_column: Option<usize>,
    #[serde(default)]
    pub stable_ids_confirmed: bool,
    pub amount_mode: String,
    pub date_format: String,
    pub year: Option<i32>,
    pub posted_confirmed: bool,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub date: Option<String>,
    pub description: String,
    pub amount_cents: Option<i64>,
    pub direction: String,
    pub status: String,
    pub source_type: String,
    #[serde(default)]
    pub posted_date: Option<String>,
    #[serde(default)]
    pub stable_id: Option<String>,
    #[serde(default = "usd")]
    pub currency: String,
    pub warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub revision: i64,
    pub name: String,
    pub format: String,
    pub account_id: Option<String>,
    pub state: String,
    pub error: String,
    pub row_count: i64,
    pub pending_count: i64,
    pub classification_count: i64,
    pub imported_count: i64,
    pub linked_count: i64,
    pub excluded_count: i64,
    pub created_at: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub id: String,
    pub revision: i64,
    pub date: String,
    pub description: String,
    pub kind: String,
    pub amount_cents: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRow {
    pub merchant: String,
    pub bulk_expense_reason: String,
    pub pending_entry: Option<crate::models::Entry>,
    pub id: String,
    pub ordinal: i64,
    pub raw: Vec<String>,
    pub candidate: Candidate,
    pub disposition: String,
    pub event_id: Option<String>,
    pub matches: Vec<Match>,
    pub suggestion: crate::db::rules::Suggestion,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDetail {
    pub classification_profile: Option<crate::db::classification::Profile>,
    pub classification_policy: Option<crate::db::classification::Policy>,
    pub observation: Option<crate::db::observations::Observation>,
    pub download_profile: Option<crate::db::observations::DownloadProfile>,
    pub source: SourceSummary,
    pub dataset: Dataset,
    pub mapping: Mapping,
    pub rows: Vec<ReviewRow>,
    pub preview_url: Option<String>,
    pub undo_id: Option<String>,
    pub coverage: Option<crate::db::identity::Coverage>,
    pub overlap: crate::db::identity::Plan,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub row_id: String,
    pub action: String,
    pub input: Option<EntryInput>,
    pub match_id: Option<String>,
    pub match_revision: Option<i64>,
    pub confirmed: bool,
    pub separate: bool,
    #[serde(default)]
    pub rule_signature: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub added: usize,
    pub linked: usize,
    pub excluded: usize,
    pub already_processed: bool,
}
pub struct Prepared {
    pub fingerprint: String,
    pub mime: String,
    pub format: String,
    pub dataset: Dataset,
    pub error: String,
}

pub fn usd() -> String {
    "USD".into()
}
