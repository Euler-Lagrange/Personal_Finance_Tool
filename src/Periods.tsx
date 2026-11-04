import { HelpHeading } from "./HelpTip";
import Trends from "./Trends";
import { PayMonthExplanation } from "./PayCash";
import type { PaidMonth } from "./payCashTypes";
import { useEffect, useRef, useState } from "react";
import { LockKeyhole, RotateCcw } from "lucide-react";
import { command, money, monthName } from "./api";
import { Modal } from "./EntryDialog";
import type { Snapshot } from "./types";
import "./periods.css";

interface CategoryTotal {
  id: string;
  name: string;
  group: string;
  limitCents: number;
  spentCents: number;
  goalExcludedCents: number;
  allowanceCents: number;
}
interface Totals {
  rolloverCents?: number;
  spentCents: number;
  consumptionCents: number;
  debtPaymentCents: number;
  incomeCents: number;
  cashRewardCents: number;
  cardRewardCents: number;
  goalExcludedCents: number;
  allowanceCents: number;
  budgetCents: number;
  remainingCents: number;
  savingsContributionCents: number;
  categories: CategoryTotal[];
}
interface Check {
  id: string;
  message: string;
}
interface CarryPreview {
  targetMonth: string;
  targetClosed: boolean;
  lines: {
    categoryId: string;
    name: string;
    mode: string;
    remainderCents: number;
    outputCents: number;
    previousCents: number;
    deltaCents: number;
  }[];
  history: {
    sourceMonth: string;
    targetMonth: string;
    name: string;
    amountCents: number;
    reason: string;
  }[];
}
interface Review {
  payroll?: PaidMonth | null;
  carry?: CarryPreview;
  month: string;
  revision: number;
  closed: boolean;
  closedAt: string | null;
  changed: boolean;
  token: string;
  blockers: Check[];
  warnings: Check[];
  totals: Totals;
  previous: Totals | null;
}
interface AnnualMonth {
  month: string;
  status: string;
  changed: boolean;
  totals: Totals | null;
}
interface AnnualReport {
  averageClosedTotals?: Totals | null;
  year: number;
  months: AnnualMonth[];
  closedMonths: number;
  actualSpendingCents: number;
  averageClosedSpendingCents: number | null;
}

