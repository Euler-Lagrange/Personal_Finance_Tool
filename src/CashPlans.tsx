import { HelpHeading } from "./HelpTip";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { command, money, today } from "./api";
import { Modal } from "./EntryDialog";
import BudgetPeriod from "./BudgetPeriod";
import type { EntryInput, Snapshot } from "./types";
import "./cashPlans.css";

interface Plan {
  name: string;
  kind: "income" | "transfer" | "settlement" | "paypal_cashout";
  amount: string;
  accountId: string | null;
  destinationAccountId: string | null;
  payer: string;
}
interface Schedule {
  id: string;
  revision: number;
  anchor: string;
  cadence: string;
  secondDay: number | null;
  endDate: string | null;
  archived: boolean;
  plan: Plan;
}
interface Actual {
  id: string;
  revision: number;
  date: string;
  description: string;
  amountCents: number;
  suggested: boolean;
}
interface Occurrence {
  payrollManaged?: boolean;
  id: string;
  scheduleId: string;
  slot: string;
  scheduledDate: string;
  dueDate: string;
  revision: number;
  plan: Plan;
  cancelled: boolean;
  note: string;
  actual: Actual | null;
}
interface View {
  schedules: Schedule[];
  occurrences: Occurrence[];
}
type Props = {
  data: Snapshot;
  close: () => void;
  saved: (m: string) => Promise<void>;
};
const kindName = (kind: Plan["kind"]) =>
  kind === "income"
    ? "Paycheck / income"
    : kind === "transfer"
      ? "Bank transfer"
      : kind === "paypal_cashout"
        ? "PayPal cash-out"
        : "Household settlement";
