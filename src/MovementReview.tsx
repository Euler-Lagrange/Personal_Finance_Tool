import { useEffect, useRef, useState } from "react";
import { command, money } from "./api";
import { Modal } from "./EntryDialog";
import type { Entry, EntryInput, Snapshot } from "./types";

export function MovementPicker({
  data,
  entry,
  sourceDate,
  changed,
  onBusy,
}: {
  data: Snapshot;
  entry: Entry;
  sourceDate: string;
  changed: (message: string) => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [matches, setMatches] = useState<Entry[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const alive = useRef(true),
    attempt = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    command<Entry[]>("movement_matches", {
      workspace: data.workspace,
      id: entry.id,
    })
      .then((result) => {
        if (alive.current) setMatches(result);
      })
      .catch((e) => {
        if (alive.current) setError(String(e));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, [data.workspace, entry.id]);
  const account = (id: string | null) =>
    data.accounts.find((a) => a.id === id)?.name ?? id ?? "Unknown account";
  const match = matches.find((m) => m.id === selected);
  async function reconcile() {
    if (!match || !confirmed || busy) return;
    const signature = JSON.stringify([
      entry.id,
      entry.revision,
      match.id,
      match.revision,
    ]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await command("reconcile_movement", {
        workspace: data.workspace,
        input: {
          operationId: attempt.current.id,
          eventId: entry.id,
          revision: entry.revision,
          matchId: match.id,
          matchRevision: match.revision,
          confirmed: true,
        },
      });
      if (alive.current)
        await changed(
          "Movement reconciled. Both sources retained; spending and income unchanged.",
        );
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <section aria-label="Reconcile movement">
      <p className="form-intro">
        Match a movement between your accounts. An equal amount only suggests a
        match; check the descriptions, accounts and dates against the original
        sources.
      </p>
      <div className="raw-row">
        <strong>
          {account(entry.accountId)} · {money(entry.amountCents)}
        </strong>
        <p>
          {entry.description} ·{" "}
          {entry.pending?.direction === "out" ? "Money out" : "Money in"} ·
          Source date {sourceDate}
        </p>
      </div>
      {loading ? (
        <p>Finding possible movements...</p>
      ) : matches.length === 0 ? (
        <p>
          No compatible recorded movement has this amount. Keep this activity
          awaiting review, or record a payment with its other account when only
          one side is available.
        </p>
      ) : (
        <label>
          Matching movement
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setConfirmed(false);
            }}
          >
            <option value="">Choose using source evidence</option>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.date} · {account(m.accountId)}
                {m.destinationAccountId
                  ? ` to ${account(m.destinationAccountId)}`
                  : ""}{" "}
                · {m.description} · {money(m.amountCents)}
                {m.pending ? " · unclassified" : " · existing payment/transfer"}
              </option>
            ))}
          </select>
        </label>
      )}
      {match && (
        <>
          <div className="rule-preview">
            <strong>
              {match.pending
                ? "Combine two recorded account movements"
                : "Link to the existing payment or transfer"}
            </strong>
            <p>
              {match.pending
                ? "Each account keeps one movement. No additional spending, income or household debt is created."
                : "Remove the extra imported account effect and retain the existing complete movement once."}
            </p>
            {match.activityDates?.map((d) => (
              <p key={d.accountId}>
                {account(d.accountId)} · {d.date}
              </p>
            ))}
            <small>
              Explicit source posting dates are used when available; otherwise
              the recorded date is retained.
            </small>
          </div>
          <label className="import-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I checked both sources and confirm these records describe the same
            movement.
          </label>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="primary"
        disabled={busy || !confirmed || !match}
        onClick={() => void reconcile()}
      >
        {busy ? "Reconciling..." : "Reconcile movement"}
      </button>
    </section>
  );
}
interface MovementDetail {
  id: string;
  canonicalId: string;
  revision: number;
  undone: boolean;
  first: EntryInput;
  second: EntryInput;
  dates: { accountId: string; date: string }[];
}
export default function MovementReview({
  data,
  entry,
  close,
  changed,
}: {
  data: Snapshot;
  entry: Entry;
  close: () => void;
  changed: (message: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<MovementDetail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    command<MovementDetail>("movement_detail", {
      workspace: data.workspace,
      id: entry.movementLink,
    })
      .then((d) => {
        if (alive.current) setDetail(d);
      })
      .catch((e) => {
        if (alive.current) setError(String(e));
      });
    return () => {
      alive.current = false;
    };
  }, [data.workspace, entry.movementLink]);
  const account = (id: string | null) =>
    data.accounts.find((a) => a.id === id)?.name ?? id ?? "Unknown account";
  async function undo() {
    if (!detail || !confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await command("undo_movement", {
        workspace: data.workspace,
        id: detail.id,
      });
      if (alive.current) {
        await changed(
          "Reconciliation undone. Original source records restored for review.",
        );
        close();
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal title="Reconciled movement" onClose={close} busy={busy}>
      <form onSubmit={(e) => e.preventDefault()}>
        <fieldset disabled={busy}>
          <p className="form-intro">
            Both source records support one movement. Undo the reconciliation
            before changing its financial details.
          </p>
          {detail ? (
            <>
              <div className="raw-row">
                <strong>
                  {account(entry.accountId)} to{" "}
                  {account(entry.destinationAccountId)}
                </strong>
                <p>
                  {money(entry.amountCents)} · No spending, income or household
                  debt
                </p>
                {detail.dates.map((d) => (
                  <p key={d.accountId}>
                    {account(d.accountId)} · {d.date}
                  </p>
                ))}
              </div>
              <details open>
                <summary>Original records</summary>
                {[detail.first, detail.second].map((e) => (
                  <p key={e.id}>
                    {e.date} · {account(e.accountId)} · {e.description} · $
                    {e.amount}
                  </p>
                ))}
              </details>
              <p className="import-caution">
                Undo restores both original records.{" "}
                {detail.second.kind !== "unclassified"
                  ? "This restores the extra account effect until you review or remove the duplicate."
                  : "The separate account movements will need classification again."}{" "}
                Later imports referencing this movement must be undone first.
              </p>
              <label className="import-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Restore the original records and return them to review.
              </label>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={close}>
                  Keep reconciliation
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={!confirmed || detail.undone}
                  onClick={() => void undo()}
                >
                  {busy ? "Restoring..." : "Undo reconciliation"}
                </button>
              </div>
            </>
          ) : (
            <p>Loading reconciliation...</p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
