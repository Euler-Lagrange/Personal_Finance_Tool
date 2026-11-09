import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db";
import { createApi, UserError, type CoreApi } from "./api";
import type { PayProfileInput } from "../shared/types";

let api: CoreApi;
let db: DatabaseSync;
let groceries: number;
let paycheck: number;

const hourly = (over: Partial<PayProfileInput> = {}): PayProfileInput => ({
  person: "a",
  kind: "hourly",
  effective_date: "2026-01-01",
  rate_cents: 5000,
  net_per_check_cents: null,
  rule: "biweekly",
  anchor: "2026-10-19",
  lagDays: 5,
  monthDays: [],
  sickHoursPerYear: 40,
  usualHours: 0,
  grossGoalCents: null,
  incomeCategoryId: null,
  ...over,
});
/** Take-home is exactly 60% of gross plus $400 across these, so predictions are easy to check. */
const history = [300000, 350000, 400000, 450000, 500000].map((g) => ({ gross_cents: g, net_cents: 0.6 * g + 40000 }));
const december = () => api["pay.month"]({ person: "a", month: "2026-12" });
const check = (payDate: string) => december().paychecks.find((p) => p.pay_date === payDate)!;
const stored = () => (db.prepare("select count(*) n from paychecks").get() as { n: number }).n;
const work = (date: string, hours: number, tag: "worked" | "sick" | "holiday" | "off" = "worked") => api["pay.setDay"]({ person: "a", date, hours, tag });

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  migrate(db);
  api = createApi(db, { now: () => new Date("2026-12-05T12:00:00Z") });
  const cats = api["categories.list"]();
  groceries = cats.find((c) => c.name === "Groceries")!.id;
  paycheck = cats.find((c) => c.name === "Paycheck")!.id;
});

describe("pay settings", () => {
  it("has nothing to show until pay is set up", () => {
    const m = december();
    expect(m.profile).toBeNull();
    expect(m.paychecks).toEqual([]);
    expect([m.gridStart, m.gridEnd]).toEqual(["2026-11-30", "2027-01-03"]);
    expect(api["pay.next"]({ person: "a" })).toBeNull();
    expect(() => api["pay.whatIf"]({ person: "a", hours: 80 })).toThrow(UserError);
  });

  it("corrects a rate on the same start date and adds a raise on a new one", () => {
    api["pay.saveProfile"](hourly());
    expect(api["pay.saveProfile"](hourly({ rate_cents: 5100 })).rates).toHaveLength(1);
    const raised = api["pay.saveProfile"](hourly({ effective_date: "2027-01-01", rate_cents: 5500 }));
    expect(raised.rates.map((r) => r.rate_cents)).toEqual([5100, 5500]);
    expect(raised.current.rate_cents).toBe(5100);
    // 80 hours in a period that ends in 2026, 80 in one that ends in 2027.
    for (const d of ["2026-12-14", "2026-12-15"]) work(d, 12);
    for (const d of ["2026-12-28", "2026-12-29"]) work(d, 12);
    expect(check("2026-12-31").gross_cents).toBe(24 * 5100);
    expect(check("2027-01-15").gross_cents).toBe(24 * 5500);
  });

  it("keeps the schedule and known paychecks when a raise is added, and at least one rate", () => {
    api["pay.saveProfile"](hourly());
    api["pay.setHistory"]({ person: "a", history });
    const raised = api["pay.saveProfile"](hourly({ effective_date: "2027-01-01", rate_cents: 5500 }));
    expect(raised.schedule.history).toHaveLength(5);
    expect(raised.schedule.anchor).toBe("2026-10-19");
    api["pay.removeRate"]({ id: raised.rates[1].id });
    expect(() => api["pay.removeRate"]({ id: raised.rates[0].id })).toThrow("Keep at least one rate");
    api["undo.run"]();
    const back = api["pay.profile"]({ person: "a" })!;
    expect(back.rates.map((r) => r.rate_cents)).toEqual([5000, 5500]);
    expect(back.schedule.history).toHaveLength(5);
  });

  it("undoes a first-time setup completely", () => {
    api["pay.saveProfile"](hourly());
    api["undo.run"]();
    expect(api["pay.profile"]({ person: "a" })).toBeNull();
  });

  it("refuses settings a person could not mean", () => {
    expect(() => api["pay.saveProfile"](hourly({ anchor: "2026-10-20" }))).toThrow("Monday");
    expect(() => api["pay.saveProfile"](hourly({ rate_cents: 0 }))).toThrow("hourly rate");
    expect(() => api["pay.saveProfile"](hourly({ kind: "salaried" }))).toThrow("take-home");
    expect(() => api["pay.saveProfile"](hourly({ rule: "monthdays", monthDays: [] }))).toThrow("days of the month");
    expect(() => api["pay.saveProfile"](hourly({ incomeCategoryId: groceries }))).toThrow("income category");
    expect(api["pay.profile"]({ person: "a" })).toBeNull();
    api["pay.saveProfile"](hourly());
    expect(() => api["pay.setHistory"]({ person: "a", history: [{ gross_cents: 100, net_cents: 200 }] })).toThrow("more than gross");
    expect(() => work("2026-12-01", 25)).toThrow("0 to 24");
  });
});

