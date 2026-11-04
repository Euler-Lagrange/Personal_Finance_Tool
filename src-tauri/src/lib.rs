mod ai_commands;
pub mod assistance;
mod backup_commands;
mod category_defaults;
mod db;
mod handoff_commands;
mod handoff_crypto;
mod imports;
mod managed_backups;
mod migrations;
mod models;
mod money;
mod pay_calendar;
mod pay_cash;
mod pay_commands;
mod pay_document;
mod pay_forecast;
mod pay_tax;
mod payroll;
#[cfg(test)]
mod tests;
mod workspace_lease;

use base64::Engine;
use imports::{parse, types::*};
use models::{AccountInput, CategoryInput, EntryInput, Snapshot};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
struct AppState {
    _instance_lease: std::fs::File,
    root: PathBuf,
    gate: Mutex<()>,
    session: String,
    ai_tasks:
        Mutex<std::collections::HashMap<(String, String), tauri::async_runtime::JoinHandle<()>>>,
    backup_gate: Mutex<()>,
    backup_pending: Mutex<std::collections::BTreeMap<String, backup_commands::Pending>>,
    backup_running: Mutex<Option<String>>,
}
type Result<T> = std::result::Result<T, String>;

#[tauri::command]
fn close_review(
    carry_target: Option<String>,
    state: State<AppState>,
    workspace: String,
    month: String,
) -> Result<db::periods::Review> {
    with_store(&state, &workspace, |s| {
        if carry_target.is_none() {
            s.close_review(&month)
        } else {
            s.close_review_target(&month, carry_target.as_deref())
        }
    })
}
#[tauri::command]
fn save_budget_plan(
    state: State<AppState>,
    workspace: String,
    input: db::rollover::BudgetPlan,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.save_budget_plan(input))
}
#[tauri::command]
fn close_month(
    state: State<AppState>,
    workspace: String,
    input: db::periods::CloseInput,
) -> Result<()> {
    let result = with_store(&state, &workspace, |s| s.close_month(input));
    if result.is_ok() {
        backup_commands::checkpoint(&state, &workspace);
    }
    result
}
#[tauri::command]
fn reopen_month(
    state: State<AppState>,
    workspace: String,
    input: db::periods::ReopenInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.reopen_month(input))
}
#[tauri::command]
fn card_payment_view(
    state: State<AppState>,
    workspace: String,
    account: String,
) -> Result<db::card_payments::View> {
    with_store(&state, &workspace, |s| s.card_payment_view(&account))
}
#[tauri::command]
fn save_card_obligation(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::card_payments::ObligationInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.save_card_obligation(&operation, input)
    })
}
#[tauri::command]
fn clear_card_obligation(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::card_payments::ObligationInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.clear_card_obligation(&operation, input)
    })
}
#[tauri::command]
fn save_card_payment_review(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::card_payments::PaymentInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.save_card_payment_review(&operation, input)
    })
}
#[tauri::command]
fn clear_card_payment_review(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::card_payments::PaymentInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.clear_card_payment_review(&operation, input)
    })
}
#[tauri::command]
fn cash_forecast(
    state: State<AppState>,
    workspace: String,
    account: String,
    days: u32,
) -> Result<db::cash_forecast::View> {
    with_store(&state, &workspace, |s| s.cash_forecast(&account, days))
}
#[tauri::command]
fn forecast_settings(
    state: State<AppState>,
    workspace: String,
) -> Result<db::cash_forecast::Settings> {
    with_store(&state, &workspace, |s| s.forecast_settings())
}
#[tauri::command]
fn save_forecast_settings(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::cash_forecast::Settings,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.save_forecast_settings(&operation, input)
    })
}
#[tauri::command]
fn card_statement_month(
    state: tauri::State<'_, AppState>,
    workspace: String,
    month: String,
) -> Result<db::card_statements::View> {
    with_store(&state, &workspace, |s| s.card_statement_month(&month))
}
#[tauri::command]
fn save_card_statement_config(
    state: tauri::State<'_, AppState>,
    workspace: String,
    operation: String,
    input: db::card_statements::Config,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.save_card_statement_config(&operation, input)
    })
}
#[tauri::command]
fn review_card_statement(
    state: tauri::State<'_, AppState>,
    workspace: String,
    input: db::card_statements::Draft,
) -> Result<db::card_statements::Review> {
    with_store(&state, &workspace, |s| s.review_card_statement(input))
}
#[tauri::command]
fn save_card_statement(
    state: tauri::State<'_, AppState>,
    workspace: String,
    operation: String,
    input: db::card_statements::Save,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.save_card_statement(&operation, input)
    })
}
#[tauri::command]
fn cash_month(
    state: State<AppState>,
    workspace: String,
    month: String,
) -> Result<db::cash_plans::View> {
    with_store(&state, &workspace, |s| s.cash_month(&month))
}
#[tauri::command]
fn save_cash_schedule(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::cash_plans::Schedule,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.save_cash_schedule(&operation, input)
    })
}
#[tauri::command]
fn save_cash_occurrence(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::cash_plans::Edit,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.save_cash_occurrence(&operation, input)
    })
}
#[tauri::command]
fn cash_candidates(
    state: State<AppState>,
    workspace: String,
    id: String,
) -> Result<Vec<db::cash_plans::Actual>> {
    with_store(&state, &workspace, |s| s.cash_candidates(&id))
}
#[tauri::command]
fn match_cash(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::cash_plans::Match,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.match_cash(&operation, input))
}
#[tauri::command]
fn unmatch_cash(
    state: State<AppState>,
    workspace: String,
    operation: String,
    id: String,
    revision: i64,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.unmatch_cash(&operation, &id, revision)
    })
}
#[tauri::command]
fn record_cash(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::cash_plans::Record,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.record_cash(&operation, input))
}

