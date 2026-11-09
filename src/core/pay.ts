import type { Cents } from "./money";
import { addDays, addMonths, daysInMonth, monthOf, weekday, type ISODate } from "./dates";

export interface PayPeriod {
  period_start: ISODate;
  period_end: ISODate;
  pay_date: ISODate;
}

/** The latest business day on or before `date`, skipping weekends and the given holidays. */
export function businessDayOnOrBefore(date: ISODate, holidays: ReadonlySet<ISODate> = new Set()): ISODate {
  let d = date;
  while (weekday(d) === 0 || weekday(d) === 6 || holidays.has(d)) d = addDays(d, -1);
  return d;
}

/**
 * Biweekly pay periods: two Monday-to-Sunday weeks, paid `lagDays` after the period ends
 * (5 = the following Friday), moved earlier when that day is a weekend or holiday.
 * `anchorStart` is the Monday that starts any one real period.
 */
export function biweeklyPeriods(
  anchorStart: ISODate,
  from: ISODate,
  count: number,
  opts: { lagDays?: number; holidays?: ReadonlySet<ISODate> } = {},
): PayPeriod[] {
  if (weekday(anchorStart) !== 1) throw new Error("A pay period must start on a Monday");
  const lag = opts.lagDays ?? 5;
  const periods: PayPeriod[] = [];
  let start = anchorStart;
  while (addDays(start, 13) < from) start = addDays(start, 14);
  while (addDays(start, -1) >= from) start = addDays(start, -14);
  for (let i = 0; i < count; i++) {
    const end = addDays(start, 13);
    periods.push({ period_start: start, period_end: end, pay_date: businessDayOnOrBefore(addDays(end, lag), opts.holidays) });
    start = addDays(start, 14);
  }
  return periods;
}

/**
 * Paydays on set days of the month (31 means the last day), moved earlier off weekends and
 * holidays. Each pay period runs up to `lagDays` before its payday and starts the day after
 * the one before it ends. Returns the periods that touch `from`..`to` or are paid within it.
 */
export function monthDayPeriods(
  days: number[],
  from: ISODate,
  to: ISODate,
  opts: { lagDays?: number; holidays?: ReadonlySet<ISODate> } = {},
): PayPeriod[] {
  const wanted = [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 31).sort((x, y) => x - y);
  if (wanted.length === 0) return [];
  const lag = opts.lagDays ?? 0;
  const nominal: ISODate[] = [];
  const last = addMonths(monthOf(to), 2);
  for (let month = addMonths(monthOf(from), -2); month <= last; month = addMonths(month, 1)) {
    for (const d of wanted) {
      const date = `${month}-${String(Math.min(d, daysInMonth(month))).padStart(2, "0")}`;
      if (nominal.at(-1) !== date) nominal.push(date);
    }
  }
  const periods: PayPeriod[] = [];
  for (let i = 1; i < nominal.length; i++) {
    periods.push({
      period_start: addDays(nominal[i - 1], 1 - lag),
      period_end: addDays(nominal[i], -lag),
      pay_date: businessDayOnOrBefore(nominal[i], opts.holidays),
    });
  }
  return periods.filter((p) => touches(p, from, to));
}

const touches = (p: PayPeriod, from: ISODate, to: ISODate) => (p.period_end >= from && p.period_start <= to) || (p.pay_date >= from && p.pay_date <= to);

/** How someone is paid: every two weeks from an anchor Monday, or on set days of the month. */
export interface PayRule {
  rule: "biweekly" | "monthdays";
  anchor: ISODate;
  lagDays: number;
  monthDays: number[];
}

/** Every pay period that touches `from`..`to` or is paid within it, in order. */
export function payPeriods(rule: PayRule, from: ISODate, to: ISODate, holidays: ReadonlySet<ISODate> = new Set()): PayPeriod[] {
  if (rule.rule === "monthdays") return monthDayPeriods(rule.monthDays, from, to, { lagDays: rule.lagDays, holidays });
  if (!rule.anchor || to < from) return [];
  const first = addDays(from, -rule.lagDays);
  const count = Math.ceil((Date.parse(to) - Date.parse(first)) / (14 * 864e5)) + 2;
  return biweeklyPeriods(rule.anchor, first, count, { lagDays: rule.lagDays, holidays }).filter((p) => touches(p, from, to));
}

const nthWeekday = (year: number, month: number, dow: number, n: number): ISODate => {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  return addDays(first, ((dow - weekday(first) + 7) % 7) + 7 * (n - 1));
};
const lastWeekday = (year: number, month: number, dow: number): ISODate => {
  const month7 = `${year}-${String(month).padStart(2, "0")}`;
  const last = `${month7}-${String(daysInMonth(month7)).padStart(2, "0")}`;
  return addDays(last, -((weekday(last) - dow + 7) % 7));
};

/**
 * Days United States banks are closed in a year, when a direct deposit cannot arrive. A holiday
 * on a Sunday is kept the next Monday; one on a Saturday closes no weekday.
 */
