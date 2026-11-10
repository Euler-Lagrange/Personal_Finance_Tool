import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db";
import { createApi, type CoreApi } from "./api";
import type { EntryInput, FundInput, RenewalInput } from "../shared/types";

let api: CoreApi;
let cat: Map<string, number>;
const TODAY = "2026-12-05";

const fundInput = (over: Partial<FundInput> = {}): FundInput => ({ name: "Repairs", owner: "hh", target_cents: null, category_id: cat.get("Sinking funds")!, emergency: false, balance_cents: 0, ...over });
const expense = (over: Partial<EntryInput> = {}): EntryInput => ({
  date: "2026-12-03",
  description: "Set aside",
  amount_cents: 20000,
  kind: "expense",
  category_id: cat.get("Sinking funds")!,
  paid_by: "a",
  split: { type: "percent", a: 70 },
  ...over,
});
const funds = (month = "2026-12") => api["funds.list"]({ month });
const fund = (name: string, month = "2026-12") => funds(month).funds.find((f) => f.name === name)!;
const renewal = (over: Partial<RenewalInput> = {}): RenewalInput => ({
  name: "Password manager",
  category_id: cat.get("Subscriptions")!,
  months: 12,
  next_date: "2027-03-10",
  amount_cents: 6000,
  paid_by: "a",
  split: { type: "default" },
  fund_id: null,
  ...over,
});
const renewals = (today = TODAY) => api["renewals.list"]({ today });

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  migrate(db);
  api = createApi(db, { now: () => new Date(`${TODAY}T12:00:00Z`) });
  api["settings.update"]({ defaultSplit: { type: "percent", a: 70 } });
  cat = new Map(api["categories.list"]().map((c) => [c.name, c.id]));
});

