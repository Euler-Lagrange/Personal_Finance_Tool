import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db";
import { createApi, type CoreApi } from "./api";
import { owesSentence, statementHtml } from "../core/statement";
import type { BillInput } from "../shared/types";

let api: CoreApi;
let utilities: number;
let insurance: number;
let groceries: number;

const bill = (over: Partial<BillInput & { month: string }> = {}): BillInput & { month: string } => ({
  name: "City Power",
  category_id: utilities,
  due_day: 16,
  amount_cents: 14300,
  paid_by: "a",
  split: { type: "default" },
  month: "2026-12",
  ...over,
});
const dec = (today = "2026-12-03") => api["bills.list"]({ month: "2026-12", today });
const jan = (today = "2027-01-02") => api["bills.list"]({ month: "2027-01", today });

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  migrate(db);
  api = createApi(db, { now: () => new Date("2026-12-03T12:00:00Z") });
  api["settings.update"]({ people: { a: "Alex", b: "Sam" }, defaultSplit: { type: "percent", a: 70 } });
  const cats = api["categories.list"]();
  utilities = cats.find((c) => c.name === "Utilities")!.id;
  insurance = cats.find((c) => c.name === "Insurance")!.id;
  groceries = cats.find((c) => c.name === "Groceries")!.id;
});

describe("bills", () => {
  it("creates this month's entry on its due day with the household split", () => {
    api["bills.create"](bill());
    const [row] = dec().rows;
    expect(row.entry).toMatchObject({ date: "2026-12-16", amount_cents: 14300, a_cents: 10010, b_cents: 4290, seen_in_bank: false });
    const [entry] = api["entries.list"]({ month: "2026-12" });
    expect(entry).toMatchObject({ description: "City Power", category_id: utilities, paid_by: "a" });
    expect(api["balance.get"]().cents).toBe(4290);
  });

  it("supports fixed-dollar, custom-percent and one-person bills", () => {
    api["bills.create"](bill({ name: "Car insurance", category_id: insurance, amount_cents: 22326, split: { type: "fixed", a_cents: 11042 } }));
    api["bills.create"](bill({ name: "Gym", amount_cents: 13037, split: { type: "percent", a: 50 } }));
    api["bills.create"](bill({ name: "Store card", amount_cents: 11622, split: { type: "percent", a: 0 } }));
    const shares = Object.fromEntries(dec().rows.map((r) => [r.name, [r.entry!.a_cents, r.entry!.b_cents]]));
    expect(shares).toEqual({ "Car insurance": [11042, 11284], Gym: [6519, 6518], "Store card": [0, 11622] });
    expect(() => api["bills.create"](bill({ amount_cents: 5000, split: { type: "fixed", a_cents: 6000 } }))).toThrow("cannot be larger");
    expect(() => api["bills.create"](bill({ due_day: 0 }))).toThrow("due day");
  });

  it("rolls into a new month once, clamps the due day, and does not recreate a deleted bill", () => {
    api["bills.create"](bill({ due_day: 31, month: "2027-01" }));
    const feb = (today: string) => api["bills.list"]({ month: "2027-02", today });
    expect(feb("2027-01-20").rows[0].entry).toBeNull();
    const made = feb("2027-02-01").rows[0].entry!;
    expect(made.date).toBe("2027-02-28");
    feb("2027-02-02");
    expect(api["entries.list"]({ month: "2027-02" })).toHaveLength(1);
    api["entries.remove"]({ ids: [made.id] });
    expect(feb("2027-02-03").rows[0].entry).toBeNull();
    expect(feb("2027-02-03").missing).toBe(1);
    expect(api["bills.generate"]({ month: "2027-02" })).toBe(1);
    expect(feb("2027-02-04").missing).toBe(0);
  });

  it("waits for an amount when the usual amount is zero, and treats zero as no bill", () => {
    const id = api["bills.create"](bill({ name: "Water", amount_cents: 0 }));
    expect(dec().rows[0].entry).toBeNull();
    expect(dec().missing).toBe(0);
    api["bills.setMonthAmount"]({ id, month: "2026-12", amount_cents: 6626 });
    expect(dec().rows[0].entry).toMatchObject({ amount_cents: 6626, a_cents: 4638, b_cents: 1988 });
    api["bills.setMonthAmount"]({ id, month: "2026-12", amount_cents: 7000 });
    expect(dec().rows[0].entry!.amount_cents).toBe(7000);
    api["bills.setMonthAmount"]({ id, month: "2026-12", amount_cents: 0 });
    expect(api["entries.list"]({ month: "2026-12" })).toHaveLength(0);
  });

  it("shows last month's amount so a changed bill stands out", () => {
    const id = api["bills.create"](bill());
    expect(dec().rows[0].previous_cents).toBeNull();
    const row = jan().rows[0];
    expect(row.previous_cents).toBe(14300);
    api["bills.setMonthAmount"]({ id, month: "2027-01", amount_cents: 16150 });
    expect(jan().rows[0]).toMatchObject({ previous_cents: 14300, expected_cents: 14300 });
    expect(jan().rows[0].entry!.amount_cents).toBe(16150);
  });

  it("carries a template change into the month being viewed, but not the amount", () => {
    const id = api["bills.create"](bill());
    api["bills.update"]({ id, month: "2026-12", patch: { name: "Electric", due_day: 20, paid_by: "b", split: { type: "percent", a: 50 }, amount_cents: 15000 } });
    const [entry] = api["entries.list"]({ month: "2026-12" });
    expect(entry).toMatchObject({ description: "Electric", date: "2026-12-20", paid_by: "b", amount_cents: 14300, a_cents: 7150, b_cents: 7150 });
    expect(dec().rows[0].expected_cents).toBe(15000);
  });

  it("stops creating a bill that is switched off and keeps history when one is deleted", () => {
    const id = api["bills.create"](bill());
    api["bills.update"]({ id, patch: { active: false } });
    expect(jan().rows[0]).toMatchObject({ active: false, entry: null });
    api["bills.update"]({ id, patch: { active: true } });
    expect(jan("2027-01-05").rows[0].entry).not.toBeNull();
    api["bills.remove"]({ id });
    expect(jan().rows).toHaveLength(0);
    expect(api["entries.list"]({ month: "2026-12" })[0]).toMatchObject({ description: "City Power", recurring_id: null });
    api["undo.run"]();
    expect(jan().rows).toHaveLength(1);
    expect(api["entries.list"]({ month: "2026-12" })[0].recurring_id).toBe(id);
  });

  it("marks a bill as paid and undoes adding a bill completely", () => {
    api["bills.create"](bill());
    const entryId = dec().rows[0].entry!.id;
    api["entries.setSeen"]({ id: entryId, seen: true });
    expect(dec().rows[0].entry!.seen_in_bank).toBe(true);
    api["undo.run"]();
    expect(dec().rows[0].entry!.seen_in_bank).toBe(false);
    api["undo.run"]();
    expect(dec().rows).toHaveLength(0);
    expect(api["entries.list"]({ month: "2026-12" })).toHaveLength(0);
  });

  it("keeps a bill's total when it is split across categories", () => {
    const id = api["bills.create"](bill({ amount_cents: 20000 }));
    const entryId = dec().rows[0].entry!.id;
    api["entries.split"]({ id: entryId, parts: [{ amount_cents: 5000, category_id: groceries }] });
    expect(dec().rows[0].entry).toMatchObject({ amount_cents: 20000, a_cents: 14000, b_cents: 6000 });
    api["bills.setMonthAmount"]({ id, month: "2026-12", amount_cents: 21000 });
    expect(dec().rows[0].entry!.amount_cents).toBe(21000);
    expect(() => api["bills.setMonthAmount"]({ id, month: "2026-12", amount_cents: 4000 })).toThrow("split across categories");
    expect(jan().rows[0].previous_cents).toBe(21000);
  });
});

