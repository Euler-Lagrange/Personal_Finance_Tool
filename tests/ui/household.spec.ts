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
const cashout: Entry = {
  id: "cashout",
  revision: 1,
  kind: "paypal_cashout",
  date: "2026-11-02",
  description: "PayPal deposit",
  amountCents: 5900,
  payer: "jacob",
  accountId: "checking",
  categoryId: "home",
  destinationAccountId: null,
  splitMode: "none",
  splitValue: "",
  jacobCents: 100,
  chelseaCents: 0,
  householdDeltaCents: 0,
  note: "",
  lines: [],
  paypal: {
    receipts: [{ id: "receipt-1", revision: 1, amount: "60.00" }],
    fee: "1.00",
    feeCategoryId: "home",
    other: "0.00",
    otherNote: "",
  },
};
async function setup(page: Page) {
  await page.addInitScript(
    ({ snapshot, cashout }) => {
      const w = window as any;
      w.isTauri = true;
      w.calls = [];
      w.opening = null;
      w.failSave = false;
      w.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          w.calls.push({ cmd, args });
          if (cmd === "snapshot")
            return {
              ...snapshot,
              month: args.month,
              workspace: args.workspace,
              entries: [cashout],
            };
          if (cmd === "bill_month") return [];
          if (cmd === "household_opening") return w.opening;
          if (cmd === "save_household_opening") {
            if (w.failSave)
              throw "Choose an opening date before all recorded shared activity.";
            w.opening = {
              revision: 1,
              date: args.input.date,
              amountCents: 10000,
              note: args.input.note,
            };
            return;
          }
          if (cmd === "paypal_receipts")
            return [
              {
                id: "receipt-1",
                revision: 1,
                date: "2026-11-01",
                description: "First receipt",
                amountCents: 6000,
                availableCents: 6000,
              },
              {
                id: "receipt-2",
                revision: 1,
                date: "2026-11-01",
                description: "Second receipt",
                amountCents: 4000,
                availableCents: 4000,
              },
            ];
          if (cmd === "save_entry" && w.failSave)
            throw "Receipts plus other funds must equal the bank deposit plus the PayPal fee.";
        },
      };
    },
    { snapshot, cashout },
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Shared expenses", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Set opening balance", exact: true }),
  ).toBeEnabled();
}

test("opening shared balance requires reconciliation and preserves edits after validation", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Set opening balance", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Opening date").fill("2026-10-31");
  await d.getByLabel("Opening amount ($)", { exact: true }).fill("100");
  await d
    .getByRole("combobox", {
      name: "Who owes the opening amount?",
      exact: true,
    })
    .selectOption("jacob");
  await d
    .getByLabel("Reconciliation note")
    .fill("Checked the bills and Splitwise overlap");
  await d
    .getByRole("button", { name: "Save opening balance", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter(
          (c: any) => c.cmd === "save_household_opening",
        ).length,
    ),
  ).toBe(0);
  await d.getByLabel("I reconciled overlapping").check();
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await d
    .getByRole("button", { name: "Save opening balance", exact: true })
    .click();
  await expect(d.getByRole("alert")).toContainText("before all recorded");
  await expect(d.getByLabel("Opening amount ($)", { exact: true })).toHaveValue(
    "100",
  );
  await page.evaluate(() => {
    (window as any).failSave = false;
  });
  await d
    .getByRole("button", { name: "Save opening balance", exact: true })
    .click();
  await expect(d).toHaveCount(0);
  const input = await page.evaluate(
    () =>
      (window as any).calls
        .filter((c: any) => c.cmd === "save_household_opening")
        .at(-1).args.input,
  );
  expect(input).toMatchObject({
    amount: "-100",
    revision: 0,
    date: "2026-10-31",
    reconciled: true,
  });
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "save_entry").length,
    ),
  ).toBe(0);
});

test("partial cashout with fee and other funds preserves its breakdown through retry", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByText("$100.00", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Record PayPal cash-out", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Bank deposit ($)", { exact: true }).fill("69");
  await expect(
    d.getByLabel("Receiving bank account").locator('option[value="amex"]'),
  ).toHaveCount(0);
  await d.getByRole("checkbox", { name: /^First receipt/ }).check();
  await d
    .getByLabel("Amount from First receipt ($)", { exact: true })
    .fill("50");
  await d.getByLabel("PayPal fee ($)", { exact: true }).fill("1");
  await d.getByLabel("Fee category").selectOption("home");
  await d.getByLabel("Other PayPal funds ($)", { exact: true }).fill("20");
  await d
    .getByLabel("Explain other funds")
    .fill("Existing personal PayPal balance");
  await d.getByLabel("I checked the received bank deposit").check();
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await d.getByRole("button", { name: "Save cash-out", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Receipts plus other funds");
  await expect(
    d.getByLabel("Amount from First receipt ($)", { exact: true }),
  ).toHaveValue("50");
  await page.evaluate(() => {
    (window as any).failSave = false;
  });
  await d
    .getByRole("heading", { name: "Receipts used", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".qa/paypal-Light.png" });
  await d.getByRole("button", { name: "Save cash-out", exact: true }).click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls
      .filter((c: any) => c.cmd === "save_entry")
      .map((c: any) => c.args.input),
  );
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[1]).toMatchObject({
    kind: "paypal_cashout",
    accountId: "checking",
    amount: "69",
    paypal: {
      receipts: [{ id: "receipt-1", revision: 1, amount: "50" }],
      fee: "1",
      feeCategoryId: "home",
      other: "20",
      otherNote: "Existing personal PayPal balance",
    },
  });
});

test("cashout edits retain allocations and canceling removal does not submit", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("radio", { name: "Dracula", exact: true }).check();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transactions", exact: true })
    .click();
  await page
    .getByLabel("Filter transaction type")
    .selectOption("paypal_cashout");
  await page
    .getByRole("button", { name: "Edit PayPal deposit", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(
    d.getByLabel("Amount from First receipt ($)", { exact: true }),
  ).toHaveValue("60.00");
  await d.getByRole("button", { name: "Remove", exact: true }).click();
  await d.getByRole("button", { name: "Keep cash-out", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) =>
          ["save_entry", "delete_entry"].includes(c.cmd),
        ).length,
    ),
  ).toBe(0);
  await page.setViewportSize({ width: 1024, height: 768 });
  await d
    .getByRole("heading", { name: "Receipts used", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".qa/paypal-Dracula.png" });
  await d.getByRole("button", { name: "Remove", exact: true }).click();
  await d.getByRole("button", { name: "Remove cash-out", exact: true }).click();
  await expect(d).toHaveCount(0);
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "delete_entry"),
  );
  expect(call.args).toMatchObject({ id: "cashout", revision: 1 });
});

test("opening and cashout close guards keep unsaved changes when discard is declined", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Set opening balance", exact: true })
    .click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Opening amount ($)", { exact: true }).fill("123");
  page.once("dialog", (dialog) => dialog.dismiss());
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(d.getByLabel("Opening amount ($)", { exact: true })).toHaveValue(
    "123",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Record PayPal cash-out", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.getByLabel("Bank deposit ($)", { exact: true }).fill("50");
  page.once("dialog", (dialog) => dialog.dismiss());
  await d.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(d.getByLabel("Bank deposit ($)", { exact: true })).toHaveValue(
    "50",
  );
});
