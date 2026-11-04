import { test, expect, type Page } from "@playwright/test";
import type { Snapshot, Entry } from "../../src/types";
const snapshot: Snapshot = {
  workspace: "demo",
  month: "2026-11",
  entries: [],
  householdEntries: [],
  accounts: [
    {
      id: "checking",
      name: "Capital One 360",
      kind: "checking",
      activityCents: 0,
      revision: 1,
      archived: false,
    },
    {
      id: "amex",
      name: "American Express",
      kind: "credit",
      activityCents: 0,
      revision: 1,
      archived: false,
    },
  ],
  categories: [
    {
      id: "home",
      name: "Home",
      groupName: "Needs",
      color: "#557788",
      limitCents: 10000,
      defaultLimitCents: 10000,
      spentCents: 0,
      revision: 1,
      archived: false,
      icon: "home",
    },
  ],
  spentCents: 0,
  incomeCents: 0,
  budgetCents: 10000,
  budgetConfigured: true,
  remainingCents: 10000,
  householdCents: 0,
  householdMonthSpentCents: 0,
  monthlyCount: 0,
  incompleteImports: 0,
  dataPath: "synthetic.sqlite",
  backups: [],
};

snapshot.categories.push({
  ...snapshot.categories[0],
  id: "gifts",
  name: "Gifts",
});
const lines = [
  {
    id: "food",
    label: "Household",
    categoryId: "home",
    amountCents: 6000,
    splitMode: "inherit",
    splitValue: "",
    jacobCents: 4200,
    chelseaCents: 1800,
  },
  {
    id: "gift",
    label: "Birthday",
    categoryId: "gifts",
    amountCents: 4000,
    splitMode: "personal",
    splitValue: "",
    jacobCents: 4000,
    chelseaCents: 0,
  },
];
const purchase = {
  id: "purchase",
  revision: 1,
  kind: "expense",
  date: "2026-11-01",
  description: "Mixed shop",
  amountCents: 10000,
  payer: "jacob",
  categoryId: "home",
  accountId: "amex",
  destinationAccountId: null,
  splitMode: "shared",
  splitValue: "",
  jacobCents: 8200,
  chelseaCents: 1800,
  householdDeltaCents: 1800,
  note: "",
  lines,
};
async function setup(page: Page, extra: Partial<Snapshot> = {}) {
  await page.addInitScript(
    ({ snapshot, purchase, extra }) => {
      const w = window as any;
      w.isTauri = true;
      w.calls = [];
      w.failSave = false;
      w.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          w.calls.push({ cmd, args });
          if (cmd === "snapshot")
            return {
              ...snapshot,
              entries: [purchase],
              ...extra,
              workspace: args.workspace,
              month: args.month,
            };
          if (cmd === "bill_month" || cmd === "list_bill_templates") return [];
          if (cmd === "preview_split") return [7000, 3000];
          if (cmd === "preview_lines")
            return args.lines.map((l: any) => ({
              ...l,
              amountCents: l.id === "gift" ? 4000 : 6000,
              jacobCents: l.id === "gift" ? 4000 : 4200,
              chelseaCents: l.id === "gift" ? 0 : 1800,
            }));
          if (cmd === "refund_purchases")
            return [{ ...purchase, remainingCents: 10000 }];
          if (cmd === "save_entry" && w.failSave)
            throw "Charge lines must add up exactly to the full amount.";
        },
      };
    },
    { snapshot, purchase, extra },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Monthly overview" }),
  ).toBeVisible();
}
test("itemized entry retains line IDs, categories and overrides through errors and retry", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Description", { exact: true }).fill("Mixed purchase");
  await d.getByLabel("Full amount").fill("100");
  await d
    .getByRole("combobox", { name: "Split", exact: true })
    .selectOption("shared");
  await d.getByRole("button", { name: "Itemize categories & charges" }).click();
  const first = d.getByRole("group", { name: "Charge 1", exact: true });
  await first.getByLabel("Line description").fill("Household");
  await first.getByLabel("Line amount ($)", { exact: true }).fill("60");
  await first.getByLabel("Line category").selectOption("home");
  await d.getByRole("button", { name: "Add charge line" }).click();
  const second = d.getByRole("group", { name: "Charge 2", exact: true });
  await second.getByLabel("Line description").fill("Birthday");
  await second.getByLabel("Line amount ($)", { exact: true }).fill("40");
  await second.getByLabel("Line category").selectOption("gifts");
  await second.getByLabel("Line sharing").selectOption("personal");
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Charge lines must add up");
  await expect(
    second.getByLabel("Line amount ($)", { exact: true }),
  ).toHaveValue("40");
  await page.evaluate(() => {
    (window as any).failSave = false;
  });
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_entry"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.input).toEqual(calls[1].args.input);
  expect(calls[1].args.input.lines).toMatchObject([
    { amount: "60", categoryId: "home", splitMode: "inherit" },
    { amount: "40", categoryId: "gifts", splitMode: "personal" },
  ]);
});
test("editing itemized purchases preserves allocations and exposes all categories in search", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transactions", exact: true })
    .click();
  await page.getByLabel("Search transactions").fill("Birthday");
  await expect(page.getByText("2 categories", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Mixed shop", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(
    d
      .getByRole("group", { name: "Charge 2", exact: true })
      .getByLabel("Line sharing"),
  ).toHaveValue("personal");
  await d.getByLabel("Note", { exact: false }).fill("New note");
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.screenshot({ path: ".qa/itemized-Light.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  const saved = await page.evaluate(
    () =>
      (window as any).calls.find((c: any) => c.cmd === "save_entry").args.input,
  );
  expect(saved.lines.map((l: any) => l.id)).toEqual(["food", "gift"]);
  expect(saved.lines.map((l: any) => l.amount)).toEqual(["60.00", "40.00"]);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("radio", { name: "Dracula", exact: true }).check();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transactions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit Mixed shop", exact: true })
    .click();
  await d
    .getByRole("group", { name: "Charge 2", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".qa/itemized-Dracula.png" });
  await expect(d.getByText("$82.00", { exact: true })).toBeVisible();
});
test("refund form allocates returned amounts to original lines and keeps corrections on failure", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Record refund", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "Original purchase", exact: true })
    .selectOption("purchase");
  await d.getByLabel("Refund for Household").fill("30");
  await d.getByLabel("Refund for Birthday").fill("20");
  await d.getByLabel("Refund amount ($)", { exact: true }).fill("50");
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await d.getByRole("button", { name: "Save refund", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Charge lines");
  await expect(d.getByLabel("Refund for Birthday")).toHaveValue("20");
  await page.evaluate(() => {
    (window as any).failSave = false;
  });
  await d.getByRole("button", { name: "Save refund", exact: true }).click();
  const saved = await page.evaluate(
    () =>
      (window as any).calls.filter((c: any) => c.cmd === "save_entry").at(-1)
        .args.input,
  );
  expect(saved.lines).toMatchObject([
    { originalLineId: "food", amount: "30" },
    { originalLineId: "gift", amount: "20" },
  ]);
});

test("reward entry permits a card credit and ordinary income restores a bank account", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Income", exact: true }).click();
  await d
    .getByRole("combobox", { name: "Income treatment", exact: true })
    .selectOption("reward");
  await d
    .getByLabel("Description", { exact: true })
    .fill("Cashback redemption");
  await d.getByLabel("Full amount").fill("25");
  await d.getByLabel("Your account").selectOption("amex");
  await expect(d.getByText(/A card credit reduces card debt/)).toBeVisible();
  await expect(d.getByLabel("Who paid?")).toHaveCount(0);
  await expect(
    d.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveCount(0);
  await d
    .getByRole("combobox", { name: "Income treatment", exact: true })
    .selectOption("income");
  await expect(d.getByLabel("Your account")).toHaveValue("checking");
  await expect(
    d.getByLabel("Your account").locator('option[value="amex"]'),
  ).toHaveCount(0);
  await d
    .getByRole("combobox", { name: "Income treatment", exact: true })
    .selectOption("reward");
  await d.getByLabel("Your account").selectOption("amex");
  await page.screenshot({ path: ".qa/reward-Light.png" });
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(d).toHaveCount(0);
  const saved = await page.evaluate(
    () =>
      (window as any).calls.find((c: any) => c.cmd === "save_entry").args.input,
  );
  expect(saved).toMatchObject({
    kind: "reward",
    accountId: "amex",
    amount: "25",
    payer: "jacob",
    categoryId: null,
    lines: [],
  });
});

test("loan entry retains category and sharing through validation failure", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("radio", { name: "Dracula", exact: true }).check();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  const d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "Expense treatment", exact: true })
    .selectOption("debt_payment");
  await d.getByLabel("Description", { exact: true }).fill("Auto loan");
  await d.getByLabel("Full amount").fill("920");
  await d.getByLabel("Your account").selectOption("checking");
  await d
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("home");
  await d
    .getByRole("combobox", { name: "Split", exact: true })
    .selectOption("shared");
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(d.getByRole("alert")).toBeVisible();
  await expect(
    d.getByRole("combobox", { name: "Expense treatment", exact: true }),
  ).toHaveValue("debt_payment");
  await page.evaluate(() => {
    (window as any).failSave = false;
  });
  await d
    .getByRole("combobox", { name: "Expense treatment", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".qa/debt-Dracula.png" });
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(d).toHaveCount(0);
  const saved = await page.evaluate(() =>
    (window as any).calls
      .filter((c: any) => c.cmd === "save_entry")
      .map((c: any) => c.args.input),
  );
  expect(saved[0]).toEqual(saved[1]);
  expect(saved[1]).toMatchObject({
    kind: "debt_payment",
    accountId: "checking",
    amount: "920",
    categoryId: "home",
    splitMode: "shared",
  });
});

