import type { CoreApi } from "./api";
import { addDays, addMonths, monthOf, toISO, weekday } from "../core/dates";

/** Made-up household used for screenshots and for trying the app. Never real data. */
export function loadDemo(api: CoreApi, today: Date = new Date()): void {
  const month = monthOf(toISO(today));
  const day = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  api["setup.import"]({
    people: { a: "Alex", b: "Sam" },
    defaultSplitA: 60,
    presets: [
      { label: "60/40", a: 60 },
      { label: "50/50", a: 50 },
      { label: "Alex", a: 100 },
      { label: "Sam", a: 0 },
    ],
    targets: { a: { Needs: 50, Wants: 20, Savings: 30 }, b: { Needs: 55, Wants: 20, Savings: 25 } },
    openingBalanceCents: 4250,
    budget: {
      month: addMonths(month, -1),
      a: { Housing: 96000, Utilities: 15000, "Internet and phone": 9000, Insurance: 11000, Groceries: 42000, Transport: 12000, "Dining out": 18000, Hobbies: 15000, Subscriptions: 4500, Savings: 90000, "Sinking funds": 20000, Paycheck: 420000 },
      b: { Housing: 64000, Utilities: 10000, "Internet and phone": 6000, Insurance: 9000, Groceries: 28000, Transport: 9000, "Dining out": 12000, Hobbies: 8000, Gifts: 5000, Savings: 50000, Paycheck: 280000 },
    },
  });
  const cat = new Map(api["categories.list"]().map((c) => [c.name, c.id]));
  const add = (d: number, description: string, amount: number, category: string, paid_by: "a" | "b" = "a", a?: number, kind: "expense" | "income" = "expense") =>
    api["entries.create"]({
      date: day(d),
      description,
      amount_cents: amount,
      kind,
      category_id: cat.get(category)!,
      paid_by,
      split: a === undefined ? undefined : { type: "percent", a },
    });
  // Bills started last month, so this month shows them created automatically and one that changed.
  const lastMonth = addMonths(month, -1);
  const bill = (name: string, category: string, due_day: number, amount_cents: number, a?: number) =>
    api["bills.create"]({ name, category_id: cat.get(category)!, due_day, amount_cents, paid_by: "a", split: a === undefined ? { type: "default" } : { type: "percent", a }, month: lastMonth });
  const mortgage = bill("Mortgage", "Housing", 1, 160000);
  bill("Fiber internet", "Internet and phone", 3, 7500);
  const power = bill("City Power", "Utilities", 6, 10990);
  bill("Car insurance", "Insurance", 8, 14200, 50);
  bill("Streaming bundle", "Subscriptions", 9, 2299);
  bill("Water", "Utilities", 21, 0);
  const rolled = api["bills.list"]({ month, today: toISO(today) });
  api["bills.setMonthAmount"]({ id: power, month, amount_cents: 11840 });
  api["entries.setSeen"]({ id: rolled.rows.find((r) => r.id === mortgage)!.entry!.id, seen: true });

  add(1, "Paycheck", 212000, "Paycheck", "a", undefined, "income");
  add(2, "Paycheck", 141000, "Paycheck", "b", undefined, "income");
  add(2, "Corner Market", 8431, "Groceries");
  add(4, "Noodle House", 4680, "Dining out", "b");
  add(5, "Board game cafe", 3200, "Hobbies", "a", 100);
  add(7, "Farm stand", 2650, "Groceries", "b");
  add(8, "Transit pass", 6000, "Transport", "a", 100);
  add(9, "Birthday present", 4500, "Gifts", "b", 0);
  add(1, "Transfer to savings", 90000, "Savings", "a", 100);
  add(2, "Transfer to savings", 50000, "Savings", "b", 0);
  api["entries.create"]({ date: day(5), description: "Settle up", amount_cents: 10000, kind: "settlement", category_id: null, paid_by: "b" });
  loadDemoPay(api, toISO(today));
  loadDemoSavings(api, toISO(today), cat);
}

