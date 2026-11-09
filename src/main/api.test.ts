import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db";
import { createApi, UserError, type CoreApi } from "./api";
import type { EntryInput } from "../shared/types";

let api: CoreApi;
let groceries: number;
let hobbies: number;
let paycheck: number;

const seventy = { type: "percent", a: 70 } as const;
const expense = (over: Partial<EntryInput> = {}): EntryInput => ({
  date: "2026-12-05",
  description: "Corner market",
  amount_cents: 10000,
  kind: "expense",
  category_id: groceries,
  paid_by: "a",
  split: seventy,
  ...over,
});

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  migrate(db);
  api = createApi(db, { now: () => new Date("2026-12-05T12:00:00Z") });
  const cats = api["categories.list"]();
  groceries = cats.find((c) => c.name === "Groceries")!.id;
  hobbies = cats.find((c) => c.name === "Hobbies")!.id;
  paycheck = cats.find((c) => c.name === "Paycheck")!.id;
});

describe("entries", () => {
  it("stores the full amount and both shares from one entry", () => {
    const e = api["entries.create"](expense({ amount_cents: 12669 }));
    expect([e.amount_cents, e.a_cents, e.b_cents]).toEqual([12669, 8868, 3801]);
    expect(api["entries.list"]({ month: "2026-12" })).toHaveLength(1);
    expect(api["entries.list"]({ month: "2026-11" })).toHaveLength(0);
  });

  it("uses the default split when none is given and keeps income with its owner", () => {
    api["settings.update"]({ defaultSplit: seventy });
    expect(api["entries.create"](expense({ split: undefined })).a_cents).toBe(7000);
    const pay = api["entries.create"](expense({ kind: "income", category_id: paycheck, paid_by: "b", amount_cents: 200000, split: undefined }));
    expect([pay.a_cents, pay.b_cents]).toEqual([0, 200000]);
    const moved = api["entries.update"]({ id: pay.id, patch: { paid_by: "a" } });
    expect([moved.a_cents, moved.b_cents]).toEqual([200000, 0]);
  });

  it("recomputes shares when the amount changes and keeps the split", () => {
    const e = api["entries.create"](expense());
    const edited = api["entries.update"]({ id: e.id, patch: { amount_cents: 2865 } });
    expect([edited.a_cents, edited.b_cents]).toEqual([2006, 859]);
    expect(edited.split).toEqual(seventy);
  });

  it("rejects entries a person could not mean", () => {
    expect(() => api["entries.create"](expense({ description: "  " }))).toThrow(UserError);
    expect(() => api["entries.create"](expense({ amount_cents: 0 }))).toThrow("Enter an amount");
    expect(() => api["entries.create"](expense({ date: "2026-02-30" }))).toThrow("Enter a valid date");
    expect(() => api["entries.create"](expense({ category_id: paycheck }))).toThrow("expense category");
    expect(() => api["entries.create"](expense({ split: { type: "percent", a: 140 } }))).toThrow("not valid");
    expect(api["entries.list"]({ month: "2026-12" })).toHaveLength(0);
  });

  it("edits several entries at once, all or nothing", () => {
    const a = api["entries.create"](expense());
    const b = api["entries.create"](expense({ description: "Game shop" }));
    api["entries.bulkUpdate"]({ ids: [a.id, b.id], patch: { category_id: hobbies, split: { type: "percent", a: 100 } } });
    const list = api["entries.list"]({ month: "2026-12" });
    expect(list.every((e) => e.category_id === hobbies && e.b_cents === 0)).toBe(true);
    expect(() => api["entries.bulkUpdate"]({ ids: [a.id, 9999], patch: { description: "x" } })).toThrow();
    expect(api["entries.list"]({ month: "2026-12" }).map((e) => e.description).sort()).toEqual(["Corner market", "Game shop"]);
  });

  it("splits one purchase across categories without changing the total", () => {
    const e = api["entries.create"](expense({ amount_cents: 15000 }));
    const [rest, part] = api["entries.split"]({ id: e.id, parts: [{ amount_cents: 4000, category_id: hobbies }] });
    expect(rest.amount_cents + part.amount_cents).toBe(15000);
    expect(part.split_of).toBe(e.id);
    expect([part.a_cents, part.b_cents]).toEqual([2800, 1200]);
    expect(() => api["entries.split"]({ id: e.id, parts: [{ amount_cents: 11000, category_id: hobbies }] })).toThrow("less than");
    api["entries.remove"]({ ids: [e.id] });
    const left = api["entries.list"]({ month: "2026-12" });
    expect(left).toHaveLength(1);
    expect(left[0].split_of).toBeNull();
  });
});

