use crate::Result;
use std::{
    fs::{File, OpenOptions},
    path::Path,
};
/// OS-held lease coordinates independent app processes. Closing the handle releases it.
pub fn acquire(root: &Path, workspace: &str) -> Result<File> {
    crate::assistance::workspace(workspace)?;
    std::fs::create_dir_all(root).map_err(|_| "Workspace folder is unavailable.")?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(format!("{workspace}.lock")))
        .map_err(|_| "Workspace lock is unavailable.")?;
    file.try_lock().map_err(|_| {
        "Another app window is updating this workspace. Wait for it to finish and try again."
    })?;
    Ok(file)
}
pub fn application(root: &Path) -> Result<File> {
    std::fs::create_dir_all(root).map_err(|_| "Workspace folder is unavailable.")?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("application.lock"))
        .map_err(|_| "App lock is unavailable.")?;
    file.try_lock().map_err(|_|"Personal Finance is already open for this data folder. Close that window before opening another build.")?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_lease_blocks_another_handle_and_releases_on_drop() {
        let root = tempfile::tempdir().unwrap();
        let app = application(root.path()).unwrap();
        assert!(application(root.path()).is_err());
        drop(app);
        assert!(application(root.path()).is_ok());
        let a = acquire(root.path(), "personal").unwrap();
        assert!(acquire(root.path(), "personal").is_err());
        let b = acquire(root.path(), "demo").unwrap();
        drop(a);
        assert!(acquire(root.path(), "personal").is_ok());
        drop(b);
        assert!(acquire(root.path(), "../escape").is_err());
    }
}