/** Two funds, a purchase paid from one of them, and a few things that renew once a year. */
function loadDemoSavings(api: CoreApi, today: string, cat: Map<string, number>): void {
  api["funds.create"]({ name: "Emergency fund", owner: "hh", target_cents: 1500000, category_id: cat.get("Savings")!, emergency: true, balance_cents: 920000 });
  const repairs = api["funds.create"]({ name: "Repairs and upkeep", owner: "hh", target_cents: 500000, category_id: cat.get("Sinking funds")!, emergency: false, balance_cents: 185000 });
  const month = monthOf(today);
  api["entries.create"]({ date: `${month}-03`, description: "Into the repairs fund", amount_cents: 20000, kind: "expense", category_id: cat.get("Sinking funds")!, paid_by: "a", split: { type: "percent", a: 100 } });
  api["entries.create"]({ date: `${month}-06`, description: "Gutter repair", amount_cents: 18500, kind: "expense", category_id: cat.get("Housing")!, paid_by: "a", paid_from_fund: repairs });
  const renewal = (name: string, category: string, days: number, amount_cents: number, months = 12) =>
    api["renewals.create"]({ name, category_id: cat.get(category)!, months, next_date: addDays(today, days), amount_cents, paid_by: "a", split: { type: "default" }, fund_id: null });
  renewal("Password manager", "Subscriptions", 6, 3600);
  renewal("Car registration", "Transport", 95, 12800);
  renewal("Domain name", "Subscriptions", 210, 1800);
  renewal("Boiler service", "Housing", 150, 14000, 24);
}

/** Alex is paid by the hour every two weeks; Sam gets the same paycheck twice a month. */
function loadDemoPay(api: CoreApi, today: string): void {
  const thisMonday = addDays(today, -((weekday(today) + 6) % 7));
  api["setup.import"]({
    pay: {
      a: {
        rates: [{ effective_date: `${Number(today.slice(0, 4)) - 1}-01-01`, rate_cents: 4800 }],
        anchor: addDays(thisMonday, -56),
        sickHoursPerYear: 40,
        usualHours: 80,
        grossGoalCents: 10000000,
        incomeCategory: "Paycheck",
        history: [
          [345600, 196120], [364800, 205410], [374400, 210380], [384000, 214700], [384000, 215190], [393600, 219640],
          [403200, 224310], [412800, 229480], [432000, 238260], [384000, 241900, 1],
        ].map(([gross_cents, net_cents, special]) => ({ gross_cents, net_cents, ...(special ? { no_benefits: true } : {}) })),
      },
      b: { rates: [{ effective_date: `${Number(today.slice(0, 4)) - 1}-01-01`, kind: "salaried", net_per_check_cents: 141000 }], rule: "monthdays", monthDays: [15, 31], lagDays: 0, incomeCategory: "Paycheck" },
    },
  });
  // Hours since the start of the year: mostly eight-hour weekdays, a few long days, a sick day now and then.
  const year = today.slice(0, 4);
  for (let date = `${year}-01-01`, i = 0; date < today; date = addDays(date, 1), i++) {
    if (weekday(date) === 0 || weekday(date) === 6) continue;
    api["pay.setDay"]({ person: "a", date, hours: i % 9 === 0 ? 10 : i % 7 === 0 ? 8.5 : 8, tag: i % 61 === 16 ? "sick" : "worked" });
  }
  // Every paycheck that has landed came in close to what was predicted.
  const landed = new Map<string, number>();
  for (let month = `${year}-01`; month <= monthOf(today); month = addMonths(month, 1)) {
    for (const p of api["pay.month"]({ person: "a", month }).paychecks) {
      if (p.pay_date < today && p.pay_date.startsWith(year) && p.predicted_net_cents !== null) landed.set(p.period_start, p.predicted_net_cents);
    }
  }
  [...landed].forEach(([period_start, predicted], i) => {
    api["pay.updatePaycheck"]({ person: "a", id: null, period_start, patch: { actual_net_cents: predicted + (((i * 37) % 41) - 20) * 90 } });
  });
}
