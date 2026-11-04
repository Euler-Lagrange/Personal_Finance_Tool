use super::*;
use crate::{handoff_crypto::MAX_DATABASE, imports::parse::hash};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

const MAGIC: &[u8] = b"PERSONAL-FINANCE-BACKUP\n1\n";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub version: u32,
    pub schema: i64,
    pub workspace: String,
    pub workspace_id: String,
    pub device: String,
    pub id: String,
    pub created_at: String,
    pub database_hash: String,
    pub database_bytes: usize,
}
pub struct Prepared {
    pub manifest: Manifest,
    pub clear: Zeroizing<Vec<u8>>,
}
pub struct Decoded {
    pub manifest: Manifest,
    pub conn: Connection,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub token: String,
    pub manifest: Manifest,
    pub local_entries: i64,
    pub incoming_entries: i64,
    pub incoming_sources: i64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub operation: String,
    pub archive_hash: String,
    pub token: String,
    pub preserved: String,
}
pub(super) fn validate(c: &Connection) -> Result<()> {
    let value: Option<String> = c
        .query_row(
            "SELECT value FROM metadata WHERE key='managed_backup_restore'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(value) = value {
        let r: Receipt =
            serde_json::from_str(&value).map_err(|_| "Invalid managed restore receipt.")?;
        Uuid::parse_str(&r.operation).map_err(|_| "Invalid restore operation.")?;
        if [&r.token, &r.archive_hash]
            .iter()
            .any(|s| s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()))
            || !r.preserved.ends_with(".managed.sqlite")
            || r.preserved.len() > 150
            || r.preserved.contains(['/', '\\', ':'])
        {
            return Err("Invalid managed restore receipt.".into());
        }
    }
    Ok(())
}
fn bytes(c: &Connection) -> Result<Zeroizing<Vec<u8>>> {
    let mut b = Zeroizing::new(c.serialize("main").map_err(err)?.to_vec());
    if b.len() < 100 || b.len() > MAX_DATABASE || !b.starts_with(b"SQLite format 3\0") {
        return Err("Choose a complete workspace no larger than 256 MB.".into());
    }
    // Standalone SQLite serialization must not retain the source WAL mode flags.
    b[18] = 1;
    b[19] = 1;
    Ok(b)
}
pub fn decode(clear: &[u8], workspace: &str) -> Result<Decoded> {
    if !clear.starts_with(MAGIC) || clear.len() < MAGIC.len() + 4 {
        return Err("This is not a managed Personal Finance backup.".into());
    }
    let n = u32::from_le_bytes(
        clear[MAGIC.len()..MAGIC.len() + 4]
            .try_into()
            .map_err(err)?,
    ) as usize;
    let start = MAGIC.len() + 4;
    let end = start.checked_add(n).ok_or("Invalid backup header.")?;
    if n > 65500 || end > clear.len() {
        return Err("Invalid backup metadata length.".into());
    }
    let m: Manifest = serde_json::from_slice(&clear[start..end])
        .map_err(|_| "Backup metadata is damaged or unsupported.")?;
    let b = &clear[end..];
    for id in [&m.workspace_id, &m.device, &m.id] {
        Uuid::parse_str(id).map_err(|_| "Invalid backup identity.")?;
    }
    chrono::DateTime::parse_from_rfc3339(&m.created_at).map_err(|_| "Invalid backup time.")?;
    if m.version != 1
        || m.workspace != workspace
        || !(42..=migrations::CURRENT_VERSION).contains(&m.schema)
        || b.len() < 100
        || b.len() > MAX_DATABASE
        || b.len() != m.database_bytes
        || hash(b) != m.database_hash
    {
        return Err("Backup identity, version, size or hash does not match. Current records were not changed.".into());
    }
    let mut c = Connection::open_in_memory().map_err(err)?;
    let capacity = b.len().checked_add(20).ok_or("Snapshot size overflow.")?;
    // SAFETY: SQLite's allocator owns this bounded buffer. OwnedData takes ownership
    // with the exact logical length; the recommended extra 20 bytes are initialized.
    let data = unsafe {
        let ptr =
            std::ptr::NonNull::new(rusqlite::ffi::sqlite3_malloc64(capacity as u64).cast::<u8>())
                .ok_or("Insufficient memory to read backup.")?;
        std::ptr::copy_nonoverlapping(b.as_ptr(), ptr.as_ptr(), b.len());
        std::ptr::write_bytes(ptr.as_ptr().add(b.len()), 0, 20);
        rusqlite::serialize::OwnedData::from_raw_nonnull(ptr, b.len())
    };
    c.deserialize("main", data, false)
        .map_err(|_| "Backup database could not be opened.")?;
    c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;")
        .map_err(err)?;
    handoff::schema_guard(&c)?;
    let check: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(err)?;
    let version: i64 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(err)?;
    let identity: String = c
        .query_row(
            "SELECT value FROM metadata WHERE key='workspace'",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if check != "ok"
        || version != m.schema
        || identity != workspace
        || c.prepare("PRAGMA foreign_key_check")
            .map_err(err)?
            .exists([])
            .map_err(err)?
    {
        return Err("Backup database integrity or identity failed validation.".into());
    }
    migrations::upgrade(&mut c)?;
    recovery::validate(&c)?;
    handoff::no_running(&c)?;
    Ok(Decoded {
        manifest: m,
        conn: c,
    })
}
impl Store {
    pub fn change_count(&self) -> u64 {
        self.conn.total_changes()
    }
    pub fn backup_device(&self) -> Result<String> {
        handoff::device(self.path.parent().ok_or("Missing app folder.")?)
    }
    pub fn managed_snapshot(&self, workspace_id: &str) -> Result<Prepared> {
        Uuid::parse_str(workspace_id).map_err(err)?;
        handoff::no_running(&self.conn)?;
        let c = handoff::copy(&self.conn)?;
        recovery::validate(&c)?;
        let b = bytes(&c)?;
        let m = Manifest {
            version: 1,
            schema: migrations::CURRENT_VERSION,
            workspace: self.workspace.clone(),
            workspace_id: workspace_id.into(),
            device: self.backup_device()?,
            id: Uuid::new_v4().to_string(),
            created_at: Utc::now().to_rfc3339(),
            database_hash: hash(&b),
            database_bytes: b.len(),
        };
        let header = serde_json::to_vec(&m).map_err(err)?;
        let mut clear =
            Zeroizing::new(Vec::with_capacity(MAGIC.len() + 4 + header.len() + b.len()));
        clear.extend_from_slice(MAGIC);
        clear.extend_from_slice(&(header.len() as u32).to_le_bytes());
        clear.extend_from_slice(&header);
        clear.extend_from_slice(&b);
        Ok(Prepared { manifest: m, clear })
    }
    pub fn managed_review(&self, incoming: &Decoded, archive_hash: &str) -> Result<Review> {
        if incoming.manifest.workspace != self.workspace {
            return Err("Backup belongs to another workspace.".into());
        }
        handoff::no_running(&self.conn)?;
        let c = handoff::copy(&self.conn)?;
        recovery::validate(&c)?;
        let token = hash(
            format!(
                "{}:{archive_hash}:{}",
                hash(&bytes(&c)?),
                incoming.manifest.id
            )
            .as_bytes(),
        );
        let count = |c: &Connection, table: &str| -> Result<i64> {
            c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .map_err(err)
        };
        Ok(Review {
            token,
            manifest: incoming.manifest.clone(),
            local_entries: count(&c, "events")?,
            incoming_entries: count(&incoming.conn, "events")?,
            incoming_sources: count(&incoming.conn, "import_sources")?
                + count(&incoming.conn, "payroll_sources")?,
        })
    }
    pub fn managed_restore(
        &mut self,
        incoming: Decoded,
        archive_hash: &str,
        operation: &str,
        token: &str,
        confirmed: bool,
    ) -> Result<Receipt> {
        Uuid::parse_str(operation).map_err(err)?;
        if !confirmed {
            return Err("Preview and confirm replacement of this workspace first.".into());
        }
        let old: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM metadata WHERE key='managed_backup_restore'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(old) = old {
            let r: Receipt = serde_json::from_str(&old).map_err(err)?;
            if r.operation == operation {
                if r.archive_hash != archive_hash || r.token != token {
                    return Err("This restore operation was used with different details.".into());
                }
                return Ok(r);
            }
        }
        if self.managed_review(&incoming, archive_hash)?.token != token {
            return Err("Workspace or backup changed after preview. Review again.".into());
        }
        let preserved = format!(
            "{}-{operation}.managed.sqlite",
            Utc::now().format("%Y%m%d-%H%M%S-%3f")
        );
        let r = Receipt {
            operation: operation.into(),
            archive_hash: archive_hash.into(),
            token: token.into(),
            preserved: preserved.clone(),
        };
        incoming.conn.execute("INSERT INTO metadata(key,value) VALUES('managed_backup_restore',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&r).map_err(err)?]).map_err(err)?;
        recovery::validate(&incoming.conn)?;
        self.conn
            .backup("main", self.backups.join(&preserved), None)
            .map_err(err)?;
        let b = rusqlite::backup::Backup::new(&incoming.conn, &mut self.conn).map_err(err)?;
        b.run_to_completion(100, Duration::from_millis(5), None)
            .map_err(err)?;
        drop(b);
        Ok(r)
    }
}
