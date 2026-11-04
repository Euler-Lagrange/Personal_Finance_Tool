import { useEffect, useRef, useState } from "react";
import { command } from "./api";
import { Modal } from "./EntryDialog";
import { HelpHeading } from "./HelpTip";
import type { Workspace } from "./types";
import "./managedBackups.css";
type Copy = {
  id: string;
  file: string;
  createdAt: string;
  archiveHash: string;
  databaseHash: string;
  bytes: number;
  protected: boolean;
};
type Config = {
  revision: number;
  root: string;
  workspace: string;
  workspaceId: string;
  device: string;
  daily: number;
  monthly: number;
  automatic: boolean;
  remembered: boolean;
  records: Copy[];
  lastError: string | null;
  lastAttempt: string | null;
};
type Status = {
  config: Config | null;
  folder: string | null;
  queued: boolean;
  running: boolean;
  cloudSyncVerified: false;
};
type Review = {
  token: string;
  localEntries: number;
  incomingEntries: number;
  incomingSources: number;
  manifest: {
    createdAt: string;
    workspace: string;
    device: string;
    schema: number;
  };
};
type Archive = { path: string } | { content: string };
const empty: Status = {
  config: null,
  folder: null,
  queued: false,
  running: false,
  cloudSyncVerified: false,
};
export default function ManagedBackups({
  workspace,
  saved,
}: {
  workspace: Workspace;
  saved: (message: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [epoch, setEpoch] = useState(0),
    [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"setup" | "run" | "restore" | null>(
      null,
    ),
    [restorePath, setRestorePath] = useState<string | undefined>();
  const alive = useRef(true),
    generation = useRef(0),
    working = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function read() {
      const n = ++generation.current;
      try {
        const s = await command<Status>("backup_status", { workspace });
        if (!cancelled && n === generation.current) {
          setStatus(s ?? empty);
          setError("");
        }
      } catch (e) {
        if (!cancelled && n === generation.current) setError(String(e));
      }
    }
    void read();
    const timer = setInterval(() => {
      if (!working.current) void read();
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workspace, epoch]);
  async function action(
    name: string,
    args: Record<string, unknown>,
    message: string,
  ) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    generation.current++;
    try {
      const s = await command<Status>(name, { workspace, ...args });
      if (alive.current) {
        setStatus(s);
        setNotice(message);
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const c = status?.config,
    last = c?.records.at(-1);
  return (
    <section className="panel settings-panel managed-backups">
      <div className="panel-heading">
        <HelpHeading topic="managedBackups">
          <h2>Folder backups</h2>
        </HelpHeading>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setDialog("setup")}
        >
          {c ? "Backup settings" : "Set up folder"}
        </button>
      </div>
      <p>
        Encrypted copies in a folder you choose, including OneDrive. Your
        working records stay on this PC.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button onClick={() => setEpoch((n) => n + 1)}>
            Reload backup status
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {status ? (
        c ? (
          <>
            <div className="managed-backup-status">
              <strong>
                {status.running
                  ? "Saving and verifying backup…"
                  : status.queued && c.automatic
                    ? "Backup queued"
                    : c.automatic
                      ? "Automatic backups on"
                      : "Manual backups"}
              </strong>
              <span>
                {last
                  ? `Last saved ${new Date(last.createdAt).toLocaleString()}`
                  : "No verified folder backup yet"}
              </span>
              <small>
                Cloud sync not verified · Automatic copies run while the app is
                open.
              </small>
            </div>
            <code className="data-path">{status.folder}</code>
            {c.lastError && (
              <p role="alert" className="error">
                {c.lastError} Your saved financial records remain intact. Use
                Save folder backup to retry.
              </p>
            )}
            <p className="muted">
              Keep {c.daily} daily and {c.monthly} monthly copies, plus
              protected checkpoints. Only this device’s cataloged copies are
              rotated.
            </p>
            <div className="managed-backup-actions">
              <button
                className="primary"
                disabled={busy || status.running}
                onClick={() => setDialog("run")}
              >
                Save folder backup
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void command("backup_open_folder", { workspace }).catch((e) =>
                    setError(String(e)),
                  )
                }
              >
                Open backup folder
              </button>
              {c.automatic && (
                <button
                  className="text-button"
                  disabled={busy || status.running}
                  onClick={() =>
                    void action(
                      "backup_pause",
                      { revision: c.revision },
                      "Automatic backups paused. Existing copies remain available.",
                    )
                  }
                >
                  Pause automatic backups
                </button>
              )}
            </div>
            <details className="managed-copy-list">
              <summary>Saved copies ({c.records.length})</summary>
              {c.records.length === 0 ? (
                <p>No completed archives yet.</p>
              ) : (
                <ul>
                  {[...c.records].reverse().map((r) => (
                    <li key={r.id}>
                      <div>
                        <strong>
                          {new Date(r.createdAt).toLocaleString()}
                        </strong>
                        <small>
                          {(r.bytes / 1024 / 1024).toFixed(1)} MB ·{" "}
                          {r.protected
                            ? "Protected checkpoint"
                            : "Eligible for retention"}
                        </small>
                      </div>
                      <button
                        className="text-button"
                        disabled={busy || status.running}
                        onClick={() =>
                          void action(
                            "backup_protect",
                            {
                              id: r.id,
                              protected: !r.protected,
                              revision: c.revision,
                            },
                            r.protected
                              ? "Copy returned to normal retention."
                              : "Copy protected from retention.",
                          )
                        }
                      >
                        {r.protected ? "Unprotect" : "Protect"}
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setRestorePath(`${status.folder}\\${r.file}`);
                          setDialog("restore");
                        }}
                      >
                        Review restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </>
        ) : (
          <p>
            Choose one folder and a backup passphrase. The app creates its own
            folders, verifies completed copies, and manages retention.
          </p>
        )
      ) : (
        <p>Loading backup status…</p>
      )}
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          setRestorePath(undefined);
          setDialog("restore");
        }}
      >
        Restore an encrypted backup
      </button>
      {dialog === "setup" && (
        <SetupDialog
          workspace={workspace}
          config={c ?? null}
          close={() => setDialog(null)}
          done={(s) => {
            generation.current++;
            setStatus(s);
            setDialog(null);
            setNotice(
              s.config?.lastError
                ? "Backup settings saved; the first copy needs attention."
                : "Backup settings saved and recovery copy verified.",
            );
          }}
        />
      )}
      {dialog === "run" && c && (
        <RunDialog
          workspace={workspace}
          remembered={c.remembered}
          close={() => setDialog(null)}
          done={(s) => {
            generation.current++;
            setStatus(s);
            setDialog(null);
            setNotice(
              "Backup saved to selected folder. Cloud sync not verified.",
            );
          }}
        />
      )}
      {dialog === "restore" && (
        <RestoreDialog
          workspace={workspace}
          initialPath={restorePath}
          close={() => {
            setDialog(null);
            setEpoch((n) => n + 1);
          }}
          saved={saved}
        />
      )}
    </section>
  );
}
function SetupDialog({
  workspace,
  config,
  close,
  done,
}: {
  workspace: Workspace;
  config: Config | null;
  close: () => void;
  done: (s: Status) => void;
}) {
  const [root, setRoot] = useState(config?.root ?? ""),
    [daily, setDaily] = useState(config?.daily ?? 30),
    [monthly, setMonthly] = useState(config?.monthly ?? 12),
    [remember, setRemember] = useState(config?.remembered ?? true),
    [automatic, setAutomatic] = useState(config?.automatic ?? true),
    [passphrase, setPassphrase] = useState(""),
    [repeat, setRepeat] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false);
  const cancel = () => {
    if (!busy && (!dirty || window.confirm("Discard these backup settings?")))
      close();
  };
  async function save() {
    if (working.current) return;
    if (passphrase !== repeat) {
      setError("Passphrases do not match.");
      return;
    }
    working.current = true;
    setBusy(true);
    setError("");
    try {
      done(
        await command<Status>("backup_configure", {
          workspace,
          input: {
            revision: config?.revision ?? 0,
            root,
            daily,
            monthly,
            automatic,
            remember,
            recoveryConfirmed: confirmed,
            passphrase,
          },
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title="Folder backup settings" onClose={cancel} busy={busy}>
      <form
        className="managed-backup-form"
        onChange={() => {
          setDirty(true);
          setConfirmed(false);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <p>
            Keep the backup passphrase somewhere you can access if this PC is
            lost. It is separate from your Windows sign-in and is required to
            restore these files.
          </p>
          <label>
            Destination folder
            <input
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              placeholder="C:\Users\…\OneDrive\Backups"
              required
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setBusy(true);
              void command<string | null>("backup_choose_folder")
                .then((p) => {
                  if (p) {
                    setRoot(p);
                    setDirty(true);
                    setConfirmed(false);
                  }
                })
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            Browse folders
          </button>
          <div className="managed-backup-grid">
            <label>
              Daily copies
              <input
                type="number"
                min="1"
                max="365"
                value={daily}
                onChange={(e) => setDaily(Number(e.target.value))}
              />
            </label>
            <label>
              Monthly copies
              <input
                type="number"
                min="0"
                max="120"
                value={monthly}
                onChange={(e) => setMonthly(Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            Backup passphrase
            {config?.remembered && (
              <small>
                Leave blank to use the saved passphrase for this destination.
              </small>
            )}
            <input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required={!config?.remembered}
              minLength={12}
            />
          </label>
          <label>
            Repeat backup passphrase
            <input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required={passphrase.length > 0}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => {
                setRemember(e.target.checked);
                if (!e.target.checked) setAutomatic(false);
              }}
            />
            Remember on this Windows device using Credential Manager
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={automatic}
              disabled={!remember}
              onChange={(e) => setAutomatic(e.target.checked)}
            />
            Automatically save changes while the app is open
          </label>
          <label
            className="checkbox-label"
            onChange={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setDirty(true);
              }}
            />
            I have retained the passphrase independently and can use it to
            recover on another PC.
          </label>
          <p className="muted">
            The first archive is encrypted, reopened and validated before
            retention can run. Changing destination leaves the previous folder
            untouched. Existing archives keep their original passphrase.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={cancel}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={!confirmed || !root || passphrase !== repeat}
            >
              {busy ? "Saving and verifying…" : "Save backup settings"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function RunDialog({
  workspace,
  remembered,
  close,
  done,
}: {
  workspace: Workspace;
  remembered: boolean;
  close: () => void;
  done: (s: Status) => void;
}) {
  const [passphrase, setPassphrase] = useState(""),
    [protectedCopy, setProtected] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false);
  async function run() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      done(
        await command<Status>("backup_run", {
          workspace,
          passphrase,
          protected: protectedCopy,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title="Save folder backup" onClose={close} busy={busy}>
      <form
        className="managed-backup-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <fieldset disabled={busy}>
          <p>
            This includes the current workspace’s records, payroll history and
            source documents. Verification may take a moment.
          </p>
          <label>
            Backup passphrase
            {remembered && (
              <small>Leave blank to use the saved Windows credential.</small>
            )}
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required={!remembered}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={protectedCopy}
              onChange={(e) => setProtected(e.target.checked)}
            />
            Protect this checkpoint from automatic retention
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary">
              {busy ? "Saving and verifying…" : "Save encrypted copy"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
async function fileInput(file: File): Promise<Archive> {
  if (file.size === 0 || file.size > 258 * 1024 * 1024)
    throw new Error("Choose a complete backup no larger than 258 MB.");
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Backup could not be read."));
    r.onload = () => resolve({ content: String(r.result).split(",")[1] });
    r.readAsDataURL(file);
  });
}
function RestoreDialog({
  workspace,
  initialPath,
  close,
  saved,
}: {
  workspace: Workspace;
  initialPath?: string;
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const [path, setPath] = useState(initialPath ?? ""),
    [file, setFile] = useState<File | null>(null),
    [passphrase, setPassphrase] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [archive, setArchive] = useState<Archive | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<string | null>(null);
  const working = useRef(false),
    operation = useRef(crypto.randomUUID());
  function changed() {
    setReview(null);
    setArchive(null);
    setConfirmed(false);
    operation.current = crypto.randomUUID();
  }
  async function preview() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setReview(null);
    setConfirmed(false);
    try {
      const a = file ? await fileInput(file) : { path };
      const r = await command<Review>("managed_backup_preview", {
        workspace,
        file: a,
        passphrase,
      });
      setArchive(a);
      setReview(r);
    } catch (e) {
      setError(String(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function restore() {
    if (working.current || !review || !archive) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await command<{ preserved: string }>(
        "managed_backup_restore",
        {
          workspace,
          operation: operation.current,
          input: { file: archive, passphrase, token: review.token, confirmed },
        },
      );
      setResult(receipt.preserved);
      setPassphrase("");
      await saved(
        "Encrypted backup restored. The previous local branch was preserved.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title="Restore encrypted folder backup" onClose={close} busy={busy}>
      <div className="managed-backup-form">
        {result ? (
          <>
            <p role="status">
              Restore completed. Your previous local branch is kept in Recovery
              backups as:
            </p>
            <code className="data-path">{result}</code>
            {error && (
              <p role="alert">
                The restore completed, but the view could not refresh: {error}
              </p>
            )}
            <div className="dialog-actions">
              <button className="primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void preview();
            }}
          >
            <fieldset disabled={busy}>
              <p>
                Review any intact .pfbackup, even without this PC’s catalog.
                Restoring replaces this workspace; its current branch is saved
                first. Download online-only files before an offline restore.
              </p>
              <label>
                Backup file
                <input
                  type="file"
                  accept=".pfbackup"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPath("");
                    changed();
                  }}
                />
              </label>
              {path && <code className="data-path">{path}</code>}
              <label>
                Recovery passphrase
                <input
                  type="password"
                  autoComplete="off"
                  required
                  value={passphrase}
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    changed();
                  }}
                />
              </label>
              <button className="secondary" disabled={!file && !path}>
                {busy && !review
                  ? "Authenticating and checking…"
                  : "Preview restore"}
              </button>
              {review && (
                <section className="managed-restore-review">
                  <h3>
                    Verified backup ·{" "}
                    {new Date(review.manifest.createdAt).toLocaleString()}
                  </h3>
                  <p>
                    {review.localEntries} current entries →{" "}
                    {review.incomingEntries} backup entries, with{" "}
                    {review.incomingSources} source documents.
                  </p>
                  <p>
                    Workspace:{" "}
                    {review.manifest.workspace === "demo"
                      ? "Sample"
                      : "Personal"}
                    . No automatic merging of changes from another computer.
                  </p>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    Preserve my current branch and replace this workspace with
                    the reviewed backup.
                  </label>
                  <button
                    type="button"
                    className="primary"
                    disabled={!confirmed}
                    onClick={() => void restore()}
                  >
                    {busy ? "Restoring…" : "Restore reviewed backup"}
                  </button>
                </section>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={close}>
                  Cancel
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </div>
    </Modal>
  );
}
