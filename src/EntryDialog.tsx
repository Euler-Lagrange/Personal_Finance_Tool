import BudgetPeriod, { guardPeriodClose } from "./BudgetPeriod";
import ChargeLines, { editableLines } from "./ChargeLines";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, Trash2, X } from "lucide-react";
import { command, dollars, money, today } from "./api";
import {
  accountKindLabel,
  isBudgetOutflow,
  type Entry,
  type EntryInput,
  type EntryKind,
  type Snapshot,
} from "./types";
import { CategoryIcon } from "./CategoryIcon";

export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-label={title}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function EntryDialog({
  snapshot,
  entry,
  kind = "expense",
  shared = false,
  onClose,
  onSaved,
}: {
  snapshot: Snapshot;
  entry?: Entry;
  kind?: EntryKind;
  shared?: boolean;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const activeAccounts = snapshot.accounts.filter((a) => !a.archived);
  const defaultBank =
    activeAccounts.find((a) => a.id === "checking" && a.kind === "checking")
      ?.id ??
    activeAccounts.find((a) => a.kind !== "credit")?.id ??
    null;
  const defaultExpense =
    activeAccounts.find((a) => a.id === "capital-one")?.id ??
    activeAccounts.find((a) => a.kind === "credit")?.id ??
    defaultBank;
  const [input, setInput] = useState<EntryInput>(() =>
    entry
      ? {
          ...entry,
          amount: dollars(entry.amountCents),
          lines: editableLines(entry.lines),
        }
      : {
          id: crypto.randomUUID(),
          revision: 0,
          kind,
          date:
            kind === "settlement" || snapshot.month === today().slice(0, 7)
              ? today()
              : `${snapshot.month}-01`,
          description: kind === "settlement" ? "Repayment with Chelsea" : "",
          amount:
            kind === "settlement"
              ? dollars(Math.abs(snapshot.householdCents))
              : "",
          payer:
            kind === "settlement" && snapshot.householdCents > 0
              ? "chelsea"
              : "jacob",
          categoryId: kind === "expense" ? "uncategorized" : null,
          accountId: kind === "expense" ? defaultExpense : defaultBank,
          destinationAccountId: null,
          splitMode: shared ? "shared" : "personal",
          splitValue: "",
          note: "",
        },
  );
  const requestClose = guardPeriodClose(input, entry?.budgetOverride, onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<[number, number] | null>(null);
  const [remove, setRemove] = useState(false);
  function update<K extends keyof EntryInput>(key: K, value: EntryInput[K]) {
    setInput((x) => ({ ...x, [key]: value }));
  }
  useEffect(() => {
    let alive = true;
    setPreview(null);
    if (isBudgetOutflow(input.kind) && input.amount && !input.lines?.length)
      command<[number, number]>("preview_split", {
        amount: input.amount,
        mode: input.splitMode,
        value: input.splitValue,
      })
        .then((p) => {
          if (alive) setPreview(p);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [
    input.kind,
    input.amount,
    input.splitMode,
    input.splitValue,
    input.lines,
  ]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await command("save_entry", { workspace: snapshot.workspace, input });
      await onSaved(
        entry
          ? "Changes saved."
          : input.kind === "settlement"
            ? "Repayment recorded. Spending and income are unchanged."
            : "Entry saved.",
      );
      onClose();
    } catch (err) {
      setError(String(err));
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
      await onSaved("Entry removed. A recovery backup was saved.");
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  const settlement = input.kind === "settlement";
  return (
    <Modal
      title={
        entry
          ? "Edit entry"
          : settlement
            ? "Record a repayment"
            : "Add an entry"
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
          {!entry && !settlement && (
            <div className="segmented">
              <button
                type="button"
                className={isBudgetOutflow(input.kind) ? "selected" : ""}
                onClick={() =>
                  setInput((x) => ({
                    ...x,
                    kind: "expense",
                    categoryId: "uncategorized",
                    accountId: x.payer === "chelsea" ? null : defaultExpense,
                  }))
                }
              >
                Expense
              </button>
              <button
                type="button"
                className={
                  ["income", "reward"].includes(input.kind) ? "selected" : ""
                }
                onClick={() =>
                  setInput((x) => ({
                    ...x,
                    kind: "income",
                    lines: [],
                    payer: "jacob",
                    categoryId: null,
                    accountId: defaultBank,
                  }))
                }
              >
                Income
              </button>
            </div>
          )}
          {!entry && isBudgetOutflow(input.kind) && (
            <label>
              Expense treatment
              <select
                value={input.kind}
                onChange={(e) => update("kind", e.target.value as EntryKind)}
              >
                <option value="expense">Purchase</option>
                <option value="debt_payment">Loan/debt payment</option>
              </select>
            </label>
          )}
          {!entry && ["income", "reward"].includes(input.kind) && (
            <label>
              Income treatment
              <select
                value={input.kind}
                onChange={(e) =>
                  setInput((x) => ({
                    ...x,
                    kind: e.target.value as EntryKind,
                    accountId: defaultBank,
                  }))
                }
              >
                <option value="income">Income received</option>
                <option value="reward">Reward or account credit</option>
              </select>
            </label>
          )}
          {input.kind === "debt_payment" && (
            <p className="form-intro">
              The full payment uses your monthly budget. Reports separate it
              from purchase spending; principal and interest are not tracked.
              Use Card payment for payments between your bank and credit card.
            </p>
          )}
          {input.kind === "reward" && (
            <p className="form-intro">
              Choose the account actually credited. A card credit reduces card
              debt; it does not add cash to checking. Use Refund when a credit
              reverses a purchase.
            </p>
          )}
          {settlement && (
            <p className="form-intro">
              Record money that has already changed hands. This updates what you
              owe each other without adding income or spending.
            </p>
          )}
          <label>
            {settlement
              ? "Description"
              : input.kind === "income"
                ? "Income source"
                : "Description"}
            <input
              autoFocus
              required
              maxLength={200}
              placeholder="e.g. Groceries at Kroger"
              value={input.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              Full amount{" "}
              <span className="input-prefix">
                <span>$</span>
                <input
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,2})?"
                  placeholder="0.00"
                  value={input.amount}
                  onChange={(e) => update("amount", e.target.value)}
                />
              </span>
            </label>
            <label>
              Date
              <input
                required
                type="date"
                max={
                  settlement || ["reward", "debt_payment"].includes(input.kind)
                    ? today()
                    : undefined
                }
                value={input.date}
                onChange={(e) => update("date", e.target.value)}
              />
            </label>
          </div>
          {!["income", "reward"].includes(input.kind) && (
            <label>
              {settlement ? "Who sent the repayment?" : "Who paid?"}
              <select
                value={input.payer}
                onChange={(e) =>
                  setInput((x) => ({
                    ...x,
                    payer: e.target.value as EntryInput["payer"],
                    accountId:
                      e.target.value === "chelsea" && !settlement
                        ? null
                        : defaultBank,
                  }))
                }
              >
                <option value="jacob">Jacob (you)</option>
                <option value="chelsea">Chelsea</option>
              </select>
            </label>
          )}
          {(input.payer === "jacob" || settlement) && (
            <label>
              {settlement && input.payer === "chelsea"
                ? "Where is the money now?"
                : "Your account"}
              <select
                required={!(settlement && input.payer === "chelsea")}
                value={input.accountId ?? ""}
                onChange={(e) => update("accountId", e.target.value || null)}
              >
                {settlement && input.payer === "chelsea" && (
                  <option value="">
                    Received in PayPal · not yet in a bank account
                  </option>
                )}
                {!(settlement && input.payer === "chelsea") && (
                  <option value="" disabled>
                    Choose an active account
                  </option>
                )}
                {snapshot.accounts
                  .filter(
                    (a) =>
                      (!a.archived || a.id === entry?.accountId) &&
                      (isBudgetOutflow(input.kind) ||
                        input.kind === "reward" ||
                        a.kind !== "credit"),
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {` · ${accountKindLabel[a.kind].toLowerCase()}`}
                      {a.archived ? " · archived" : ""}
                    </option>
                  ))}
              </select>
              {!activeAccounts.some(
                (a) =>
                  isBudgetOutflow(input.kind) ||
                  input.kind === "reward" ||
                  a.kind !== "credit",
              ) && (
                <span className="optional">
                  Add or restore an account in Accounts & categories.
                </span>
              )}
            </label>
          )}
          {isBudgetOutflow(input.kind) && (
            <>
              {input.payer === "chelsea" && (
                <div className="soft-note">
                  Chelsea paid, so your bank and card activity won’t change.
                </div>
              )}
              <div className="form-grid">
                <label>
                  <span className="category-field-label">
                    <CategoryIcon
                      category={snapshot.categories.find(
                        (c) => c.id === input.categoryId,
                      )}
                      size={16}
                    />
                    Category
                  </span>
                  <select
                    disabled={!!input.lines?.length}
                    value={input.categoryId ?? ""}
                    onChange={(e) => update("categoryId", e.target.value)}
                  >
                    {snapshot.categories
                      .filter((c) => !c.archived || c.id === entry?.categoryId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.archived ? " · archived" : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Split
                  <select
                    value={input.splitMode}
                    onChange={(e) => update("splitMode", e.target.value)}
                  >
                    <option value="personal">All mine</option>
                    <option value="shared">Shared · 70 / 30</option>
                    <option value="equal">Shared · 50 / 50</option>
                    <option value="percent">Custom percentage</option>
                    <option value="exact">Exact dollar shares</option>
                    <option value="chelsea">All Chelsea’s</option>
                  </select>
                </label>
              </div>
              {["percent", "exact"].includes(input.splitMode) && (
                <label>
                  {input.splitMode === "percent"
                    ? "Jacob’s percentage (0–100)"
                    : "Jacob’s exact share ($)"}
                  <input
                    required
                    inputMode="decimal"
                    value={input.splitValue}
                    onChange={(e) => update("splitValue", e.target.value)}
                  />
                </label>
              )}
              <ChargeLines
                value={input}
                categories={snapshot.categories}
                change={(lines) =>
                  setInput((x) => ({
                    ...x,
                    lines,
                    categoryId: lines[0]?.categoryId ?? x.categoryId,
                  }))
                }
              />
              {!input.lines?.length && (
                <div className="split-preview">
                  <div>
                    <span>Your budget share</span>
                    <strong>{preview ? money(preview[0]) : "—"}</strong>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <span>Chelsea’s share</span>
                    <strong>{preview ? money(preview[1]) : "—"}</strong>
                  </div>
                </div>
              )}
            </>
          )}
          {settlement && input.payer === "chelsea" && !input.accountId && (
            <div className="soft-note">
              This repayment reduces the outstanding shared balance. Use Record
              PayPal cash-out in Shared expenses when the funds reach your bank.
            </div>
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
              placeholder="Additional transaction details"
              value={input.note}
              onChange={(e) => update("note", e.target.value)}
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
                Remove this entry and its budget, account, and shared-balance
                effects? A recovery backup will be kept.
              </p>
              <button type="button" className="danger" onClick={deleteEntry}>
                Remove entry
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setRemove(false)}
              >
                Keep entry
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
                {busy ? "Saving…" : "Save entry"}
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
