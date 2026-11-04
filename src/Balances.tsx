import { useEffect, useState } from "react";
import { command, dollars, money, today } from "./api";
import { Modal } from "./EntryDialog";
import type { Account, Workspace } from "./types";
interface Checkpoint {
  id: string;
  revision: number;
  accountId: string;
  date: string;
  balanceCents: number;
  purpose: "opening" | "confirmed";
  note: string;
}
interface Draft extends Omit<Checkpoint, "balanceCents"> {
  amount: string;
}
export function AccountBalance({ account }: { account: Account }) {
  if (account.trackingMode === "untracked")
    return <span className="muted">Not tracked</span>;
  return account.balance ? (
    <span>
      <strong>{money(account.balance.estimatedCents)}</strong>
      <small className="muted">
        Estimate · checkpoint {account.balance.checkpointDate}
      </small>
    </span>
  ) : (
    <span className="muted">
      Unknown<small>Add a balance checkpoint</small>
    </span>
  );
}
export default function Balances({
  account,
  workspace,
  close,
  saved,
}: {
  account: Account;
  workspace: Workspace;
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const fresh = (): Draft => ({
    id: crypto.randomUUID(),
    revision: 0,
    accountId: account.id,
    date: today(),
    amount: "",
    purpose: "confirmed",
    note: "",
  });
  const [draft, setDraft] = useState<Draft>(fresh),
    [rows, setRows] = useState<Checkpoint[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [remove, setRemove] = useState(false);
  useEffect(() => {
    let alive = true;
    command<Checkpoint[]>("balance_checkpoints", {
      workspace,
      account: account.id,
    })
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [workspace, account.id]);
  const untracked = account.trackingMode === "untracked";
  async function persist(deleting = false) {
    setBusy(true);
    setError("");
    try {
      if (deleting)
        await command("delete_checkpoint", {
          workspace,
          id: draft.id,
          revision: draft.revision,
        });
      else await command("save_checkpoint", { workspace, input: draft });
      close();
      await saved(
        deleting
          ? "Balance checkpoint removed. Transactions are unchanged."
          : "Balance checkpoint saved. No income or spending added.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Balances · ${account.name}`} onClose={close} busy={busy}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (confirmed) void persist();
        }}
      >
        <fieldset disabled={busy}>
          <p className="form-intro">
            Enter a balance confirmed by your bank at the end of a date.
            Activity through that date is already included. Later recorded
            movements update an estimate; incomplete imports may change it.
          </p>
          {account.balance && (
            <div className="dialog-notice">
              Checkpoint: {money(account.balance.checkpointCents)} on{" "}
              {account.balance.checkpointDate}. Later recorded change:{" "}
              {money(account.balance.knownChangeCents)}. Estimate through{" "}
              {account.balance.throughDate}:{" "}
              <strong>{money(account.balance.estimatedCents)}</strong>.
            </div>
          )}
          <p className="form-intro">
            {account.kind === "credit"
              ? "Enter debt owed as positive; a credit balance is negative. This does not set a statement's remaining due."
              : "Enter money held as positive; an overdraft is negative."}{" "}
            Opening balances never count as income.
          </p>
          {loading ? (
            <p role="status">Loading balance history…</p>
          ) : (
            <section className="bill-links">
              <h3>Balance history</h3>
              {rows.length === 0 ? (
                <p>No confirmed balances yet.</p>
              ) : (
                rows.map((r) => (
                  <div key={r.id}>
                    <span>
                      {r.date} ·{" "}
                      {r.purpose === "opening" ? "Opening" : "Confirmed"}
                      <small>{money(r.balanceCents)}</small>
                    </span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        if (draft.amount || draft.note) {
                          setError(
                            "Save or clear the current balance form before opening another checkpoint.",
                          );
                          return;
                        }
                        setDraft({ ...r, amount: dollars(r.balanceCents) });
                        setConfirmed(false);
                        setRemove(false);
                        setError("");
                      }}
                    >
                      Edit balance {r.date}
                    </button>
                  </div>
                ))
              )}
            </section>
          )}
          {untracked && (
            <p className="soft-note">
              This owned account has no running balance. Enable imported or
              manual tracking in account setup to add or edit checkpoints.
              Existing history is retained.
            </p>
          )}
          <div className="form-grid">
            <label>
              End-of-day date
              <input
                type="date"
                max={today()}
                required
                value={draft.date}
                disabled={untracked}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </label>
            <label>
              Confirmed balance ($)
              <input
                inputMode="decimal"
                required
                value={draft.amount}
                disabled={untracked}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
            </label>
          </div>
          <label>
            Balance purpose
            <select
              value={draft.purpose}
              disabled={untracked}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  purpose: e.target.value as Draft["purpose"],
                })
              }
            >
              <option value="confirmed">Confirmed balance</option>
              <option value="opening">Opening balance</option>
            </select>
          </label>
          <label>
            Balance note
            <textarea
              maxLength={2000}
              value={draft.note}
              disabled={untracked}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          <label className="import-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={untracked}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            This balance includes all posted activity through the selected date.
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {remove ? (
            <div className="delete-confirm">
              <p>
                Remove this checkpoint? The estimate will use the previous
                checkpoint, or become unknown. Transactions stay intact.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => setRemove(false)}
              >
                Keep balance
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => void persist(true)}
              >
                Remove checkpoint
              </button>
            </div>
          ) : (
            <div className="dialog-actions">
              {!!draft.revision && (
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => setRemove(true)}
                >
                  Remove balance
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setDraft(fresh());
                  setConfirmed(false);
                  setRemove(false);
                  setError("");
                }}
              >
                Clear form
              </button>
              <button
                type="submit"
                className="primary"
                disabled={
                  !confirmed ||
                  untracked ||
                  (!draft.revision && account.archived)
                }
              >
                {busy ? "Saving…" : "Save balance"}
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