#[tauri::command]
fn trends_report(
    state: State<AppState>,
    workspace: String,
    year: i32,
) -> Result<db::trends::Report> {
    with_store(&state, &workspace, |s| s.trends_report(year))
}

#[tauri::command]
fn annual_report(
    state: State<AppState>,
    workspace: String,
    year: i32,
) -> Result<db::periods::Annual> {
    with_store(&state, &workspace, |s| s.annual_report(year))
}

#[tauri::command]
fn shared_statement(
    state: State<AppState>,
    workspace: String,
    month: Option<String>,
) -> Result<serde_json::Value> {
    with_store(&state, &workspace, |s| {
        s.shared_statement_view(month.as_deref())
    })
}
#[tauri::command]
fn set_household_group(
    state: State<AppState>,
    workspace: String,
    event: String,
    revision: i64,
    group: Option<String>,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.set_household_group(&event, revision, group.as_deref())
    })
}
#[tauri::command]
fn export_shared_statement(
    state: State<AppState>,
    workspace: String,
    month: Option<String>,
    format: String,
) -> Result<String> {
    let directory = state.root.join("exports").join("shared-statements");
    with_store(&state, &workspace, |s| {
        s.export_statement(&directory, month.as_deref(), &format)
    })
}
#[tauri::command]
fn open_statement_folder(state: State<AppState>) -> Result<()> {
    let directory = state.root.join("exports").join("shared-statements");
    if !directory.is_dir() {
        return Err("Export a statement first.".into());
    }
    std::process::Command::new("explorer.exe")
        .arg(directory)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_goals(state: State<AppState>, workspace: String) -> Result<Vec<db::goals::Goal>> {
    with_store(&state, &workspace, |s| s.goals())
}
#[tauri::command]
fn save_goal(state: State<AppState>, workspace: String, input: db::goals::GoalInput) -> Result<()> {
    with_store(&state, &workspace, |s| s.save_goal(input))
}
#[tauri::command]
fn funding_view(
    state: State<AppState>,
    workspace: String,
    event: String,
) -> Result<db::goals::FundingView> {
    with_store(&state, &workspace, |s| s.funding_view(&event))
}
#[tauri::command]
fn save_funding(
    state: State<AppState>,
    workspace: String,
    request: db::goals::FundingRequest,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.save_funding(request))
}
#[tauri::command]
fn goal_activity(
    state: State<AppState>,
    workspace: String,
    goal: String,
) -> Result<Vec<db::goals::Activity>> {
    with_store(&state, &workspace, |s| s.goal_activity(&goal))
}
#[tauri::command]
fn label_goal_interest(
    state: State<AppState>,
    workspace: String,
    goal: String,
    event: String,
    revision: i64,
    interest: bool,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.label_goal_interest(&goal, &event, revision, interest)
    })
}

