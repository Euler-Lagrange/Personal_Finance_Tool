import { useState } from "react";
import { change, toast, useQuery } from "../api";
import type { ScreenProps } from "../App";
import { whoOwes } from "../../core/balance";
import { summarize } from "../../core/budget";
import { addDays, monthOf, shortDate, toISO } from "../../core/dates";
import { formatMoney } from "../../core/money";
import { CategoryIcon } from "../components/Icon";
import { AmountInput, Bar, Card, Money } from "../components/ui";
import type { Settings } from "../../shared/types";

export function Dashboard({ month, view, settings }: ScreenProps) {
  const budget = useQuery("budget.get", { month, view });
  const entries = useQuery("entries.list", { month });
  if (!budget || !entries) return null;
  const s = summarize(budget.rows, settings.groups);
  const who = view === "hh" ? "Household" : settings.people[view];
  const over = s.groups.flatMap((g) => g.rows).filter((r) => r.actual > r.planned && r.planned > 0);
  const share = (e: (typeof entries)[number]) => (view === "hh" ? e.amount_cents : view === "a" ? e.a_cents : e.b_cents);

  return (
    <div className="grid dash">
      <section className="hero">
        <p className="eyebrow">{who} · left to spend</p>
        <p className="hero-number">{formatMoney(s.leftToSpend)}</p>
        <Bar used={s.expenses.actual} total={s.expenses.planned} />
        <p className="hero-sub">
          {formatMoney(s.expenses.actual)} used of {formatMoney(s.expenses.planned)} planned
        </p>
      </section>

      <Card title="Income">
        <p className="stat">{formatMoney(s.income.actual)}</p>
        <p className="muted">of {formatMoney(s.income.planned)} planned</p>
      </Card>

      <Card title="Net so far">
        <p className="stat">
          <Money cents={s.net} tone />
        </p>
        <p className="muted">Income received minus money spent or set aside</p>
      </Card>

      <Card title="Needs, wants and savings" className="span-2">
        {s.groups.map((g) => {
          const target = view === "hh" ? undefined : settings.targets[view]?.[g.grp];
          return (
            <div className="group-line" key={g.grp}>
              <div className="group-line-head">
                <strong>{g.grp}</strong>
                <span className="muted">
                  {g.plannedShare !== null ? `${g.plannedShare}% of planned income` : "No planned income yet"}
                  {target !== undefined ? ` · target ${target}%` : ""}
                </span>
                <span className="group-line-amount">
                  {formatMoney(g.actual)} / {formatMoney(g.planned)}
                </span>
              </div>
              <Bar used={g.actual} total={g.planned} />
            </div>
          );
        })}
      </Card>

      <BalanceCard month={month} settings={settings} />

      <div className="stack">
        <NextPaycheck view={view} settings={settings} />
        <BillsDue />
        <Card title="Over plan">
          {over.length === 0 ? (
            <p className="muted">Every category is within its plan.</p>
          ) : (
            <ul className="plain">
              {over.map((r) => (
                <li key={r.category_id} className="row-line">
                  <span className="with-icon">
                    <CategoryIcon name={r.icon} /> {r.name}
                  </span>
                  <span className="money neg">{formatMoney(r.actual - r.planned)} over</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent entries" className="span-2" action={<a href="#/transactions">View all</a>}>
        {entries.length === 0 ? (
          <p className="muted">
            No entries this month. <a href="#/transactions">Add the first one</a>.
          </p>
        ) : (
          <table className="table compact">
            <tbody>
              {entries.slice(0, 8).map((e) => (
                <tr key={e.id}>
                  <td className="nowrap muted">{shortDate(e.date)}</td>
                  <td>{e.description}</td>
                  <td className="muted">{e.kind === "settlement" ? "Settlement" : (e.category_name ?? "Uncategorized")}</td>
                  <td className="num">{formatMoney(e.amount_cents)}</td>
                  <td className="num muted">{e.kind === "settlement" ? "" : formatMoney(share(e))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/** The next payday for whoever is on screen, once their pay is set up. */
function NextPaycheck({ view, settings }: Pick<ScreenProps, "view" | "settings">) {
  const a = useQuery("pay.next", { person: "a" });
  const b = useQuery("pay.next", { person: "b" });
  const rows = (view === "hh" ? (["a", "b"] as const) : [view]).flatMap((p) => {
    const check = p === "a" ? a : b;
    return check ? [{ p, check }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <Card title="Next paycheck" action={<a href="#/pay">Pay</a>}>
      <ul className="plain">
        {rows.map(({ p, check }) => {
          const takeHome = check.actual_net_cents ?? check.predicted_net_cents;
          return (
            <li key={p} className="next-pay">
              <div className="row-line">
                <span>
                  {view === "hh" ? `${settings.people[p]} · ` : ""}
                  {new Date(`${check.pay_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  {check.kind === "hourly" && <span className="muted"> · {Number(check.hours.toFixed(2))} hours so far</span>}
                </span>
                <strong className="money">{takeHome === null ? "–" : formatMoney(takeHome)}</strong>
              </div>
              {takeHome !== null && check.bills_cents > 0 && (
                <p className="muted small">
                  {formatMoney(check.bills_cents)} of bills before the one after, leaving {formatMoney(takeHome - check.bills_cents)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Bills due in the next seven days that have not been ticked as paid. Always about today, whatever month is on screen. */
function BillsDue() {
  const today = toISO(new Date());
  const bills = useQuery("bills.list", { month: monthOf(today), today });
  if (!bills) return null;
  const until = addDays(today, 7);
  const due = bills.rows.filter((r) => r.active && r.entry && !r.entry.seen_in_bank && r.entry.date >= today && r.entry.date <= until);
  return (
    <Card title="Bills due this week" action={<a href="#/split">All bills</a>}>
      {due.length === 0 ? (
        <p className="muted">{bills.rows.length === 0 ? "No bills set up yet." : "Nothing due in the next seven days."}</p>
      ) : (
        <ul className="plain">
          {due.map((r) => (
            <li key={r.id} className="row-line">
              <span>
                {r.name} <span className="muted">· {shortDate(r.entry!.date)}</span>
              </span>
              <span className="money">{formatMoney(r.entry!.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The running balance between the two people, with a one-step settle up. */
export function BalanceCard({ month, settings }: { month: string; settings: Settings }) {
  const bal = useQuery("balance.get", { month });
  const [settling, setSettling] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  if (!bal) return null;
  const owes = whoOwes(bal.cents);
  const settle = async (cents: number) => {
    if (!owes) return;
    const done = await change("entries.create", { date: toISO(new Date()), description: "Settle up", amount_cents: cents, kind: "settlement", category_id: null, paid_by: owes.from });
    if (done) {
      setSettling(false);
      setAmount(null);
      toast(`Recorded ${formatMoney(cents)} from ${settings.people[owes.from]}`);
    }
  };
  return (
    <Card title="Balance" className="span-1">
      {owes ? (
        <>
          <p className="muted">
            {settings.people[owes.from]} owes {settings.people[owes.to]}
          </p>
          <p className="stat">{formatMoney(owes.amount)}</p>
        </>
      ) : (
        <p className="stat">All square</p>
      )}
      <p className="muted">
        {bal.monthDeltaCents === 0
          ? "No change this month"
          : `This month added ${formatMoney(Math.abs(bal.monthDeltaCents))} to what ${settings.people[bal.monthDeltaCents > 0 ? "b" : "a"]} owes`}
      </p>
      {owes &&
        (settling ? (
          <div className="inline-form">
            <AmountInput cents={amount ?? owes.amount} ariaLabel="Amount to settle" onCommit={setAmount} />
            <button type="button" className="btn" onClick={() => void settle(amount ?? owes.amount)}>
              Record
            </button>
            <button type="button" className="btn ghost" onClick={() => setSettling(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setSettling(true)}>
            Settle up
          </button>
        ))}
    </Card>
  );
}