describe("funds", () => {
  it("start at the balance typed, even when money was already set aside", () => {
    api["entries.create"](expense());
    const id = api["funds.create"](fundInput({ balance_cents: 150000, target_cents: 500000 }));
    expect(fund("Repairs")).toMatchObject({ id, balance_cents: 150000, target_cents: 500000, owner: "hh", category_name: "Sinking funds", month_in_cents: 20000, month_out_cents: 0 });
  });

  it("grow with every expense in the category that feeds them", () => {
    api["funds.create"](fundInput({ balance_cents: 100000 }));
    api["entries.create"](expense());
    api["entries.create"](expense({ date: "2026-11-20", amount_cents: 5000 }));
    expect(fund("Repairs")).toMatchObject({ balance_cents: 125000, month_in_cents: 20000 });
    expect(fund("Repairs", "2026-11").month_in_cents).toBe(5000);
    // Moving an entry to another category takes it back out of the fund.
    const e = api["entries.list"]({ month: "2026-12" })[0];
    api["entries.update"]({ id: e.id, patch: { category_id: cat.get("Groceries")! } });
    expect(fund("Repairs").balance_cents).toBe(105000);
  });

  it("pay for a purchase without touching the budget or the balance between the two people", () => {
    const id = api["funds.create"](fundInput({ balance_cents: 100000 }));
    const before = api["balance.get"]({}).cents;
    const sofa = api["entries.create"](expense({ description: "Plumber", amount_cents: 30000, category_id: cat.get("Housing")!, paid_from_fund: id }));
    expect(sofa).toMatchObject({ fund_id: id, from_fund: true });
    expect(fund("Repairs")).toMatchObject({ balance_cents: 70000, month_out_cents: 30000 });
    expect(api["budget.get"]({ month: "2026-12", view: "hh" }).rows.find((r) => r.name === "Housing")!.actual).toBe(0);
    expect(api["balance.get"]({}).cents).toBe(before);
    expect(api["statement.data"]({ month: "2026-12", person: "b" }).purchases).toEqual([]);
    // Taken off the fund again, it is an ordinary shared purchase.
    api["entries.update"]({ id: sofa.id, patch: { paid_from_fund: null } });
    expect(fund("Repairs").balance_cents).toBe(100000);
    expect(api["budget.get"]({ month: "2026-12", view: "hh" }).rows.find((r) => r.name === "Housing")!.actual).toBe(30000);
    expect(api["balance.get"]({}).cents).toBe(before + 9000);
    api["undo.run"]();
    expect(fund("Repairs").balance_cents).toBe(70000);
  });

  it("keep a split purchase's pieces on the fund", () => {
    const id = api["funds.create"](fundInput({ balance_cents: 100000 }));
    const e = api["entries.create"](expense({ amount_cents: 30000, category_id: cat.get("Housing")!, paid_from_fund: id }));
    api["entries.split"]({ id: e.id, parts: [{ amount_cents: 10000, category_id: cat.get("Hobbies")! }] });
    expect(fund("Repairs").balance_cents).toBe(70000);
    expect(api["budget.get"]({ month: "2026-12", view: "hh" }).rows.find((r) => r.name === "Hobbies")!.actual).toBe(0);
  });

  it("can be trued up, renamed, re-pointed and archived without losing their balance", () => {
    const id = api["funds.create"](fundInput({ balance_cents: 100000 }));
    api["entries.create"](expense());
    api["funds.setBalance"]({ id, balance_cents: 111100 });
    expect(fund("Repairs").balance_cents).toBe(111100);
    api["entries.create"](expense({ amount_cents: 900 }));
    expect(fund("Repairs").balance_cents).toBe(112000);
    api["funds.update"]({ id, patch: { name: "House repairs", category_id: cat.get("Savings")!, emergency: true, target_cents: 300000, owner: "a" } });
    expect(fund("House repairs")).toMatchObject({ balance_cents: 112000, category_name: "Savings", emergency: true, target_cents: 300000, owner: "a" });
    api["funds.update"]({ id, patch: { archived: true } });
    expect(fund("House repairs").archived).toBe(true);
    api["undo.run"]();
    api["undo.run"]();
    expect(fund("Repairs")).toMatchObject({ balance_cents: 112000, category_name: "Sinking funds", emergency: false });
  });

  it("refuse what would make the numbers wrong", () => {
    const id = api["funds.create"](fundInput());
    expect(() => api["funds.create"](fundInput())).toThrow("already a fund");
    expect(() => api["funds.create"](fundInput({ name: "Other" }))).toThrow("already feeds Repairs");
    expect(() => api["funds.create"](fundInput({ name: " ", category_id: null }))).toThrow("Enter a name");
    expect(() => api["funds.create"](fundInput({ name: "Pay", category_id: cat.get("Paycheck")! }))).toThrow("budget category");
    expect(() => api["entries.create"](expense({ paid_from_fund: 999 }))).toThrow("no longer exists");
    api["entries.create"](expense({ category_id: cat.get("Housing")!, paid_from_fund: id }));
    expect(() => api["funds.remove"]({ id })).toThrow("Archive it instead");
    // Income is never paid from a fund.
    const pay = api["entries.create"](expense({ kind: "income", category_id: cat.get("Paycheck")!, paid_from_fund: id, split: undefined }));
    expect(pay.from_fund).toBe(false);
  });

  it("can be deleted while nothing was paid from them", () => {
    const id = api["funds.create"](fundInput());
    const r = api["renewals.create"](renewal({ fund_id: id }));
    api["funds.remove"]({ id });
    expect(funds().funds).toEqual([]);
    expect(renewals().rows.find((x) => x.id === r)!.fund_id).toBeNull();
    api["undo.run"]();
    expect(fund("Repairs").id).toBe(id);
    expect(renewals().rows[0].fund_id).toBe(id);
  });
});