#[tauri::command]
fn household_opening(
    state: State<AppState>,
    workspace: String,
) -> Result<Option<db::household::Opening>> {
    with_store(&state, &workspace, |s| s.household_opening())
}
#[tauri::command]
fn save_household_opening(
    state: State<AppState>,
    workspace: String,
    input: db::household::OpeningInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.save_household_opening(input))
}
#[tauri::command]
fn paypal_receipts(
    state: State<AppState>,
    workspace: String,
    editing: Option<String>,
) -> Result<Vec<db::household::Receipt>> {
    with_store(&state, &workspace, |s| {
        s.paypal_receipts(editing.as_deref())
    })
}
#[tauri::command]
fn balance_checkpoints(
    state: State<AppState>,
    workspace: String,
    account: String,
) -> Result<Vec<db::balances::Checkpoint>> {
    with_store(&state, &workspace, |s| s.balance_checkpoints(&account))
}
#[tauri::command]
fn save_checkpoint(
    state: State<AppState>,
    workspace: String,
    input: db::balances::CheckpointInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.save_checkpoint(input))
}
#[tauri::command]
fn delete_checkpoint(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.delete_checkpoint(&id, revision))
}
#[tauri::command]
fn preview_lines(
    amount: String,
    mode: String,
    value: String,
    lines: Vec<models::LineInput>,
) -> Result<Vec<models::EntryLine>> {
    db::lines::allocate(money::cents(&amount)?, &mode, &value, &lines)
}
#[tauri::command]
fn list_bill_templates(
    state: State<AppState>,
    workspace: String,
) -> Result<Vec<db::bills::Template>> {
    with_store(&state, &workspace, |s| s.bill_templates())
}
#[tauri::command]
fn save_bill_template(
    state: State<AppState>,
    workspace: String,
    input: db::bills::TemplateInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.save_bill_template(
            &input.id,
            input.revision,
            &input.first_due,
            input.every_months,
            input.end_date,
            input.archived,
            input.plan,
        )
    })
}
#[tauri::command]
fn bill_month(
    state: State<AppState>,
    workspace: String,
    month: String,
) -> Result<Vec<db::bills::Occurrence>> {
    with_store(&state, &workspace, |s| s.bill_month(&month))
}
#[tauri::command]
fn save_bill_occurrence(
    state: State<AppState>,
    workspace: String,
    input: db::bills::OccurrenceInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.save_bill_occurrence(input))
}
#[tauri::command]
fn bill_candidates(
    state: State<AppState>,
    workspace: String,
    id: String,
    all: bool,
) -> Result<Vec<db::bills::Candidate>> {
    with_store(&state, &workspace, |s| s.bill_candidates(&id, all))
}
#[tauri::command]
fn link_bill_payment(
    state: State<AppState>,
    workspace: String,
    input: db::bills::LinkInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.link_bill_payment(input))
}
#[tauri::command]
fn unlink_bill_payment(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    payment: String,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.unlink_bill_payment(&id, revision, &payment)
    })
}
#[tauri::command]
fn record_bill_payment(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    operation: String,
    input: EntryInput,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.record_bill_payment(&id, revision, &operation, input)
    })
}
#[tauri::command]
fn bill_evidence(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    source: String,
    remove: bool,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.bill_evidence(&id, revision, &source, remove)
    })
}

