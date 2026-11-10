import { describe, expect, it } from "vitest";
import { formatMoney, moneyInput, parseMoney } from "./money";
import { computeShares, describeSplit, MINE, THEIRS } from "./split";
import { balance, balanceDelta, whoOwes } from "./balance";
import { addDays, addMonths, daysInMonth, isISODate, monthLabel, monthOf, weekday } from "./dates";
import { carryOver, summarize, type BudgetRow } from "./budget";
import { addMonthsToDate, fundBalance, openingFor, perPeriod, runwayMonths, yearlyCost } from "./savings";
import {
  biweeklyPeriods, businessDayOnOrBefore, fitLine, fitPay, grossPay, hoursToGoal, isOutsideKnown, meanAbsError, monthDayPeriods, payPeriods,
  predictNet, predictPaycheck, usBankHolidays,
} from "./pay";

describe("money", () => {
  it("parses what people type", () => {
    expect(parseMoney("12")).toBe(1200);
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("$1,234.56")).toBe(123456);
    expect(parseMoney("-3")).toBe(-300);
    expect(parseMoney("(12.00)")).toBe(-1200);
    expect(parseMoney(".5")).toBe(50);
    expect(parseMoney("0.005")).toBe(1);
    expect(parseMoney("19.999")).toBe(2000);
  });
  it("rejects text that is not an amount", () => {
    for (const bad of ["", "abc", "1.2.3", "12a", "--5", "$"]) expect(parseMoney(bad)).toBeNull();
  });
  it("formats cents", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(-1200)).toBe("-$12.00");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(650, { plus: true })).toBe("+$6.50");
    expect(moneyInput(-1205)).toBe("-12.05");
  });
});

describe("split", () => {
  const seventy = { type: "percent", a: 70 } as const;
  it("rounds A's share and gives B the remainder", () => {
    expect(computeShares(12669, seventy)).toEqual({ a: 8868, b: 3801 });
    expect(computeShares(4800, seventy)).toEqual({ a: 3360, b: 1440 });
    expect(computeShares(2865, seventy)).toEqual({ a: 2006, b: 859 });
    expect(computeShares(1, { type: "percent", a: 50 })).toEqual({ a: 1, b: 0 });
  });
  it("mirrors a purchase when the amount is a refund", () => {
    const buy = computeShares(2865, seventy);
    const refund = computeShares(-2865, seventy);
    expect(refund).toEqual({ a: -buy.a, b: -buy.b });
  });
  it("always adds up to the total", () => {
    for (let total = -500; total <= 500; total += 7) {
      for (const pct of [0, 13.5, 25, 33.33, 50, 70, 100]) {
        const s = computeShares(total, { type: "percent", a: pct });
        expect(s.a + s.b).toBe(total);
      }
    }
  });
  it("handles one-person and fixed splits", () => {
    expect(computeShares(999, MINE)).toEqual({ a: 999, b: 0 });
    expect(computeShares(999, THEIRS)).toEqual({ a: 0, b: 999 });
    expect(computeShares(22326, { type: "fixed", a_cents: 11042 })).toEqual({ a: 11042, b: 11284 });
    expect(() => computeShares(1000, { type: "fixed", a_cents: 1001 })).toThrow();
    expect(() => computeShares(1000, { type: "percent", a: 101 })).toThrow();
  });
  it("describes a split", () => {
    const names = { a: "Alex", b: "Sam" };
    expect(describeSplit(seventy, names)).toBe("70/30");
    expect(describeSplit(MINE, names)).toBe("Alex");
    expect(describeSplit(THEIRS, names)).toBe("Sam");
    expect(describeSplit({ type: "percent", a: 62.5 }, names)).toBe("62.5/37.5");
  });
});

describe("balance", () => {
  const exp = (paid_by: "a" | "b", amount: number, a: number) =>
    ({ kind: "expense", paid_by, amount_cents: amount, a_cents: a, b_cents: amount - a }) as const;
  it("puts the other person's share on the balance", () => {
    expect(balanceDelta(exp("a", 10000, 7000))).toBe(3000);
    expect(balanceDelta(exp("b", 10000, 7000))).toBe(-7000);
  });
  it("clears with a settlement and ignores income", () => {
    const entries = [
      exp("a", 10000, 7000),
      { kind: "settlement", paid_by: "b", amount_cents: 3000, a_cents: 0, b_cents: 0 } as const,
      { kind: "income", paid_by: "a", amount_cents: 500000, a_cents: 500000, b_cents: 0 } as const,
    ];
    expect(balance(entries)).toBe(0);
    expect(balance(entries, -2500)).toBe(-2500);
  });
  it("says who owes whom", () => {
    expect(whoOwes(0)).toBeNull();
    expect(whoOwes(1500)).toEqual({ from: "b", to: "a", amount: 1500 });
    expect(whoOwes(-1500)).toEqual({ from: "a", to: "b", amount: 1500 });
  });
});

