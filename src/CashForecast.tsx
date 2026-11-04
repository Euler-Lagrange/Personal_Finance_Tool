import { HelpHeading } from "./HelpTip";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownUp, CalendarDays, Settings2 } from "lucide-react";
import { command, money, monthName } from "./api";
import { Modal } from "./EntryDialog";
import type { Snapshot } from "./types";
import "./cashForecast.css";
interface Funding {
  cardId: string;
  checkingId: string;
}
interface Settings {
  revision: number;
  funding: Funding[];
}
interface Row {
  id: string;
  date: string;
  name: string;
  source: string;
  amountCents: number | null;
  included: boolean;
  reason: string;
  runningCents: number | null;
}
interface View {
  accountId: string;
  asOf: string;
  through: string;
  settings: Settings;
  opening: {
    balanceCents: number | null;
    checkpointDate: string | null;
    checkpointCents: number | null;
    changeCents: number;
    complete: boolean;
    gaps: { start: string; end: string }[];
    assumedDateCount: number;
    unresolvedCount: number;
    coverageSources: { id: string; name: string }[];
  };
  lastObservedAt: string | null;
  rows: Row[];
  warnings: string[];
  endingKnownCents: number | null;
  lowestKnownCents: number | null;
  nextPayDate: string | null;
  beforeNextPayCents: number | null;
  incomplete: boolean;
}
const value = (n: number | null) => (n === null ? "Unknown" : money(n));
const sourceName: Record<string, string> = {
  bill: "Bill",
  income: "Expected income",
  transfer: "Bank transfer",
  settlement: "Household settlement",
  paypal_cashout: "Expected PayPal deposit",
  card_payment: "Statement payment",
  card_estimate: "Estimated statement",
  recorded: "Recorded movement",
};
export default function CashForecast({ data }: { data: Snapshot }) {
  const banks = data.accounts.filter((a) => a.kind === "checking");
  const [account, setAccount] = useState(
    () => banks.find((a) => !a.archived)?.id ?? banks[0]?.id ?? "",
  );
  const [days, setDays] = useState(30),
    [reload, setReload] = useState(0),
    [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [edit, setEdit] = useState(false);
  useEffect(() => {
    let active = true;
    setView(null);
    setError("");
    setEdit(false);
    if (account)
      command<View>("cash_forecast", {
        workspace: data.workspace,
        account,
        days,
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
  }, [data, account, days, reload]);
  const held = view?.rows.filter((r) => !r.included) ?? [];
  const included = view?.rows.filter((r) => r.included) ?? [];
  return (
    <div className="cash-forecast">
      <section className="panel forecast-controls">
        <div>
          <h2>
            <ArrowDownUp size={21} /> Checking cash timeline
          </h2>
          <p>
            Expected cash after known activity through today. Budget room is
            shown separately.
          </p>
        </div>
        <div className="forecast-selects">
          <label>
            Checking account
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              {!banks.length && <option value="">No checking account</option>}
              {banks.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Forecast horizon
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <button
            className="secondary"
            disabled={!view}
            onClick={() => setEdit(true)}
          >
            <Settings2 size={16} /> Card payment accounts
          </button>
        </div>
      </section>
      {!account ? (
        <section className="panel">
          <h3>Add a checking account to begin</h3>
          <p>
            Use Accounts &amp; categories, then add a balance checkpoint and
            your cash plans.
          </p>
        </section>
      ) : error ? (
        <section className="panel">
          <p role="alert" className="form-error">
            {error}
          </p>
          <button className="secondary" onClick={() => setReload((n) => n + 1)}>
            Retry forecast
          </button>
        </section>
      ) : !view ? (
        <p role="status">Calculating known cash plans...</p>
      ) : (
        <>
          <section
            className="forecast-metrics"
            aria-label="Cash projection summary"
          >
            <article>
              <span>Opening estimate · {view.asOf}</span>
              <strong>{value(view.opening.balanceCents)}</strong>
              <small>
                {view.opening.complete
                  ? "Checkpoint and coverage reviewed"
                  : "Opening data needs attention"}
              </small>
            </article>
            <article>
              <span>Known-plan subtotal · {view.through}</span>
              <strong>{value(view.endingKnownCents)}</strong>
              <small>
                {view.incomplete
                  ? "Incomplete inputs; see review items"
                  : "Based on configured plans only"}
              </small>
            </article>
            <article>
              <span>Lowest known-plan subtotal</span>
              <strong>{value(view.lowestKnownCents)}</strong>
              <small>Same-day outflows ordered before deposits</small>
            </article>
            <article>
              <span>Before next planned pay</span>
              <strong>
                {view.nextPayDate
                  ? value(view.beforeNextPayCents)
                  : "No pay planned"}
              </strong>
              <small>
                {view.nextPayDate ?? "Add a pay schedule in Cash plans"}
              </small>
            </article>
          </section>
          <section className="panel forecast-context">
            <div>
              <HelpHeading topic="balanceEvidence">
                <h3>Opening balance evidence</h3>
              </HelpHeading>
              <p>
                {view.opening.checkpointDate ? (
                  <>
                    End-of-day checkpoint {view.opening.checkpointDate}:{" "}
                    {value(view.opening.checkpointCents)}. Known change since:{" "}
                    {money(view.opening.changeCents)}.
                  </>
                ) : (
                  "No known opening balance. Add a checkpoint in Accounts & categories; exports alone cannot establish cash on hand."
                )}
              </p>
              <p>
                Last source observation:{" "}
                {view.lastObservedAt ?? "None recorded"}.
              </p>
              {view.opening.gaps.length > 0 && (
                <p>
                  Coverage gaps:{" "}
                  {view.opening.gaps
                    .map((g) => `${g.start} to ${g.end}`)
                    .join("; ")}
                  .
                </p>
              )}
              {view.opening.coverageSources.length > 0 && (
                <p>
                  Accepted coverage:{" "}
                  {view.opening.coverageSources.map((s) => s.name).join(", ")}.
                </p>
              )}
            </div>
            <aside>
              <span>{monthName(data.month)} budget room</span>
              <strong>
                {data.budgetConfigured
                  ? money(data.remainingCents)
                  : "Not configured"}
              </strong>
              <small>
                Personal monthly allowance, separate from checking cash.
              </small>
            </aside>
          </section>
          <section className="panel forecast-assumptions">
            <h3>Assumptions and missing inputs</h3>
            <ul>
              {view.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </section>
          {held.length > 0 && (
            <section className="panel forecast-held">
              <h3>
                {held.length} {held.length === 1 ? "item needs" : "items need"}{" "}
                review
              </h3>
              <p>
                Excluded from the subtotal until resolved. Unknown amounts can
                change the projection.
              </p>
              {held.map((r) => (
                <article key={r.id}>
                  <div>
                    <strong>{r.name}</strong>
                    <small>
                      {r.date} · {sourceName[r.source] ?? r.source}
                    </small>
                    <p>{r.reason}</p>
                  </div>
                  <b>{value(r.amountCents)}</b>
                </article>
              ))}
            </section>
          )}
          <section className="panel forecast-timeline">
            <div className="panel-heading">
              <div>
                <h3>
                  <CalendarDays size={18} /> Included cash movements
                </h3>
                <p>
                  Full checking amounts. Card purchases appear in statement
                  estimates, not as a second checking charge.
                </p>
              </div>
            </div>
            {!included.length ? (
              <p>
                No included cash movements in this horizon. Configure Cash
                plans, Bills and Card statements.
              </p>
            ) : (
              <div className="forecast-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Movement / assumption</th>
                      <th>Cash change</th>
                      <th>Known subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {included.map((r) => (
                      <tr key={r.id}>
                        <td>{r.date}</td>
                        <td>
                          <strong>{r.name}</strong>
                          <small>{sourceName[r.source] ?? r.source}</small>
                          <p>{r.reason}</p>
                        </td>
                        <td
                          className={
                            r.amountCents !== null && r.amountCents < 0
                              ? "forecast-out"
                              : ""
                          }
                        >
                          {value(r.amountCents)}
                        </td>
                        <td>{value(r.runningCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {edit && (
            <FundingEditor
              data={data}
              initial={view.settings}
              close={() => setEdit(false)}
              saved={() => {
                setEdit(false);
                setReload((n) => n + 1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
function FundingEditor({
  data,
  initial,
  close,
  saved,
}: {
  data: Snapshot;
  initial: Settings;
  close: () => void;
  saved: () => void;
}) {
  const [input, setInput] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const operation = useRef({ key: "", id: "" }),
    running = useRef(false),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const dirty = JSON.stringify(input) !== JSON.stringify(initial);
  const requestClose = () => {
    if (!dirty || window.confirm("Discard unsaved card payment accounts?"))
      close();
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const key = JSON.stringify(input);
    if (operation.current.key !== key)
      operation.current = { key, id: crypto.randomUUID() };
    try {
      await command("save_forecast_settings", {
        workspace: data.workspace,
        operation: operation.current.id,
        input,
      });
      if (live.current) saved();
    } catch (e) {
      if (live.current) {
        setError(String(e));
        setBusy(false);
        running.current = false;
      }
    }
  }
  return (
    <Modal title="Card payment accounts" busy={busy} onClose={requestClose}>
      <form onSubmit={submit}>
        <fieldset className="forecast-funding" disabled={busy}>
          <p>
            Choose the checking account expected to pay each card. This sets
            forecast assumptions; it does not move money or enable autopay.
          </p>
          {data.accounts
            .filter((a) => a.kind === "credit")
            .map((a) => (
              <label key={a.id}>
                {a.name}
                <select
                  value={
                    input.funding.find((f) => f.cardId === a.id)?.checkingId ??
                    ""
                  }
                  onChange={(e) =>
                    setInput({
                      ...input,
                      funding: [
                        ...input.funding.filter((f) => f.cardId !== a.id),
                        ...(e.target.value
                          ? [{ cardId: a.id, checkingId: e.target.value }]
                          : []),
                      ],
                    })
                  }
                >
                  <option value="">Not assigned / excluded</option>
                  {data.accounts
                    .filter(
                      (b) =>
                        b.kind === "checking" &&
                        (!b.archived ||
                          initial.funding.some(
                            (f) => f.cardId === a.id && f.checkingId === b.id,
                          )),
                    )
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={requestClose}>
              Cancel
            </button>
            <button className="primary" disabled={!dirty || busy}>
              Save payment accounts
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
