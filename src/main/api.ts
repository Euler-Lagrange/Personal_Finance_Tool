import { all, get, run, tx, type Db, type Row } from "./db";
import { balance, balanceDelta, type BalanceEntry, type EntryKind } from "../core/balance";
import { summarize, type BudgetRow } from "../core/budget";
import { daysInMonth, isISODate, isMonth, monthOf } from "../core/dates";
import type { StatementData, StatementLine } from "../core/statement";
import type { Cents } from "../core/money";
import { computeShares, isValidSplit, MINE, THEIRS, type Person, type SplitSpec } from "../core/split";
import type { BillInput, BillRow, Category, Entry, EntryInput, EntryPatch, Settings, SetupFile, TemplateSplit, View } from "../shared/types";

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
    return { ...input, description, category_id, split, shares, account: input.account?.trim() || null, note: input.note?.trim() || null };
  }

  function insertEntry(input: EntryInput, extra: { split_of?: number; recurring_id?: number } = {}): number {
    const e = prepare(input);
    const stamp = now();
    const id = run(
      db,
      `insert into entries (date, description, amount_cents, kind, category_id, paid_by, account, split_json, a_cents, b_cents, split_of, recurring_id, note, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.date, e.description, e.amount_cents, e.kind, e.category_id, e.paid_by, e.account, JSON.stringify(e.split), e.shares.a, e.shares.b, extra.split_of ?? null, extra.recurring_id ?? null, e.note, stamp, stamp,
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
    });
    record("entries", { id });
    run(
      db,
      `update entries set date = ?, description = ?, amount_cents = ?, kind = ?, category_id = ?, paid_by = ?, account = ?, split_json = ?, a_cents = ?, b_cents = ?, note = ?, updated_at = ? where id = ?`,
      e.date, e.description, e.amount_cents, e.kind, e.category_id, e.paid_by, e.account, JSON.stringify(e.split), e.shares.a, e.shares.b, e.note, now(), id,
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
      "select date, kind, paid_by, amount_cents, a_cents, b_cents from entries where kind in ('expense', 'settlement')",
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
  function removeBill(args: { id: number }): void {
    mutate("Delete bill", () => {
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

  // ---- statement ----------------------------------------------------------

  /** One person's month: shared bills and purchases, settlements, the balance, and their budget. */
  function statementData(args: { month: string; person: Person }): StatementData {
    if (!isMonth(args.month) || !isPerson(args.person)) throw new UserError("That statement is not valid");
    const settings = getSettings();
    const rows = all<BalanceEntry & { date: string; description: string; recurring_id: number | null }>(
      db,
      "select date, description, kind, paid_by, amount_cents, a_cents, b_cents, recurring_id from entries where kind in ('expense', 'settlement') order by date, id",
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

  /** Loads a setup file: names, split, groups, categories and a first month's plan. */
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
        const used = get<{ n: number }>(db, "select count(*) n from entries")!.n + get<{ n: number }>(db, "select count(*) n from recurring")!.n;
        if (used > 0) throw new UserError("Categories can only be replaced before any entries or bills exist");
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