describe("emergency runway", () => {
  it("measures emergency funds against the first group's plan until there is spending to go on", () => {
    api["funds.create"](fundInput({ name: "Emergency", category_id: cat.get("Savings")!, emergency: true, balance_cents: 900000 }));
    api["funds.create"](fundInput({ name: "Holiday", category_id: null, balance_cents: 50000 }));
    expect(funds().runway).toMatchObject({ group: "Needs", emergency_cents: 900000, months: null, basis: "plan" });
    api["budget.setPlanned"]({ month: "2026-12", person: "a", category_id: cat.get("Housing")!, planned_cents: 180000 });
    api["budget.setPlanned"]({ month: "2026-12", person: "b", category_id: cat.get("Groceries")!, planned_cents: 120000 });
    api["budget.setPlanned"]({ month: "2026-12", person: "a", category_id: cat.get("Hobbies")!, planned_cents: 50000 });
    expect(funds().runway).toMatchObject({ monthly_cents: 300000, months: 3, basis: "plan" });
  });

  it("uses real spending from up to three earlier months once it exists", () => {
    const id = api["funds.create"](fundInput({ name: "Emergency", category_id: cat.get("Savings")!, emergency: true, balance_cents: 900000 }));
    api["entries.create"](expense({ date: "2026-10-05", category_id: cat.get("Housing")!, amount_cents: 200000 }));
    api["entries.create"](expense({ date: "2026-11-05", category_id: cat.get("Housing")!, amount_cents: 250000 }));
    api["entries.create"](expense({ date: "2026-11-09", category_id: cat.get("Hobbies")!, amount_cents: 70000 }));
    // Paid from a fund: not part of ordinary monthly spending.
    api["entries.create"](expense({ date: "2026-11-12", category_id: cat.get("Housing")!, amount_cents: 99000, paid_from_fund: id }));
    expect(funds().runway).toMatchObject({ basis: "spending", monthsUsed: 2, monthly_cents: 225000, emergency_cents: 801000, months: 3.6 });
  });
});

describe("renewals", () => {
  it("total a year's cost per person and know how many paychecks share it", () => {
    api["renewals.create"](renewal());
    api["renewals.create"](renewal({ name: "Car registration", months: 24, amount_cents: 20000, split: { type: "percent", a: 100 } }));
    const off = api["renewals.create"](renewal({ name: "Old magazine", amount_cents: 9900 }));
    api["renewals.update"]({ id: off, patch: { active: false } });
    const list = renewals();
    expect(list.rows.map((r) => r.name)).toEqual(["Password manager", "Car registration", "Old magazine"]);
    expect(list.rows[0]).toMatchObject({ months: 12, a_cents: 4200, b_cents: 1800, active: true });
    expect(list.yearly_cents).toEqual({ a: 4200 + 10000, b: 1800 });
    expect(list.checksPerYear).toEqual({ a: null, b: null });
    api["setup.import"]({ pay: { a: { rates: [{ effective_date: "2026-01-01", rate_cents: 5000 }], anchor: "2026-10-19" }, b: { rates: [{ effective_date: "2026-01-01", kind: "salaried", net_per_check_cents: 200000 }], rule: "monthdays", monthDays: [15, 31] } } });
    expect(renewals().checksPerYear).toEqual({ a: 26, b: 24 });
  });

  it("become an entry when their date comes, and move on by their interval", () => {
    const id = api["renewals.create"](renewal({ next_date: "2026-12-04" }));
    expect(api["entries.list"]({ month: "2026-12" })).toEqual([]);
    const list = renewals();
    expect(list.rows[0].next_date).toBe("2027-12-04");
    const [e] = api["entries.list"]({ month: "2026-12" });
    expect(e).toMatchObject({ date: "2026-12-04", description: "Password manager", amount_cents: 6000, a_cents: 4200, recurring_id: id, from_fund: false });
    // Looking again does not create it twice.
    renewals();
    expect(api["entries.list"]({ month: "2026-12" })).toHaveLength(1);
    // The entry is an ordinary one: its amount can be corrected.
    expect(api["entries.update"]({ id: e.id, patch: { amount_cents: 6500 } }).a_cents).toBe(4550);
  });

  it("catch up when the app was not opened for a while", () => {
    api["renewals.create"](renewal({ months: 3, next_date: "2026-05-31" }));
    expect(renewals().rows[0].next_date).toBe("2027-02-28");
    expect(api["entries.list"]({ month: "2026-08" }).map((e) => e.date)).toEqual(["2026-08-31"]);
    expect(api["entries.list"]({ month: "2026-11" }).map((e) => e.date)).toEqual(["2026-11-30"]);
  });

  it("draw on a fund when set to, leaving the month's budget alone", () => {
    const fundId = api["funds.create"](fundInput({ name: "Renewals", balance_cents: 50000 }));
    api["renewals.create"](renewal({ next_date: "2026-12-01", fund_id: fundId }));
    renewals();
    expect(api["entries.list"]({ month: "2026-12" })[0]).toMatchObject({ from_fund: true, fund_id: fundId });
    expect(fund("Renewals").balance_cents).toBe(44000);
    expect(api["budget.get"]({ month: "2026-12", view: "hh" }).rows.find((r) => r.name === "Subscriptions")!.actual).toBe(0);
  });

  it("can be edited, switched off and deleted, keeping past entries", () => {
    const id = api["renewals.create"](renewal({ next_date: "2026-12-01" }));
    renewals();
    api["renewals.update"]({ id, patch: { name: "Vault", amount_cents: 7200, months: 6, next_date: "2027-06-01" } });
    expect(renewals().rows[0]).toMatchObject({ name: "Vault", amount_cents: 7200, months: 6, next_date: "2027-06-01" });
    api["renewals.remove"]({ id });
    expect(renewals().rows).toEqual([]);
    expect(api["entries.list"]({ month: "2026-12" })[0]).toMatchObject({ description: "Password manager", recurring_id: null });
    expect(api["undo.run"]()).toBe("Delete renewal");
    expect(renewals().rows[0].name).toBe("Vault");
    expect(() => api["renewals.create"](renewal({ amount_cents: 0 }))).toThrow("costs");
    expect(() => api["renewals.create"](renewal({ months: 0 }))).toThrow("months");
    expect(() => api["renewals.update"]({ id: api["bills.create"]({ name: "Rent", category_id: null, due_day: 1, amount_cents: 100, paid_by: "a", split: { type: "default" }, month: "2026-12" }), patch: { name: "x" } })).toThrow("no longer exists");
    // Renewals are not monthly bills and do not show among them.
    expect(api["bills.list"]({ month: "2026-12", today: TODAY }).rows.map((r) => r.name)).toEqual(["Rent"]);
  });
});

