use super::*;
use crate::{
    assistance::vault::KeyStore,
    db::managed_backup,
    handoff_crypto,
    imports::parse::hash,
    managed_backups::{self as b, Config, Setup},
    payroll::Change,
};
use std::{cell::RefCell, collections::BTreeMap, fs, path::Path};
const SECRET: &str = "synthetic recovery passphrase";
#[derive(Default)]
struct Vault(RefCell<BTreeMap<String, String>>);
impl KeyStore for Vault {
    fn read(&self, t: &str) -> Result<Option<String>, String> {
        Ok(self.0.borrow().get(t).cloned())
    }
    fn write(&self, t: &str, v: &str) -> Result<(), String> {
        self.0.borrow_mut().insert(t.into(), v.into());
        Ok(())
    }
    fn delete(&self, t: &str) -> Result<(), String> {
        self.0.borrow_mut().remove(t);
        Ok(())
    }
}
fn input(dest: &Path) -> Setup {
    Setup {
        revision: 0,
        root: dest.display().to_string(),
        daily: 30,
        monthly: 12,
        automatic: true,
        remember: true,
        recovery_confirmed: true,
        passphrase: SECRET.into(),
    }
}
fn config(root: &Path, dest: &Path, db: &Store, v: &Vault) -> Config {
    b::configure(
        root,
        "personal",
        db.backup_device().unwrap(),
        input(dest),
        v,
    )
    .unwrap()
}
fn copy(root: &Path, c: &mut Config, db: &Store, pin: bool) -> b::Record {
    b::publish(
        root,
        c,
        db.managed_snapshot(&c.workspace_id).unwrap(),
        SECRET,
        pin,
    )
    .unwrap()
}
fn decoded(c: &Config, r: &b::Record) -> (String, managed_backup::Decoded) {
    let bytes =
        b::read_bounded(&b::snapshots(c).join(&r.file), handoff_crypto::MAX_ARCHIVE).unwrap();
    let clear =
        handoff_crypto::decrypt(&bytes, handoff_crypto::password(SECRET.into()).unwrap()).unwrap();
    (
        hash(&bytes),
        managed_backup::decode(&clear, "personal").unwrap(),
    )
}
#[test]
fn managed_backup_preserves_finance_payroll_evidence_close_and_handoff_without_advancing_ancestry()
{
    let root = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let vault = Vault::default();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let source = classification::stage(
        &mut db,
        "2026-10-10,Synthetic grocery,100.00,MB-1,SALE,Posted\n",
        "amex",
    );
    classification::process(&mut db, &source, classification::policy("shared"));
    db.save_payroll(
        &Uuid::new_v4().to_string(),
        0,
        Change::Rate {
            effective_date: "2026-01-01".into(),
            hourly_rate: "93".into(),
        },
    )
    .unwrap();
    let bytes = b"Pay date,Week ending\n2026-10-16,2026-10-11\n".to_vec();
    let prepared = crate::pay_document::prepare("Synthetic calendar.csv", &bytes).unwrap();
    let payroll_source = db
        .ingest_pay_source("Synthetic calendar.csv", bytes, prepared)
        .unwrap();
    let close = db.close_review("2026-10").unwrap();
    db.close_month(crate::db::periods::CloseInput {
        id: Uuid::new_v4().to_string(),
        month: "2026-10".into(),
        revision: close.revision,
        token: close.token,
        acknowledgements: close.warnings.into_iter().map(|w| w.id).collect(),
        note: "Synthetic final month".into(),
        carry: None,
    })
    .unwrap();
    db.export_handoff(
        &Uuid::new_v4().to_string(),
        "Synthetic original lineage",
        SECRET.into(),
    )
    .unwrap();
    let before = serde_json::to_value(db.handoff_status().unwrap()).unwrap();
    let mut c = config(root.path(), dest.path(), &db, &vault);
    let record = copy(root.path(), &mut c, &db, false);
    assert_eq!(
        before,
        serde_json::to_value(db.handoff_status().unwrap()).unwrap()
    );
    assert_eq!(
        b::load(root.path(), "personal")
            .unwrap()
            .unwrap()
            .records
            .len(),
        1
    );
    assert!(
        !fs::read_to_string(root.path().join("managed-backups-personal.json"))
            .unwrap()
            .contains(SECRET)
    );
    let (h, incoming) = decoded(&c, &record);
    let review = db.managed_review(&incoming, &h).unwrap();
    assert_eq!(review.incoming_sources, 2);
    let mut later = expense("21.03", "jacob");
    later.date = "2026-11-01".into();
    db.save(later).unwrap();
    assert!(db
        .managed_restore(
            incoming,
            &h,
            &Uuid::new_v4().to_string(),
            &review.token,
            true
        )
        .is_err());
    let (_, incoming) = decoded(&c, &record);
    let review = db.managed_review(&incoming, &h).unwrap();
    let op = Uuid::new_v4().to_string();
    let receipt = db
        .managed_restore(incoming, &h, &op, &review.token, true)
        .unwrap();
    assert!(receipt.preserved.ends_with(".managed.sqlite"));
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 0);
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 7000);
    assert_eq!(db.payroll_view("2026-10-05", 2026).unwrap().revision, 1);
    assert!(db.pay_source(&payroll_source).is_ok());
    assert!(db.close_review("2026-10").unwrap().closed);
    let (_, incoming) = decoded(&c, &record);
    assert_eq!(
        db.managed_restore(incoming, &h, &op, &review.token, true)
            .unwrap()
            .preserved,
        receipt.preserved
    );
    for _ in 0..22 {
        db.backup().unwrap();
    }
    assert!(db.list_backups().unwrap().contains(&receipt.preserved));
    db.restore(&receipt.preserved).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().monthly_count, 1);
    let other = tempfile::tempdir().unwrap();
    let mut laptop = Store::open(other.path(), "personal").unwrap();
    let (_, incoming) = decoded(&c, &record);
    let review = laptop.managed_review(&incoming, &h).unwrap();
    laptop
        .managed_restore(
            incoming,
            &h,
            &Uuid::new_v4().to_string(),
            &review.token,
            true,
        )
        .unwrap();
    assert_eq!(laptop.snapshot("2026-10").unwrap().spent_cents, 7000);
    assert!(b::load(other.path(), "personal").unwrap().is_none());
    assert!(vault.read(&b::credential(&c)).unwrap().is_some());
}
#[test]
fn managed_backup_wrong_password_corruption_and_workspace_mismatch_never_change_records() {
    let root = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let db = Store::open(root.path(), "personal").unwrap();
    let mut c = config(root.path(), dest.path(), &db, &Vault::default());
    let r = copy(root.path(), &mut c, &db, false);
    let bytes = fs::read(b::snapshots(&c).join(&r.file)).unwrap();
    assert!(handoff_crypto::decrypt(
        &bytes,
        handoff_crypto::password("wrong synthetic password".into()).unwrap()
    )
    .is_err());
    let mut corrupt = bytes.clone();
    let last = corrupt.len() - 1;
    corrupt[last] ^= 1;
    assert!(
        handoff_crypto::decrypt(&corrupt, handoff_crypto::password(SECRET.into()).unwrap())
            .is_err()
    );
    assert!(handoff_crypto::decrypt(
        &bytes[..bytes.len() - 10],
        handoff_crypto::password(SECRET.into()).unwrap()
    )
    .is_err());
    let clear =
        handoff_crypto::decrypt(&bytes, handoff_crypto::password(SECRET.into()).unwrap()).unwrap();
    assert!(managed_backup::decode(&clear, "demo").is_err());
    assert_eq!(db.snapshot("2026-10").unwrap().monthly_count, 0);
    let bad = root.path().join("invalid.pfbackup");
    fs::write(&bad, b"partial").unwrap();
    assert!(b::read_bounded(&bad, 3).is_err());
    assert_eq!(c.records.len(), 1);
}
#[test]
fn managed_retention_keeps_daily_monthly_latest_pins_and_only_deletes_owned_catalog_files() {
    let root = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let mut c = config(root.path(), dest.path(), &db, &Vault::default());
    c.daily = 1;
    c.monthly = 0;
    b::save(root.path(), &c).unwrap();
    let first = copy(root.path(), &mut c, &db, true);
    let unknown = b::snapshots(&c).join("unknown.pfbackup");
    fs::write(&unknown, b"do not delete").unwrap();
    let partial = b::snapshots(&c).join(".abandoned.partial");
    fs::write(&partial, b"interrupted").unwrap();
    let sibling = b::folder(&c)
        .parent()
        .unwrap()
        .join(Uuid::new_v4().to_string());
    fs::create_dir(&sibling).unwrap();
    fs::write(sibling.join("other-device.pfbackup"), b"another device").unwrap();
    let second = copy(root.path(), &mut c, &db, false);
    db.save(expense("12.34", "jacob")).unwrap();
    let third = copy(root.path(), &mut c, &db, false);
    assert_eq!(c.records.len(), 2);
    assert!(b::snapshots(&c).join(&first.file).is_file());
    assert!(!b::snapshots(&c).join(&second.file).exists());
    assert!(b::snapshots(&c).join(&third.file).is_file());
    assert!(
        unknown.is_file() && partial.is_file() && sibling.join("other-device.pfbackup").is_file()
    );
    let mut dates = vec![];
    for date in [
        "2025-12-31T23:00:00Z",
        "2026-01-31T23:00:00Z",
        "2026-02-01T12:00:00Z",
        "2026-02-02T12:00:00Z",
        "2026-02-02T13:00:00Z",
    ] {
        let mut r = third.clone();
        r.id = Uuid::new_v4().to_string();
        r.created_at = date.into();
        dates.push(r);
    }
    dates[0].protected = true;
    let keep = b::retained(&dates, 1, 2);
    assert!(
        keep.contains(&dates[0].id) && keep.contains(&dates[1].id) && keep.contains(&dates[4].id)
    );
    assert!(!keep.contains(&dates[2].id) && !keep.contains(&dates[3].id));
}
#[test]
fn managed_destination_loss_owner_change_and_catalog_tamper_preserve_prior_copies_and_finance() {
    let root = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let mut c = config(root.path(), dest.path(), &db, &Vault::default());
    let r = copy(root.path(), &mut c, &db, false);
    let marker = b::folder(&c).join(".personal-finance-owner.json");
    let original = fs::read(&marker).unwrap();
    fs::write(&marker, b"{}").unwrap();
    db.save(expense("77", "jacob")).unwrap();
    let snapshot = db.managed_snapshot(&c.workspace_id).unwrap();
    assert!(b::publish(root.path(), &mut c, snapshot, SECRET, false).is_err());
    assert_eq!(
        db.snapshot(&Local::now().format("%Y-%m").to_string())
            .unwrap()
            .spent_cents,
        5390
    );
    assert!(b::snapshots(&c).join(&r.file).exists());
    fs::write(marker, original).unwrap();
    let mut escaped = c.clone();
    escaped.records[0].file = "../../outside.pfbackup".into();
    assert!(b::save(root.path(), &escaped).is_err());
    assert!(b::guard(&dest.path().join("../")).is_err());
    c.daily = 1;
    c.monthly = 0;
    fs::write(b::snapshots(&c).join(&r.file), b"changed outside app").unwrap();
    let new = copy(root.path(), &mut c, &db, false);
    assert!(c.last_error.as_ref().unwrap().contains("changed outside"));
    assert!(b::snapshots(&c).join(&r.file).exists() && b::snapshots(&c).join(new.file).exists());
    let missing = tempfile::tempdir().unwrap();
    let mut absent = c.clone();
    absent.root = missing.path().join("missing");
    assert!(b::publish(
        root.path(),
        &mut absent,
        db.managed_snapshot(&c.workspace_id).unwrap(),
        SECRET,
        false
    )
    .is_err());
}
#[test]
fn managed_settings_validate_secret_recovery_revision_and_keep_workspaces_separate() {
    let root = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let db = Store::open(root.path(), "personal").unwrap();
    let vault = Vault::default();
    let mut setup = input(dest.path());
    setup.recovery_confirmed = false;
    assert!(b::configure(
        root.path(),
        "personal",
        db.backup_device().unwrap(),
        setup,
        &vault
    )
    .is_err());
    assert!(b::load(root.path(), "personal").unwrap().is_none());
    let mut c = config(root.path(), dest.path(), &db, &vault);
    copy(root.path(), &mut c, &db, false);
    let snapshot = db.managed_snapshot(&c.workspace_id).unwrap();
    assert!(b::publish(
        root.path(),
        &mut c,
        snapshot,
        "wrong manual backup passphrase",
        false
    )
    .is_err());
    assert_eq!(c.records.len(), 1);
    let mut change = input(dest.path());
    change.revision = c.revision;
    change.passphrase = "different recovery passphrase".into();
    assert!(b::configure(
        root.path(),
        "personal",
        db.backup_device().unwrap(),
        change,
        &vault
    )
    .is_err());
    assert_eq!(
        vault.read(&b::credential(&c)).unwrap().as_deref(),
        Some(SECRET)
    );
    assert!(b::configure(
        root.path(),
        "personal",
        db.backup_device().unwrap(),
        input(dest.path()),
        &vault
    )
    .is_err());
    let mut change = input(dest.path());
    change.revision = c.revision;
    change.passphrase = String::new();
    change.automatic = false;
    change.remember = false;
    let updated = b::configure(
        root.path(),
        "personal",
        db.backup_device().unwrap(),
        change,
        &vault,
    )
    .unwrap();
    assert!(!updated.remembered && !updated.automatic);
    assert!(vault.read(&b::credential(&c)).unwrap().is_none());
    assert!(b::passphrase(&updated, String::new(), &vault).is_err());
    assert!(b::passphrase(&updated, SECRET.into(), &vault).is_ok());
    let sample = Store::open(root.path(), "demo").unwrap();
    let demo = b::configure(
        root.path(),
        "demo",
        sample.backup_device().unwrap(),
        input(dest.path()),
        &vault,
    )
    .unwrap();
    assert_ne!(b::folder(&updated), b::folder(&demo));
    assert_eq!(
        b::load(root.path(), "personal")
            .unwrap()
            .unwrap()
            .records
            .len(),
        1
    );
    assert!(demo.records.is_empty());
}
#[cfg(windows)]
#[test]
fn managed_backup_rejects_replaced_managed_junction_and_preserves_external_target() {
    use std::os::windows::process::CommandExt;
    let root = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let db = Store::open(root.path(), "personal").unwrap();
    let mut c = config(root.path(), dest.path(), &db, &Vault::default());
    let snapshots = b::snapshots(&c);
    fs::remove_dir(&snapshots).unwrap();
    fs::write(outside.path().join("keep.txt"), b"untouched").unwrap();
    let output = std::process::Command::new("cmd.exe")
        .args(["/C", "mklink", "/J"])
        .arg(&snapshots)
        .arg(outside.path())
        .creation_flags(0x08000000)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(b::owned(&c).is_err());
    let snapshot = db.managed_snapshot(&c.workspace_id).unwrap();
    assert!(b::publish(root.path(), &mut c, snapshot, SECRET, false).is_err());
    assert_eq!(
        fs::read(outside.path().join("keep.txt")).unwrap(),
        b"untouched"
    );
    fs::remove_dir(snapshots).unwrap();
}

