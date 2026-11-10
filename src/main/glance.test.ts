import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db";
import { createApi, type CoreApi } from "./api";
import { barPercent, glanceHtml } from "../core/glance";

let api: CoreApi;
let cat: Map<string, number>;

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  migrate(db);
  api = createApi(db, { now: () => new Date("2026-12-05T12:00:00Z") });
  api["settings.update"]({ people: { a: "Alex", b: "Sam" }, defaultSplit: { type: "percent", a: 60 } });
  cat = new Map(api["categories.list"]().map((c) => [c.name, c.id]));
  api["budget.setPlanned"]({ month: "2026-12", person: "a", category_id: cat.get("Groceries")!, planned_cents: 40000 });
  api["budget.setPlanned"]({ month: "2026-12", person: "b", category_id: cat.get("Groceries")!, planned_cents: 20000 });
  api["entries.create"]({ date: "2026-12-02", description: "Corner <Market>", amount_cents: 10000, kind: "expense", category_id: cat.get("Groceries")!, paid_by: "a" });
  api["entries.create"]({ date: "2026-12-01", description: "Paycheck", amount_cents: 300000, kind: "income", category_id: cat.get("Paycheck")!, paid_by: "a" });
  api["entries.create"]({ date: "2026-12-03", description: "Settle up", amount_cents: 1000, kind: "settlement", category_id: null, paid_by: "b" });
});

describe("the phone glance page", () => {
  it("gathers the month for the household and each person", () => {
    api["bills.create"]({ name: "Internet", category_id: cat.get("Utilities")!, due_day: 9, amount_cents: 6000, paid_by: "a", split: { type: "default" }, month: "2026-12" });
    api["bills.create"]({ name: "Later bill", category_id: cat.get("Utilities")!, due_day: 28, amount_cents: 9000, paid_by: "a", split: { type: "default" }, month: "2026-12" });
    api["funds.create"]({ name: "Emergency", owner: "hh", target_cents: 100000, category_id: null, emergency: true, balance_cents: 25000 });
    api["setup.import"]({ pay: { b: { rates: [{ effective_date: "2026-01-01", kind: "salaried", net_per_check_cents: 150000 }], rule: "monthdays", monthDays: [15, 31] } } });
    const g = api["glance.data"]();
    expect(g.month).toBe("2026-12");
    expect(g.views.map((v) => [v.label, v.spent, v.available, v.leftToSpend])).toEqual([
      ["Household", 25000, 60000, 35000],
      ["Alex", 15000, 40000, 25000],
      ["Sam", 10000, 20000, 10000],
    ]);
    expect(g.views[1].income).toBe(300000);
    expect(g.views[0].groups).toEqual([{ grp: "Needs", actual: 25000, planned: 60000 }]);
    // Sam owes 40% of the market and both bills, less the $10 already settled.
    expect(g.balance).toBe(4000 + 2400 + 3600 - 1000);
    expect(g.billsDue).toEqual([{ name: "Internet", date: "2026-12-09", cents: 6000 }]);
    expect(g.paychecks).toEqual([{ name: "Sam", date: "2026-12-15", cents: 150000 }]);
    expect(g.funds).toEqual([{ name: "Emergency", cents: 25000, target: 100000 }]);
    expect(g.recent.map((e) => e.description)).toEqual(["Later bill", "Internet", "Corner <Market>", "Paycheck"]);
    expect(g.recent.at(-1)).toMatchObject({ cents: 300000, income: true });
  });

  it("lays it out as one safe, self-contained page", () => {
    const html = glanceHtml(api["glance.data"]());
    expect(html).toContain("<h1>December 2026</h1>");
    expect(html).toContain("Corner &lt;Market&gt;");
    expect(html).not.toContain("<Market>");
    expect(html).toContain("Sam owes Alex $30.00");
    expect(html).toContain("+$3,000.00");
    expect(html).toContain("Nothing due in the next seven days.");
    expect(html).not.toContain("Next paycheck");
    expect(html).not.toMatch(/<script|src=|href=/);
  });

  it("fills its bars sensibly", () => {
    expect([barPercent(5000, 10000), barPercent(0, 10000), barPercent(15000, 10000), barPercent(100, 0), barPercent(0, 0), barPercent(-500, 10000)]).toEqual([50, 0, 100, 100, 0, 0]);
  });
});
