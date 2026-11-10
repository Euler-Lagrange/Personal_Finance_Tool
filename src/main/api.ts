import { all, get, run, tx, type Db, type Row } from "./db";
import { balance, balanceDelta, type BalanceEntry, type EntryKind } from "../core/balance";
import { summarize, type BudgetRow } from "../core/budget";
import { addDays, addMonths, daysInMonth, isISODate, isMonth, monthLabel, monthOf, toISO, weekday } from "../core/dates";
import type { ExportCell, ExportSheet } from "../core/csv";
import { summarizeYear, type YearLine, type YearRow } from "../core/year";
import { addMonthsToDate, evenShare, fundBalance, openingFor, runwayMonths, yearlyCost } from "../core/savings";
import { fitPay, grossPay, hoursToGoal, isOutsideKnown, payPeriods, predictPaycheck, usBankHolidays, type PayPeriod } from "../core/pay";
import type { StatementData, StatementLine } from "../core/statement";
import type { Cents } from "../core/money";
import { computeShares, isValidSplit, MINE, THEIRS, type Person, type SplitSpec } from "../core/split";
import type {
  BillInput, BillRow, Category, DayTag, Entry, EntryInput, EntryPatch, FundInput, FundRow, KnownPaycheck, PayMonth, PayProfile, PayProfileInput, PayRate,
  PaySchedule, PaySetup, PaycheckPatch, PaycheckView, RenewalInput, RenewalList, RenewalRow, Runway, Settings, SetupFile, TemplateSplit, View, ExportRequest, YearView,
} from "../shared/types";

/** A message meant for the person using the app, shown next to the control that caused it. */
export class UserError extends Error {}

const DEFAULT_SETTINGS: Settings = {
  people: { a: "Me", b: "Partner" },
  defaultSplit: { type: "percent", a: 50 },
  presets: [
    { label: "50/50", spec: { type: "percent", a: 50 } },
    { label: "A", spec: MINE },
    { label: "B", spec: THEIRS },
  ],
  groups: ["Needs", "Wants", "Savings"],
  targets: { a: {}, b: {} },
  openingBalanceCents: 0,
  mergedFinances: false,
};

const DEFAULT_CATEGORIES: [name: string, grp: string, kind: "expense" | "income", icon: string][] = [
  ["Housing", "Needs", "expense", "home"],
  ["Utilities", "Needs", "expense", "zap"],
  ["Internet and phone", "Needs", "expense", "wifi"],
  ["Insurance", "Needs", "expense", "shield"],
  ["Groceries", "Needs", "expense", "shopping-basket"],
  ["Transport", "Needs", "expense", "car"],
  ["Health", "Needs", "expense", "heart-pulse"],
  ["Debt payments", "Needs", "expense", "landmark"],
  ["Dining out", "Wants", "expense", "utensils"],
  ["Hobbies", "Wants", "expense", "gamepad-2"],
  ["Subscriptions", "Wants", "expense", "repeat"],
  ["Gifts", "Wants", "expense", "gift"],
  ["Savings", "Savings", "expense", "piggy-bank"],
  ["Sinking funds", "Savings", "expense", "wallet"],
  ["Paycheck", "Income", "income", "banknote"],
  ["Other income", "Income", "income", "plus-circle"],
];

/** Primary-key columns per table, used by undo to put rows back exactly as they were. */
const KEYS: Record<string, string[]> = {
  entries: ["id"],
  categories: ["id"],
  budget_lines: ["month", "person", "category_id"],
  months: ["month", "person"],
  settings: ["key"],
  recurring: ["id"],
  funds: ["id"],
  pay_profiles: ["id"],
  paychecks: ["id"],
  work_days: ["date", "person"],
};

interface UndoOp {
  table: string;
  key: Row;
  before: Row | null;
}
interface UndoItem {
  label: string;
  ops: UndoOp[];
}

const KINDS: EntryKind[] = ["expense", "income", "settlement"];
const isPerson = (p: unknown): p is Person => p === "a" || p === "b";

