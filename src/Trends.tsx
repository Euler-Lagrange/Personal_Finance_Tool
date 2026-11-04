import { HelpHeading } from "./HelpTip";
import { useEffect, useState } from "react";
import { command, money, monthName } from "./api";
import type { Snapshot } from "./types";
import "./trends.css";

interface Series {
  id: string;
  name: string;
  months: (number | null)[];
  totalCents: number;
  closedAverageCents: number | null;
}
interface Report {
  year: number;
  months: {
    month: string;
    status: string;
    spentCents: number | null;
    unresolvedCount: number;
  }[];
  categories: Series[];
  merchants: Series[];
  entries: {
    id: string;
    date: string;
    month: string;
    description: string;
    merchantId: string;
    kind: string;
    amountCents: number;
    categories: { categoryId: string; amountCents: number }[];
  }[];
  incompleteImportCount: number;
}
const stateLabel = (status: string) =>
  status === "closed"
    ? "Final"
    : status === "open"
      ? "Provisional"
      : status === "future"
        ? "Future"
        : "Not tracked";
export default function Trends({
  data,
  year,
}: {
  data: Snapshot;
  year: number;
}) {
  const [report, setReport] = useState<Report | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [group, setGroup] = useState<"categories" | "merchants">("categories"),
    [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [detailMonth, setDetailMonth] = useState(""),
    [limit, setLimit] = useState(50);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setReport(null);
    setSelected("");
    setDetailMonth("");
    setLimit(50);
    command<Report>("trends_report", { workspace: data.workspace, year })
      .then((r) => {
        if (active) {
          setReport(r);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [data, year, retry]);
  if (loading) return <p role="status">Loading spending trends...</p>;
  if (error)
    return (
      <div className="form-error" role="alert">
        {error}{" "}
        <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
          Retry trends
        </button>
      </div>
    );
  if (!report) return null;
  const series = report[group],
    chosen = series.find((s) => s.id === selected),
    values = chosen?.months ?? report.months.map((m) => m.spentCents),
    total =
      chosen?.totalCents ?? values.reduce<number>((n, v) => n + (v ?? 0), 0),
    closed = report.months.filter((m) => m.status === "closed").length,
    closedSum = values.reduce<number>(
      (n, v, i) => n + (report.months[i].status === "closed" ? (v ?? 0) : 0),
      0,
    ),
    average = chosen
      ? chosen.closedAverageCents
      : closed
        ? Math.sign(closedSum) * Math.round(Math.abs(closedSum) / closed)
        : null,
    scale = Math.max(1, ...values.map((n) => Math.abs(n ?? 0))),
    details = report.entries.filter(
      (e) =>
        (!detailMonth || e.month === detailMonth) &&
        (!chosen ||
          (group === "merchants"
            ? e.merchantId === chosen.id
            : e.categories.some((c) => c.categoryId === chosen.id))),
    ),
    amount = (e: Report["entries"][number]) =>
      chosen && group === "categories"
        ? (e.categories.find((c) => c.categoryId === chosen.id)?.amountCents ??
          0)
        : e.amountCents,
    unresolved = report.months.reduce((n, m) => n + m.unresolvedCount, 0),
    displayed = series.filter((s) =>
      s.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
  return (
    <div className="trends-view">
      <div className="trends-intro">
        <div>
          <HelpHeading topic="spendingTrends">
            <h2>Spending trends</h2>
          </HelpHeading>
          <p>
            Your share after refunds, including goal-funded purchases, loan/debt
            payments and PayPal fees. Transfers, card payments, income and
            settlements are excluded.
          </p>
        </div>
        <label>
          Group spending by
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value as typeof group);
              setSelected("");
              setSearch("");
              setLimit(50);
            }}
          >
            <option value="categories">Category</option>
            <option value="merchants">Merchant / payee</option>
          </select>
        </label>
      </div>
      <p className="trends-context">
        Recorded activity only. Open months are provisional; missing months are
        not zero. Budget periods include explicit late-entry choices. Actual
        dates remain in the details.
      </p>
      {(unresolved > 0 || report.incompleteImportCount > 0) && (
        <p className="trends-warning" role="status">
          {unresolved} unresolved records in this year are excluded from
          confirmed spending. {report.incompleteImportCount} imports across this
          workspace still need attention. These figures may be incomplete.
        </p>
      )}
      {group === "merchants" && (
        <p className="trends-context">
          Merchant groups use current descriptions, ignoring case, punctuation
          and spacing. Different descriptions stay separate. Refunds use the
          original merchant; no source records are merged.
        </p>
      )}
      <section
        className="panel trends-chart"
        aria-label="Monthly spending trend"
      >
        <div className="panel-heading">
          <div>
            <h2>{chosen?.name ?? "All spending"}</h2>
            <p>
              {year} · Your share ·{" "}
              {chosen
                ? group === "categories"
                  ? "Category"
                  : "Merchant / payee"
                : "All categories"}
            </p>
          </div>
          {chosen && (
            <button
              className="secondary"
              onClick={() => {
                setSelected("");
                setLimit(50);
              }}
            >
              Show all spending
            </button>
          )}
        </div>
        <div className="trends-summary">
          <div>
            <span>Recorded total</span>
            <strong>{money(total)}</strong>
          </div>
          <div>
            <span>
              Average across {closed} closed {closed === 1 ? "month" : "months"}
            </span>
            <strong>{average === null ? "—" : money(average)}</strong>
          </div>
          <p>
            Completed zero months count in this average. Select a month to see
            its transactions below.
          </p>
        </div>
        <div className="trends-chart-scroll">
          <div className="trends-bars">
            {report.months.map((m, i) => {
              const value = values[i],
                previous = i ? values[i - 1] : null,
                delta =
                  value !== null && previous !== null ? value - previous : null;
              return (
                <button
                  key={m.month}
                  className={`trend-month ${value !== null && value < 0 ? "negative" : ""}`}
                  disabled={value === null}
                  aria-pressed={detailMonth === m.month}
                  aria-label={`${monthName(m.month)}: ${value === null ? stateLabel(m.status) : money(value)}, ${stateLabel(m.status)}${delta === null ? "" : `, change ${money(delta)}`}`}
                  onClick={() => {
                    setDetailMonth(m.month);
                    setLimit(50);
                  }}
                >
                  <span className="trend-value">
                    {value === null ? "—" : money(value)}
                  </span>
                  <span className="trend-plot" aria-hidden="true">
                    <span className="trend-zero" />
                    {value !== null && value !== 0 && (
                      <span
                        className="trend-bar"
                        style={{
                          height: `${Math.max(1, (Math.abs(value) / scale) * 44)}%`,
                        }}
                      />
                    )}
                  </span>
                  <strong>
                    {monthName(m.month).split(" ")[0].slice(0, 3)}
                  </strong>
                  <small>{stateLabel(m.status)}</small>
                  <small className="trend-delta">
                    {delta === null
                      ? "Change —"
                      : `${delta > 0 ? "+" : ""}${money(delta)}`}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
        <p className="trends-context">
          Change is versus the previous calendar month; unavailable when either
          month is untracked or future. Negative spending means refunds exceeded
          new spending.
        </p>
      </section>
      <section className="panel trends-ranking" aria-label="Spending groups">
        <div className="panel-heading">
          <div>
            <h2>
              {group === "categories" ? "Categories" : "Merchants & payees"}
            </h2>
            <p>
              Year total, highest first. Select a row to inspect its monthly
              pattern.
            </p>
          </div>
          <label>
            Find a group
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className="trends-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Year total</th>
                <th>Closed-month average</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((s) => (
                <tr key={s.id} className={selected === s.id ? "selected" : ""}>
                  <th>
                    <button
                      className="text-button"
                      aria-pressed={selected === s.id}
                      onClick={() => {
                        setSelected(s.id);
                        setLimit(50);
                      }}
                    >
                      {s.name}
                    </button>
                  </th>
                  <td>{money(s.totalCents)}</td>
                  <td>
                    {s.closedAverageCents === null
                      ? "—"
                      : money(s.closedAverageCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {displayed.length === 0 && (
          <p className="trends-empty">
            {search
              ? "No groups match this search."
              : "No recorded spending in the tracked months of this year."}
          </p>
        )}
      </section>
      <section
        className="panel trends-details"
        aria-label="Contributing transactions"
      >
        <div className="panel-heading">
          <div>
            <h2>Contributing transactions</h2>
            <p>
              {chosen?.name ?? "All spending"} · {details.length} records ·{" "}
              {money(details.reduce((n, e) => n + amount(e), 0))}
            </p>
          </div>
          <label>
            Detail month
            <select
              value={detailMonth}
              onChange={(e) => {
                setDetailMonth(e.target.value);
                setLimit(50);
              }}
            >
              <option value="">All tracked months</option>
              {report.months
                .filter((m) => m.spentCents !== null)
                .map((m) => (
                  <option key={m.month} value={m.month}>
                    {monthName(m.month)} · {stateLabel(m.status)}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="trends-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Actual date</th>
                <th>Budget month</th>
                <th>Description</th>
                <th>
                  Your{" "}
                  {chosen && group === "categories"
                    ? "category share"
                    : "share"}
                </th>
              </tr>
            </thead>
            <tbody>
              {details.slice(0, limit).map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td>{monthName(e.month)}</td>
                  <td>
                    {e.description}
                    <small>
                      {e.kind === "refund"
                        ? "Refund"
                        : e.kind === "debt_payment"
                          ? "Loan/debt payment"
                          : e.kind === "paypal_cashout"
                            ? "PayPal fee only"
                            : "Purchase"}
                    </small>
                  </td>
                  <td>{money(amount(e))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!details.length && (
          <p className="trends-empty">
            No contributing transactions for this selection.
          </p>
        )}
        {details.length > limit && (
          <button className="secondary" onClick={() => setLimit((n) => n + 50)}>
            Show 50 more transactions
          </button>
        )}
      </section>
    </div>
  );
}