describe("splitting and fixed shares", () => {
  it("refuses to divide a fixed-amount purchase, which would change who owes what", () => {
    const e = api["entries.create"](expense({ amount_cents: 22326, split: { type: "fixed", a_cents: 11042 } }));
    expect([e.a_cents, e.b_cents]).toEqual([11042, 11284]);
    expect(() => api["entries.split"]({ id: e.id, parts: [{ amount_cents: 5000, category_id: hobbies }] })).toThrow("percentage split");
    expect(api["entries.list"]({ month: "2026-12" })).toHaveLength(1);
  });

  it("keeps a refund's shares the mirror of the purchase", () => {
    const buy = api["entries.create"](expense({ amount_cents: 2865 }));
    const refund = api["entries.create"](expense({ amount_cents: -2865, description: "Refund" }));
    expect([refund.a_cents, refund.b_cents]).toEqual([-buy.a_cents, -buy.b_cents]);
    expect(api["balance.get"]().cents).toBe(0);
    const row = api["budget.get"]({ month: "2026-12", view: "a" }).rows.find((r) => r.category_id === groceries)!;
    expect(row.actual).toBe(0);
  });

  it("will not restore an archived category over a live one with the same name", () => {
    api["categories.update"]({ id: hobbies, patch: { archived: true } });
    api["categories.create"]({ name: "Hobbies", grp: "Wants" });
    expect(() => api["categories.update"]({ id: hobbies, patch: { archived: false } })).toThrow("already exists");
  });
});

describe("undo", () => {
  it("reverses the last add, edit, delete and split", () => {
    const e = api["entries.create"](expense());
    api["entries.update"]({ id: e.id, patch: { amount_cents: 5000 } });
    expect(api["undo.peek"]()).toBe("Edit entry");
    api["undo.run"]();
    expect(api["entries.list"]({ month: "2026-12" })[0].amount_cents).toBe(10000);

    api["entries.split"]({ id: e.id, parts: [{ amount_cents: 2500, category_id: hobbies }] });
    api["undo.run"]();
    const afterSplitUndo = api["entries.list"]({ month: "2026-12" });
    expect(afterSplitUndo).toHaveLength(1);
    expect(afterSplitUndo[0].amount_cents).toBe(10000);

    api["entries.remove"]({ ids: [e.id] });
    expect(api["entries.list"]({ month: "2026-12" })).toHaveLength(0);
    api["undo.run"]();
    expect(api["entries.list"]({ month: "2026-12" })[0]).toMatchObject({ id: e.id, a_cents: 7000, b_cents: 3000 });

    api["undo.run"]();
    expect(api["entries.list"]({ month: "2026-12" })).toHaveLength(0);
    expect(api["undo.run"]()).toBeNull();
  });

  it("puts a deleted split purchase back with its pieces linked", () => {
    const e = api["entries.create"](expense({ amount_cents: 9000 }));
    const [, part] = api["entries.split"]({ id: e.id, parts: [{ amount_cents: 3000, category_id: hobbies }] });
    api["entries.remove"]({ ids: [e.id, part.id] });
    api["undo.run"]();
    const back = api["entries.list"]({ month: "2026-12" });
    expect(back).toHaveLength(2);
    expect(back.find((x) => x.id === part.id)!.split_of).toBe(e.id);
  });
});

describe("balance", () => {
  it("tracks who owes whom across expenses, settlements and the opening balance", () => {
    api["entries.create"](expense({ amount_cents: 10000, paid_by: "a" }));
    api["entries.create"](expense({ amount_cents: 4000, paid_by: "b" }));
    expect(api["balance.get"]().cents).toBe(3000 - 2800);
    api["entries.create"]({ date: "2026-12-20", description: "Settle up", amount_cents: 200, kind: "settlement", category_id: null, paid_by: "b" });
    expect(api["balance.get"]().cents).toBe(0);
    api["settings.update"]({ openingBalanceCents: -35000 });
    expect(api["balance.get"]({ month: "2026-12" })).toEqual({ cents: -35000, openingCents: -35000, monthDeltaCents: 0 });
  });
});

