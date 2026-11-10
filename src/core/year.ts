import type { Cents } from "./money";

/** One category's year: twelve monthly amounts, January first. */
export interface YearRow {
  category_id: number;
  name: string;
  grp: string;
  kind: "expense" | "income";
  monthly: Cents[];
}

export interface YearLine {
  monthly: Cents[];
  total: Cents;
  /** The total spread over the months that have any entries, so a year in progress is not watered down. */
  average: Cents;
}

export interface YearSummary {
  groups: (YearLine & { grp: string; rows: (YearRow & YearLine)[] })[];
  income: YearLine & { rows: (YearRow & YearLine)[] };
  expenses: YearLine;
  /** Income minus expenses, month by month. */
  net: YearLine;
}

const zeros = () => Array.from({ length: 12 }, () => 0);

function line(monthly: Cents[], monthsCounted: number): YearLine {
  const total = monthly.reduce((t, c) => t + c, 0);
  return { monthly, total, average: monthsCounted > 0 ? Math.round(total / monthsCounted) : 0 };
}

function addUp(rows: { monthly: Cents[] }[], monthsCounted: number): YearLine {
  const monthly = zeros();
  for (const r of rows) r.monthly.forEach((c, i) => (monthly[i] += c));
  return line(monthly, monthsCounted);
}

/** Group a year of category rows the way the budget does: expense groups in the given order, then income, then what is left. */
export function summarizeYear(rows: YearRow[], groupOrder: string[], monthsCounted: number): YearSummary {
  const withTotals = rows.map((r) => ({ ...r, ...line(r.monthly, monthsCounted) }));
  const expenseRows = withTotals.filter((r) => r.kind === "expense");
  const names = [...groupOrder, ...new Set(expenseRows.map((r) => r.grp).filter((g) => !groupOrder.includes(g)))];
  const groups = names
    .map((grp) => {
      const inGroup = expenseRows.filter((r) => r.grp === grp);
      return { grp, rows: inGroup, ...addUp(inGroup, monthsCounted) };
    })
    .filter((g) => g.rows.length > 0);
  const incomeRows = withTotals.filter((r) => r.kind === "income");
  const income = { rows: incomeRows, ...addUp(incomeRows, monthsCounted) };
  const expenses = addUp(expenseRows, monthsCounted);
  return { groups, income, expenses, net: line(income.monthly.map((c, i) => c - expenses.monthly[i]), monthsCounted) };
}
