/** All money in the app is whole cents. */
export type Cents = number;

/** Round to the nearest integer, halves away from zero, so a refund mirrors its purchase. */
export function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * Parse what a person types into cents. Accepts "12", "12.5", "$1,234.56", "-3", "(12.00)".
 * Returns null when the text is not an amount.
 */
export function parseMoney(input: string): Cents | null {
  let text = input.trim();
  if (text === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[$,\s]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const padded = (frac + "000").slice(0, 3);
  let cents = Number(whole || "0") * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** "$1,234.56", "-$12.00". */
export function formatMoney(cents: Cents, opts: { plus?: boolean; whole?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = opts.whole ? "" : "." + String(abs % 100).padStart(2, "0");
  const sign = cents < 0 ? "-" : opts.plus && cents > 0 ? "+" : "";
  return `${sign}$${dollars}${rest}`;
}

/** Plain "1234.56" for putting an amount back into an input. */
export function moneyInput(cents: Cents): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
