import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { change, toast, useQuery } from "../api";
import type { ScreenProps } from "../App";
import { summarize, type BudgetRow } from "../../core/budget";
import { monthLabel } from "../../core/dates";
import { formatMoney } from "../../core/money";
import type { Person } from "../../core/split";
import { CategoryIcon } from "../components/Icon";
import { AmountInput, Bar, Card, Money, Segmented, TextCell } from "../components/ui";
import { YearView } from "./Year";

export function Budget({ month, view, settings }: ScreenProps) {
  const budget = useQuery("budget.get", { month, view });
  const [forward, setForward] = useState(false);
  const [mode, setMode] = useState<"month" | "year">("month");
  if (!budget) return null;
  const modeSwitch = (
    <div className="toolbar">
      <Segmented
        ariaLabel="Month or year"
        value={mode}
        onChange={setMode}
        options={[
          { value: "month", label: monthLabel(month) },
          { value: "year", label: `All of ${month.slice(0, 4)}` },
        ]}
      />
    </div>
  );
  if (mode === "year")
    return (
      <div className="stack">
        {modeSwitch}
        <YearView month={month} view={view} settings={settings} />
      </div>
    );
  const s = summarize(budget.rows, settings.groups);
  const person: Person | null = view === "hh" ? null : view;
  const end = budget.startBalanceCents + s.net;

  const setPlanned = (row: BudgetRow, planned_cents: number) => {
    if (person) void change("budget.setPlanned", { month, person, category_id: row.category_id, planned_cents, forward });
  };
  const rename = (row: BudgetRow, name: string) => void change("categories.update", { id: row.category_id, patch: { name } });
  const remove = async (row: BudgetRow) => {
    const result = await change("categories.remove", { id: row.category_id });
    if (result) toast(result === "archived" ? `${row.name} has history, so it was archived. Restore it in Settings.` : `${row.name} deleted`);
  };

  const table = (rows: BudgetRow[], income: boolean, total: { planned: number; actual: number }, totalLabel: string) => (
    <table className="table budget">
      <thead>
        <tr>
          <th>Category</th>
          <th className="num">Planned</th>
          <th className="num">Actual</th>
          <th className="num">{income ? "Over plan" : "Left"}</th>
          <th className="barcol" aria-label="Progress" />
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const fixed = r.category_id === 0;
          const diff = income ? r.actual - r.planned : r.planned - r.actual;
          return (
            <tr key={`${r.category_id}-${r.kind}`} className={r.archived ? "archived" : ""}>
              <td className="wide">
                <span className="with-icon">
                  <CategoryIcon name={r.icon} />
                  {fixed ? r.name : <TextCell value={r.name} ariaLabel={`Name of ${r.name}`} onCommit={(name) => rename(r, name)} />}
                  {r.archived && <span className="tag">archived</span>}
                </span>
              </td>
              <td className="num">
                {person && !fixed ? (
                  <AmountInput cents={r.planned} allowZero ariaLabel={`Planned for ${r.name}`} onCommit={(c) => setPlanned(r, c)} />
                ) : (
                  formatMoney(r.planned)
                )}
              </td>
              <td className="num">{formatMoney(r.actual)}</td>
              <td className="num">
                <Money cents={diff} tone />
              </td>
              <td className="barcol">
                <Bar used={r.actual} total={r.planned} />
              </td>
              <td className="actions">
                {!fixed && !r.archived && (
                  <button type="button" className="icon-btn" aria-label={`Remove ${r.name}`} title="Remove category" onClick={() => void remove(r)}>
                    <X size={14} />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td>{totalLabel}</td>
          <td className="num">{formatMoney(total.planned)}</td>
          <td className="num">{formatMoney(total.actual)}</td>
          <td className="num">
            <Money cents={income ? total.actual - total.planned : total.planned - total.actual} tone />
          </td>
          <td colSpan={2} />
        </tr>
      </tfoot>
    </table>
  );

  return (
    <div className="stack">
      {modeSwitch}
      <div className="grid stats">
        <Card title="Income">
          <p className="stat">{formatMoney(s.income.actual)}</p>
          <p className="muted">of {formatMoney(s.income.planned)} planned</p>
        </Card>
        <Card title="Spent and set aside">
          <p className="stat">{formatMoney(s.expenses.actual)}</p>
          <p className="muted">of {formatMoney(s.expenses.planned)} planned</p>
        </Card>
        <Card title="Left to spend">
          <p className="stat">
            <Money cents={s.leftToSpend} tone />
          </p>
          <p className="muted">Planned minus used</p>
        </Card>
        <Card title="End balance">
          <p className="stat">{formatMoney(end)}</p>
          <p className="stat-line">
            Started at
            {person ? (
              <AmountInput cents={budget.startBalanceCents} allowZero ariaLabel="Starting balance" onCommit={(cents) => void change("budget.setStartBalance", { month, person, cents })} />
            ) : (
              ` ${formatMoney(budget.startBalanceCents)}`
            )}
          </p>
        </Card>
      </div>

      {person ? (
        <label className="check-line">
          <input type="checkbox" checked={forward} onChange={(e) => setForward(e.target.checked)} />
          Planned amounts I change here also apply to later months
        </label>
      ) : (
        <p className="muted">Household adds both plans together. Switch to a person to change planned amounts.</p>
      )}

      {s.groups.map((g) => {
        const target = person ? settings.targets[person]?.[g.grp] : undefined;
        return (
          <Card
            key={g.grp}
            title={g.grp}
            action={
              <span className="muted">
                {g.plannedShare !== null ? `${g.plannedShare}% of planned income` : ""}
                {target !== undefined ? ` · target ${target}%` : ""}
              </span>
            }
          >
            {table(g.rows, false, g, `${g.grp} total`)}
            {g.grp !== "Uncategorized" && <AddCategory grp={g.grp} kind="expense" />}
          </Card>
        );
      })}

      <Card title="Income">
        {table(s.income.rows, true, s.income, "Income total")}
        <AddCategory grp="Income" kind="income" />
      </Card>
    </div>
  );
}

function AddCategory({ grp, kind }: { grp: string; kind: "expense" | "income" }) {
  const [name, setName] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (await change("categories.create", { name, grp, kind })) setName("");
  };
  return (
    <form className="inline-form add-line" onSubmit={(e) => void submit(e)}>
      <input aria-label={`New ${grp} category`} placeholder={`Add a category to ${grp}`} value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn ghost" disabled={!name.trim()}>
        <Plus size={14} aria-hidden="true" />
        Add
      </button>
    </form>
  );
}
