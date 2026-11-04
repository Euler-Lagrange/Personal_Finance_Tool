use super::*;
use crate::{db::periods::CloseInput, handoff_crypto};
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn pass() -> String {
    "synthetic testing passphrase".into()
}
fn export(db: &mut Store) -> Vec<u8> {
    let x = db
        .export_handoff(&op(), "Synthetic transfer", pass())
        .unwrap();
    std::fs::read(x.path).unwrap()
}
fn receive(db: &mut Store, b: &[u8]) -> String {
    let r = db.preview_handoff(b, pass()).unwrap();
    db.apply_handoff(&op(), b, pass(), &r.token, true, true)
        .unwrap()
        .preserved
}
fn count(db: &Store) -> usize {
    db.snapshot(&month()).unwrap().entries.len()
}
fn entry(db: &mut Store, amount: &str) {
    db.save(expense(amount, "jacob")).unwrap();
}
#[test]
fn handoff_roundtrip_keeps_sources_closed_month_and_accounting_without_device_secrets() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut desktop = Store::open(a.path(), "personal").unwrap();
    let mut laptop = Store::open(b.path(), "personal").unwrap();
    let mut e = expense("100", "jacob");
    e.date = "2026-10-02".into();
    desktop.save(e).unwrap();
    let mut e = repayment("30", "chelsea", true);
    e.date = "2026-10-03".into();
    desktop.save(e).unwrap();
    let bytes = b"Synthetic evidence only";
    let p = crate::imports::parse::prepare("evidence.pdf", bytes, None).unwrap();
    let source = desktop.ingest("evidence.pdf", bytes.to_vec(), p).unwrap();
    desktop.dismiss_import(&source, 1, true).unwrap();
    let r = desktop.close_review("2026-10").unwrap();
    desktop
        .close_month(CloseInput {
            id: op(),
            month: "2026-10".into(),
            revision: r.revision,
            token: r.token,
            acknowledgements: r.warnings.into_iter().map(|w| w.id).collect(),
            note: "Synthetic review".into(),
            carry: None,
        })
        .unwrap();
    std::fs::write(
        a.path().join("provider-settings.json"),
        "synthetic credential excluded",
    )
    .unwrap();
    let data = export(&mut desktop);
    assert!(!desktop.handoff_status().unwrap().changed);
    let clear = handoff_crypto::decrypt(&data, handoff_crypto::password(pass()).unwrap()).unwrap();
    assert!(!clear
        .windows(b"synthetic credential excluded".len())
        .any(|w| w == b"synthetic credential excluded"));
    let prior = receive(&mut laptop, &data);
    assert_eq!(laptop.import_content(&source).unwrap().1, bytes);
    assert_eq!(laptop.snapshot("2026-10").unwrap().entries.len(), 2);
    assert_eq!(laptop.snapshot("2026-10").unwrap().spent_cents, 7000);
    assert_eq!(laptop.snapshot("2026-10").unwrap().household_cents, 0);
    assert!(laptop.close_review("2026-10").unwrap().closed);
    assert_eq!(
        laptop.import_detail(&source).unwrap().source.name,
        "evidence.pdf"
    );
    assert!(!b.path().join("provider-settings.json").exists());
    assert_eq!(
        laptop.preview_handoff(&data, pass()).unwrap().relationship,
        "same"
    );
    assert!(!laptop.handoff_status().unwrap().changed);
    let back = export(&mut laptop);
    assert_eq!(
        desktop.preview_handoff(&back, pass()).unwrap().relationship,
        "same"
    );
    assert_ne!(
        std::fs::read(a.path().join("handoff-device-id")).unwrap(),
        std::fs::read(b.path().join("handoff-device-id")).unwrap()
    );
    for _ in 0..23 {
        laptop.backup().unwrap();
    }
    assert!(laptop.list_backups().unwrap().contains(&prior));
    assert_eq!(
        laptop
            .list_backups()
            .unwrap()
            .iter()
            .filter(|n| !n.ends_with(".handoff.sqlite"))
            .count(),
        20
    );
    laptop.restore(&prior).unwrap();
    assert_eq!(count(&laptop), 0);
}
#[test]
fn handoff_ancestry_distinguishes_newer_older_and_diverged_equal_count_copies() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut x = Store::open(a.path(), "personal").unwrap();
    let mut y = Store::open(b.path(), "personal").unwrap();
    entry(&mut x, "100");
    let first = export(&mut x);
    receive(&mut y, &first);
    entry(&mut y, "20");
    assert!(y.handoff_status().unwrap().changed);
    assert_eq!(
        y.preview_handoff(&first, pass()).unwrap().relationship,
        "local_ahead"
    );
    let second = export(&mut y);
    let r = x.preview_handoff(&second, pass()).unwrap();
    assert_eq!(r.relationship, "incoming");
    assert!(!r.requires_replacement_ack);
    entry(&mut x, "30");
    assert_eq!(count(&x), count(&y));
    let r = x.preview_handoff(&second, pass()).unwrap();
    assert_eq!(r.relationship, "diverged");
    assert!(r.requires_replacement_ack);
    assert!(x
        .apply_handoff(&op(), &second, pass(), &r.token, true, false)
        .is_err());
    let preserved = receive(&mut x, &second);
    assert_eq!(x.snapshot(&month()).unwrap().spent_cents, 8400);
    x.restore(&preserved).unwrap();
    assert_eq!(x.snapshot(&month()).unwrap().spent_cents, 9100);
}
#[test]
fn handoff_confirmation_stale_preview_retry_and_readonly_failure_do_not_lose_local_data() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut x = Store::open(a.path(), "personal").unwrap();
    let mut y = Store::open(b.path(), "personal").unwrap();
    entry(&mut x, "100");
    let data = export(&mut x);
    let r = y.preview_handoff(&data, pass()).unwrap();
    assert_eq!(r.relationship, "unrelated");
    assert!(y
        .apply_handoff(&op(), &data, pass(), &r.token, false, true)
        .is_err());
    assert!(y
        .apply_handoff(&op(), &data, pass(), &r.token, true, false)
        .is_err());
    entry(&mut y, "20");
    assert!(y
        .apply_handoff(&op(), &data, pass(), &r.token, true, true)
        .is_err());
    assert_eq!(count(&y), 1);
    let r = y.preview_handoff(&data, pass()).unwrap();
    let operation = op();
    y.handoff_test_readonly(true);
    assert!(y
        .apply_handoff(&operation, &data, pass(), &r.token, true, true)
        .is_err());
    assert_eq!(y.snapshot(&month()).unwrap().spent_cents, 1400);
    y.handoff_test_readonly(false);
    let receipt = y
        .apply_handoff(&operation, &data, pass(), &r.token, true, true)
        .unwrap();
    assert!(!receipt.already_applied);
    entry(&mut y, "10");
    let retry = y
        .apply_handoff(&operation, &data, pass(), &r.token, true, true)
        .unwrap();
    assert!(retry.already_applied);
    assert_eq!(retry.preserved, receipt.preserved);
    assert_eq!(count(&y), 2);
    assert!(y
        .apply_handoff(&operation, &data, pass(), "different", true, true)
        .is_err());
}
#[test]
fn handoff_export_retry_validates_saved_archive_and_never_overwrites_it() {
    let a = tempfile::tempdir().unwrap();
    let mut x = Store::open(a.path(), "personal").unwrap();
    entry(&mut x, "100");
    let id = op();
    let result = x.export_handoff(&id, "Trip", pass()).unwrap();
    let bytes = std::fs::read(&result.path).unwrap();
    entry(&mut x, "20");
    let retry = x.export_handoff(&id, "Trip", pass()).unwrap();
    assert_eq!(retry.archive_hash, result.archive_hash);
    assert!(x.handoff_status().unwrap().changed);
    assert!(x.export_handoff(&id, "Other", pass()).is_err());
    assert!(x
        .export_handoff(&id, "Trip", "incorrect passphrase".into())
        .is_err());
    std::fs::write(&result.path, b"damaged").unwrap();
    assert!(x.export_handoff(&id, "Trip", pass()).is_err());
    assert_eq!(std::fs::read(&result.path).unwrap(), b"damaged");
    assert!(bytes.len() > 100);
    assert_eq!(count(&x), 2);
}
#[test]
fn handoff_rejects_wrong_password_tampering_truncation_cross_workspace_and_schema_tampering() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut x = Store::open(a.path(), "personal").unwrap();
    let y = Store::open(b.path(), "personal").unwrap();
    let demo = Store::open(b.path(), "demo").unwrap();
    entry(&mut x, "100");
    let data = export(&mut x);
    assert!(y
        .preview_handoff(&data, "wrong synthetic password".into())
        .is_err());
    assert!(y.preview_handoff(&data[..data.len() - 1], pass()).is_err());
    let mut damaged = data.clone();
    let len = damaged.len();
    damaged[len - 5] ^= 1;
    assert!(y.preview_handoff(&damaged, pass()).is_err());
    assert!(demo.preview_handoff(&data, pass()).is_err());
    let clear = handoff_crypto::decrypt(&data, handoff_crypto::password(pass()).unwrap()).unwrap();
    let start = b"PERSONAL-FINANCE-HANDOFF\n1\n".len();
    let end = start + 4 + u32::from_le_bytes(clear[start..start + 4].try_into().unwrap()) as usize;
    let mut m: serde_json::Value = serde_json::from_slice(&clear[start + 4..end]).unwrap();
    m["schema"] = serde_json::json!(999);
    let header = serde_json::to_vec(&m).unwrap();
    let mut bad = clear[..start].to_vec();
    bad.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bad.extend(header);
    bad.extend_from_slice(&clear[end..]);
    assert!(y
        .preview_handoff(&handoff_crypto::synthetic_encrypt(&bad), pass())
        .is_err());
    rusqlite::Connection::open(a.path().join("personal.sqlite")).unwrap().execute_batch("CREATE TRIGGER handoff_attack AFTER INSERT ON handoff_receipts BEGIN DELETE FROM audit; END;").unwrap();
    let malicious = export(&mut x);
    assert!(y
        .preview_handoff(&malicious, pass())
        .err()
        .unwrap()
        .contains("trigger"));
    assert_eq!(count(&y), 0);
}
#[test]
fn handoff_upgrade_from_34_keeps_existing_finances() {
    let d = tempfile::tempdir().unwrap();
    let mut x = Store::open(d.path(), "personal").unwrap();
    entry(&mut x, "100");
    let c = rusqlite::Connection::open(d.path().join("personal.sqlite")).unwrap();
    remove_handoff_schema(&c);
    c.pragma_update(None, "user_version", 34).unwrap();
    drop(c);
    drop(x);
    let mut x = Store::open(d.path(), "personal").unwrap();
    assert_eq!(count(&x), 1);
    assert!(x.handoff_status().unwrap().lineage.is_none());
    assert!(!export(&mut x).is_empty());
}
#[test]
fn handoff_rejects_inconsistent_money_and_active_requests_before_replacement() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut x = Store::open(a.path(), "personal").unwrap();
    let y = Store::open(b.path(), "personal").unwrap();
    entry(&mut x, "100");
    let c = rusqlite::Connection::open(a.path().join("personal.sqlite")).unwrap();
    c.execute("UPDATE account_activity SET change_cents=1", [])
        .unwrap();
    drop(c);
    let bad = export(&mut x);
    assert!(y.preview_handoff(&bad, pass()).is_err());
    assert_eq!(count(&y), 0);
    let d = tempfile::tempdir().unwrap();
    let mut clean = Store::open(d.path(), "personal").unwrap();
    let bytes = b"Date,Description,Amount\n2026-10-01,Store,10\n";
    let p = crate::imports::parse::prepare("synthetic.csv", bytes, None).unwrap();
    let id = clean.ingest("synthetic.csv", bytes.to_vec(), p).unwrap();
    let config = crate::assistance::settings::Config {
        enabled: true,
        revision: 1,
        model: "synthetic-model".into(),
    };
    let input = crate::db::ai_jobs::Input {
        source_id: id,
        source_revision: 1,
        provider: "openai".into(),
        task: "mapping".into(),
        scope: "text".into(),
        text: "Synthetic mapping".into(),
    };
    let token = clean.ai_prepare(&input, &config).unwrap().token;
    clean
        .ai_begin(
            &crate::db::ai_jobs::Start {
                id: op(),
                input,
                token,
                confirmed: true,
            },
            &config,
            "synthetic-session",
        )
        .unwrap();
    assert!(clean
        .export_handoff(&op(), "Blocked", pass())
        .err()
        .unwrap()
        .contains("active AI"));
    assert!(clean
        .preview_handoff(
            &export(&mut Store::open(b.path(), "personal").unwrap()),
            pass()
        )
        .err()
        .unwrap()
        .contains("active AI"));
}
