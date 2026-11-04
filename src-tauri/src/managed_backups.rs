//! Device-local configuration/catalog. Only encrypted, uniquely owned archives leave app data.
use crate::{
    assistance::vault::KeyStore,
    db::managed_backup::{self, Prepared},
    handoff_crypto,
    imports::parse::hash,
    Result,
};
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;
use zeroize::Zeroizing;
const OWNER: &str = ".personal-finance-owner.json";
#[cfg(test)]
thread_local! { static WRITE_FAILURE:std::cell::Cell<u8> = const { std::cell::Cell::new(0) }; }
#[cfg(test)]
pub fn test_fail_write(point: u8) {
    WRITE_FAILURE.set(point);
}
fn write_boundary(_point: u8) -> Result<()> {
    #[cfg(test)]
    if WRITE_FAILURE.get() == _point {
        return Err("Synthetic interrupted destination write.".into());
    }
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    pub id: String,
    pub file: String,
    pub created_at: String,
    pub archive_hash: String,
    pub database_hash: String,
    pub bytes: u64,
    pub protected: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub version: u32,
    pub revision: i64,
    pub root: PathBuf,
    pub workspace: String,
    pub workspace_id: String,
    pub device: String,
    pub owner: String,
    pub daily: usize,
    pub monthly: usize,
    pub automatic: bool,
    pub remembered: bool,
    pub passphrase_check: String,
    pub records: Vec<Record>,
    pub last_error: Option<String>,
    pub last_attempt: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Setup {
    pub revision: i64,
    pub root: String,
    pub daily: usize,
    pub monthly: usize,
    pub automatic: bool,
    pub remember: bool,
    pub recovery_confirmed: bool,
    pub passphrase: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub config: Option<Config>,
    pub folder: Option<String>,
    pub queued: bool,
    pub running: bool,
    pub cloud_sync_verified: bool,
}
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Owner {
    version: u32,
    workspace: String,
    workspace_id: String,
    device: String,
    owner: String,
}
fn owner(c: &Config) -> Owner {
    Owner {
        version: 1,
        workspace: c.workspace.clone(),
        workspace_id: c.workspace_id.clone(),
        device: c.device.clone(),
        owner: c.owner.clone(),
    }
}
fn check_workspace(w: &str) -> Result<()> {
    if !["demo", "personal"].contains(&w) {
        return Err("Unknown backup workspace.".into());
    }
    Ok(())
}
fn settings(root: &Path, w: &str) -> Result<PathBuf> {
    check_workspace(w)?;
    Ok(root.join(format!("managed-backups-{w}.json")))
}
pub fn credential(c: &Config) -> String {
    format!(
        "com.jacob.personal-finance/backups/{}/{}/{}",
        c.workspace, c.workspace_id, c.device
    )
}
pub fn folder(c: &Config) -> PathBuf {
    c.root
        .join("Personal Finance Backups")
        .join(&c.workspace_id)
        .join(&c.device)
}
pub fn snapshots(c: &Config) -> PathBuf {
    folder(c).join("snapshots")
}
fn valid_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}
fn record_name(r: &Record) -> Result<()> {
    Uuid::parse_str(&r.id).map_err(|_| "Invalid archive identity.")?;
    let d = DateTime::parse_from_rfc3339(&r.created_at).map_err(|_| "Invalid archive time.")?;
    if r.file
        != format!(
            "{}-{}.pfbackup",
            d.with_timezone(&Utc).format("%Y%m%dT%H%M%S%3fZ"),
            r.id
        )
        || !valid_hash(&r.archive_hash)
        || !valid_hash(&r.database_hash)
        || r.bytes > handoff_crypto::MAX_ARCHIVE as u64
    {
        return Err("Invalid backup catalog entry. No files were deleted.".into());
    }
    Ok(())
}
fn validate(c: &Config, w: &str) -> Result<()> {
    check_workspace(w)?;
    for id in [&c.workspace_id, &c.device, &c.owner] {
        Uuid::parse_str(id).map_err(|_| "Invalid backup configuration identity.")?;
    }
    if c.version != 1
        || c.workspace != w
        || c.revision < 1
        || !c.root.is_absolute()
        || c.daily > 365
        || c.daily < 1
        || c.monthly > 120
        || c.records.len() > 10000
        || c.automatic && !c.remembered
        || c.passphrase_check.len() > 4096
        || c.passphrase_check.is_empty()
    {
        return Err("Backup configuration is invalid or unsupported.".into());
    }
    let mut seen = BTreeSet::new();
    for r in &c.records {
        record_name(r)?;
        if !seen.insert(&r.id) {
            return Err("Duplicate backup catalog identity.".into());
        }
    }
    Ok(())
}
// Hold directory handles without FILE_SHARE_DELETE while using managed paths.
// Cloud-placeholder reparse tags are allowed; name-surrogate links/junctions are not.
pub struct DirectoryGuard {
    _handles: Vec<File>,
}
pub fn guard(path: &Path) -> Result<DirectoryGuard> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return Err("Choose an absolute folder without parent traversal.".into());
    }
    let mut handles = vec![];
    let mut cursor = PathBuf::new();
    for part in path.components() {
        cursor.push(part.as_os_str());
        if matches!(part, Component::Prefix(_)) {
            continue;
        }
        let f = checked_file(&cursor, true)?;
        handles.push(f);
    }
    Ok(DirectoryGuard { _handles: handles })
}
fn checked_file(path: &Path, directory: bool) -> Result<File> {
    #[cfg(windows)]
    {
        use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
        use windows::Win32::{
            Foundation::HANDLE,
            Storage::FileSystem::{
                FileAttributeTagInfo, GetFileInformationByHandleEx, FILE_ATTRIBUTE_TAG_INFO,
            },
        };
        let f=OpenOptions::new().read(true).access_mode(0x80).share_mode(3).custom_flags(0x02200000).open(path).map_err(|_|"Backup path is unavailable. Make the folder/files available on this device and try again.")?;
        let mut tag = FILE_ATTRIBUTE_TAG_INFO::default();
        // SAFETY: the handle is owned by f; the output buffer has the API's exact size.
        unsafe {
            GetFileInformationByHandleEx(
                HANDLE(f.as_raw_handle()),
                FileAttributeTagInfo,
                (&mut tag as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
                std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
            )
            .map_err(|_| "Could not verify backup path ownership.")?;
        }
        if tag.ReparseTag & 0x20000000 != 0 || (tag.FileAttributes & 0x10 != 0) != directory {
            return Err(
                "Backup path redirects to another location or has the wrong file type.".into(),
            );
        }
        Ok(f)
    }
    #[cfg(not(windows))]
    {
        let m = fs::symlink_metadata(path).map_err(|_| "Backup path is unavailable.")?;
        if m.file_type().is_symlink() || m.is_dir() != directory {
            return Err("Backup path redirects or has the wrong type.".into());
        }
        File::open(path).map_err(|e| e.to_string())
    }
}
pub fn read_bounded(path: &Path, max: usize) -> Result<Vec<u8>> {
    let _parent = guard(path.parent().ok_or("Choose a local file.")?)?;
    let _identity = checked_file(path, false)?;
    let f = File::open(path)
        .map_err(|_| "Backup file could not be read. Download it locally and retry.")?;
    if f.metadata().map_err(|e| e.to_string())?.len() > max as u64 {
        return Err("Backup file exceeds the supported size.".into());
    }
    let mut b = vec![];
    f.take(max as u64 + 1)
        .read_to_end(&mut b)
        .map_err(|_| "Backup file is unavailable or incomplete. Download it locally and retry.")?;
    if b.len() > max {
        return Err("Backup file changed or exceeds the size limit.".into());
    }
    Ok(b)
}
pub fn load(root: &Path, w: &str) -> Result<Option<Config>> {
    let p = settings(root, w)?;
    if !p.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let c: Config = serde_json::from_slice(&read_bounded(&p, 4 * 1024 * 1024)?)
        .map_err(|_| "Backup configuration could not be read. Existing archives remain intact.")?;
    validate(&c, w)?;
    Ok(Some(c))
}
fn write_new(path: &Path, b: &[u8]) -> Result<()> {
    let mut f = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|_| "Backup destination is unavailable, full, or already in use.")?;
    f.write_all(b)
        .and_then(|_| f.sync_all())
        .map_err(|_| "Backup write did not finish. Check free space and folder access.".into())
}
fn publish_name(source: &Path, target: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH},
        };
        let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        // No REPLACE_EXISTING: even a concurrent name collision must preserve that file.
        unsafe {
            MoveFileExW(
                PCWSTR(from.as_ptr()),
                PCWSTR(to.as_ptr()),
                MOVEFILE_WRITE_THROUGH,
            )
            .map_err(|_| "Backup could not be published. Existing copies remain intact.".into())
        }
    }
    #[cfg(not(windows))]
    {
        if target.exists() {
            return Err("Backup already exists.".into());
        }
        fs::rename(source, target).map_err(|e| e.to_string())
    }
}
pub fn save(root: &Path, c: &Config) -> Result<()> {
    validate(c, &c.workspace)?;
    let _g = guard(root)?;
    let p = settings(root, &c.workspace)?;
    if p.exists() {
        drop(checked_file(&p, false)?);
    }
    let tmp = root.join(format!(".managed-config-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        write_new(
            &tmp,
            &serde_json::to_vec_pretty(c).map_err(|e| e.to_string())?,
        )?;
        fs::rename(&tmp, &p).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
pub fn owned(c: &Config) -> Result<DirectoryGuard> {
    validate(c, &c.workspace)?;
    let g = guard(&snapshots(c))?;
    let marker: Owner = serde_json::from_slice(&read_bounded(&folder(c).join(OWNER), 4096)?)
        .map_err(|_| {
            "Backup ownership marker is missing or changed. Existing files were not touched."
        })?;
    if marker != owner(c) {
        return Err("Backup ownership changed. Existing files were not touched.".into());
    }
    Ok(g)
}
fn initialize(c: &Config) -> Result<()> {
    let mut p = c.root.clone();
    let _root = guard(&p)?;
    for name in [
        "Personal Finance Backups",
        &c.workspace_id,
        &c.device,
        "snapshots",
    ] {
        let _parent = guard(&p)?;
        p.push(name);
        match fs::create_dir(&p) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err("Cannot create the managed backup folders.".into()),
        }
        drop(guard(&p)?);
    }
    let _g = guard(&folder(c))?;
    let marker = folder(c).join(OWNER);
    if marker.exists() {
        drop(owned(c)?);
    } else {
        if fs::read_dir(snapshots(c))
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
        {
            return Err("Refusing to adopt an existing unowned backup folder.".into());
        }
        write_new(
            &marker,
            &serde_json::to_vec(&owner(c)).map_err(|e| e.to_string())?,
        )?;
        write_new(&folder(c).join("README.txt"),b"Personal Finance encrypted backups. Restore a .pfbackup in Workspace & backups using your independently retained passphrase. The live database stays local. OneDrive upload/sync is not verified. Files from other devices are never rotated here. Keep required files available on this device for offline restore.\r\n")?;
    }
    Ok(())
}
pub fn passphrase(
    c: &Config,
    provided: String,
    vault: &impl KeyStore,
) -> Result<Zeroizing<String>> {
    let s = if !provided.is_empty() {
        provided
    } else if c.remembered {
        vault.read(&credential(c))?.ok_or("Saved backup passphrase is unavailable. Enter your retained passphrase to reconnect this device.")?
    } else {
        return Err("Enter the backup passphrase for this manual backup.".into());
    };
    let s = Zeroizing::new(s);
    handoff_crypto::password(s.to_string())?;
    Ok(s)
}
fn verify_secret(c: &Config, secret: &str) -> Result<()> {
    let b = base64::engine::general_purpose::STANDARD
        .decode(&c.passphrase_check)
        .map_err(|_| "Backup password check is damaged.")?;
    let clear=handoff_crypto::decrypt(&b,handoff_crypto::password(secret.into())?)
        .map_err(|_| "This passphrase does not match the destination's backup set. Use its original recovery passphrase.")?;
    if clear.as_slice() != format!("Personal Finance backup password check: {}", c.owner).as_bytes()
    {
        return Err("Backup password check belongs to a different configuration.".into());
    }
    Ok(())
}
pub fn configure(
    root: &Path,
    w: &str,
    device: String,
    input: Setup,
    vault: &impl KeyStore,
) -> Result<Config> {
    let old = load(root, w)?;
    if old.as_ref().map_or(0, |c| c.revision) != input.revision {
        return Err("Backup settings changed. Reload before saving.".into());
    }
    if !input.recovery_confirmed
        || input.automatic && !input.remember
        || input.daily < 1
        || input.daily > 365
        || input.monthly > 120
    {
        return Err("Confirm your independently retained passphrase and valid retention settings. Automatic copies require Remember on this device.".into());
    }
    let requested = PathBuf::from(&input.root);
    if !requested.is_absolute()
        || requested
            .components()
            .any(|p| matches!(p, Component::ParentDir))
    {
        return Err("Choose an existing absolute destination folder.".into());
    }
    let resolved = fs::canonicalize(&requested)
        .map_err(|_| "Destination folder is unavailable. Choose an existing local folder.")?;
    let _g = guard(&resolved)?;
    let same = old.as_ref().is_some_and(|c| c.root == resolved);
    let mut c = if same {
        old.clone().unwrap()
    } else {
        Config {
            version: 1,
            revision: 0,
            root: resolved,
            workspace: w.into(),
            workspace_id: Uuid::new_v4().to_string(),
            device,
            owner: Uuid::new_v4().to_string(),
            daily: 30,
            monthly: 12,
            automatic: false,
            remembered: false,
            passphrase_check: String::new(),
            records: vec![],
            last_error: None,
            last_attempt: None,
        }
    };
    let secret = passphrase(&c, input.passphrase, vault)?;
    // A small encrypted check avoids depending on hydration of an older cloud copy.
    // It also prevents a mistyped manual password from silently rotating the archive key.
    if same {
        verify_secret(&c, &secret)?;
    } else {
        c.passphrase_check =
            base64::engine::general_purpose::STANDARD.encode(handoff_crypto::encrypt(
                format!("Personal Finance backup password check: {}", c.owner).as_bytes(),
                handoff_crypto::password(secret.to_string())?,
            )?);
    }
    c.revision = input.revision + 1;
    c.daily = input.daily;
    c.monthly = input.monthly;
    c.automatic = input.automatic;
    c.remembered = input.remember;
    initialize(&c)?;
    if input.remember {
        vault.write(&credential(&c), &secret)?;
    }
    save(root, &c)?;
    if !input.remember {
        vault.delete(&credential(&c))?;
    }
    // Old destination files and credentials remain recoverable; no cleanup crosses namespaces.
    Ok(c)
}
pub fn retained(records: &[Record], daily: usize, monthly: usize) -> BTreeSet<String> {
    let mut days = BTreeMap::new();
    let mut months = BTreeMap::new();
    let mut keep = BTreeSet::new();
    let mut sorted: Vec<_> = records.iter().collect();
    sorted.sort_by_key(|r| (&r.created_at, &r.id));
    for r in &sorted {
        days.insert(&r.created_at[..10], &r.id);
        months.insert(&r.created_at[..7], &r.id);
        if r.protected {
            keep.insert(r.id.clone());
        }
    }
    for id in days
        .values()
        .rev()
        .take(daily)
        .chain(months.values().rev().take(monthly))
    {
        keep.insert((*id).clone());
    }
    if let Some(r) = sorted.last() {
        keep.insert(r.id.clone());
    }
    keep
}
fn prune(root: &Path, c: &mut Config) -> Result<()> {
    let _g = owned(c)?;
    let keep = retained(&c.records, c.daily, c.monthly);
    let mut removed = BTreeSet::new();
    for r in &c.records {
        if keep.contains(&r.id) {
            continue;
        }
        record_name(r)?;
        let path = snapshots(c).join(&r.file);
        if !path.try_exists().map_err(|e| e.to_string())? {
            removed.insert(r.id.clone());
            continue;
        }
        delete_verified(c, &path, r)?;
        removed.insert(r.id.clone());
    }
    c.records.retain(|r| !removed.contains(&r.id));
    save(root, c)
}
fn delete_verified(c: &Config, path: &Path, r: &Record) -> Result<()> {
    let _owner = owned(c)?;
    #[cfg(windows)]
    {
        use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
        use windows::Win32::{Foundation::HANDLE, Storage::FileSystem::*};
        // Hold the exact object against concurrent writes/replacement through verification
        // and deletion. Never re-resolve a mutable file name after hashing its contents.
        let mut f = OpenOptions::new()
            .read(true)
            .access_mode(0x10081)
            .share_mode(1)
            .custom_flags(0x00200000)
            .open(path)
            .map_err(|_| {
                "New backup is saved, but an old copy is busy or unavailable for retention."
            })?;
        let handle = HANDLE(f.as_raw_handle());
        let mut tag = FILE_ATTRIBUTE_TAG_INFO::default();
        // SAFETY: f owns a valid handle and both structures have the exact Win32 size.
        unsafe {
            GetFileInformationByHandleEx(
                handle,
                FileAttributeTagInfo,
                (&mut tag as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
                std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
            )
            .map_err(|_| "Could not verify the old archive type.")?;
        }
        if tag.ReparseTag & 0x20000000 != 0 || tag.FileAttributes & 0x10 != 0 {
            return Err("Refusing retention of a redirected archive.".into());
        }
        let mut bytes = vec![];
        Read::by_ref(&mut f)
            .take(handoff_crypto::MAX_ARCHIVE as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Old archive is unavailable for verification.")?;
        if hash(&bytes) != r.archive_hash || bytes.len() as u64 != r.bytes {
            return Err("An older archive changed outside the app. Retention stopped; no unrecognized file was deleted.".into());
        }
        drop(owned(c)?);
        let info = FILE_DISPOSITION_INFO { DeleteFile: true };
        unsafe {
            SetFileInformationByHandle(
                handle,
                FileDispositionInfo,
                (&info as *const FILE_DISPOSITION_INFO).cast(),
                std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
            .map_err(|_| "New backup is saved, but an old copy could not be rotated.")?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let bytes = read_bounded(path, handoff_crypto::MAX_ARCHIVE)?;
        if hash(&bytes) != r.archive_hash || bytes.len() as u64 != r.bytes {
            return Err("Old archive changed; retention stopped.".into());
        }
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}
pub fn publish(
    root: &Path,
    c: &mut Config,
    prepared: Prepared,
    secret: &str,
    protected: bool,
) -> Result<Record> {
    verify_secret(c, secret)?;
    if prepared.manifest.workspace != c.workspace
        || prepared.manifest.workspace_id != c.workspace_id
        || prepared.manifest.device != c.device
    {
        return Err("Backup workspace changed before copying.".into());
    }
    if c.records.len() >= 10000 {
        return Err("Backup catalog is full. Review protected copies before continuing.".into());
    }
    let encrypted =
        handoff_crypto::encrypt(&prepared.clear, handoff_crypto::password(secret.into())?)?;
    let id = prepared.manifest.id.clone();
    let stage = root.join(format!(".pfbackup-stage-{id}"));
    let _local = guard(root)?;
    let mut staged_owned = false;
    let result = (|| {
        write_new(&stage, &encrypted)?;
        staged_owned = true;
        let staged = read_bounded(&stage, handoff_crypto::MAX_ARCHIVE)?;
        if hash(&staged) != hash(&encrypted) {
            return Err("Local backup staging verification failed.".into());
        }
        let clear = handoff_crypto::decrypt(&staged, handoff_crypto::password(secret.into())?)?;
        let verified = managed_backup::decode(&clear, &c.workspace)?;
        if verified.manifest.database_hash != prepared.manifest.database_hash {
            return Err("Backup recovery verification failed.".into());
        }
        let _destination = owned(c)?;
        let dt = DateTime::parse_from_rfc3339(&prepared.manifest.created_at)
            .map_err(|e| e.to_string())?;
        let record = Record {
            id: id.clone(),
            file: format!(
                "{}-{id}.pfbackup",
                dt.with_timezone(&Utc).format("%Y%m%dT%H%M%S%3fZ")
            ),
            created_at: prepared.manifest.created_at.clone(),
            archive_hash: hash(&staged),
            database_hash: prepared.manifest.database_hash.clone(),
            bytes: staged.len() as u64,
            protected,
        };
        let partial = snapshots(c).join(format!(".{id}.partial"));
        let final_path = snapshots(c).join(&record.file);
        let mut partial_owned = false;
        let copied: Result<()> = (|| {
            write_new(&partial, &staged)?;
            partial_owned = true;
            write_boundary(1)?;
            let b = read_bounded(&partial, handoff_crypto::MAX_ARCHIVE)?;
            if hash(&b) != record.archive_hash {
                return Err("Destination backup verification failed.".into());
            }
            drop(owned(c)?);
            if final_path.exists() {
                return Err("Backup name collision; retry a new snapshot.".into());
            }
            publish_name(&partial, &final_path)?;
            Ok(())
        })();
        if copied.is_err() {
            if partial_owned && owned(c).is_ok() {
                let _ = fs::remove_file(&partial);
            }
            copied?;
        }
        write_boundary(2)?;
        c.records.push(record.clone());
        c.last_error = None;
        c.last_attempt = Some(Utc::now().to_rfc3339());
        save(root, c)?;
        // A failed prune never invalidates the newly verified recovery point.
        if let Err(e) = prune(root, c) {
            c.last_error = Some(e);
            save(root, c)?;
        }
        Ok(record)
    })();
    if staged_owned {
        let _ = fs::remove_file(stage);
    }
    result
}
pub fn protect(root: &Path, w: &str, id: &str, protected: bool, revision: i64) -> Result<()> {
    let mut c = load(root, w)?.ok_or("Configure backups first.")?;
    if c.revision != revision {
        return Err("Backup settings changed. Reload first.".into());
    }
    c.records
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or("Backup is no longer cataloged.")?
        .protected = protected;
    c.revision += 1;
    save(root, &c)
}