describe("paychecks", () => {
  beforeEach(() => {
    api["pay.saveProfile"](hourly());
  });

  it("follow the schedule, off weekends and bank holidays, with nothing stored", () => {
    const checks = december().paychecks;
    // The payday due on New Year's Day moves to the day before.
    expect(checks.map((p) => p.pay_date)).toEqual(["2026-12-04", "2026-12-18", "2026-12-31", "2027-01-15"]);
    expect(checks.map((p) => p.period_start)).toEqual(["2026-11-16", "2026-11-30", "2026-12-14", "2026-12-28"]);
    expect(checks.every((p) => p.id === null)).toBe(true);
    expect(stored()).toBe(0);
    expect(december().bankHolidays.map((h) => h.name)).toEqual(["Christmas Day", "New Year's Day"]);
  });

  it("add up the hours in their period, sick time included", () => {
    work("2026-11-30", 8);
    work("2026-12-01", 10.5);
    work("2026-12-02", 8, "sick");
    work("2026-12-13", 4);
    work("2026-12-14", 9);
    expect(check("2026-12-18").hours).toBe(30.5);
    expect(check("2026-12-18").gross_cents).toBe(152500);
    expect(check("2026-12-31").hours).toBe(9);
    expect(december().year.sickUsedHours).toBe(8);
    work("2026-12-01", 8, "off");
    expect(december().days.find((d) => d.date === "2026-12-01")).toEqual({ date: "2026-12-01", hours: 0, tag: "off" });
    work("2026-12-01", 0);
    expect(december().days.some((d) => d.date === "2026-12-01")).toBe(false);
    api["undo.run"]();
    api["undo.run"]();
    expect(check("2026-12-18").hours).toBe(30.5);
  });

  it("move a payday earlier off a day tagged as a holiday", () => {
    work("2026-12-18", 0, "holiday");
    expect(december().paychecks[1].pay_date).toBe("2026-12-17");
  });

  it("predict take-home from known paychecks once there are three", () => {
    for (const d of ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-07", "2026-12-08", "2026-12-09"]) work(d, 10);
    expect(check("2026-12-18").predicted_net_cents).toBeNull();
    api["pay.setHistory"]({ person: "a", history: history.slice(0, 2) });
    expect(december().fit).toBeNull();
    api["pay.setHistory"]({ person: "a", history });
    expect(december().fit).toMatchObject({ n: 5, noBenefitsExtra: null });
    expect(december().fit!.error).toBeLessThan(1e-9);
    // 80 hours at $50 is $4,000 gross: 60% plus $400.
    expect(check("2026-12-18")).toMatchObject({ hours: 80, gross_cents: 400000, predicted_net_cents: 280000, uncertain: false });
    expect(api["pay.whatIf"]({ person: "a", hours: 90 })).toEqual({ gross_cents: 450000, net_cents: 310000, uncertain: false, extra_hour_cents: 3000 });
    expect(api["pay.whatIf"]({ person: "a", hours: 20 }).uncertain).toBe(true);
    expect(check("2026-12-04").predicted_net_cents).toBeNull();
  });

  it("are stored once something is typed on them and learn from the real take-home", () => {
    api["pay.setHistory"]({ person: "a", history });
    for (const d of ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"]) work(d, 20);
    api["pay.updatePaycheck"]({ person: "a", id: null, period_start: "2026-11-30", patch: { actual_net_cents: 280000 } });
    expect(stored()).toBe(1);
    const typed = check("2026-12-18");
    expect(typed).toMatchObject({ actual_net_cents: 280000, actual_gross_cents: null, predicted_net_cents: 280000 });
    expect(typed.id).not.toBeNull();
    expect(december().fit!.n).toBe(6);
    expect(december().paychecks).toHaveLength(4);
    // Clearing what was typed hands the paycheck back to the schedule.
    api["pay.updatePaycheck"]({ person: "a", id: typed.id, period_start: typed.period_start, patch: { actual_net_cents: null } });
    expect(stored()).toBe(0);
    expect(check("2026-12-18").id).toBeNull();
    api["undo.run"]();
    expect(check("2026-12-18").actual_net_cents).toBe(280000);
    api["undo.run"]();
    expect(stored()).toBe(0);
  });

  it("plan on the usual hours while a pay period is still under way", () => {
    api["pay.saveProfile"](hourly({ usualHours: 80 }));
    api["pay.setHistory"]({ person: "a", history });
    work("2026-11-16", 10);
    work("2026-12-01", 10);
    // The period that ended in November stands on its own hours; the one under way is planned at 80.
    expect(check("2026-12-04")).toMatchObject({ hours: 10, assumed_hours: null, gross_cents: 50000 });
    expect(check("2026-12-18")).toMatchObject({ hours: 10, gross_cents: 50000, assumed_hours: 80, predicted_net_cents: 280000 });
    expect(check("2026-12-31")).toMatchObject({ hours: 0, assumed_hours: 80, predicted_net_cents: 280000 });
    // Logging more than usual, or typing the stub's gross, takes over from the assumption.
    for (const d of ["2026-12-02", "2026-12-03", "2026-12-04", "2026-12-07"]) work(d, 20);
    expect(check("2026-12-18")).toMatchObject({ hours: 90, assumed_hours: null, predicted_net_cents: 310000 });
    api["pay.updatePaycheck"]({ person: "a", id: null, period_start: "2026-12-14", patch: { actual_gross_cents: 350000 } });
    expect(check("2026-12-31")).toMatchObject({ assumed_hours: null, predicted_net_cents: 250000 });
    // The year's gross counts only hours really logged.
    expect(december().year.gross_cents).toBe(50000 + 450000 + 350000);
    expect(() => api["pay.saveProfile"](hourly({ usualHours: -1 }))).toThrow("usual hours");
  });

  it("learn how much more a paycheck with no benefits taken out brings home", () => {
    api["pay.setHistory"]({ person: "a", history: [...history, { gross_cents: 400000, net_cents: 295000, no_benefits: true }] });
    expect(december().fit).toMatchObject({ n: 5, noBenefitsExtra: 15000 });
    for (const d of ["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17"]) work(d, 20);
    expect(check("2026-12-31").predicted_net_cents).toBe(280000);
    api["pay.updatePaycheck"]({ person: "a", id: null, period_start: "2026-12-14", patch: { no_benefits: true } });
    expect(check("2026-12-31")).toMatchObject({ no_benefits: true, predicted_net_cents: 295000 });
    expect(api["pay.whatIf"]({ person: "a", hours: 80, no_benefits: true }).net_cents).toBe(295000);
  });

  it("keep dates changed by hand, and the schedule fills in around them", () => {
    api["pay.updatePaycheck"]({ person: "a", id: null, period_start: "2026-11-30", patch: { pay_date: "2026-12-17" } });
    expect(december().paychecks.map((p) => p.pay_date)).toEqual(["2026-12-04", "2026-12-17", "2026-12-31", "2027-01-15"]);
    expect(() => api["pay.updatePaycheck"]({ person: "a", id: null, period_start: "2026-12-14", patch: { period_start: "2026-12-10" } })).toThrow("overlaps");
    expect(() => api["pay.updatePaycheck"]({ person: "a", id: null, period_start: "2026-12-14", patch: { period_end: "2026-12-01" } })).toThrow("end before");
    expect(() => api["pay.updatePaycheck"]({ person: "a", id: null, period_start: "2026-12-15", patch: { no_benefits: true } })).toThrow("no longer exists");
    expect(() => api["pay.updatePaycheck"]({ person: "a", id: null, period_start: "2026-12-14", patch: { actual_gross_cents: 100, actual_net_cents: 200 } })).toThrow("more than gross");
    // Pay periods move a week later. The stored paycheck stays; no pay period overlaps another.
    api["pay.saveProfile"](hourly({ anchor: "2026-10-26" }));
    const checks = december().paychecks;
    expect(checks.find((p) => p.pay_date === "2026-12-17")).toMatchObject({ period_start: "2026-11-30", period_end: "2026-12-13" });
    for (let i = 1; i < checks.length; i++) expect(checks[i].period_start > checks[i - 1].period_end).toBe(true);
    // Putting the date back as the schedule has it is only possible while the schedule matches.
    api["pay.saveProfile"](hourly());
    const moved = check("2026-12-17");
    api["pay.updatePaycheck"]({ person: "a", id: moved.id, period_start: moved.period_start, patch: { pay_date: "2026-12-18" } });
    expect(stored()).toBe(0);
  });

  it("show each person's share of the bills due before the next payday", () => {
    api["settings.update"]({ defaultSplit: { type: "percent", a: 70 } });
    const bill = (name: string, due_day: number, amount_cents: number) =>
      api["bills.create"]({ name, category_id: groceries, due_day, amount_cents, paid_by: "a", split: { type: "default" }, month: "2026-12" });
    bill("Mortgage", 10, 200000);
    const internet = bill("Internet", 20, 6000);
    const gym = bill("Gym", 22, 4000);
    // December's internet bill came in higher, and there was no gym bill this month.
    api["bills.setMonthAmount"]({ id: internet, month: "2026-12", amount_cents: 8000 });
    api["bills.setMonthAmount"]({ id: gym, month: "2026-12", amount_cents: 0 });
    expect(check("2026-12-04")).toMatchObject({ next_pay_date: "2026-12-18", bills_cents: 140000, bills: [{ name: "Mortgage", date: "2026-12-10", cents: 140000 }] });
    expect(check("2026-12-18").bills).toEqual([{ name: "Internet", date: "2026-12-20", cents: 5600 }]);
    // January's bills are not entries yet, so the usual amounts stand in.
    expect(check("2026-12-31").bills).toEqual([{ name: "Mortgage", date: "2027-01-10", cents: 140000 }]);
    expect(check("2027-01-15").bills.map((b) => [b.name, b.cents])).toEqual([["Internet", 4200], ["Gym", 2800]]);
    expect(api["pay.month"]({ person: "b", month: "2026-12" }).paychecks).toEqual([]);
    expect(api["pay.next"]({ person: "a" })).toMatchObject({ pay_date: "2026-12-18", bills_cents: 5600 });
  });

  it("plan the month's paycheck income from what is expected to land", () => {
    api["pay.setHistory"]({ person: "a", history });
    for (const d of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]) work(d, 20);
    for (const d of ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"]) work(d, 20);
    api["pay.updatePaycheck"]({ person: "a", id: null, period_start: "2026-11-16", patch: { actual_net_cents: 281234 } });
    // Three paydays land in December: one real, one predicted, one with no hours yet.
    expect(december().income).toMatchObject({ category_id: paycheck, checks: 3, planned_cents: 0 });
    const expected = december().income.expected_cents;
    expect(expected).toBe(281234 + check("2026-12-18").predicted_net_cents!);
    expect(api["pay.planIncome"]({ person: "a", month: "2026-12" })).toBe(expected);
    expect(december().income.planned_cents).toBe(expected);
    expect(api["budget.get"]({ month: "2026-12", view: "a" }).rows.find((r) => r.category_id === paycheck)!.planned).toBe(expected);
    api["undo.run"]();
    expect(december().income.planned_cents).toBe(0);
  });

  it("total the year by payday and count the hours left to a goal", () => {
    api["pay.saveProfile"](hourly({ grossGoalCents: 1000000 }));
    for (const d of ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"]) work(d, 20);
    // Worked in 2026 but paid in January 2027, so it belongs to next year.
    work("2026-12-28", 10);
    const year = december().year;
    expect(year).toMatchObject({ year: "2026", hours: 80, gross_cents: 400000, hoursToGoal: 120, checksLeft: 2 });
    expect(year.checks.filter((c) => c.pay_date.startsWith("2026-12"))).toHaveLength(3);
    expect(api["pay.month"]({ person: "a", month: "2027-01" }).year).toMatchObject({ year: "2027", hours: 10, gross_cents: 50000 });
  });
});

describe("someone on a fixed paycheck", () => {
  it("is paid the same take-home on set days of the month", () => {
    api["pay.saveProfile"](hourly({ person: "b", kind: "salaried", rate_cents: null, net_per_check_cents: 250000, rule: "monthdays", anchor: "", lagDays: 0, monthDays: [31, 15] }));
    const m = api["pay.month"]({ person: "b", month: "2026-12" });
    expect(m.paychecks.map((p) => [p.pay_date, p.predicted_net_cents, p.kind])).toEqual([
      ["2026-12-15", 250000, "salaried"],
      ["2026-12-31", 250000, "salaried"],
    ]);
    expect(m.income).toMatchObject({ checks: 2, expected_cents: 500000 });
    expect(m.profile!.schedule.monthDays).toEqual([15, 31]);
    expect(() => api["pay.whatIf"]({ person: "b", hours: 80 })).toThrow("by the hour");
    api["pay.updatePaycheck"]({ person: "b", id: null, period_start: m.paychecks[0].period_start, patch: { actual_net_cents: 251000 } });
    expect(api["pay.month"]({ person: "b", month: "2026-12" }).income.expected_cents).toBe(501000);
  });
});

describe("pay in a setup file", () => {
  const file = {
    pay: {
      a: {
        rates: [{ effective_date: "2026-01-01", rate_cents: 5000 }],
        anchor: "2026-10-19",
        sickHoursPerYear: 40,
        grossGoalCents: 12000000,
        incomeCategory: "Paycheck",
        history,
      },
      b: { rates: [{ effective_date: "2026-01-01", kind: "salaried" as const, net_per_check_cents: 250000 }], rule: "monthdays" as const, monthDays: [15, 31], lagDays: 0 },
    },
  };

  it("loads rates, schedule and known paychecks for both people", () => {
    api["setup.import"](file);
    const a = api["pay.profile"]({ person: "a" })!;
    expect(a.schedule).toMatchObject({ rule: "biweekly", anchor: "2026-10-19", lagDays: 5, grossGoalCents: 12000000, incomeCategoryId: paycheck });
    expect(a.schedule.history).toHaveLength(5);
    expect(api["pay.profile"]({ person: "b" })!.current).toMatchObject({ kind: "salaried", net_per_check_cents: 250000 });
    api["undo.run"]();
    expect(api["pay.profile"]({ person: "a" })).toBeNull();
    expect(api["pay.profile"]({ person: "b" })).toBeNull();
  });

  it("adds a later rate without losing the schedule already there", () => {
    api["setup.import"](file);
    api["setup.import"]({ pay: { a: { rates: [{ effective_date: "2027-01-01", rate_cents: 5500 }] } } });
    const a = api["pay.profile"]({ person: "a" })!;
    expect(a.rates.map((r) => r.rate_cents)).toEqual([5000, 5500]);
    expect(a.schedule.anchor).toBe("2026-10-19");
    expect(a.schedule.history).toHaveLength(5);
  });

  it("loads the example file in docs as written", () => {
    api["setup.import"](JSON.parse(fs.readFileSync("docs/setup.example.json", "utf8")));
    expect(api["pay.profile"]({ person: "a" })!.schedule).toMatchObject({ anchor: "2026-10-19", usualHours: 80 });
    expect(api["pay.profile"]({ person: "b" })!.current.kind).toBe("salaried");
    expect(december().fit).toMatchObject({ n: 3 });
  });

  it("refuses a file whose pay is not valid and changes nothing", () => {
    expect(() => api["setup.import"]({ pay: { a: { rates: [{ effective_date: "2026-01-01", rate_cents: 5000 }], anchor: "2026-10-20" } } })).toThrow("Monday");
    expect(() => api["setup.import"]({ pay: { a: { ...file.pay.a, incomeCategory: "Nope" } } })).toThrow("not a category");
    expect(api["pay.profile"]({ person: "a" })).toBeNull();
  });
});
