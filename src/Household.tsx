import { HelpHeading } from "./HelpTip";
import BudgetPeriod from "./BudgetPeriod";
import "./household.css";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { command, dollars, money, today, shortDate } from "./api";
import { Modal } from "./EntryDialog";
import type {
  Entry,
  EntryInput,
  HouseholdOpening,
  PayPalInput,
  PayPalReceipt,
  Snapshot,
} from "./types";
export const emptyPayPal = (): PayPalInput => ({
  receipts: [],
  fee: "0",
  feeCategoryId: null,
  other: "0",
  otherNote: "",
});

export function HouseholdTools({
  data,
  saved,
  cashout,
}: {
  data: Snapshot;
  saved: (message: string) => Promise<void>;
  cashout: () => void;
}) {
  const [opening, setOpening] = useState<HouseholdOpening | null>(null),
    [held, setHeld] = useState<number | null>(null),
    [error, setError] = useState(""),
    [edit, setEdit] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setError("");
    setHeld(null);
    Promise.all([
      command<HouseholdOpening | null>("household_opening", {
        workspace: data.workspace,
      }),
      command<PayPalReceipt[]>("paypal_receipts", {
        workspace: data.workspace,
        editing: null,
      }),
    ])
      .then(([o, r]) => {
        if (alive) {
          setOpening(o ?? null);
          setHeld((r ?? []).reduce((s, x) => s + x.availableCents, 0));
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [data, reload]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <HelpHeading topic="shared">
            <h2>Opening balance & PayPal</h2>
          </HelpHeading>
          <p>
            One reconciled starting amount; receipts and bank deposits stay
            separate.
          </p>
        </div>
      </div>
      <div className="household-tools">
        <div>
          <span className="muted">Opening shared balance</span>
          <strong>
            {opening
              ? `${money(Math.abs(opening.amountCents))} ${opening.amountCents >= 0 ? "owed by Chelsea" : "owed by you"}`
              : "Not set"}
          </strong>
          {opening && (
            <small>As of {shortDate(opening.date)} at end of day</small>
          )}
          <button
            className="secondary"
            disabled={!!error || held === null}
            onClick={() => setEdit(true)}
          >
            {opening ? "Edit opening balance" : "Set opening balance"}
          </button>
        </div>
        <div>
          <span className="muted">Unreconciled Chelsea receipts</span>
          <strong>{held === null ? "Loading..." : money(held)}</strong>
          <small>
            Received in PayPal, not yet allocated to a bank cash-out. This is
            not your complete PayPal balance.
          </small>
          <button className="secondary" onClick={cashout}>
            Record PayPal cash-out
          </button>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
          <button className="secondary" onClick={() => setReload((x) => x + 1)}>
            Retry
          </button>
        </div>
      )}
      {edit && (
        <OpeningDialog
          data={data}
          initial={opening}
          close={() => setEdit(false)}
          saved={saved}
        />
      )}
    </section>
  );
}
function OpeningDialog({
  data,
  initial,
  close,
  saved,
}: {
  data: Snapshot;
  initial: HouseholdOpening | null;
  close: () => void;
  saved: (m: string) => Promise<void>;
}) {
  const prior = new Date(`${data.month}-01T12:00:00`);
  prior.setDate(0);
  const defaultDate = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, "0")}-${String(prior.getDate()).padStart(2, "0")}`;
  const [date, setDate] = useState(
      initial?.date ?? (defaultDate > today() ? today() : defaultDate),
    ),
    [amount, setAmount] = useState(
      initial ? dollars(Math.abs(initial.amountCents)) : "",
    ),
    [who, setWho] = useState(
      initial && initial.amountCents < 0 ? "jacob" : "chelsea",
    ),
    [note, setNote] = useState(initial?.note ?? ""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const baseline = useRef(JSON.stringify({ date, amount, who, note }));
  const dismiss = () => {
    if (
      baseline.current !== JSON.stringify({ date, amount, who, note }) &&
      !window.confirm("Discard opening balance changes?")
    )
      return;
    close();
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await command("save_household_opening", {
        workspace: data.workspace,
        input: {
          revision: initial?.revision ?? 0,
          date,
          amount: `${who === "jacob" ? "-" : ""}${amount}`,
          note,
          reconciled: confirmed,
        },
      });
      await saved(
        "Opening shared balance saved. Spending and income are unchanged.",
      );
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Opening shared balance" onClose={dismiss} busy={busy}>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <p className="form-intro">
            Enter one reconciled amount from before this app's shared history.
            Check overlap between your bills sheet and Splitwise before using
            their totals. This does not add spending, income or bank cash.
          </p>
          <label>
            Opening date
            <input
              type="date"
              required
              max={today()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <small>End of day, before every recorded shared transaction.</small>
          </label>
          <div className="form-grid">
            <label>
              Who owes the opening amount?
              <select value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="chelsea">Chelsea owes Jacob</option>
                <option value="jacob">Jacob owes Chelsea</option>
              </select>
            </label>
            <label>
              Opening amount ($)
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          </div>
          <label>
            Reconciliation note
            <textarea
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Sources checked and any overlapping expenses removed"
            />
          </label>
          <label className="import-check">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reconciled overlapping records and this amount excludes the shared
            activity already entered here.
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={dismiss}>
              Cancel
            </button>
            <button className="primary" type="submit">
              {busy ? "Saving..." : "Save opening balance"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
export function PayPalFields({
  data,
  value,
  change,
  editing,
}: {
  data: Snapshot;
  value: PayPalInput;
  change: (v: PayPalInput) => void;
  editing?: string;
}) {
  const [receipts, setReceipts] = useState<PayPalReceipt[] | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setReceipts(null);
    setError("");
    command<PayPalReceipt[]>("paypal_receipts", {
      workspace: data.workspace,
      editing: editing ?? null,
    })
      .then((r) => {
        if (alive) setReceipts(r ?? []);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [data.workspace, editing, reload]);
  const fee = Number(value.fee) > 0;
  return (
    <div className="paypal-fields">
      <p className="form-intro">
        Allocate only repayments already received from Chelsea. The cash-out
        adds the net bank deposit once; it does not settle the shared balance
        again. Receipts plus other funds must equal the bank deposit plus the
        fee.
      </p>
      <h3>Receipts used</h3>
      {error ? (
        <p className="error" role="alert">
          {error}
          <button
            type="button"
            className="secondary"
            onClick={() => setReload((x) => x + 1)}
          >
            Reload receipts
          </button>
        </p>
      ) : receipts === null ? (
        <p>Loading receipts...</p>
      ) : !receipts.length ? (
        <p className="muted">
          No held Chelsea receipts. Record a received PayPal repayment first, or
          explain other funds below.
        </p>
      ) : (
        receipts.map((r) => {
          const selected = value.receipts.find((a) => a.id === r.id);
          return (
            <div key={r.id} className="paypal-receipt">
              <label className="import-check">
                <input
                  type="checkbox"
                  checked={!!selected}
                  disabled={!selected && r.availableCents <= 0}
                  onChange={(e) =>
                    change({
                      ...value,
                      receipts: e.target.checked
                        ? [
                            ...value.receipts,
                            {
                              id: r.id,
                              revision: r.revision,
                              amount: dollars(r.availableCents),
                            },
                          ]
                        : value.receipts.filter((a) => a.id !== r.id),
                    })
                  }
                />
                <span>
                  {r.description}
                  <small>
                    {shortDate(r.date)} - {money(r.availableCents)} available
                  </small>
                </span>
              </label>
              {selected && (
                <label>
                  Amount from {r.description} ($)
                  <input
                    required
                    inputMode="decimal"
                    value={selected.amount}
                    onChange={(e) =>
                      change({
                        ...value,
                        receipts: value.receipts.map((a) =>
                          a.id === r.id
                            ? {
                                ...a,
                                revision: r.revision,
                                amount: e.target.value,
                              }
                            : a,
                        ),
                      })
                    }
                  />
                </label>
              )}
            </div>
          );
        })
      )}
      <div className="form-grid">
        <label>
          PayPal fee ($)
          <input
            required
            inputMode="decimal"
            value={value.fee}
            onChange={(e) =>
              change({
                ...value,
                fee: e.target.value,
                feeCategoryId:
                  Number(e.target.value) > 0 ? value.feeCategoryId : null,
              })
            }
          />
        </label>
        <label>
          Other PayPal funds ($)
          <input
            required
            inputMode="decimal"
            value={value.other}
            onChange={(e) => change({ ...value, other: e.target.value })}
          />
        </label>
      </div>
      {fee && (
        <label>
          Fee category
          <select
            required
            value={value.feeCategoryId ?? ""}
            onChange={(e) =>
              change({ ...value, feeCategoryId: e.target.value })
            }
          >
            <option value="">Choose category</option>
            {data.categories
              .filter((c) => !c.archived || c.id === value.feeCategoryId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <small>
            The fee is your spending, deducted inside PayPal. It does not reduce
            checking a second time.
          </small>
        </label>
      )}
      {Number(value.other) > 0 && (
        <label>
          Explain other funds
          <textarea
            required
            maxLength={2000}
            value={value.otherNote}
            onChange={(e) => change({ ...value, otherNote: e.target.value })}
          />
          <small>
            This is existing PayPal money, not new income. Record its original
            income, refund or transfer separately if it is not already recorded.
            Only Chelsea receipts listed above are reconciled here.
          </small>
        </label>
      )}
    </div>
  );
}
export default function PayPalDialog({
  data,
  entry,
  close,
  saved,
}: {
  data: Snapshot;
  entry?: Entry;
  close: () => void;
  saved: (m: string) => Promise<void>;
}) {
  const [input, setInput] = useState<EntryInput>(() => ({
    budgetOverride: entry?.budgetOverride,
    id: entry?.id ?? crypto.randomUUID(),
    revision: entry?.revision ?? 0,
    kind: "paypal_cashout",
    date: entry?.date ?? today(),
    description: entry?.description ?? "PayPal cash-out",
    amount: entry ? dollars(entry.amountCents) : "",
    payer: "jacob",
    accountId:
      entry?.accountId ??
      data.accounts.find((a) => a.kind === "checking" && !a.archived)?.id ??
      null,
    categoryId: null,
    destinationAccountId: null,
    splitMode: "none",
    splitValue: "",
    note: entry?.note ?? "",
    lines: [],
    paypal: entry?.paypal ?? emptyPayPal(),
  }));
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [remove, setRemove] = useState(false);
  const baseline = useRef(JSON.stringify(input));
  const dismiss = () => {
    if (
      baseline.current !== JSON.stringify(input) &&
      !window.confirm("Discard cash-out changes?")
    )
      return;
    close();
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await command("save_entry", { workspace: data.workspace, input });
      await saved(
        "PayPal cash-out saved. The shared balance was not settled again.",
      );
      close();
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
        workspace: data.workspace,
        id: input.id,
        revision: input.revision,
      });
      await saved("Cash-out removed; receipts are available again.");
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={entry ? "Edit PayPal cash-out" : "Record PayPal cash-out"}
      onClose={dismiss}
      busy={busy}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Description
            <input
              required
              maxLength={200}
              value={input.description}
              onChange={(e) =>
                setInput({ ...input, description: e.target.value })
              }
            />
          </label>
          <div className="form-grid">
            <label>
              Bank deposit ($)
              <input
                required
                inputMode="decimal"
                value={input.amount}
                onChange={(e) => setInput({ ...input, amount: e.target.value })}
              />
            </label>
            <label>
              Deposit date
              <input
                required
                type="date"
                max={today()}
                value={input.date}
                onChange={(e) => setInput({ ...input, date: e.target.value })}
              />
            </label>
          </div>
          <label>
            Receiving bank account
            <select
              required
              value={input.accountId ?? ""}
              onChange={(e) =>
                setInput({ ...input, accountId: e.target.value })
              }
            >
              <option value="">Choose account</option>
              {data.accounts
                .filter(
                  (a) =>
                    a.kind !== "credit" &&
                    (!a.archived || a.id === entry?.accountId),
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <BudgetPeriod
            input={input}
            change={(i) => {
              setInput(i);
              setConfirmed(false);
            }}
            selectedMonth={data.month}
          />
          <PayPalFields
            data={data}
            value={input.paypal!}
            editing={entry?.id}
            change={(paypal) => setInput({ ...input, paypal })}
          />
          <label>
            Note
            <textarea
              maxLength={2000}
              value={input.note}
              onChange={(e) => setInput({ ...input, note: e.target.value })}
            />
          </label>
          <label className="import-check">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I checked the received bank deposit and its PayPal breakdown.
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {remove ? (
            <div className="delete-confirm">
              <p>
                Remove this bank deposit and fee, and make its receipt amounts
                available again? The received repayments remain recorded.
              </p>
              <button type="button" className="danger" onClick={deleteEntry}>
                Remove cash-out
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setRemove(false)}
              >
                Keep cash-out
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
                  Remove
                </button>
              )}
              <span className="spacer" />
              <button type="button" className="secondary" onClick={dismiss}>
                Cancel
              </button>
              <button type="submit" className="primary">
                {busy ? "Saving..." : "Save cash-out"}
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
