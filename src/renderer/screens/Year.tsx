import { Fragment } from "react";
import { FileDown } from "lucide-react";
import { call, toast, useQuery } from "../api";
import type { ScreenProps } from "../App";
import { formatMoney, type Cents } from "../../core/money";
import { summarizeYear, type YearLine } from "../../core/year";
import type { ExportRequest } from "../../shared/types";
import { Bar, Card } from "../components/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Whole dollars, so twelve months fit side by side. The exact amount is in the tooltip. */
const whole = (cents: Cents) => `${cents < 0 ? "-" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;

/** Ask where to save, then write the file. Used by every Export button. */
export async function saveExport(request: ExportRequest, format: "xlsx" | "csv"): Promise<void> {
  try {
    const file = await call("export.save", { ...request, format });
    if (file) toast(`Saved ${file}`);
  } catch (error) {
    toast((error as Error).message, "error");
  }
}

function Cells({ line, tone }: { line: YearLine; tone?: boolean }) {
  const cell = (cents: Cents, key: string | number) => (
    <td key={key} className={`num ${tone && cents < 0 ? "neg" : ""}`} title={cents === 0 ? undefined : formatMoney(cents)}>
      {cents === 0 ? <span className="muted">–</span> : whole(cents)}
    </td>
  );
  return (
    <>
      {line.monthly.map(cell)}
      {cell(line.total, "total")}
      {cell(line.average, "average")}
    </>
  );
}

export function YearView({ month, view, settings }: Pick<ScreenProps, "month" | "view" | "settings">) {
  const year = month.slice(0, 4);
  const data = useQuery("year.get", { year, view });
  if (!data) return null;
  const who = view === "hh" ? "Household" : settings.people[view];
  if (data.rows.length === 0) return <p className="empty">No entries in {year} yet.</p>;
  const s = summarizeYear(data.rows, settings.groups, data.monthsWithData);
  const top = Math.max(1, ...data.merchants.map((m) => m.cents));

  return (
    <div className="stack">
      <Card
        title={`${who} in ${year}`}
        action={
          <span className="inline-form">
            <span className="muted">
              Averages are over the {data.monthsWithData === 1 ? "one month" : `${data.monthsWithData} months`} with entries
            </span>
            <button type="button" className="btn" onClick={() => void saveExport({ scope: "year", month }, "xlsx")}>
              <FileDown size={15} aria-hidden="true" />
              Export {year}
            </button>
          </span>
        }
      >
        <div className="scroll-x">
          <table className="table year">
            <thead>
              <tr>
                <th>Category</th>
                {MONTHS.map((m) => (
                  <th key={m} className="num">
                    {m}
                  </th>
                ))}
                <th className="num">Total</th>
                <th className="num">Average</th>
              </tr>
            </thead>
            <tbody>
              {s.groups.map((g) => (
                <Fragment key={g.grp}>
                  <tr className="group-row">
                    <th scope="row">{g.grp}</th>
                    <Cells line={g} />
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={`${r.category_id}${r.name}`}>
                      <td>{r.name}</td>
                      <Cells line={r} />
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="total-row">
                <th scope="row">Spent and set aside</th>
                <Cells line={s.expenses} />
              </tr>
              <tr className="group-row">
                <th scope="row">Income</th>
                <Cells line={s.income} />
              </tr>
              {s.income.rows.map((r) => (
                <tr key={`${r.category_id}${r.name}`}>
                  <td>{r.name}</td>
                  <Cells line={r} />
                </tr>
              ))}
              <tr className="total-row">
                <th scope="row">Net</th>
                <Cells line={s.net} tone />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted small year-note">Whole dollars; hover a figure for cents. Purchases paid from a fund are left out, as on the Budget screen.</p>
      </Card>

      {data.pay.length > 0 && (
        <Card title="Hours and pay, by the month of the payday">
          <div className="scroll-x">
            <table className="table year">
              <thead>
                <tr>
                  <th />
                  {MONTHS.map((m) => (
                    <th key={m} className="num">
                      {m}
                    </th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.pay.map((p) => {
                  const hourly = p.hours.some((h) => h > 0);
                  const named = data.pay.length > 1;
                  const title = (label: string) => (named ? `${settings.people[p.person]}: ${label.toLowerCase()}` : label);
                  const money = (label: string, cents: Cents[]) => (
                    <tr key={`${p.person}${label}`}>
                      <td>{title(label)}</td>
                      {cents.map((c, i) => (
                        <td key={i} className="num" title={c === 0 ? undefined : formatMoney(c)}>
                          {c === 0 ? <span className="muted">–</span> : whole(c)}
                        </td>
                      ))}
                      <td className="num">{whole(cents.reduce((t, c) => t + c, 0))}</td>
                    </tr>
                  );
                  return (
                    <Fragment key={p.person}>
                      {hourly && (
                        <tr>
                          <td>{title("Hours")}</td>
                          {p.hours.map((h, i) => (
                            <td key={i} className="num">
                              {h === 0 ? <span className="muted">–</span> : Number(h.toFixed(1))}
                            </td>
                          ))}
                          <td className="num">{Number(p.hours.reduce((t, h) => t + h, 0).toFixed(1))}</td>
                        </tr>
                      )}
                      {hourly && money("Gross", p.gross_cents)}
                      {money("Take-home", p.net_cents)}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small year-note">Take-home is the real amount where it was typed on the Pay screen, and the prediction elsewhere.</p>
        </Card>
      )}

      {data.merchants.length > 0 && (
        <Card title="Where it went" action={<span className="muted">The {data.merchants.length} largest in {year}</span>}>
          <ul className="plain merchants">
            {data.merchants.map((m) => (
              <li key={m.name}>
                <span className="merchant-name">{m.name}</span>
                <span className="muted small">
                  {m.count} {m.count === 1 ? "time" : "times"}
                </span>
                <Bar used={m.cents} total={top} />
                <span className="money">{formatMoney(m.cents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