export function createApi(db: Db, opts: { now?: () => Date } = {}) {
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();
  const today = () => toISO(opts.now ? opts.now() : new Date());
  const undoStack: UndoItem[] = [];
  let recording: UndoOp[] | null = null;

  // ---- undo journal -------------------------------------------------------

  const whereKey = (table: string, key: Row) => ({
    sql: KEYS[table].map((k) => `${k} = ?`).join(" and "),
    params: KEYS[table].map((k) => key[k]),
  });
  const readRow = (table: string, key: Row) => {
    const w = whereKey(table, key);
    return get<Row>(db, `select * from ${table} where ${w.sql}`, ...w.params) ?? null;
  };
  /** Call before changing or deleting a row, or after inserting one. */
  const record = (table: string, key: Row, inserted = false) => {
    recording?.push({ table, key, before: inserted ? null : readRow(table, key) });
  };
  const bumpRev = () =>
    run(db, "insert into settings (key, value) values ('rev', '1') on conflict (key) do update set value = cast(value as integer) + 1");

  function mutate<T>(label: string, fn: () => T): T {
    const ops: UndoOp[] = [];
    recording = ops;
    try {
      const result = tx(db, () => {
        const value = fn();
        bumpRev();
        return value;
      });
      if (ops.length > 0) {
        undoStack.push({ label, ops });
        if (undoStack.length > 50) undoStack.shift();
      }
      return result;
    } finally {
      recording = null;
    }
  }

  function undo(): string | null {
    const item = undoStack.pop();
    if (!item) return null;
    tx(db, () => {
      // Rows are put back one at a time, so let references settle at commit.
      db.exec("pragma defer_foreign_keys = on");
      for (const op of [...item.ops].reverse()) {
        if (op.before) {
          const cols = Object.keys(op.before);
          run(db, `insert or replace into ${op.table} (${cols.join(", ")}) values (${cols.map(() => "?").join(", ")})`, ...cols.map((c) => op.before![c]));
        } else {
          const w = whereKey(op.table, op.key);
          run(db, `delete from ${op.table} where ${w.sql}`, ...w.params);
        }
      }
      bumpRev();
    });
    return item.label;
  }

  // ---- settings -----------------------------------------------------------

  function getSettings(): Settings {
    const row = get<{ value: string }>(db, "select value from settings where key = 'app'");
    return { ...DEFAULT_SETTINGS, ...(row ? (JSON.parse(row.value) as Partial<Settings>) : {}) };
  }

  function saveSettings(next: Settings) {
    record("settings", { key: "app" });
    run(db, "insert into settings (key, value) values ('app', ?) on conflict (key) do update set value = excluded.value", JSON.stringify(next));
  }

  function updateSettings(patch: Partial<Settings>): Settings {
    return mutate("Change settings", () => {
      const next = { ...getSettings(), ...patch };
      if (!next.people.a.trim() || !next.people.b.trim()) throw new UserError("Both people need a name");
      if (!isValidSplit(next.defaultSplit)) throw new UserError("The default split is not valid");
      for (const p of next.presets) if (!isValidSplit(p.spec)) throw new UserError("A split preset is not valid");
      next.groups = next.groups.map((g) => g.trim()).filter(Boolean);
      if (next.groups.length === 0) throw new UserError("Keep at least one group");
      if (!Number.isInteger(next.openingBalanceCents)) throw new UserError("The opening balance is not valid");
      saveSettings(next);
      return next;
    });
  }

  // ---- categories ---------------------------------------------------------

  const toCategory = (r: Row): Category => ({
    id: r.id as number,
    name: r.name as string,
    grp: r.grp as string,
    kind: r.kind as Category["kind"],
    sort: r.sort as number,
    icon: (r.icon as string) ?? null,
    rollover: r.rollover === 1,
    archived: r.archived === 1,
  });

  function listCategories(args: { includeArchived?: boolean } = {}): Category[] {
    const where = args.includeArchived ? "" : "where archived = 0";
    return all<Row>(db, `select * from categories ${where} order by sort, id`).map(toCategory);
  }

  function seedDefaultCategories() {
    const count = get<{ n: number }>(db, "select count(*) n from categories")!.n;
    if (count > 0) return;
    tx(db, () => {
      DEFAULT_CATEGORIES.forEach(([name, grp, kind, icon], i) =>
        run(db, "insert into categories (name, grp, kind, sort, icon) values (?, ?, ?, ?, ?)", name, grp, kind, i, icon),
      );
    });
  }

  function cleanCategoryName(name: string, exceptId?: number): string {
    const clean = name.trim();
    if (!clean) throw new UserError("Enter a category name");
    const clash = get<{ id: number }>(db, "select id from categories where lower(name) = lower(?) and archived = 0", clean);
    if (clash && clash.id !== exceptId) throw new UserError(`"${clean}" already exists`);
    return clean;
  }

  function createCategory(input: { name: string; grp: string; kind?: Category["kind"]; icon?: string | null }): Category {
    return mutate("Add category", () => {
      const name = cleanCategoryName(input.name);
      const kind = input.kind ?? "expense";
      const grp = kind === "income" ? "Income" : input.grp.trim();
      if (!grp) throw new UserError("Choose a group");
      const sort = (get<{ m: number | null }>(db, "select max(sort) m from categories")!.m ?? -1) + 1;
      const id = run(db, "insert into categories (name, grp, kind, sort, icon) values (?, ?, ?, ?, ?)", name, grp, kind, sort, input.icon ?? null)
        .lastInsertRowid as number;
      record("categories", { id }, true);
      return toCategory(readRow("categories", { id })!);
    });
  }

  function updateCategory(args: { id: number; patch: Partial<Pick<Category, "name" | "grp" | "icon" | "rollover" | "archived">> }): Category {
    return mutate("Edit category", () => {
      const existing = readRow("categories", { id: args.id });
      if (!existing) throw new UserError("That category no longer exists");
      const p = args.patch;
      record("categories", { id: args.id });
      if (p.name !== undefined) run(db, "update categories set name = ? where id = ?", cleanCategoryName(p.name, args.id), args.id);
      if (p.grp !== undefined && existing.kind === "expense") {
        if (!p.grp.trim()) throw new UserError("Choose a group");
        run(db, "update categories set grp = ? where id = ?", p.grp.trim(), args.id);
      }
      if (p.icon !== undefined) run(db, "update categories set icon = ? where id = ?", p.icon, args.id);
      if (p.rollover !== undefined) run(db, "update categories set rollover = ? where id = ?", p.rollover ? 1 : 0, args.id);
      if (p.archived !== undefined) {
        if (!p.archived) cleanCategoryName((readRow("categories", { id: args.id })!.name as string), args.id);
        run(db, "update categories set archived = ? where id = ?", p.archived ? 1 : 0, args.id);
      }
      return toCategory(readRow("categories", { id: args.id })!);
    });
  }

  function reorderCategories(args: { ids: number[] }): void {
    mutate("Reorder categories", () => {
      args.ids.forEach((id, i) => {
        record("categories", { id });
        run(db, "update categories set sort = ? where id = ?", i, id);
      });
    });
  }

  /** Deletes a category nothing uses; archives one that has history. Returns what happened. */
  function removeCategory(args: { id: number }): "deleted" | "archived" {
    return mutate("Remove category", () => {
      const used =
        get<{ n: number }>(db, "select count(*) n from entries where category_id = ?", args.id)!.n +
        get<{ n: number }>(db, "select count(*) n from recurring where category_id = ?", args.id)!.n;
      record("categories", { id: args.id });
      if (used > 0) {
        run(db, "update categories set archived = 1 where id = ?", args.id);
        return "archived";
      }
      for (const line of all<Row>(db, "select month, person, category_id from budget_lines where category_id = ?", args.id)) {
        record("budget_lines", line);
      }
      run(db, "delete from budget_lines where category_id = ?", args.id);
      run(db, "delete from categories where id = ?", args.id);
      return "deleted";
    });
  }

  /** Renames a group everywhere it is used: the group list, targets and categories. */
  function renameGroup(args: { from: string; to: string }): Settings {
    return mutate("Rename group", () => {
      const to = args.to.trim();
      const settings = getSettings();
      if (!to) throw new UserError("Enter a group name");
      if (to !== args.from && settings.groups.includes(to)) throw new UserError(`"${to}" already exists`);
      for (const c of all<Row>(db, "select id from categories where grp = ?", args.from)) record("categories", { id: c.id });
      run(db, "update categories set grp = ? where grp = ?", to, args.from);
      const targets = { a: { ...settings.targets.a }, b: { ...settings.targets.b } };
      for (const p of ["a", "b"] as const) {
        if (args.from in targets[p]) {
          targets[p][to] = targets[p][args.from];
          if (to !== args.from) delete targets[p][args.from];
        }
      }
      const next = { ...settings, groups: settings.groups.map((g) => (g === args.from ? to : g)), targets };
      saveSettings(next);
      return next;
    });
  }

  // ---- entries ------------------------------------------------------------

  const ENTRY_SELECT = `select e.*, c.name as category_name from entries e left join categories c on c.id = e.category_id`;

  const toEntry = (r: Row): Entry => ({
    id: r.id as number,
    date: r.date as string,
    description: r.description as string,
    amount_cents: r.amount_cents as number,
    kind: r.kind as EntryKind,
    category_id: (r.category_id as number) ?? null,
    category_name: (r.category_name as string) ?? null,
    paid_by: r.paid_by as Person,
    account: (r.account as string) ?? null,
    split: JSON.parse(r.split_json as string) as SplitSpec,
    a_cents: r.a_cents as number,
    b_cents: r.b_cents as number,
    fund_id: (r.fund_id as number) ?? null,
    from_fund: r.from_fund === 1,
    split_of: (r.split_of as number) ?? null,
    recurring_id: (r.recurring_id as number) ?? null,
    seen_in_bank: r.seen_in_bank === 1,
    note: (r.note as string) ?? null,
  });

  /** Checks an entry and works out the stored shares. */
  function prepare(input: EntryInput) {
    if (!isISODate(input.date)) throw new UserError("Enter a valid date");
    const description = (input.description ?? "").trim();
    if (!description) throw new UserError("Enter a description");
    if (!Number.isInteger(input.amount_cents) || input.amount_cents === 0) throw new UserError("Enter an amount");
    if (!KINDS.includes(input.kind)) throw new UserError("Choose expense, income or settlement");
    if (!isPerson(input.paid_by)) throw new UserError("Choose who paid");
    let category_id = input.category_id ?? null;
    let split: SplitSpec;
    let shares = { a: 0, b: 0 };
    if (input.kind === "settlement") {
      if (input.amount_cents < 0) throw new UserError("A settlement amount must be positive");
      category_id = null;
      split = MINE;
    } else {
      if (category_id !== null) {
        const cat = get<{ kind: string }>(db, "select kind from categories where id = ?", category_id);
        if (!cat) throw new UserError("That category no longer exists");
        if (cat.kind !== input.kind) throw new UserError(`Choose ${input.kind === "income" ? "an income" : "an expense"} category`);
      }
      if (input.kind === "income") split = input.split ?? (input.paid_by === "a" ? MINE : THEIRS);
      else split = input.split ?? getSettings().defaultSplit;
      if (!isValidSplit(split)) throw new UserError("That split is not valid");
      try {
        shares = computeShares(input.amount_cents, split);
      } catch (error) {
        throw new UserError((error as Error).message);
      }
    }
    // Only a purchase can be paid from a fund.
    const fund = input.kind === "expense" ? (input.paid_from_fund ?? null) : null;
    if (fund !== null && !get(db, "select id from funds where id = ?", fund)) throw new UserError("That fund no longer exists");
    return { ...input, description, category_id, split, shares, fund, account: input.account?.trim() || null, note: input.note?.trim() || null };
  }

  function insertEntry(input: EntryInput, extra: { split_of?: number; recurring_id?: number } = {}): number {
    const e = prepare(input);
    const stamp = now();
    const id = run(
      db,
      `insert into entries (date, description, amount_cents, kind, category_id, paid_by, account, split_json, a_cents, b_cents, fund_id, from_fund, split_of, recurring_id, note, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.date, e.description, e.amount_cents, e.kind, e.category_id, e.paid_by, e.account, JSON.stringify(e.split), e.shares.a, e.shares.b, e.fund, e.fund === null ? 0 : 1,
      extra.split_of ?? null, extra.recurring_id ?? null, e.note, stamp, stamp,
    ).lastInsertRowid as number;
    record("entries", { id }, true);
    return id;
  }

  const entryById = (id: number): Entry => {
    const row = get<Row>(db, `${ENTRY_SELECT} where e.id = ?`, id);
    if (!row) throw new UserError("That entry no longer exists");
    return toEntry(row);
  };

  function applyPatch(id: number, patch: EntryPatch) {
    const old = entryById(id);
    const kind = patch.kind ?? old.kind;
    const paid_by = patch.paid_by ?? old.paid_by;
    let split = patch.split ?? old.split;
    // Income follows whoever received it unless a split was given on purpose.
    if (kind === "income" && patch.split === undefined && (patch.kind !== undefined || patch.paid_by !== undefined)) {
      split = paid_by === "a" ? MINE : THEIRS;
    }
    let category_id = patch.category_id !== undefined ? patch.category_id : old.category_id;
    if (patch.kind !== undefined && patch.kind !== old.kind && patch.category_id === undefined) category_id = null;
    const e = prepare({
      date: patch.date ?? old.date,
      description: patch.description ?? old.description,
      amount_cents: patch.amount_cents ?? old.amount_cents,
      kind,
      category_id,
      paid_by,
      split,
      account: patch.account !== undefined ? patch.account : old.account,
      note: patch.note !== undefined ? patch.note : old.note,
      paid_from_fund: patch.paid_from_fund !== undefined ? patch.paid_from_fund : old.from_fund ? old.fund_id : null,
    });
    record("entries", { id });
    run(
      db,
      `update entries set date = ?, description = ?, amount_cents = ?, kind = ?, category_id = ?, paid_by = ?, account = ?, split_json = ?, a_cents = ?, b_cents = ?,
         fund_id = ?, from_fund = ?, note = ?, updated_at = ? where id = ?`,
      e.date, e.description, e.amount_cents, e.kind, e.category_id, e.paid_by, e.account, JSON.stringify(e.split), e.shares.a, e.shares.b, e.fund, e.fund === null ? 0 : 1, e.note, now(), id,
    );
  }

  function listEntries(args: { month: string }): Entry[] {
    if (!isMonth(args.month)) throw new UserError("That month is not valid");
    return all<Row>(db, `${ENTRY_SELECT} where e.date like ? order by e.date desc, e.id desc`, `${args.month}-%`).map(toEntry);
  }

  function createEntry(input: EntryInput): Entry {
    return mutate("Add entry", () => entryById(insertEntry(input)));
  }

  function updateEntry(args: { id: number; patch: EntryPatch }): Entry {
    return mutate("Edit entry", () => {
      applyPatch(args.id, args.patch);
      return entryById(args.id);
    });
  }

  function bulkUpdateEntries(args: { ids: number[]; patch: EntryPatch }): number {
    return mutate(`Edit ${args.ids.length} entries`, () => {
      for (const id of args.ids) applyPatch(id, args.patch);
      return args.ids.length;
    });
  }

  function removeEntries(args: { ids: number[] }): number {
    return mutate(args.ids.length === 1 ? "Delete entry" : `Delete ${args.ids.length} entries`, () => {
      for (const id of args.ids) {
        if (!readRow("entries", { id })) continue;
        // Pieces split from this purchase stand on their own once it is gone.
        for (const child of all<Row>(db, "select id from entries where split_of = ?", id)) {
          record("entries", { id: child.id });
          run(db, "update entries set split_of = null where id = ?", child.id);
        }
        record("entries", { id });
        run(db, "delete from entries where id = ?", id);
      }
      return args.ids.length;
    });
  }

  /**
   * Divide one purchase across categories. The original keeps what is left; each part becomes
   * its own entry linked back to the original, so the pieces still add up to the bank's amount.
   */
  function splitEntry(args: { id: number; parts: { amount_cents: Cents; category_id: number | null }[] }): Entry[] {
    return mutate("Split purchase", () => {
      const original = entryById(args.id);
      if (original.kind !== "expense") throw new UserError("Only an expense can be split across categories");
      if (original.split.type !== "percent") throw new UserError("Change this purchase to a percentage split before dividing it across categories");
      if (args.parts.length === 0) throw new UserError("Add at least one part");
      const sign = Math.sign(original.amount_cents);
      const moved = args.parts.reduce((t, p) => t + p.amount_cents, 0);
      for (const p of args.parts) {
        if (!Number.isInteger(p.amount_cents) || Math.sign(p.amount_cents) !== sign) throw new UserError("Each part needs an amount");
      }
      if (Math.abs(moved) >= Math.abs(original.amount_cents)) throw new UserError("The parts must add up to less than the purchase");
      applyPatch(args.id, { amount_cents: original.amount_cents - moved });
      const ids = args.parts.map((p) =>
        insertEntry(
          {
            date: original.date,
            description: original.description,
            amount_cents: p.amount_cents,
            kind: "expense",
            category_id: p.category_id,
            paid_by: original.paid_by,
            split: original.split,
            account: original.account,
            note: original.note,
            paid_from_fund: original.from_fund ? original.fund_id : null,
          },
          { split_of: original.split_of ?? original.id, recurring_id: original.recurring_id ?? undefined },
        ),
      );
      return [entryById(args.id), ...ids.map(entryById)];
    });
  }

  // ---- budget -------------------------------------------------------------

  /** A month with no plan yet starts as a copy of the most recent month that has one. */
  function ensureMonth(month: string, person: Person) {
    const has = get<{ n: number }>(db, "select count(*) n from budget_lines where month = ? and person = ?", month, person)!.n;
    if (has > 0) return;
    const prev = get<{ month: string }>(db, "select max(month) month from budget_lines where person = ? and month < ?", person, month);
    if (!prev?.month) return;
    tx(db, () => {
      run(
        db,
        `insert into budget_lines (month, person, category_id, planned_cents)
         select ?, person, category_id, planned_cents from budget_lines b
         join categories c on c.id = b.category_id
         where b.month = ? and b.person = ? and c.archived = 0`,
        month, prev.month, person,
      );
      bumpRev();
    });
  }

  function getBudget(args: { month: string; view: View }): { rows: BudgetRow[]; startBalanceCents: Cents } {
    if (!isMonth(args.month)) throw new UserError("That month is not valid");
    const persons: Person[] = args.view === "hh" ? ["a", "b"] : [args.view];
    persons.forEach((p) => ensureMonth(args.month, p));
    const inPersons = persons.map((p) => `'${p}'`).join(", ");
    const share = args.view === "hh" ? "a_cents + b_cents" : `${args.view}_cents`;
    const planned = new Map(
      all<{ category_id: number; planned: number }>(
        db,
        `select category_id, sum(planned_cents) planned from budget_lines where month = ? and person in (${inPersons}) group by category_id`,
        args.month,
      ).map((r) => [r.category_id, r.planned]),
    );
    const actualRows = all<{ category_id: number | null; kind: string; actual: number }>(
      db,
      `select category_id, kind, sum(${share}) actual from entries
       where date like ? and kind in ('expense', 'income') and from_fund = 0 group by category_id, kind`,
      `${args.month}-%`,
    );
    const actual = new Map(actualRows.filter((r) => r.category_id !== null).map((r) => [r.category_id as number, r.actual]));
    const rows: BudgetRow[] = listCategories({ includeArchived: true })
      .map((c) => ({
        category_id: c.id,
        name: c.name,
        grp: c.grp,
        kind: c.kind,
        icon: c.icon,
        archived: c.archived,
        planned: planned.get(c.id) ?? 0,
        actual: actual.get(c.id) ?? 0,
      }))
      .filter((r) => !r.archived || r.planned !== 0 || r.actual !== 0);
    for (const r of actualRows.filter((x) => x.category_id === null && x.actual !== 0)) {
      rows.push({
        category_id: 0,
        name: "Uncategorized",
        grp: r.kind === "income" ? "Income" : "Uncategorized",
        kind: r.kind as "expense" | "income",
        icon: "circle-help",
        archived: false,
        planned: 0,
        actual: r.actual,
      });
    }
    const start = get<{ s: number | null }>(
      db,
      `select sum(start_balance_cents) s from months where month = ? and person in (${inPersons})`,
      args.month,
    )!.s;
    return { rows, startBalanceCents: start ?? 0 };
  }

  function setPlanned(args: { month: string; person: Person; category_id: number; planned_cents: Cents; forward?: boolean }): void {
    mutate("Change planned amount", () => {
      if (!isMonth(args.month) || !isPerson(args.person)) throw new UserError("That budget line is not valid");
      if (!Number.isInteger(args.planned_cents) || args.planned_cents < 0) throw new UserError("Enter a planned amount of zero or more");
      if (!readRow("categories", { id: args.category_id })) throw new UserError("That category no longer exists");
      const months = [args.month];
      if (args.forward) {
        months.push(
          ...all<{ month: string }>(db, "select distinct month from budget_lines where person = ? and month > ?", args.person, args.month).map((r) => r.month),
        );
      }
      for (const month of months) {
        record("budget_lines", { month, person: args.person, category_id: args.category_id });
        run(
          db,
          `insert into budget_lines (month, person, category_id, planned_cents) values (?, ?, ?, ?)
           on conflict (month, person, category_id) do update set planned_cents = excluded.planned_cents`,
          month, args.person, args.category_id, args.planned_cents,
        );
      }
    });
  }

  function setStartBalance(args: { month: string; person: Person; cents: Cents }): void {
    mutate("Change starting balance", () => {
      if (!isMonth(args.month) || !isPerson(args.person) || !Number.isInteger(args.cents)) throw new UserError("That starting balance is not valid");
      record("months", { month: args.month, person: args.person });
      run(
        db,
        `insert into months (month, person, start_balance_cents) values (?, ?, ?)
         on conflict (month, person) do update set start_balance_cents = excluded.start_balance_cents`,
        args.month, args.person, args.cents,
      );
    });
  }

  // ---- balance between the two people -------------------------------------

  function getBalance(args: { month?: string } = {}): { cents: Cents; openingCents: Cents; monthDeltaCents: Cents } {
    const rows = all<BalanceEntry & { date: string }>(
      db,
      // A purchase paid from a fund was shared out when the money was set aside, so it moves no balance.
      "select date, kind, paid_by, amount_cents, a_cents, b_cents from entries where kind in ('expense', 'settlement') and from_fund = 0",
    );
    const opening = getSettings().openingBalanceCents;
    const inMonth = args.month ? rows.filter((r) => r.date.startsWith(args.month!)) : [];
    return { cents: balance(rows, opening), openingCents: opening, monthDeltaCents: balance(inMonth) };
  }

  // ---- recurring bills ----------------------------------------------------

  const resolveSplit = (split: TemplateSplit): SplitSpec => (split.type === "default" ? getSettings().defaultSplit : split);
  const dueDate = (month: string, dueDay: number) => `${month}-${String(Math.min(Math.max(dueDay, 1), daysInMonth(month))).padStart(2, "0")}`;
  const billEntry = (id: number, month: string) =>
    get<Row>(db, "select * from entries where recurring_id = ? and split_of is null and date like ? order by id limit 1", id, `${month}-%`);
  const templateOf = (id: number): Row => {
    const row = readRow("recurring", { id });
    if (!row) throw new UserError("That bill no longer exists");
    return row;
  };

  function checkBill(input: BillInput): BillInput {
    const name = (input.name ?? "").trim();
    if (!name) throw new UserError("Enter a name for the bill");
    if (!Number.isInteger(input.due_day) || input.due_day < 1 || input.due_day > 31) throw new UserError("Enter a due day from 1 to 31");
    if (!Number.isInteger(input.amount_cents) || input.amount_cents < 0) throw new UserError("Enter the usual amount, or 0 if it varies");
    if (!isPerson(input.paid_by)) throw new UserError("Choose who pays the bill");
    if (input.split.type !== "default" && !isValidSplit(input.split)) throw new UserError("That split is not valid");
    if (input.category_id !== null) {
      const cat = get<{ kind: string }>(db, "select kind from categories where id = ?", input.category_id);
      if (!cat || cat.kind !== "expense") throw new UserError("Choose an expense category");
    }
    if (input.split.type === "fixed" && input.amount_cents > 0) {
      try {
        computeShares(input.amount_cents, input.split);
      } catch (error) {
        throw new UserError((error as Error).message);
      }
    }
    return { ...input, name };
  }

  const toBillInput = (t: Row): BillInput => ({
    name: t.name as string,
    category_id: (t.category_id as number) ?? null,
    due_day: (t.due_day as number) ?? 1,
    amount_cents: t.amount_cents as number,
    paid_by: t.paid_by as Person,
    split: JSON.parse(t.split_json as string) as TemplateSplit,
  });

  /** Creates the month's entry for one bill. A bill with no usual amount waits for one to be typed. */
  function createBillEntry(t: Row, month: string, amount = t.amount_cents as number): number | null {
    if (amount === 0) return null;
    const bill = toBillInput(t);
    return insertEntry(
      { date: dueDate(month, bill.due_day), description: bill.name, amount_cents: amount, kind: "expense", category_id: bill.category_id, paid_by: bill.paid_by, split: resolveSplit(bill.split), account: (t.account as string) ?? null },
      { recurring_id: t.id as number },
    );
  }

  const markGenerated = (id: number, month: string) =>
    run(db, "update recurring set last_generated = ? where id = ? and (last_generated is null or last_generated < ?)", month, id, month);

  /**
   * Moving into a new month creates that month's bills once. A bill deleted on purpose is not
   * recreated, because each template remembers the last month it produced.
   */
  function rollBillsForward(month: string) {
    const due = all<Row>(db, "select * from recurring where active = 1 and cadence = 'monthly' and (last_generated is null or last_generated < ?)", month);
    if (due.length === 0) return;
    tx(db, () => {
      for (const t of due) {
        if (!billEntry(t.id as number, month)) createBillEntry(t, month);
        markGenerated(t.id as number, month);
      }
      bumpRev();
    });
  }

  function listBills(args: { month: string; today: string }): { rows: BillRow[]; missing: number } {
    if (!isMonth(args.month) || !isISODate(args.today)) throw new UserError("That month is not valid");
    if (args.month === monthOf(args.today)) rollBillsForward(args.month);
    const rows = all<Row>(
      db,
      `select r.*, c.name as category_name from recurring r left join categories c on c.id = r.category_id
       where r.cadence = 'monthly' order by r.active desc, r.due_day, r.id`,
    ).map((t): BillRow => {
      const e = billEntry(t.id as number, args.month);
      const pieces = e ? get<{ amount: number; a: number; b: number }>(db, "select sum(amount_cents) amount, sum(a_cents) a, sum(b_cents) b from entries where id = ? or split_of = ?", e.id, e.id)! : null;
      const previous = get<{ total: number | null }>(
        db,
        `select sum(amount_cents) total from entries where recurring_id = ? and substr(date, 1, 7) =
           (select max(substr(date, 1, 7)) from entries where recurring_id = ? and date < ?)`,
        t.id, t.id, `${args.month}-01`,
      );
      return {
        id: t.id as number,
        name: t.name as string,
        category_id: (t.category_id as number) ?? null,
        category_name: (t.category_name as string) ?? null,
        due_day: (t.due_day as number) ?? 1,
        expected_cents: t.amount_cents as number,
        paid_by: t.paid_by as Person,
        split: JSON.parse(t.split_json as string) as TemplateSplit,
        active: t.active === 1,
        entry: e && pieces ? { id: e.id as number, date: e.date as string, amount_cents: pieces.amount, a_cents: pieces.a, b_cents: pieces.b, seen_in_bank: e.seen_in_bank === 1 } : null,
        previous_cents: previous?.total ?? null,
      };
    });
    return { rows, missing: rows.filter((r) => r.active && r.expected_cents > 0 && !r.entry).length };
  }

  function createBill(input: BillInput & { month: string }): number {
    return mutate("Add bill", () => {
      if (!isMonth(input.month)) throw new UserError("That month is not valid");
      const bill = checkBill(input);
      const id = run(
        db,
        "insert into recurring (name, category_id, cadence, due_day, amount_cents, paid_by, split_json, active, last_generated) values (?, ?, 'monthly', ?, ?, ?, ?, 1, ?)",
        bill.name, bill.category_id, bill.due_day, bill.amount_cents, bill.paid_by, JSON.stringify(bill.split), input.month,
      ).lastInsertRowid as number;
      record("recurring", { id }, true);
      createBillEntry(templateOf(id), input.month);
      return id;
    });
  }

  /** Changes a bill. When `month` is given, that month's entry follows the change (all but the amount). */
  function updateBill(args: { id: number; patch: Partial<BillInput> & { active?: boolean }; month?: string }): void {
    mutate("Edit bill", () => {
      const before = templateOf(args.id);
      const bill = checkBill({ ...toBillInput(before), ...args.patch });
      record("recurring", { id: args.id });
      run(
        db,
        "update recurring set name = ?, category_id = ?, due_day = ?, amount_cents = ?, paid_by = ?, split_json = ?, active = ? where id = ?",
        bill.name, bill.category_id, bill.due_day, bill.amount_cents, bill.paid_by, JSON.stringify(bill.split),
        args.patch.active === undefined ? before.active : args.patch.active ? 1 : 0, args.id,
      );
      const entry = args.month ? billEntry(args.id, args.month) : undefined;
      if (entry && args.month) {
        const p = args.patch;
        const patch: EntryPatch = {};
        if (p.name !== undefined) patch.description = bill.name;
        if (p.category_id !== undefined) patch.category_id = bill.category_id;
        if (p.paid_by !== undefined) patch.paid_by = bill.paid_by;
        if (p.split !== undefined) patch.split = resolveSplit(bill.split);
        if (p.due_day !== undefined) patch.date = dueDate(args.month, bill.due_day);
        if (Object.keys(patch).length > 0) applyPatch(entry.id as number, patch);
      }
    });
  }

  /** Sets what a bill came to in one month. Zero means there was no bill that month. */
  function setBillMonthAmount(args: { id: number; month: string; amount_cents: Cents }): void {
    mutate("Change bill amount", () => {
      if (!isMonth(args.month)) throw new UserError("That month is not valid");
      if (!Number.isInteger(args.amount_cents) || args.amount_cents < 0) throw new UserError("Enter the amount of the bill");
      const t = templateOf(args.id);
      const entry = billEntry(args.id, args.month);
      if (!entry) {
        createBillEntry(t, args.month, args.amount_cents);
      } else if (args.amount_cents === 0) {
        if (get<{ n: number }>(db, "select count(*) n from entries where split_of = ?", entry.id)!.n > 0) throw new UserError("This bill was split across categories. Change it on the Transactions screen.");
        record("entries", { id: entry.id });
        run(db, "delete from entries where id = ?", entry.id);
      } else {
        const pieces = get<{ total: number }>(db, "select coalesce(sum(amount_cents), 0) total from entries where split_of = ?", entry.id)!.total;
        if (args.amount_cents <= pieces) throw new UserError("This bill was split across categories. Change it on the Transactions screen.");
        applyPatch(entry.id as number, { amount_cents: args.amount_cents - pieces });
      }
      record("recurring", { id: args.id });
      markGenerated(args.id, args.month);
    });
  }

  /** Creates the month's entry for every active bill that does not have one. */
  function generateBills(args: { month: string }): number {
    return mutate("Create bills", () => {
      if (!isMonth(args.month)) throw new UserError("That month is not valid");
      let made = 0;
      for (const t of all<Row>(db, "select * from recurring where active = 1 and cadence = 'monthly'")) {
        if (billEntry(t.id as number, args.month)) continue;
        record("recurring", { id: t.id });
        if (createBillEntry(t, args.month) !== null) made++;
        markGenerated(t.id as number, args.month);
      }
      return made;
    });
  }

  /** Deletes a bill template. The entries it created stay as ordinary entries. */
  const removeBill = (args: { id: number }) => removeTemplate("Delete bill", args.id);
  const removeRenewal = (args: { id: number }) => removeTemplate("Delete renewal", args.id);
  function removeTemplate(label: string, id: number): void {
    const args = { id };
    mutate(label, () => {
      templateOf(args.id);
      for (const e of all<Row>(db, "select id from entries where recurring_id = ?", args.id)) {
        record("entries", { id: e.id });
        run(db, "update entries set recurring_id = null where id = ?", e.id);
      }
      record("recurring", { id: args.id });
      run(db, "delete from recurring where id = ?", args.id);
    });
  }

  function setSeen(args: { id: number; seen: boolean }): void {
    mutate(args.seen ? "Mark as paid" : "Mark as not paid", () => {
      entryById(args.id);
      record("entries", { id: args.id });
      run(db, "update entries set seen_in_bank = ? where id = ?", args.seen ? 1 : 0, args.id);
    });
  }

  // ---- funds --------------------------------------------------------------

  const OWNERS: View[] = ["a", "b", "hh"];
  /** Money set aside into a fund: every expense in the category that feeds it, except ones paid from a fund. */
  const fundIn = (categoryId: number | null, where = "", ...params: (string | number)[]) =>
    categoryId === null ? 0 : get<{ t: number }>(db, `select coalesce(sum(amount_cents), 0) t from entries where category_id = ? and kind = 'expense' and from_fund = 0 ${where}`, categoryId, ...params)!.t;
  /** Money paid out of a fund. */
  const fundOut = (fundId: number, where = "", ...params: (string | number)[]) =>
    get<{ t: number }>(db, `select coalesce(sum(amount_cents), 0) t from entries where fund_id = ? and from_fund = 1 ${where}`, fundId, ...params)!.t;
  const fundById = (id: number): Row => {
    const row = readRow("funds", { id });
    if (!row) throw new UserError("That fund no longer exists");
    return row;
  };

  function toFund(f: Row, month: string): FundRow {
    const categoryId = (f.category_id as number) ?? null;
    const like = `${month}-%`;
    return {
      id: f.id as number,
      name: f.name as string,
      owner: f.owner as View,
      target_cents: (f.target_cents as number) ?? null,
      category_id: categoryId,
      category_name: categoryId === null ? null : (get<{ name: string }>(db, "select name from categories where id = ?", categoryId)?.name ?? null),
      emergency: f.emergency === 1,
      archived: f.archived === 1,
      balance_cents: fundBalance(f.opening_cents as number, fundIn(categoryId), fundOut(f.id as number)),
      month_in_cents: fundIn(categoryId, "and date like ?", like),
      month_out_cents: fundOut(f.id as number, "and date like ?", like),
    };
  }

  /** What a person plans for a group in a month. A month with no plan of its own stands on the latest one before it. */
  function plannedInGroup(person: Person, month: string, group: string): Cents {
    const from = get<{ m: string | null }>(db, "select max(month) m from budget_lines where person = ? and month <= ?", person, month)!.m;
    if (!from) return 0;
    return get<{ t: number }>(
      db,
      "select coalesce(sum(b.planned_cents), 0) t from budget_lines b join categories c on c.id = b.category_id where b.month = ? and b.person = ? and c.grp = ? and c.kind = 'expense'",
      from, person, group,
    )!.t;
  }

  /** How long the emergency funds would cover the first group's spending (Needs, unless the groups were changed). */
  function runwayFor(month: string, funds: FundRow[]): Runway {
    const group = getSettings().groups[0] ?? null;
    const emergency = funds.filter((f) => f.emergency && !f.archived).reduce((t, f) => t + f.balance_cents, 0);
    const months = all<{ m: string }>(db, "select distinct substr(date, 1, 7) m from entries where date < ? order by m desc limit 3", `${month}-01`).map((r) => r.m);
    let monthly = 0;
    if (group && months.length > 0) {
      const spent = get<{ t: number }>(
        db,
        `select coalesce(sum(e.amount_cents), 0) t from entries e join categories c on c.id = e.category_id
         where c.grp = ? and e.kind = 'expense' and e.from_fund = 0 and substr(e.date, 1, 7) in (${months.map(() => "?").join(", ")})`,
        group, ...months,
      )!.t;
      monthly = evenShare(spent, months.length);
    } else if (group) {
      monthly = plannedInGroup("a", month, group) + plannedInGroup("b", month, group);
    }
    return { group, emergency_cents: emergency, monthly_cents: monthly, months: runwayMonths(emergency, monthly), basis: months.length > 0 ? "spending" : "plan", monthsUsed: months.length };
  }

  function listFunds(args: { month: string }): { funds: FundRow[]; runway: Runway } {
    if (!isMonth(args.month)) throw new UserError("That month is not valid");
    const funds = all<Row>(db, "select * from funds order by archived, name collate nocase, id").map((f) => toFund(f, args.month));
    return { funds, runway: runwayFor(args.month, funds) };
  }

  function checkFund(input: Omit<FundInput, "balance_cents">, id: number | null) {
    const name = (input.name ?? "").trim();
    if (!name) throw new UserError("Enter a name for the fund");
    if (get(db, "select id from funds where lower(name) = lower(?) and id is not ?", name, id)) throw new UserError("There is already a fund with that name");
    if (!OWNERS.includes(input.owner)) throw new UserError("Choose whose fund this is");
    if (input.target_cents !== null && (!Number.isInteger(input.target_cents) || input.target_cents <= 0)) throw new UserError("Enter a target, or leave it empty");
    if (input.category_id !== null) {
      if (get<{ kind: string }>(db, "select kind from categories where id = ?", input.category_id)?.kind !== "expense") throw new UserError("Choose the budget category that feeds this fund");
      const taken = get<{ name: string }>(db, "select name from funds where category_id = ? and id is not ?", input.category_id, id);
      if (taken) throw new UserError(`That category already feeds ${taken.name}`);
    }
    return { ...input, name };
  }

  function createFund(input: FundInput): number {
    return mutate("Add fund", () => {
      const f = checkFund(input, null);
      if (!Number.isInteger(input.balance_cents)) throw new UserError("Enter what is in the fund today, or 0");
      const id = run(
        db,
        "insert into funds (name, owner, target_cents, opening_cents, category_id, emergency) values (?, ?, ?, ?, ?, ?)",
        f.name, f.owner, f.target_cents, openingFor(input.balance_cents, fundIn(f.category_id), 0), f.category_id, f.emergency ? 1 : 0,
      ).lastInsertRowid as number;
      record("funds", { id }, true);
      return id;
    });
  }

  /** Changes a fund. Pointing it at a different category keeps the balance it shows. */
  function updateFund(args: { id: number; patch: Partial<Omit<FundInput, "balance_cents">> & { archived?: boolean } }): void {
    mutate("Edit fund", () => {
      const before = fundById(args.id);
      const f = checkFund(
        {
          name: args.patch.name ?? (before.name as string),
          owner: args.patch.owner ?? (before.owner as View),
          target_cents: args.patch.target_cents !== undefined ? args.patch.target_cents : ((before.target_cents as number) ?? null),
          category_id: args.patch.category_id !== undefined ? args.patch.category_id : ((before.category_id as number) ?? null),
          emergency: args.patch.emergency ?? before.emergency === 1,
        },
        args.id,
      );
      const opening = (before.opening_cents as number) + fundIn((before.category_id as number) ?? null) - fundIn(f.category_id);
      record("funds", { id: args.id });
      run(
        db,
        "update funds set name = ?, owner = ?, target_cents = ?, category_id = ?, emergency = ?, opening_cents = ?, archived = ? where id = ?",
        f.name, f.owner, f.target_cents, f.category_id, f.emergency ? 1 : 0, opening, args.patch.archived === undefined ? (before.archived as number) : args.patch.archived ? 1 : 0, args.id,
      );
    });
  }

  /** Trues a fund up to what is really in it. Nothing is added to the entries. */
  function setFundBalance(args: { id: number; balance_cents: Cents }): void {
    mutate("Set fund balance", () => {
      const f = fundById(args.id);
      if (!Number.isInteger(args.balance_cents)) throw new UserError("Enter what is in the fund");
      record("funds", { id: args.id });
      run(db, "update funds set opening_cents = ? where id = ?", openingFor(args.balance_cents, fundIn((f.category_id as number) ?? null), fundOut(args.id)), args.id);
    });
  }

  function removeFund(args: { id: number }): void {
    mutate("Delete fund", () => {
      fundById(args.id);
      if (get(db, "select id from entries where fund_id = ? limit 1", args.id)) throw new UserError("Purchases were paid from this fund. Archive it instead, so they stay out of the budget.");
      for (const r of all<Row>(db, "select id from recurring where fund_id = ?", args.id)) {
        record("recurring", { id: r.id });
        run(db, "update recurring set fund_id = null where id = ?", r.id);
      }
      record("funds", { id: args.id });
      run(db, "delete from funds where id = ?", args.id);
    });
  }

  // ---- renewals -----------------------------------------------------------

  const renewalMonths = (t: Row) => Number((t.cadence as string).slice("every:".length));
  const toRenewalInput = (t: Row): RenewalInput => ({
    name: t.name as string,
    category_id: (t.category_id as number) ?? null,
    months: renewalMonths(t),
    next_date: t.next_date as string,
    amount_cents: t.amount_cents as number,
    paid_by: t.paid_by as Person,
    split: JSON.parse(t.split_json as string) as TemplateSplit,
    fund_id: (t.fund_id as number) ?? null,
  });
  const renewalById = (id: number): Row => {
    const row = readRow("recurring", { id });
    if (!row || !(row.cadence as string).startsWith("every:")) throw new UserError("That renewal no longer exists");
    return row;
  };

  function checkRenewal(input: RenewalInput): RenewalInput {
    const name = (input.name ?? "").trim();
    if (!name) throw new UserError("Enter a name for the renewal");
    if (!Number.isInteger(input.months) || input.months < 1 || input.months > 120) throw new UserError("Enter how many months pass between renewals, such as 12");
    if (!isISODate(input.next_date)) throw new UserError("Enter the date it next renews");
    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) throw new UserError("Enter what the renewal costs");
    if (!isPerson(input.paid_by)) throw new UserError("Choose who pays the renewal");
    if (input.split.type !== "default" && !isValidSplit(input.split)) throw new UserError("That split is not valid");
    if (input.category_id !== null && get<{ kind: string }>(db, "select kind from categories where id = ?", input.category_id)?.kind !== "expense") throw new UserError("Choose an expense category");
    if (input.fund_id !== null) fundById(input.fund_id);
    try {
      computeShares(input.amount_cents, resolveSplit(input.split));
    } catch (error) {
      throw new UserError((error as Error).message);
    }
    return { ...input, name };
  }

  function createRenewal(input: RenewalInput): number {
    return mutate("Add renewal", () => {
      const r = checkRenewal(input);
      const id = run(
        db,
        "insert into recurring (name, category_id, cadence, next_date, amount_cents, paid_by, split_json, fund_id, active) values (?, ?, ?, ?, ?, ?, ?, ?, 1)",
        r.name, r.category_id, `every:${r.months}`, r.next_date, r.amount_cents, r.paid_by, JSON.stringify(r.split), r.fund_id,
      ).lastInsertRowid as number;
      record("recurring", { id }, true);
      return id;
    });
  }

  function updateRenewal(args: { id: number; patch: Partial<RenewalInput> & { active?: boolean } }): void {
    mutate("Edit renewal", () => {
      const before = renewalById(args.id);
      const r = checkRenewal({ ...toRenewalInput(before), ...args.patch });
      record("recurring", { id: args.id });
      run(
        db,
        "update recurring set name = ?, category_id = ?, cadence = ?, next_date = ?, amount_cents = ?, paid_by = ?, split_json = ?, fund_id = ?, active = ? where id = ?",
        r.name, r.category_id, `every:${r.months}`, r.next_date, r.amount_cents, r.paid_by, JSON.stringify(r.split), r.fund_id,
        args.patch.active === undefined ? (before.active as number) : args.patch.active ? 1 : 0, args.id,
      );
    });
  }

  /**
   * A renewal whose date has come becomes an entry on that date, and its next date moves on.
   * When it is paid from a fund, the entry draws the fund down and stays out of the month's budget.
   */
  function rollRenewalsForward(today: string) {
    const due = all<Row>(db, "select * from recurring where active = 1 and cadence like 'every:%' and next_date <= ?", today);
    if (due.length === 0) return;
    tx(db, () => {
      for (const t of due) {
        const r = toRenewalInput(t);
        let next = r.next_date;
        // Catch up if the app was not opened for a while, but never run away.
        for (let i = 0; i < 24 && next <= today; i++) {
          insertEntry(
            { date: next, description: r.name, amount_cents: r.amount_cents, kind: "expense", category_id: r.category_id, paid_by: r.paid_by, split: resolveSplit(r.split), paid_from_fund: r.fund_id },
            { recurring_id: t.id as number },
          );
          next = addMonthsToDate(next, r.months);
        }
        run(db, "update recurring set next_date = ? where id = ?", next, t.id);
      }
      bumpRev();
    });
  }

  const checksPerYear = (person: Person): number | null => {
    const schedule = getPayProfile({ person })?.schedule;
    if (!schedule) return null;
    return schedule.rule === "biweekly" ? 26 : 12 * new Set(schedule.monthDays).size;
  };

  function listRenewals(args: { today: string }): RenewalList {
    if (!isISODate(args.today)) throw new UserError("That date is not valid");
    rollRenewalsForward(args.today);
    const yearly = { a: 0, b: 0 };
    const rows = all<Row>(
      db,
      "select r.*, c.name as category_name from recurring r left join categories c on c.id = r.category_id where r.cadence like 'every:%' order by r.active desc, r.next_date, r.id",
    ).map((t): RenewalRow => {
      const r = toRenewalInput(t);
      const shares = computeShares(r.amount_cents, resolveSplit(r.split));
      if (t.active === 1) {
        yearly.a += yearlyCost(shares.a, r.months);
        yearly.b += yearlyCost(shares.b, r.months);
      }
      return { id: t.id as number, ...r, category_name: (t.category_name as string) ?? null, active: t.active === 1, a_cents: shares.a, b_cents: shares.b };
    });
    return { rows, yearly_cents: yearly, checksPerYear: { a: checksPerYear("a"), b: checksPerYear("b") } };
  }

  // ---- pay ----------------------------------------------------------------

  const DEFAULT_SCHEDULE: PaySchedule = { rule: "biweekly", anchor: "", lagDays: 5, monthDays: [15, 31], sickHoursPerYear: 0, usualHours: 0, grossGoalCents: null, incomeCategoryId: null, history: [] };
  const TAGS: DayTag[] = ["worked", "sick", "holiday", "off"];

  const payRates = (person: Person): PayRate[] =>
    all<Row>(db, "select * from pay_profiles where person = ? order by effective_date, id", person).map((r) => ({
      id: r.id as number,
      effective_date: r.effective_date as string,
      kind: r.kind as PayRate["kind"],
      rate_cents: (r.rate_cents as number) ?? null,
      net_per_check_cents: (r.net_per_check_cents as number) ?? null,
    }));
  /** The rate in force on a date: the latest one that has started, or the first if none has yet. */
  const rateAt = (rates: PayRate[], date: string) => [...rates].reverse().find((r) => r.effective_date <= date) ?? rates[0];

  function getPayProfile(args: { person: Person }): PayProfile | null {
    if (!isPerson(args.person)) throw new UserError("Choose whose pay this is");
    const rates = payRates(args.person);
    if (rates.length === 0) return null;
    // A rate row added a moment ago has no schedule yet, so read it from one that does.
    const stored = get<{ s: string }>(db, "select schedule_json s from pay_profiles where person = ? and schedule_json is not null order by effective_date desc, id desc limit 1", args.person)?.s;
    return { person: args.person, current: rateAt(rates, today()), rates, schedule: { ...DEFAULT_SCHEDULE, ...(JSON.parse(stored ?? "{}") as Partial<PaySchedule>) } };
  }
  const profileOf = (person: Person): PayProfile => {
    const profile = getPayProfile({ person });
    if (!profile) throw new UserError("Set up pay first");
    return profile;
  };

  /** The schedule is one thing per person, kept on every one of their rate rows. */
  function writeSchedule(person: Person, schedule: PaySchedule) {
    for (const r of payRates(person)) record("pay_profiles", { id: r.id });
    run(db, "update pay_profiles set schedule_json = ? where person = ?", JSON.stringify(schedule), person);
  }

  function checkSchedule(s: PaySchedule) {
    if (s.rule !== "biweekly" && s.rule !== "monthdays") throw new UserError("Choose how often the pay arrives");
    if (!Number.isInteger(s.lagDays) || s.lagDays < 0 || s.lagDays > 31) throw new UserError("Enter how many days after a pay period ends the pay arrives, from 0 to 31");
    if (s.rule === "biweekly" && (!isISODate(s.anchor) || weekday(s.anchor) !== 1)) throw new UserError("Enter a Monday that starts a pay period");
    if (s.rule === "monthdays" && (!Array.isArray(s.monthDays) || s.monthDays.length === 0 || s.monthDays.some((d) => !Number.isInteger(d) || d < 1 || d > 31)))
      throw new UserError("Enter the paydays as days of the month, such as 15 and 31");
    if (!Number.isFinite(s.sickHoursPerYear) || s.sickHoursPerYear < 0) throw new UserError("Enter sick hours per year, or 0");
    if (!Number.isFinite(s.usualHours) || s.usualHours < 0 || s.usualHours > 400) throw new UserError("Enter the usual hours in a paycheck, or 0");
    if (s.grossGoalCents !== null && (!Number.isInteger(s.grossGoalCents) || s.grossGoalCents <= 0)) throw new UserError("Enter a yearly gross goal, or leave it empty");
    if (s.incomeCategoryId !== null && get<{ kind: string }>(db, "select kind from categories where id = ?", s.incomeCategoryId)?.kind !== "income") throw new UserError("Choose an income category");
    checkKnown(s.history);
  }
  function checkKnown(history: KnownPaycheck[]) {
    for (const h of history) {
      if (!Number.isInteger(h.gross_cents) || !Number.isInteger(h.net_cents) || h.gross_cents <= 0 || h.net_cents <= 0) throw new UserError("Each known paycheck needs a gross amount and a take-home amount");
      if (h.net_cents > h.gross_cents) throw new UserError("Take-home cannot be more than gross");
    }
  }
  function checkRate(kind: string, rate: Cents | null, net: Cents | null) {
    if (kind !== "hourly" && kind !== "salaried") throw new UserError("Choose hourly or salaried");
    if (kind === "hourly" && (!Number.isInteger(rate) || rate! <= 0)) throw new UserError("Enter the hourly rate");
    if (kind === "salaried" && (!Number.isInteger(net) || net! <= 0)) throw new UserError("Enter the take-home pay per paycheck");
  }
  function writeRate(person: Person, r: { effective_date: string; kind: string; rate_cents: Cents | null; net_per_check_cents: Cents | null }) {
    if (!isISODate(r.effective_date)) throw new UserError("Enter the date this pay started");
    const rate = r.kind === "hourly" ? r.rate_cents : null;
    const net = r.kind === "hourly" ? null : r.net_per_check_cents;
    checkRate(r.kind, rate, net);
    const same = get<{ id: number }>(db, "select id from pay_profiles where person = ? and effective_date = ?", person, r.effective_date);
    if (same) {
      record("pay_profiles", { id: same.id });
      run(db, "update pay_profiles set kind = ?, rate_cents = ?, net_per_check_cents = ? where id = ?", r.kind, rate, net, same.id);
    } else {
      const id = run(db, "insert into pay_profiles (person, effective_date, kind, rate_cents, net_per_check_cents) values (?, ?, ?, ?, ?)", person, r.effective_date, r.kind, rate, net)
        .lastInsertRowid as number;
      record("pay_profiles", { id }, true);
    }
  }

  /** Saves how a person is paid. A start date that already has a rate corrects it; a new date adds a rate from then on. */
  function savePayProfile(input: PayProfileInput): PayProfile {
    return mutate("Change pay settings", () => {
      if (!isPerson(input.person)) throw new UserError("Choose whose pay this is");
      const schedule: PaySchedule = {
        rule: input.rule,
        anchor: input.anchor,
        lagDays: input.lagDays,
        monthDays: Array.isArray(input.monthDays) ? [...new Set(input.monthDays)].sort((x, y) => x - y) : [],
        sickHoursPerYear: input.sickHoursPerYear,
        usualHours: input.usualHours,
        grossGoalCents: input.grossGoalCents,
        incomeCategoryId: input.incomeCategoryId,
        history: getPayProfile({ person: input.person })?.schedule.history ?? [],
      };
      checkSchedule(schedule);
      writeRate(input.person, input);
      writeSchedule(input.person, schedule);
      return profileOf(input.person);
    });
  }

  function removePayRate(args: { id: number }): void {
    mutate("Remove pay rate", () => {
      const row = readRow("pay_profiles", { id: args.id });
      if (!row) throw new UserError("That rate no longer exists");
      if (payRates(row.person as Person).length <= 1) throw new UserError("Keep at least one rate");
      record("pay_profiles", { id: args.id });
      run(db, "delete from pay_profiles where id = ?", args.id);
    });
  }

  /** Replaces the list of known past paychecks that predictions learn from. */
  function setPayHistory(args: { person: Person; history: KnownPaycheck[] }): void {
    mutate("Change known paychecks", () => {
      const profile = profileOf(args.person);
      checkKnown(args.history);
      writeSchedule(args.person, {
        ...profile.schedule,
        history: args.history.map((h) => ({ gross_cents: h.gross_cents, net_cents: h.net_cents, ...(h.no_benefits ? { no_benefits: true } : {}) })),
      });
    });
  }

  function setWorkDay(args: { person: Person; date: string; hours: number; tag: DayTag }): void {
    mutate("Change hours", () => {
      if (!isPerson(args.person) || !isISODate(args.date)) throw new UserError("That day is not valid");
      if (!Number.isFinite(args.hours) || args.hours < 0 || args.hours > 24) throw new UserError("Enter hours from 0 to 24");
      if (!TAGS.includes(args.tag)) throw new UserError("Choose worked, sick, holiday or off");
      const hours = args.tag === "off" ? 0 : Math.round(args.hours * 100) / 100;
      record("work_days", { date: args.date, person: args.person });
      if (hours === 0 && args.tag === "worked") run(db, "delete from work_days where date = ? and person = ?", args.date, args.person);
      else
        run(
          db,
          "insert into work_days (date, person, hours, tag) values (?, ?, ?, ?) on conflict (date, person) do update set hours = excluded.hours, tag = excluded.tag",
          args.date, args.person, hours, args.tag,
        );
    });
  }

  /** A paycheck as stored, or as the schedule gives it when nothing has been typed on it (id null). */
  interface Check extends PayPeriod {
    id: number | null;
    actual_gross_cents: Cents | null;
    actual_net_cents: Cents | null;
    no_benefits: boolean;
  }
  const storedChecks = (person: Person): Check[] =>
    all<Row>(db, "select * from paychecks where person = ? order by pay_date, id", person).map((r) => ({
      id: r.id as number,
      period_start: r.period_start as string,
      period_end: r.period_end as string,
      pay_date: r.pay_date as string,
      actual_gross_cents: (r.actual_gross_cents as number) ?? null,
      actual_net_cents: (r.actual_net_cents as number) ?? null,
      no_benefits: r.no_benefits === 1,
    }));
  const touches = (p: PayPeriod, from: string, to: string) => (p.period_end >= from && p.period_start <= to) || (p.pay_date >= from && p.pay_date <= to);

  /** Days a payday cannot land on: bank holidays, and days this person tagged as a holiday. */
  function closedDays(person: Person, from: string, to: string): Set<string> {
    const days = new Set(all<{ date: string }>(db, "select date from work_days where person = ? and tag = 'holiday'", person).map((r) => r.date));
    for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++) for (const h of usBankHolidays(y)) days.add(h.date);
    return days;
  }
  const scheduled = (person: Person, schedule: PaySchedule, from: string, to: string): PayPeriod[] => payPeriods(schedule, from, to, closedDays(person, from, to));

  /** Paychecks touching a range: the stored ones, plus the schedule's wherever no stored one overlaps. */
  function checksBetween(person: Person, schedule: PaySchedule, from: string, to: string): Check[] {
    const stored = storedChecks(person);
    const fromSchedule = scheduled(person, schedule, from, to)
      .filter((p) => !stored.some((s) => s.period_start <= p.period_end && s.period_end >= p.period_start))
      .map((p): Check => ({ id: null, ...p, actual_gross_cents: null, actual_net_cents: null, no_benefits: false }));
    return [...stored.filter((c) => touches(c, from, to)), ...fromSchedule].sort((x, y) => x.pay_date.localeCompare(y.pay_date) || x.period_start.localeCompare(y.period_start));
  }

  const hoursIn = (person: Person, from: string, to: string) =>
    get<{ h: number | null }>(db, "select sum(hours) h from work_days where person = ? and date >= ? and date <= ?", person, from, to)!.h ?? 0;

  /** Everything predictions can learn from: the typed list of past paychecks, and paychecks with their real take-home filled in. */
  function knownPaychecks(profile: PayProfile): KnownPaycheck[] {
    const filledIn = storedChecks(profile.person).flatMap((c): KnownPaycheck[] => {
      if (!c.actual_net_cents) return [];
      const rate = rateAt(profile.rates, c.period_end);
      if (rate.kind !== "hourly") return [];
      const gross = c.actual_gross_cents ?? grossPay(hoursIn(profile.person, c.period_start, c.period_end), rate.rate_cents ?? 0);
      return gross > 0 ? [{ gross_cents: gross, net_cents: c.actual_net_cents, no_benefits: c.no_benefits }] : [];
    });
    return [...profile.schedule.history, ...filledIn];
  }

  /** One person's share of the bills dated from `from` up to, but not on, `before`. */
  function billsDue(person: Person, from: string, before: string): PaycheckView["bills"] {
    const out: PaycheckView["bills"] = [];
    const templates = all<Row>(db, "select * from recurring where cadence = 'monthly'");
    for (let month = monthOf(from); month <= monthOf(addDays(before, -1)); month = addMonths(month, 1)) {
      for (const t of templates) {
        const entry = billEntry(t.id as number, month);
        if (entry) {
          if ((entry.date as string) < from || (entry.date as string) >= before) continue;
          const cents = get<{ c: number }>(db, `select sum(${person}_cents) c from entries where id = ? or split_of = ?`, entry.id, entry.id)!.c;
          out.push({ name: t.name as string, date: entry.date as string, cents });
        } else if (t.active === 1 && (t.amount_cents as number) > 0 && (t.last_generated === null || (t.last_generated as string) < month)) {
          const date = dueDate(month, (t.due_day as number) ?? 1);
          if (date < from || date >= before) continue;
          out.push({ name: t.name as string, date, cents: computeShares(t.amount_cents as number, resolveSplit(JSON.parse(t.split_json as string) as TemplateSplit))[person] });
        }
      }
    }
    // Renewals count too, unless a fund pays for them.
    for (const t of all<Row>(db, "select * from recurring where cadence like 'every:%' and fund_id is null")) {
      for (const e of all<{ date: string; c: number }>(db, `select date, ${person}_cents c from entries where recurring_id = ? and from_fund = 0 and date >= ? and date < ?`, t.id as number, from, before)) {
        out.push({ name: t.name as string, date: e.date, cents: e.c });
      }
      if (t.active === 1 && (t.next_date as string) >= from && (t.next_date as string) < before) {
        out.push({ name: t.name as string, date: t.next_date as string, cents: computeShares(t.amount_cents as number, resolveSplit(JSON.parse(t.split_json as string) as TemplateSplit))[person] });
      }
    }
    return out.sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
  }

  /** The last group in Settings is the savings one, unless the groups were changed. */
  const savingsGroup = (): string | null => {
    const groups = getSettings().groups;
    return groups.length > 1 ? groups[groups.length - 1] : null;
  };

  function paycheckViews(profile: PayProfile, from: string, to: string, withBills: boolean): PaycheckView[] {
    const person = profile.person;
    const fit = fitPay(knownPaychecks(profile));
    // Look far enough ahead that the last paycheck shown knows when the next one lands.
    const checks = checksBetween(person, profile.schedule, from, addDays(to, 62));
    // Savings planned for a month are spread evenly over the paychecks that land in it.
    const group = withBills ? savingsGroup() : null;
    const perCheck = new Map<string, Cents>();
    const setAside = (month: string): Cents => {
      if (!group) return 0;
      if (!perCheck.has(month)) {
        const landing = checksBetween(person, profile.schedule, `${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, "0")}`).filter((c) => c.pay_date.startsWith(month)).length;
        perCheck.set(month, evenShare(plannedInGroup(person, month, group), landing));
      }
      return perCheck.get(month)!;
    };
    return checks.flatMap((c, i): PaycheckView[] => {
      if (!touches(c, from, to)) return [];
      const rate = rateAt(profile.rates, c.period_end);
      const hourly = rate.kind === "hourly";
      const hours = hoursIn(person, c.period_start, c.period_end);
      const gross = hourly ? grossPay(hours, rate.rate_cents ?? 0) : 0;
      // A pay period still under way is predicted at the usual hours until more than that are logged.
      const usual = profile.schedule.usualHours;
      const assumed = hourly && c.actual_gross_cents === null && c.period_end >= today() && usual > hours ? usual : null;
      const basis = c.actual_gross_cents ?? (assumed !== null ? grossPay(assumed, rate.rate_cents ?? 0) : gross);
      const next = checks[i + 1]?.pay_date ?? addDays(c.pay_date, 14);
      const bills = withBills ? billsDue(person, c.pay_date, next) : [];
      return [
        {
          ...c,
          kind: rate.kind,
          hours,
          gross_cents: gross,
          assumed_hours: assumed,
          predicted_net_cents: hourly ? (fit && basis > 0 ? predictPaycheck(basis, fit, c.no_benefits) : null) : rate.net_per_check_cents,
          uncertain: hourly && fit !== null && basis > 0 && isOutsideKnown(basis, fit),
          bills,
          bills_cents: bills.reduce((t, b) => t + b.cents, 0),
          set_aside_cents: setAside(monthOf(c.pay_date)),
          next_pay_date: next,
        },
      ];
    });
  }
  const takeHome = (v: PaycheckView) => v.actual_net_cents ?? v.predicted_net_cents ?? 0;

  function incomeCategory(schedule: PaySchedule): { id: number; name: string } | null {
    return (
      (schedule.incomeCategoryId !== null ? get<{ id: number; name: string }>(db, "select id, name from categories where id = ? and kind = 'income'", schedule.incomeCategoryId) : undefined) ??
      get<{ id: number; name: string }>(db, "select id, name from categories where kind = 'income' and archived = 0 order by sort, id limit 1") ??
      null
    );
  }

  function getPayMonth(args: { person: Person; month: string }): PayMonth {
    if (!isPerson(args.person) || !isMonth(args.month)) throw new UserError("That month is not valid");
    const first = `${args.month}-01`;
    const last = `${args.month}-${String(daysInMonth(args.month)).padStart(2, "0")}`;
    const gridStart = addDays(first, -((weekday(first) + 6) % 7));
    const gridEnd = addDays(last, (7 - weekday(last)) % 7);
    const year = args.month.slice(0, 4);
    const profile = getPayProfile({ person: args.person });
    const bankHolidays = [Number(year) - 1, Number(year), Number(year) + 1].flatMap(usBankHolidays).filter((h) => h.date >= gridStart && h.date <= gridEnd);
    const days = all<{ date: string; hours: number; tag: DayTag }>(db, "select date, hours, tag from work_days where person = ? and date >= ? and date <= ? order by date", args.person, gridStart, gridEnd);
    if (!profile) {
      return {
        person: args.person, profile, gridStart, gridEnd, days, bankHolidays, paychecks: [], fit: null, savingsGroup: savingsGroup(),
        income: { category_id: null, category_name: null, expected_cents: 0, planned_cents: 0, checks: 0 },
        year: { year, checks: [], hours: 0, gross_cents: 0, net_cents: 0, sickUsedHours: 0, hoursToGoal: null, checksLeft: 0 },
      };
    }
    const fit = fitPay(knownPaychecks(profile));
    // Hourly paychecks show whenever their pay period touches the calendar; fixed ones only in the month they land.
    const paychecks = paycheckViews(profile, gridStart, gridEnd, true).filter((v) => v.kind === "hourly" || v.pay_date.startsWith(args.month));
    const inYear = paycheckViews(profile, `${year}-01-01`, `${year}-12-31`, false).filter((v) => v.pay_date.startsWith(year));
    const landing = inYear.filter((v) => v.pay_date.startsWith(args.month));
    const category = incomeCategory(profile.schedule);
    const planned = category ? (getBudget({ month: args.month, view: args.person }).rows.find((r) => r.category_id === category.id)?.planned ?? 0) : 0;
    const gross = inYear.reduce((t, v) => t + (v.actual_gross_cents ?? v.gross_cents), 0);
    const goal = profile.schedule.grossGoalCents;
    return {
      person: args.person, profile, gridStart, gridEnd, days, bankHolidays, paychecks, savingsGroup: savingsGroup(),
      fit: fit ? { n: fit.n, error: fit.error, noBenefitsExtra: fit.noBenefitsExtra } : null,
      income: { category_id: category?.id ?? null, category_name: category?.name ?? null, expected_cents: landing.reduce((t, v) => t + takeHome(v), 0), planned_cents: planned, checks: landing.length },
      year: {
        year,
        checks: inYear.map((v) => ({ pay_date: v.pay_date, gross_cents: v.actual_gross_cents ?? v.gross_cents, net_cents: takeHome(v), actual: v.actual_net_cents !== null })),
        hours: inYear.reduce((t, v) => t + v.hours, 0),
        gross_cents: gross,
        net_cents: inYear.reduce((t, v) => t + takeHome(v), 0),
        sickUsedHours: get<{ h: number | null }>(db, "select sum(hours) h from work_days where person = ? and tag = 'sick' and date like ?", args.person, `${year}-%`)!.h ?? 0,
        hoursToGoal: profile.current.kind === "hourly" && goal !== null ? hoursToGoal(goal, gross, profile.current.rate_cents ?? 0) : null,
        checksLeft: inYear.filter((v) => v.pay_date >= today()).length,
      },
    };
  }

  /** Edits one paycheck. A paycheck is stored only while it differs from what the schedule gives. */
  function updatePaycheck(args: { person: Person; id: number | null; period_start: string; patch: PaycheckPatch }): void {
    mutate("Edit paycheck", () => {
      const profile = profileOf(args.person);
      const gone = new UserError("That paycheck no longer exists");
      let before: Check;
      if (args.id !== null) {
        const found = storedChecks(args.person).find((c) => c.id === args.id);
        if (!found) throw gone;
        before = found;
      } else {
        const period = scheduled(args.person, profile.schedule, args.period_start, args.period_start).find((p) => p.period_start === args.period_start);
        if (!period) throw gone;
        before = { id: null, ...period, actual_gross_cents: null, actual_net_cents: null, no_benefits: false };
      }
      const next: Check = { ...before, ...args.patch };
      for (const date of [next.period_start, next.period_end, next.pay_date]) if (!isISODate(date)) throw new UserError("Enter a valid date");
      if (next.period_end < next.period_start) throw new UserError("A pay period cannot end before it starts");
      for (const amount of [next.actual_gross_cents, next.actual_net_cents]) if (amount !== null && (!Number.isInteger(amount) || amount < 0)) throw new UserError("Enter the amount on the paycheck");
      if (next.actual_gross_cents !== null && next.actual_net_cents !== null && next.actual_net_cents > next.actual_gross_cents) throw new UserError("Take-home cannot be more than gross");
      if (get(db, "select id from paychecks where person = ? and id is not ? and period_start <= ? and period_end >= ?", args.person, before.id, next.period_end, next.period_start))
        throw new UserError("That pay period overlaps another paycheck");

      const asScheduled =
        next.actual_gross_cents === null && next.actual_net_cents === null && !next.no_benefits &&
        scheduled(args.person, profile.schedule, next.period_start, next.period_start).some((p) => p.period_start === next.period_start && p.period_end === next.period_end && p.pay_date === next.pay_date);
      if (before.id !== null) {
        record("paychecks", { id: before.id });
        if (asScheduled) run(db, "delete from paychecks where id = ?", before.id);
        else
          run(
            db,
            "update paychecks set period_start = ?, period_end = ?, pay_date = ?, actual_gross_cents = ?, actual_net_cents = ?, no_benefits = ? where id = ?",
            next.period_start, next.period_end, next.pay_date, next.actual_gross_cents, next.actual_net_cents, next.no_benefits ? 1 : 0, before.id,
          );
      } else if (!asScheduled) {
        const id = run(
          db,
          "insert into paychecks (person, period_start, period_end, pay_date, actual_gross_cents, actual_net_cents, no_benefits) values (?, ?, ?, ?, ?, ?, ?)",
          args.person, next.period_start, next.period_end, next.pay_date, next.actual_gross_cents, next.actual_net_cents, next.no_benefits ? 1 : 0,
        ).lastInsertRowid as number;
        record("paychecks", { id }, true);
      }
    });
  }

  /** What a paycheck would be for a number of hours at today's rate. */
  function payWhatIf(args: { person: Person; hours: number; no_benefits?: boolean }): { gross_cents: Cents; net_cents: Cents | null; uncertain: boolean; extra_hour_cents: Cents | null } {
    const profile = profileOf(args.person);
    if (profile.current.kind !== "hourly") throw new UserError("Hours only change pay for someone paid by the hour");
    if (!Number.isFinite(args.hours) || args.hours < 0 || args.hours > 400) throw new UserError("Enter a number of hours");
    const rate = profile.current.rate_cents ?? 0;
    const gross = grossPay(args.hours, rate);
    const fit = fitPay(knownPaychecks(profile));
    const net = (g: Cents) => predictPaycheck(g, fit!, args.no_benefits);
    return {
      gross_cents: gross,
      net_cents: fit ? net(gross) : null,
      uncertain: fit !== null && gross > 0 && isOutsideKnown(gross, fit),
      // What one more hour would add to take-home at this point.
      extra_hour_cents: fit ? net(gross + rate) - net(gross) : null,
    };
  }

  /** The next paycheck due on or after today, for the dashboard. */
  function nextPaycheck(args: { person: Person }): PaycheckView | null {
    const profile = getPayProfile(args);
    if (!profile) return null;
    return paycheckViews(profile, today(), addDays(today(), 62), true).find((v) => v.pay_date >= today()) ?? null;
  }

  /** Sets the month's planned paycheck income to what the paychecks landing in it are expected to bring home. */
  function planPayIncome(args: { person: Person; month: string }): Cents {
    const month = getPayMonth(args);
    if (!month.profile) throw new UserError("Set up pay first");
    if (month.income.category_id === null) throw new UserError("Add an income category first");
    setPlanned({ month: args.month, person: args.person, category_id: month.income.category_id, planned_cents: month.income.expected_cents });
    return month.income.expected_cents;
  }

  function importPay(person: Person, pay: PaySetup, categoryIds: Map<string, number>) {
    if (!Array.isArray(pay.rates) || pay.rates.length === 0) throw new UserError("The setup file's pay needs at least one rate");
    const before = getPayProfile({ person })?.schedule ?? DEFAULT_SCHEDULE;
    for (const r of pay.rates) writeRate(person, { effective_date: r.effective_date, kind: r.kind ?? "hourly", rate_cents: r.rate_cents ?? null, net_per_check_cents: r.net_per_check_cents ?? null });
    let incomeCategoryId = before.incomeCategoryId;
    if (pay.incomeCategory !== undefined) {
      const id = categoryIds.get(pay.incomeCategory.toLowerCase());
      if (id === undefined) throw new UserError(`The setup file pays into "${pay.incomeCategory}", which is not a category`);
      incomeCategoryId = id;
    }
    const schedule: PaySchedule = {
      rule: pay.rule ?? before.rule,
      anchor: pay.anchor ?? before.anchor,
      lagDays: pay.lagDays ?? before.lagDays,
      monthDays: pay.monthDays ?? before.monthDays,
      sickHoursPerYear: pay.sickHoursPerYear ?? before.sickHoursPerYear,
      usualHours: pay.usualHours ?? before.usualHours,
      grossGoalCents: pay.grossGoalCents === undefined ? before.grossGoalCents : pay.grossGoalCents,
      incomeCategoryId,
      history: pay.history ?? before.history,
    };
    checkSchedule(schedule);
    writeSchedule(person, schedule);
  }

  // ---- the year, and export ----------------------------------------------

  const isYear = (y: string) => /^\d{4}$/.test(y);
  const shareOf = (view: View) => (view === "hh" ? "a_cents + b_cents" : `${view}_cents`);

  /** Every category's twelve months for one view, in the budget's order. Purchases paid from a fund are left out, as in the budget. */
  function yearRows(year: string, view: View): { rows: YearRow[]; monthsWithData: number } {
    const sums = all<{ category_id: number | null; kind: "expense" | "income"; m: string; t: number }>(
      db,
      `select category_id, kind, substr(date, 6, 2) m, sum(${shareOf(view)}) t from entries
       where date like ? and kind in ('expense', 'income') and from_fund = 0 group by category_id, kind, m`,
      `${year}-%`,
    );
    const categories = new Map(listCategories({ includeArchived: true }).map((c) => [c.id, c]));
    const rows = new Map<string, YearRow>();
    for (const s of sums) {
      const c = s.category_id === null ? undefined : categories.get(s.category_id);
      const key = c ? String(c.id) : `none:${s.kind}`;
      if (!rows.has(key)) {
        rows.set(key, { category_id: c?.id ?? 0, name: c?.name ?? "Uncategorized", grp: c?.grp ?? (s.kind === "income" ? "Income" : "Uncategorized"), kind: s.kind, monthly: Array.from({ length: 12 }, () => 0) });
      }
      rows.get(key)!.monthly[Number(s.m) - 1] += s.t;
    }
    const order = (r: YearRow) => categories.get(r.category_id)?.sort ?? Number.MAX_SAFE_INTEGER;
    return {
      rows: [...rows.values()].filter((r) => r.monthly.some((c) => c !== 0)).sort((x, y) => order(x) - order(y)),
      monthsWithData: get<{ n: number }>(db, "select count(distinct substr(date, 1, 7)) n from entries where date like ?", `${year}-%`)!.n,
    };
  }

  function getYear(args: { year: string; view: View }): YearView {
    if (!isYear(args.year) || !["a", "b", "hh"].includes(args.view)) throw new UserError("That year is not valid");
    const persons: Person[] = args.view === "hh" ? ["a", "b"] : [args.view];
    const pay = persons.flatMap((person) => {
      const profile = getPayProfile({ person });
      if (!profile) return [];
      const month = { hours: Array.from({ length: 12 }, () => 0), gross_cents: Array.from({ length: 12 }, () => 0), net_cents: Array.from({ length: 12 }, () => 0) };
      for (const v of paycheckViews(profile, `${args.year}-01-01`, `${args.year}-12-31`, false)) {
        if (!v.pay_date.startsWith(args.year)) continue;
        const i = Number(v.pay_date.slice(5, 7)) - 1;
        month.hours[i] += v.hours;
        month.gross_cents[i] += v.actual_gross_cents ?? v.gross_cents;
        month.net_cents[i] += takeHome(v);
      }
      return [{ person, ...month }];
    });
    const merchants = all<{ name: string; count: number; cents: number }>(
      db,
      `select max(description) name, count(*) count, sum(${shareOf(args.view)}) cents from entries
       where date like ? and kind = 'expense' group by lower(trim(description)) having cents <> 0 order by cents desc, name limit 25`,
      `${args.year}-%`,
    );
    return { year: args.year, ...yearRows(args.year, args.view), pay, merchants };
  }

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /** A month or a year as plain tables, ready to be written as a spreadsheet. */
  function exportTables(args: ExportRequest): { title: string; sheets: ExportSheet[] } {
    if (!isMonth(args.month) || (args.scope !== "month" && args.scope !== "year")) throw new UserError("That export is not valid");
    const { people, groups } = getSettings();
    const year = args.month.slice(0, 4);
    const categories = new Map(listCategories({ includeArchived: true }).map((c) => [c.id, c]));
    const fundNames = new Map(all<{ id: number; name: string }>(db, "select id, name from funds").map((f) => [f.id, f.name]));
    const money = (cents: Cents): ExportCell => ({ money: cents });
    const entries = all<Row>(db, `${ENTRY_SELECT} where e.date like ? order by e.date, e.id`, args.scope === "month" ? `${args.month}-%` : `${year}-%`).map(toEntry);
    const transactions: ExportCell[][] = [
      ["Date", "Description", "Category", "Group", "Kind", "Amount", "Paid by", `${people.a} share`, `${people.b} share`, "Paid from", "Account", "Note"],
      ...entries.map((e): ExportCell[] => [
        { date: e.date },
        e.description,
        e.kind === "settlement" ? "" : (e.category_name ?? "Uncategorized"),
        e.category_id === null ? "" : (categories.get(e.category_id)?.grp ?? ""),
        e.kind === "expense" ? "Expense" : e.kind === "income" ? "Income" : "Settlement",
        money(e.amount_cents),
        people[e.paid_by],
        money(e.a_cents),
        money(e.b_cents),
        e.from_fund ? (fundNames.get(e.fund_id ?? 0) ?? "A fund") : "",
        e.account ?? "",
        e.note ?? "",
      ]),
    ];
    if (args.scope === "month") {
      const a = getBudget({ month: args.month, view: "a" }).rows;
      const b = new Map(getBudget({ month: args.month, view: "b" }).rows.map((r) => [`${r.category_id}:${r.kind}`, r]));
      const budget: ExportCell[][] = [
        ["Group", "Category", `${people.a} planned`, `${people.a} actual`, `${people.b} planned`, `${people.b} actual`, "Household planned", "Household actual"],
        ...a.map((r): ExportCell[] => {
          const other = b.get(`${r.category_id}:${r.kind}`);
          return [r.grp, r.name, money(r.planned), money(r.actual), money(other?.planned ?? 0), money(other?.actual ?? 0), money(r.planned + (other?.planned ?? 0)), money(r.actual + (other?.actual ?? 0))];
        }),
      ];
      return { title: `Household finance ${monthLabel(args.month)}`, sheets: [{ name: "Transactions", rows: transactions }, { name: "Budget", rows: budget }] };
    }
    const yearSheet = (view: View, name: string): ExportSheet => {
      const { rows, monthsWithData } = yearRows(year, view);
      const s = summarizeYear(rows, groups, monthsWithData);
      const cells = (group: string, label: string, l: YearLine): ExportCell[] => [group, label, ...l.monthly.map(money), money(l.total), money(l.average)];
      return {
        name,
        rows: [
          ["Group", "Category", ...MONTH_NAMES, "Total", "Average"],
          ...s.groups.flatMap((g) => [...g.rows.map((r) => cells(g.grp, r.name, r)), cells(g.grp, "Total", g)]),
          cells("Spending", "Total", s.expenses),
          ...s.income.rows.map((r) => cells("Income", r.name, r)),
          cells("Income", "Total", s.income),
          cells("Net", "Income minus spending", s.net),
        ],
      };
    };
    return {
      title: `Household finance ${year}`,
      sheets: [{ name: "Transactions", rows: transactions }, yearSheet("hh", "Year Household"), yearSheet("a", `Year ${people.a}`), yearSheet("b", `Year ${people.b}`)],
    };
  }

  // ---- statement ----------------------------------------------------------

  /** One person's month: shared bills and purchases, settlements, the balance, and their budget. */
  function statementData(args: { month: string; person: Person }): StatementData {
    if (!isMonth(args.month) || !isPerson(args.person)) throw new UserError("That statement is not valid");
    const settings = getSettings();
    const rows = all<BalanceEntry & { date: string; description: string; recurring_id: number | null }>(
      db,
      "select date, description, kind, paid_by, amount_cents, a_cents, b_cents, recurring_id from entries where kind in ('expense', 'settlement') and from_fund = 0 order by date, id",
    );
    const start = `${args.month}-01`;
    const inMonth = rows.filter((r) => r.date.startsWith(args.month));
    const shared = inMonth.filter((r) => r.kind === "expense" && balanceDelta(r) !== 0);
    const line = (r: (typeof rows)[number]): StatementLine => ({
      date: r.date,
      description: r.description,
      total: r.amount_cents,
      share: args.person === "a" ? r.a_cents : r.b_cents,
      paid_by: r.paid_by,
    });
    const budget = summarize(getBudget({ month: args.month, view: args.person }).rows, settings.groups);
    return {
      month: args.month,
      person: args.person,
      names: settings.people,
      openingBalance: balance(rows.filter((r) => r.date < start), settings.openingBalanceCents),
      closingBalance: balance(rows.filter((r) => r.date.slice(0, 7) <= args.month), settings.openingBalanceCents),
      bills: shared.filter((r) => r.recurring_id !== null).map(line),
      purchases: shared.filter((r) => r.recurring_id === null).map(line),
      settlements: inMonth.filter((r) => r.kind === "settlement").map((r) => ({ date: r.date, from: r.paid_by, amount: r.amount_cents })),
      budget: {
        groups: budget.groups
          .map((g) => ({
            grp: g.grp,
            planned: g.planned,
            actual: g.actual,
            rows: g.rows.filter((r) => r.planned !== 0 || r.actual !== 0).map((r) => ({ name: r.name, planned: r.planned, actual: r.actual })),
          }))
          .filter((g) => g.rows.length > 0),
        income: { planned: budget.income.planned, actual: budget.income.actual },
        expenses: budget.expenses,
      },
    };
  }

  // ---- setup file ---------------------------------------------------------

  /** Loads a setup file: names, split, groups, categories, a first month's plan and how each person is paid. */
  function importSetup(file: SetupFile): { categories: number; budgetLines: number } {
    return mutate("Import setup file", () => {
      const settings = getSettings();
      const next: Settings = { ...settings };
      if (file.people) next.people = { a: String(file.people.a), b: String(file.people.b) };
      if (file.defaultSplitA !== undefined) next.defaultSplit = { type: "percent", a: file.defaultSplitA };
      if (file.presets) next.presets = file.presets.map((p) => ({ label: p.label, spec: { type: "percent", a: p.a } as SplitSpec }));
      if (file.groups) next.groups = file.groups;
      if (file.targets) next.targets = file.targets;
      if (file.openingBalanceCents !== undefined) next.openingBalanceCents = file.openingBalanceCents;
      if (!isValidSplit(next.defaultSplit) || next.presets.some((p) => !isValidSplit(p.spec))) throw new UserError("The setup file has a split that is not valid");
      saveSettings(next);

      if (file.replaceCategories) {
        const used = ["entries", "recurring", "funds"].reduce((t, table) => t + get<{ n: number }>(db, `select count(*) n from ${table}`)!.n, 0);
        if (used > 0) throw new UserError("Categories can only be replaced before any entries, bills or funds exist");
        for (const line of all<Row>(db, "select month, person, category_id from budget_lines")) record("budget_lines", line);
        run(db, "delete from budget_lines");
        for (const c of all<Row>(db, "select id from categories")) record("categories", { id: c.id });
        run(db, "delete from categories");
      }
      let created = 0;
      const idByName = new Map(listCategories({ includeArchived: true }).map((c) => [c.name.toLowerCase(), c.id]));
      let sort = (get<{ m: number | null }>(db, "select max(sort) m from categories")!.m ?? -1) + 1;
      for (const c of file.categories ?? []) {
        const name = String(c.name).trim();
        if (!name || idByName.has(name.toLowerCase())) continue;
        const kind = c.kind ?? "expense";
        const id = run(
          db,
          "insert into categories (name, grp, kind, sort, icon) values (?, ?, ?, ?, ?)",
          name, kind === "income" ? "Income" : String(c.group), kind, sort++, c.icon ?? null,
        ).lastInsertRowid as number;
        record("categories", { id }, true);
        idByName.set(name.toLowerCase(), id);
        created++;
      }
      let lines = 0;
      if (file.budget) {
        if (!isMonth(file.budget.month)) throw new UserError("The setup file's budget month is not valid");
        for (const person of ["a", "b"] as const) {
          for (const [name, cents] of Object.entries(file.budget[person] ?? {})) {
            const id = idByName.get(name.toLowerCase());
            if (id === undefined) throw new UserError(`The setup file plans for "${name}", which is not a category`);
            if (!Number.isInteger(cents) || cents < 0) throw new UserError(`The planned amount for "${name}" is not valid`);
            record("budget_lines", { month: file.budget.month, person, category_id: id });
            run(
              db,
              `insert into budget_lines (month, person, category_id, planned_cents) values (?, ?, ?, ?)
               on conflict (month, person, category_id) do update set planned_cents = excluded.planned_cents`,
              file.budget.month, person, id, cents,
            );
            lines++;
          }
        }
      }
      for (const person of ["a", "b"] as const) if (file.pay?.[person]) importPay(person, file.pay[person]!, idByName);
      return { categories: created, budgetLines: lines };
    });
  }

  seedDefaultCategories();

  return {
    "settings.get": getSettings,
    "settings.update": updateSettings,
    "categories.list": listCategories,
    "categories.create": createCategory,
    "categories.update": updateCategory,
    "categories.reorder": reorderCategories,
    "categories.remove": removeCategory,
    "groups.rename": renameGroup,
    "entries.list": listEntries,
    "entries.create": createEntry,
    "entries.update": updateEntry,
    "entries.bulkUpdate": bulkUpdateEntries,
    "entries.remove": removeEntries,
    "entries.split": splitEntry,
    "entries.setSeen": setSeen,
    "bills.list": listBills,
    "bills.create": createBill,
    "bills.update": updateBill,
    "bills.setMonthAmount": setBillMonthAmount,
    "bills.generate": generateBills,
    "bills.remove": removeBill,
    "statement.data": statementData,
    "year.get": getYear,
    "export.tables": exportTables,
    "funds.list": listFunds,
    "funds.create": createFund,
    "funds.update": updateFund,
    "funds.setBalance": setFundBalance,
    "funds.remove": removeFund,
    "renewals.list": listRenewals,
    "renewals.create": createRenewal,
    "renewals.update": updateRenewal,
    "renewals.remove": removeRenewal,
    "pay.profile": getPayProfile,
    "pay.saveProfile": savePayProfile,
    "pay.removeRate": removePayRate,
    "pay.setHistory": setPayHistory,
    "pay.setDay": setWorkDay,
    "pay.month": getPayMonth,
    "pay.updatePaycheck": updatePaycheck,
    "pay.whatIf": payWhatIf,
    "pay.next": nextPaycheck,
    "pay.planIncome": planPayIncome,
    "budget.get": getBudget,
    "budget.setPlanned": setPlanned,
    "budget.setStartBalance": setStartBalance,
    "balance.get": getBalance,
    "setup.import": importSetup,
    "undo.peek": () => undoStack.at(-1)?.label ?? null,
    "undo.run": undo,
    "meta.rev": () => Number(get<{ value: string }>(db, "select value from settings where key = 'rev'")?.value ?? 0),
  };
}

export type CoreApi = ReturnType<typeof createApi>;
