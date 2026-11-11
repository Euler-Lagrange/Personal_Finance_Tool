import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db";
import { createApi, type CoreApi } from "./api";
import { splitHouseholdPlan } from "../core/budget";
import { glanceHtml } from "../core/glance";

let api: CoreApi;
let groceries: number;
let hobbies: number;
const M = "2026-12";
const planned = (person: "a" | "b" | "hh", category: number, month = M) => api["budget.get"]({ month, view: person }).rows.find((r) => r.category_id === category)!.planned;

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  migrate(db);
  api = createApi(db, { now: () => new Date("2026-12-05T12:00:00Z") });
  api["settings.update"]({ people: { a: "Alex", b: "Sam" }, defaultSplit: { type: "percent", a: 70 } });
  const cats = api["categories.list"]();
  groceries = cats.find((c) => c.name === "Groceries")!.id;
  hobbies = cats.find((c) => c.name === "Hobbies")!.id;
  api["budget.setPlanned"]({ month: M, person: "a", category_id: groceries, planned_cents: 42000 });
  api["budget.setPlanned"]({ month: M, person: "b", category_id: groceries, planned_cents: 18000 });
});

describe("one household plan kept as two parts", () => {
  it("keeps the proportion the two plans already had, to the cent", () => {
    expect(splitHouseholdPlan(90000, 42000, 18000)).toEqual({ a: 63000, b: 27000 });
    expect(splitHouseholdPlan(10001, 1, 2)).toEqual({ a: 3334, b: 6667 });
    expect(splitHouseholdPlan(50000, 0, 0)).toEqual({ a: 50000, b: 0 });
    expect(splitHouseholdPlan(0, 42000, 18000)).toEqual({ a: 0, b: 0 });
    for (const total of [1, 99, 12345, 700001]) {
      const parts = splitHouseholdPlan(total, 333, 667);
      expect(parts.a + parts.b).toBe(total);
    }
  });

  it("changes the household's planned amount without losing either person's plan", () => {
    api["budget.setHouseholdPlanned"]({ month: M, category_id: groceries, planned_cents: 90000 });
    expect([planned("hh", groceries), planned("a", groceries), planned("b", groceries)]).toEqual([90000, 63000, 27000]);
    // A category nobody had planned for goes under the first person.
    api["budget.setHouseholdPlanned"]({ month: M, category_id: hobbies, planned_cents: 5000 });
    expect([planned("hh", hobbies), planned("a", hobbies), planned("b", hobbies)]).toEqual([5000, 5000, 0]);
    api["undo.run"]();
    api["undo.run"]();
    expect([planned("a", groceries), planned("b", groceries), planned("hh", hobbies)]).toEqual([42000, 18000, 0]);
    expect(() => api["budget.setHouseholdPlanned"]({ month: M, category_id: groceries, planned_cents: -1 })).toThrow("zero or more");
    expect(() => api["budget.setHouseholdPlanned"]({ month: M, category_id: 9999, planned_cents: 100 })).toThrow("no longer exists");
  });

  it("can apply a change to later months too", () => {
    expect(planned("hh", groceries, "2027-01")).toBe(60000);
    api["budget.setHouseholdPlanned"]({ month: M, category_id: groceries, planned_cents: 30000, forward: true });
    expect([planned("hh", groceries, "2027-01"), planned("a", groceries, "2027-01"), planned("b", groceries, "2027-01")]).toEqual([30000, 21000, 9000]);
  });

  it("sets one starting balance for the household", () => {
    api["budget.setStartBalance"]({ month: M, person: "b", cents: 40000 });
    api["budget.setHouseholdStartBalance"]({ month: M, cents: 250000 });
    expect(api["budget.get"]({ month: M, view: "hh" }).startBalanceCents).toBe(250000);
    expect(api["budget.get"]({ month: M, view: "b" }).startBalanceCents).toBe(40000);
    expect(api["budget.get"]({ month: M, view: "a" }).startBalanceCents).toBe(210000);
  });
});

describe("merging finances", () => {
  it("is a switch that converts nothing: entries keep both shares, and it can be switched off", () => {
    const before = api["entries.create"]({ date: "2026-12-02", description: "Market", amount_cents: 10000, kind: "expense", category_id: groceries, paid_by: "a" });
    const owed = api["balance.get"]({}).cents;
    expect(api["settings.update"]({ mergedFinances: true }).mergedFinances).toBe(true);
    // An entry added while merged is still shared out by the default split behind the scenes.
    const during = api["entries.create"]({ date: "2026-12-03", description: "Bakery", amount_cents: 2000, kind: "expense", category_id: groceries, paid_by: "b" });
    expect([during.a_cents, during.b_cents]).toEqual([1400, 600]);
    expect(api["entries.list"]({ month: M }).find((e) => e.id === before.id)).toMatchObject({ a_cents: 7000, b_cents: 3000 });
    expect(api["budget.get"]({ month: M, view: "hh" }).rows.find((r) => r.category_id === groceries)!.actual).toBe(12000);
    api["settings.update"]({ mergedFinances: false });
    // Back to separate finances: the balance picks up where the shares say it should.
    expect(api["balance.get"]({}).cents).toBe(owed - 1400);
    api["undo.run"]();
    expect(api["settings.get"]().mergedFinances).toBe(true);
  });

  it("keeps the household's own group targets apart from each person's, and renames them with the group", () => {
    api["settings.update"]({ targets: { a: { Needs: 50 }, b: { Needs: 60 }, hh: { Needs: 55, Wants: 20 } } });
    const renamed = api["groups.rename"]({ from: "Needs", to: "Essentials" });
    expect(renamed.targets).toEqual({ a: { Essentials: 50 }, b: { Essentials: 60 }, hh: { Essentials: 55, Wants: 20 } });
  });

  it("leaves the phone glance page with one household budget and no balance", () => {
    api["entries.create"]({ date: "2026-12-02", description: "Market", amount_cents: 10000, kind: "expense", category_id: groceries, paid_by: "a" });
    expect(api["glance.data"]().views).toHaveLength(3);
    api["settings.update"]({ mergedFinances: true });
    const g = api["glance.data"]();
    expect(g.views.map((v) => v.label)).toEqual(["Household"]);
    expect(g.balance).toBeNull();
    const html = glanceHtml(g);
    expect(html).not.toContain("Between you");
    expect(html).not.toContain("owes");
  });
});