describe("budget", () => {
  it("shows each person's share against their own plan and the full amount for the household", () => {
    api["budget.setPlanned"]({ month: "2026-12", person: "a", category_id: groceries, planned_cents: 70000 });
    api["budget.setPlanned"]({ month: "2026-12", person: "b", category_id: groceries, planned_cents: 30000 });
    api["entries.create"](expense({ amount_cents: 20000 }));
    const row = (view: "a" | "b" | "hh") => api["budget.get"]({ month: "2026-12", view }).rows.find((r) => r.category_id === groceries)!;
    expect([row("a").planned, row("a").actual]).toEqual([70000, 14000]);
    expect([row("b").planned, row("b").actual]).toEqual([30000, 6000]);
    expect([row("hh").planned, row("hh").actual]).toEqual([100000, 20000]);
  });

  it("starts a new month from the last plan and can change a plan from now on", () => {
    api["budget.setPlanned"]({ month: "2026-12", person: "a", category_id: groceries, planned_cents: 70000 });
    const jan = api["budget.get"]({ month: "2027-01", view: "a" }).rows.find((r) => r.category_id === groceries)!;
    expect(jan.planned).toBe(70000);
    api["budget.get"]({ month: "2027-02", view: "a" });
    api["budget.setPlanned"]({ month: "2027-01", person: "a", category_id: groceries, planned_cents: 80000, forward: true });
    const planned = (month: string) => api["budget.get"]({ month, view: "a" }).rows.find((r) => r.category_id === groceries)!.planned;
    expect([planned("2026-12"), planned("2027-01"), planned("2027-02")]).toEqual([70000, 80000, 80000]);
  });

  it("counts entries with no category so nothing goes missing", () => {
    api["entries.create"](expense({ category_id: null, amount_cents: 1234, split: { type: "percent", a: 100 } }));
    const rows = api["budget.get"]({ month: "2026-12", view: "a" }).rows;
    expect(rows.find((r) => r.name === "Uncategorized")!.actual).toBe(1234);
  });
});

describe("categories and groups", () => {
  it("renames everywhere, archives what has history and deletes what does not", () => {
    api["entries.create"](expense());
    api["categories.update"]({ id: groceries, patch: { name: "Food at home" } });
    expect(api["entries.list"]({ month: "2026-12" })[0].category_name).toBe("Food at home");
    expect(() => api["categories.create"]({ name: "food at home", grp: "Needs" })).toThrow("already exists");
    expect(api["categories.remove"]({ id: groceries })).toBe("archived");
    expect(api["categories.remove"]({ id: hobbies })).toBe("deleted");
    expect(api["categories.list"]().some((c) => c.id === groceries || c.id === hobbies)).toBe(false);
    expect(api["budget.get"]({ month: "2026-12", view: "hh" }).rows.find((r) => r.category_id === groceries)!.actual).toBe(10000);
  });

  it("renames a group across categories, targets and the group list", () => {
    api["settings.update"]({ targets: { a: { Needs: 46 }, b: {} } });
    const s = api["groups.rename"]({ from: "Needs", to: "Essentials" });
    expect(s.groups).toEqual(["Essentials", "Wants", "Savings"]);
    expect(s.targets.a).toEqual({ Essentials: 46 });
    expect(api["categories.list"]().filter((c) => c.grp === "Needs")).toHaveLength(0);
  });
});

describe("setup file", () => {
  it("loads names, split, categories and a first plan in one step", () => {
    const result = api["setup.import"]({
      people: { a: "Alex", b: "Sam" },
      defaultSplitA: 70,
      replaceCategories: true,
      categories: [
        { name: "Rent", group: "Needs" },
        { name: "Salary", group: "Income", kind: "income" },
      ],
      budget: { month: "2026-12", a: { Rent: 105000 }, b: { Rent: 45000 } },
      openingBalanceCents: -1500,
    });
    expect(result).toEqual({ categories: 2, budgetLines: 2 });
    expect(api["settings.get"]().people).toEqual({ a: "Alex", b: "Sam" });
    expect(api["categories.list"]().map((c) => c.name)).toEqual(["Rent", "Salary"]);
    expect(api["budget.get"]({ month: "2026-12", view: "hh" }).rows[0].planned).toBe(150000);
    expect(api["balance.get"]().cents).toBe(-1500);
    expect(() => api["setup.import"]({ budget: { month: "2026-12", a: { Nope: 1 } } })).toThrow("not a category");
  });
});
