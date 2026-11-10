import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db";
import { createApi, type CoreApi } from "./api";
import { summarizeYear } from "../core/year";
import type { EntryInput } from "../shared/types";

let api: CoreApi;
let cat: Map<string, number>;

const add = (date: string, description: string, amount_cents: number, category: string, over: Partial<EntryInput> = {}) =>
  api["entries.create"]({ date, description, amount_cents, kind: "expense", category_id: cat.get(category)!, paid_by: "a", split: { type: "percent", a: 70 }, ...over });

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  migrate(db);
  api = createApi(db, { now: () => new Date("2026-12-05T12:00:00Z") });
  api["settings.update"]({ people: { a: "Alex", b: "Sam" } });
  cat = new Map(api["categories.list"]().map((c) => [c.name, c.id]));
  add("2026-10-03", "Corner Market", 10000, "Groceries");
  add("2026-11-03", "corner market ", 20000, "Groceries");
  add("2026-11-20", "City Power", 9000, "Utilities");
  add("2026-12-01", "Paycheck", 300000, "Paycheck", { kind: "income", split: undefined });
  add("2026-12-02", "Corner Market", 5000, "Groceries", { paid_by: "b" });
  add("2025-12-30", "Last year", 99900, "Groceries");
});

describe("the year view", () => {
  it("lays each category out by month for the person on screen", () => {
    const y = api["year.get"]({ year: "2026", view: "a" });
    expect(y.monthsWithData).toBe(3);
    const groceries = y.rows.find((r) => r.name === "Groceries")!;
    expect(groceries.monthly.slice(9)).toEqual([7000, 14000, 3500]);
    expect(groceries.monthly.slice(0, 9).every((c) => c === 0)).toBe(true);
    expect(y.rows.find((r) => r.name === "Paycheck")!.monthly[11]).toBe(300000);
    expect(y.rows.map((r) => r.name)).toEqual(["Utilities", "Groceries", "Paycheck"]);
    const s = summarizeYear(y.rows, ["Needs", "Wants", "Savings"], y.monthsWithData);
    expect(s.groups[0]).toMatchObject({ grp: "Needs", total: 7000 + 14000 + 3500 + 6300, average: 10267 });
    expect(api["year.get"]({ year: "2026", view: "hh" }).rows.find((r) => r.name === "Groceries")!.monthly.slice(9)).toEqual([10000, 20000, 5000]);
    expect(api["year.get"]({ year: "2024", view: "a" })).toMatchObject({ rows: [], monthsWithData: 0, merchants: [] });
  });

  it("leaves out purchases paid from a fund, as the budget does, and keeps uncategorized ones", () => {
    const fund = api["funds.create"]({ name: "Repairs", owner: "hh", target_cents: null, category_id: null, emergency: false, balance_cents: 50000 });
    add("2026-12-03", "Plumber", 30000, "Housing", { paid_from_fund: fund });
    add("2026-12-04", "Mystery", 1000, "Groceries", { category_id: null });
    const y = api["year.get"]({ year: "2026", view: "hh" });
    expect(y.rows.some((r) => r.name === "Housing")).toBe(false);
    expect(y.rows.at(-1)).toMatchObject({ name: "Uncategorized", grp: "Uncategorized", category_id: 0 });
    // Where the money went still counts everything bought there.
    expect(y.merchants.find((m) => m.name === "Plumber")).toEqual({ name: "Plumber", count: 1, cents: 30000 });
  });

  it("totals spending by merchant, ignoring capitals and stray spaces", () => {
    const y = api["year.get"]({ year: "2026", view: "hh" });
    expect(y.merchants.map((m) => [m.name.trim().toLowerCase(), m.count, m.cents])).toEqual([["corner market", 3, 35000], ["city power", 1, 9000]]);
    expect(api["year.get"]({ year: "2026", view: "b" }).merchants[0].cents).toBe(3000 + 6000 + 1500);
  });

  it("shows hours and pay by the month of the payday once pay is set up", () => {
    expect(api["year.get"]({ year: "2026", view: "hh" }).pay).toEqual([]);
    api["setup.import"]({ pay: { a: { rates: [{ effective_date: "2026-01-01", rate_cents: 5000 }], anchor: "2026-10-19" } } });
    api["pay.setDay"]({ person: "a", date: "2026-11-17", hours: 10, tag: "worked" });
    api["pay.updatePaycheck"]({ person: "a", id: null, period_start: "2026-11-16", patch: { actual_net_cents: 33000 } });
    const [pay] = api["year.get"]({ year: "2026", view: "a" }).pay;
    expect(pay.person).toBe("a");
    expect([pay.hours[11], pay.gross_cents[11], pay.net_cents[11]]).toEqual([10, 50000, 33000]);
    expect(api["year.get"]({ year: "2026", view: "b" }).pay).toEqual([]);
  });
});