export function usBankHolidays(year: number): { date: ISODate; name: string }[] {
  const fixed = (month: number, day: number, name: string) => {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { date: weekday(date) === 0 ? addDays(date, 1) : date, name };
  };
  return [
    fixed(1, 1, "New Year's Day"),
    { date: nthWeekday(year, 1, 1, 3), name: "Martin Luther King Jr. Day" },
    { date: nthWeekday(year, 2, 1, 3), name: "Presidents' Day" },
    { date: lastWeekday(year, 5, 1), name: "Memorial Day" },
    fixed(6, 19, "Juneteenth"),
    fixed(7, 4, "Independence Day"),
    { date: nthWeekday(year, 9, 1, 1), name: "Labor Day" },
    { date: nthWeekday(year, 10, 1, 2), name: "Columbus Day" },
    fixed(11, 11, "Veterans Day"),
    { date: nthWeekday(year, 11, 4, 4), name: "Thanksgiving" },
    fixed(12, 25, "Christmas Day"),
  ];
}

/** Gross pay at straight time: hours times the hourly rate, overtime included at the same rate. */
export function grossPay(hours: number, rateCents: Cents): Cents {
  return Math.round(hours * rateCents);
}

export interface Point {
  x: number;
  y: number;
}

export interface LineFit {
  slope: number;
  intercept: number;
  n: number;
}

/** Least-squares straight line through known paychecks (x = gross, y = take-home). */
export function fitLine(points: Point[]): LineFit | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((t, p) => t + p.x, 0) / n;
  const my = points.reduce((t, p) => t + p.y, 0) / n;
  const sxx = points.reduce((t, p) => t + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = points.reduce((t, p) => t + (p.x - mx) * (p.y - my), 0);
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, n };
}

export function predictNet(grossCents: Cents, fit: LineFit): Cents {
  return Math.round(fit.slope * grossCents + fit.intercept);
}

/** Average size of the miss, as a fraction of actual take-home (0.01 = 1%). */
export function meanAbsError(points: Point[], fit: LineFit): number {
  if (points.length === 0) return 0;
  return points.reduce((t, p) => t + Math.abs((fit.slope * p.x + fit.intercept) / p.y - 1), 0) / points.length;
}

/** A paycheck whose gross and take-home are both known. */
export interface KnownPaycheck {
  gross_cents: Cents;
  net_cents: Cents;
  /** No benefits were taken out of this one, so it brought home more than usual. */
  no_benefits?: boolean;
}

export interface PayFit {
  line: LineFit;
  /** How much more a paycheck with no benefits taken out brings home. Null until one is known. */
  noBenefitsExtra: Cents | null;
  /** How many ordinary known paychecks the line rests on. */
  n: number;
  /** Average miss on those paychecks (0.01 = 1%). */
  error: number;
  /** The smallest and largest gross among them. A prediction far outside is a guess. */
  minGross: Cents;
  maxGross: Cents;
}

/**
 * Learns take-home from gross over known paychecks. Ordinary paychecks set the line; ones with no
 * benefits taken out only set how much extra such a paycheck brings. Needs three ordinary ones.
 */
export function fitPay(known: KnownPaycheck[]): PayFit | null {
  const usable = known.filter((k) => k.gross_cents > 0 && k.net_cents > 0);
  const ordinary = usable.filter((k) => !k.no_benefits).map((k) => ({ x: k.gross_cents, y: k.net_cents }));
  if (ordinary.length < 3) return null;
  const line = fitLine(ordinary);
  if (!line) return null;
  const special = usable.filter((k) => k.no_benefits);
  const extra = special.length > 0 ? Math.round(special.reduce((t, k) => t + k.net_cents - predictNet(k.gross_cents, line), 0) / special.length) : null;
  return {
    line,
    noBenefitsExtra: extra === null ? null : Math.max(0, extra),
    n: ordinary.length,
    error: meanAbsError(ordinary, line),
    minGross: Math.min(...ordinary.map((p) => p.x)),
    maxGross: Math.max(...ordinary.map((p) => p.x)),
  };
}

/** Predicted take-home for a gross amount. Never below zero or above the gross itself. */
export function predictPaycheck(grossCents: Cents, fit: PayFit, noBenefits = false): Cents {
  if (grossCents <= 0) return 0;
  const net = predictNet(grossCents, fit.line) + (noBenefits ? (fit.noBenefitsExtra ?? 0) : 0);
  return Math.max(0, Math.min(grossCents, net));
}

/** True when a gross amount is more than a tenth outside the known paychecks. */
export function isOutsideKnown(grossCents: Cents, fit: PayFit): boolean {
  return grossCents < fit.minGross * 0.9 || grossCents > fit.maxGross * 1.1;
}

/** Hours still to work at a rate to reach a yearly gross goal, to a tenth of an hour. */
export function hoursToGoal(goalCents: Cents, grossSoFarCents: Cents, rateCents: Cents): number | null {
  if (rateCents <= 0) return null;
  return Math.max(0, Math.ceil(((goalCents - grossSoFarCents) / rateCents) * 10) / 10);
}
