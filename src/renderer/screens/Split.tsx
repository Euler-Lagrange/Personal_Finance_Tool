import { useQuery } from "../api";
import type { ScreenProps } from "../App";
import { balanceDelta } from "../../core/balance";
import { shortDate } from "../../core/dates";
import { formatMoney } from "../../core/money";
import { Card } from "../components/ui";
import { BalanceCard } from "./Dashboard";

export function SplitScreen({ month, settings }: ScreenProps) {
  const entries = useQuery("entries.list", { month });
  if (!entries) return null;
  const moving = entries.filter((e) => balanceDelta(e) !== 0);
  const { a, b } = settings.people;
  return (
    <div className="stack">
      <div className="grid stats">
        <BalanceCard month={month} settings={settings} />
        <Card title="How it adds up" className="span-2">
          <p className="muted">
            Every shared purchase puts the other person's share on the balance. A settlement takes it off. The balance carried in from before the app is{" "}
            {settings.openingBalanceCents === 0
              ? "zero"
              : `${formatMoney(Math.abs(settings.openingBalanceCents))} owed by ${settings.openingBalanceCents > 0 ? b : a}`}
            ; change it in <a href="#/settings">Settings</a>.
          </p>
        </Card>
      </div>

      <Card title="This month's shared entries">
        {moving.length === 0 ? (
          <p className="muted">Nothing shared this month yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Paid by</th>
                <th className="num">Total</th>
                <th className="num">{a}</th>
                <th className="num">{b}</th>
                <th className="num">Effect on balance</th>
              </tr>
            </thead>
            <tbody>
              {moving.map((e) => {
                const delta = balanceDelta(e);
                const ower = e.kind === "settlement" ? settings.people[e.paid_by] : delta > 0 ? b : a;
                const change = e.kind === "settlement" ? -e.amount_cents : Math.abs(delta);
                return (
                  <tr key={e.id}>
                    <td className="nowrap muted">{shortDate(e.date)}</td>
                    <td>{e.description}</td>
                    <td>{settings.people[e.paid_by]}</td>
                    <td className="num">{formatMoney(e.amount_cents)}</td>
                    <td className="num">{e.kind === "settlement" ? "" : formatMoney(e.a_cents)}</td>
                    <td className="num">{e.kind === "settlement" ? "" : formatMoney(e.b_cents)}</td>
                    <td className="num">
                      {ower} owes {formatMoney(change, { plus: true })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Recurring bills arrive in milestone 4" className="coming">
        <ul>
          <li>Bill templates that create each month's entries</li>
          <li>A split rule per bill, and the statement PDF</li>
        </ul>
      </Card>
    </div>
  );
}
