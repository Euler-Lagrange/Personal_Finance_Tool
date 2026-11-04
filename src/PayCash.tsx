import { useEffect, useRef, useState, type ReactNode } from "react";
import { command, money } from "./api";
import { Modal } from "./EntryDialog";
import { HelpHeading } from "./HelpTip";
import { TaxCheck } from "./PayTax";
import type { Account } from "./types";
import type { PayView } from "./PayHours";
import type { PayPeriod } from "./payTypes";
import type {
  PayCashView,
  PayDeposit,
  PayAnnualView,
  PaidMonth,
} from "./payCashTypes";
const dollars = (c: number) => (c / 100).toFixed(2);
type Props = {
  workspace: string;
  view: PayView;
  accounts: Account[];
  year: number;
  changed: () => void;
};
export default function PayCash({
  workspace,
  view,
  accounts,
  year,
  changed,
}: Props) {
  const [cash, setCash] = useState<PayCashView | null>(null),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0);
  const [edit, setEdit] = useState<{
    kind: "plan" | "deposit" | "finalize";
    period: PayPeriod;
  } | null>(null);
  const [takeover, setTakeover] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setCash(null);
    setError("");
    command<PayCashView>("pay_cash_view", { workspace })
      .then((v) => {
        if (live) setCash(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [workspace, view.revision, epoch]);
  const done = () => {
    setEdit(null);
    setTakeover(null);
    changed();
  };
  const periods = Object.values(view.state.periods ?? {})
    .filter((p) => p.payDate.startsWith(`${year}-`))
    .sort((a, b) => a.payDate.localeCompare(b.payDate));
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <HelpHeading topic="payCash">
              <h2>Expected pay & deposits · {year}</h2>
            </HelpHeading>
            <p>
              Approve one estimate per period, then allocate existing bank
              income. Split deposits stay separate from paycheck facts.
            </p>
          </div>
        </div>
        {error ? (
          <p role="alert" className="form-error">
            {error}{" "}
            <button onClick={() => setEpoch((n) => n + 1)}>
              Retry cash view
            </button>
          </p>
        ) : !cash ? (
          <p>Loading payroll cash…</p>
        ) : (
          <div className="pay-table-scroll">
            <table className="pay-table pay-cash-table">
              <thead>
                <tr>
                  <th>Payday / period</th>
                  <th>Approved net</th>
                  <th>Bank deposits</th>
                  <th>Remaining / variance</th>
                  <th>Timesheet</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => {
                  const c = cash.plans.find((c) => c.plan.periodId === p.id);
                  return (
                    <tr key={p.id}>
                      <th>
                        {p.payDate}
                        <small>{p.name}</small>
                      </th>
                      <td>
                        {c ? money(c.expectedCents) : "Not approved"}
                        <small>
                          {c?.plan.cancelled
                            ? "Cancelled"
                            : c?.plan.complete
                              ? "Deposits complete"
                              : c
                                ? "Expected"
                                : ""}
                          {c?.changed ? " · Prediction/date changed" : ""}
                        </small>
                      </td>
                      <td>{c ? money(c.depositedCents) : "—"}</td>
                      <td>
                        {c ? (
                          <>
                            {money(c.remainingCents)} remaining
                            <small>
                              {money(c.varianceCents)} actual minus approved
                            </small>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {p.id in cash.finalized
                          ? cash.finalized[p.id]
                            ? "Finalized"
                            : "Reviewed inputs changed"
                          : "Open"}
                        <button
                          className="text-button"
                          onClick={() =>
                            setEdit({ kind: "finalize", period: p })
                          }
                        >
                          Review timesheet
                        </button>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setEdit({ kind: "plan", period: p })}
                        >
                          {c ? "Edit expected pay" : "Approve expected pay"}
                        </button>
                        {c && (
                          <button
                            className="text-button"
                            onClick={() =>
                              setEdit({ kind: "deposit", period: p })
                            }
                          >
                            Match deposits
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!periods.length && (
              <p className="pay-footnote">
                Add reviewed periods under Paychecks and select a saved
                prediction before approving expected cash.
              </p>
            )}
          </div>
        )}
      </section>
      {cash && (
        <section className="panel pay-cash-schedules">
          <div className="panel-heading">
            <div>
              <h2>Existing paycheck schedules</h2>
              <p>
                Take over a generic Cash plans schedule from a chosen date. Its
                future slots stop forecasting; recorded income remains
                unchanged.
              </p>
            </div>
          </div>
          <div className="pay-holidays">
            {cash.schedules.map((s) => (
              <div key={s.id}>
                <strong>
                  {s.plan.name}
                  <small>
                    {s.cadence} · {s.archived ? "Archived" : "Active"}
                    {cash.takeovers[s.id]
                      ? ` · Managed from ${cash.takeovers[s.id].fromDate}`
                      : ""}
                  </small>
                </strong>
                <button
                  className="text-button"
                  onClick={() => setTakeover(s.id)}
                >
                  {cash.takeovers[s.id]
                    ? "Review takeover"
                    : "Take over schedule"}
                </button>
              </div>
            ))}
            {!cash.schedules.length && (
              <p>No generic paycheck schedules exist.</p>
            )}
          </div>
        </section>
      )}
      {cash && edit?.kind === "plan" && (
        <PlanEditor
          workspace={workspace}
          view={view}
          cash={cash}
          accounts={accounts}
          period={edit.period}
          close={() => setEdit(null)}
          saved={done}
        />
      )}{" "}
      {cash && edit?.kind === "deposit" && (
        <DepositEditor
          workspace={workspace}
          cash={cash}
          accounts={accounts}
          period={edit.period}
          close={() => setEdit(null)}
          saved={done}
        />
      )}{" "}
      {cash && edit?.kind === "finalize" && (
        <TimesheetEditor
          workspace={workspace}
          cash={cash}
          period={edit.period}
          close={() => setEdit(null)}
          saved={done}
        />
      )}{" "}
      {cash && takeover && (
        <TakeoverEditor
          workspace={workspace}
          cash={cash}
          id={takeover}
          close={() => setTakeover(null)}
          saved={done}
        />
      )}
    </>
  );
}
type SaveProps = {
  workspace: string;
  revision: number;
  title: string;
  close: () => void;
  saved: () => void;
  children: (
    save: (change: unknown) => Promise<void>,
    busy: boolean,
  ) => ReactNode;
};
function SaveDialog({
  workspace,
  revision,
  title,
  close,
  saved,
  children,
}: SaveProps) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  async function save(change: unknown) {
    const signature = JSON.stringify(change);
    if (request.current?.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await command("save_payroll", {
        workspace,
        revision,
        operation: request.current.id,
        change,
      });
      saved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const leave = () => {
    if (!busy && (!dirty || window.confirm("Discard unsaved payroll changes?")))
      close();
  };
  return (
    <Modal title={title} busy={busy} onClose={leave}>
      <div
        className="pay-form"
        onChange={() => setDirty(true)}
        onClickCapture={(e) => {
          if (
            e.target instanceof Element &&
            e.target.closest("[data-changes-draft]")
          )
            setDirty(true);
        }}
      >
        {error && (
          <p role="alert" className="form-error">
            {error} Your draft is retained. Unchanged retries use the same save
            request.
          </p>
        )}
        {children(save, busy)}
        <div className="pay-actions">
          <button className="secondary" disabled={busy} onClick={leave}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
function PlanEditor({
  workspace,
  view,
  cash,
  accounts,
  period,
  close,
  saved,
}: Omit<Props, "year" | "changed"> & {
  cash: PayCashView;
  period: PayPeriod;
  close: () => void;
  saved: () => void;
}) {
  const old = cash.plans.find((p) => p.plan.periodId === period.id)?.plan;
  const choices = Object.values(view.state.forecasts ?? {}).filter(
    (f) => f.input.periodId === period.id && f.netCents !== null,
  );
  const [forecastId, setForecastId] = useState(
    old?.forecastId ?? view.state.selectedForecasts?.[period.id] ?? "",
  );
  const selected = choices.find((f) => f.input.id === forecastId);
  const [targets, setTargets] = useState(
    () =>
      old?.targets.map((t) => ({
        accountId: t.accountId,
        amount: dollars(t.cents),
      })) ?? [
        {
          accountId:
            accounts.find((a) => a.kind === "checking" && !a.archived)?.id ??
            "",
          amount: selected?.netCents == null ? "" : dollars(selected.netCents),
        },
      ],
  );
  const [complete, setComplete] = useState(old?.complete ?? false),
    [cancelled, setCancelled] = useState(old?.cancelled ?? false),
    [note, setNote] = useState(old?.note ?? ""),
    [confirmed, setConfirmed] = useState(false);
  return (
    <SaveDialog
      workspace={workspace}
      revision={cash.revision}
      title={`Expected pay · ${period.payDate}`}
      close={close}
      saved={saved}
    >
      {(save, busy) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              kind: "payCash",
              input: {
                periodId: period.id,
                forecastId,
                targets,
                complete,
                cancelled,
                note,
                duplicatesReviewed: confirmed,
              },
            });
          }}
        >
          <fieldset disabled={busy} onChange={() => setConfirmed(false)}>
            <HelpHeading topic="payCash">
              <h3>{period.name}</h3>
            </HelpHeading>
            <p>
              Destination amounts must equal the saved prediction. New approvals
              use the current selected prediction; existing approvals can keep
              their retained version. Approving applies the current calendar
              payday.
            </p>
            <label htmlFor="cash-pay-prediction">Saved prediction</label>
            <select
              id="cash-pay-prediction"
              required
              value={forecastId}
              onChange={(e) => setForecastId(e.target.value)}
            >
              <option value="">Select a saved prediction</option>
              {choices.map((f) => (
                <option key={f.input.id} value={f.input.id}>
                  {money(f.netCents!)} · {f.input.method}
                  {view.state.selectedForecasts?.[period.id] === f.input.id
                    ? " · Selected"
                    : " · Earlier version"}
                </option>
              ))}
            </select>
            {targets.map((t, i) => (
              <div className="pay-tax-rule" key={i}>
                <label htmlFor={`pay-destination-${i}`}>
                  Destination {i + 1}
                </label>
                <select
                  id={`pay-destination-${i}`}
                  required
                  value={t.accountId}
                  onChange={(e) =>
                    setTargets((v) =>
                      v.map((x, j) =>
                        i === j ? { ...x, accountId: e.target.value } : x,
                      ),
                    )
                  }
                >
                  <option value="">Choose a bank account</option>
                  {accounts
                    .filter(
                      (a) =>
                        a.kind !== "credit" &&
                        (!a.archived ||
                          old?.targets.some((t) => t.accountId === a.id)),
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.archived ? " · Archived" : ""}
                      </option>
                    ))}
                </select>
                <label>
                  Expected deposit {i + 1} ($)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={t.amount}
                    onChange={(e) =>
                      setTargets((v) =>
                        v.map((x, j) =>
                          i === j ? { ...x, amount: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                {targets.length > 1 && (
                  <button
                    type="button"
                    data-changes-draft
                    className="text-button"
                    onClick={() => {
                      setConfirmed(false);
                      setTargets((v) => v.filter((_, j) => j !== i));
                    }}
                  >
                    Remove destination
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              data-changes-draft
              onClick={() => {
                setConfirmed(false);
                setTargets((v) => [...v, { accountId: "", amount: "" }]);
              }}
            >
              Add deposit destination
            </button>
            <TaxCheck
              label="All deposits for this period are reconciled; stop forecasting any remainder"
              value={complete}
              change={setComplete}
            />
            <TaxCheck
              label="Cancel this expected paycheck (recorded income and links remain)"
              value={cancelled}
              change={setCancelled}
            />
            <label>
              Cash plan notes
              <textarea
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <details>
              <summary>
                Review other expected income ({cash.schedules.length} generic
                schedules)
              </summary>
              <ul>
                {cash.schedules.map((s) => (
                  <li key={s.id}>
                    {s.plan.name} · {s.plan.amount} · {s.cadence} ·{" "}
                    {cash.takeovers[s.id]
                      ? `Managed from ${cash.takeovers[s.id].fromDate}`
                      : s.archived
                        ? "Archived"
                        : "Still active; take over if this is the same paycheck"}
                  </li>
                ))}
              </ul>
              <p>
                Use Existing paycheck schedules to take over matching generic
                pay. Leave unrelated income schedules active.
              </p>
            </details>
          </fieldset>
          <TaxCheck
            label="I reviewed other income plans and these amounts will not forecast the same paycheck twice"
            value={confirmed}
            change={setConfirmed}
          />
          <button className="primary" disabled={busy || !confirmed}>
            {busy ? "Saving…" : "Approve expected pay"}
          </button>
          {old && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Remove this expected-pay plan? Unlink deposits first. Recorded income remains.",
                  )
                )
                  void save({ kind: "removePayCash", periodId: period.id });
              }}
            >
              Remove expected pay
            </button>
          )}
        </form>
      )}
    </SaveDialog>
  );
}
function DepositEditor({
  workspace,
  cash,
  accounts,
  period,
  close,
  saved,
}: {
  workspace: string;
  cash: PayCashView;
  accounts: Account[];
  period: PayPeriod;
  close: () => void;
  saved: () => void;
}) {
  const plan = cash.plans.find((p) => p.plan.periodId === period.id)!;
  const [candidates, setCandidates] = useState<PayDeposit[] | null>(null),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0),
    [id, setId] = useState(""),
    [amount, setAmount] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let live = true;
    setCandidates(null);
    setError("");
    command<PayDeposit[]>("pay_deposit_candidates", {
      workspace,
      periodId: period.id,
    })
      .then((v) => {
        if (live) setCandidates(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [workspace, period.id, epoch]);
  const chosen = candidates?.find((e) => e.eventId === id);
  const account = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  return (
    <SaveDialog
      workspace={workspace}
      revision={cash.revision}
      title={`Match payroll deposits · ${period.payDate}`}
      close={close}
      saved={saved}
    >
      {(save, busy) => (
        <>
          <HelpHeading topic="payDeposits">
            <h3>Allocate existing income</h3>
          </HelpHeading>
          <p>
            Approved {money(plan.expectedCents)} · linked{" "}
            {money(plan.depositedCents)} · actual minus approved{" "}
            {money(plan.varianceCents)}. Matching never creates another
            transaction.
          </p>
          {plan.deposits.map((d) => (
            <div className="pay-tax-rule" key={d.eventId}>
              <strong>
                {d.date} · {d.description}
              </strong>
              <p>
                {account(d.accountId)} · {money(d.allocatedCents)} allocated
                from {money(d.amountCents)}
              </p>
              <button
                disabled={busy}
                className="text-button"
                onClick={() =>
                  void save({
                    kind: "removePayDeposit",
                    periodId: period.id,
                    eventId: d.eventId,
                  })
                }
              >
                Unlink deposit
              </button>
            </div>
          ))}
          {error ? (
            <p role="alert">
              {error}{" "}
              <button disabled={busy} onClick={() => setEpoch((n) => n + 1)}>
                Retry deposits
              </button>
            </p>
          ) : !candidates ? (
            <p>Loading bank deposits…</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (chosen)
                  void save({
                    kind: "payDeposit",
                    periodId: period.id,
                    eventId: id,
                    eventRevision: chosen.revision,
                    amount,
                    confirmed,
                  });
              }}
            >
              <fieldset disabled={busy || plan.plan.cancelled}>
                <label htmlFor="pay-bank-deposit">
                  Recorded income deposit
                </label>
                <select
                  id="pay-bank-deposit"
                  required
                  value={id}
                  onChange={(e) => {
                    setId(e.target.value);
                    setConfirmed(false);
                    const d = candidates.find(
                      (d) => d.eventId === e.target.value,
                    );
                    setAmount(
                      d ? dollars(d.allocatedCents || d.availableCents) : "",
                    );
                  }}
                >
                  <option value="">Choose an existing deposit</option>
                  {candidates.map((d) => (
                    <option key={d.eventId} value={d.eventId}>
                      {d.date} · {d.description} · {account(d.accountId)} ·{" "}
                      {money(d.availableCents)} available
                      {d.suggested ? " · Near payday" : ""}
                    </option>
                  ))}
                </select>
                <label>
                  Amount allocated to this period ($)
                  <input
                    type="number"
                    min="0.01"
                    max={chosen ? dollars(chosen.availableCents) : undefined}
                    step="0.01"
                    required
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setConfirmed(false);
                    }}
                  />
                </label>
                <TaxCheck
                  label="This is pay for this period; I reviewed the source, date, account and allocation"
                  value={confirmed}
                  change={setConfirmed}
                />
                <p>
                  Partial, split and off-cycle payments are allowed. A combined
                  deposit can serve multiple periods up to its full amount.
                  Refunds, transfers, rewards and household repayments are
                  excluded. Import or record actual income first if it is
                  missing here.
                </p>
                <button className="primary" disabled={!chosen || !confirmed}>
                  {busy ? "Saving…" : "Save deposit allocation"}
                </button>
              </fieldset>
            </form>
          )}
        </>
      )}
    </SaveDialog>
  );
}
function TakeoverEditor({
  workspace,
  cash,
  id,
  close,
  saved,
}: {
  workspace: string;
  cash: PayCashView;
  id: string;
  close: () => void;
  saved: () => void;
}) {
  const s = cash.schedules.find((s) => s.id === id)!;
  const old = cash.takeovers[id];
  const [date, setDate] = useState(old?.fromDate ?? s.anchor),
    [reason, setReason] = useState(old?.reason ?? ""),
    [confirmed, setConfirmed] = useState(false);
  return (
    <SaveDialog
      workspace={workspace}
      revision={cash.revision}
      title="Paycheck schedule takeover"
      close={close}
      saved={saved}
    >
      {(save, busy) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              kind: "payTakeover",
              input: { scheduleId: id, fromDate: date, reason },
              scheduleRevision: s.revision,
              confirmed,
            });
          }}
        >
          <fieldset disabled={busy}>
            <h3>{s.plan.name}</h3>
            <p>
              Suppress every scheduled slot on or after this date, including
              future slots not yet created. Approved payroll periods supply
              expected income instead. Prior transactions and earlier schedule
              slots remain.
            </p>
            <label>
              Takeover from scheduled date
              <input
                type="date"
                min="1900-01-01"
                max="2100-12-31"
                required
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label>
              Takeover review notes
              <textarea
                required
                maxLength={2000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <TaxCheck
              label="I confirmed this generic schedule represents the payroll now managed here"
              value={confirmed}
              change={setConfirmed}
            />
            <button className="primary" disabled={!confirmed}>
              {busy ? "Saving…" : "Save schedule takeover"}
            </button>
            {old && (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Release this takeover and let the generic schedule forecast again? Complete or cancel overlapping payroll cash plans first.",
                    )
                  )
                    void save({
                      kind: "removePayTakeover",
                      scheduleId: id,
                      confirmed: true,
                    });
                }}
              >
                Release takeover
              </button>
            )}
          </fieldset>
        </form>
      )}
    </SaveDialog>
  );
}
function TimesheetEditor({
  workspace,
  cash,
  period,
  close,
  saved,
}: {
  workspace: string;
  cash: PayCashView;
  period: PayPeriod;
  close: () => void;
  saved: () => void;
}) {
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  return (
    <SaveDialog
      workspace={workspace}
      revision={cash.revision}
      title={`Timesheet review · ${period.payDate}`}
      close={close}
      saved={saved}
    >
      {(save, busy) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              kind: "finalizePay",
              periodId: period.id,
              reason,
              confirmed,
            });
          }}
        >
          <fieldset disabled={busy}>
            <HelpHeading topic="payFinalization">
              <h3>{period.name}</h3>
            </HelpHeading>
            <p>
              Review actual hours for weeks {period.weeks.join(", ")} in Weekly
              hours first. Record zero for unworked usual workdays. Rate and
              sick-pay issues must be resolved. Later edits mark this review as
              changed; bank income and month close remain independent.
            </p>
            <label>
              Timesheet review notes
              <textarea
                required
                maxLength={2000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <TaxCheck
              label="I reviewed the actual hours, sick time, unpaid days and rates for these weeks"
              value={confirmed}
              change={setConfirmed}
            />
            <button className="primary" disabled={!confirmed}>
              {busy ? "Saving…" : "Finalize timesheet"}
            </button>
            {period.id in cash.finalized && (
              <button
                type="button"
                className="text-button"
                disabled={!reason.trim()}
                onClick={() =>
                  void save({ kind: "reopenPay", periodId: period.id, reason })
                }
              >
                Reopen timesheet review
              </button>
            )}
          </fieldset>
        </form>
      )}
    </SaveDialog>
  );
}
export function PayMonthExplanation({
  value,
  retained = false,
}: {
  value: PaidMonth;
  retained?: boolean;
}) {
  return (
    <details className="pay-tax-breakdown">
      <summary>
        {retained
          ? "Payroll explanation retained at close"
          : "Payroll explanation"}{" "}
        · {value.month}
      </summary>
      <p>
        Approved expected net: {money(value.approvedNetCents)}. Allocated bank
        pay by deposit date: {money(value.allocatedNetCents)}. These are
        separate views of pay, not additional income.
      </p>
      {value.plans.map((p) => (
        <p key={p.plan.periodId}>
          {p.plan.payDate} · {p.plan.name}: expected {money(p.expectedCents)},
          allocated {money(p.depositedCents)}, variance {money(p.varianceCents)}{" "}
          ·{" "}
          {p.plan.cancelled
            ? "Cancelled"
            : p.plan.complete
              ? "Reconciled"
              : "Open"}
          {p.changed ? " · Approval inputs changed" : ""}
        </p>
      ))}
      <details>
        <summary>
          Known paycheck facts ({value.knownPaychecks.length}) and selected
          predictions ({value.selectedPredictions.length})
        </summary>
        <ul>
          {value.knownPaychecks.map((o) => (
            <li key={o.id}>
              {o.payDate}: gross {money(o.grossCents)}, net{" "}
              {o.netCents === null ? "Unknown" : money(o.netCents)} ·{" "}
              {o.reviewed ? "Reviewed" : "Needs review"}
            </li>
          ))}
        </ul>
        <ul>
          {value.selectedPredictions.map((f) => (
            <li key={f.input.id}>
              {f.basis.period.payDate}: {f.input.method}, net{" "}
              {f.netCents === null ? "Unavailable" : money(f.netCents)} ·{" "}
              {f.input.reason}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>
          Allocated bank deposits ({value.allocatedDeposits.length})
        </summary>
        <ul>
          {value.allocatedDeposits.map((d) => (
            <li key={d.eventId}>
              {d.date} · {d.description}: {money(d.allocatedCents)} allocated
            </li>
          ))}
        </ul>
      </details>
      <p>
        {value.finalized.length} retained timesheet reviews. A later edit can
        require another review.
      </p>
    </details>
  );
}
export function PayAnnual({
  workspace,
  year,
}: {
  workspace: string;
  year: number;
}) {
  const [v, setV] = useState<PayAnnualView | null>(null),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let live = true;
    setV(null);
    setError("");
    command<PayAnnualView>("pay_annual", { workspace, year })
      .then((v) => {
        if (live) setV(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [workspace, year, epoch]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <HelpHeading topic="payAnnual">
            <h2>Annual payroll · {year}</h2>
          </HelpHeading>
          <p>
            Work is grouped by the day worked. Paychecks and bank allocations
            use their own payment dates. Expected pay is never added to recorded
            income.
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setEpoch((n) => n + 1)}>
            Retry annual payroll
          </button>
        </p>
      ) : !v ? (
        <p>Loading annual payroll…</p>
      ) : (
        <>
          <div className="pay-table-scroll">
            <table className="pay-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Recorded work / sick</th>
                  <th>Recorded earned gross</th>
                  <th>Approved expected net</th>
                  <th>Allocated bank pay</th>
                </tr>
              </thead>
              <tbody>
                {v.work.map((m, i) => (
                  <tr key={m.month}>
                    <th>
                      {m.month}
                      <small>
                        {m.recordedDays} recorded days
                        {m.unrecordedPlannedDays
                          ? ` · ${m.unrecordedPlannedDays} planned days unrecorded`
                          : ""}
                      </small>
                    </th>
                    <td>
                      {m.worked / 10000} / {m.sick} hours
                      <small>{m.unpaid / 10000} unpaid</small>
                    </td>
                    <td>
                      {m.earnedGrossCents === null
                        ? "Not available"
                        : money(m.earnedGrossCents)}
                    </td>
                    <td>{money(v.paid[i].approvedNetCents)}</td>
                    <td>{money(v.paid[i].allocatedNetCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pay-footnote">
            Earned gross covers recorded hours only and rounds once per work
            month. Missing days are not assumed worked. Known paycheck facts may
            include adjustments; inspect them separately below.
          </p>
          {v.paid
            .filter(
              (m) =>
                m.knownPaychecks.length ||
                m.plans.length ||
                m.allocatedDeposits.length ||
                m.selectedPredictions.length,
            )
            .map((m) => (
              <PayMonthExplanation key={m.month} value={m} />
            ))}
        </>
      )}
    </section>
  );
}
