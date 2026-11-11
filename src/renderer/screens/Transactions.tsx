import { useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Columns3, Plus, Scissors, Search, Trash2, FileDown } from "lucide-react";
import { change, toast, useQuery } from "../api";
import type { ScreenProps } from "../App";
import type { EntryKind } from "../../core/balance";
import { monthOf, toISO, monthLabel } from "../../core/dates";
import { formatMoney, parseMoney } from "../../core/money";
import type { Person, SplitSpec } from "../../core/split";
import type { Category, Entry, EntryPatch, FundRow } from "../../shared/types";
import { AmountInput, Segmented, SplitSelect, TextCell } from "../components/ui";
import { TX_COLUMNS, moveColumn, readColumnPrefs, visibleColumns, type ColumnPrefs, type TxColumnId } from "../../shared/columns";
import { FundSelect } from "./Savings";
import { saveExport } from "./Year";

/** Column choices are kept per PC: a wide desktop screen and a laptop want different tables. */
function loadColumns(): ColumnPrefs {
  const read = (key: string): unknown => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  };
  return readColumnPrefs(read("tx-column-order"), read("tx-columns"));
}
function saveColumns(prefs: ColumnPrefs): void {
  try {
    localStorage.setItem("tx-column-order", JSON.stringify(prefs.order));
    localStorage.setItem("tx-columns", JSON.stringify(prefs.shown));
  } catch {
    // The choice still holds until the window closes.
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
  const [columns, setColumns] = useState<ColumnPrefs>(loadColumns);
  const [showColumns, setShowColumns] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!entries || !q) return entries ?? [];
    return entries.filter((e) => [e.description, e.category_name ?? "", e.note ?? "", e.account ?? "", formatMoney(e.amount_cents)].some((t) => t.toLowerCase().includes(q)));
  }, [entries, search]);

  if (!entries) return null;
  // With merged finances there is nothing to split, so those columns are not on offer.
  const offered = TX_COLUMNS.map((c) => c.id).filter((id) => !settings.mergedFinances || (id !== "split" && id !== "share"));
  // The Paid from column also appears by itself when a purchase on screen was paid from a fund.
  const visible = visibleColumns(columns, offered, entries.some((e) => e.from_fund) ? ["fund"] : []);
  const has = (c: TxColumnId) => visible.includes(c);
  const columnCount = 2 + visible.length;
  const changeColumns = (next: ColumnPrefs) => {
    setColumns(next);
    saveColumns(next);
  };
  const toggleColumn = (c: TxColumnId) => changeColumns({ ...columns, shown: has(c) ? columns.shown.filter((x) => x !== c) : [...columns.shown, c] });
  const menuColumns = columns.order.filter((id) => offered.includes(id)).map((id) => TX_COLUMNS.find((c) => c.id === id)!);
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
          <button type="button" className="btn ghost" aria-expanded={showExport} onClick={() => (setShowExport(!showExport), setShowColumns(false))}>
            <FileDown size={15} aria-hidden="true" />
            Export
          </button>
          {showExport && (
            <div className="menu export-menu">
              {(["month", "year"] as const).flatMap((scope) =>
                (["xlsx", "csv"] as const).map((format) => (
                  <button key={scope + format} type="button" className="btn ghost" onClick={() => (setShowExport(false), void saveExport({ scope, month }, format))}>
                    {scope === "month" ? monthLabel(month) : `All of ${month.slice(0, 4)}`} to {format === "xlsx" ? "Excel" : "CSV"}
                  </button>
                )),
              )}
            </div>
          )}
        </div>
        <div className="menu-wrap next">
          <button type="button" className="btn ghost" aria-expanded={showColumns} onClick={() => (setShowColumns(!showColumns), setShowExport(false))}>
            <Columns3 size={15} aria-hidden="true" />
            Columns
          </button>
          {showColumns && (
            <div className="menu columns-menu">
              {menuColumns.map((c, i) => (
                <div key={c.id} className="column-line">
                  {c.required ? (
                    <span className="always" title="This column is always shown">
                      {c.label}
                    </span>
                  ) : (
                    <label>
                      <input type="checkbox" checked={has(c.id)} onChange={() => toggleColumn(c.id)} /> {c.label}
                    </label>
                  )}
                  <button type="button" className="icon-btn" aria-label={`Move ${c.label} earlier`} title="Move earlier" disabled={i === 0} onClick={() => changeColumns({ ...columns, order: moveColumn(columns.order, offered, c.id, -1) })}>
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move ${c.label} later`}
                    title="Move later"
                    disabled={i === menuColumns.length - 1}
                    onClick={() => changeColumns({ ...columns, order: moveColumn(columns.order, offered, c.id, 1) })}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
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
          {!settings.mergedFinances && (
            <label className="with-icon">
              Set split
              <SplitSelect value={null} settings={settings} ariaLabel="Set split for selected" onChange={(split) => void bulk({ split })} />
            </label>
          )}
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
                {visible.map((id) => (
                  <th
                    key={id}
                    className={id === "amount" || id === "share" ? "num" : undefined}
                    title={id === "fund" ? "A purchase paid from a fund draws the fund down and stays out of the month's budget" : undefined}
                  >
                    {id === "share" ? shareName : TX_COLUMNS.find((c) => c.id === id)!.label}
                  </th>
                ))}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <Row
                  key={e.id}
                  entry={e}
                  columns={visible}
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
        {kind === "expense" && !settings.mergedFinances && (
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
  columns: TxColumnId[];
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
  const { entry: e, settings, onUpdate } = props;
  const options = e.kind === "settlement" ? [] : categoriesFor(props.categories, e.kind, e.category_id);
  const cell = (id: TxColumnId) => {
    switch (id) {
      case "date":
        return (
          <td key={id}>
            <input className="cell date" type="date" aria-label="Date" value={e.date} onChange={(ev) => ev.target.value && onUpdate({ date: ev.target.value })} />
          </td>
        );
      case "description":
        return (
          <td key={id} className="wide">
            <TextCell value={e.description} ariaLabel="Description" onCommit={(description) => onUpdate({ description })} />
            {e.split_of !== null && <span className="tag">split</span>}
          </td>
        );
      case "category":
        return (
          <td key={id}>
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
        );
      case "paid_by":
        return (
          <td key={id}>
            <select className="cell" aria-label={e.kind === "expense" ? "Paid by" : e.kind === "income" ? "Received by" : "From"} value={e.paid_by} onChange={(ev) => onUpdate({ paid_by: ev.target.value as Person })}>
              <option value="a">{settings.people.a}</option>
              <option value="b">{settings.people.b}</option>
            </select>
          </td>
        );
      case "split":
        return <td key={id}>{e.kind === "expense" ? <SplitSelect value={e.split} settings={settings} ariaLabel="Split" onChange={(split) => onUpdate({ split })} /> : <span className="muted">{e.kind === "income" ? "Income" : ""}</span>}</td>;
      case "fund":
        return <td key={id}>{e.kind === "expense" && <FundSelect className="cell fund" funds={props.funds} value={e.from_fund ? e.fund_id : null} ariaLabel="Paid from" onChange={(paid_from_fund) => onUpdate({ paid_from_fund })} />}</td>;
      case "account":
        return (
          <td key={id}>
            <TextCell value={e.account ?? ""} ariaLabel="Account" onCommit={(account) => onUpdate({ account })} />
          </td>
        );
      case "note":
        return (
          <td key={id}>
            <TextCell value={e.note ?? ""} ariaLabel="Note" onCommit={(note) => onUpdate({ note })} />
          </td>
        );
      case "amount":
        return (
          <td key={id} className="num">
            <AmountInput cents={e.amount_cents} ariaLabel="Amount" onCommit={(amount_cents) => onUpdate({ amount_cents })} />
          </td>
        );
      case "share":
        return (
          <td key={id} className="num muted" title={e.from_fund ? "Paid from a fund, so it is not part of the month's budget" : undefined}>
            {e.kind === "settlement" ? "" : e.from_fund ? "–" : formatMoney(props.share)}
          </td>
        );
    }
  };
  return (
    <>
      <tr className={props.checked ? "picked" : ""}>
        <td className="check">
          <input type="checkbox" aria-label={`Select ${e.description}`} checked={props.checked} onChange={props.onCheck} />
        </td>
        {props.columns.map(cell)}
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