#[test]
fn managed_interrupted_copy_and_catalog_publication_leave_live_data_and_prior_archive_usable() {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            b::test_fail_write(0);
        }
    }
    let _reset = Reset;
    let root = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let mut db = Store::open(root.path(), "personal").unwrap();
    let mut c = config(root.path(), dest.path(), &db, &Vault::default());
    let old = copy(root.path(), &mut c, &db, false);
    db.save(expense("15", "jacob")).unwrap();
    for stage in [true, false] {
        let prepared = db.managed_snapshot(&c.workspace_id).unwrap();
        let collision = if stage {
            root.path()
                .join(format!(".pfbackup-stage-{}", prepared.manifest.id))
        } else {
            b::snapshots(&c).join(format!(".{}.partial", prepared.manifest.id))
        };
        fs::write(&collision, b"pre-existing unrelated file").unwrap();
        assert!(b::publish(root.path(), &mut c, prepared, SECRET, false).is_err());
        assert_eq!(
            fs::read(&collision).unwrap(),
            b"pre-existing unrelated file"
        );
        fs::remove_file(collision).unwrap();
    }
    for point in [1, 2] {
        b::test_fail_write(point);
        let prepared = db.managed_snapshot(&c.workspace_id).unwrap();
        assert!(b::publish(root.path(), &mut c, prepared, SECRET, false).is_err());
        assert_eq!(
            b::load(root.path(), "personal")
                .unwrap()
                .unwrap()
                .records
                .len(),
            1
        );
        let (_, incoming) = decoded(&c, &old);
        assert_eq!(
            db.managed_review(&incoming, &old.archive_hash)
                .unwrap()
                .local_entries,
            1
        );
    }
    b::test_fail_write(0);
    let files: Vec<_> = fs::read_dir(b::snapshots(&c))
        .unwrap()
        .map(|f| f.unwrap().path())
        .collect();
    assert_eq!(files.len(), 2);
    assert!(files.iter().all(|p| p.extension().unwrap() == "pfbackup"));
    let orphan = files
        .iter()
        .find(|p| p.file_name().unwrap() != old.file.as_str())
        .unwrap();
    let bytes = b::read_bounded(orphan, handoff_crypto::MAX_ARCHIVE).unwrap();
    let clear =
        handoff_crypto::decrypt(&bytes, handoff_crypto::password(SECRET.into()).unwrap()).unwrap();
    assert_eq!(
        db.managed_review(
            &managed_backup::decode(&clear, "personal").unwrap(),
            &hash(&bytes)
        )
        .unwrap()
        .incoming_entries,
        1
    );
    copy(root.path(), &mut c, &db, false);
    assert!(orphan.is_file());
    assert_eq!(
        db.snapshot(&Local::now().format("%Y-%m").to_string())
            .unwrap()
            .spent_cents,
        1050
    );
}

