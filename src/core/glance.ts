import { whoOwes } from "./balance";
import { monthLabel, shortDate } from "./dates";
import { formatMoney, type Cents } from "./money";
import type { Person } from "./split";

/** Everything on the phone glance page: a read-only picture of the month, saved beside the backups. */
export interface GlanceData {
  /** When it was written, already in words. */
  asOf: string;
  month: string;
  names: Record<Person, string>;
  views: { label: string; leftToSpend: Cents; spent: Cents; available: Cents; income: Cents; groups: { grp: string; actual: Cents; planned: Cents }[] }[];
  /** Positive means B owes A. Null when finances are merged and there is no balance to keep. */
  balance: Cents | null;
  billsDue: { name: string; date: string; cents: Cents }[];
  paychecks: { name: string; date: string; cents: Cents | null }[];
  funds: { name: string; cents: Cents; target: Cents | null }[];
  recent: { date: string; description: string; cents: Cents; income: boolean }[];
}

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** How full a bar is, from 0 to 100. Over the total still reads as full. */
export function barPercent(used: Cents, total: Cents): number {
  if (total <= 0) return used > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

const bar = (used: Cents, total: Cents) => `<div class="bar"><span class="${used > total ? "over" : ""}" style="width:${barPercent(used, total)}%"></span></div>`;
const rows = (items: [string, string][]) => items.map(([label, value]) => `<div class="row"><span>${label}</span><span class="num">${value}</span></div>`).join("\n");

/** The glance page as one self-contained HTML document, sized to read on a phone without zooming. */
export function glanceHtml(data: GlanceData): string {
  const owes = data.balance === null ? null : whoOwes(data.balance);
  const views = data.views
    .map(
      (v) => `<section>
<h2>${esc(v.label)}</h2>
<p class="big${v.leftToSpend < 0 ? " neg" : ""}">${formatMoney(v.leftToSpend)}</p>
<p class="muted">left to spend. ${formatMoney(v.spent)} used of ${formatMoney(v.available)}. Income so far ${formatMoney(v.income)}.</p>
${bar(v.spent, v.available)}
${v.groups.map((g) => `<div class="row"><span>${esc(g.grp)}</span><span class="num">${formatMoney(g.actual)} / ${formatMoney(g.planned)}</span></div>${bar(g.actual, g.planned)}`).join("\n")}
</section>`,
    )
    .join("\n");
  const list = (title: string, body: string, empty: string) => `<section><h2>${title}</h2>${body || `<p class="muted">${empty}</p>`}</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Finance at a glance</title>
<style>
body { font: 15px/1.4 "Segoe UI", system-ui, sans-serif; color: #1f2933; margin: 0; padding: 0 16px; }
h1 { font-size: 20px; margin: 0; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #5f6c7b; margin: 0 0 6px; }
section { border: 1px solid #d5dbe3; border-radius: 12px; padding: 12px 14px; margin-top: 12px; break-inside: avoid; }
.muted { color: #5f6c7b; font-size: 13px; margin: 2px 0 8px; } .big { font-size: 30px; font-weight: 700; margin: 0; } .neg { color: #b42318; }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; } .num { white-space: nowrap; font-variant-numeric: tabular-nums; }
.bar { height: 6px; border-radius: 3px; background: #e8ecf1; margin: 2px 0 8px; overflow: hidden; } .bar span { display: block; height: 100%; background: #3b6fd4; } .bar span.over { background: #b42318; }
</style></head><body>
<h1>${monthLabel(data.month)}</h1>
<p class="muted">As of ${esc(data.asOf)}. Read-only: open the app on a PC to change anything.</p>
${views}
${data.balance === null ? "" : `<section><h2>Between you</h2><p class="row"><strong>${owes ? `${esc(data.names[owes.from])} owes ${esc(data.names[owes.to])} ${formatMoney(owes.amount)}` : "All square"}</strong></p></section>`}
${list("Bills due this week", rows(data.billsDue.map((b) => [`${esc(b.name)} <span class="muted">${shortDate(b.date)}</span>`, formatMoney(b.cents)])), "Nothing due in the next seven days.")}
${data.paychecks.length > 0 ? list("Next paycheck", rows(data.paychecks.map((p) => [`${esc(p.name)} <span class="muted">${shortDate(p.date)}</span>`, p.cents === null ? "–" : formatMoney(p.cents)])), "") : ""}
${data.funds.length > 0 ? list("Funds", data.funds.map((f) => `<div class="row"><span>${esc(f.name)}</span><span class="num">${formatMoney(f.cents)}${f.target !== null ? ` of ${formatMoney(f.target)}` : ""}</span></div>${f.target !== null ? bar(Math.max(0, f.cents), f.target) : ""}`).join("\n"), "") : ""}
${list("Latest entries", rows(data.recent.map((e) => [`${esc(e.description)} <span class="muted">${shortDate(e.date)}</span>`, formatMoney(e.cents, { plus: e.income })])), "Nothing entered this month yet.")}
</body></html>`;
}