const cadenceName: Record<string, string> = {
  once: "One time",
  weekly: "Every 7 days",
  biweekly: "Every 14 days",
  monthly: "Monthly",
  twice_monthly: "Twice monthly",
};
function fresh(data: Snapshot): Plan {
  return {
    name: "",
    kind: "income",
    amount: "",
    accountId:
      data.accounts.find((a) => !a.archived && a.kind === "checking")?.id ??
      null,
    destinationAccountId: null,
    payer: "jacob",
  };
}
function accountLabel(data: Snapshot, id: string | null) {
  return id
    ? (data.accounts.find((a) => a.id === id)?.name ?? "Unknown account")
    : "Outside tracked accounts / PayPal";
}
function path(data: Snapshot, p: Plan) {
  return p.kind === "transfer"
    ? `${accountLabel(data, p.accountId)} → ${accountLabel(data, p.destinationAccountId)}`
    : p.kind === "settlement"
      ? `${p.payer === "chelsea" ? "Chelsea pays you" : "You pay Chelsea"} · ${accountLabel(data, p.accountId)}`
      : accountLabel(data, p.accountId);
}
function cents(amount: string) {
  return Math.round(Number(amount) * 100);
}
function useWrite(close: () => void, saved: Props["saved"]) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const running = useRef(false),
    operation = useRef({ key: "", id: "" });
  async function write(
    cmd: string,
    args: Record<string, unknown>,
    message: string,
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const key = JSON.stringify({ cmd, args });
    if (operation.current.key !== key)
      operation.current = { key, id: crypto.randomUUID() };
    try {
      await command(cmd, { ...args, operation: operation.current.id });
    } catch (e) {
      setError(String(e));
      setBusy(false);
      running.current = false;
      return;
    }
    close();
    await saved(message);
  }
  return { busy, error, write };
}
function guarded(dirty: boolean, close: () => void) {
  return () => {
    if (!dirty || window.confirm("Discard these unsaved cash-plan changes?"))
      close();
  };
}
function PlanFields({
  data,
  plan,
  set,
  disabled = false,
}: {
  data: Snapshot;
  plan: Plan;
  set: (p: Plan) => void;
  disabled?: boolean;
}) {
  const banks = data.accounts.filter(
    (a) =>
      a.kind !== "credit" &&
      (!a.archived ||
        a.id === plan.accountId ||
        a.id === plan.destinationAccountId),
  );
  return (
    <fieldset className="cash-plan-fields" disabled={disabled}>
      <label>
        Name
        <input
          required
          maxLength={100}
          value={plan.name}
          onChange={(e) => set({ ...plan, name: e.target.value })}
        />
      </label>
      <label>
        Plan type
        <select
          value={plan.kind}
          onChange={(e) => {
            const kind = e.target.value as Plan["kind"];
            set({
              ...plan,
              kind,
              payer: "jacob",
              accountId:
                plan.accountId ?? banks.find((a) => !a.archived)?.id ?? null,
              destinationAccountId:
                kind === "transfer"
                  ? (banks.find((a) => !a.archived && a.id !== plan.accountId)
                      ?.id ?? null)
                  : null,
            });
          }}
        >
          <option value="income">Paycheck / income</option>
          <option value="transfer">Bank transfer / savings</option>
          <option value="settlement">Household settlement</option>
          <option value="paypal_cashout">PayPal cash-out (net deposit)</option>
        </select>
      </label>
      <label>
        Expected amount
        <input
          required
          inputMode="decimal"
          value={plan.amount}
          onChange={(e) => set({ ...plan, amount: e.target.value })}
        />
      </label>
      <label>
        {plan.kind === "transfer"
          ? "From account"
          : plan.kind === "income" || plan.kind === "paypal_cashout"
            ? "Deposit account"
            : "Settlement account"}
        <select
          required={plan.kind !== "settlement"}
          value={plan.accountId ?? ""}
          onChange={(e) => set({ ...plan, accountId: e.target.value || null })}
        >
          <option value="">
            {plan.kind === "settlement"
              ? "Outside tracked accounts / PayPal"
              : "Choose a bank account"}
          </option>
          {banks.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </label>
      {plan.kind === "transfer" && (
        <label>
          To account
          <select
            required
            value={plan.destinationAccountId ?? ""}
            onChange={(e) =>
              set({ ...plan, destinationAccountId: e.target.value || null })
            }
          >
            <option value="">Choose another bank account</option>
            {banks
              .filter((a) => a.id !== plan.accountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.archived ? " (archived)" : ""}
                </option>
              ))}
          </select>
        </label>
      )}
      {plan.kind === "settlement" && (
        <label>
          Who will pay?
          <select
            value={plan.payer}
            onChange={(e) => set({ ...plan, payer: e.target.value })}
          >
            <option value="jacob">You pay Chelsea</option>
            <option value="chelsea">Chelsea pays you</option>
          </select>
        </label>
      )}
    </fieldset>
  );
}
export default function CashPlans({
  data,
  saved,
}: {
  data: Snapshot;
  saved: Props["saved"];
}) {
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [schedule, setSchedule] = useState<Schedule | null | undefined>(),
    [edit, setEdit] = useState<Occurrence | null>(null),
    [matching, setMatching] = useState<{
      o: Occurrence;
      record: boolean;
    } | null>(null);
  useEffect(() => {
    let active = true;
    setView(null);
    setError("");
    command<View>("cash_month", {
      workspace: data.workspace,
      month: data.month,
    })
      .then((v) => {
        if (active) setView(v);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [data, reload]);
  return (
    <div className="cash-plans">
      <div className="cash-intro">
        <p>
          Plan paychecks, savings transfers and settlements independently.
          Expected money does not change your balances or income until a real
          transaction is recorded or matched.
        </p>
        <button className="primary" onClick={() => setSchedule(null)}>
          <Plus size={17} />
          Add cash plan
        </button>
      </div>
      {error ? (
        <div role="alert" className="form-error">
          {error}
          <button
            className="text-button"
            onClick={() => setReload((n) => n + 1)}
          >
            Retry cash plans
          </button>
        </div>
      ) : !view ? (
        <p role="status">Loading cash plans...</p>
      ) : (
        <>
          <section className="panel cash-events" aria-label="Planned events">
            <div className="panel-heading">
              <div>
                <HelpHeading topic="expectedCash">
                  <h2>Expected this month</h2>
                </HelpHeading>
                <p>
                  Match each completed event once. A different actual amount is
                  shown as a variance.
                </p>
              </div>
              <CalendarDays size={22} />
            </div>
            {!view.occurrences.length ? (
              <p className="cash-empty">
                No planned events for this month. Add a schedule or a one-time
                plan.
              </p>
            ) : (
              view.occurrences.map((o) => (
                <article
                  className={`cash-event ${o.cancelled ? "cancelled" : ""}`}
                  key={o.id}
                >
                  <div className="cash-event-date">
                    <strong>{o.dueDate}</strong>
                    <span>
                      {o.payrollManaged
                        ? "Managed by Pay & hours"
                        : o.actual
                          ? "Matched"
                          : o.cancelled
                            ? "Cancelled"
                            : o.dueDate < today()
                              ? "Past expected date"
                              : "Expected"}
                    </span>
                  </div>
                  <div className="cash-event-info">
                    <h3>{o.plan.name}</h3>
                    <p>
                      {kindName(o.plan.kind)} · {path(data, o.plan)}
                    </p>
                    {o.dueDate !== o.scheduledDate && (
                      <small>Original scheduled date: {o.scheduledDate}</small>
                    )}
                    {o.note && <small>{o.note}</small>}
                    {o.actual && (
                      <small>
                        Actual {o.actual.date} · {o.actual.description} ·{" "}
                        {money(o.actual.amountCents)} · Difference{" "}
                        {money(o.actual.amountCents - cents(o.plan.amount))}
                      </small>
                    )}
                  </div>
                  <div className="cash-event-actions">
                    <strong>
                      {money(cents(o.plan.amount))}
                      <small>expected</small>
                    </strong>
                    <button
                      className="text-button"
                      disabled={o.payrollManaged}
                      onClick={() => setEdit(o)}
                      aria-label={`Edit ${o.plan.name} on ${o.dueDate}`}
                    >
                      Edit plan
                    </button>
                    {!o.payrollManaged && !o.cancelled && !o.actual && (
                      <>
                        <button
                          className="secondary"
                          onClick={() => setMatching({ o, record: false })}
                        >
                          Match transaction
                        </button>
                        {o.plan.kind === "paypal_cashout" ? (
                          <small>
                            Record and reconcile the deposit in Shared expenses,
                            then match it here.
                          </small>
                        ) : (
                          <button
                            className="text-button"
                            onClick={() => setMatching({ o, record: true })}
                          >
                            Record actual
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              ))
            )}
          </section>
          <section className="panel cash-schedules" aria-label="Cash schedules">
            <div className="panel-heading">
              <div>
                <h2>Schedules</h2>
                <p>
                  Saved dated events keep their own plan. End or archive a
                  schedule to stop future expectations.
                </p>
              </div>
            </div>
            {!view.schedules.length ? (
              <p className="cash-empty">
                Pay cadence and expected net pay are setup choices; no amount is
                guessed.
              </p>
            ) : (
              view.schedules.map((s) => (
                <div className="cash-schedule" key={s.id}>
                  <div>
                    <h3>
                      {s.plan.name}
                      {s.archived ? " · Archived" : ""}
                    </h3>
                    <p>
                      {cadenceName[s.cadence]} · From {s.anchor}
                      {s.secondDay ? ` · Second day ${s.secondDay}` : ""}
                      {s.endDate ? ` · Through ${s.endDate}` : ""}
                    </p>
                    <small>{path(data, s.plan)}</small>
                  </div>
                  <strong>{money(cents(s.plan.amount))}</strong>
                  <button
                    className="secondary"
                    onClick={() => setSchedule(s)}
                    aria-label={`Edit schedule ${s.plan.name}`}
                  >
                    Edit schedule
                  </button>
                </div>
              ))
            )}
          </section>
        </>
      )}
      {schedule !== undefined && (
        <ScheduleEditor
          key={schedule?.id ?? "new"}
          data={data}
          value={schedule}
          close={() => setSchedule(undefined)}
          saved={saved}
        />
      )}
      {edit && (
        <OccurrenceEditor
          key={edit.id}
          data={data}
          value={edit}
          close={() => setEdit(null)}
          saved={saved}
        />
      )}
      {matching && (
        <ActualEditor
          key={`${matching.o.id}:${matching.record}`}
          data={data}
          value={matching.o}
          record={matching.record}
          close={() => setMatching(null)}
          saved={saved}
        />
      )}
    </div>
  );
}
function ScheduleEditor({
  data,
  value,
  close,
  saved,
}: Props & { value: Schedule | null }) {
  const [initial] = useState<Schedule>(
      () =>
        value ?? {
          id: crypto.randomUUID(),
          revision: 0,
          anchor: `${data.month}-01`,
          cadence: "biweekly",
          secondDay: null,
          endDate: null,
          archived: false,
          plan: fresh(data),
        },
    ),
    [input, set] = useState(initial);
  const requestClose = guarded(
      JSON.stringify(input) !== JSON.stringify(initial),
      close,
    ),
    { busy, error, write } = useWrite(close, saved);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await write(
      "save_cash_schedule",
      { workspace: data.workspace, input },
      "Cash schedule saved. Expected events do not create transactions.",
    );
  }
  return (
    <Modal
      title={value ? "Edit cash schedule" : "New cash plan"}
      busy={busy}
      onClose={requestClose}
    >
      <form className="cash-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <PlanFields
            data={data}
            plan={input.plan}
            set={(plan) => set({ ...input, plan })}
          />
          <div className="form-grid">
            <label>
              First scheduled date
              <input
                type="date"
                required
                value={input.anchor}
                onChange={(e) => set({ ...input, anchor: e.target.value })}
              />
            </label>
            <label>
              Cadence
              <select
                value={input.cadence}
                onChange={(e) =>
                  set({
                    ...input,
                    cadence: e.target.value,
                    secondDay: e.target.value === "twice_monthly" ? 15 : null,
                  })
                }
              >
                {Object.entries(cadenceName).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {input.cadence === "twice_monthly" && (
              <label>
                Second day of month
                <input
                  type="number"
                  min={1}
                  max={31}
                  required
                  value={input.secondDay ?? ""}
                  onChange={(e) =>
                    set({ ...input, secondDay: Number(e.target.value) })
                  }
                />
              </label>
            )}
            <label>
              End date (optional)
              <input
                type="date"
                value={input.endDate ?? ""}
                onChange={(e) =>
                  set({ ...input, endDate: e.target.value || null })
                }
              />
            </label>
          </div>
          <p className="cash-help">
            Every 14 days follows the anchor date, including three-paycheck
            months. Monthly days beyond a month's end use its last day; two
            clamped dates remain two events. Holiday changes are made on
            individual events.
          </p>
          {value && (
            <>
              <label className="cash-check">
                <input
                  type="checkbox"
                  checked={input.archived}
                  onChange={(e) =>
                    set({ ...input, archived: e.target.checked })
                  }
                />
                Archive schedule
              </label>
              <p className="cash-help">
                Existing dates retain their saved amounts and accounts. Edit
                them individually. Once dates exist, changing cadence requires
                ending this schedule and adding a new one. Ending cancels
                unmatched slots after the end date; archiving cancels unmatched
                events from today onward. Recorded matches remain. Re-enabling
                does not silently restore cancelled events.
              </p>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={requestClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              Save cash plan
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function OccurrenceEditor({
  data,
  value,
  close,
  saved,
}: Props & { value: Occurrence }) {
  const [initial] = useState({
      id: value.id,
      revision: value.revision,
      dueDate: value.dueDate,
      plan: value.plan,
      cancelled: value.cancelled,
      note: value.note,
    }),
    [input, set] = useState(initial);
  const requestClose = guarded(
      JSON.stringify(input) !== JSON.stringify(initial),
      close,
    ),
    { busy, error, write } = useWrite(close, saved);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await write(
      "save_cash_occurrence",
      { workspace: data.workspace, input },
      `Planned event saved for ${input.dueDate}.`,
    );
  }
  return (
    <Modal title="Edit planned event" busy={busy} onClose={requestClose}>
      <form className="cash-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <p className="cash-help">
            Original schedule: {value.scheduledDate}. Changes here affect only
            this event.
          </p>
          <PlanFields
            data={data}
            plan={input.plan}
            set={(plan) => set({ ...input, plan })}
            disabled={!!value.actual}
          />
          <label>
            Expected date
            <input
              type="date"
              required
              disabled={!!value.actual}
              value={input.dueDate}
              onChange={(e) => set({ ...input, dueDate: e.target.value })}
            />
          </label>
          <label className="cash-check">
            <input
              type="checkbox"
              disabled={!!value.actual}
              checked={input.cancelled}
              onChange={(e) => set({ ...input, cancelled: e.target.checked })}
            />
            Cancel this expected event
          </label>
          <label>
            Plan note
            <textarea
              maxLength={2000}
              value={input.note}
              onChange={(e) => set({ ...input, note: e.target.value })}
            />
          </label>
          {value.actual && (
            <div className="cash-match-note">
              <p>
                Matched to {value.actual.description}, {value.actual.date},{" "}
                {money(value.actual.amountCents)}. Unlink before changing the
                expected amount, date or accounts.
              </p>
              {JSON.stringify(input) !== JSON.stringify(initial) && (
                <p>Save or discard the edited note before unlinking.</p>
              )}
              <button
                type="button"
                className="secondary"
                disabled={JSON.stringify(input) !== JSON.stringify(initial)}
                onClick={() => {
                  if (
                    window.confirm(
                      "Unlink this plan? The recorded transaction will remain unchanged.",
                    )
                  )
                    void write(
                      "unmatch_cash",
                      {
                        workspace: data.workspace,
                        id: value.id,
                        revision: value.revision,
                      },
                      "Plan unlinked. The actual transaction remains recorded.",
                    );
                }}
              >
                Unlink transaction
              </button>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={requestClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              Save planned event
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function ActualEditor({
  data,
  value,
  record,
  close,
  saved,
}: Props & { value: Occurrence; record: boolean }) {
  const [initial] = useState<EntryInput>(() => ({
    id: crypto.randomUUID(),
    revision: 0,
    kind: value.plan.kind,
    date: value.dueDate > today() ? today() : value.dueDate,
    description: value.plan.name,
    amount: value.plan.amount,
    payer: value.plan.payer as EntryInput["payer"],
    categoryId: null,
    accountId: value.plan.accountId,
    destinationAccountId: value.plan.destinationAccountId,
    splitMode: value.plan.kind === "income" ? "personal" : "none",
    splitValue: "",
    note: "",
  }));
  const [entry, setEntry] = useState(initial),
    [candidates, setCandidates] = useState<Actual[] | null>(null),
    [loadError, setLoadError] = useState(""),
    [retry, setRetry] = useState(0),
    [selected, setSelected] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const requestClose = guarded(
      selected !== "" ||
        confirmed ||
        JSON.stringify(entry) !== JSON.stringify(initial),
      close,
    ),
    { busy, error, write } = useWrite(close, saved);
  useEffect(() => {
    if (record) return;
    let active = true;
    setCandidates(null);
    setLoadError("");
    command<Actual[]>("cash_candidates", {
      workspace: data.workspace,
      id: value.id,
    })
      .then((c) => {
        if (active) setCandidates(c);
      })
      .catch((e) => {
        if (active) setLoadError(String(e));
      });
    return () => {
      active = false;
    };
  }, [data.workspace, value.id, record, retry]);
  const candidate = candidates?.find((c) => c.id === selected);
  function update(patch: Partial<EntryInput>) {
    setEntry((e) => ({ ...e, ...patch }));
    setConfirmed(false);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirmed) return;
    if (record)
      await write(
        "record_cash",
        {
          workspace: data.workspace,
          input: { id: value.id, revision: value.revision, entry, confirmed },
        },
        "Actual transaction recorded and matched once.",
      );
    else if (candidate)
      await write(
        "match_cash",
        {
          workspace: data.workspace,
          input: {
            id: value.id,
            revision: value.revision,
            eventId: candidate.id,
            eventRevision: candidate.revision,
            confirmed,
          },
        },
        "Existing transaction matched. No new money recorded.",
      );
  }
  return (
    <Modal
      title={record ? "Record actual cash event" : "Match planned event"}
      busy={busy}
      onClose={requestClose}
    >
      <form className="cash-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <p className="cash-help">
            {value.plan.name} · Expected {money(cents(value.plan.amount))} on{" "}
            {value.dueDate}. {path(data, value.plan)}
          </p>
          {record ? (
            <>
              <p className="cash-help">
                Use this only after the money moved and when the transaction is
                not already recorded. Import and match an existing transaction
                when available.
              </p>
              <div className="form-grid">
                <label>
                  Actual date
                  <input
                    type="date"
                    max={today()}
                    required
                    value={entry.date}
                    onChange={(e) => update({ date: e.target.value })}
                  />
                </label>
                <label>
                  Actual amount
                  <input
                    inputMode="decimal"
                    required
                    value={entry.amount}
                    onChange={(e) => update({ amount: e.target.value })}
                  />
                </label>
              </div>
              <label>
                Description
                <input
                  required
                  maxLength={200}
                  value={entry.description}
                  onChange={(e) => update({ description: e.target.value })}
                />
              </label>
              <label>
                Transaction note
                <textarea
                  maxLength={2000}
                  value={entry.note}
                  onChange={(e) => update({ note: e.target.value })}
                />
              </label>
              <BudgetPeriod
                input={entry}
                selectedMonth={data.month}
                change={(next) => {
                  setEntry(next);
                  setConfirmed(false);
                }}
              />
            </>
          ) : loadError ? (
            <p className="form-error" role="alert">
              {loadError}
              <button
                type="button"
                className="text-button"
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry candidates
              </button>
            </p>
          ) : candidates === null ? (
            <p role="status">Loading matching transactions...</p>
          ) : !candidates.length ? (
            <p>
              No compatible unmatched transactions. Import activity first, or
              {value.plan.kind === "paypal_cashout"
                ? "record and reconcile the cash-out in Shared expenses, then return to match it."
                : "close this dialog and choose Record actual."}
            </p>
          ) : (
            <>
              <label>
                Recorded transaction
                <select
                  required
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Choose the actual transaction</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.date} · {c.description} · {money(c.amountCents)}
                      {c.suggested ? " · Possible match" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="cash-help">
                Same amounts and nearby dates are suggestions, not proof.
                Matching treats the selected transaction as this completed event
                even if its amount differs.
              </p>
              {candidate && (
                <p>
                  Actual {money(candidate.amountCents)} · Difference from plan{" "}
                  {money(candidate.amountCents - cents(value.plan.amount))}
                </p>
              )}
            </>
          )}
          <label className="cash-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!record && !candidate}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {record
              ? "This happened and needs a new transaction"
              : "This is the actual transaction for this planned event"}
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={requestClose}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !confirmed || (!record && !candidate)}
            >
              {record ? "Record and match" : "Match transaction"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
