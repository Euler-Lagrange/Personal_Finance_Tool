import { monthLabel, shortDate } from "./dates";
import { formatMoney, type Cents } from "./money";
import { other, type Person } from "./split";

export interface StatementLine {
  date: string;
  description: string;
  total: Cents;
  /** The share of the person the statement is for. */
  share: Cents;
  paid_by: Person;
}

export interface StatementBudgetGroup {
  grp: string;
  planned: Cents;
  actual: Cents;
  rows: { name: string; planned: Cents; actual: Cents }[];
}

/** Everything one person needs to see for a month. Balances use the app's sign: positive means B owes A. */
export interface StatementData {
  month: string;
  person: Person;
  names: Record<Person, string>;
  openingBalance: Cents;
  closingBalance: Cents;
  bills: StatementLine[];
  purchases: StatementLine[];
  settlements: { date: string; from: Person; amount: Cents }[];
  budget: { groups: StatementBudgetGroup[]; income: { planned: Cents; actual: Cents }; expenses: { planned: Cents; actual: Cents } };
}

/** "You owe Alex $12.00", "Alex owes you $12.00" or "You are all square", from the reader's side. */
export function owesSentence(balance: Cents, person: Person, names: Record<Person, string>): string {
  if (balance === 0) return "You are all square";
  const ower: Person = balance > 0 ? "b" : "a";
  const amount = formatMoney(Math.abs(balance));
  return ower === person ? `You owe ${names[other(person)]} ${amount}` : `${names[other(person)]} owes you ${amount}`;
}

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function lineTable(title: string, lines: StatementLine[], data: StatementData, empty: string): string {
  if (lines.length === 0) return `<h2>${title}</h2><p class="muted">${empty}</p>`;
  const total = lines.reduce((t, l) => t + l.total, 0);
  const share = lines.reduce((t, l) => t + l.share, 0);
  return `<h2>${title}</h2>
<table>
<thead><tr><th>Date</th><th>What</th><th>Paid by</th><th class="num">Total</th><th class="num">Your share</th></tr></thead>
<tbody>
${lines.map((l) => `<tr><td>${shortDate(l.date)}</td><td>${esc(l.description)}</td><td>${esc(data.names[l.paid_by])}</td><td class="num">${formatMoney(l.total)}</td><td class="num">${formatMoney(l.share)}</td></tr>`).join("\n")}
</tbody>
<tfoot><tr><td colspan="3">Total</td><td class="num">${formatMoney(total)}</td><td class="num">${formatMoney(share)}</td></tr></tfoot>
</table>`;
}

/** A self-contained, print-friendly page. Plain light colours so it reads the same on any phone. */
export function statementHtml(data: StatementData): string {
  const { names, person } = data;
  const settlements =
    data.settlements.length === 0
      ? `<p class="muted">No settlements this month.</p>`
      : `<table><thead><tr><th>Date</th><th>From</th><th>To</th><th class="num">Amount</th></tr></thead><tbody>
${data.settlements.map((s) => `<tr><td>${shortDate(s.date)}</td><td>${esc(names[s.from])}</td><td>${esc(names[other(s.from)])}</td><td class="num">${formatMoney(s.amount)}</td></tr>`).join("\n")}
</tbody></table>`;
  const budgetRows = data.budget.groups
    .map(
      (g) => `<tr class="group"><td>${esc(g.grp)}</td><td class="num">${formatMoney(g.planned)}</td><td class="num">${formatMoney(g.actual)}</td><td class="num">${formatMoney(g.planned - g.actual)}</td></tr>
${g.rows.map((r) => `<tr><td class="indent">${esc(r.name)}</td><td class="num">${formatMoney(r.planned)}</td><td class="num">${formatMoney(r.actual)}</td><td class="num">${formatMoney(r.planned - r.actual)}</td></tr>`).join("\n")}`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(names[person])}, ${monthLabel(data.month)}</title>
<style>
body { font: 13px/1.45 "Segoe UI", system-ui, sans-serif; color: #1f2933; margin: 32px; }
h1 { font-size: 22px; margin: 0 0 2px; } h2 { font-size: 15px; margin: 26px 0 8px; break-after: avoid; }
thead { display: table-header-group; } tr { break-inside: avoid; }
.muted { color: #5f6c7b; } .summary { margin: 14px 0; padding: 14px 16px; border: 1px solid #d5dbe3; border-radius: 10px; }
.summary strong { font-size: 20px; display: block; }
table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 11px; color: #5f6c7b; border-bottom: 1px solid #d5dbe3; padding: 6px 8px; }
td { padding: 6px 8px; border-bottom: 1px solid #e8ecf1; } .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tfoot td, tr.group td { font-weight: 600; } td.indent { padding-left: 22px; }
</style></head><body>
<h1>${esc(names[person])}: ${monthLabel(data.month)}</h1>
<p class="muted">Shared costs with ${esc(names[other(person)])}, and your budget for the month.</p>
<div class="summary">
<span class="muted">At the end of the month</span>
<strong>${esc(owesSentence(data.closingBalance, person, names))}</strong>
<span class="muted">At the start of the month: ${esc(owesSentence(data.openingBalance, person, names))}.</span>
</div>
${lineTable("Shared bills", data.bills, data, "No shared bills this month.")}
${lineTable("Other shared purchases", data.purchases, data, "No other shared purchases this month.")}
<h2>Settlements</h2>
${settlements}
<h2>Your budget</h2>
<table>
<thead><tr><th>Category</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Left</th></tr></thead>
<tbody>
${budgetRows}
</tbody>
<tfoot>
<tr><td>Spent and set aside</td><td class="num">${formatMoney(data.budget.expenses.planned)}</td><td class="num">${formatMoney(data.budget.expenses.actual)}</td><td class="num">${formatMoney(data.budget.expenses.planned - data.budget.expenses.actual)}</td></tr>
<tr><td>Income</td><td class="num">${formatMoney(data.budget.income.planned)}</td><td class="num">${formatMoney(data.budget.income.actual)}</td><td class="num"></td></tr>
</tfoot>
</table>
</body></html>`;
}
