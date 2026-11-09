import type { Cents } from "./money";
import type { Person } from "./split";

export type EntryKind = "expense" | "income" | "settlement";

export interface BalanceEntry {
  kind: EntryKind;
  paid_by: Person;
  amount_cents: Cents;
  a_cents: Cents;
  b_cents: Cents;
}

/**
 * How one entry moves the balance between the two people.
 * Positive means B owes A more; negative means A owes B more.
 * - An expense paid by one person puts the other person's share on the balance.
 * - A settlement is money sent from `paid_by` to the other person.
 * - Income never moves the balance.
 */
export function balanceDelta(e: BalanceEntry): Cents {
  if (e.kind === "expense") return e.paid_by === "a" ? e.b_cents : -e.a_cents;
  if (e.kind === "settlement") return e.paid_by === "a" ? e.amount_cents : -e.amount_cents;
  return 0;
}

export function balance(entries: Iterable<BalanceEntry>, opening: Cents = 0): Cents {
  let total = opening;
  for (const e of entries) total += balanceDelta(e);
  return total;
}

/** "Sam owes Alex" style sentence parts for the current balance. */
export function whoOwes(cents: Cents): { from: Person; to: Person; amount: Cents } | null {
  if (cents === 0) return null;
  return cents > 0 ? { from: "b", to: "a", amount: cents } : { from: "a", to: "b", amount: -cents };
}