fn with_store<T>(
    state: &AppState,
    workspace: &str,
    op: impl FnOnce(&mut db::Store) -> Result<T>,
) -> Result<T> {
    let _lock = state
        .gate
        .lock()
        .map_err(|_| "Storage is unavailable. Restart the app.")?;
    let _lease = workspace_lease::acquire(&state.root, workspace)?;
    let mut store = db::Store::open(&state.root, workspace)?;
    store.ai_interrupt(&state.session)?;
    let before = store.change_count();
    let result = op(&mut store);
    if store.change_count() != before {
        backup_commands::enqueue(state, workspace);
    }
    result
}
#[tauri::command]
fn snapshot(state: State<AppState>, workspace: String, month: String) -> Result<Snapshot> {
    with_store(&state, &workspace, |s| s.snapshot(&month))
}
#[tauri::command]
fn save_entry(state: State<AppState>, workspace: String, input: EntryInput) -> Result<()> {
    with_store(&state, &workspace, |s| s.save(input))
}
#[tauri::command]
fn delete_entry(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.delete(&id, revision))
}
#[tauri::command]
fn refund_purchases(
    state: State<AppState>,
    workspace: String,
    editing: Option<String>,
) -> Result<Vec<db::refunds::Purchase>> {
    with_store(&state, &workspace, |s| {
        s.refund_purchases(editing.as_deref())
    })
}
#[tauri::command]
fn suggest_categories(
    state: State<AppState>,
    workspace: String,
    source: String,
    contexts: Vec<db::rules::CategoryContext>,
) -> Result<Vec<db::rules::ContextSuggestion>> {
    with_store(&state, &workspace, |s| {
        s.suggest_categories(&source, contexts)
    })
}
#[tauri::command]
fn preview_purchases(
    state: State<AppState>,
    workspace: String,
    request: db::purchase_review::Request,
) -> Result<db::purchase_review::Preview> {
    with_store(&state, &workspace, |s| s.preview_purchases(request))
}
#[tauri::command]
fn purchase_review(
    state: State<AppState>,
    workspace: String,
    source: String,
) -> Result<db::purchase_review::View> {
    with_store(&state, &workspace, |s| s.purchase_review(&source))
}
#[tauri::command]
fn review_purchases(
    state: State<AppState>,
    workspace: String,
    request: db::purchase_review::Request,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.review_purchases(request))
}
#[tauri::command]
fn undo_purchase_review(state: State<AppState>, workspace: String, id: String) -> Result<()> {
    with_store(&state, &workspace, |s| s.undo_purchase_review(&id))
}
#[tauri::command]
fn list_rules(state: State<AppState>, workspace: String) -> Result<Vec<db::rules::Rule>> {
    with_store(&state, &workspace, |s| s.list_rules())
}
#[tauri::command]
fn preview_rule(
    state: State<AppState>,
    workspace: String,
    rule: db::rules::Rule,
) -> Result<db::rules::Preview> {
    with_store(&state, &workspace, |s| s.preview_rule(rule))
}
#[tauri::command]
fn save_rule(state: State<AppState>, workspace: String, rule: db::rules::Rule) -> Result<()> {
    with_store(&state, &workspace, |s| s.save_rule(rule))
}
#[tauri::command]
fn set_budget(
    state: State<AppState>,
    workspace: String,
    month: String,
    category: String,
    amount: String,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.set_budget(&month, &category, &amount)
    })
}
#[tauri::command]
fn save_account(state: State<AppState>, workspace: String, input: AccountInput) -> Result<()> {
    with_store(&state, &workspace, |s| s.save_account(input))
}
#[tauri::command]
fn save_category(state: State<AppState>, workspace: String, input: CategoryInput) -> Result<()> {
    with_store(&state, &workspace, |s| s.save_category(input))
}
#[tauri::command]
fn apply_budget_template(
    state: State<AppState>,
    workspace: String,
    month: String,
    source_month: Option<String>,
    replace: bool,
) -> Result<usize> {
    with_store(&state, &workspace, |s| {
        s.apply_budget_template(&month, source_month.as_deref(), replace)
    })
}
#[tauri::command]
fn create_backup(state: State<AppState>, workspace: String) -> Result<String> {
    with_store(&state, &workspace, |s| s.backup())
}
#[tauri::command]
fn restore_backup(state: State<AppState>, workspace: String, name: String) -> Result<()> {
    with_store(&state, &workspace, |s| s.restore(&name))
}
#[tauri::command]
fn preview_split(amount: String, mode: String, value: String) -> Result<(i64, i64)> {
    money::allocation(money::cents(&amount)?, &mode, &value)
}

