import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, Plus, Power, Trash2 } from "lucide-react";
import { call, change, refresh, toast, useQuery } from "../api";
import type { ScreenProps } from "../App";
import { monthLabel, toISO } from "../../core/dates";
import { formatMoney, parseMoney } from "../../core/money";
import { perPeriod } from "../../core/savings";
import type { Person } from "../../core/split";
import type { Category, FundRow, RenewalInput, RenewalRow, Runway, TemplateSplit, View } from "../../shared/types";
import { AmountInput, Bar, Card, TextCell } from "../components/ui";
import { BillSplit } from "./Bills";

type Props = Pick<ScreenProps, "month" | "settings" | "categories">;

export function Savings(props: Props) {
  const funds = useQuery("funds.list", { month: props.month });
  if (!funds) return null;
  return (
    <div className="stack">
      <Funds {...props} funds={funds.funds} runway={funds.runway} />
      <Renewals {...props} funds={funds.funds} />
    </div>
  );
}

const expenseOptions = (categories: Category[], keepId: number | null) => categories.filter((c) => c.kind === "expense" && (!c.archived || c.id === keepId));

function OwnerSelect({ value, onChange, settings, ariaLabel, className }: { value: View; onChange: (owner: View) => void; settings: Props["settings"]; ariaLabel: string; className?: string }) {
  return (
    <select className={className} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value as View)}>
      <option value="a">{settings.people.a}</option>
      <option value="b">{settings.people.b}</option>
      <option value="hh">Household</option>
    </select>
  );
}

// ---- funds -------------------------------------------------------------------

function RunwayLine({ runway }: { runway: Runway }) {
  if (!runway.group) return null;
  if (runway.emergency_cents === 0)
    return <p className="muted">Tick Emergency on a fund to see how many months of {runway.group} spending it would cover.</p>;
  const basis = runway.basis === "spending" ? `the last ${runway.monthsUsed === 1 ? "month" : `${runway.monthsUsed} months`}` : "this month's plan";
  return (
    <p className="runway">
      {runway.months === null ? (
        <>Emergency funds hold {formatMoney(runway.emergency_cents)}. Once there is {runway.group} spending or a plan to measure against, this shows how many months they cover.</>
      ) : (
        <>
          Emergency funds of <strong className="money">{formatMoney(runway.emergency_cents)}</strong> cover <strong>{runway.months} months</strong> of {runway.group} spending{" "}
          <span className="muted">
            ({formatMoney(runway.monthly_cents)} a month, from {basis})
          </span>
        </>
      )}
    </p>
  );
}

