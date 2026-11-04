import { HelpHeading } from "./HelpTip";
import CardPayments from "./CardPayments";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CreditCard, Plus } from "lucide-react";
import { command, money } from "./api";
import { Modal } from "./EntryDialog";
import type { Snapshot } from "./types";
import "./cardStatements.css";

interface Config {
  accountId: string;
  revision: number;
  firstMonth: string;
  closingDay: number;
  dueDay: number;
  dueMonthOffset: number;
  dateBasis: string;
  archived: boolean;
}
interface Draft {
  accountId: string;
  month: string;
  revision: number;
  closingDate: string;
  dueDate: string;
  dateBasis: string;
  datesConfirmed: boolean;
  balance: string | null;
  note: string;
  evidenceSourceId: string | null;
}
interface Calculation {
  throughDate: string;
  checkpointDate: string | null;
  checkpointCents: number | null;
  changeCents: number;
  balanceCents: number | null;
  complete: boolean;
  assumedDateCount: number;
  unresolvedCount: number;
  gaps: { start: string; end: string }[];
  coverageSources: { id: string; name: string }[];
  warnings: string[];
}
interface Review {
  calculation: Calculation;
  token: string;
}
interface Statement {
  draft: Draft;
  calculation: Calculation;
  confirmedBalanceCents: number | null;
  differenceCents: number | null;
  changedSinceReview: boolean;
}
interface View {
  configs: Config[];
  statements: Statement[];
  evidence: [string, { id: string; name: string }][];
}
type Props = { data: Snapshot; saved: (m: string) => Promise<void> };
const label = (data: Snapshot, id: string) =>
  data.accounts.find((a) => a.id === id)?.name ?? id;
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
    if (!dirty || window.confirm("Discard these unsaved statement changes?"))
      close();
  };
}
function Basis({
  value,
  change,
}: {
  value: string;
  change: (v: string) => void;
}) {
  return (
    <label>
      Activity date basis
      <select value={value} onChange={(e) => change(e.target.value)}>
        <option value="posted">Account posting dates</option>
        <option value="transaction">Transaction dates (estimate)</option>
      </select>
    </label>
  );
}
function CalculationView({ value: c }: { value: Calculation }) {
  return (
    <section
      className="statement-calculation"
      aria-label="Statement calculation"
    >
      <div className="statement-total">
        <span>
          {c.complete ? "Calculated at cutoff" : "Known subtotal · incomplete"}
        </span>
        <strong>
          {c.balanceCents === null ? "Unknown" : money(c.balanceCents)}
        </strong>
      </div>
      <p className="muted">
        Through {c.throughDate}.{" "}
        {c.checkpointDate
          ? `Starts with ${money(c.checkpointCents ?? 0)} at end of day ${c.checkpointDate}; subsequent activity ${money(c.changeCents)}.`
          : "Add an account balance checkpoint to establish a starting amount."}
      </p>
      {c.warnings.length > 0 && (
        <ul className="statement-warnings">
          {c.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {c.gaps.length > 0 && (
        <details>
          <summary>Coverage gaps ({c.gaps.length})</summary>
          <ul>
            {c.gaps.map((g) => (
              <li key={g.start}>
                {g.start} through {g.end}
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.coverageSources.length > 0 && (
        <details>
          <summary>
            Accepted coverage sources ({c.coverageSources.length})
          </summary>
          <ul>
            {c.coverageSources.map((s) => (
              <li key={s.id}>{s.name}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
export default function CardStatements({ data, saved }: Props) {
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const [paymentAccount, setPaymentAccount] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | "new" | null>(null),
    [statement, setStatement] = useState<Statement | null>(null);
  useEffect(() => {
    let live = true;
    setView(null);
    setError("");
    command<View>("card_statement_month", {
      workspace: data.workspace,
      month: data.month,
    })
      .then((v) => {
        if (live) setView(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [data.workspace, data.month, data, reload]);
  const available = data.accounts.filter(
    (a) =>
      a.kind === "credit" &&
      !a.archived &&
      !view?.configs.some((c) => c.accountId === a.id),
  );
  return (
    <div className="card-statements">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Card statements</h2>
            <p className="muted">
              Cycles closing in {data.month}. Scheduled dates are estimates
              until you confirm the issued statement.
            </p>
          </div>
          <button
            className="primary"
            disabled={!view || available.length === 0}
            onClick={() => setConfig("new")}
          >
            <Plus size={16} />
            Configure card
          </button>
        </div>
        <p className="muted">
          Reviewing a statement records no expense or payment. The issued
          balance stays separate from the account activity used to check it.
        </p>
        {error && (
          <div role="alert">
            {error}{" "}
            <button onClick={() => setReload((r) => r + 1)}>
              Retry statements
            </button>
          </div>
        )}
        {!view && !error && <p role="status">Loading statements…</p>}
        {view && view.statements.length === 0 && (
          <p className="empty">
            No statement cycles this month. Configure a card to calculate and
            review its cutoff balance.
          </p>
        )}
        <div className="statement-grid">
          {view?.statements.map((s) => (
            <article className="statement-card" key={s.draft.accountId}>
              <div className="statement-card-title">
                <CreditCard size={20} />
                <h3>{label(data, s.draft.accountId)}</h3>
                <span className="badge">
                  {s.confirmedBalanceCents !== null
                    ? "Confirmed balance"
                    : "Estimate"}
                </span>
              </div>
              <p>
                Closes {s.draft.closingDate} · due {s.draft.dueDate}
                <br />
                <span className="muted">
                  {s.draft.datesConfirmed
                    ? "Issuer dates confirmed"
                    : "Dates estimated"}
                </span>
              </p>
              {s.confirmedBalanceCents !== null && (
                <div className="statement-total">
                  <span>Issued statement balance</span>
                  <strong>{money(s.confirmedBalanceCents)}</strong>
                </div>
              )}
              {s.confirmedBalanceCents !== null &&
                s.confirmedBalanceCents < 0 && (
                  <p>Credit balance on this statement.</p>
                )}
              <CalculationView value={s.calculation} />
              {s.differenceCents !== null && s.differenceCents !== 0 && (
                <p className="statement-notice">
                  Confirmed minus calculated: {money(s.differenceCents)}. Review
                  the discrepancy.
                </p>
              )}
              {s.changedSinceReview && (
                <p className="statement-notice">
                  Calculation inputs changed since your last review. The
                  confirmed statement was preserved.
                </p>
              )}
              {s.draft.note && <p className="muted">{s.draft.note}</p>}
              <button className="secondary" onClick={() => setStatement(s)}>
                Review {label(data, s.draft.accountId)} statement
              </button>
            </article>
          ))}
        </div>
      </section>
      {view && (
        <section className="panel">
          <HelpHeading topic="cardCycles">
            <h2>Card cycle settings</h2>
          </HelpHeading>
          <p className="muted">
            Days 29–31 clamp to the last day of short months. Changes affect
            unsaved cycles; reviewed cycles retain their dates.
          </p>
          {view.configs.length === 0 ? (
            <p>No cards configured.</p>
          ) : (
            <div className="statement-configs">
              {view.configs.map((c) => (
                <div key={c.accountId}>
                  <span>
                    <strong>{label(data, c.accountId)}</strong>
                    <small>
                      Closes day {c.closingDay} · due day {c.dueDay},{" "}
                      {c.dueMonthOffset} month(s) later
                      {c.archived ? " · paused" : ""}
                    </small>
                  </span>
                  <button
                    className="secondary"
                    onClick={() => setPaymentAccount(c.accountId)}
                  >
                    Payments &amp; credits for {label(data, c.accountId)}
                  </button>
                  <button className="secondary" onClick={() => setConfig(c)}>
                    Edit {label(data, c.accountId)} cycle
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {paymentAccount && (
        <CardPayments
          key={`${data.workspace}:${paymentAccount}`}
          data={data}
          account={paymentAccount}
          close={() => setPaymentAccount(null)}
          saved={saved}
        />
      )}
      {config && (
        <ConfigEditor
          data={data}
          initial={
            config === "new"
              ? {
                  accountId: available[0]?.id ?? "",
                  revision: 0,
                  firstMonth: data.month,
                  closingDay: 20,
                  dueDay: 15,
                  dueMonthOffset: 1,
                  dateBasis: "posted",
                  archived: false,
                }
              : config
          }
          available={available.map((a) => a.id)}
          close={() => setConfig(null)}
          saved={saved}
        />
      )}
      {statement && view && (
        <StatementEditor
          data={data}
          initial={statement.draft}
          evidence={view.evidence
            .filter(([account]) => account === statement.draft.accountId)
            .map(([, e]) => e)}
          close={() => setStatement(null)}
          saved={saved}
        />
      )}
    </div>
  );
}
function ConfigEditor({
  data,
  initial,
  available,
  close,
  saved,
}: Props & { initial: Config; available: string[]; close: () => void }) {
  const [input, setInput] = useState(initial);
  const w = useWrite(close, saved);
  const dirty = JSON.stringify(input) !== JSON.stringify(initial),
    cancel = guarded(dirty, close);
  const update = (v: Partial<Config>) => setInput((i) => ({ ...i, ...v }));
  return (
    <Modal title="Card cycle settings" onClose={cancel} busy={w.busy}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void w.write(
            "save_card_statement_config",
            { workspace: data.workspace, input },
            "Card cycle saved.",
          );
        }}
      >
        <fieldset disabled={w.busy} className="statement-form">
          <label>
            Credit card
            <select
              value={input.accountId}
              disabled={input.revision > 0}
              onChange={(e) => update({ accountId: e.target.value })}
            >
              {(input.revision > 0 ? [input.accountId] : available).map(
                (id) => (
                  <option key={id} value={id}>
                    {label(data, id)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            First cycle month
            <input
              type="month"
              required
              value={input.firstMonth}
              onChange={(e) => update({ firstMonth: e.target.value })}
            />
          </label>
          <div className="statement-fields">
            <label>
              Usual closing day
              <input
                type="number"
                min="1"
                max="31"
                required
                value={input.closingDay}
                onChange={(e) => update({ closingDay: Number(e.target.value) })}
              />
            </label>
            <label>
              Usual due day
              <input
                type="number"
                min="1"
                max="31"
                required
                value={input.dueDay}
                onChange={(e) => update({ dueDay: Number(e.target.value) })}
              />
            </label>
          </div>
          <label>
            Due month
            <select
              value={input.dueMonthOffset}
              onChange={(e) =>
                update({ dueMonthOffset: Number(e.target.value) })
              }
            >
              <option value={0}>Same month as closing</option>
              <option value={1}>Month after closing</option>
              <option value={2}>Two months after closing</option>
            </select>
          </label>
          <Basis
            value={input.dateBasis}
            change={(dateBasis) => update({ dateBasis })}
          />
          <label className="check-label">
            <input
              type="checkbox"
              checked={input.archived}
              onChange={(e) => update({ archived: e.target.checked })}
            />
            Pause new cycle estimates
          </label>
          <p className="muted">
            Short months use their last day. Saved reviews remain unchanged when
            settings change or estimates are paused.
          </p>
        </fieldset>
        {w.error && (
          <p role="alert" className="error">
            {w.error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={w.busy} onClick={cancel}>
            Cancel
          </button>
          <button className="primary" disabled={w.busy}>
            Save card cycle
          </button>
        </div>
      </form>
    </Modal>
  );
}
function StatementEditor({
  data,
  initial,
  evidence,
  close,
  saved,
}: Props & {
  initial: Draft;
  evidence: { id: string; name: string }[];
  close: () => void;
}) {
  const [input, setInput] = useState(initial),
    [review, setReview] = useState<Review | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const w = useWrite(close, saved),
    running = useRef(false),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const dirty = JSON.stringify(input) !== JSON.stringify(initial),
    cancel = guarded(dirty, close);
  const update = (v: Partial<Draft>) => {
    setInput((i) => ({ ...i, ...v }));
    setReview(null);
    setConfirmed(false);
    setError("");
  };
  async function calculate() {
    if (running.current) return;
    running.current = true;
    setLoading(true);
    setError("");
    setReview(null);
    setConfirmed(false);
    try {
      const result = await command<Review>("review_card_statement", {
        workspace: data.workspace,
        input,
      });
      if (live.current) setReview(result);
    } catch (e) {
      if (live.current) setError(String(e));
    } finally {
      running.current = false;
      if (live.current) setLoading(false);
    }
  }
  const busy = loading || w.busy;
  return (
    <Modal
      title={`Review ${label(data, initial.accountId)} statement`}
      onClose={cancel}
      busy={busy}
    >
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (review && confirmed)
            void w.write(
              "save_card_statement",
              {
                workspace: data.workspace,
                input: { draft: input, token: review.token, confirmed },
              },
              "Statement review saved.",
            );
        }}
      >
        <fieldset disabled={busy} className="statement-form">
          <p className="muted">
            Cycle {initial.month}. Enter issuer dates and balance if available;
            a negative amount means a credit balance.
          </p>
          <div className="statement-fields">
            <label>
              Closing date
              <input
                type="date"
                required
                value={input.closingDate}
                onChange={(e) => update({ closingDate: e.target.value })}
              />
            </label>
            <label>
              Payment due date
              <input
                type="date"
                required
                value={input.dueDate}
                onChange={(e) => update({ dueDate: e.target.value })}
              />
            </label>
          </div>
          <Basis
            value={input.dateBasis}
            change={(dateBasis) => update({ dateBasis })}
          />
          <label className="check-label">
            <input
              type="checkbox"
              checked={input.datesConfirmed}
              onChange={(e) =>
                update({
                  datesConfirmed: e.target.checked,
                  balance: e.target.checked ? input.balance : null,
                })
              }
            />
            I checked the issuer's closing and due dates
          </label>
          <label>
            Issued statement balance (optional)
            <input
              inputMode="decimal"
              placeholder="Leave blank for an estimate"
              disabled={!input.datesConfirmed}
              value={input.balance ?? ""}
              onChange={(e) =>
                update({
                  balance: e.target.value === "" ? null : e.target.value,
                })
              }
            />
          </label>
          <label>
            Statement evidence
            <select
              value={input.evidenceSourceId ?? ""}
              onChange={(e) =>
                update({ evidenceSourceId: e.target.value || null })
              }
            >
              <option value="">No attached source</option>
              {evidence.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Review note / statement reference
            <textarea
              required
              maxLength={2000}
              value={input.note}
              onChange={(e) => update({ note: e.target.value })}
            />
          </label>
          <button
            className="secondary"
            type="button"
            onClick={() => void calculate()}
          >
            {loading ? "Calculating…" : "Calculate and review"}
          </button>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {review && (
          <>
            <CalculationView value={review.calculation} />
            <p className="muted">
              A confirmed balance records the issuer's statement; it does not
              fill coverage gaps or reconcile account activity.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                disabled={busy}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed the dates, amount and calculation warnings
            </label>
          </>
        )}
        {w.error && (
          <p role="alert" className="error">
            {w.error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !review || !confirmed || !input.note.trim()}
          >
            Save statement review
          </button>
        </div>
      </form>
    </Modal>
  );
}
