use crate::{
    assistance::{
        client, proposal, settings,
        vault::{KeyStore, WindowsVault},
    },
    db::ai_jobs::*,
    with_store, AppState, Result,
};
use tauri::{Manager, State};

#[tauri::command]
pub fn ai_document_preview(
    state: State<AppState>,
    workspace: String,
    input: crate::db::ai_documents::Input,
) -> Result<crate::db::ai_documents::Review> {
    with_store(&state, &workspace, |s| s.ai_document_preview(input))
}
#[tauri::command]
pub fn ai_document_apply(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: crate::db::ai_documents::Save,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.ai_document_apply(&operation, input)
    })
}
#[tauri::command]
pub fn ai_document_application(
    state: State<AppState>,
    workspace: String,
    source: String,
) -> Result<Option<crate::db::ai_documents::Applied>> {
    with_store(&state, &workspace, |s| s.ai_document_application(&source))
}

#[tauri::command]
pub fn ai_rows_preview(
    state: State<AppState>,
    workspace: String,
    input: crate::db::ai_rows::Input,
) -> Result<crate::db::ai_rows::Preview> {
    with_store(&state, &workspace, |s| s.ai_rows_preview(input))
}
#[tauri::command]
pub fn ai_rows_stage(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: crate::db::ai_rows::Save,
) -> Result<()> {
    with_store(&state, &workspace, |s| s.ai_rows_stage(&operation, input))
}
#[tauri::command]
pub fn ai_rows_binding(
    state: State<AppState>,
    workspace: String,
    source: String,
) -> Result<Option<crate::db::ai_rows::Binding>> {
    with_store(&state, &workspace, |s| s.ai_rows_binding(&source))
}

#[tauri::command]
pub fn ai_prepare(state: State<AppState>, workspace: String, input: Input) -> Result<Consent> {
    with_store(&state, &workspace, |s| {
        let c = settings::read(&state.root, &workspace, &input.provider)?;
        if WindowsVault
            .read(&settings::target(&state.root, &workspace, &input.provider)?)?
            .is_none()
        {
            return Err("Save an API key in provider settings first.".into());
        }
        s.ai_prepare(&input, &c)
    })
}
#[tauri::command]
pub fn ai_jobs(state: State<AppState>, workspace: String, source: String) -> Result<Vec<Job>> {
    with_store(&state, &workspace, |s| s.ai_jobs(&source))
}
#[tauri::command]
pub fn ai_cancel(state: State<AppState>, workspace: String, id: String) -> Result<Job> {
    let mut tasks = state
        .ai_tasks
        .lock()
        .map_err(|_| "Request controls are unavailable. Restart the app.")?;
    let j = with_store(&state, &workspace, |s| s.ai_cancel(&id))?;
    if let Some(task) = tasks.remove(&(workspace, id)) {
        task.abort();
    }
    Ok(j)
}
#[tauri::command]
pub fn ai_start(
    app: tauri::AppHandle,
    state: State<AppState>,
    workspace: String,
    input: Start,
) -> Result<Job> {
    let mut tasks = state
        .ai_tasks
        .lock()
        .map_err(|_| "Request controls are unavailable. Restart the app.")?;
    let (j, send) = with_store(&state, &workspace, |s| {
        let c = settings::read(&state.root, &workspace, &input.input.provider)?;
        let (j, material) = s.ai_begin(&input, &c, &state.session)?;
        let Some(material) = material else {
            return Ok((j, None));
        };
        let prepared = (|| {
            let key = WindowsVault
                .read(&settings::target(
                    &state.root,
                    &workspace,
                    &j.request.input.provider,
                )?)?
                .ok_or("The API key is missing. Check provider settings.")?;
            let body = client::body(
                &j.request.input.provider,
                &j.request.model,
                &proposal::instructions(&j.request.input.task)?,
                &material,
                &proposal::schema(&j.request.input.task),
            )
            .map_err(|f| f.message)?;
            Ok::<_, String>((key, body))
        })();
        match prepared {
            Ok(v) => Ok((j, Some(v))),
            Err(message) => Ok((
                s.ai_finish(
                    &j.id,
                    Err::<client::Outcome, _>(client::Failure::new("configuration", &message)),
                )?,
                None,
            )),
        }
    })?;
    if let Some((key, body)) = send {
        let id = j.id.clone();
        let provider = j.request.input.provider.clone();
        let index = (workspace.clone(), id.clone());
        let task = tauri::async_runtime::spawn(async move {
            let result = client::send(&provider, &key, body).await;
            let state = app.state::<AppState>();
            let _ = with_store(&state, &workspace, |s| s.ai_finish(&id, result));
            if let Ok(mut tasks) = state.ai_tasks.lock() {
                tasks.remove(&(workspace, id));
            };
        });
        tasks.insert(index, task);
    }
    Ok(j)
}

#[tauri::command]
pub fn ai_configuration(
    state: State<AppState>,
    workspace: String,
    id: String,
    revision: i64,
) -> Result<crate::assistance::configuration::Configuration> {
    with_store(&state, &workspace, |s| s.ai_configuration(&id, revision))
}
#[tauri::command]
pub fn ai_mapping_preview(
    state: State<AppState>,
    workspace: String,
    input: crate::db::ai_configuration::Input,
) -> Result<crate::db::ai_configuration::Preview> {
    with_store(&state, &workspace, |s| s.ai_mapping_preview(input))
}
#[tauri::command]
pub fn ai_mapping_apply(
    state: State<AppState>,
    workspace: String,
    operation: String,
    input: crate::db::ai_configuration::Save,
) -> Result<()> {
    with_store(&state, &workspace, |s| {
        s.ai_mapping_apply(&operation, input)
    })
}