describe("setup file and bills", () => {
  it("will not replace categories once a bill uses them", () => {
    api["bills.create"](bill({ amount_cents: 0 }));
    expect(() => api["setup.import"]({ replaceCategories: true, categories: [{ name: "Rent", group: "Needs" }] })).toThrow("before any entries, bills or funds exist");
    expect(api["categories.list"]().some((c) => c.id === utilities)).toBe(true);
  });
});

describe("statement", () => {
  it("gives one person's month: bills, purchases, settlements, balance and budget", () => {
    api["settings.update"]({ openingBalanceCents: 2500 });
    api["entries.create"]({ date: "2026-11-20", description: "Before the month", amount_cents: 10000, kind: "expense", category_id: groceries, paid_by: "a" });
    api["bills.create"](bill());
    api["entries.create"]({ date: "2026-12-05", description: "Corner <Market>", amount_cents: 8000, kind: "expense", category_id: groceries, paid_by: "b" });
    api["entries.create"]({ date: "2026-12-06", description: "Just for Alex", amount_cents: 3000, kind: "expense", category_id: groceries, paid_by: "a", split: { type: "percent", a: 100 } });
    api["entries.create"]({ date: "2026-12-10", description: "Settle up", amount_cents: 2000, kind: "settlement", category_id: null, paid_by: "b" });
    api["budget.setPlanned"]({ month: "2026-12", person: "b", category_id: groceries, planned_cents: 30000 });

    const s = api["statement.data"]({ month: "2026-12", person: "b" });
    expect(s.openingBalance).toBe(2500 + 3000);
    expect(s.closingBalance).toBe(5500 + 4290 - 5600 - 2000);
    expect(s.closingBalance).toBe(api["balance.get"]().cents);
    expect(s.bills).toEqual([{ date: "2026-12-16", description: "City Power", total: 14300, share: 4290, paid_by: "a" }]);
    expect(s.purchases).toEqual([{ date: "2026-12-05", description: "Corner <Market>", total: 8000, share: 2400, paid_by: "b" }]);
    expect(s.settlements).toEqual([{ date: "2026-12-10", from: "b", amount: 2000 }]);
    const needs = s.budget.groups.find((g) => g.grp === "Needs")!;
    expect(needs.rows.find((r) => r.name === "Groceries")).toEqual({ name: "Groceries", planned: 30000, actual: 2400 });

    const html = statementHtml(s);
    expect(html).toContain("Sam: December 2026");
    expect(html).toContain("You owe Alex $21.90");
    expect(html).toContain("Corner &lt;Market&gt;");
    expect(html).not.toContain("Just for Alex");
  });

  it("words the balance from the reader's side", () => {
    const names = { a: "Alex", b: "Sam" };
    expect(owesSentence(1200, "b", names)).toBe("You owe Alex $12.00");
    expect(owesSentence(1200, "a", names)).toBe("Sam owes you $12.00");
    expect(owesSentence(-1200, "b", names)).toBe("Alex owes you $12.00");
    expect(owesSentence(0, "a", names)).toBe("You are all square");
  });
});