export function MonthCloseControl({
  data,
  saved,
}: {
  data: Snapshot;
  saved: (m: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="period-control">
        <div>
          <HelpHeading topic="closeMonth">
            <strong>
              {data.period?.closed
                ? "Month closed"
                : data.period?.changed
                  ? "Changed since close"
                  : "Month close"}
            </strong>
          </HelpHeading>
          <p>
            {data.period?.closed
              ? "Financial changes require an explicit reopen. Later-month refunds keep their own dates."
              : "Review unresolved items and save the final month for annual reporting."}
          </p>
        </div>
        <button className="secondary" onClick={() => setOpen(true)}>
          <LockKeyhole size={16} />
          {data.period?.closed ? "Review / reopen month" : "Review month close"}
        </button>
      </div>
      {open && (
        <CloseDialog
          workspace={data.workspace}
          month={data.month}
          close={() => setOpen(false)}
          saved={saved}
        />
      )}
    </>
  );
}
export function CloseDialog({
  workspace,
  month,
  close,
  saved,
}: {
  workspace: string;
  month: string;
  close: () => void;
  saved: (m: string) => Promise<void>;
}) {
  const [review, setReview] = useState<Review | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0);
  const [ack, setAck] = useState<string[]>([]),
    [note, setNote] = useState(""),
    [reason, setReason] = useState("");
  const [reviewUnavailable, setReviewUnavailable] = useState(false);
  const [carryTarget, setCarryTarget] = useState("");
  const [carryReason, setCarryReason] = useState("Month close rollover");
  const attempt = useRef({ payload: "", id: "" });
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setReviewUnavailable(false);
    setError("");
    setAck([]);
    command<Review>("close_review", {
      workspace,
      month,
      carryTarget: carryTarget || null,
    })
      .then((r) => {
        if (alive) {
          setReview(r);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(String(e));
          setReviewUnavailable(true);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [workspace, month, reload, carryTarget]);
  function leave() {
    if (
      (ack.length ||
        note ||
        reason ||
        carryTarget ||
        carryReason !== "Month close rollover") &&
      !window.confirm("Discard the unsaved close or reopen choices?")
    )
      return;
    close();
  }
  async function submit() {
    if (!review || loading || reviewUnavailable) return;
    setBusy(true);
    setError("");
    const input = review.closed
      ? { month, revision: review.revision, reason }
      : {
          month,
          revision: review.revision,
          token: review.token,
          ...(review.carry
            ? {
                carry: {
                  targetMonth: review.carry.targetMonth,
                  reason: carryReason,
                },
              }
            : {}),
          acknowledgements: ack,
          note,
        };
    const payload = JSON.stringify(input);
    if (attempt.current.payload !== payload)
      attempt.current = { payload, id: crypto.randomUUID() };
    try {
      await command(review.closed ? "reopen_month" : "close_month", {
        workspace,
        input: { ...input, id: attempt.current.id },
      });
      close();
      await saved(
        review.closed
          ? "Month reopened. Original dates are retained."
          : "Month closed and saved for annual reporting.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const totals = review?.closed ? review.previous : review?.totals;
  return (
    <Modal
      title={`${monthName(month)} · Month close`}
      onClose={leave}
      busy={busy}
    >
      <div className="close-content">
        {loading && <p>Loading the close checklist...</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!loading && review && (
          <>
            {review.closed ? (
              <p className="close-state">
                <LockKeyhole size={18} />
                Closed{" "}
                {review.closedAt
                  ? new Date(review.closedAt).toLocaleString()
                  : ""}
              </p>
            ) : (
              <p className="close-state">
                {review.changed
                  ? "Changed since close — review the updated totals."
                  : "Open month — totals are provisional."}
              </p>
            )}
            {totals && (
              <dl className="close-totals">
                <div>
                  <dt>Actual spending</dt>
                  <dd>{money(totals.spentCents)}</dd>
                </div>
                <div>
                  <dt>Goal-funded exclusion</dt>
                  <dd>{money(totals.goalExcludedCents)}</dd>
                </div>
                <div>
                  <dt>Monthly allowance used</dt>
                  <dd>{money(totals.allowanceCents)}</dd>
                </div>
                <div>
                  <dt>Recorded income</dt>
                  <dd>{money(totals.incomeCents)}</dd>
                </div>
              </dl>
            )}
            {review.changed && review.previous && (
              <p className="muted">
                Last close: {money(review.previous.spentCents)} actual spending;{" "}
                {money(review.previous.allowanceCents)} allowance used.
              </p>
            )}
            {review.payroll &&
              (review.payroll.plans.length > 0 ||
                review.payroll.knownPaychecks.length > 0 ||
                review.payroll.selectedPredictions.length > 0 ||
                review.payroll.allocatedDeposits.length > 0) && (
                <PayMonthExplanation
                  value={review.payroll}
                  retained={review.closed}
                />
              )}
            {review.carry && (
              <section className="carry-review">
                <HelpHeading topic="rollover">
                  <h3>Rollover from {monthName(month)}</h3>
                </HelpHeading>
                <p className="muted">
                  Carry affects allowance only. Actual spending and cash stay
                  unchanged. Prior adjustments remain in their recorded
                  destinations.
                </p>
                {review.carry.lines.length ? (
                  <div className="carry-lines">
                    {review.carry.lines.map((l) => (
                      <div key={l.categoryId}>
                        <strong>{l.name}</strong>
                        <span>{l.mode === "carry" ? "Carry" : "Reset"}</span>
                        <small>Current signed remainder</small>
                        <span>{money(l.remainderCents)}</span>
                        <small>Previously applied</small>
                        <span>{money(l.previousCents)}</span>
                        <small>New difference to apply</small>
                        <strong className={l.deltaCents < 0 ? "over" : ""}>
                          {money(l.deltaCents)}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>All categories reset; no carry adjustments are needed.</p>
                )}
                {!review.closed &&
                  review.carry.lines.some((l) => l.deltaCents !== 0) && (
                    <>
                      <label>
                        Apply rollover differences to
                        <input
                          type="month"
                          min={month}
                          value={carryTarget || review.carry.targetMonth}
                          disabled={busy}
                          onChange={(e) => setCarryTarget(e.target.value)}
                        />
                      </label>
                      <p className="muted">
                        For a historical correction, the current open month is
                        suggested. You may explicitly reopen a later historical
                        month and choose it instead. Closed successors stay
                        unchanged.
                      </p>
                      <label>
                        Reason for carry or correction
                        <input
                          maxLength={2000}
                          value={carryReason}
                          disabled={busy}
                          onChange={(e) => setCarryReason(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                {!!review.carry.history.length && (
                  <details>
                    <summary>
                      Recorded carry adjustments ({review.carry.history.length})
                    </summary>
                    {review.carry.history.map((h, i) => (
                      <p key={i}>
                        {h.name}: {money(h.amountCents)} from{" "}
                        {monthName(h.sourceMonth)} to {monthName(h.targetMonth)}
                        . {h.reason}
                      </p>
                    ))}
                  </details>
                )}
              </section>
            )}
            {review.closed ? (
              <>
                <p>
                  Reopen explicitly to correct historical entries. The last
                  closed totals remain available for comparison until you close
                  again.
                </p>
                <label>
                  Reason for reopening
                  <textarea
                    maxLength={2000}
                    value={reason}
                    disabled={busy}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="For example, add a late October transaction"
                  />
                </label>
              </>
            ) : (
              <>
                {!!review.blockers.length && (
                  <section className="close-blockers">
                    <h3>Resolve before closing</h3>
                    <ul>
                      {review.blockers.map((c) => (
                        <li key={c.id}>{c.message}</li>
                      ))}
                    </ul>
                    <p>
                      Use Imports or Savings goals to resolve flagged activity,
                      then reload this checklist.
                    </p>
                  </section>
                )}
                <h3>Review and acknowledge</h3>
                {review.warnings.map((c) => (
                  <label className="close-check" key={c.id}>
                    <input
                      type="checkbox"
                      disabled={busy || loading || reviewUnavailable}
                      checked={ack.includes(c.id)}
                      onChange={(e) =>
                        setAck((a) =>
                          e.target.checked
                            ? [...a, c.id]
                            : a.filter((id) => id !== c.id),
                        )
                      }
                    />
                    <span>{c.message}</span>
                  </label>
                ))}
                <label>
                  Close note (optional)
                  <textarea
                    maxLength={2000}
                    disabled={busy}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <p className="muted">
                  Close saves one latest totals snapshot and locks financial
                  edits. This does not send money or verify live bank balances.
                </p>
              </>
            )}
          </>
        )}
        <div className="dialog-actions">
          <button
            className="text-button"
            disabled={busy || loading}
            onClick={() => setReload((n) => n + 1)}
          >
            <RotateCcw size={15} />
            Reload checklist
          </button>
          <button className="secondary" disabled={busy} onClick={leave}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              loading ||
              reviewUnavailable ||
              !review ||
              (review.closed
                ? !reason.trim()
                : (!!review.carry?.lines.some((l) => l.deltaCents !== 0) &&
                    !carryReason.trim()) ||
                  review.blockers.length > 0 ||
                  review.warnings.some((c) => !ack.includes(c.id)))
            }
            onClick={() => void submit()}
          >
            {review?.closed ? "Reopen month" : "Close month"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function Annual({
  data,
  saved,
}: {
  data: Snapshot;
  saved: (m: string) => Promise<void>;
}) {
  const [trends, setTrends] = useState(false);
  const [year, setYear] = useState(Number(data.month.slice(0, 4))),
    [report, setReport] = useState<AnnualReport | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [selected, setSelected] = useState("");
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    command<AnnualReport>("annual_report", { workspace: data.workspace, year })
      .then((r) => {
        if (alive) {
          setReport(r);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [data, year, reload]);
  const categories = new Map<string, string>();
  report?.months.forEach((m) =>
    m.totals?.categories.forEach((c) => categories.set(c.id, c.name)),
  );
  const metrics: [string, keyof Totals][] = [
    ["Actual spending", "spentCents"],
    ["Purchase consumption", "consumptionCents"],
    ["Loan/debt payments", "debtPaymentCents"],
    ["Goal-funded exclusion", "goalExcludedCents"],
    ["Allowance used", "allowanceCents"],
    ["Available allowance", "budgetCents"],
    ["Incoming carry adjustments", "rolloverCents"],
    ["Recorded income", "incomeCents"],
    ["Cash rewards", "cashRewardCents"],
    ["Card reward credits", "cardRewardCents"],
    ["Savings transfers from checking", "savingsContributionCents"],
  ];
  return (
    <>
      <div className="annual-toolbar">
        <button
          className="secondary"
          aria-pressed={trends}
          onClick={() => setTrends((v) => !v)}
        >
          {trends ? "Monthly totals" : "Spending trends"}
        </button>
        <label>
          Report year
          <input
            type="number"
            min={1900}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <p>
          Closed months use saved totals. Open months are provisional; missing
          and future months stay blank.
        </p>
      </div>
      {trends && <Trends data={data} year={year} />}
      {!trends && loading && <p>Loading annual report...</p>}
      {!trends && error && (
        <p className="form-error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setReload((n) => n + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {!trends && !loading && !error && report && (
        <>
          <div className="summary-strip">
            <div>
              <span>Spending assigned to {year}</span>
              <strong>{money(report.actualSpendingCents)}</strong>
            </div>
            <div>
              <span>
                Average across {report.closedMonths} closed{" "}
                {report.closedMonths === 1 ? "month" : "months"}
              </span>
              <strong>
                {report.averageClosedSpendingCents === null
                  ? "—"
                  : money(report.averageClosedSpendingCents)}
              </strong>
            </div>
            <p>
              Completed zero months count in the average. Missing and open
              months do not.
            </p>
          </div>
          <section className="panel annual-panel">
            <div className="panel-heading">
              <div>
                <h2>Monthly totals</h2>
                <p>
                  Spending follows the selected budget period, including
                  explicit late-entry overrides. Actual dates remain on each
                  transaction. Goal-funded purchases still count; transfers and
                  repayments remain separate.
                </p>
              </div>
            </div>
            <div className="annual-scroll">
              <table>
                <thead>
                  <tr>
                    <th>USD</th>
                    {report.months.map((m) => (
                      <th key={m.month}>
                        {monthName(m.month).split(" ")[0].slice(0, 3)}
                        <button
                          className="text-button"
                          disabled={m.status === "future"}
                          onClick={() => setSelected(m.month)}
                          aria-label={`Review ${monthName(m.month)}`}
                        >
                          {m.status === "closed"
                            ? "Final"
                            : m.status === "open"
                              ? m.changed
                                ? "Changed"
                                : "Open"
                              : m.status === "future"
                                ? "Future"
                                : "Not tracked"}
                        </button>
                      </th>
                    ))}
                    <th>Total</th>
                    <th>Closed-month average</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map(([label, key]) => (
                    <tr key={key}>
                      <th>{label}</th>
                      {report.months.map((m) => (
                        <td key={m.month}>
                          {m.totals
                            ? money((m.totals[key] as number) ?? 0)
                            : "—"}
                        </td>
                      ))}
                      <td>
                        {money(
                          report.months.reduce(
                            (n, m) => n + ((m.totals?.[key] as number) ?? 0),
                            0,
                          ),
                        )}
                      </td>
                      <td>
                        {report.averageClosedTotals
                          ? money(
                              (report.averageClosedTotals[key] as number) ?? 0,
                            )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel annual-panel">
            <div className="panel-heading">
              <div>
                <h2>Spending by category</h2>
                <p>
                  Monthly actual amounts after received refunds, including
                  purchases funded from goals.
                </p>
              </div>
            </div>
            <div className="annual-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    {report.months.map((m) => (
                      <th key={m.month}>
                        {monthName(m.month).split(" ")[0].slice(0, 3)}
                      </th>
                    ))}
                    <th>Total</th>
                    <th>Closed-month average</th>
                  </tr>
                </thead>
                <tbody>
                  {[...categories].map(([id, name]) => (
                    <tr key={id}>
                      <th>{name}</th>
                      {report.months.map((m) => (
                        <td key={m.month}>
                          {m.totals
                            ? money(
                                m.totals.categories.find((c) => c.id === id)
                                  ?.spentCents ?? 0,
                              )
                            : "—"}
                        </td>
                      ))}
                      <td>
                        {money(
                          report.months.reduce(
                            (n, m) =>
                              n +
                              (m.totals?.categories.find((c) => c.id === id)
                                ?.spentCents ?? 0),
                            0,
                          ),
                        )}
                      </td>
                      <td>
                        {report.averageClosedTotals
                          ? money(
                              report.averageClosedTotals.categories.find(
                                (c) => c.id === id,
                              )?.spentCents ?? 0,
                            )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {selected && (
        <CloseDialog
          workspace={data.workspace}
          month={selected}
          close={() => setSelected("")}
          saved={saved}
        />
      )}
    </>
  );
}