describe("the paycheck plan", () => {
  beforeEach(() => {
    api["setup.import"]({ pay: { a: { rates: [{ effective_date: "2026-01-01", rate_cents: 5000 }], anchor: "2026-10-19" } } });
  });
  const check = (payDate: string) => api["pay.month"]({ person: "a", month: "2026-12" }).paychecks.find((p) => p.pay_date === payDate)!;

  it("counts a renewal due before the next payday, unless a fund pays for it", () => {
    const fundId = api["funds.create"](fundInput({ name: "Renewals" }));
    api["renewals.create"](renewal({ next_date: "2026-12-22" }));
    api["renewals.create"](renewal({ name: "From the fund", next_date: "2026-12-23", fund_id: fundId }));
    expect(check("2026-12-18").bills).toEqual([{ name: "Password manager", date: "2026-12-22", cents: 4200 }]);
    // One that has already become an entry still counts for the paycheck it fell under.
    api["renewals.create"](renewal({ name: "Domain", next_date: "2026-12-04", amount_cents: 2000 }));
    renewals();
    expect(check("2026-12-04").bills).toEqual([{ name: "Domain", date: "2026-12-04", cents: 1400 }]);
  });

  it("spreads the month's planned savings over the paychecks landing in it", () => {
    expect(api["pay.month"]({ person: "a", month: "2026-12" }).savingsGroup).toBe("Savings");
    api["budget.setPlanned"]({ month: "2026-12", person: "a", category_id: cat.get("Savings")!, planned_cents: 90000 });
    api["budget.setPlanned"]({ month: "2026-12", person: "a", category_id: cat.get("Sinking funds")!, planned_cents: 30001 });
    api["budget.setPlanned"]({ month: "2026-12", person: "b", category_id: cat.get("Savings")!, planned_cents: 77700 });
    // Three paydays land in December 2026, two in January 2027, which stands on December's plan.
    expect(check("2026-12-04").set_aside_cents).toBe(40000);
    expect(check("2026-12-31").set_aside_cents).toBe(40000);
    expect(check("2027-01-15").set_aside_cents).toBe(60001);
  });
});
