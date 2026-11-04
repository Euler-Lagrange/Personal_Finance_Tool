import BudgetPeriod, { guardPeriodClose } from "./BudgetPeriod";
import { useState, type FormEvent } from "react";
import { ArrowRightLeft, Check, Trash2 } from "lucide-react";
import { command, dollars, today } from "./api";
import { Modal } from "./EntryDialog";
import {
  accountKindLabel,
  type Entry,
  type EntryInput,
  type Snapshot,
} from "./types";
import "./transfer.css";

export default function TransferDialog({
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
  const active = snapshot.accounts.filter((a) => !a.archived);
  const source =
    active.find((a) => a.id === "checking") ??
    active.find((a) => a.kind !== "credit");
  const [input, setInput] = useState<EntryInput>(() =>
    entry
      ? { ...entry, amount: dollars(entry.amountCents), lines: [] }
      : {
          id: crypto.randomUUID(),
          revision: 0,
          kind: "transfer",
          date:
            snapshot.month === today().slice(0, 7) ||
            snapshot.month > today().slice(0, 7)
              ? today()
              : `${snapshot.month}-01`,
          description: "Bank transfer",
          amount: "",
          payer: "jacob",
          categoryId: null,
          accountId: source?.id ?? null,
          destinationAccountId:
            active.find((a) => a.kind !== "credit" && a.id !== source?.id)
              ?.id ?? null,
          splitMode: "none",
          splitValue: "",
          note: "",
        },
  );
  const requestClose = guardPeriodClose(input, entry?.budgetOverride, onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remove, setRemove] = useState(false);
  const payment = input.kind === "card_payment";
  const fromAccounts = snapshot.accounts.filter(
    (a) => a.kind !== "credit" && (!a.archived || a.id === entry?.accountId),
  );
  const toAccounts = snapshot.accounts.filter(
    (a) =>
      a.id !== input.accountId &&
      (payment ? a.kind === "credit" : a.kind !== "credit") &&
      (!a.archived || a.id === entry?.destinationAccountId),
  );
  const update = <K extends keyof EntryInput>(key: K, value: EntryInput[K]) =>
    setInput((x) => ({ ...x, [key]: value }));
  function changeKind(kind: "transfer" | "card_payment") {
    setInput((x) => ({
      ...x,
      kind,
      description: ["Bank transfer", "Credit card payment"].includes(
        x.description,
      )
        ? kind === "card_payment"
          ? "Credit card payment"
          : "Bank transfer"
        : x.description,
      destinationAccountId:
        active.find(
          (a) =>
            a.id !== x.accountId &&
            (kind === "card_payment"
              ? a.kind === "credit"
              : a.kind !== "credit"),
        )?.id ?? null,
    }));
    setError("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await command("save_entry", { workspace: snapshot.workspace, input });
      await onSaved(
        entry
          ? "Changes saved to both accounts."
          : payment
            ? "Card payment recorded. Spending and income are unchanged."
            : "Transfer recorded in both accounts.",
      );
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function deleteEntry() {
    setBusy(true);
    setError("");
    try {
      await command("delete_entry", {
        workspace: snapshot.workspace,
        id: input.id,
        revision: input.revision,
      });
      await onSaved(
        "Transfer removed from both accounts. A recovery backup was saved.",
      );
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        entry
          ? payment
            ? "Edit card payment"
            : "Edit bank transfer"
          : "Move money"
      }
      onClose={requestClose}
      busy={busy}
    >
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          {snapshot.workspace === "demo" && (
            <div className="dialog-notice">
              You’re editing the sample workspace.
            </div>
          )}
          {!entry && (
            <div className="segmented" aria-label="Movement type">
              <button
                type="button"
                aria-pressed={!payment}
                className={!payment ? "selected" : ""}
                onClick={() => changeKind("transfer")}
              >
                Bank transfer
              </button>
              <button
                type="button"
                aria-pressed={payment}
                className={payment ? "selected" : ""}
                onClick={() => changeKind("card_payment")}
              >
                Card payment
              </button>
            </div>
          )}
          <p className="form-intro">
            Record money that has already moved.{" "}
            {payment
              ? "A card payment reduces bank cash and card debt; the purchases remain your spending."
              : "Move money between your checking and savings accounts without adding income or spending."}
          </p>
          <label>
            Description
            <input
              autoFocus
              required
              maxLength={200}
              value={input.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              Amount ($)
              <input
                required
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,2})?"
                placeholder="0.00"
                value={input.amount}
                onChange={(e) => update("amount", e.target.value)}
              />
            </label>
            <label>
              Date
              <input
                required
                type="date"
                max={today()}
                value={input.date}
                onChange={(e) => update("date", e.target.value)}
              />
            </label>
          </div>
          <label>
            From account
            <select
              required
              value={input.accountId ?? ""}
              onChange={(e) =>
                setInput((x) => ({
                  ...x,
                  accountId: e.target.value,
                  destinationAccountId:
                    x.destinationAccountId === e.target.value
                      ? null
                      : x.destinationAccountId,
                }))
              }
            >
              <option value="" disabled>
                Choose a bank account
              </option>
              {fromAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {accountKindLabel[a.kind].toLowerCase()}
                  {a.archived ? " · archived" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            {payment ? "Card to pay" : "To account"}
            <select
              required
              value={input.destinationAccountId ?? ""}
              onChange={(e) => update("destinationAccountId", e.target.value)}
            >
              <option value="" disabled>
                {payment
                  ? "Choose a credit card"
                  : "Choose a different bank account"}
              </option>
              {toAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {accountKindLabel[a.kind].toLowerCase()}
                  {a.archived ? " · archived" : ""}
                </option>
              ))}
            </select>
          </label>
          {(!fromAccounts.length || !toAccounts.length) && (
            <div className="soft-note">
              {payment
                ? "Add or restore a bank account and a credit card in Accounts & categories."
                : "Add or restore two different checking or savings accounts in Accounts & categories."}
            </div>
          )}
          <div className="transfer-effect">
            <ArrowRightLeft size={20} aria-hidden="true" />
            <div>
              <strong>One record · both accounts updated</strong>
              <span>
                Spending, income, and the balance with Chelsea stay unchanged.
              </span>
            </div>
          </div>
          {payment && (
            <p className="form-intro">
              Enter the amount actually paid, even if it differs from the
              purchases recorded here. This records the payment; it does not
              send money.
            </p>
          )}
          <BudgetPeriod
            input={input}
            change={setInput}
            selectedMonth={snapshot.month}
          />
          <label>
            Note <span className="optional">optional</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={input.note}
              onChange={(e) => update("note", e.target.value)}
              placeholder="Additional transfer details"
            />
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {remove ? (
            <div className="delete-confirm">
              <p>
                Remove this record and reverse its activity in both accounts?
                Purchases stay unchanged. A recovery backup will be kept.
              </p>
              <button type="button" className="danger" onClick={deleteEntry}>
                Remove transfer
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setRemove(false)}
              >
                Keep transfer
              </button>
            </div>
          ) : (
            <div className="dialog-actions">
              {entry && (
                <button
                  type="button"
                  className="text-danger"
                  onClick={() => setRemove(true)}
                >
                  <Trash2 size={16} />
                  Remove
                </button>
              )}
              <span className="spacer" />
              <button
                type="button"
                className="secondary"
                onClick={requestClose}
              >
                Cancel
              </button>
              <button type="submit" className="primary">
                <Check size={17} />
                {busy
                  ? "Saving…"
                  : entry
                    ? "Save changes"
                    : payment
                      ? "Record payment"
                      : "Record transfer"}
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
