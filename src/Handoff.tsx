import { useEffect, useRef, useState } from "react";
import { command } from "./api";
import { Modal } from "./EntryDialog";
import type { Workspace } from "./types";
export type HandoffSelection = { name: string; file?: File; path?: string };
export type HandoffOpen = {
  mode: "export" | "import";
  selection?: HandoffSelection;
};
type FileInput = { content: string } | { path: string };
type Review = {
  token: string;
  relationship: string;
  requiresReplacementAck: boolean;
  localEntries: number;
  incomingEntries: number;
  localSources: number;
  incomingSources: number;
  manifest: {
    label: string;
    createdAt: string;
    device: string;
    workspace: string;
  };
};
type Exported = { path: string; transfer: string };
const descriptions: Record<string, [string, string]> = {
  incoming: [
    "Ready to bring this computer up to date",
    "This computer matches the shared starting point. The selected copy contains changes made since then.",
  ],
  same: [
    "Already up to date",
    "Both copies contain the same records. No import is needed.",
  ],
  local_ahead: [
    "This computer has newer changes",
    "The selected copy matches an earlier shared point. Importing it would replace your newer local records.",
  ],
  diverged: [
    "Both computers have changes",
    "The copies have changed since their shared starting point. There is no automatic merge. Choose the copy you intend to keep active.",
  ],
  unrelated: [
    "Separate workspace history",
    "This copy has no shared transfer history with the current workspace. Importing it replaces the current records, including an empty starting workspace.",
  ],
};
function validPassword(s: string) {
  return (
    [...s].length >= 12 &&
    new TextEncoder().encode(s).length <= 1024 &&
    s.trim() === s
  );
}
async function readFile(selection: HandoffSelection): Promise<FileInput> {
  if (selection.path) return { path: selection.path };
  const file = selection.file;
  if (!file || file.size === 0 || file.size > 258 * 1024 * 1024)
    throw new Error("Choose a nonempty handoff file no larger than 258 MB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File could not be read."));
    reader.onload = () =>
      resolve({ content: String(reader.result).split(",")[1] });
    reader.readAsDataURL(file);
  });
}
export default function Handoff({
  workspace,
  initial,
  close,
  saved,
}: {
  workspace: Workspace;
  initial: HandoffOpen;
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const [selection, setSelection] = useState(initial.selection);
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [label, setLabel] = useState("Desktop to laptop");
  const [confirmed, setConfirmed] = useState(false);
  const [replace, setReplace] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [file, setFile] = useState<FileInput | null>(null);
  const [result, setResult] = useState<Exported | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const working = useRef(false),
    alive = useRef(true),
    operation = useRef(crypto.randomUUID());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function resetReview() {
    setReview(null);
    setFile(null);
    setConfirmed(false);
    setReplace(false);
    setError("");
    operation.current = crypto.randomUUID();
    setDirty(true);
  }
  function choose(items: HandoffSelection[]) {
    if (working.current) return;
    if (items.length !== 1 || !/\.pfinance\.age$/i.test(items[0].name)) {
      setError("Choose one .pfinance.age handoff file.");
      return;
    }
    resetReview();
    setSelection(items[0]);
  }
  useEffect(() => {
    if (initial.mode !== "import") return;
    const handler = (event: Event) =>
      choose((event as CustomEvent<HandoffSelection[]>).detail);
    window.addEventListener("finance-handoff-selection", handler);
    return () =>
      window.removeEventListener("finance-handoff-selection", handler);
  });
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function leave() {
    if (
      !working.current &&
      (!dirty ||
        window.confirm("Close this handoff and discard the unsaved form?"))
    )
      close();
  }
  async function exportCopy() {
    await run(async () => {
      const done = await command<Exported>("handoff_export", {
        workspace,
        operation: operation.current,
        label: label.trim(),
        passphrase,
      });
      if (!alive.current) return;
      setResult(done);
      setPassphrase("");
      setRepeat("");
      setDirty(false);
    });
  }
  async function preview() {
    await run(async () => {
      if (!selection) throw new Error("Choose a handoff file first.");
      // Clear the old approval before any asynchronous work or failed read.
      setReview(null);
      setFile(null);
      setConfirmed(false);
      setReplace(false);
      const selected = await readFile(selection);
      const r = await command<Review>("handoff_preview", {
        workspace,
        file: selected,
        passphrase,
      });
      if (!alive.current) return;
      setFile(selected);
      setReview(r);
      operation.current = crypto.randomUUID();
    });
  }
  async function apply() {
    await run(async () => {
      if (!review || !file) return;
      await command("handoff_apply", {
        workspace,
        operation: operation.current,
        input: {
          file,
          passphrase,
          token: review.token,
          confirmed,
          replaceConfirmed: replace,
        },
      });
      if (!alive.current) return;
      setPassphrase("");
      setFile(null);
      setDirty(false);
      close();
      await saved(
        "Handoff imported. The previous workspace is preserved in Recovery backups.",
      );
    });
  }
  const exporting = initial.mode === "export";
  return (
    <Modal
      title={
        exporting ? "Export encrypted handoff" : "Import encrypted handoff"
      }
      busy={busy}
      onClose={leave}
    >
      <form
        className="handoff-form"
        onSubmit={(e) => {
          e.preventDefault();
          void (exporting ? exportCopy() : preview());
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!exporting)
            choose(
              Array.from(e.dataTransfer.files).map((file) => ({
                name: file.name,
                file,
              })),
            );
        }}
      >
        <p>
          <strong>
            {workspace === "personal" ? "Personal" : "Sample"} workspace
          </strong>{" "}
          · Use one computer at a time. Export after your last edit, then import
          that file on the other computer before making changes there.
        </p>
        <p>
          Transactions, attachments, budgets, rules, goals, and closed months
          travel together. API keys, provider settings, and appearance stay on
          each device.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <fieldset disabled={busy || !!result}>
          {exporting ? (
            <>
              <label>
                Transfer label
                <input
                  value={label}
                  maxLength={100}
                  onChange={(e) => {
                    setLabel(e.target.value);
                    resetReview();
                  }}
                />
              </label>
              <label>
                Export passphrase
                <input
                  type="password"
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    resetReview();
                  }}
                />
              </label>
              <label>
                Repeat passphrase
                <input
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => {
                    setRepeat(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <p className="muted">
                Use at least 12 characters without leading or trailing spaces.
                Keep the passphrase separately; the app cannot recover it.
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I have saved this passphrase for the other computer.
              </label>
              {!result && (
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    !label.trim() ||
                    !validPassword(passphrase) ||
                    passphrase !== repeat ||
                    !confirmed
                  }
                >
                  {busy ? "Encrypting and saving…" : "Create encrypted file"}
                </button>
              )}
            </>
          ) : (
            <>
              <label>
                Handoff file
                <input
                  type="file"
                  accept=".age"
                  onChange={(e) => {
                    choose(
                      Array.from(e.target.files ?? []).map((file) => ({
                        file,
                        name: file.name,
                      })),
                    );
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="muted">
                {selection
                  ? selection.name
                  : "Browse or drop one .pfinance.age file here."}
              </p>
              <label>
                Handoff passphrase
                <input
                  type="password"
                  autoComplete="off"
                  value={passphrase}
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    resetReview();
                  }}
                />
              </label>
              <button
                className="secondary"
                type="submit"
                disabled={!selection || !validPassword(passphrase)}
              >
                {busy
                  ? "Working…"
                  : review
                    ? "Review file again"
                    : "Unlock and preview"}
              </button>
              {review && (
                <section className="handoff-review" aria-label="Handoff review">
                  <h3>
                    {descriptions[review.relationship]?.[0] ??
                      "Review selected copy"}
                  </h3>
                  <p>{descriptions[review.relationship]?.[1]}</p>
                  <p>
                    <strong>{review.manifest.label}</strong>
                    <br />
                    {new Date(review.manifest.createdAt).toLocaleString()}
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Records</th>
                        <th>This computer</th>
                        <th>Selected copy</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th>Entries</th>
                        <td>{review.localEntries}</td>
                        <td>{review.incomingEntries}</td>
                      </tr>
                      <tr>
                        <th>Source files</th>
                        <td>{review.localSources}</td>
                        <td>{review.incomingSources}</td>
                      </tr>
                    </tbody>
                  </table>
                  {review.relationship !== "same" && (
                    <>
                      <p>
                        The current workspace will be preserved in local
                        Recovery backups before replacement. That recovery copy
                        remains on this Windows device and is not encrypted with
                        this passphrase.
                      </p>
                      {review.requiresReplacementAck && (
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={replace}
                            onChange={(e) => setReplace(e.target.checked)}
                          />
                          Replace this computer’s different history with the
                          selected copy. Preserve my current copy for recovery.
                        </label>
                      )}
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        I reviewed the selected copy and want it to become
                        active.
                      </label>
                      <button
                        className="primary"
                        type="button"
                        disabled={
                          !confirmed ||
                          (review.requiresReplacementAck && !replace)
                        }
                        onClick={() => void apply()}
                      >
                        {busy ? "Importing…" : "Import selected copy"}
                      </button>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </fieldset>
        {result && (
          <div className="soft-note" role="status">
            <strong>Encrypted file saved</strong>
            <code className="data-path">{result.path}</code>
            <p>
              Copy this file to the other computer and use Import handoff there.
              Further edits on this computer will require another export.
            </p>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await command("handoff_folder");
                })
              }
            >
              Open export folder
            </button>
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={leave}
          >
            {result ? "Done" : "Close"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
