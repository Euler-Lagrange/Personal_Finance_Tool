import type { Cents } from "./money";
import { addDays, weekday, type ISODate } from "./dates";

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