function Funds({ month, settings, categories, funds, runway }: Props & { funds: FundRow[]; runway: Runway }) {
  const live = funds.filter((f) => !f.archived);
  const archived = funds.filter((f) => f.archived);
  const update = (f: FundRow, patch: Parameters<typeof call<"funds.update">>[1]["patch"]) => void change("funds.update", { id: f.id, patch });
  const remove = async (f: FundRow) => {
    if ((await change("funds.remove", { id: f.id })) !== undefined) toast(`${f.name} deleted. Ctrl+Z brings it back.`);
  };
  const total = live.reduce((t, f) => t + f.balance_cents, 0);
  return (
    <Card title="Funds" action={live.length > 0 ? <span className="muted">{formatMoney(total)} set aside in all</span> : undefined}>
      <RunwayLine runway={runway} />
      {live.length === 0 ? (
        <p className="muted">
          A fund is a pot of savings with a balance: an emergency fund, a repairs fund, a down payment. Every expense in the budget category that feeds it adds to it. A purchase marked as paid from it draws it down and stays out of the
          month's budget.
        </p>
      ) : (
        <div className="scroll-x">
          <table className="table edit funds">
            <thead>
              <tr>
                <th>Fund</th>
                <th>Whose</th>
                <th title="Every expense in this budget category is money set aside into the fund">Fed by</th>
                <th className="num" title="Type what is really in the fund to true it up">
                  Balance
                </th>
                <th className="num">Target</th>
                <th className="num">{monthLabel(month).split(" ")[0]} in / out</th>
                <th className="check" title="Counts toward the emergency runway">
                  Emergency
                </th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {live.map((f) => (
                <tr key={f.id}>
                  <td className="wide">
                    <TextCell value={f.name} ariaLabel={`Name of ${f.name}`} onCommit={(name) => update(f, { name })} />
                  </td>
                  <td>
                    <OwnerSelect className="cell" value={f.owner} settings={settings} ariaLabel={`Whose fund ${f.name} is`} onChange={(owner) => update(f, { owner })} />
                  </td>
                  <td>
                    <select className="cell cat" aria-label={`Category that feeds ${f.name}`} value={f.category_id ?? ""} onChange={(e) => update(f, { category_id: e.target.value === "" ? null : Number(e.target.value) })}>
                      <option value="">Nothing</option>
                      {expenseOptions(categories, f.category_id).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <AmountInput cents={f.balance_cents} allowZero ariaLabel={`Balance of ${f.name}`} onCommit={(balance_cents) => void change("funds.setBalance", { id: f.id, balance_cents })} />
                  </td>
                  <td className="num">
                    <AmountInput cents={f.target_cents} placeholder="None" ariaLabel={`Target for ${f.name}`} onCommit={(target_cents) => update(f, { target_cents })} onClear={() => update(f, { target_cents: null })} />
                    {f.target_cents !== null && <Bar used={Math.max(0, Math.min(f.balance_cents, f.target_cents))} total={f.target_cents} />}
                  </td>
                  <td className="num muted nowrap">
                    {f.month_in_cents === 0 && f.month_out_cents === 0 ? "–" : `${formatMoney(f.month_in_cents, { plus: true })} / ${formatMoney(-f.month_out_cents)}`}
                  </td>
                  <td className="check">
                    <input type="checkbox" aria-label={`${f.name} counts as emergency savings`} checked={f.emergency} onChange={(e) => update(f, { emergency: e.target.checked })} />
                  </td>
                  <td className="actions">
                    <button type="button" className="icon-btn" aria-label={`Archive ${f.name}`} title="Archive: hides the fund and keeps its history" onClick={() => update(f, { archived: true })}>
                      <Archive size={14} />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Delete ${f.name}`} title="Delete" onClick={() => void remove(f)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {live.length > 0 && <p className="muted small funds-note">To spend from a fund, open Transactions, show the Paid from column, and pick the fund on the purchase.</p>}
      <AddFund settings={settings} categories={categories} taken={funds.map((f) => f.category_id)} />
      {archived.length > 0 && (
        <ul className="chips">
          <li className="muted">Archived:</li>
          {archived.map((f) => (
            <li key={f.id} className="chip">
              {f.name} · {formatMoney(f.balance_cents)}
              <button type="button" className="icon-btn" aria-label={`Bring back ${f.name}`} title="Bring back" onClick={() => update(f, { archived: false })}>
                <ArchiveRestore size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AddFund({ settings, categories, taken }: { settings: Props["settings"]; categories: Category[]; taken: (number | null)[] }) {
  const [name, setName] = useState("");
  const [owner, setOwner] = useState<View>("hh");
  const [category, setCategory] = useState("");
  const [balance, setBalance] = useState("");
  const [target, setTarget] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const balance_cents = balance.trim() === "" ? 0 : parseMoney(balance);
    const target_cents = target.trim() === "" ? null : parseMoney(target);
    if (balance_cents === null) return setError("Enter what is in the fund today, or leave it empty");
    if (target.trim() !== "" && target_cents === null) return setError("Enter the target as an amount, or leave it empty");
    try {
      await call("funds.create", { name, owner, target_cents, category_id: category === "" ? null : Number(category), emergency, balance_cents });
      refresh();
      setName("");
      setCategory("");
      setBalance("");
      setTarget("");
      setEmergency(false);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="quickadd add-bill add-fund" onSubmit={(e) => void submit(e)}>
      <div className="quickadd-fields">
        <label className="grow">
          <span>New fund</span>
          <input value={name} placeholder="Emergency fund" onChange={(e) => (setName(e.target.value), setError(null))} />
        </label>
        <label>
          <span>Whose</span>
          <OwnerSelect className="cell" value={owner} settings={settings} ariaLabel="Whose fund" onChange={setOwner} />
        </label>
        <label>
          <span>Fed by</span>
          <select className="cell" value={category} onChange={(e) => (setCategory(e.target.value), setError(null))}>
            <option value="">Nothing yet</option>
            {expenseOptions(categories, null)
              .filter((c) => !taken.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="narrow">
          <span>In it today</span>
          <input inputMode="decimal" value={balance} placeholder="0.00" onChange={(e) => (setBalance(e.target.value), setError(null))} />
        </label>
        <label className="narrow">
          <span>Target</span>
          <input inputMode="decimal" value={target} placeholder="None" onChange={(e) => (setTarget(e.target.value), setError(null))} />
        </label>
        <label className="check-line">
          <input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />
          Emergency
        </label>
        <button type="submit" className="btn primary">
          <Plus size={15} aria-hidden="true" />
          Add fund
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

// ---- renewals ----------------------------------------------------------------

function Renewals({ settings, categories, funds }: Props & { funds: FundRow[] }) {
  const today = toISO(new Date());
  const data = useQuery("renewals.list", { today });
  if (!data) return null;
  const active = data.rows.filter((r) => r.active);
  const off = data.rows.filter((r) => !r.active);
  const update = (r: RenewalRow, patch: Partial<RenewalInput> & { active?: boolean }) => void change("renewals.update", { id: r.id, patch });
  const remove = async (r: RenewalRow) => {
    if ((await change("renewals.remove", { id: r.id })) !== undefined) toast(`${r.name} deleted. Its past entries are kept. Ctrl+Z brings it back.`);
  };
  const liveFunds = funds.filter((f) => !f.archived);
  const people = (["a", "b"] as Person[]).filter((p) => data.yearly_cents[p] > 0);

  return (
    <Card title="Renewals" action={active.length > 0 ? <span className="muted">{formatMoney(data.yearly_cents.a + data.yearly_cents.b)} a year</span> : undefined}>
      {active.length === 0 ? (
        <p className="muted">
          Things that come round every so many months: a yearly subscription, a car registration, a twice-yearly premium. Each becomes an entry on its date, and this card shows what to set aside from each paycheck so the money is there.
        </p>
      ) : (
        <>
          <ul className="plain set-aside">
            {people.map((p) => (
              <li key={p}>
                <strong>{settings.people[p]}</strong> needs {formatMoney(data.yearly_cents[p])} a year: set aside <strong className="money">{formatMoney(perPeriod(data.yearly_cents[p], 12))}</strong> a month
                {data.checksPerYear[p] ? (
                  <>
                    , or <strong className="money">{formatMoney(perPeriod(data.yearly_cents[p], data.checksPerYear[p]!))}</strong> from each of {data.checksPerYear[p]} paychecks
                  </>
                ) : null}
                .
              </li>
            ))}
          </ul>
          <div className="scroll-x">
            <table className="table edit bills renewals">
              <thead>
                <tr>
                  <th>Renewal</th>
                  <th>Category</th>
                  <th title="Months between one renewal and the next: 12 for yearly">Every</th>
                  <th>Next</th>
                  <th className="num">Cost</th>
                  <th>Paid by</th>
                  <th>Split</th>
                  {liveFunds.length > 0 && <th title="A renewal paid from a fund draws the fund down and stays out of the month's budget">Paid from</th>}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {active.map((r) => (
                  <tr key={r.id}>
                    <td className="wide">
                      <TextCell value={r.name} ariaLabel={`Name of ${r.name}`} onCommit={(name) => update(r, { name })} />
                    </td>
                    <td>
                      <select className="cell cat" aria-label={`Category for ${r.name}`} value={r.category_id ?? ""} onChange={(e) => update(r, { category_id: e.target.value === "" ? null : Number(e.target.value) })}>
                        <option value="">Uncategorized</option>
                        {expenseOptions(categories, r.category_id).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="nowrap">
                      <TextCell
                        className="day"
                        value={String(r.months)}
                        ariaLabel={`Months between renewals of ${r.name}`}
                        onCommit={(text) => (/^\d{1,3}$/.test(text.trim()) ? update(r, { months: Number(text) }) : toast("Enter how many months pass between renewals, such as 12", "error"))}
                      />
                      <span className="muted small"> mo</span>
                    </td>
                    <td>
                      <input className="cell date" type="date" aria-label={`Next date for ${r.name}`} value={r.next_date} onChange={(e) => e.target.value && update(r, { next_date: e.target.value })} />
                    </td>
                    <td className="num">
                      <AmountInput cents={r.amount_cents} ariaLabel={`Cost of ${r.name}`} onCommit={(amount_cents) => update(r, { amount_cents })} />
                    </td>
                    <td>
                      <select className="cell" aria-label={`Who pays ${r.name}`} value={r.paid_by} onChange={(e) => update(r, { paid_by: e.target.value as Person })}>
                        <option value="a">{settings.people.a}</option>
                        <option value="b">{settings.people.b}</option>
                      </select>
                    </td>
                    <td>
                      <BillSplit value={r.split} settings={settings} onChange={(split) => update(r, { split })} />
                    </td>
                    {liveFunds.length > 0 && (
                      <td>
                        <FundSelect className="cell" funds={funds} value={r.fund_id} ariaLabel={`What pays for ${r.name}`} onChange={(fund_id) => update(r, { fund_id })} />
                      </td>
                    )}
                    <td className="actions">
                      <button type="button" className="icon-btn" aria-label={`Switch off ${r.name}`} title="Switch off: keeps the renewal but stops creating it" onClick={() => update(r, { active: false })}>
                        <Power size={14} />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => void remove(r)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <AddRenewal settings={settings} categories={categories} funds={liveFunds} today={today} />
      {off.length > 0 && (
        <ul className="chips">
          <li className="muted">Switched off:</li>
          {off.map((r) => (
            <li key={r.id} className="chip">
              {r.name}
              <button type="button" className="icon-btn" aria-label={`Switch on ${r.name}`} title="Switch on" onClick={() => update(r, { active: true })}>
                <Power size={14} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => void remove(r)}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Where the money for a purchase comes from: the month's budget, or one of the funds. */
export function FundSelect(props: { funds: FundRow[]; value: number | null; onChange: (fundId: number | null) => void; ariaLabel: string; className?: string }) {
  return (
    <select className={props.className} aria-label={props.ariaLabel} value={props.value ?? ""} onChange={(e) => props.onChange(e.target.value === "" ? null : Number(e.target.value))}>
      <option value="">Budget</option>
      {props.funds
        .filter((f) => !f.archived || f.id === props.value)
        .map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
    </select>
  );
}

function AddRenewal({ settings, categories, funds, today }: { settings: Props["settings"]; categories: Category[]; funds: FundRow[]; today: string }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [months, setMonths] = useState("12");
  const [next, setNext] = useState(today);
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<Person>("a");
  const [split, setSplit] = useState<TemplateSplit>({ type: "default" });
  const [fund, setFund] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount_cents = parseMoney(amount);
    if (amount_cents === null) return setError("Enter what the renewal costs");
    try {
      await call("renewals.create", { name, category_id: category === "" ? null : Number(category), months: Number(months), next_date: next, amount_cents, paid_by: paidBy, split, fund_id: fund });
      refresh();
      setName("");
      setAmount("");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="quickadd add-bill add-renewal" onSubmit={(e) => void submit(e)}>
      <div className="quickadd-fields">
        <label className="grow">
          <span>New renewal</span>
          <input value={name} placeholder="Car registration" onChange={(e) => (setName(e.target.value), setError(null))} />
        </label>
        <label>
          <span>Category</span>
          <select className="cell" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Uncategorized</option>
            {expenseOptions(categories, null).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="tiny">
          <span>Every (months)</span>
          <input inputMode="numeric" value={months} onChange={(e) => (setMonths(e.target.value), setError(null))} />
        </label>
        <label>
          <span>Next date</span>
          <input type="date" value={next} onChange={(e) => (setNext(e.target.value), setError(null))} required />
        </label>
        <label className="narrow">
          <span>Cost</span>
          <input inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => (setAmount(e.target.value), setError(null))} />
        </label>
        <label>
          <span>Paid by</span>
          <select className="cell" value={paidBy} onChange={(e) => setPaidBy(e.target.value as Person)}>
            <option value="a">{settings.people.a}</option>
            <option value="b">{settings.people.b}</option>
          </select>
        </label>
        <label>
          <span>Split</span>
          <BillSplit value={split} settings={settings} onChange={setSplit} />
        </label>
        {funds.length > 0 && (
          <label>
            <span>Paid from</span>
            <FundSelect className="cell" funds={funds} value={fund} ariaLabel="What pays for the renewal" onChange={setFund} />
          </label>
        )}
        <button type="submit" className="btn primary">
          <Plus size={15} aria-hidden="true" />
          Add renewal
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