#[tauri::command]
fn pdf_route_view(
    state: State<AppState>,
    workspace: String,
    application: String,
) -> Result<db::pdf_routes::View> {
    with_store(&state, &workspace, |s| s.pdf_route_view(&application))
}
#[tauri::command]
fn configure_pdf_route(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::pdf_routes::Input,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.configure_pdf_route(&operation, input)
    })
}
#[tauri::command]
fn pdf_table_view(
    state: State<AppState>,
    workspace: String,
    id: String,
) -> Result<db::pdf_tables::View> {
    with_store(&state, &workspace, |s| s.pdf_table_view(&id))
}
#[tauri::command]
fn preview_pdf_table(
    state: State<AppState>,
    workspace: String,
    input: db::pdf_tables::Request,
) -> Result<db::pdf_tables::Preview> {
    with_store(&state, &workspace, |s| s.preview_pdf_table(input))
}
#[tauri::command]
fn save_pdf_table(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::pdf_tables::Save,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.save_pdf_table(&operation, input))
}
#[tauri::command]
fn set_pdf_table_enabled(
    state: State<AppState>,
    workspace: String,
    operation: String,
    id: String,
    revision: i64,
    enabled: bool,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.set_pdf_table_enabled(&operation, &id, revision, enabled)
    })
}
#[tauri::command]
fn ai_provider_settings(
    state: State<AppState>,
    workspace: String,
) -> Result<Vec<assistance::settings::View>> {
    let _gate = state.gate.lock().map_err(|_| "Storage is unavailable.")?;
    ["claude", "openai"]
        .iter()
        .map(|p| {
            assistance::settings::view(&state.root, &workspace, p, &assistance::vault::WindowsVault)
        })
        .collect()
}
#[tauri::command]
fn save_ai_provider(
    state: State<AppState>,
    workspace: String,
    input: assistance::settings::Input,
) -> Result<assistance::settings::View> {
    let _gate = state.gate.lock().map_err(|_| "Storage is unavailable.")?;
    assistance::settings::save(
        &state.root,
        &workspace,
        input,
        &assistance::vault::WindowsVault,
    )
}
#[tauri::command]
fn pdf_original(state: State<AppState>, workspace: String, id: String) -> Result<String> {
    with_store(&state, &workspace, |s| s.pdf_original(&id))
}
#[tauri::command]
fn pdf_document(
    state: State<AppState>,
    workspace: String,
    id: String,
) -> Result<db::pdf_documents::Document> {
    with_store(&state, &workspace, |s| s.pdf_document(&id))
}
#[tauri::command]
fn preview_pdf_template(
    state: State<AppState>,
    workspace: String,
    input: db::pdf_documents::Sample,
) -> Result<db::pdf_documents::TemplateReview> {
    with_store(&state, &workspace, |s| s.preview_pdf_template(input))
}
#[tauri::command]
fn approve_pdf_template(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::pdf_documents::Approval,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.approve_pdf_template(&operation, input)
    })
}
#[tauri::command]
fn set_pdf_template_enabled(
    state: State<AppState>,
    workspace: String,
    operation: String,
    id: String,
    revision: i64,
    enabled: bool,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.set_pdf_template_enabled(&operation, &id, revision, enabled)
    })
}
#[tauri::command]
fn preview_pdf_application(
    state: State<AppState>,
    workspace: String,
    input: db::pdf_documents::Request,
) -> Result<db::pdf_documents::Review> {
    with_store(&state, &workspace, |s| s.preview_pdf_application(input))
}
#[tauri::command]
fn apply_pdf_application(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: db::pdf_documents::Apply,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.apply_pdf_application(&operation, input)
    })
}
#[tauri::command]
fn export_original_pdf(state: State<AppState>, workspace: String, id: String) -> Result<String> {
    let directory = state
        .root
        .join("exports")
        .join("pdf-evidence")
        .join(&workspace);
    with_store(&state, &workspace, |s| {
        s.export_original_pdf(&directory, &id)
    })
}
#[tauri::command]
fn open_pdf_folder(state: State<AppState>) -> Result<()> {
    let directory = state.root.join("exports").join("pdf-evidence");
    if !directory.is_dir() {
        return Err("Export an original PDF first.".into());
    }
    std::process::Command::new("explorer.exe")
        .arg(directory)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn list_imports(state: State<AppState>, workspace: String) -> Result<Vec<SourceSummary>> {
    with_store(&state, &workspace, |s| s.import_list())
}
#[tauri::command]
fn get_import(state: State<AppState>, workspace: String, id: String) -> Result<SourceDetail> {
    with_store(&state, &workspace, |s| s.import_detail(&id))
}
#[tauri::command]
fn import_profile(
    state: State<AppState>,
    workspace: String,
    id: String,
    account: String,
) -> Result<Option<Mapping>> {
    with_store(&state, &workspace, |s| s.import_profile(&id, &account))
}
#[tauri::command]
fn configure_import(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    account: String,
    mapping: Mapping,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.configure_import(&id, revision, &account, mapping)
    })
}
#[tauri::command]
fn new_import_observation(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    new_id: String,
) -> Result<String> {
    with_store(&state, &workspace, |s| {
        s.new_import_observation(&id, revision, &new_id)
    })
}
#[tauri::command]
fn confirm_import_coverage(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    input: db::identity::CoverageInput,
    pattern: Option<db::observations::Pattern>,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.confirm_import_coverage_with_pattern(&id, revision, input, pattern)
    })
}
#[tauri::command]
fn reconcile_import(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    commit_id: String,
) -> Result<Receipt> {
    with_store(&state, &workspace, |s| {
        s.reconcile_import(&id, revision, &commit_id)
    })
}
#[tauri::command]
fn dismiss_import(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    dismissed: bool,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.dismiss_import(&id, revision, dismissed)
    })
}
#[tauri::command]
fn commit_import(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    commit_id: String,
    decisions: Vec<Decision>,
) -> Result<Receipt> {
    let result = with_store(&state, &workspace, |s| {
        s.commit_import(&id, revision, &commit_id, decisions)
    });
    if result.is_ok() {
        backup_commands::checkpoint(&state, &workspace);
    }
    result
}
#[tauri::command]
fn movement_matches(
    state: State<AppState>,
    workspace: String,
    id: String,
) -> Result<Vec<models::Entry>> {
    with_store(&state, &workspace, |s| s.movement_matches(&id))
}
#[tauri::command]
fn movement_detail(
    state: State<AppState>,
    workspace: String,
    id: String,
) -> Result<db::movements::Detail> {
    with_store(&state, &workspace, |s| s.movement_detail(&id))
}
#[tauri::command]
fn reconcile_movement(
    state: State<AppState>,
    workspace: String,
    input: db::movements::ReconcileInput,
) -> Result<String> {
    with_store(&state, &workspace, |s| s.reconcile_movement(input))
}
#[tauri::command]
fn undo_movement(state: State<AppState>, workspace: String, id: String) -> Result<()> {
    with_store(&state, &workspace, |s| s.undo_movement(&id))
}
#[tauri::command]
fn get_activity_source(
    state: State<AppState>,
    workspace: String,
    event_id: String,
) -> Result<SourceDetail> {
    with_store(&state, &workspace, |s| s.activity_source(&event_id))
}
#[tauri::command]
fn process_import(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    commit_id: String,
    policy: db::classification::Policy,
    preferences: Option<db::classification::Preferences>,
) -> Result<Receipt> {
    let result = with_store(&state, &workspace, |s| {
        s.process_import_with_preferences(&id, revision, &commit_id, policy, preferences)
    });
    if result.is_ok() {
        backup_commands::checkpoint(&state, &workspace);
    }
    result
}
// IPC fields remain explicit; the core receives one structured coverage request.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn finalize_import_coverage(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
    commit_id: String,
    process_saved_defaults: bool,
    input: db::identity::CoverageInput,
    pattern: Option<db::observations::Pattern>,
) -> Result<Receipt> {
    let result = with_store(&state, &workspace, |s| {
        s.finalize_import_coverage(
            &id,
            revision,
            &commit_id,
            db::identity::CoverageRequest {
                input,
                pattern,
                process_saved_defaults,
            },
        )
    });
    if result.is_ok() {
        backup_commands::checkpoint(&state, &workspace);
    }
    result
}
#[tauri::command]
fn undo_import(state: State<AppState>, workspace: String, commit_id: String) -> Result<()> {
    with_store(&state, &workspace, |s| s.undo_import(&commit_id))
}

