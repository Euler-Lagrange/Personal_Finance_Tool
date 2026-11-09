import { describe, expect, it } from "vitest";
import { formatMoney, moneyInput, parseMoney } from "./money";
import { computeShares, describeSplit, MINE, THEIRS } from "./split";
import { balance, balanceDelta, whoOwes } from "./balance";
import { addDays, addMonths, daysInMonth, isISODate, monthLabel, monthOf, weekday } from "./dates";
import { summarize, type BudgetRow } from "./budget";
import { biweeklyPeriods, businessDayOnOrBefore, fitLine, grossPay, meanAbsError, predictNet } from "./pay";

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
  const row = (name: string, grp: string, kind: "expense" | "income", planned: number, actual: number): BudgetRow => ({
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
});
