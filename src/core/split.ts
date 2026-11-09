import type { Cents } from "./money";

/** The two people in the household. Display names live in settings. */
export type Person = "a" | "b";
export const other = (p: Person): Person => (p === "a" ? "b" : "a");

/**
 * How a shared amount is divided.
 * - percent: person A carries `a` percent (0 to 100, decimals allowed), B the rest.
 * - fixed: person A carries exactly `a_cents`, B the rest.
 */
export type SplitSpec = { type: "percent"; a: number } | { type: "fixed"; a_cents: Cents };

export interface Shares {
  a: Cents;
  b: Cents;
}

export const MINE: SplitSpec = { type: "percent", a: 100 };
export const THEIRS: SplitSpec = { type: "percent", a: 0 };

export function isValidSplit(spec: SplitSpec): boolean {
  if (spec.type === "percent") return Number.isFinite(spec.a) && spec.a >= 0 && spec.a <= 100;
  return Number.isInteger(spec.a_cents);
}

/**
 * Person A's share is rounded to the cent (halves away from zero) and B gets the remainder,
 * so the two shares always add up to the total and a refund mirrors its purchase.
 */
export function computeShares(total: Cents, spec: SplitSpec): Shares {
  if (!Number.isInteger(total)) throw new Error("Amount must be whole cents");
  if (!isValidSplit(spec)) throw new Error("Invalid split");
  if (spec.type === "fixed") {
    const a = spec.a_cents;
    if (total >= 0 ? a < 0 || a > total : a > 0 || a < total) {
      throw new Error("A fixed share cannot be larger than the amount");
    }
    return { a, b: total - a };
  }
  const basisPoints = Math.round(spec.a * 100);
  const abs = Math.abs(total);
  const aAbs = Math.floor((abs * basisPoints + 5000) / 10000);
  const a = total < 0 ? -aAbs : aAbs;
  return { a, b: total - a };
}

export function sameSplit(x: SplitSpec, y: SplitSpec): boolean {
  if (x.type !== y.type) return false;
  return x.type === "percent" ? x.a === (y as typeof x).a : x.a_cents === (y as typeof x).a_cents;
}

/** Short label such as "70/30", or the person's name when one person carries it all. */
export function describeSplit(spec: SplitSpec, names: Record<Person, string>): string {
  if (spec.type === "fixed") return "Fixed amounts";
  if (spec.a === 100) return names.a;
  if (spec.a === 0) return names.b;
  const trim = (n: number) => String(Math.round(n * 100) / 100);
  return `${trim(spec.a)}/${trim(100 - spec.a)}`;
}