fn stage(
    app: &tauri::AppHandle,
    workspace: &str,
    name: &str,
    bytes: Vec<u8>,
    purpose: Option<&str>,
) -> Result<String> {
    if purpose == Some("payroll") {
        let prepared = pay_document::prepare(name, &bytes)?;
        return with_store(&app.state::<AppState>(), workspace, |s| {
            s.ingest_pay_source(name, bytes, prepared)
        });
    }
    if purpose.is_some_and(|p| p != "transactions") {
        return Err("Choose a supported import destination.".into());
    }
    let prepared = parse::prepare(name, &bytes, None)?;
    with_store(&app.state::<AppState>(), workspace, |s| {
        s.ingest(name, bytes, prepared)
    })
}
#[tauri::command]
async fn ingest_import(
    app: tauri::AppHandle,
    workspace: String,
    name: String,
    content: String,
    purpose: Option<String>,
) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        if content.len() > imports::MAX_FILE_BYTES * 4 / 3 + 4 {
            return Err("Use files no larger than 10 MB.".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|_| "File data could not be read.")?;
        stage(&app, &workspace, &name, bytes, purpose.as_deref())
    })
    .await
    .map_err(|_| "Import worker stopped. Try again.")?
}
#[tauri::command]
async fn ingest_import_path(
    app: tauri::AppHandle,
    workspace: String,
    path: String,
    purpose: Option<String>,
) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let path = std::path::Path::new(&path);
        let file = std::fs::File::open(path)
            .map_err(|_| "File could not be opened. Try copying it to a local folder.")?;
        let metadata = file
            .metadata()
            .map_err(|_| "File details could not be read.")?;
        if !metadata.is_file() || metadata.len() > imports::MAX_FILE_BYTES as u64 {
            return Err("Drop individual files no larger than 10 MB, not folders.".into());
        }
        let mut bytes = Vec::new();
        file.take(imports::MAX_FILE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "File could not be read.")?;
        stage(
            &app,
            &workspace,
            path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Import"),
            bytes,
            purpose.as_deref(),
        )
    })
    .await
    .map_err(|_| "Import worker stopped. Try again.")?
}
#[tauri::command]
async fn paste_import(
    app: tauri::AppHandle,
    workspace: String,
    purpose: Option<String>,
) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|_| "Clipboard is unavailable. Try again.")?;
        let image = clipboard
            .get_image()
            .map_err(|_| "No screenshot on the clipboard. Copy an image, then paste again.")?;
        if image.width > 10000 || image.height > 10000 || image.bytes.len() > 100 * 1024 * 1024 {
            return Err("Screenshot is too large. Copy a smaller region.".into());
        }
        let pixels = image::RgbaImage::from_raw(
            image.width as u32,
            image.height as u32,
            image.bytes.into_owned(),
        )
        .ok_or("Clipboard image could not be read.")?;
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(pixels)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .map_err(|_| "Screenshot could not be encoded.")?;
        stage(
            &app,
            &workspace,
            &format!(
                "Screenshot {}.png",
                chrono::Local::now().format("%Y-%m-%d %H-%M-%S")
            ),
            bytes.into_inner(),
            purpose.as_deref(),
        )
    })
    .await
    .map_err(|_| "Clipboard worker stopped. Try again.")?
}
#[tauri::command]
async fn reextract_import(
    app: tauri::AppHandle,
    workspace: String,
    id: String,
    revision: i64,
    sheet: Option<String>,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let (name, bytes) = with_store(&app.state::<AppState>(), &workspace, |s| {
            s.import_content(&id)
        })?;
        let prepared = parse::prepare(&name, &bytes, sheet.as_deref())?;
        with_store(&app.state::<AppState>(), &workspace, |s| {
            s.import_sheet(&id, revision, prepared)
        })
    })
    .await
    .map_err(|_| "Extraction worker stopped. Try again.")?
}