#[test]
fn managed_native_queue_catches_commits_skips_unchanged_and_failures_do_not_rollback_finance() {
    use std::sync::Mutex;
    let root = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let vault = Vault::default();
    let state = crate::AppState {
        _instance_lease: crate::workspace_lease::application(root.path()).unwrap(),
        root: root.path().into(),
        gate: Mutex::new(()),
        session: Uuid::new_v4().to_string(),
        ai_tasks: Mutex::new(Default::default()),
        backup_gate: Mutex::new(()),
        backup_pending: Mutex::new(Default::default()),
        backup_running: Mutex::new(None),
    };
    let db = Store::open(root.path(), "personal").unwrap();
    let c = config(root.path(), dest.path(), &db, &vault);
    drop(db);
    crate::with_store(&state, "personal", |db| db.save(expense("100", "jacob"))).unwrap();
    assert!(state
        .backup_pending
        .lock()
        .unwrap()
        .contains_key("personal"));
    crate::with_store(&state, "demo", |db| db.save(expense("1", "jacob"))).unwrap();
    assert_eq!(state.backup_pending.lock().unwrap().len(), 2);
    assert!(!state.backup_pending.lock().unwrap()["personal"].ready());
    crate::backup_commands::checkpoint(&state, "personal");
    assert!(state.backup_pending.lock().unwrap()["personal"].ready());
    crate::backup_commands::attempt_with(&state, "personal", String::new(), false, true, &vault)
        .unwrap();
    assert_eq!(
        b::load(root.path(), "personal")
            .unwrap()
            .unwrap()
            .records
            .len(),
        1
    );
    crate::backup_commands::attempt_with(&state, "personal", String::new(), false, true, &vault)
        .unwrap();
    assert_eq!(
        b::load(root.path(), "personal")
            .unwrap()
            .unwrap()
            .records
            .len(),
        1
    );
    fs::write(b::folder(&c).join(".personal-finance-owner.json"), b"{}").unwrap();
    crate::with_store(&state, "personal", |db| db.save(expense("50", "jacob"))).unwrap();
    assert!(crate::backup_commands::attempt_with(
        &state,
        "personal",
        String::new(),
        false,
        true,
        &vault
    )
    .is_err());
    assert!(b::load(root.path(), "personal")
        .unwrap()
        .unwrap()
        .last_error
        .is_some());
    assert_eq!(
        Store::open(root.path(), "personal")
            .unwrap()
            .snapshot(&Local::now().format("%Y-%m").to_string())
            .unwrap()
            .spent_cents,
        10500
    );
    assert!(state.backup_running.lock().unwrap().is_none());
    assert!(state.gate.try_lock().is_ok());
    assert!(b::load(root.path(), "demo").unwrap().is_none());
}
