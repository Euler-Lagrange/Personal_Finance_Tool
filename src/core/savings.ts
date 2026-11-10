import type { Cents } from "./money";
import { addMonths, daysInMonth, monthOf, type ISODate } from "./dates";

/** A fund's balance: what it started with, plus what was set aside, minus what was paid from it. */
export function fundBalance(openingCents: Cents, inCents: Cents, outCents: Cents): Cents {
  return openingCents + inCents - outCents;
}

/** The starting amount that makes a fund's balance come out at a figure the person typed. */
export function openingFor(balanceCents: Cents, inCents: Cents, outCents: Cents): Cents {
  return balanceCents - inCents + outCents;
}

/** How many months of spending a pot of savings covers, to one decimal. Null when there is no spending to measure against. */
export function runwayMonths(savingsCents: Cents, monthlyCents: Cents): number | null {
  if (monthlyCents <= 0) return null;
  return Math.max(0, Math.round((savingsCents / monthlyCents) * 10) / 10);
}

/** What something that renews every `months` months costs over a year. */
export function yearlyCost(amountCents: Cents, months: number): Cents {
  return Math.round((amountCents * 12) / months);
}

/** A yearly cost spread over the year's paychecks (or months), rounded up so the pot is never short. */
export function perPeriod(yearlyCents: Cents, periodsPerYear: number): Cents {
  return periodsPerYear > 0 ? Math.ceil(yearlyCents / periodsPerYear) : 0;
}

/** The same day `n` months later, pulled back to the month's last day when it has fewer days. */
export function addMonthsToDate(date: ISODate, n: number): ISODate {
  const month = addMonths(monthOf(date), n);
  return `${month}-${String(Math.min(Number(date.slice(8)), daysInMonth(month))).padStart(2, "0")}`;
}

/** One of `parts` equal shares of an amount, to the nearest cent. */
export function evenShare(totalCents: Cents, parts: number): Cents {
  return parts > 0 ? Math.round(totalCents / parts) : 0;
}
