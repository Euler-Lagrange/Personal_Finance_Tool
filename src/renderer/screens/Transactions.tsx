import { useMemo, useRef, useState, type FormEvent } from "react";
import { Columns3, Plus, Scissors, Search, Trash2 } from "lucide-react";
import { change, toast, useQuery } from "../api";
import type { ScreenProps } from "../App";
import type { EntryKind } from "../../core/balance";
import { monthOf, toISO } from "../../core/dates";
import { formatMoney, parseMoney } from "../../core/money";
import type { Person, SplitSpec } from "../../core/split";
import type { Category, Entry, EntryPatch, FundRow } from "../../shared/types";
import { AmountInput, Segmented, SplitSelect, TextCell } from "../components/ui";
import { FundSelect } from "./Savings";

const OPTIONAL_COLUMNS = [
  { id: "paid_by", label: "Paid by" },
  { id: "split", label: "Split" },
  { id: "share", label: "Share" },
  { id: "fund", label: "Paid from" },
  { id: "account", label: "Account" },
  { id: "note", label: "Note" },
] as const;
type ColumnId = (typeof OPTIONAL_COLUMNS)[number]["id"];
const DEFAULT_COLUMNS: ColumnId[] = ["paid_by", "split", "share"];

function loadColumns(): ColumnId[] {
  try {
    const saved = JSON.parse(localStorage.getItem("tx-columns") ?? "null") as ColumnId[] | null;
    return Array.isArray(saved) ? saved.filter((c) => OPTIONAL_COLUMNS.some((o) => o.id === c)) : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

const categoriesFor = (categories: Category[], kind: EntryKind, keepId?: number | null) =>
  categories.filter((c) => c.kind === kind && (!c.archived || c.id === keepId));

export function Transactions({ month, view, settings, categories }: ScreenProps) {
  const entries = useQuery("entries.list", { month });
  const funds = useQuery("funds.list", { month })?.funds ?? [];
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [splitting, setSplitting] = useState<number | null>(null);
  const [columns, setColumns] = useState<ColumnId[]>(loadColumns);
  const [showColumns, setShowColumns] = useState(false);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!entries || !q) return entries ?? [];
    return entries.filter((e) => [e.description, e.category_name ?? "", e.note ?? "", e.account ?? "", formatMoney(e.amount_cents)].some((t) => t.toLowerCase().includes(q)));
  }, [entries, search]);

  if (!entries) return null;
  // The Paid from column also appears by itself when a purchase on screen was paid from a fund.
  const has = (c: ColumnId) => columns.includes(c) || (c === "fund" && entries.some((e) => e.from_fund));
  const columnCount = 6 + OPTIONAL_COLUMNS.filter((c) => has(c.id)).length;
  const toggleColumn = (c: ColumnId) => {
    const next = has(c) ? columns.filter((x) => x !== c) : [...columns, c];
    setColumns(next);
    localStorage.setItem("tx-columns", JSON.stringify(next));
  };
  const picked = shown.filter((e) => selected.has(e.id));
  const allPicked = shown.length > 0 && picked.length === shown.length;
  const shareOf = (e: Entry) => (view === "hh" ? e.amount_cents : view === "a" ? e.a_cents : e.b_cents);
  const shareName = view === "hh" ? "Household" : settings.people[view];
  // Purchases paid from a fund are not this month's spending, so they are totalled apart.
  const spending = shown.filter((e) => e.kind === "expense" && !e.from_fund);
  const expenseTotal = spending.reduce((t, e) => t + e.amount_cents, 0);
  const shareTotal = spending.reduce((t, e) => t + shareOf(e), 0);
  const fundTotal = shown.filter((e) => e.from_fund).reduce((t, e) => t + e.amount_cents, 0);

  const update = (id: number, patch: EntryPatch) => void change("entries.update", { id, patch });
  const remove = async (ids: number[]) => {
    const n = await change("entries.remove", { ids });
    if (n !== undefined) {
      setSelected(new Set());
      toast(`${n === 1 ? "Entry" : `${n} entries`} deleted. Ctrl+Z brings ${n === 1 ? "it" : "them"} back.`);
    }
  };
  const bulk = async (patch: EntryPatch) => {
    const n = await change("entries.bulkUpdate", { ids: picked.map((e) => e.id), patch });
    if (n !== undefined) toast(`${n} ${n === 1 ? "entry" : "entries"} changed`);
  };

  return (
    <div className="stack">
      <QuickAdd month={month} settings={settings} categories={categories} />

      <div className="toolbar">
        <label className="search">
          <Search size={15} aria-hidden="true" />
          <input type="search" placeholder="Search this month" aria-label="Search entries" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <span className="muted">
          {shown.length} {shown.length === 1 ? "entry" : "entries"} · {formatMoney(expenseTotal)} spent{has("share") ? ` · ${shareName} ${formatMoney(shareTotal)}` : ""}
          {fundTotal !== 0 ? ` · ${formatMoney(fundTotal)} paid from funds` : ""}
        </span>
        <div className="menu-wrap">
          <button type="button" className="btn ghost" aria-expanded={showColumns} onClick={() => setShowColumns(!showColumns)}>
            <Columns3 size={15} aria-hidden="true" />
            Columns
          </button>
          {showColumns && (
            <div className="menu">
              {OPTIONAL_COLUMNS.map((c) => (
                <label key={c.id}>
                  <input type="checkbox" checked={has(c.id)} onChange={() => toggleColumn(c.id)} /> {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {picked.length > 0 && (
        <div className="bulkbar">
          <strong>{picked.length} selected</strong>
          <select className="cell" aria-label="Set category for selected" value="" onChange={(e) => e.target.value && void bulk({ category_id: Number(e.target.value) })}>
            <option value="">Set category…</option>
            {categoriesFor(categories, "expense").map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="with-icon">
            Set split
            <SplitSelect value={null} settings={settings} ariaLabel="Set split for selected" onChange={(split) => void bulk({ split })} />
          </label>
          <button type="button" className="btn danger" onClick={() => void remove(picked.map((e) => e.id))}>
            <Trash2 size={15} aria-hidden="true" />
            Delete
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="empty">{entries.length === 0 ? "No entries this month yet. Add the first one above." : "Nothing matches that search."}</p>
      ) : (
        <div className="table-wrap">
          <table className="table edit">
            <thead>
              <tr>
                <th className="check">
                  <input type="checkbox" aria-label="Select all" checked={allPicked} onChange={() => setSelected(allPicked ? new Set() : new Set(shown.map((e) => e.id)))} />
                </th>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                {has("paid_by") && <th>Paid by</th>}
                {has("split") && <th>Split</th>}
                {has("fund") && <th title="A purchase paid from a fund draws the fund down and stays out of the month's budget">Paid from</th>}
                {has("account") && <th>Account</th>}
                {has("note") && <th>Note</th>}
                <th className="num">Amount</th>
                {has("share") && <th className="num">{shareName}</th>}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <Row
                  key={e.id}
                  entry={e}
                  has={has}
                  share={shareOf(e)}
                  settings={settings}
                  categories={categories}
                  checked={selected.has(e.id)}
                  onCheck={() => {
                    const next = new Set(selected);
                    if (!next.delete(e.id)) next.add(e.id);
                    setSelected(next);
                  }}
                  onUpdate={(patch) => update(e.id, patch)}
                  onDelete={() => void remove([e.id])}
                  splitting={splitting === e.id}
                  onSplitToggle={() => setSplitting(splitting === e.id ? null : e.id)}
                  columnCount={columnCount}
                  funds={funds}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QuickAdd({ month, settings, categories }: Pick<ScreenProps, "month" | "settings" | "categories">) {
  const today = toISO(new Date());
  const [kind, setKind] = useState<EntryKind>("expense");
  const [date, setDate] = useState(monthOf(today) === month ? today : `${month}-01`);
  const [seenMonth, setSeenMonth] = useState(month);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paidBy, setPaidBy] = useState<Person>("a");
  const [split, setSplit] = useState<SplitSpec>(settings.defaultSplit);
  const [error, setError] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  if (seenMonth !== month) {
    setSeenMonth(month);
    setDate(monthOf(today) === month ? today : `${month}-01`);
  }
  const options = kind === "settlement" ? [] : categoriesFor(categories, kind);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseMoney(amount);
    if (!description.trim() && kind !== "settlement") return setError("Enter a description");
    if (cents === null || cents === 0) return setError("Enter an amount, such as 12.50");
    setError(null);
    const saved = await change("entries.create", {
      date,
      description: description.trim() || "Settle up",
      amount_cents: cents,
      kind,
      category_id: kind === "settlement" || categoryId === "" ? null : Number(categoryId),
      paid_by: paidBy,
      split: kind === "expense" ? split : undefined,
    });
    if (saved) {
      setDescription("");
      setAmount("");
      descriptionRef.current?.focus();
    }
  };

  return (
    <form className="quickadd card" onSubmit={(e) => void submit(e)} aria-label="Add an entry">
      <Segmented
        ariaLabel="Kind of entry"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCategoryId("");
          setError(null);
        }}
        options={[
          { value: "expense", label: "Expense" },
          { value: "income", label: "Income" },
          { value: "settlement", label: "Settlement" },
        ]}
      />
      <div className="quickadd-fields">
        <label>
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="grow">
          <span>Description</span>
          <input ref={descriptionRef} value={description} placeholder={kind === "settlement" ? "Settle up" : "Corner Market"} onChange={(e) => (setDescription(e.target.value), setError(null))} />
        </label>
        <label className="narrow">
          <span>Amount</span>
          <input inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => (setAmount(e.target.value), setError(null))} />
        </label>
        {kind !== "settlement" && (
          <label>
            <span>Category</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorized</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>{kind === "expense" ? "Paid by" : kind === "income" ? "Received by" : "From"}</span>
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value as Person)}>
            <option value="a">{settings.people.a}</option>
            <option value="b">{settings.people.b}</option>
          </select>
        </label>
        {kind === "expense" && (
          <label>
            <span>Split</span>
            <SplitSelect value={split} onChange={setSplit} settings={settings} ariaLabel="Split" className="boxed" />
          </label>
        )}
        <button type="submit" className="btn primary">
          <Plus size={15} aria-hidden="true" />
          Add
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

function Row(props: {
  entry: Entry;
  has: (c: ColumnId) => boolean;
  share: number;
  settings: ScreenProps["settings"];
  categories: Category[];
  checked: boolean;
  onCheck: () => void;
  onUpdate: (patch: EntryPatch) => void;
  onDelete: () => void;
  splitting: boolean;
  onSplitToggle: () => void;
  columnCount: number;
  funds: FundRow[];
}) {
  const { entry: e, has, settings, onUpdate } = props;
  const options = e.kind === "settlement" ? [] : categoriesFor(props.categories, e.kind, e.category_id);
  return (
    <>
      <tr className={props.checked ? "picked" : ""}>
        <td className="check">
          <input type="checkbox" aria-label={`Select ${e.description}`} checked={props.checked} onChange={props.onCheck} />
        </td>
        <td>
          <input className="cell date" type="date" aria-label="Date" value={e.date} onChange={(ev) => ev.target.value && onUpdate({ date: ev.target.value })} />
        </td>
        <td className="wide">
          <TextCell value={e.description} ariaLabel="Description" onCommit={(description) => onUpdate({ description })} />
          {e.split_of !== null && <span className="tag">split</span>}
        </td>
        <td>
          {e.kind === "settlement" ? (
            <span className="tag">Settlement</span>
          ) : (
            <select className="cell cat" aria-label="Category" value={e.category_id ?? ""} onChange={(ev) => onUpdate({ category_id: ev.target.value === "" ? null : Number(ev.target.value) })}>
              <option value="">Uncategorized</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </td>
        {has("paid_by") && (
          <td>
            <select className="cell" aria-label={e.kind === "expense" ? "Paid by" : e.kind === "income" ? "Received by" : "From"} value={e.paid_by} onChange={(ev) => onUpdate({ paid_by: ev.target.value as Person })}>
              <option value="a">{settings.people.a}</option>
              <option value="b">{settings.people.b}</option>
            </select>
          </td>
        )}
        {has("split") && <td>{e.kind === "expense" ? <SplitSelect value={e.split} settings={settings} ariaLabel="Split" onChange={(split) => onUpdate({ split })} /> : <span className="muted">{e.kind === "income" ? "Income" : ""}</span>}</td>}
        {has("fund") && <td>{e.kind === "expense" && <FundSelect className="cell fund" funds={props.funds} value={e.from_fund ? e.fund_id : null} ariaLabel="Paid from" onChange={(paid_from_fund) => onUpdate({ paid_from_fund })} />}</td>}
        {has("account") && (
          <td>
            <TextCell value={e.account ?? ""} ariaLabel="Account" onCommit={(account) => onUpdate({ account })} />
          </td>
        )}
        {has("note") && (
          <td>
            <TextCell value={e.note ?? ""} ariaLabel="Note" onCommit={(note) => onUpdate({ note })} />
          </td>
        )}
        <td className="num">
          <AmountInput cents={e.amount_cents} ariaLabel="Amount" onCommit={(amount_cents) => onUpdate({ amount_cents })} />
        </td>
        {has("share") && (
          <td className="num muted" title={e.from_fund ? "Paid from a fund, so it is not part of the month's budget" : undefined}>
            {e.kind === "settlement" ? "" : e.from_fund ? "–" : formatMoney(props.share)}
          </td>
        )}
        <td className="actions">
          {e.kind === "expense" && (
            <button type="button" className="icon-btn" aria-label="Split across categories" title="Split across categories" aria-expanded={props.splitting} onClick={props.onSplitToggle}>
              <Scissors size={15} />
            </button>
          )}
          <button type="button" className="icon-btn" aria-label={`Delete ${e.description}`} title="Delete" onClick={props.onDelete}>
            <Trash2 size={15} />
          </button>
        </td>
      </tr>
      {props.splitting && (
        <tr className="subrow">
          <td colSpan={props.columnCount}>
            <SplitForm entry={e} categories={props.categories} onDone={props.onSplitToggle} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Move part of a purchase into another category. The pieces still add up to the original. */
function SplitForm({ entry, categories, onDone }: { entry: Entry; categories: Category[]; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null || cents === 0) return setError("Enter the amount to move");
    if (Math.abs(cents) >= Math.abs(entry.amount_cents)) return setError(`Enter less than ${formatMoney(entry.amount_cents)}`);
    const signed = Math.sign(entry.amount_cents) * Math.abs(cents);
    const done = await change("entries.split", { id: entry.id, parts: [{ amount_cents: signed, category_id: categoryId === "" ? null : Number(categoryId) }] });
    if (done) onDone();
  };
  return (
    <form className="inline-form" onSubmit={(e) => void submit(e)}>
      <span>Move</span>
      <input className="narrow" inputMode="decimal" autoFocus aria-label="Amount to move" placeholder="0.00" value={amount} onChange={(e) => (setAmount(e.target.value), setError(null))} />
      <span>of {formatMoney(entry.amount_cents)} to</span>
      <select aria-label="Category for this part" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        <option value="">Uncategorized</option>
        {categoriesFor(categories, "expense").map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button type="submit" className="btn">
        Split
      </button>
      <button type="button" className="btn ghost" onClick={onDone}>
        Cancel
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
