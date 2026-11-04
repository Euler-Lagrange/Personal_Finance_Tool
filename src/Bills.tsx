import { HelpHeading } from "./HelpTip";
import BudgetPeriod, { guardPeriodClose } from "./BudgetPeriod";
import ChargeLines, { lineInputs } from "./ChargeLines";
import { useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  Plus,
  ReceiptText,
  Link2,
  FileText,
} from "lucide-react";
import { command, dollars, money, shortDate, today } from "./api";
import { Modal } from "./EntryDialog";
import { CategoryIcon } from "./CategoryIcon";
import type { Snapshot, EntryInput } from "./types";
import type {
  BillDraft,
  BillPlan,
  BillTemplate,
  BillOccurrence,
  BillCandidate,
} from "./billTypes";
import type { ImportSource } from "./importTypes";
import "./bills.css";

const draft = (p: BillPlan): BillDraft => ({
  ...p,
  amount: dollars(p.amountCents),
  lines: lineInputs(p.lines),
});
const defaults = (data: Snapshot): BillDraft => ({
  name: "",
  merchant: "",
  amount: "",
  categoryId:
    data.categories.find((c) => c.id === "home" && !c.archived)?.id ??
    "uncategorized",
  accountId:
    data.accounts.find((a) => a.id === "checking" && !a.archived)?.id ?? null,
  payer: "jacob",
  splitMode: "shared",
  splitValue: "",
  autopay: false,
});
const status = (b: BillOccurrence) =>
  b.cancelled
    ? "Cancelled"
    : b.remainingCents === 0
      ? b.actualCents === null
        ? "Verify total"
        : b.paidCents === 0
          ? "No amount due"
          : "Paid"
      : b.paidCents > 0
        ? "Part paid"
        : b.dueDate < today()
          ? "Overdue"
          : "Upcoming";

