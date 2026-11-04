use crate::{
    assistance::vault::{KeyStore, WindowsVault},
    db::managed_backup::{decode, Receipt, Review},
    handoff_commands::FileInput,
    handoff_crypto,
    imports::parse::hash,
    managed_backups::{self as backup, Setup, Status},
    with_store, AppState, Result,
};
use chrono::Utc;
use serde::Deserialize;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::{Manager, State};
use zeroize::Zeroizing;
pub struct Pending {
    first: Instant,
    last: Instant,
}
impl Pending {
    pub(crate) fn ready(&self) -> bool {
        self.last.elapsed() >= Duration::from_secs(10)
            || self.first.elapsed() >= Duration::from_secs(60)
    }
}
pub fn enqueue(state: &AppState, w: &str) {
    if ["demo", "personal"].contains(&w) {
        if let Ok(mut pending) = state.backup_pending.lock() {
            let now = Instant::now();
            pending
                .entry(w.into())
                .and_modify(|p| p.last = now)
                .or_insert(Pending {
                    first: now,
                    last: now,
                });
        }
    }
}
pub fn checkpoint(state: &AppState, w: &str) {
    enqueue(state, w);
    if let Ok(mut q) = state.backup_pending.lock() {
        if let Some(p) = q.get_mut(w) {
            p.first = Instant::now() - Duration::from_secs(60);
        }
    }
}
fn status(state: &AppState, w: &str) -> Result<Status> {
    let config = backup::load(&state.root, w)?;
    Ok(Status {
        folder: config
            .as_ref()
            .map(|c| backup::snapshots(c).display().to_string()),
        config,
        queued: state
            .backup_pending
            .lock()
            .map_err(|_| "Backup queue unavailable.")?
            .contains_key(w),
        running: state
            .backup_running
            .lock()
            .map_err(|_| "Backup worker unavailable.")?
            .as_deref()
            == Some(w),
        cloud_sync_verified: false,
    })
}
#[tauri::command]
pub fn backup_status(state: State<AppState>, workspace: String) -> Result<Status> {
    status(&state, &workspace)
}
fn attempt(
    state: &AppState,
    w: &str,
    provided: String,
    protected: bool,
    automatic: bool,
) -> Result<()> {
    attempt_with(state, w, provided, protected, automatic, &WindowsVault)
}
pub(crate) fn attempt_with(
    state: &AppState,
    w: &str,
    provided: String,
    protected: bool,
    automatic: bool,
    vault: &impl KeyStore,
) -> Result<()> {
    let _job = state
        .backup_gate
        .lock()
        .map_err(|_| "Backup worker stopped. Restart the app.")?;
    let mut c = backup::load(&state.root, w)?.ok_or("Choose a backup destination first.")?;
    if automatic && !c.automatic {
        return Ok(());
    }
    *state
        .backup_running
        .lock()
        .map_err(|_| "Backup worker unavailable.")? = Some(w.into());
    let result: Result<()> = (|| {
        let secret = backup::passphrase(&c, provided, vault)?;
        let snapshot = with_store(state, w, |s| s.managed_snapshot(&c.workspace_id))?;
        if automatic
            && c.records
                .last()
                .is_some_and(|r| r.database_hash == snapshot.manifest.database_hash)
        {
            return Ok(());
        }
        // Crypto and destination IO deliberately run outside the financial workspace gate.
        backup::publish(&state.root, &mut c, snapshot, &secret, protected)?;
        Ok(())
    })();
    if let Err(e) = &result {
        c.last_error = Some(e.clone());
        c.last_attempt = Some(Utc::now().to_rfc3339());
        let _ = backup::save(&state.root, &c);
    }
    *state
        .backup_running
        .lock()
        .map_err(|_| "Backup worker unavailable.")? = None;
    result
}
pub fn start(app: tauri::AppHandle) {
    for w in ["demo", "personal"] {
        if backup::load(&app.state::<AppState>().root, w)
            .ok()
            .flatten()
            .is_some_and(|c| c.automatic)
        {
            enqueue(&app.state::<AppState>(), w);
        }
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let state = app.state::<AppState>();
        let next = state.backup_pending.lock().ok().and_then(|mut q| {
            let next = q.iter().find(|(_, p)| p.ready()).map(|(w, _)| w.clone());
            if let Some(w) = &next {
                q.remove(w);
            }
            next
        });
        if let Some(w) = next {
            if backup::load(&state.root, &w)
                .ok()
                .flatten()
                .is_some_and(|c| c.automatic)
            {
                let _ = attempt(&state, &w, String::new(), false, true);
            }
        }
    });
}
#[tauri::command]
pub async fn backup_run(
    app: tauri::AppHandle,
    workspace: String,
    passphrase: String,
    protected: bool,
) -> Result<Status> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        attempt(&state, &workspace, passphrase, protected, false)?;
        status(&state, &workspace)
    })
    .await
    .map_err(|_| "Backup worker stopped. Review the latest status before retrying.")?
}
#[tauri::command]
pub async fn backup_configure(
    app: tauri::AppHandle,
    workspace: String,
    input: Setup,
) -> Result<Status> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let secret = Zeroizing::new(input.passphrase.clone());
        {
            let _job = state
                .backup_gate
                .lock()
                .map_err(|_| "Backup worker unavailable.")?;
            let device = with_store(&state, &workspace, |s| s.backup_device())?;
            backup::configure(&state.root, &workspace, device, input, &WindowsVault)?;
        }
        // Configuration is retained even if the first destination write fails; status explains it.
        let _ = attempt(&state, &workspace, secret.to_string(), false, false);
        status(&state, &workspace)
    })
    .await
    .map_err(|_| "Backup setup worker stopped. Reload status before retrying.")?
}
#[tauri::command]
pub async fn backup_pause(
    app: tauri::AppHandle,
    workspace: String,
    revision: i64,
) -> Result<Status> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _job = state
            .backup_gate
            .lock()
            .map_err(|_| "Backup worker unavailable.")?;
        let mut c = backup::load(&state.root, &workspace)?.ok_or("Backups are not configured.")?;
        if c.revision != revision {
            return Err("Backup settings changed. Reload before pausing.".into());
        }
        c.automatic = false;
        c.revision += 1;
        backup::save(&state.root, &c)?;
        state
            .backup_pending
            .lock()
            .map_err(|_| "Backup queue unavailable.")?
            .remove(&workspace);
        status(&state, &workspace)
    })
    .await
    .map_err(|_| "Backup worker stopped.")?
}
#[tauri::command]
pub async fn backup_protect(
    app: tauri::AppHandle,
    workspace: String,
    id: String,
    protected: bool,
    revision: i64,
) -> Result<Status> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _job = state
            .backup_gate
            .lock()
            .map_err(|_| "Backup worker unavailable.")?;
        backup::protect(&state.root, &workspace, &id, protected, revision)?;
        status(&state, &workspace)
    })
    .await
    .map_err(|_| "Backup worker stopped.")?
}
#[tauri::command]
pub async fn backup_choose_folder() -> Result<Option<String>> {
    tauri::async_runtime::spawn_blocking(move||{
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            let output=std::process::Command::new("powershell.exe").args(["-NoProfile","-STA","-WindowStyle","Hidden","-Command",r#"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $picker = [System.Windows.Forms.FolderBrowserDialog]::new(); $picker.Description = 'Choose a folder for encrypted Personal Finance backups'; $picker.ShowNewFolderButton = $true; if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($picker.SelectedPath) }; $picker.Dispose()"#]).creation_flags(0x08000000).output().map_err(|_|"Folder picker could not open. Paste the destination path instead.")?;
            if !output.status.success(){return Err("Folder picker unavailable. Paste the destination path instead.".into());}
            let path=String::from_utf8(output.stdout).map_err(|_|"Folder picker returned an unreadable path.")?;
            Ok(if path.is_empty(){None}else{Some(path)})
        }
        #[cfg(not(windows))] {Err("Folder picker is available in the Windows app.".into())}
    }).await.map_err(|_|"Folder picker stopped.")?
}
#[tauri::command]
pub fn backup_open_folder(state: State<AppState>, workspace: String) -> Result<()> {
    let c = backup::load(&state.root, &workspace)?.ok_or("Choose a destination first.")?;
    let _g = backup::owned(&c)?;
    std::process::Command::new("explorer.exe")
        .arg(backup::snapshots(&c))
        .spawn()
        .map_err(|_| "Backup folder could not be opened.")?;
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreInput {
    pub file: FileInput,
    pub passphrase: String,
    pub token: String,
    pub confirmed: bool,
}
#[tauri::command]
pub async fn managed_backup_preview(
    app: tauri::AppHandle,
    workspace: String,
    file: FileInput,
    passphrase: String,
) -> Result<Review> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = archive(file)?;
        let archive_hash = hash(&bytes);
        let clear = handoff_crypto::decrypt(&bytes, handoff_crypto::password(passphrase)?)?;
        let incoming = decode(&clear, &workspace)?;
        with_store(&app.state::<AppState>(), &workspace, |s| {
            s.managed_review(&incoming, &archive_hash)
        })
    })
    .await
    .map_err(|_| "Backup review worker stopped.")?
}
fn archive(file: FileInput) -> Result<Vec<u8>> {
    match (&file.path, &file.content) {
        (Some(path), None) => {
            backup::read_bounded(&PathBuf::from(path), handoff_crypto::MAX_ARCHIVE)
        }
        _ => file.bytes(),
    }
}
#[tauri::command]
pub async fn managed_backup_restore(
    app: tauri::AppHandle,
    workspace: String,
    operation: String,
    input: RestoreInput,
) -> Result<Receipt> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = archive(input.file)?;
        let archive_hash = hash(&bytes);
        let clear = handoff_crypto::decrypt(&bytes, handoff_crypto::password(input.passphrase)?)?;
        let incoming = decode(&clear, &workspace)?;
        let state = app.state::<AppState>();
        let receipt = with_store(&state, &workspace, |s| {
            s.managed_restore(
                incoming,
                &archive_hash,
                &operation,
                &input.token,
                input.confirmed,
            )
        })?;
        enqueue(&state, &workspace);
        Ok(receipt)
    })
    .await
    .map_err(|_| "Restore worker stopped. Retry the same operation to check completion.")?
}
