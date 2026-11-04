import BudgetPeriod, { guardPeriodClose } from "./BudgetPeriod";
import { lineInputs } from "./ChargeLines";
import { useEffect, useState } from "react";
import { Modal } from "./EntryDialog";
import { command, dollars, money, today } from "./api";
import type { Entry, EntryInput, EntryLine, Snapshot } from "./types";
export interface RefundPurchase {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  remainingCents: number;
  jacobCents: number;
  chelseaCents: number;
  payer: "jacob" | "chelsea";
  categoryId: string;
  accountId: string | null;
  lines?: (EntryLine & { remainingCents: number })[];
}
export function RefundFields({
  data,
  input,
  update,
  importAccount,
}: {
  data: Snapshot;
  input: EntryInput;
  update: (input: EntryInput) => void;
  importAccount?: string;
}) {
  const [purchases, setPurchases] = useState<RefundPurchase[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    command<RefundPurchase[]>("refund_purchases", {
      workspace: data.workspace,
      editing: input.revision ? input.id : null,
    })
      .then((p) => {
        if (alive) setPurchases(p);
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
  }, [data.workspace, input.id, input.revision]);
  const original = purchases.find((p) => p.id === input.originalEventId);
  const matching = purchases.filter(
    (p) =>
      (!importAccount || p.payer === "jacob") &&
      (p.id === input.originalEventId ||
        (p.remainingCents > 0 &&
          `${p.description} ${p.date}`
            .toLowerCase()
            .includes(query.toLowerCase()))),
  );
  const options = matching.slice(0, 500);
  if (original && !options.some((p) => p.id === original.id))
    options.unshift(original);
  return (
    <>
      <label>
        Find original purchase
        <input
          placeholder="Search description or date"
          value={query}
          disabled={!!input.revision}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <label>
        Original purchase
        <select
          required
          disabled={!!input.revision || loading}
          value={input.originalEventId ?? ""}
          onChange={(e) => {
            const p = purchases.find((p) => p.id === e.target.value);
            if (p)
              update({
                ...input,
                originalEventId: p.id,
                lines: [],
                payer: p.payer,
                categoryId: p.categoryId,
                accountId:
                  p.payer === "chelsea" ? null : (importAccount ?? p.accountId),
                description:
                  input.description ||
                  `Refund · ${p.description}`.slice(0, 200),
              });
          }}
        >
          <option value="">
            {loading
              ? "Loading purchases…"
              : "Choose the purchase being refunded"}
          </option>
          {options.map((p) => (
            <option value={p.id} key={p.id}>
              {p.date} · {p.description} · {money(p.remainingCents)} refundable
            </option>
          ))}
        </select>
        {matching.length > 500 && (
          <small>Search to narrow the first 500 purchases shown.</small>
        )}
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {original && (
        <div className="dialog-notice">
          Remaining refundable:{" "}
          <strong>{money(original.remainingCents)}</strong>. Original shares:
          Jacob {money(original.jacobCents)}, Chelsea{" "}
          {money(original.chelseaCents)}. Refunds reduce{" "}
          {original.lines && original.lines.length > 1
            ? "the original line categories"
            : (data.categories.find((c) => c.id === original.categoryId)
                ?.name ?? "the original category")}{" "}
          in the month received.{" "}
          {original.payer === "chelsea"
            ? "Chelsea receives this refund; your accounts do not change."
            : "The receiving account records the returned money."}
        </div>
      )}
      {original?.lines && original.lines.length > 1 && (
        <section className="charge-lines" aria-label="Refund charge lines">
          <h3>Returned charge amounts</h3>
          <p>
            Enter only the returned portions. These amounts must total the full
            refund; each uses its original category and stored shares.
          </p>
          {original.lines.map((l) => (
            <label key={l.id}>
              {l.label ||
                data.categories.find((c) => c.id === l.categoryId)?.name ||
                "Charge"}{" "}
              · {money(l.remainingCents ?? l.amountCents)} refundable
              <input
                inputMode="decimal"
                aria-label={`Refund for ${l.label || l.categoryId}`}
                placeholder="0.00"
                value={
                  input.lines?.find((r) => r.originalLineId === l.id)?.amount ??
                  ""
                }
                onChange={(e) => {
                  const remaining = (input.lines ?? []).filter(
                    (r) => r.originalLineId !== l.id,
                  );
                  update({
                    ...input,
                    lines: e.target.value
                      ? [
                          ...remaining,
                          {
                            id: l.id,
                            label: l.label,
                            categoryId: l.categoryId,
                            amount: e.target.value,
                            splitMode: "inherit",
                            splitValue: "",
                            originalLineId: l.id,
                          },
                        ]
                      : remaining,
                  });
                }}
              />
            </label>
          ))}
        </section>
      )}
      {original?.payer === "jacob" && !importAccount && (
        <label>
          Refund received into
          <select
            required
            value={input.accountId ?? ""}
            onChange={(e) => update({ ...input, accountId: e.target.value })}
          >
            <option value="">Choose receiving account</option>
            {data.accounts
              .filter((a) => !a.archived || a.id === input.accountId)
              .map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                  {a.archived ? " (archived)" : ""}
                </option>
              ))}
          </select>
        </label>
      )}
    </>
  );
}
export default function RefundDialog({
  snapshot,
  entry,
  onClose,
  onSaved,
}: {
  snapshot: Snapshot;
  entry?: Entry;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [input, setInput] = useState<EntryInput>(() =>
    entry
      ? {
          ...entry,
          amount: dollars(entry.amountCents),
          lines: lineInputs(entry.lines),
        }
      : {
          id: crypto.randomUUID(),
          revision: 0,
          kind: "refund",
          date: today(),
          description: "",
          amount: "",
          payer: "jacob",
          categoryId: null,
          accountId: null,
          destinationAccountId: null,
          originalEventId: null,
          splitMode: "refund",
          splitValue: "",
          note: "",
        },
  );
  const requestClose = guardPeriodClose(input, entry?.budgetOverride, onClose);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmRemove, setConfirmRemove] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await command("save_entry", { workspace: snapshot.workspace, input });
      await onSaved("Refund saved. Spending and shared balances updated.");
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await command("delete_entry", {
        workspace: snapshot.workspace,
        id: input.id,
        revision: input.revision,
      });
      await onSaved("Refund removed.");
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={entry ? "Edit refund" : "Record refund"}
      onClose={requestClose}
      busy={busy}
    >
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <p className="form-intro">
            Link returned money to its purchase. It reduces spending, not
            income. Original shares are preserved, even after settling with
            Chelsea.
          </p>
          <RefundFields data={snapshot} input={input} update={setInput} />
          <label>
            Description
            <input
              required
              maxLength={200}
              value={input.description}
              onChange={(e) =>
                setInput((i) => ({ ...i, description: e.target.value }))
              }
            />
          </label>
          <div className="form-grid">
            <label>
              Refund amount ($)
              <input
                required
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,2})?"
                value={input.amount}
                onChange={(e) =>
                  setInput((i) => ({ ...i, amount: e.target.value }))
                }
              />
            </label>
            <label>
              Received date
              <input
                required
                type="date"
                max={today()}
                value={input.date}
                onChange={(e) =>
                  setInput((i) => ({ ...i, date: e.target.value }))
                }
              />
            </label>
          </div>
          <BudgetPeriod
            input={input}
            change={setInput}
            selectedMonth={snapshot.month}
          />
          <label>
            Notes
            <textarea
              maxLength={2000}
              value={input.note}
              onChange={(e) =>
                setInput((i) => ({ ...i, note: e.target.value }))
              }
            />
          </label>
          <p className="form-intro">
            Editing or removing an earlier partial refund may adjust a rounding
            cent on a later refund. A purchase with refunds keeps its original
            amount, date, category, and allocation; its description and notes
            remain editable.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {confirmRemove ? (
            <div className="delete-confirm" key="confirm-removal">
              <p>
                Remove this refund and reverse its financial effects? Later
                partial refunds may need a rounding adjustment. A recovery
                backup will be kept.
              </p>
              <button
                type="button"
                className="danger"
                onClick={() => void remove()}
              >
                Remove refund
              </button>
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.preventDefault();
                  setConfirmRemove(false);
                }}
              >
                Keep refund
              </button>
            </div>
          ) : (
            <div className="dialog-actions" key="edit-actions">
              {entry && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => setConfirmRemove(true)}
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={requestClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary"
                disabled={!input.originalEventId}
              >
                {busy ? "Saving…" : "Save refund"}
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