export function BillOverview({
  data,
  open,
}: {
  data: Snapshot;
  open: () => void;
}) {
  const [bills, setBills] = useState<BillOccurrence[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    command<BillOccurrence[]>("bill_month", {
      workspace: data.workspace,
      month: data.month,
    })
      .then((r) => {
        if (alive) {
          setBills(r ?? []);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [data.workspace, data.month, data.entries]);
  const outstanding = bills.filter(
    (b) => !b.cancelled && (b.remainingCents > 0 || b.actualCents === null),
  );
  return (
    <section className="panel bill-overview">
      <div className="panel-heading">
        <div>
          <HelpHeading topic="bills">
            <h2>Bills this month</h2>
          </HelpHeading>
          <p>
            {outstanding.length} open or awaiting confirmation ·{" "}
            {money(outstanding.reduce((sum, b) => sum + b.remainingCents, 0))}{" "}
            remaining
          </p>
        </div>
        <button className="text-button" onClick={open}>
          View bills
        </button>
      </div>
      {error ? (
        <p className="error">Bills could not load. {error}</p>
      ) : (
        outstanding.slice(0, 3).map((b) => (
          <button className="bill-glance" key={b.id} onClick={open}>
            <span>
              {b.plan.name}
              <small>
                {shortDate(b.dueDate)} · {status(b)}
                {b.actualCents === null ? " · Estimated" : ""}
              </small>
            </span>
            <strong>{money(b.remainingCents)}</strong>
          </button>
        ))
      )}
      {!error && !outstanding.length && (
        <p className="bill-empty-note">
          {bills.length
            ? "No outstanding bills in this month."
            : "Add recurring bills to track due dates, payments, and amount changes."}
        </p>
      )}
    </section>
  );
}
export default function Bills({
  data,
  saved,
}: {
  data: Snapshot;
  saved: (message: string) => Promise<void>;
}) {
  const [bills, setBills] = useState<BillOccurrence[]>([]),
    [templates, setTemplates] = useState<BillTemplate[]>([]),
    [tab, setTab] = useState("due"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState<BillTemplate | "new" | null>(null),
    [selected, setSelected] = useState<BillOccurrence | null>(null);
  const generation = useRef(0);
  async function load() {
    const token = ++generation.current;
    const [b, t] = await Promise.all([
      command<BillOccurrence[]>("bill_month", {
        workspace: data.workspace,
        month: data.month,
      }),
      command<BillTemplate[]>("list_bill_templates", {
        workspace: data.workspace,
      }),
    ]);
    if (token === generation.current) {
      setBills(b ?? []);
      setTemplates(t ?? []);
      setError("");
    }
  }
  useEffect(() => {
    let alive = true;
    setLoading(true);
    load()
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      ++generation.current;
    };
  }, [data.workspace, data.month]);
  async function changed(message: string) {
    setTemplate(null);
    setSelected(null);
    try {
      await load();
    } catch (e) {
      setError(
        `Your change was saved, but bills could not reload. ${String(e)}`,
      );
    }
    await saved(message);
  }
  const active = bills.filter((b) => !b.cancelled),
    remaining = active.reduce((n, b) => n + b.remainingCents, 0),
    paid = active.reduce((n, b) => n + b.paidCents, 0);
  const changes = active.filter(
    (b) =>
      b.actualCents !== null &&
      (b.actualCents !== b.plan.amountCents ||
        (b.previousCents !== null && b.actualCents !== b.previousCents)),
  );
  return (
    <div className="bills-view">
      <div className="summary-strip">
        <div>
          <span>Remaining due</span>
          <strong>{money(remaining)}</strong>
        </div>
        <div>
          <span>Payments linked</span>
          <strong>{money(paid)}</strong>
        </div>
        <div>
          <span>Amount changes</span>
          <strong>{changes.length}</strong>
        </div>
        <p>
          Full bill amounts, including Chelsea’s share.
          <br />
          Estimates stay labeled until the actual bill is confirmed.
        </p>
      </div>
      <div className="bills-toolbar">
        <div role="tablist" aria-label="Bill views">
          {[
            ["due", "This month"],
            ["changed", "Changed amounts"],
            ["schedules", "Schedules"],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="primary" onClick={() => setTemplate("new")}>
          <Plus size={16} />
          New bill
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => void load().catch((e) => setError(String(e)))}
          >
            Reload bills
          </button>
        </p>
      )}
      {loading ? (
        <p className="bill-empty-note">Loading bills…</p>
      ) : tab === "schedules" ? (
        <section className="panel">
          {templates.length ? (
            templates.map((t) => (
              <button
                className="bill-glance"
                key={t.id}
                onClick={() => setTemplate(t)}
              >
                <CalendarClock size={20} />
                <span>
                  {t.plan.name}
                  <small>
                    Every {t.everyMonths} month{t.everyMonths === 1 ? "" : "s"}{" "}
                    · first due {t.firstDue}
                    {t.archived ? " · Ended" : ""}
                    {t.endDate ? ` · through ${t.endDate}` : ""}
                  </small>
                </span>
                <strong>{money(t.plan.amountCents)}</strong>
              </button>
            ))
          ) : (
            <Empty />
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>
                {tab === "changed"
                  ? "Bills with amount changes"
                  : "Scheduled bills"}
              </h2>
              <p>
                Autopay is a reminder; linked transactions establish payment.
              </p>
            </div>
            <ReceiptText size={22} />
          </div>
          {(tab === "changed" ? changes : bills).length ? (
            <div className="bill-list">
              {(tab === "changed" ? changes : bills).map((b) => (
                <button
                  className={`bill-card ${b.cancelled ? "cancelled" : ""}`}
                  key={b.id}
                  onClick={() => setSelected(b)}
                >
                  <span className="bill-category">
                    <CategoryIcon
                      category={data.categories.find(
                        (c) => c.id === b.plan.categoryId,
                      )}
                      size={22}
                    />
                  </span>
                  <span className="bill-main">
                    <strong>{b.plan.name}</strong>
                    <small>
                      Due {shortDate(b.dueDate)} ·{" "}
                      {b.plan.payer === "jacob" ? "Jacob pays" : "Chelsea pays"}
                      {b.plan.autopay ? " · Autopay" : ""}
                    </small>
                    <span
                      className={`bill-status ${status(b) === "Overdue" ? "over" : ""}`}
                    >
                      {status(b)}
                      {b.actualCents === null ? " · Estimated" : ""}
                    </span>
                    {b.actualCents !== null &&
                      b.actualCents !== b.plan.amountCents && (
                        <small>
                          Expected {money(b.plan.amountCents)} · Actual{" "}
                          {money(b.actualCents)}
                        </small>
                      )}
                    {b.actualCents !== null &&
                      b.previousCents !== null &&
                      b.actualCents !== b.previousCents && (
                        <small>
                          Previous confirmed {money(b.previousCents)} · Change{" "}
                          {money(b.actualCents - b.previousCents)}
                        </small>
                      )}
                  </span>
                  <span className="bill-amount">
                    <strong>{money(b.remainingCents)}</strong>
                    <small>{money(b.paidCents)} paid</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty changed={tab === "changed"} />
          )}
        </section>
      )}
      <div className="soft-note">
        Bills are plans and obligations. Linking a transaction or attaching an
        invoice never adds another expense. Record a payment only when it has
        happened; later imports can link that same transaction.
      </div>
      {template && (
        <ScheduleEditor
          data={data}
          initial={template === "new" ? undefined : template}
          close={() => setTemplate(null)}
          saved={changed}
        />
      )}
      {selected && (
        <BillEditor
          data={data}
          bill={selected}
          close={() => setSelected(null)}
          saved={changed}
        />
      )}
    </div>
  );
}
function Empty({ changed = false }: { changed?: boolean }) {
  return (
    <div className="import-empty">
      <CalendarClock size={30} />
      <h3>{changed ? "No confirmed amount changes" : "No bills here yet"}</h3>
      <p>
        {changed
          ? "Confirm actual bill amounts to compare them with expectations and prior bills."
          : "Add a schedule, or switch months to see an existing bill’s due dates."}
      </p>
    </div>
  );
}

function PlanFields({
  data,
  value,
  set,
}: {
  data: Snapshot;
  value: BillDraft;
  set: (p: BillDraft) => void;
}) {
  const update = <K extends keyof BillDraft>(k: K, v: BillDraft[K]) =>
    set({ ...value, [k]: v });
  return (
    <>
      <div className="form-grid">
        <label>
          Bill name
          <input
            required
            maxLength={100}
            value={value.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </label>
        <label>
          Expected amount ($)
          <input
            required
            inputMode="decimal"
            value={value.amount}
            onChange={(e) => update("amount", e.target.value)}
          />
        </label>
      </div>
      <label>
        Payment treatment
        <select
          value={value.paymentKind ?? "expense"}
          onChange={(e) =>
            update("paymentKind", e.target.value as BillDraft["paymentKind"])
          }
        >
          <option value="expense">Purchase or service</option>
          <option value="debt_payment">Loan/debt payment</option>
        </select>
        <small>
          Loan payments use the budget but are reported separately from
          purchases. Credit card payments belong in Transfers.
        </small>
      </label>
      <label>
        Merchant phrase for suggestions
        <input
          maxLength={200}
          placeholder="For example, electric utility"
          value={value.merchant}
          onChange={(e) => update("merchant", e.target.value)}
        />
        <small>Helps find payments; a match still needs confirmation.</small>
      </label>
      <div className="form-grid">
        <label>
          Who normally pays?
          <select
            value={value.payer}
            onChange={(e) =>
              set({
                ...value,
                payer: e.target.value as "jacob" | "chelsea",
                accountId:
                  e.target.value === "chelsea" ? null : value.accountId,
              })
            }
          >
            <option value="jacob">Jacob</option>
            <option value="chelsea">Chelsea</option>
          </select>
        </label>
        <label>
          Category
          <select
            required
            disabled={!!value.lines?.length}
            value={value.categoryId}
            onChange={(e) => update("categoryId", e.target.value)}
          >
            <option value="">Choose category</option>
            {data.categories
              .filter((c) => !c.archived || c.id === value.categoryId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? " (archived)" : ""}
                </option>
              ))}
          </select>
        </label>
      </div>
      {value.payer === "jacob" && (
        <label>
          Usual account
          <select
            value={value.accountId ?? ""}
            onChange={(e) => update("accountId", e.target.value || null)}
          >
            <option value="">Choose when recording payment</option>
            {data.accounts
              .filter((a) => !a.archived || a.id === value.accountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.archived ? " (archived)" : ""}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        Default sharing
        <select
          value={value.splitMode}
          onChange={(e) => update("splitMode", e.target.value)}
        >
          <option value="shared">Jacob 70% / Chelsea 30%</option>
          <option value="personal">Jacob 100%</option>
          <option value="equal">Equal 50 / 50</option>
          <option value="chelsea">Chelsea 100%</option>
          <option value="percent">Custom Jacob percentage</option>
          <option value="exact">Exact Jacob amount</option>
        </select>
      </label>
      {["percent", "exact"].includes(value.splitMode) && (
        <label>
          {value.splitMode === "percent"
            ? "Jacob percentage"
            : "Jacob amount ($)"}
          <input
            required
            inputMode="decimal"
            value={value.splitValue}
            onChange={(e) => update("splitValue", e.target.value)}
          />
        </label>
      )}
      <ChargeLines
        value={value}
        categories={data.categories}
        change={(lines) =>
          set({
            ...value,
            lines,
            categoryId: lines[0]?.categoryId ?? value.categoryId,
          })
        }
      />
      <label className="import-check">
        <input
          type="checkbox"
          checked={value.autopay}
          onChange={(e) => update("autopay", e.target.checked)}
        />
        Autopay is enabled with the biller
      </label>
    </>
  );
}
function ScheduleEditor({
  data,
  initial,
  close,
  saved,
}: {
  data: Snapshot;
  initial?: BillTemplate;
  close: () => void;
  saved: (m: string) => Promise<void>;
}) {
  const [value, set] = useState(() => ({
    id: initial?.id ?? crypto.randomUUID(),
    revision: initial?.revision ?? 0,
    firstDue: initial?.firstDue ?? `${data.month}-01`,
    everyMonths: initial?.everyMonths ?? 1,
    endDate: initial?.endDate ?? null,
    archived: initial?.archived ?? false,
    plan: initial ? draft(initial.plan) : defaults(data),
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await command("save_bill_template", {
        workspace: data.workspace,
        input: value,
      });
      await saved("Bill schedule saved.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? "Edit bill schedule" : "New recurring bill"}
      onClose={close}
      busy={busy}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <p className="form-intro">
            Monthly, quarterly, annual, or a custom number of months. A date
            such as the 31st uses the last day in shorter months.
          </p>
          <PlanFields
            data={data}
            value={value.plan}
            set={(plan) => set({ ...value, plan })}
          />
          <div className="form-grid">
            <label>
              First due date
              <input
                required
                type="date"
                value={value.firstDue}
                onChange={(e) => set({ ...value, firstDue: e.target.value })}
              />
            </label>
            <label>
              Repeat every (months)
              <input
                required
                type="number"
                min={1}
                max={60}
                value={value.everyMonths}
                onChange={(e) =>
                  set({ ...value, everyMonths: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label>
            Last due date (optional)
            <input
              type="date"
              value={value.endDate ?? ""}
              onChange={(e) =>
                set({ ...value, endDate: e.target.value || null })
              }
            />
          </label>
          {initial && (
            <label className="import-check">
              <input
                type="checkbox"
                checked={value.archived}
                onChange={(e) => set({ ...value, archived: e.target.checked })}
              />
              End this schedule
            </label>
          )}
          <p className="form-intro">
            Schedule changes apply to months not yet prepared. Existing bills
            retain their amounts and splits; edit or cancel those bills
            individually. Ending a schedule keeps its history.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary">
              {busy ? "Saving…" : "Save schedule"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function BillEditor({
  data,
  bill,
  close,
  saved,
}: {
  data: Snapshot;
  bill: BillOccurrence;
  close: () => void;
  saved: (m: string) => Promise<void>;
}) {
  const [mode, setMode] = useState("details"),
    [plan, setPlan] = useState(draft(bill.plan)),
    [dueDate, setDue] = useState(bill.dueDate),
    [actual, setActual] = useState(
      bill.actualCents === null ? "" : dollars(bill.actualCents),
    ),
    [note, setNote] = useState(bill.note),
    [cancelled, setCancelled] = useState(bill.cancelled);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sources, setSources] = useState<ImportSource[]>([]),
    [source, setSource] = useState("");
  function requireSaved() {
    const changed =
      actual !== (bill.actualCents === null ? "" : dollars(bill.actualCents)) ||
      dueDate !== bill.dueDate ||
      note !== bill.note ||
      cancelled !== bill.cancelled ||
      JSON.stringify(plan) !== JSON.stringify(draft(bill.plan));
    if (changed)
      setError("Save your bill changes before changing payments or evidence.");
    return !changed;
  }
  useEffect(() => {
    let alive = true;
    command<ImportSource[]>("list_imports", { workspace: data.workspace })
      .then((r) => {
        if (alive) setSources(r ?? []);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [data.workspace]);
  async function mutate(
    cmd: string,
    args: Record<string, unknown>,
    message: string,
  ) {
    if (cmd !== "save_bill_occurrence" && !requireSaved()) return;
    setBusy(true);
    setError("");
    try {
      await command(cmd, { workspace: data.workspace, ...args });
      await saved(message);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (mode === "payment")
    return (
      <PaymentEditor
        data={data}
        bill={bill}
        close={() => setMode("details")}
        saved={saved}
      />
    );
  return (
    <Modal title={bill.plan.name} onClose={close} busy={busy}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(
            "save_bill_occurrence",
            {
              input: {
                id: bill.id,
                revision: bill.revision,
                dueDate,
                actualAmount: actual || null,
                cancelled,
                note,
                plan,
              },
            },
            "Bill updated.",
          );
        }}
      >
        <fieldset disabled={busy}>
          <div className="bill-detail-summary">
            <span>{status(bill)}</span>
            <strong>{money(bill.remainingCents)} remaining</strong>
            <small>
              {money(bill.paidCents)} linked ·{" "}
              {bill.actualCents === null
                ? "Total is still estimated"
                : "Actual amount confirmed"}
            </small>
          </div>
          <div className="form-grid">
            <label>
              Due date
              <input
                required
                type="date"
                value={dueDate}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <label>
              Actual amount due ($)
              <input
                inputMode="decimal"
                placeholder="Leave blank while estimated"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
              />
            </label>
          </div>
          <details className="bill-plan-details">
            <summary>Expected amount, category & sharing</summary>
            <PlanFields data={data} value={plan} set={setPlan} />
          </details>
          <label>
            Bill notes
            <textarea
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className="import-check">
            <input
              type="checkbox"
              checked={cancelled}
              onChange={(e) => setCancelled(e.target.checked)}
            />
            Cancel this occurrence
          </label>
          <section className="bill-links">
            <HelpHeading topic="billPayments">
              <h3>Payments</h3>
            </HelpHeading>
            {bill.paidCents > 0 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setActual(dollars(bill.paidCents))}
              >
                Use paid total as actual bill amount
              </button>
            )}
            <p>
              Linking keeps the transaction’s existing category and split.
              Unlink before changing its financial fields. Refunds change
              spending; they do not automatically reopen an obligation.
            </p>
            {bill.payments.map((p) => (
              <div key={p.id}>
                <span>
                  {p.description}
                  <small>
                    {p.date} · {money(p.amountCents)}
                  </small>
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void mutate(
                      "unlink_bill_payment",
                      { id: bill.id, revision: bill.revision, payment: p.id },
                      "Payment unlinked. The transaction is unchanged.",
                    )
                  }
                >
                  Unlink payment
                </button>
              </div>
            ))}
            {!bill.cancelled && bill.remainingCents > 0 && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (!requireSaved()) return;
                  setMode("payment");
                }}
              >
                <Link2 size={16} />
                Link or record payment
              </button>
            )}
          </section>
          <section className="bill-links">
            <HelpHeading topic="billEvidence">
              <h3>Invoice evidence</h3>
            </HelpHeading>
            <p>
              Add documents in Imports first. Attaching them here does not
              create spending.
            </p>
            {bill.evidence.map((s) => (
              <div key={s.id}>
                <span>
                  <FileText size={14} />
                  {s.name}
                </span>
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    void mutate(
                      "bill_evidence",
                      {
                        id: bill.id,
                        revision: bill.revision,
                        source: s.id,
                        remove: true,
                      },
                      "Evidence detached; source retained.",
                    )
                  }
                >
                  Detach
                </button>
              </div>
            ))}
            <label>
              Source document
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">Choose an imported source</option>
                {sources
                  .filter((s) => !bill.evidence.some((e) => e.id === s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              disabled={!source}
              onClick={() =>
                void mutate(
                  "bill_evidence",
                  {
                    id: bill.id,
                    revision: bill.revision,
                    source,
                    remove: false,
                  },
                  "Invoice attached. Spending is unchanged.",
                )
              }
            >
              Attach evidence
            </button>
          </section>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={close}>
              Close
            </button>
            <button className="primary">
              {busy ? "Saving…" : "Save bill"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function PaymentEditor({
  data,
  bill,
  close,
  saved,
}: {
  data: Snapshot;
  bill: BillOccurrence;
  close: () => void;
  saved: (m: string) => Promise<void>;
}) {
  const [mode, setMode] = useState("link"),
    [candidates, setCandidates] = useState<BillCandidate[]>([]),
    [all, setAll] = useState(false),
    [search, setSearch] = useState(""),
    [event, setEvent] = useState(""),
    [amount, setAmount] = useState(dollars(bill.remainingCents)),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [input, setInput] = useState<EntryInput>(() => ({
    id: crypto.randomUUID(),
    revision: 0,
    kind: bill.plan.paymentKind ?? "expense",
    date: today(),
    description: bill.plan.name,
    amount: dollars(bill.remainingCents),
    lines: lineInputs(bill.plan.lines),
    payer: bill.plan.payer,
    categoryId: bill.plan.categoryId,
    accountId: bill.plan.accountId,
    destinationAccountId: null,
    originalEventId: null,
    splitMode: bill.plan.splitMode,
    splitValue: bill.plan.splitValue,
    note: `Payment for ${bill.plan.name}, due ${bill.dueDate}`,
  }));
  const requestClose = guardPeriodClose(input, undefined, close);
  const attempt = useRef<{ key: string; operation: string } | null>(null),
    linkId = useRef(crypto.randomUUID());
  useEffect(() => {
    let alive = true;
    setError("");
    command<BillCandidate[]>("bill_candidates", {
      workspace: data.workspace,
      id: bill.id,
      all,
    })
      .then((r) => {
        if (alive) setCandidates(r ?? []);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [data.workspace, bill.id, all]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "link") {
        const candidate = candidates.find((c) => c.id === event);
        if (!candidate) throw "Choose the existing expense.";
        await command("link_bill_payment", {
          workspace: data.workspace,
          input: {
            id: linkId.current,
            occurrenceId: bill.id,
            revision: bill.revision,
            eventId: event,
            eventRevision: candidate.revision,
            amount,
          },
        });
      } else {
        const key = JSON.stringify(input);
        if (attempt.current?.key !== key)
          attempt.current = { key, operation: crypto.randomUUID() };
        await command("record_bill_payment", {
          workspace: data.workspace,
          id: bill.id,
          revision: bill.revision,
          operation: attempt.current.operation,
          input,
        });
      }
      await saved(
        mode === "link"
          ? "Existing transaction linked. No new spending added."
          : "Payment recorded and linked to the bill.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Payment · ${bill.plan.name}`}
      onClose={requestClose}
      busy={busy}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <p className="form-intro">
            {money(bill.remainingCents)} remains due. A partial payment keeps
            the bill open. Use an existing transaction if you already entered or
            imported this payment.
          </p>
          <label>
            Payment method
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="link">Link an existing expense</option>
              <option value="new">Record a payment that has happened</option>
            </select>
          </label>
          {mode === "link" ? (
            <>
              <label>
                Find payment
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search description or date"
                />
              </label>
              <label className="import-check">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(e) => setAll(e.target.checked)}
                />
                Include dates more than 45 days from the due date
              </label>
              <label>
                Existing expense
                <select
                  required
                  value={event}
                  onChange={(e) => {
                    setEvent(e.target.value);
                    const c = candidates.find((c) => c.id === e.target.value);
                    if (c)
                      setAmount(
                        dollars(
                          Math.min(c.availableCents, bill.remainingCents),
                        ),
                      );
                  }}
                >
                  <option value="">Choose the actual payment</option>
                  {candidates
                    .filter(
                      (c) =>
                        c.id === event ||
                        `${c.date} ${c.description}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.suggested ? "Suggested · " : ""}
                        {c.date} · {c.description} · {money(c.availableCents)}{" "}
                        available
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Amount allocated to this bill ($)
                <input
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <p className="form-intro">
                Allocate only this bill’s part of a combined payment. The
                remaining amount can be linked to another bill.
              </p>
            </>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  Payment date
                  <input
                    required
                    type="date"
                    max={today()}
                    value={input.date}
                    onChange={(e) =>
                      setInput({ ...input, date: e.target.value })
                    }
                  />
                </label>
                <label>
                  Payment amount ($)
                  <input
                    required
                    inputMode="decimal"
                    value={input.amount}
                    onChange={(e) =>
                      setInput({ ...input, amount: e.target.value })
                    }
                  />
                </label>
              </div>
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
              {input.payer === "jacob" && (
                <label>
                  Paid from
                  <select
                    required
                    value={input.accountId ?? ""}
                    onChange={(e) =>
                      setInput({ ...input, accountId: e.target.value })
                    }
                  >
                    <option value="">Choose account</option>
                    {data.accounts
                      .filter((a) => !a.archived)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                Payment treatment
                <select
                  value={input.kind}
                  onChange={(e) =>
                    setInput({
                      ...input,
                      kind: e.target.value as EntryInput["kind"],
                    })
                  }
                >
                  <option value="expense">Purchase or service</option>
                  <option value="debt_payment">Loan/debt payment</option>
                </select>
              </label>
              <label>
                Payment sharing
                <select
                  value={input.splitMode}
                  onChange={(e) =>
                    setInput({ ...input, splitMode: e.target.value })
                  }
                >
                  <option value="shared">Jacob 70% / Chelsea 30%</option>
                  <option value="personal">Jacob 100%</option>
                  <option value="equal">Equal 50 / 50</option>
                  <option value="chelsea">Chelsea 100%</option>
                  <option value="percent">Custom Jacob percentage</option>
                  <option value="exact">Exact Jacob amount</option>
                </select>
              </label>
              {["percent", "exact"].includes(input.splitMode) && (
                <label>
                  {input.splitMode === "percent"
                    ? "Jacob percentage"
                    : "Jacob amount ($)"}
                  <input
                    required
                    value={input.splitValue}
                    onChange={(e) =>
                      setInput({ ...input, splitValue: e.target.value })
                    }
                  />
                </label>
              )}
              <BudgetPeriod
                input={input}
                change={(i) => {
                  setInput(i);
                  setConfirmed(false);
                }}
                selectedMonth={data.month}
              />
              <ChargeLines
                value={input}
                categories={data.categories}
                change={(lines) =>
                  setInput({
                    ...input,
                    lines,
                    categoryId: lines[0]?.categoryId ?? input.categoryId,
                  })
                }
              />
              <p className="form-intro">
                This creates one payment using the treatment, category and
                shares shown here. For a partial or changed bill, adjust the
                charge lines to the amount actually paid. An eventual card
                payment is recorded as a transfer.
              </p>
            </>
          )}
          <label className="import-check">
            <input
              required
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {mode === "link"
              ? "I confirm this transaction paid this bill."
              : "This payment happened and has not already been entered."}
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="secondary" type="button" onClick={requestClose}>
              Back to bill
            </button>
            <button className="primary" disabled={!confirmed}>
              {busy
                ? "Saving…"
                : mode === "link"
                  ? "Link payment"
                  : "Record payment"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