describe("dates", () => {
  it("validates and steps dates", () => {
    expect(isISODate("2026-02-28")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(monthOf("2026-12-05")).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(daysInMonth("2028-02")).toBe(29);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekday("2026-11-09")).toBe(1);
    expect(monthLabel("2026-12")).toBe("December 2026");
  });
});

describe("budget", () => {
  const row = (name: string, grp: string, kind: "expense" | "income", planned: number, actual: number, carried = 0): BudgetRow => ({
    carried,
    rollover: carried !== 0,
    category_id: name.length,
    name,
    grp,
    kind,
    icon: null,
    archived: false,
    planned,
    actual,
  });
  it("totals groups, income and what is left", () => {
    const s = summarize(
      [
        row("Housing", "Needs", "expense", 150000, 150000),
        row("Groceries", "Needs", "expense", 60000, 41000),
        row("Hobbies", "Wants", "expense", 20000, 26000),
        row("Savings", "Savings", "expense", 90000, 90000),
        row("Paycheck", "Income", "income", 400000, 410000),
      ],
      ["Needs", "Wants", "Savings"],
    );
    expect(s.groups.map((g) => [g.grp, g.planned, g.actual])).toEqual([
      ["Needs", 210000, 191000],
      ["Wants", 20000, 26000],
      ["Savings", 90000, 90000],
    ]);
    expect(s.groups[0].plannedShare).toBe(52.5);
    expect(s.expenses).toEqual({ planned: 320000, actual: 307000 });
    expect(s.leftToSpend).toBe(13000);
    expect(s.net).toBe(103000);
  });
  it("carries unused money forward and takes overspending off", () => {
    expect(carryOver([])).toBe(0);
    expect(carryOver([{ planned: 10000, actual: 6000 }, { planned: 10000, actual: 13000 }, { planned: 12000, actual: 0 }])).toBe(13000);
    const s = summarize([row("Clothes", "Wants", "expense", 10000, 2500, 4000), row("Dining", "Wants", "expense", 20000, 21000, -3000), row("Pay", "Income", "income", 500000, 0)], ["Wants"]);
    expect(s.carried).toBe(1000);
    expect(s.leftToSpend).toBe(30000 + 1000 - 23500);
    expect(s.groups[0].planned).toBe(30000);
  });
});