#[tauri::command]
fn set_native_theme(app: tauri::AppHandle, dark: bool) {
    app.set_theme(Some(if dark {
        tauri::Theme::Dark
    } else {
        tauri::Theme::Light
    }));
}

#[tauri::command]
fn payroll_view(
    state: State<AppState>,
    workspace: String,
    day: String,
    year: i32,
) -> Result<db::payroll::View> {
    with_store(&state, &workspace, |store| store.payroll_view(&day, year))
}
#[tauri::command]
fn save_payroll(
    state: State<AppState>,
    workspace: String,
    operation: String,
    revision: i64,
    change: payroll::Change,
) -> Result<i64> {
    with_store(&state, &workspace, |store| {
        store.save_payroll(&operation, revision, change)
    })
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            // Debug-only isolation for native UI QA. Release builds always use
            // the normal app directory, regardless of this environment value.
            #[cfg(debug_assertions)]
            let root = if let Some(path) = std::env::var_os("PERSONAL_FINANCE_TEST_ROOT") {
                let path = std::path::PathBuf::from(path);
                if !path.is_absolute() {
                    return Err(std::io::Error::other("QA data root must be absolute").into());
                }
                if let Some(window) = app.get_webview_window("main") {
                    window.set_title("Personal Finance — Isolated QA")?;
                }
                path
            } else {
                root
            };
            let instance_lease =
                workspace_lease::application(&root).map_err(std::io::Error::other)?;
            app.manage(AppState {
                _instance_lease: instance_lease,
                root,
                gate: Mutex::new(()),
                session: uuid::Uuid::new_v4().to_string(),
                ai_tasks: Mutex::new(std::collections::HashMap::new()),
                backup_gate: Mutex::new(()),
                backup_pending: Mutex::new(std::collections::BTreeMap::new()),
                backup_running: Mutex::new(None),
            });
            backup_commands::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backup_commands::backup_status,
            backup_commands::backup_choose_folder,
            backup_commands::backup_configure,
            backup_commands::backup_run,
            backup_commands::backup_pause,
            backup_commands::backup_protect,
            backup_commands::backup_open_folder,
            backup_commands::managed_backup_preview,
            backup_commands::managed_backup_restore,
            payroll_view,
            pay_commands::preview_pay_forecast,
            pay_commands::preview_pay_calibration,
            pay_commands::pay_cash_view,
            pay_commands::pay_deposit_candidates,
            pay_commands::pay_annual,
            pay_commands::pay_scenarios,
            save_payroll,
            handoff_commands::handoff_status,
            handoff_commands::handoff_export,
            handoff_commands::handoff_preview,
            handoff_commands::handoff_apply,
            handoff_commands::handoff_folder,
            snapshot,
            ai_commands::ai_prepare,
            ai_commands::ai_start,
            ai_commands::ai_jobs,
            ai_commands::ai_cancel,
            ai_commands::ai_rows_preview,
            ai_commands::ai_rows_stage,
            ai_commands::ai_rows_binding,
            ai_commands::ai_configuration,
            ai_commands::ai_mapping_preview,
            ai_commands::ai_mapping_apply,
            ai_commands::ai_document_preview,
            ai_commands::ai_document_apply,
            ai_commands::ai_document_application,
            shared_statement,
            close_review,
            close_month,
            reopen_month,
            annual_report,
            trends_report,
            card_payment_view,
            save_card_obligation,
            clear_card_obligation,
            save_card_payment_review,
            clear_card_payment_review,
            cash_forecast,
            forecast_settings,
            save_forecast_settings,
            card_statement_month,
            save_card_statement_config,
            review_card_statement,
            save_card_statement,
            cash_month,
            save_cash_schedule,
            save_cash_occurrence,
            cash_candidates,
            match_cash,
            unmatch_cash,
            record_cash,
            set_household_group,
            export_shared_statement,
            open_statement_folder,
            list_goals,
            save_goal,
            funding_view,
            save_funding,
            goal_activity,
            label_goal_interest,
            household_opening,
            save_household_opening,
            paypal_receipts,
            list_bill_templates,
            save_bill_template,
            bill_month,
            save_bill_occurrence,
            bill_candidates,
            link_bill_payment,
            unlink_bill_payment,
            record_bill_payment,
            bill_evidence,
            save_entry,
            delete_entry,
            refund_purchases,
            suggest_categories,
            preview_purchases,
            purchase_review,
            review_purchases,
            undo_purchase_review,
            list_rules,
            preview_rule,
            save_rule,
            set_budget,
            save_budget_plan,
            save_account,
            save_category,
            apply_budget_template,
            create_backup,
            restore_backup,
            preview_split,
            preview_lines,
            balance_checkpoints,
            save_checkpoint,
            delete_checkpoint,
            pdf_route_view,
            configure_pdf_route,
            pdf_table_view,
            preview_pdf_table,
            save_pdf_table,
            set_pdf_table_enabled,
            ai_provider_settings,
            save_ai_provider,
            pdf_original,
            pdf_document,
            preview_pdf_template,
            approve_pdf_template,
            set_pdf_template_enabled,
            preview_pdf_application,
            apply_pdf_application,
            export_original_pdf,
            open_pdf_folder,
            list_imports,
            get_import,
            import_profile,
            configure_import,
            confirm_import_coverage,
            finalize_import_coverage,
            new_import_observation,
            reconcile_import,
            dismiss_import,
            commit_import,
            process_import,
            get_activity_source,
            movement_matches,
            movement_detail,
            reconcile_movement,
            undo_movement,
            undo_import,
            ingest_import,
            pay_commands::pay_sources,
            pay_commands::pay_source,
            pay_commands::pay_source_original,
            pay_commands::export_pay_source,
            pay_commands::open_pay_source_folder,
            ingest_import_path,
            paste_import,
            reextract_import,
            set_native_theme
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Personal Finance");
}
