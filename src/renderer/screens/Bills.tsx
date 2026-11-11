import { useState, type FormEvent } from "react";
import { FileDown, Plus, Power, Trash2 } from "lucide-react";
import { change, toast, useQuery } from "../api";
import type { ScreenProps } from "../App";
import { daysInMonth, monthLabel, toISO } from "../../core/dates";
import { formatMoney, parseMoney } from "../../core/money";
import type { Person } from "../../core/split";
import type { BillInput, BillRow, TemplateSplit } from "../../shared/types";
import { AmountInput, Card, SplitSelect, TextCell } from "../components/ui";

type Props = Pick<ScreenProps, "month" | "settings" | "categories">;

/** The split menu for a bill: the household default, a preset, or a custom share. */
export function BillSplit({ value, onChange, settings }: { value: TemplateSplit; onChange: (split: TemplateSplit) => void; settings: Props["settings"] }) {
  return (
    <SplitSelect
      value={value.type === "default" ? null : value}
      settings={settings}
      ariaLabel="Split"
      onChange={onChange}
      leading={{ label: "Default", active: value.type === "default", onPick: () => onChange({ type: "default" }) }}
    />
  );
}

export function Bills({ month, settings, categories }: Props) {
  const data = useQuery("bills.list", { month, today: toISO(new Date()) });
  if (!data) return null;
  const active = data.rows.filter((r) => r.active);
  const off = data.rows.filter((r) => !r.active);
  const withEntry = active.filter((r) => r.entry);
  const total = withEntry.reduce((t, r) => t + r.entry!.amount_cents, 0);
  const totalA = withEntry.reduce((t, r) => t + r.entry!.a_cents, 0);
  const totalB = withEntry.reduce((t, r) => t + r.entry!.b_cents, 0);
  const expenseCategories = categories.filter((c) => c.kind === "expense" && !c.archived);
  const merged = settings.mergedFinances;
  const update = (r: BillRow, patch: Partial<BillInput> & { active?: boolean }) => void change("bills.update", { id: r.id, patch, month });
  const remove = async (r: BillRow) => {
    await change("bills.remove", { id: r.id });
    toast(`${r.name} deleted. Its past entries are kept. Ctrl+Z brings it back.`);
  };
  const generate = async () => {
    const made = await change("bills.generate", { month });
    if (made !== undefined) toast(`${made} ${made === 1 ? "bill" : "bills"} created for ${monthLabel(month)}`);
  };

  return (
    <Card
      title={`Bills for ${monthLabel(month)}`}
      action={
        <span className="muted">
          {formatMoney(total)} this month · {formatMoney(Math.round(total / daysInMonth(month)))} a day
        </span>
      }
    >
      {data.missing > 0 && (
        <p className="notice">
          {data.missing} {data.missing === 1 ? "bill has" : "bills have"} no entry for {monthLabel(month)}.
          <button type="button" className="btn" onClick={() => void generate()}>
            Create {data.missing === 1 ? "it" : "them"}
          </button>
        </p>
      )}
      {active.length === 0 ? (
        <p className="muted">No bills yet. Add the first one below; it creates its entry each month so you only correct the amounts that change.</p>
      ) : (
        <div className="scroll-x">
          <table className="table edit bills">
            <thead>
              <tr>
                <th className="check">Paid</th>
                <th>Bill</th>
                <th>Due day</th>
                <th>Category</th>
                <th>Paid by</th>
                {!merged && <th>Split</th>}
                <th className="num">Usual</th>
                <th className="num">This month</th>
                {!merged && <th className="num">{settings.people.a}</th>}
                {!merged && <th className="num">{settings.people.b}</th>}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {active.map((r) => {
                const changed = r.entry && r.previous_cents !== null ? r.entry.amount_cents - r.previous_cents : 0;
                return (
                  <tr key={r.id}>
                    <td className="check">
                      <input
                        type="checkbox"
                        aria-label={`${r.name} paid`}
                        title={r.entry ? "Tick when it has left the bank" : "No entry this month yet"}
                        disabled={!r.entry}
                        checked={r.entry?.seen_in_bank ?? false}
                        onChange={(e) => r.entry && void change("entries.setSeen", { id: r.entry.id, seen: e.target.checked })}
                      />
                    </td>
                    <td className="wide">
                      <TextCell value={r.name} ariaLabel={`Name of ${r.name}`} onCommit={(name) => update(r, { name })} />
                    </td>
                    <td>
                      <TextCell
                        className="day"
                        value={String(r.due_day)}
                        ariaLabel={`Due day for ${r.name}`}
                        onCommit={(text) => (/^\d{1,2}$/.test(text.trim()) ? update(r, { due_day: Number(text) }) : toast("Enter a due day from 1 to 31", "error"))}
                      />
                    </td>
                    <td>
                      <select className="cell cat" aria-label={`Category for ${r.name}`} value={r.category_id ?? ""} onChange={(e) => update(r, { category_id: e.target.value === "" ? null : Number(e.target.value) })}>
                        <option value="">Uncategorized</option>
                        {categories
                          .filter((c) => c.kind === "expense" && (!c.archived || c.id === r.category_id))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td>
                      <select className="cell" aria-label={`Who pays ${r.name}`} value={r.paid_by} onChange={(e) => update(r, { paid_by: e.target.value as Person })}>
                        <option value="a">{settings.people.a}</option>
                        <option value="b">{settings.people.b}</option>
                      </select>
                    </td>
                    {!merged && (
                      <td>
                        <BillSplit value={r.split} settings={settings} onChange={(split) => update(r, { split })} />
                      </td>
                    )}
                    <td className="num">
                      <AmountInput cents={r.expected_cents} allowZero ariaLabel={`Usual amount for ${r.name}`} onCommit={(amount_cents) => update(r, { amount_cents })} />
                    </td>
                    <td className="num">
                      <span className="month-cell">
                        {changed !== 0 && (
                          <span className={`tag ${changed > 0 ? "up" : "down"}`} title={`${formatMoney(Math.abs(changed))} ${changed > 0 ? "more" : "less"} than last time (${formatMoney(r.previous_cents!)})`}>
                            {formatMoney(changed, { plus: true })}
                          </span>
                        )}
                        <AmountInput
                          cents={r.entry?.amount_cents ?? null}
                          allowZero
                          placeholder="none yet"
                          ariaLabel={`${r.name} this month`}
                          onCommit={(amount_cents) => void change("bills.setMonthAmount", { id: r.id, month, amount_cents })}
                        />
                      </span>
                    </td>
                    {!merged && <td className="num muted">{r.entry ? formatMoney(r.entry.a_cents) : ""}</td>}
                    {!merged && <td className="num muted">{r.entry ? formatMoney(r.entry.b_cents) : ""}</td>}
                    <td className="actions">
                      <button type="button" className="icon-btn" aria-label={`Switch off ${r.name}`} title="Switch off: keeps the bill but stops creating it" onClick={() => update(r, { active: false })}>
                        <Power size={14} />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => void remove(r)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={merged ? 6 : 7}>Total</td>
                <td className="num">{formatMoney(total)}</td>
                {!merged && <td className="num">{formatMoney(totalA)}</td>}
                {!merged && <td className="num">{formatMoney(totalB)}</td>}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <AddBill month={month} settings={settings} categories={expenseCategories} />

      {off.length > 0 && (
        <>
          <h3>Switched off</h3>
          <ul className="chips">
            {off.map((r) => (
              <li key={r.id} className="chip">
                {r.name}
                <button type="button" className="icon-btn" aria-label={`Switch on ${r.name}`} title="Switch on" onClick={() => update(r, { active: true })}>
                  <Power size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function AddBill({ month, settings, categories }: Props) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("1");
  const [categoryId, setCategoryId] = useState("");
  const [paidBy, setPaidBy] = useState<Person>("a");
  const [split, setSplit] = useState<TemplateSplit>({ type: "default" });
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cents = amount.trim() === "" ? 0 : parseMoney(amount);
    if (!name.trim()) return setError("Enter a name for the bill");
    if (cents === null || cents < 0) return setError("Enter the usual amount, or leave it empty if it varies");
    if (!/^\d{1,2}$/.test(day.trim()) || Number(day) < 1 || Number(day) > 31) return setError("Enter a due day from 1 to 31");
    setError(null);
    const id = await change("bills.create", { name, category_id: categoryId === "" ? null : Number(categoryId), due_day: Number(day), amount_cents: cents, paid_by: paidBy, split, month });
    if (id !== undefined) {
      setName("");
      setAmount("");
    }
  };
  return (
    <form className="quickadd add-bill" onSubmit={(e) => void submit(e)} aria-label="Add a bill">
      <div className="quickadd-fields">
        <label className="grow">
          <span>New bill</span>
          <input value={name} placeholder="Electric" onChange={(e) => (setName(e.target.value), setError(null))} />
        </label>
        <label className="narrow">
          <span>Usual amount</span>
          <input inputMode="decimal" value={amount} placeholder="varies" onChange={(e) => (setAmount(e.target.value), setError(null))} />
        </label>
        <label className="tiny">
          <span>Due day</span>
          <input inputMode="numeric" value={day} onChange={(e) => (setDay(e.target.value), setError(null))} />
        </label>
        <label>
          <span>Category</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Paid by</span>
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value as Person)}>
            <option value="a">{settings.people.a}</option>
            <option value="b">{settings.people.b}</option>
          </select>
        </label>
        {!settings.mergedFinances && (
          <label>
            <span>Split</span>
            <BillSplit value={split} onChange={setSplit} settings={settings} />
          </label>
        )}
        <button type="submit" className="btn primary">
          <Plus size={15} aria-hidden="true" />
          Add bill
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Saves one person's month as a PDF they can read on a phone. */
export function StatementCard({ month, settings }: Pick<Props, "month" | "settings">) {
  const [person, setPerson] = useState<Person>("b");
  const save = async () => {
    const file = await change("statement.save", { month, person });
    if (file) toast(`Statement saved to ${file}`);
  };
  return (
    <Card title="Statement" className="span-2">
      <p className="muted">
        A PDF of {monthLabel(month)} for one person: shared bills with their share, other shared purchases, settlements, the balance and their own budget. Save it into a OneDrive folder you share.
      </p>
      <div className="inline-form">
        <select aria-label="Who the statement is for" value={person} onChange={(e) => setPerson(e.target.value as Person)}>
          <option value="b">For {settings.people.b}</option>
          <option value="a">For {settings.people.a}</option>
        </select>
        <button type="button" className="btn" onClick={() => void save()}>
          <FileDown size={15} aria-hidden="true" />
          Save PDF
        </button>
      </div>
    </Card>
  );
}