test("reports distinguish budgetable debt, purchases and noncash rewards and editing preserves kind", async ({
  page,
}) => {
  const debt: Entry = {
    ...purchase,
    kind: "debt_payment",
    id: "debt",
    description: "Shared loan payment",
    lines: [],
  };
  const reward: Entry = {
    ...purchase,
    kind: "reward",
    id: "reward",
    description: "Card cashback",
    amountCents: 2500,
    categoryId: null,
    jacobCents: 0,
    chelseaCents: 0,
    householdDeltaCents: 0,
    splitMode: "none",
    lines: [],
  };
  await setup(page, {
    entries: [debt, reward],
    spentCents: 8200,
    consumptionCents: 0,
    debtPaymentCents: 8200,
    cashRewardCents: 1000,
    cardRewardCents: 2500,
    incomeCents: 200000,
  });
  const budget = page
    .locator(".metric-card")
    .filter({ hasText: "Budget used" });
  await expect(budget).toContainText("$82.00");
  await expect(budget).toContainText("$0.00 purchases");
  const income = page
    .locator(".metric-card")
    .filter({ hasText: "Income recorded" });
  await expect(income).toContainText("$2,000.00");
  await expect(income).toContainText("$10.00 cash");
  await expect(income).toContainText("$25.00 noncash card credits");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transactions", exact: true })
    .click();
  await page.getByLabel("Filter transaction type").selectOption("reward");
  await expect(
    page.getByRole("button", { name: "Edit Shared loan payment", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit Card cashback", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("Your account")).toHaveValue("amex");
  await expect(
    d.getByRole("combobox", { name: "Income treatment", exact: true }),
  ).toHaveCount(0);
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  const saved = await page.evaluate(
    () =>
      (window as any).calls.find((c: any) => c.cmd === "save_entry").args.input,
  );
  expect(saved).toMatchObject({
    kind: "reward",
    id: "reward",
    revision: 1,
    accountId: "amex",
  });
  await page.getByLabel("Filter transaction type").selectOption("debt_payment");
  await expect(
    page.getByRole("button", { name: "Edit Shared loan payment", exact: true }),
  ).toBeVisible();
});
