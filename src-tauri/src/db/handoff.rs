use super::*;
use crate::handoff_crypto::{self, MAX_ARCHIVE, MAX_DATABASE};
use rusqlite::types::ValueRef;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Write};
use zeroize::Zeroizing;
const MAGIC: &[u8] = b"PERSONAL-FINANCE-HANDOFF\n1\n";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub version: u32,
    pub workspace: String,
    pub schema: i64,
    pub lineage: String,
    pub transfer: String,
    pub created_at: String,
    pub device: String,
    pub label: String,
    pub content_hash: String,
    pub database_hash: String,
    pub database_bytes: usize,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    id: String,
    parent: Option<String>,
    content_hash: String,
    created_at: String,
    device: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct History {
    lineage: Option<String>,
    head: Option<String>,
    nodes: BTreeMap<String, Node>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub transfer: Option<String>,
    pub changed: bool,
    pub lineage: Option<String>,
    pub export_folder: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub token: String,
    pub manifest: Manifest,
    pub relationship: String,
    pub requires_replacement_ack: bool,
    pub local_entries: i64,
    pub incoming_entries: i64,
    pub local_sources: i64,
    pub incoming_sources: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    pub path: String,
    pub transfer: String,
    pub archive_hash: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub preserved: String,
    pub already_applied: bool,
}
fn json<T: Serialize>(v: &T) -> Result<String> {
    serde_json::to_string(v).map_err(err)
}
fn hash(bytes: &[u8]) -> String {
    crate::imports::parse::hash(bytes)
}
fn encoded_hash<T: Serialize>(v: &T) -> Result<String> {
    Ok(hash(json(v)?.as_bytes()))
}
fn valid_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit())
}
fn history(c: &Connection) -> Result<History> {
    let state: Option<(String, Option<String>)> = c
        .query_row(
            "SELECT lineage,head FROM handoff_state WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let mut q = c
        .prepare("SELECT id,parent,content_hash,created_at,device FROM handoff_nodes ORDER BY id")
        .map_err(err)?;
    let nodes = q
        .query_map([], |r| {
            Ok(Node {
                id: r.get(0)?,
                parent: r.get(1)?,
                content_hash: r.get(2)?,
                created_at: r.get(3)?,
                device: r.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(History {
        lineage: state.as_ref().map(|s| s.0.clone()),
        head: state.and_then(|s| s.1),
        nodes: nodes.into_iter().map(|n| (n.id.clone(), n)).collect(),
    })
}
fn chain(h: &History) -> Result<Vec<&Node>> {
    if h.nodes.len() > 4096 {
        return Err("Transfer history exceeds the supported limit.".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    let mut next = h.head.as_ref();
    while let Some(id) = next {
        if !seen.insert(id) {
            return Err("Transfer history contains a cycle.".into());
        }
        let n = h.nodes.get(id).ok_or("Transfer ancestry is incomplete.")?;
        out.push(n);
        next = n.parent.as_ref();
    }
    if out.len() != h.nodes.len() {
        return Err("Transfer ancestry contains disconnected records.".into());
    }
    Ok(out)
}
pub(super) fn validate(c: &Connection) -> Result<()> {
    let h = history(c)?;
    if let Some(lineage) = &h.lineage {
        Uuid::parse_str(lineage).map_err(err)?;
    } else if !h.nodes.is_empty() {
        return Err("Missing workspace lineage.".into());
    }
    for n in chain(&h)? {
        Uuid::parse_str(&n.id).map_err(err)?;
        Uuid::parse_str(&n.device).map_err(err)?;
        chrono::DateTime::parse_from_rfc3339(&n.created_at).map_err(err)?;
        if !valid_hash(&n.content_hash) {
            return Err("Invalid transfer content hash.".into());
        }
    }
    let mut q = c
        .prepare("SELECT id,archive_hash,preview_token,preserved FROM handoff_receipts")
        .map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    while let Some(r) = rows.next().map_err(err)? {
        Uuid::parse_str(&r.get::<_, String>(0).map_err(err)?).map_err(err)?;
        let name: String = r.get(3).map_err(err)?;
        if h.lineage.is_none()
            || !valid_hash(&r.get::<_, String>(1).map_err(err)?)
            || !valid_hash(&r.get::<_, String>(2).map_err(err)?)
            || !safe_backup_name(&name)
        {
            return Err("Invalid transfer receipt.".into());
        }
    }
    Ok(())
}
fn safe_backup_name(name: &str) -> bool {
    name.ends_with(".handoff.sqlite")
        && name.len() < 150
        && !name.contains(['/', '\\', ':'])
        && Path::new(name).components().count() == 1
}
// Hash table contents rather than file page layout or a monotonically increasing counter.
// Transfer metadata is excluded so merely exporting does not manufacture local changes.
fn content(c: &Connection) -> Result<String> {
    let mut hasher = Sha256::new();
    let mut q=c.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'handoff_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").map_err(err)?;
    let tables = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (name, sql) in tables {
        hasher.update(encoded_hash(&(name.clone(), sql))?.as_bytes());
        let mut q = c
            .prepare(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\"")))
            .map_err(err)?;
        let count = q.column_count();
        let names = q
            .column_names()
            .iter()
            .map(|n| n.to_string())
            .collect::<Vec<_>>();
        hasher.update(encoded_hash(&names)?.as_bytes());
        let mut rows = q.query([]).map_err(err)?;
        let mut hashes = vec![];
        while let Some(r) = rows.next().map_err(err)? {
            let mut rowhash = Sha256::new();
            for i in 0..count {
                match r.get_ref(i).map_err(err)? {
                    ValueRef::Null => rowhash.update([0]),
                    ValueRef::Integer(n) => {
                        rowhash.update([1]);
                        rowhash.update(n.to_le_bytes());
                    }
                    ValueRef::Real(n) => {
                        rowhash.update([2]);
                        rowhash.update(n.to_bits().to_le_bytes());
                    }
                    ValueRef::Text(v) => {
                        rowhash.update([3]);
                        rowhash.update((v.len() as u64).to_le_bytes());
                        rowhash.update(v);
                    }
                    ValueRef::Blob(v) => {
                        rowhash.update([4]);
                        rowhash.update((v.len() as u64).to_le_bytes());
                        rowhash.update(v);
                    }
                }
            }
            hashes.push(rowhash.finalize().to_vec());
        }
        hashes.sort();
        hasher.update((hashes.len() as u64).to_le_bytes());
        for h in hashes {
            hasher.update(h);
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}
pub(super) fn no_running(c: &Connection) -> Result<()> {
    let running: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_jobs WHERE status='running')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if running {
        return Err(
            "Wait for active AI requests to finish, or cancel them before a handoff.".into(),
        );
    }
    Ok(())
}
pub(super) fn copy(c: &Connection) -> Result<Connection> {
    let mut out = Connection::open_in_memory().map_err(err)?;
    {
        let b = rusqlite::backup::Backup::new(c, &mut out).map_err(err)?;
        b.run_to_completion(100, Duration::from_millis(5), None)
            .map_err(err)?;
    }
    out.execute_batch(
        "PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;",
    )
    .map_err(err)?;
    Ok(out)
}
pub(super) fn device(root: &Path) -> Result<String> {
    let file = root.join("handoff-device-id");
    if file.exists() {
        let s = fs::read_to_string(file).map_err(err)?;
        Uuid::parse_str(&s).map_err(|_| "This device's handoff identity is invalid.")?;
        return Ok(s);
    }
    let id = Uuid::new_v4().to_string();
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
    {
        Ok(mut f) => {
            f.write_all(id.as_bytes()).map_err(err)?;
            f.sync_all().map_err(err)?;
            Ok(id)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => device(root),
        Err(e) => Err(err(e)),
    }
}
fn add_node(c: &Connection, lineage: &str, n: &Node) -> Result<()> {
    c.execute(
        "INSERT INTO handoff_nodes VALUES(?1,?2,?3,?4,?5)",
        params![n.id, n.parent, n.content_hash, n.created_at, n.device],
    )
    .map_err(err)?;
    c.execute("INSERT INTO handoff_state VALUES(1,?1,?2) ON CONFLICT(singleton) DO UPDATE SET lineage=excluded.lineage,head=excluded.head",params![lineage,n.id]).map_err(err)?;
    Ok(())
}
fn encode(
    c: &Connection,
    workspace: &str,
    lineage: &str,
    node: &Node,
    label: &str,
) -> Result<Zeroizing<Vec<u8>>> {
    let mut database = Zeroizing::new(c.serialize("main").map_err(err)?.to_vec());
    if database.len() > MAX_DATABASE {
        return Err("Workspace exceeds the 256 MB portable snapshot limit.".into());
    }
    // SQLite backup copies WAL header flags even into an in-memory destination.
    // Serialized snapshots are standalone; SQLite documents normalizing these
    // two format bytes before deserialization (sqlite.org/c3ref/deserialize.html).
    if database.len() < 100 || !database.starts_with(b"SQLite format 3\0") {
        return Err("Snapshot is not a complete SQLite database.".into());
    }
    database[18] = 1;
    database[19] = 1;
    let manifest = Manifest {
        version: 1,
        workspace: workspace.into(),
        schema: migrations::CURRENT_VERSION,
        lineage: lineage.into(),
        transfer: node.id.clone(),
        created_at: node.created_at.clone(),
        device: node.device.clone(),
        label: label.into(),
        content_hash: node.content_hash.clone(),
        database_hash: hash(&database),
        database_bytes: database.len(),
    };
    let header = serde_json::to_vec(&manifest).map_err(err)?;
    if header.len() > 65500 {
        return Err("Transfer metadata exceeds the supported limit.".into());
    }
    let mut out = Zeroizing::new(Vec::with_capacity(
        MAGIC.len() + 4 + header.len() + database.len(),
    ));
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    out.extend_from_slice(&database);
    Ok(out)
}
pub(super) fn schema_guard(c: &Connection) -> Result<()> {
    let mut q = c
        .prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN('trigger','view')")
        .map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    let expected = include_str!("../migrations/016_payment_codes.sql")
        .split("CREATE VIEW")
        .nth(1)
        .ok_or("Missing built-in view definition.")?;
    let normalize = |s: &str| {
        s.trim()
            .trim_end_matches(';')
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    while let Some(r) = rows.next().map_err(err)? {
        let kind: String = r.get(0).map_err(err)?;
        let name: String = r.get(1).map_err(err)?;
        let sql: String = r.get(2).map_err(err)?;
        if kind != "view"
            || name != "effective_activity_dates"
            || normalize(&sql) != normalize(&format!("CREATE VIEW{expected}"))
        {
            return Err("Handoff contains an unsupported database view or trigger.".into());
        }
    }
    Ok(())
}
fn decode(clear: &[u8], workspace: &str) -> Result<(Manifest, Connection)> {
    if !clear.starts_with(MAGIC) || clear.len() < MAGIC.len() + 4 {
        return Err("This is not a Personal Finance handoff.".into());
    }
    let n = u32::from_le_bytes(
        clear[MAGIC.len()..MAGIC.len() + 4]
            .try_into()
            .map_err(err)?,
    ) as usize;
    let start = MAGIC.len() + 4;
    let end = start.checked_add(n).ok_or("Invalid handoff header.")?;
    if n > 65500 || end > clear.len() {
        return Err("Invalid handoff metadata length.".into());
    }
    let m: Manifest = serde_json::from_slice(&clear[start..end])
        .map_err(|_| "Handoff metadata is damaged or unsupported.")?;
    let bytes = &clear[end..];
    if m.version != 1
        || m.workspace != workspace
        || m.schema < 35
        || m.schema > migrations::CURRENT_VERSION
        || bytes.len() != m.database_bytes
        || bytes.len() > MAX_DATABASE
        || hash(bytes) != m.database_hash
        || !valid_hash(&m.content_hash)
        || m.label.len() > 100
    {
        return Err("Handoff identity, version, size or content hash does not match. Current data was not changed.".into());
    }
    let mut c = Connection::open_in_memory().map_err(err)?;
    // SQLite recommends 20 spare bytes for a potentially malformed serialized
    // input. OwnedData's logical length remains the exact verified database size.
    let capacity = bytes
        .len()
        .checked_add(20)
        .ok_or("Snapshot size overflow.")?;
    // SAFETY: allocate with SQLite's allocator as required by OwnedData. The
    // checked, bounded allocation holds the full input plus the zero padding;
    // ownership passes to rusqlite, which frees it on success or deserialize error.
    let data = unsafe {
        let ptr =
            std::ptr::NonNull::new(rusqlite::ffi::sqlite3_malloc64(capacity as u64).cast::<u8>())
                .ok_or("Insufficient memory to open the snapshot.")?;
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.as_ptr(), bytes.len());
        std::ptr::write_bytes(ptr.as_ptr().add(bytes.len()), 0, 20);
        rusqlite::serialize::OwnedData::from_raw_nonnull(ptr, bytes.len())
    };
    c.deserialize("main", data, false)
        .map_err(|_| "Snapshot could not be opened.")?;
    c.execute_batch("PRAGMA trusted_schema=OFF;PRAGMA foreign_keys=ON;")
        .map_err(err)?;
    schema_guard(&c)?;
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
        return Err("Handoff database integrity or identity failed validation.".into());
    }
    validate(&c)?;
    let h = history(&c)?;
    let n = h
        .nodes
        .get(&m.transfer)
        .ok_or("Transfer history is missing the exported snapshot.")?;
    if h.lineage.as_deref() != Some(&m.lineage)
        || h.head.as_deref() != Some(&m.transfer)
        || n.content_hash != m.content_hash
        || n.created_at != m.created_at
        || n.device != m.device
        || content(&c)? != m.content_hash
    {
        return Err("Transfer ancestry and content do not agree.".into());
    }
    migrations::upgrade(&mut c)?;
    recovery::validate(&c)?;
    no_running(&c)?;
    Ok((m, c))
}
fn relationship(
    local: &History,
    local_hash: &str,
    incoming: &History,
    incoming_hash: &str,
) -> Result<String> {
    if local.lineage != incoming.lineage {
        return Ok("unrelated".into());
    }
    if local_hash == incoming_hash {
        return Ok("same".into());
    }
    for n in chain(incoming)? {
        if let Some(old) = local.nodes.get(&n.id) {
            if json(old)? != json(n)? {
                return Err("Shared transfer ancestry disagrees between copies.".into());
            }
            return Ok(if local_hash == n.content_hash {
                "incoming"
            } else if incoming_hash == n.content_hash {
                "local_ahead"
            } else {
                "diverged"
            }
            .into());
        }
    }
    Ok("unrelated".into())
}
fn preview(c: &Connection, archive: &[u8], m: Manifest, incoming: &Connection) -> Result<Review> {
    no_running(c)?;
    validate(c)?;
    let local = history(c)?;
    let remote = history(incoming)?;
    let local_hash = content(c)?;
    let incoming_hash = content(incoming)?;
    let relation = relationship(&local, &local_hash, &remote, &incoming_hash)?;
    let token = encoded_hash(&(hash(archive), &local, &local_hash, &m, &incoming_hash))?;
    let count = |c: &Connection, table: &str| -> Result<i64> {
        c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .map_err(err)
    };
    Ok(Review {
        token,
        manifest: m,
        requires_replacement_ack: ["unrelated", "diverged", "local_ahead"]
            .contains(&relation.as_str()),
        relationship: relation,
        local_entries: count(c, "events")?,
        incoming_entries: count(incoming, "events")?,
        local_sources: count(c, "import_sources")?,
        incoming_sources: count(incoming, "import_sources")?,
    })
}
impl Store {
    #[cfg(test)]
    pub(crate) fn handoff_test_readonly(&mut self, enabled: bool) {
        self.conn = Connection::open_with_flags(
            &self.path,
            if enabled {
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
            } else {
                rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
            },
        )
        .unwrap();
        self.conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    }
    pub fn handoff_status(&self) -> Result<Status> {
        validate(&self.conn)?;
        let h = history(&self.conn)?;
        let current = content(&self.conn)?;
        let changed = h
            .head
            .as_ref()
            .and_then(|id| h.nodes.get(id))
            .is_some_and(|n| current != n.content_hash);
        Ok(Status {
            transfer: h.head,
            changed,
            lineage: h.lineage,
            export_folder: self
                .path
                .parent()
                .unwrap()
                .join("exports/handoffs")
                .display()
                .to_string(),
        })
    }
    pub fn export_handoff(
        &mut self,
        operation: &str,
        label: &str,
        passphrase: String,
    ) -> Result<Exported> {
        Uuid::parse_str(operation).map_err(err)?;
        if label.trim().is_empty() || label.len() > 100 {
            return Err("Enter a transfer label up to 100 characters.".into());
        }
        let password = handoff_crypto::password(passphrase)?;
        no_running(&self.conn)?;
        validate(&self.conn)?;
        let root = self
            .path
            .parent()
            .ok_or("Workspace folder is unavailable.")?;
        let folder = root.join("exports/handoffs");
        fs::create_dir_all(&folder).map_err(err)?;
        let path = folder.join(format!("{}-{operation}.pfinance.age", self.workspace));
        let h = history(&self.conn)?;
        if h.nodes.contains_key(operation) {
            if !path.is_file() {
                return Err("This transfer was exported earlier but its file is missing. Create a new export.".into());
            }
            use std::io::Read;
            let file = fs::File::open(&path).map_err(err)?;
            let mut bytes = vec![];
            file.take(MAX_ARCHIVE as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(err)?;
            let clear = handoff_crypto::decrypt(&bytes, password)?;
            let (m, previous) = decode(&clear, &self.workspace)?;
            if m.transfer != operation
                || m.label != label
                || m.lineage != h.lineage.clone().unwrap_or_default()
                || json(&history(&previous)?.nodes.get(operation))?
                    != json(&h.nodes.get(operation))?
            {
                return Err("This export operation was already used with different details. Start a new export.".into());
            }
            return Ok(Exported {
                path: path.display().to_string(),
                transfer: operation.into(),
                archive_hash: hash(&bytes),
            });
        }
        if h.nodes.len() >= 4096 {
            return Err("Transfer ancestry exceeds the supported limit.".into());
        }
        let mut snapshot = copy(&self.conn)?;
        let current_hash = content(&snapshot)?;
        let lineage = h
            .lineage
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let n = Node {
            id: operation.into(),
            parent: h.head.clone(),
            content_hash: current_hash.clone(),
            created_at: Utc::now().to_rfc3339(),
            device: device(root)?,
        };
        {
            let tx = snapshot.transaction().map_err(err)?;
            add_node(&tx, &lineage, &n)?;
            tx.commit().map_err(err)?;
        }
        let clear = encode(&snapshot, &self.workspace, &lineage, &n, label)?;
        let encrypted = handoff_crypto::encrypt(&clear, password)?;
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        if content(&tx)? != current_hash || json(&history(&tx)?)? != json(&h)? {
            return Err("Workspace changed while exporting. Create a fresh snapshot.".into());
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "The export path is unavailable or already exists. Start a new export.")?;
        let result = (|| {
            file.write_all(&encrypted).map_err(err)?;
            file.sync_all().map_err(err)?;
            add_node(&tx, &lineage, &n)?;
            tx.commit().map_err(err)
        })();
        drop(file);
        if let Err(e) = result {
            let _ = fs::remove_file(&path);
            return Err(e);
        }
        Ok(Exported {
            path: path.display().to_string(),
            transfer: operation.into(),
            archive_hash: hash(&encrypted),
        })
    }
    pub fn preview_handoff(&self, archive: &[u8], passphrase: String) -> Result<Review> {
        let clear = handoff_crypto::decrypt(archive, handoff_crypto::password(passphrase)?)?;
        let (m, incoming) = decode(&clear, &self.workspace)?;
        preview(&self.conn, archive, m, &incoming)
    }
    pub fn apply_handoff(
        &mut self,
        operation: &str,
        archive: &[u8],
        passphrase: String,
        token: &str,
        confirmed: bool,
        replace_confirmed: bool,
    ) -> Result<Applied> {
        Uuid::parse_str(operation).map_err(err)?;
        let archive_hash = hash(archive);
        let old: Option<(String, String, String)> = self
            .conn
            .query_row(
                "SELECT archive_hash,preview_token,preserved FROM handoff_receipts WHERE id=?1",
                [operation],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(err)?;
        if let Some((h, t, preserved)) = old {
            if h != archive_hash || t != token {
                return Err("This import operation was already used for another handoff.".into());
            }
            return Ok(Applied {
                preserved,
                already_applied: true,
            });
        }
        if archive.len() > MAX_ARCHIVE || !confirmed {
            return Err("Preview and confirm this handoff before importing.".into());
        }
        let clear = handoff_crypto::decrypt(archive, handoff_crypto::password(passphrase)?)?;
        let (m, incoming) = decode(&clear, &self.workspace)?;
        // SQLite backup replacement cannot run while the destination has a transaction.
        // The command layer holds the app's workspace gate; recheck the token immediately before replacement.
        let r = preview(&self.conn, archive, m, &incoming)?;
        if r.token != token {
            return Err(
                "Workspace or file changed after preview. Review the handoff again.".into(),
            );
        }
        if r.relationship == "same" {
            return Err(
                "This snapshot already has the same contents. Keep the current workspace.".into(),
            );
        }
        if r.requires_replacement_ack && !replace_confirmed {
            return Err("This replaces a different local history. Confirm preserving the local copy and replacing it with the selected snapshot.".into());
        }
        let preserved = format!(
            "{}-{}.handoff.sqlite",
            Utc::now().format("%Y%m%d-%H%M%S-%3f"),
            operation
        );
        incoming
            .execute(
                "INSERT INTO handoff_receipts VALUES(?1,?2,?3,?4)",
                params![operation, archive_hash, token, preserved],
            )
            .map_err(err)?;
        recovery::validate(&incoming)?;
        self.conn
            .backup("main", self.backups.join(&preserved), None)
            .map_err(err)?;
        let final_check = preview(&self.conn, archive, r.manifest, &incoming)?;
        if final_check.token != token {
            return Err(
                "Workspace changed before activation. Review again; the prior copy remains saved."
                    .into(),
            );
        }
        let b = rusqlite::backup::Backup::new(&incoming, &mut self.conn).map_err(err)?;
        b.run_to_completion(100, Duration::from_millis(5), None)
            .map_err(err)?;
        drop(b);
        Ok(Applied {
            preserved,
            already_applied: false,
        })
    }
}