describe("pay", () => {
  it("builds biweekly periods paid the following Friday", () => {
    const periods = biweeklyPeriods("2026-10-19", "2026-10-19", 3);
    expect(periods).toEqual([
      { period_start: "2026-10-19", period_end: "2026-11-01", pay_date: "2026-11-06" },
      { period_start: "2026-11-02", period_end: "2026-11-15", pay_date: "2026-11-20" },
      { period_start: "2026-11-16", period_end: "2026-11-29", pay_date: "2026-12-04" },
    ]);
  });
  it("moves a payday off a holiday and finds the period containing a date", () => {
    const holidays = new Set(["2027-01-01"]);
    expect(businessDayOnOrBefore("2027-01-01", holidays)).toBe("2026-12-31");
    const [p] = biweeklyPeriods("2026-10-19", "2026-12-20", 1, { holidays });
    expect(p).toEqual({ period_start: "2026-12-14", period_end: "2026-12-27", pay_date: "2026-12-31" });
    const [earlier] = biweeklyPeriods("2026-10-19", "2026-09-10", 1);
    expect(earlier.period_start).toBe("2026-09-07");
    expect(() => biweeklyPeriods("2026-10-20", "2026-10-20", 1)).toThrow();
  });
  it("fits take-home against gross and predicts", () => {
    const points = [400000, 500000, 600000, 700000, 800000].map((x) => ({ x, y: 0.6 * x + 40000 }));
    const fit = fitLine(points)!;
    expect(fit.slope).toBeCloseTo(0.6, 9);
    expect(fit.intercept).toBeCloseTo(40000, 3);
    expect(predictNet(grossPay(80, 5000), fit)).toBe(280000);
    expect(meanAbsError(points, fit)).toBeLessThan(1e-9);
    expect(fitLine([{ x: 1, y: 1 }])).toBeNull();
  });
  it("pays on set days of the month, moved earlier off weekends", () => {
    // 15 August 2026 is a Saturday; 31 means the last day of the month.
    const periods = monthDayPeriods([15, 31], "2026-08-01", "2026-09-30");
    expect(periods.map((p) => p.pay_date)).toEqual(["2026-08-14", "2026-08-31", "2026-09-15", "2026-09-30"]);
    expect(periods[1]).toEqual({ period_start: "2026-08-16", period_end: "2026-08-31", pay_date: "2026-08-31" });
    // Periods meet end to start with no day missed or counted twice.
    const year = monthDayPeriods([15, 31], "2026-01-01", "2026-12-31", { lagDays: 5 });
    for (let i = 1; i < year.length; i++) expect(year[i].period_start).toBe(new Date(Date.parse(year[i - 1].period_end) + 864e5).toISOString().slice(0, 10));
    expect(monthDayPeriods([30, 31], "2026-02-01", "2026-02-28").map((p) => p.pay_date)).toEqual(["2026-02-27"]);
    expect(monthDayPeriods([], "2026-02-01", "2026-02-28")).toEqual([]);
  });
  it("lists every pay period that touches a range or is paid in it", () => {
    const rule = { rule: "biweekly" as const, anchor: "2026-10-19", lagDays: 5, monthDays: [] };
    const december = payPeriods(rule, "2026-12-01", "2026-12-31", new Set(["2027-01-01"]));
    expect(december.map((p) => p.pay_date)).toEqual(["2026-12-04", "2026-12-18", "2026-12-31", "2027-01-15"]);
    expect(december[0].period_end).toBe("2026-11-29");
    expect(payPeriods({ ...rule, anchor: "" }, "2026-12-01", "2026-12-31")).toEqual([]);
    const firstOfMonth = payPeriods({ ...rule, rule: "monthdays", monthDays: [1], lagDays: 0 }, "2026-12-01", "2026-12-31", new Set(["2027-01-01"]));
    expect(firstOfMonth.map((p) => p.pay_date)).toEqual(["2026-12-01", "2026-12-31"]);
  });
  it("knows the days banks are closed", () => {
    const y2026 = Object.fromEntries(usBankHolidays(2026).map((h) => [h.name, h.date]));
    expect(y2026["Martin Luther King Jr. Day"]).toBe("2026-01-19");
    expect(y2026["Memorial Day"]).toBe("2026-05-25");
    expect(y2026["Thanksgiving"]).toBe("2026-11-26");
    expect(y2026["Independence Day"]).toBe("2026-07-04");
    expect(y2026["Labor Day"]).toBe("2026-09-07");
    expect(y2026["Columbus Day"]).toBe("2026-10-12");
    // Independence Day 2027 is a Sunday, so banks close on the Monday.
    expect(usBankHolidays(2027).find((h) => h.name === "Independence Day")!.date).toBe("2027-07-05");
    expect(usBankHolidays(2027)[0]).toEqual({ date: "2027-01-01", name: "New Year's Day" });
    expect(usBankHolidays(2026)).toHaveLength(11);
  });
  it("learns take-home from known paychecks and keeps predictions sensible", () => {
    const ordinary = [400000, 500000, 600000, 700000, 800000].map((g) => ({ gross_cents: g, net_cents: 0.6 * g + 40000 }));
    const fit = fitPay([...ordinary, { gross_cents: 600000, net_cents: 0.6 * 600000 + 40000 + 25000, no_benefits: true }])!;
    expect(fit.n).toBe(5);
    expect(fit.noBenefitsExtra).toBe(25000);
    expect(predictPaycheck(750000, fit)).toBe(490000);
    expect(predictPaycheck(750000, fit, true)).toBe(515000);
    expect(predictPaycheck(50000, fit)).toBe(50000);
    expect(predictPaycheck(0, fit)).toBe(0);
    expect(isOutsideKnown(350000, fit)).toBe(true);
    expect(isOutsideKnown(820000, fit)).toBe(false);
    expect(fitPay(ordinary.slice(0, 2))).toBeNull();
    expect(fitPay(ordinary)!.noBenefitsExtra).toBeNull();
  });
  it("counts the hours left to a yearly goal", () => {
    expect(hoursToGoal(10000000, 9434400, 4800)).toBe(117.9);
    expect(hoursToGoal(10000000, 10500000, 4800)).toBe(0);
    expect(hoursToGoal(10000000, 0, 0)).toBeNull();
  });
});

describe("savings", () => {
  it("keeps a fund's balance and its starting amount consistent", () => {
    expect(fundBalance(50000, 30000, 12000)).toBe(68000);
    expect(openingFor(68000, 30000, 12000)).toBe(50000);
    expect(fundBalance(openingFor(123456, 999, 111), 999, 111)).toBe(123456);
  });
  it("measures a runway in months of spending", () => {
    expect(runwayMonths(1500000, 400000)).toBe(3.8);
    expect(runwayMonths(0, 400000)).toBe(0);
    expect(runwayMonths(1500000, 0)).toBeNull();
  });
  it("spreads renewals over a year of paychecks without coming up short", () => {
    expect(yearlyCost(12000, 12)).toBe(12000);
    expect(yearlyCost(12000, 24)).toBe(6000);
    expect(yearlyCost(9000, 3)).toBe(36000);
    expect(perPeriod(76780, 26)).toBe(2954);
    expect(perPeriod(76780, 26) * 26).toBeGreaterThanOrEqual(76780);
    expect(perPeriod(76780, 0)).toBe(0);
  });
  it("steps a date by months and stays inside the month", () => {
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2026-11-15", 12)).toBe("2027-11-15");
    expect(addMonthsToDate("2024-02-29", 12)).toBe("2025-02-28");
  });
});