describe("export tables", () => {
  it("give a month as its transactions and both budgets", () => {
    api["budget.setPlanned"]({ month: "2026-11", person: "a", category_id: cat.get("Groceries")!, planned_cents: 40000 });
    api["budget.setPlanned"]({ month: "2026-11", person: "b", category_id: cat.get("Groceries")!, planned_cents: 15000 });
    const t = api["export.tables"]({ scope: "month", month: "2026-11" });
    expect(t.title).toBe("Household finance November 2026");
    expect(t.sheets.map((s) => s.name)).toEqual(["Transactions", "Budget"]);
    expect(t.sheets[0].rows[0]).toEqual(["Date", "Description", "Category", "Group", "Kind", "Amount", "Paid by", "Alex share", "Sam share", "Paid from", "Account", "Note"]);
    expect(t.sheets[0].rows.slice(1)).toEqual([
      [{ date: "2026-11-03" }, "corner market", "Groceries", "Needs", "Expense", { money: 20000 }, "Alex", { money: 14000 }, { money: 6000 }, "", "", ""],
      [{ date: "2026-11-20" }, "City Power", "Utilities", "Needs", "Expense", { money: 9000 }, "Alex", { money: 6300 }, { money: 2700 }, "", "", ""],
    ]);
    expect(t.sheets[1].rows.find((r) => r[1] === "Groceries")).toEqual(["Needs", "Groceries", { money: 40000 }, { money: 14000 }, { money: 15000 }, { money: 6000 }, { money: 55000 }, { money: 20000 }]);
  });

  it("give a year as its transactions and a table per view that adds up", () => {
    api["entries.create"]({ date: "2026-11-25", description: "Settle up", amount_cents: 5000, kind: "settlement", category_id: null, paid_by: "b" });
    const t = api["export.tables"]({ scope: "year", month: "2026-11" });
    expect(t.sheets.map((s) => s.name)).toEqual(["Transactions", "Year Household", "Year Alex", "Year Sam"]);
    expect(t.sheets[0].rows).toHaveLength(1 + 6);
    expect(t.sheets[0].rows.find((r) => r[1] === "Settle up")!.slice(2, 7)).toEqual(["", "", "Settlement", { money: 5000 }, "Sam"]);
    const household = t.sheets[1].rows;
    expect(household[0]).toHaveLength(2 + 12 + 2);
    const row = (label: string, group?: string) => household.find((r) => r[1] === label && (group === undefined || r[0] === group))!;
    expect(row("Groceries").slice(11, 16)).toEqual([{ money: 10000 }, { money: 20000 }, { money: 5000 }, { money: 35000 }, { money: 11667 }]);
    expect(row("Total", "Spending")[14]).toEqual({ money: 44000 });
    expect(row("Income minus spending")[14]).toEqual({ money: 300000 - 44000 });
    const alex = t.sheets[2].rows.find((r) => r[1] === "Groceries")!;
    const sam = t.sheets[3].rows.find((r) => r[1] === "Groceries")!;
    expect((alex[14] as { money: number }).money + (sam[14] as { money: number }).money).toBe(35000);
    expect(() => api["export.tables"]({ scope: "month", month: "2026" })).toThrow("not valid");
  });
});
