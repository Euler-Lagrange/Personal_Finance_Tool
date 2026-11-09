import type { Cents } from "./money";

export interface BudgetRow {
  category_id: number;
  name: string;
  grp: string;
  kind: "expense" | "income";
  icon: string | null;
  archived: boolean;
  planned: Cents;
  actual: Cents;
}

export interface GroupSummary {
  grp: string;
  planned: Cents;
  actual: Cents;
  /** Share of planned income this group's plan takes, in percent, or null with no planned income. */
  plannedShare: number | null;
  rows: BudgetRow[];
}

export interface BudgetSummary {
  groups: GroupSummary[];
  income: { planned: Cents; actual: Cents; rows: BudgetRow[] };
  expenses: { planned: Cents; actual: Cents };
  /** Income received minus money spent or set aside, so far this month. */
  net: Cents;
  /** Planned expenses not yet used. Negative when over plan. */
  leftToSpend: Cents;
}

const sum = (rows: BudgetRow[], key: "planned" | "actual") => rows.reduce((t, r) => t + r[key], 0);

/** Group budget rows the way the monthly sheet does: expense groups in the given order, then income. */
export function summarize(rows: BudgetRow[], groupOrder: string[]): BudgetSummary {
  const incomeRows = rows.filter((r) => r.kind === "income");
  const expenseRows = rows.filter((r) => r.kind === "expense");
  const income = { planned: sum(incomeRows, "planned"), actual: sum(incomeRows, "actual"), rows: incomeRows };
  const names = [...groupOrder];
  for (const r of expenseRows) if (!names.includes(r.grp)) names.push(r.grp);
  const groups = names
    .map((grp) => {
      const groupRows = expenseRows.filter((r) => r.grp === grp);
      const planned = sum(groupRows, "planned");
      return {
        grp,
        planned,
        actual: sum(groupRows, "actual"),
        plannedShare: income.planned > 0 ? Math.round((planned / income.planned) * 1000) / 10 : null,
        rows: groupRows,
      };
    })
    .filter((g) => g.rows.length > 0 || groupOrder.includes(g.grp));
  const expenses = { planned: sum(expenseRows, "planned"), actual: sum(expenseRows, "actual") };
  return { groups, income, expenses, net: income.actual - expenses.actual, leftToSpend: expenses.planned - expenses.actual };
}
