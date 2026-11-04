use crate::*;
#[tauri::command]
pub fn pay_cash_view(state: State<AppState>, workspace: String) -> Result<db::pay_cash::View> {
    with_store(&state, &workspace, |s| s.pay_cash_view())
}
#[tauri::command]
pub fn pay_deposit_candidates(
    state: State<AppState>,
    workspace: String,
    period_id: String,
) -> Result<Vec<db::pay_cash::DepositView>> {
    with_store(&state, &workspace, |s| s.pay_deposit_candidates(&period_id))
}
#[tauri::command]
pub fn pay_annual(
    state: State<AppState>,
    workspace: String,
    year: i32,
) -> Result<db::pay_cash::Annual> {
    with_store(&state, &workspace, |s| s.pay_annual(year))
}
#[tauri::command]
pub fn preview_pay_calibration(
    state: State<AppState>,
    workspace: String,
    id: String,
    observation_id: String,
    input: pay_tax::Inputs,
) -> Result<pay_tax::Calibration> {
    with_store(&state, &workspace, |s| {
        s.preview_pay_calibration(&id, &observation_id, input)
    })
}
#[tauri::command]
pub fn preview_pay_forecast(
    state: State<AppState>,
    workspace: String,
    input: pay_forecast::ForecastInput,
) -> Result<pay_forecast::Forecast> {
    with_store(&state, &workspace, |s| s.preview_pay_forecast(input))
}
#[tauri::command]
pub fn pay_scenarios(
    state: State<AppState>,
    workspace: String,
    input: pay_forecast::ScenarioInput,
) -> Result<Vec<pay_forecast::Scenario>> {
    with_store(&state, &workspace, |s| s.pay_scenarios(input))
}
#[tauri::command]
pub fn pay_sources(
    state: State<AppState>,
    workspace: String,
) -> Result<Vec<db::pay_calendar::Source>> {
    with_store(&state, &workspace, |s| s.pay_sources())
}
#[tauri::command]
pub fn pay_source(
    state: State<AppState>,
    workspace: String,
    id: String,
) -> Result<db::pay_calendar::Detail> {
    with_store(&state, &workspace, |s| s.pay_source(&id))
}
#[tauri::command]
pub fn pay_source_original(
    state: State<AppState>,
    workspace: String,
    id: String,
) -> Result<String> {
    with_store(&state, &workspace, |s| s.pay_source_original(&id))
}
#[tauri::command]
pub fn export_pay_source(state: State<AppState>, workspace: String, id: String) -> Result<String> {
    let dir = state
        .root
        .join("exports")
        .join("payroll-evidence")
        .join(&workspace);
    with_store(&state, &workspace, |s| s.export_pay_source(&dir, &id))
}
#[tauri::command]
pub fn open_pay_source_folder(state: State<AppState>) -> Result<()> {
    let dir = state.root.join("exports").join("payroll-evidence");
    if !dir.is_dir() {
        return Err("Export an original payroll document first.".into());
    }
    std::process::Command::new("explorer.exe")
        .arg(dir)
        .spawn()
        .map_err(|_| "Could not open the export folder.")?;
    Ok(())
}
