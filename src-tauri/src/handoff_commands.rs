use crate::{db::handoff::*, handoff_crypto::MAX_ARCHIVE, with_store, AppState, Result};
use base64::Engine;
use serde::Deserialize;
use std::{fs::File, io::Read};
use tauri::{Manager, State};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileInput {
    pub content: Option<String>,
    pub path: Option<String>,
}
impl FileInput {
    pub(crate) fn bytes(self) -> Result<Vec<u8>> {
        match (self.content, self.path) {
            (Some(content), None) => {
                if content.len() > MAX_ARCHIVE * 4 / 3 + 4 {
                    return Err("Choose a handoff file no larger than 258 MB.".into());
                }
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(content)
                    .map_err(|_| "File could not be read.")?;
                if bytes.len() > MAX_ARCHIVE {
                    return Err("Handoff file is too large.".into());
                }
                Ok(bytes)
            }
            (None, Some(path)) => {
                let f = File::open(path).map_err(|_| {
                    "Handoff file could not be opened. Copy it to a local folder and try again."
                })?;
                let m = f.metadata().map_err(|_| "File details are unavailable.")?;
                if !m.is_file() || m.len() > MAX_ARCHIVE as u64 {
                    return Err("Choose an individual handoff file no larger than 258 MB.".into());
                }
                let mut b = vec![];
                f.take(MAX_ARCHIVE as u64 + 1)
                    .read_to_end(&mut b)
                    .map_err(|_| "Handoff file could not be read.")?;
                if b.len() > MAX_ARCHIVE {
                    return Err("Handoff file changed or is too large.".into());
                }
                Ok(b)
            }
            _ => Err("Choose exactly one handoff file.".into()),
        }
    }
}
#[tauri::command]
pub fn handoff_status(state: State<AppState>, workspace: String) -> Result<Status> {
    with_store(&state, &workspace, |s| s.handoff_status())
}
#[tauri::command]
pub async fn handoff_export(
    app: tauri::AppHandle,
    workspace: String,
    operation: String,
    label: String,
    passphrase: String,
) -> Result<Exported> {
    tauri::async_runtime::spawn_blocking(move || {
        with_store(&app.state::<AppState>(), &workspace, |s| {
            s.export_handoff(&operation, &label, passphrase)
        })
    })
    .await
    .map_err(|_| "Export worker stopped. Retry the same operation.")?
}
#[tauri::command]
pub async fn handoff_preview(
    app: tauri::AppHandle,
    workspace: String,
    file: FileInput,
    passphrase: String,
) -> Result<Review> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = file.bytes()?;
        with_store(&app.state::<AppState>(), &workspace, |s| {
            s.preview_handoff(&bytes, passphrase)
        })
    })
    .await
    .map_err(|_| "Review worker stopped. Try again.")?
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Apply {
    pub file: FileInput,
    pub passphrase: String,
    pub token: String,
    pub confirmed: bool,
    pub replace_confirmed: bool,
}
#[tauri::command]
pub async fn handoff_apply(
    app: tauri::AppHandle,
    workspace: String,
    operation: String,
    input: Apply,
) -> Result<Applied> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = input.file.bytes()?;
        let result = with_store(&app.state::<AppState>(), &workspace, |s| {
            s.apply_handoff(
                &operation,
                &bytes,
                input.passphrase,
                &input.token,
                input.confirmed,
                input.replace_confirmed,
            )
        });
        if result.is_ok() {
            crate::backup_commands::checkpoint(&app.state::<AppState>(), &workspace);
        }
        result
    })
    .await
    .map_err(|_| "Import worker stopped. Retry the same operation to check whether it completed.")?
}
#[tauri::command]
pub fn handoff_folder(state: State<AppState>) -> Result<()> {
    let folder = state.root.join("exports/handoffs");
    std::fs::create_dir_all(&folder).map_err(|_| "Export folder is unavailable.")?;
    std::process::Command::new("explorer.exe")
        .arg(folder)
        .spawn()
        .map_err(|_| "Export folder could not be opened.")?;
    Ok(())
}
