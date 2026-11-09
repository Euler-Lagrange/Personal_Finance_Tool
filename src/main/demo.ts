import type { CoreApi } from "./api";
import { addMonths, monthOf, toISO } from "../core/dates";

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
  add(1, "Mortgage", 160000, "Housing");
  add(1, "Paycheck", 212000, "Paycheck", "a", undefined, "income");
  add(2, "Paycheck", 141000, "Paycheck", "b", undefined, "income");
  add(2, "Corner Market", 8431, "Groceries");
  add(3, "Fiber internet", 7500, "Internet and phone");
  add(4, "Noodle House", 4680, "Dining out", "b");
  add(5, "Board game cafe", 3200, "Hobbies", "a", 100);
  add(6, "City Power", 11840, "Utilities");
  add(7, "Farm stand", 2650, "Groceries", "b");
  add(8, "Transit pass", 6000, "Transport", "a", 100);
  add(8, "Car insurance", 14200, "Insurance", "a", 50);
  add(9, "Streaming bundle", 2299, "Subscriptions");
  add(9, "Birthday present", 4500, "Gifts", "b", 0);
  add(1, "Transfer to savings", 90000, "Savings", "a", 100);
  add(2, "Transfer to savings", 50000, "Savings", "b", 0);
  api["entries.create"]({ date: day(5), description: "Settle up", amount_cents: 10000, kind: "settlement", category_id: null, paid_by: "b" });
}
