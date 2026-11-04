// Isolated UI tests use a mock IPC boundary. Rust tests verify real financial behavior.
import { test, expect, type Page } from "@playwright/test";
import type { Snapshot, Entry } from "../../src/types";

const month = "2026-11";
function expense(
  id: string,
  description: string,
  amountCents: number,
  jacobCents: number,
  chelseaCents: number,
  categoryId: string,
  payer: "jacob" | "chelsea" = "jacob",
): Entry {
  return {
    id,
    revision: 1,
    kind: "expense",
    date: `${month}-02`,
    description,
    amountCents,
    payer,
    categoryId,
    accountId: payer === "jacob" ? "amex" : null,
    destinationAccountId: null,
    splitMode: "shared",
    splitValue: "",
    jacobCents,
    chelseaCents,
    householdDeltaCents: payer === "jacob" ? chelseaCents : -jacobCents,
    note: "",
  };
}
const fixture: Snapshot = {
  workspace: "demo",
  month,
  entries: [
    expense("e1", "Grocery run", 10000, 7000, 3000, "groceries"),
    expense("e2", "Whole Foods Market", 12669, 8868, 3801, "groceries"),
    expense("e3", "Dinner together", 4800, 3360, 1440, "dining", "chelsea"),
    {
      ...expense("e4", "Hobby supplies", 32000, 32000, 0, "hobbies"),
      splitMode: "personal",
    },
  ],
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
      id: "capital-one",
      name: "Capital One",
      kind: "credit",
      activityCents: 0,
      revision: 1,
      archived: false,
    },
    {
      id: "amex",
      name: "American Express",
      kind: "credit",
      activityCents: 54669,
      revision: 1,
      archived: false,
    },
  ],
  categories: [
    {
      id: "home",
      revision: 1,
      archived: false,
      icon: "auto",
      defaultLimitCents: 165000,
      name: "Home & utilities",
      groupName: "Needs",
      color: "#7488c1",
      limitCents: 165000,
      spentCents: 0,
    },
    {
      id: "groceries",
      revision: 1,
      archived: false,
      icon: "auto",
      defaultLimitCents: 70000,
      name: "Groceries",
      groupName: "Needs",
      color: "#5b9985",
      limitCents: 70000,
      spentCents: 15868,
    },
    {
      id: "dining",
      revision: 1,
      archived: false,
      icon: "auto",
      defaultLimitCents: 42500,
      name: "Dining together",
      groupName: "Wants",
      color: "#d29a71",
      limitCents: 42500,
      spentCents: 3360,
    },
    {
      id: "hobbies",
      revision: 1,
      archived: false,
      icon: "auto",
      defaultLimitCents: 27000,
      name: "Hobbies",
      groupName: "Wants",
      color: "#9a87ba",
      limitCents: 27000,
      spentCents: 32000,
    },
    {
      id: "uncategorized",
      revision: 1,
      archived: false,
      icon: "auto",
      defaultLimitCents: 0,
      name: "Uncategorized",
      groupName: "Other",
      color: "#9b9fa9",
      limitCents: 0,
      spentCents: 0,
    },
  ],
  spentCents: 51228,
  incomeCents: 0,
  budgetCents: 304500,
  budgetConfigured: true,
  remainingCents: 253272,
  householdCents: 3441,
  householdMonthSpentCents: 27469,
  monthlyCount: 4,
  incompleteImports: 0,
  dataPath: "C:\\Example\\demo.sqlite",
  backups: [],
};
fixture.householdEntries = fixture.entries.filter(
  (e) => e.householdDeltaCents !== 0,
);

test("Sheets categories are discoverable beyond the five-category dashboard and defaults are reviewable", async ({
  page,
}) => {
  // Synthetic UI fixture: the separately tested Rust preset supplies these values
  // in the desktop app. No screenshot transactions or personal database is loaded.
  const needs: [string, number][] = [
    ["Rent/Water/Trash", 1310],
    ["Internet", 70],
    ["Heating Gas", 48],
    ["Electric", 100],
    ["Cell Phone", 98],
    ["Subscriptions", 62],
    ["Gym", 89],
    ["Car/Renter's Insurance", 110],
    ["Life/Disability Insurance", 71],
    ["Pet Insurance", 86],
    ["Auto Loan", 920],
    ["Debt Flex Slot", 0],
    ["Debt Flex Slot 2", 0],
    ["Student Loans", 140],
    ["CSU/Work Expenses", 206],
    ["Gas", 50],
    ["Groceries", 700],
    ["RX/Counseling", 100],
    ["Needs Flex Expenses", 360],
  ];
  const wants: [string, number][] = [
    ["Dates/Restaurants", 425],
    ["Hobbies", 270],
    ["Otter Gifts", 100],
    ["Solo Dining", 100],
    ["Flex Slot", 0],
    ["Wants Flex Expenses", 417],
  ];
  const categories = [
    ...needs,
    ...wants,
    ["Uncategorized", 0] as [string, number],
  ].map(([name, amount], index) => ({
    id: `sheet-${index}`,
    name,
    groupName:
      index < needs.length
        ? "Needs"
        : index < needs.length + wants.length
          ? "Wants"
          : "Other",
    revision: 1,
    archived: false,
    icon: "auto",
    color: "#7488c1",
    defaultLimitCents: amount * 100,
    limitCents: amount * 100,
    spentCents: 0,
  }));
  await setup(page, {
    ...fixture,
    entries: [],
    householdEntries: [],
    categories,
    spentCents: 0,
    budgetCents: 583200,
    remainingCents: 583200,
    monthlyCount: 0,
    householdCents: 0,
  });
  await expect(
    page.getByText("Showing 5 categories · 26 active in your budget"),
  ).toBeVisible();
  await expect(page.locator(".budget-overview .category-bar")).toHaveCount(5);
  await page
    .getByRole("button", { name: "View all categories", exact: true })
    .click();
  await expect(page.locator(".editable-budget")).toHaveCount(26);
  await expect(
    page.getByRole("button", { name: "Edit Heating Gas budget", exact: true }),
  ).toContainText("$48.00");
  await expect(
    page.getByRole("button", { name: "Edit Gas budget", exact: true }),
  ).toContainText("$50.00");
  await expect(
    page.getByRole("button", {
      name: "Edit Debt Flex Slot 2 budget",
      exact: true,
    }),
  ).toBeEnabled();
  await page.screenshot({ path: ".qa/sheets-budget.png", fullPage: true });
  await page
    .getByRole("button", { name: "Copy budget limits", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "26 active categories · $5,832.00 in monthly defaults",
  );
  await expect(
    page.getByLabel("Replace existing limits for this month"),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Accounts & categories", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Categories & defaults", exact: true })
    .click();
  await page
    .getByRole("searchbox", { name: "Search categories" })
    .fill("insurance");
  await expect(page.locator(".setup-table tbody tr")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Edit category Pet Insurance", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Edit category");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  const category = page.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  await category.selectOption({ label: "CSU/Work Expenses" });
  await expect(category.locator("option:checked")).toHaveText(
    "CSU/Work Expenses",
  );
});

test("refund-only spending stays visible with an empty bar and edits keep the purchase link", async ({
  page,
}) => {
  const credit: Entry = {
    ...expense("refund-1", "Return credit", 2500, 1750, 750, "groceries"),
    kind: "refund",
    originalEventId: "original",
    splitMode: "refund",
    householdDeltaCents: -750,
  };
  const data: Snapshot = {
    ...fixture,
    entries: [credit],
    householdEntries: [credit],
    spentCents: -1750,
    budgetCents: 0,
    remainingCents: 1750,
    categories: [
      {
        ...fixture.categories.find((c) => c.id === "groceries")!,
        archived: true,
        limitCents: 0,
        spentCents: -1750,
      },
    ],
  };
  await setup(page, data);
  const bar = page.locator(".budget-overview .category-bar");
  await expect(bar).toHaveCount(1);
  await expect(bar).toContainText("-$17.50");
  await expect(bar.locator(".track > span")).toHaveCSS("width", "0px");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transactions", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toContainText("-$25.00");
  await page.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) =>
      cmd === "refund_purchases"
        ? [
            {
              id: "original",
              date: "2026-10-01",
              description: "Original groceries",
              amountCents: 10000,
              remainingCents: 10000,
              jacobCents: 7000,
              chelseaCents: 3000,
              payer: "jacob",
              categoryId: "groceries",
              accountId: "amex",
            },
          ]
        : original(cmd, args);
  });
  await page
    .getByRole("button", { name: "Edit Return credit", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit refund", exact: true });
  await expect(
    dialog.getByRole("combobox", { name: "Original purchase", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByLabel("Refund amount ($)", { exact: true }),
  ).toHaveValue("25.00");
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    dialog.getByText(/Remove this refund and reverse/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "delete_entry")
          .length,
    ),
  ).toBe(0);
  await dialog
    .getByRole("button", { name: "Keep refund", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "save_entry").length,
    ),
  ).toBe(0);
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Remove refund", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "delete_entry"),
  );
  expect(call.args).toMatchObject({
    id: "refund-1",
    revision: 1,
    workspace: "demo",
  });
});

async function setup(page: Page, data = fixture) {
  await page.addInitScript((data) => {
    const app = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: unknown;
      calls: { cmd: string; args: Record<string, unknown> }[];
    };
    app.isTauri = true;
    app.calls = [];
    app.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: Record<string, unknown>) => {
        app.calls.push({ cmd, args });
        if (cmd === "snapshot")
          return { ...data, workspace: args.workspace, month: args.month };
        if (cmd === "preview_split") return [7000, 3000];
        if (cmd === "save_account") {
          const input = args.input as import("../../src/types").Account;
          if (input.name === "Reject account")
            throw "Account name already exists.";
          const old = data.accounts.find((a) => a.id === input.id);
          const updated = {
            ...input,
            revision: input.revision + 1,
            activityCents: old?.activityCents ?? 0,
          };
          if (old) Object.assign(old, updated);
          else data.accounts.push(updated);
        }
        if (cmd === "save_category") {
          const input = args.input as import("../../src/types").Category & {
            defaultLimit: string;
          };
          const old = data.categories.find((c) => c.id === input.id);
          const updated = {
            ...input,
            revision: input.revision + 1,
            defaultLimitCents: Math.round(Number(input.defaultLimit) * 100),
            limitCents: old?.limitCents ?? 0,
            spentCents: old?.spentCents ?? 0,
          };
          if (old) Object.assign(old, updated);
          else data.categories.push(updated);
        }
        if (cmd === "apply_budget_template")
          return data.categories.filter((c) => !c.archived).length;
        if (
          cmd === "save_entry" &&
          (args.input as { description: string }).description === "Reject me"
        )
          throw "Validation rejected this entry.";
        if (cmd === "save_entry") {
          const input = args.input as import("../../src/types").EntryInput;
          if (input.kind === "transfer" || input.kind === "card_payment") {
            const updated = {
              ...input,
              revision: input.revision + 1,
              amountCents: Math.round(Number(input.amount) * 100),
              jacobCents: 0,
              chelseaCents: 0,
              householdDeltaCents: 0,
            };
            const old = data.entries.find((e) => e.id === input.id);
            if (old) Object.assign(old, updated);
            else data.entries.unshift(updated);
          }
        }
        if (cmd === "delete_entry")
          data.entries = data.entries.filter((e) => e.id !== args.id);
        return null;
      },
    };
  }, data);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Monthly overview" }),
  ).toBeVisible();
  await expect(page.locator(".hero-amount")).toHaveText(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Math.abs(data.remainingCents) / 100),
  );
}

function contrastRatio(first: string, second: string) {
  function luminance(color: string) {
    const rgb = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((n) => {
        const channel = n / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("help stays readable on hover, supports focus and click, and dismisses without changing data", async ({
  page,
}) => {
  await setup(page);
  const help = page.getByRole("button", {
    name: "Help: Monthly overview",
    exact: true,
  });
  const tip = page.getByRole("tooltip");
  await help.hover();
  await expect(tip).toContainText(
    "Budget room is your remaining spending allowance",
  );
  await tip.hover();
  await page.waitForTimeout(200);
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  await page.mouse.move(0, 0);
  await help.focus();
  await expect(tip).toBeVisible();
  await expect(help).toHaveAttribute(
    "aria-describedby",
    (await tip.getAttribute("id")) as string,
  );
  await page.keyboard.press("Tab");
  await expect(tip).toHaveCount(0);
  await help.click();
  await page.mouse.move(0, 0);
  await expect(tip).toBeVisible();
  await help.click();
  await expect(tip).toHaveCount(0);
  await page
    .getByRole("button", { name: "Help: Household balance", exact: true })
    .focus();
  await expect(tip).toContainText("It spans all months");
  await help.focus();
  await expect(tip).toHaveCount(1);
  await expect(tip).toContainText("monthly check-in");
  await page
    .getByRole("heading", { name: "Monthly overview", exact: true })
    .click();
  await expect(tip).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as { calls: { cmd: string }[] }).calls.filter((c) =>
        /^(save_|delete_|process_|restore_|close_|apply_)/.test(c.cmd),
      ),
    ),
  ).toEqual([]);
});

test("each page has purpose help and changing pages removes the old explanation", async ({
  page,
}) => {
  await setup(page);
  const pages = [
    ["Overview", "Monthly overview"],
    ["Transactions", "Transactions"],
    ["Imports", "Import & review"],
    ["Merchant rules", "Merchant rules"],
    ["Monthly budget", "Monthly budget"],
    ["Annual reports", "Annual reports"],
    ["Bills", "Bills & payments"],
    ["Savings goals", "Savings goals"],
    ["Card statements", "Card statements"],
    ["Cash plans", "Cash plans"],
    ["Cash timeline", "Checking cash timeline"],
    ["Shared expenses", "Shared expenses"],
    ["Accounts & categories", "Accounts & categories"],
    ["Workspace & backups", "Workspace settings"],
  ];
  for (const [navigation, heading] of pages) {
    await page
      .locator(".sidebar")
      .getByRole("button", { name: navigation, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    const help = page
      .locator(".page-heading")
      .getByRole("button", { name: `Help: ${heading}`, exact: true });
    await help.focus();
    await expect(page.getByRole("tooltip")).toHaveCount(1);
    await expect(page.getByRole("tooltip").locator("strong")).toHaveText(
      heading,
    );
  }
});

for (const fallback of [false, true]) {
  test(`help in an edit dialog preserves the draft and fits the viewport${fallback ? " without native popovers" : ""}`, async ({
    page,
  }) => {
    if (fallback)
      await page.addInitScript(() => {
        Object.defineProperty(HTMLElement.prototype, "showPopover", {
          value: undefined,
          configurable: true,
        });
      });
    await page.setViewportSize({ width: 1000, height: 700 });
    await setup(page);
    await page
      .getByRole("button", { name: "Add expense", exact: true })
      .click();
    await page
      .getByLabel("Description", { exact: true })
      .fill("Preserve this draft");
    await page.getByLabel("Full amount").fill("100.00");
    await page
      .getByRole("button", {
        name: "Itemize categories & charges",
        exact: true,
      })
      .click();
    const help = page.getByRole("button", {
      name: "Help: Charge lines",
      exact: true,
    });
    await help.click();
    const tip = page.getByRole("tooltip");
    await expect(tip).toContainText("parts of one transaction");
    const bounds = (await tip.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1000);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
    // Hit-testing verifies the explanation is above the modal, not hidden behind it.
    expect(
      await tip.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + 20, r.y + 20));
      }),
    ).toBeTruthy();
    await page.screenshot({
      path: `.qa/help-dialog-${fallback ? "fallback" : "native"}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
      "Preserve this draft",
    );
    await expect(page.getByLabel("Full amount")).toHaveValue("100.00");
    await help.focus();
    await page.keyboard.press("Space");
    await expect(tip).toBeVisible();
    await page.getByLabel("Description", { exact: true }).click();
    await expect(tip).toHaveCount(0);
  });
}

test("a successful save followed by a refresh failure closes the form and retries only the read", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const app = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (
          cmd: string,
          args: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
    const original = app.__TAURI_INTERNALS__.invoke;
    let fail = true;
    app.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === "snapshot" && fail) {
        fail = false;
        throw "Test refresh failure";
      }
      return original(cmd, args);
    };
  });
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Saved purchase");
  await page.getByLabel("Full amount").fill("100");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("saved");
  await expect(page.getByRole("alert")).toContainText("reload");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { calls: { cmd: string }[] }).calls.filter(
          (c) => c.cmd === "save_entry",
        ).length,
    ),
  ).toBe(1);
});

function transferFixture(): Snapshot {
  const data = structuredClone(fixture);
  data.accounts.push({
    id: "gift",
    name: "Gift Fund",
    kind: "savings",
    activityCents: 0,
    revision: 1,
    archived: false,
  });
  return data;
}

test("bank transfer records one entry with both accounts and no spending category", async ({
  page,
}) => {
  await setup(page, transferFixture());
  await page.getByRole("button", { name: "Move money", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move money" });
  await expect(
    dialog.getByRole("combobox", { name: "From account", exact: true }),
  ).toHaveValue("checking");
  await expect(
    dialog.getByRole("combobox", { name: "To account", exact: true }),
  ).toHaveValue("gift");
  await expect(
    dialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveCount(0);
  await dialog.getByLabel("Amount ($)", { exact: true }).fill("500.01");
  await page.screenshot({ path: ".qa/transfer-dialog.png" });
  await dialog
    .getByRole("button", { name: "Record transfer", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (
      window as unknown as {
        calls: { cmd: string; args: { input: unknown } }[];
      }
    ).calls.filter((c) => c.cmd === "save_entry"),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].args.input).toMatchObject({
    kind: "transfer",
    amount: "500.01",
    accountId: "checking",
    destinationAccountId: "gift",
    categoryId: null,
    payer: "jacob",
    splitMode: "none",
  });
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page.getByLabel("Filter transaction type").selectOption("transfer");
  const row = page
    .getByRole("row")
    .filter({ hasText: "Bank transfer · no income or spending" });
  await expect(row).toContainText("Capital One 360");
  await expect(row).toContainText("Gift Fund");
  await expect(row).toContainText("$500.01");
  await page.getByLabel("Search transactions").fill("gift fund");
  await expect(row).toHaveCount(1);
  await page.screenshot({ path: ".qa/transfer-history.png" });
});

test("card payment uses a bank source and a card destination with readable themed forms", async ({
  page,
}) => {
  await setup(page);
  for (const theme of ["Dracula", "Marshmallow"]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name: new RegExp(`^${theme}`) }).check();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: "Move money", exact: true }).click();
    await page
      .getByRole("button", { name: "Card payment", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount ($)", { exact: true }).fill("624");
    await dialog
      .getByRole("combobox", { name: "Card to pay", exact: true })
      .selectOption("amex");
    await expect(
      dialog
        .getByRole("combobox", { name: "From account", exact: true })
        .locator('option[value="amex"]'),
    ).toHaveCount(0);
    await expect(
      dialog
        .getByRole("combobox", { name: "Card to pay", exact: true })
        .locator('option[value="checking"]'),
    ).toHaveCount(0);
    const colors = await dialog
      .locator(".transfer-effect span")
      .evaluate((el) => ({
        color: getComputedStyle(el).color,
        background: getComputedStyle(el.parentElement!.parentElement!)
          .backgroundColor,
      }));
    expect(
      contrastRatio(colors.color, colors.background),
    ).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: `.qa/card-payment-${theme.toLowerCase()}.png`,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.getByRole("button", { name: "Move money", exact: true }).click();
  await page.getByRole("button", { name: "Card payment", exact: true }).click();
  await page.getByLabel("Amount ($)", { exact: true }).fill("624.00");
  await page
    .getByRole("combobox", { name: "Card to pay", exact: true })
    .selectOption("amex");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".qa/card-payment-compact.png" });
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const input = await page.evaluate(
    () =>
      (
        window as unknown as {
          calls: { cmd: string; args: { input: unknown } }[];
        }
      ).calls.findLast((c) => c.cmd === "save_entry")!.args.input,
  );
  expect(input).toMatchObject({
    kind: "card_payment",
    amount: "624.00",
    accountId: "checking",
    destinationAccountId: "amex",
    categoryId: null,
    splitMode: "none",
  });
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page.getByLabel("Filter transaction type").selectOption("card_payment");
  await expect(
    page.getByRole("row").filter({ hasText: "Credit card payment" }),
  ).toContainText("American Express");
});

test("editing and removing a transfer uses its existing identity and reverses one record", async ({
  page,
}) => {
  const data = transferFixture();
  data.entries.unshift({
    ...data.entries[0],
    id: "transfer-test",
    kind: "transfer",
    description: "Move to gift fund",
    amountCents: 50000,
    categoryId: null,
    accountId: "checking",
    destinationAccountId: "gift",
    splitMode: "none",
    splitValue: "",
    jacobCents: 0,
    chelseaCents: 0,
    householdDeltaCents: 0,
  });
  await setup(page, data);
  await page
    .getByRole("button", { name: "Edit Move to gift fund", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit bank transfer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Card payment", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Amount ($)", { exact: true }).fill("125.55");
  await page
    .getByRole("combobox", { name: "From account", exact: true })
    .selectOption("gift");
  await expect(
    page.getByRole("combobox", { name: "To account", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("combobox", { name: "To account", exact: true })
    .selectOption("checking");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const input = await page.evaluate(
    () =>
      (
        window as unknown as {
          calls: { cmd: string; args: { input: unknown } }[];
        }
      ).calls.findLast((c) => c.cmd === "save_entry")!.args.input,
  );
  expect(input).toMatchObject({
    id: "transfer-test",
    revision: 1,
    amount: "125.55",
    accountId: "gift",
    destinationAccountId: "checking",
  });
  await page
    .getByRole("button", { name: "Edit Move to gift fund", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page
    .getByRole("button", { name: "Keep transfer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove transfer", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const deletes = await page.evaluate(() =>
    (
      window as unknown as { calls: { cmd: string; args: unknown }[] }
    ).calls.filter((c) => c.cmd === "delete_entry"),
  );
  expect(deletes).toHaveLength(1);
  expect(deletes[0].args).toMatchObject({ id: "transfer-test", revision: 2 });
  await expect(
    page.getByRole("button", { name: "Edit Move to gift fund", exact: true }),
  ).toHaveCount(0);
});

test("transfer validation preserves inputs and missing accounts cannot be submitted", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Move money", exact: true }).click();
  await expect(
    page.getByText(
      "Add or restore two different checking or savings accounts",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByLabel("Amount ($)", { exact: true }).fill("50");
  await page
    .getByRole("button", { name: "Record transfer", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { calls: { cmd: string }[] }).calls.filter(
          (c) => c.cmd === "save_entry",
        ).length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Card payment", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Reject me");
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Validation rejected this entry.",
  );
  await expect(page.getByLabel("Amount ($)", { exact: true })).toHaveValue(
    "50",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("archived transfer accounts remain in historical edits and disappear from new choices", async ({
  page,
}) => {
  const data = transferFixture();
  data.accounts.find((a) => a.id === "gift")!.archived = true;
  data.accounts.find((a) => a.id === "checking")!.archived = true;
  data.entries.unshift({
    ...data.entries[0],
    id: "old-transfer",
    kind: "transfer",
    description: "Old savings transfer",
    categoryId: null,
    accountId: "checking",
    destinationAccountId: "gift",
    splitMode: "none",
    jacobCents: 0,
    chelseaCents: 0,
    householdDeltaCents: 0,
  });
  await setup(page, data);
  await page
    .getByRole("button", { name: "Edit Old savings transfer", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "From account", exact: true }),
  ).toHaveValue("checking");
  await expect(
    page.getByRole("combobox", { name: "To account", exact: true }),
  ).toHaveValue("gift");
  await expect(
    page.getByRole("combobox", { name: "To account", exact: true }),
  ).toContainText("archived");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Move money", exact: true }).click();
  await expect(
    page
      .getByRole("combobox", { name: "From account", exact: true })
      .locator('option[value="checking"]'),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("combobox", { name: "To account", exact: true })
      .locator('option[value="gift"]'),
  ).toHaveCount(0);
});

test("an old workspace operation cannot replace the newly selected workspace", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const app = window as unknown as {
      finishBackup: () => void;
      __TAURI_INTERNALS__: {
        invoke: (
          cmd: string,
          args: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
    const original = app.__TAURI_INTERNALS__.invoke;
    app.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === "create_backup")
        await new Promise<void>((resolve) => {
          app.finishBackup = resolve;
        });
      const result = await original(cmd, args);
      if (cmd === "snapshot")
        return {
          ...(result as Snapshot),
          dataPath: `C:\\Example\\${args.workspace}.sqlite`,
        };
      return result;
    };
  });
  await page
    .getByRole("button", { name: "Workspace & backups", exact: true })
    .click();
  await page.getByRole("button", { name: "Back up now", exact: true }).click();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await expect(page.getByText("Personal · USD", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { finishBackup: () => void }).finishBackup(),
  );
  await page
    .getByRole("button", { name: "Workspace & backups", exact: true })
    .click();
  await expect(page.locator(".data-path")).toHaveText(
    "C:\\Example\\personal.sqlite",
  );
  // Wait for a normal subsequent read so a late completion is also checked.
  await page.getByRole("button", { name: "Back up now", exact: true }).click();
  await page.evaluate(() =>
    (window as unknown as { finishBackup: () => void }).finishBackup(),
  );
  await expect(
    page.getByRole("button", { name: "Back up now", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".data-path")).toHaveText(
    "C:\\Example\\personal.sqlite",
  );
});

for (const [id, name, scheme] of [
  ["light", "Light", "light"],
  ["dark", "Dark", "dark"],
  ["slate", "Slate", "dark"],
  ["neon", "Neon", "dark"],
  ["synthwave", "Synthwave", "dark"],
  ["terminal", "Robotic Terminal", "dark"],
  ["catppuccin-mocha", "Catppuccin Mocha", "dark"],
  ["catppuccin-latte", "Catppuccin Latte", "light"],
  ["gruvbox", "Gruvbox", "dark"],
  ["tokyo-night", "Tokyo Night", "dark"],
  ["dracula", "Dracula", "dark"],
  ["marshmallow", "Marshmallow", "light"],
  ["pewter", "Pewter", "light"],
  ["pebble", "Pebble", "light"],
]) {
  test(`${name} theme persists, remains readable, and covers the entry dialog`, async ({
    page,
  }) => {
    await setup(page);
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.getByRole("radio")).toHaveCount(14);
    if (scheme === "light")
      await page.getByRole("radio", { name: "Dark", exact: true }).check();
    await page.getByRole("radio", { name, exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await expect(page.getByRole("radio", { name, exact: true })).toBeChecked();
    await expect(
      page.getByRole("heading", { name: "Appearance", exact: true }),
    ).toBeVisible();
    if (id === "marshmallow")
      await page
        .locator(".appearance-panel")
        .screenshot({ path: ".qa/theme-picker.png" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await expect(
      page.getByRole("heading", { name: "Monthly overview" }),
    ).toBeVisible();
    await expect(page.getByText("$2,532.72", { exact: true })).toBeVisible();
    const nativeTheme = await page.evaluate(() =>
      (
        window as unknown as {
          calls: { cmd: string; args: Record<string, unknown> }[];
        }
      ).calls
        .filter((call) => call.cmd === "set_native_theme")
        .at(-1),
    );
    expect(nativeTheme?.args).toEqual({ dark: scheme === "dark" });
    const pairs = await page.evaluate(() => {
      const style = (selector: string) =>
        getComputedStyle(document.querySelector(selector)!);
      return [
        [style("html").color, style("html").backgroundColor],
        [style(".panel-heading p").color, style(".panel").backgroundColor],
        [style(".date-cell").color, style(".panel").backgroundColor],
        [style(".primary").color, style(".primary").backgroundColor],
        [style(".over").color, style(".panel").backgroundColor],
      ];
    });
    for (const [foreground, background] of pairs)
      expect(
        contrastRatio(foreground, background),
        `${name}: ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    if (["pewter", "pebble"].includes(id)) {
      const surfaces = await page.evaluate(() =>
        [
          "html",
          ".sidebar",
          ".panel",
          ".hero-card",
          ".metric-card:nth-child(2)",
          ".metric-card:nth-child(3)",
        ].map((selector) => {
          const style = getComputedStyle(document.querySelector(selector)!);
          return [selector, style.backgroundColor, style.color];
        }),
      );
      for (const [selector, background, foreground] of surfaces) {
        // Protect the requested middle ground: neither white nor a dark palette.
        const luminance = (contrastRatio(background, "rgb(0, 0, 0)") - 1) / 20;
        expect(luminance, `${name} ${selector} brightness`).toBeGreaterThan(
          0.25,
        );
        expect(luminance, `${name} ${selector} brightness`).toBeLessThan(0.75);
        expect(
          contrastRatio(foreground, background),
          `${name} ${selector} text`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      const hero = await page.evaluate(() => {
        const style = getComputedStyle(
          document.querySelector(".hero-caption")!,
        );
        return [
          style.color,
          getComputedStyle(document.querySelector(".hero-card")!)
            .backgroundColor,
        ];
      });
      expect(
        contrastRatio(hero[0], hero[1]),
        `${name} hero caption`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: `.qa/theme-${id}.png` });
    await page
      .getByRole("button", { name: "Help: Monthly overview", exact: true })
      .focus();
    const helpColors = await page.getByRole("tooltip").evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.color, style.backgroundColor];
    });
    expect(
      contrastRatio(helpColors[0], helpColors[1]),
      `${name} help contrast`,
    ).toBeGreaterThanOrEqual(4.5);
    await expect(page.getByRole("tooltip")).toBeInViewport();
    await page.screenshot({ path: `.qa/help-${id}.png` });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Add expense", exact: true })
      .click();
    await page.getByLabel("Description", { exact: true }).fill("Reject me");
    await page.getByLabel("Full amount").fill("100.00");
    await page.getByRole("button", { name: "Save entry", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Validation rejected this entry.",
    );
    const dialog = await page.evaluate(() => {
      const modal = getComputedStyle(document.querySelector("dialog")!);
      const input = getComputedStyle(document.querySelector("dialog input")!);
      const alert = getComputedStyle(document.querySelector("[role=alert]")!);
      return {
        scheme: getComputedStyle(document.documentElement).colorScheme,
        pairs: [
          [modal.color, modal.backgroundColor],
          [input.color, input.backgroundColor],
          [alert.color, alert.backgroundColor],
        ],
      };
    });
    expect(dialog.scheme).toBe(scheme);
    for (const [foreground, background] of dialog.pairs)
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `.qa/theme-${id}-dialog.png` });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.getByRole("radio", { name, exact: true })).toBeChecked();
    await page.setViewportSize({ width: 1000, height: 700 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    const lastOption = page.getByRole("radio", {
      name: "Pebble",
      exact: true,
    });
    await lastOption.scrollIntoViewIfNeeded();
    await expect(lastOption).toBeInViewport();
  });
}

test("theme selection works with the keyboard and invalid saved themes fall back to Light", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    localStorage.setItem("appearance-theme", "obsolete"),
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("radio", { name: "Light", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Dark", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Personal workspace Personal records" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("dashboard cards remain separated in wide and compact layouts", async ({
  page,
}) => {
  await setup(page);
  const recent = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "Recent activity", exact: true }),
  });
  for (const theme of ["light", "dracula", "marshmallow"]) {
    await page.evaluate((value) => {
      localStorage.setItem("appearance-theme", value);
    }, theme);
    await page.reload();
    await expect(page.locator(".hero-amount")).toHaveText("$2,532.72");
    for (const width of [1440, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      const bills = (await page.locator(".bill-overview").boundingBox())!;
      const goals = (await page.locator(".goal-overview").boundingBox())!;
      const activity = (await recent.boundingBox())!;
      // Adjacent cards must have visible breathing room on either layout axis.
      const separation = Math.max(
        goals.x - (bills.x + bills.width),
        goals.y - (bills.y + bills.height),
      );
      expect(
        separation,
        `${theme} / ${width}: bills and goals`,
      ).toBeGreaterThanOrEqual(16);
      expect(
        activity.y - Math.max(bills.y + bills.height, goals.y + goals.height),
        `${theme} / ${width}: goals and activity`,
      ).toBeGreaterThanOrEqual(16);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: `.qa/dashboard-spacing-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  }
});

test("dashboard, month navigation, search, and compact window layout", async ({
  page,
}) => {
  await setup(page);
  await page.screenshot({ path: ".qa/overview.png", fullPage: true });
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search transactions" })
    .fill("Whole Foods");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /^Whole Foods Market You paid/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Shared expenses", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Shared transaction history" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: ".qa/shared-compact.png", fullPage: true });
});

test("expense form sends decimal strings and personal/shared ownership to Rust", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page
    .getByLabel("Description", { exact: true })
    .fill("UI smoke purchase");
  await page.getByLabel("Full amount").fill("100.00");
  await page
    .getByRole("combobox", { name: "Split", exact: true })
    .selectOption("shared");
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("groceries");
  await expect(
    page.getByRole("dialog").getByText("$70.00", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".qa/add-expense.png" });
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const input = await page.evaluate(
    () =>
      (
        window as unknown as {
          calls: { cmd: string; args: { input: unknown } }[];
        }
      ).calls.find((c) => c.cmd === "save_entry")?.args.input,
  );
  expect(input).toMatchObject({
    amount: "100.00",
    payer: "jacob",
    splitMode: "shared",
    categoryId: "groceries",
    accountId: "capital-one",
    revision: 0,
  });
});

test("Chelsea-paid entry clears Jacob account and backend errors stay visible", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Reject me");
  await page.getByLabel("Full amount").fill("48");
  await page.getByLabel("Who paid?").selectOption("chelsea");
  await expect(page.getByLabel("Your account")).toHaveCount(0);
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Validation rejected this entry.",
  );
  const input = await page.evaluate(
    () =>
      (
        window as unknown as {
          calls: { cmd: string; args: { input: unknown } }[];
        }
      ).calls.find((c) => c.cmd === "save_entry")?.args.input,
  );
  expect(input).toMatchObject({
    payer: "chelsea",
    accountId: null,
    splitMode: "personal",
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("repayment form records PayPal holding without a checking deposit", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Record repayment", exact: true })
    .click();
  await page.getByLabel("Where is the money now?").selectOption("");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  const input = await page.evaluate(
    () =>
      (
        window as unknown as {
          calls: { cmd: string; args: { input: unknown } }[];
        }
      ).calls.find((c) => c.cmd === "save_entry")?.args.input,
  );
  expect(input).toMatchObject({
    amount: "34.41",
    kind: "settlement",
    payer: "chelsea",
    accountId: null,
    categoryId: null,
  });
});

test("budget editor saves an explicitly selected monthly limit", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Monthly budget", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit Groceries budget" }).click();
  await page.getByLabel("Monthly limit ($)").fill("750.00");
  await page.getByRole("button", { name: "Save limit" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const call = await page.evaluate(() =>
    (
      window as unknown as { calls: { cmd: string; args: unknown }[] }
    ).calls.find((c) => c.cmd === "set_budget"),
  );
  expect(call?.args).toMatchObject({
    category: "groceries",
    amount: "750.00",
    workspace: "demo",
  });
});

test("setup creates savings accounts and custom categories used by entry forms", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Accounts & categories", exact: true })
    .click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill("Gift Fund");
  await page
    .getByRole("combobox", { name: "Account type", exact: true })
    .selectOption("savings");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Gift Fund" }),
  ).toContainText("Savings");
  await page.screenshot({ path: ".qa/setup-accounts.png" });
  await page.getByRole("tab", { name: "Accounts", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Categories & defaults" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Category name", { exact: true }).fill("Electric bill");
  await page
    .getByLabel("Default monthly limit ($)", { exact: true })
    .fill("125.50");
  await page
    .getByRole("combobox", { name: "Category icon", exact: true })
    .selectOption("electric");
  await page.getByLabel("Category color", { exact: true }).fill("#719bae");
  await page.screenshot({ path: ".qa/setup-category-dialog.png" });
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "Electric bill" }),
  ).toContainText("$125.50");
  await page.screenshot({ path: ".qa/setup-categories.png" });
  await page.setViewportSize({ width: 1000, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: ".qa/setup-compact.png" });
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption({ label: "Electric bill" });
  await expect(page.locator(".category-field-label svg")).toHaveClass(
    /lucide-zap/,
  );
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Your account", exact: true })
    .selectOption({ label: "Gift Fund · savings" });
  await page.getByLabel("Income source").fill("Interest");
  await page.getByLabel("Full amount").fill("5.25");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          calls: { cmd: string; args: { input: Record<string, unknown> } }[];
        }
      ).calls,
  );
  const account = calls.find((c) => c.cmd === "save_account")?.args.input;
  expect(calls.find((c) => c.cmd === "save_entry")?.args.input).toMatchObject({
    kind: "income",
    amount: "5.25",
    accountId: account?.id,
  });
  expect(
    calls.find((c) => c.cmd === "save_category")?.args.input,
  ).toMatchObject({
    name: "Electric bill",
    icon: "electric",
    defaultLimit: "125.50",
  });
});

test("archived setup items remain editable in history and are excluded from new entries", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Accounts & categories", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit account American Express" })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Account type", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("archived");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit account American Express" }),
  ).toHaveCount(0);
  await page.getByLabel("Show archived").check();
  await expect(
    page.getByRole("row").filter({ hasText: "American Express" }),
  ).toContainText("Archived");
  await page.getByRole("tab", { name: "Categories & defaults" }).click();
  await page.getByRole("button", { name: "Edit category Groceries" }).click();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("archived");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("button", { name: "Monthly budget", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit Groceries budget" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Edit Groceries budget" }),
  ).toContainText("$158.68");
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await expect(
    page.getByLabel("Your account").locator("option[value=amex]"),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("combobox", { name: "Category", exact: true })
      .locator("option[value=groceries]"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: /^Grocery run You paid/ }).click();
  await expect(page.getByLabel("Your account")).toHaveValue("amex");
  await expect(
    page.getByLabel("Your account").locator("option:checked"),
  ).toContainText("archived");
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("groceries");
});

test("budget copy defaults to keeping existing limits and permits explicit replacement", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Monthly budget", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy budget limits", exact: true })
    .click();
  await expect(
    page.getByLabel("Replace existing limits for this month"),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Copy limits", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Copy budget limits", exact: true })
    .click();
  await page.getByLabel("Copy from").selectOption("month");
  await page.getByLabel("Source month", { exact: true }).fill("2025-01");
  await page.getByLabel("Replace existing limits for this month").check();
  await page.screenshot({ path: ".qa/budget-copy-dialog.png" });
  await page.getByRole("button", { name: "Copy limits", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (
      window as unknown as { calls: { cmd: string; args: unknown }[] }
    ).calls.filter((c) => c.cmd === "apply_budget_template"),
  );
  expect(calls[0].args).toMatchObject({ sourceMonth: null, replace: false });
  expect(calls[1].args).toMatchObject({
    sourceMonth: "2025-01",
    replace: true,
  });
});

test("setup validation errors stay visible and no active accounts require setup", async ({
  page,
}) => {
  await setup(page, {
    ...fixture,
    accounts: fixture.accounts.map((a) => ({ ...a, archived: true })),
  });
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await expect(page.getByLabel("Your account")).toHaveValue("");
  await expect(
    page.getByText("Add or restore an account in Accounts & categories."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Accounts & categories", exact: true })
    .click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Account name", { exact: true }).fill("Reject account");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Account name already exists.",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("budget-period choice retains actual date, requires a reason and survives errors and declined discard", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Description", { exact: true }).fill("Reject me");
  await d.getByLabel("Full amount").fill("100");
  await d.getByLabel("Date", { exact: true }).fill("2026-10-15");
  await d.locator("summary").filter({ hasText: "Budget period" }).click();
  await d.getByLabel("Use a different budget month").check();
  await expect(d.getByLabel("Budget month", { exact: true })).toHaveValue(
    "2026-11",
  );
  await expect(d).toContainText("Actual date remains 2026-10-15");
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "save_entry").length,
    ),
  ).toBe(0);
  await d
    .getByLabel("Reason for budget override")
    .fill("Late October statement reviewed in November");
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Validation rejected");
  page.once("dialog", (dialog) => dialog.dismiss());
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(d).toBeVisible();
  await expect(d.getByLabel("Reason for budget override")).toHaveValue(
    "Late October statement reviewed in November",
  );
  await d.getByLabel("Description", { exact: true }).fill("Late purchase");
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(d).toHaveCount(0);
  const saved = await page.evaluate(
    () =>
      (window as any).calls.filter((c: any) => c.cmd === "save_entry").at(-1)
        .args.input,
  );
  expect(saved.date).toBe("2026-10-15");
  expect(saved.budgetOverride).toEqual({
    month: "2026-11",
    reason: "Late October statement reviewed in November",
  });
});

test("existing budget override is disclosed in the ledger and can be explicitly cleared", async ({
  page,
}) => {
  const data = {
    ...fixture,
    entries: [
      {
        ...fixture.entries[0],
        description: "Late groceries",
        date: "2026-10-15",
        budgetOverride: { month: "2026-11", reason: "Late source" },
      },
    ],
  };
  await setup(page, data);
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await expect(page.locator("tbody tr")).toContainText("Budget November 2026");
  await page
    .getByRole("button", { name: "Edit Late groceries", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("Budget month", { exact: true })).toHaveValue(
    "2026-11",
  );
  await d.getByLabel("Use a different budget month").uncheck();
  await expect(d).toContainText("That month must be open");
  await d.getByRole("button", { name: "Save entry", exact: true }).click();
  const saved = await page.evaluate(
    () =>
      (window as any).calls.find((c: any) => c.cmd === "save_entry").args.input,
  );
  expect(saved.date).toBe("2026-10-15");
  expect(saved.budgetOverride).toEqual({
    month: null,
    reason: "Return to the transaction month",
  });
});

test("budget-period disclosure fits compact light and dark entry forms", async ({
  page,
}) => {
  const data = {
    ...fixture,
    entries: [
      {
        ...fixture.entries[0],
        description: "Late groceries",
        date: "2026-10-15",
        budgetOverride: {
          month: "2026-11",
          reason: "Statement arrived after close",
        },
      },
    ],
  };
  await setup(page, data);
  await page.setViewportSize({ width: 1100, height: 900 });
  for (const theme of ["light", "dracula"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page
      .getByRole("button", { name: "Edit Late groceries", exact: true })
      .first()
      .click();
    const d = page.getByRole("dialog");
    await d.locator(".budget-period").scrollIntoViewIfNeeded();
    await expect(d.getByLabel("Reason for budget override")).toBeVisible();
    await page.screenshot({
      path: `.qa/budget-period-${theme}.png`,
      fullPage: true,
    });
    await d.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("weekly recap keeps a fixed prior visit while navigating and saves the next visit separately", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "finance-last-visit:demo:2026-11",
      JSON.stringify({
        version: 1,
        at: "2026-11-01T12:00:00Z",
        spent: 40000,
        income: 0,
        entries: 3,
        imports: 2,
      }),
    ),
  );
  await page.reload();
  const recap = page.getByRole("region", { name: "Changes since last visit" });
  await expect(recap).toBeVisible();
  await expect(recap).toContainText("+$112.28");
  await expect(recap).toContainText("Recorded entries");
  await expect(recap).toContainText("Sources needing review");
  await expect(recap).toContainText("−2");
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(recap).toContainText("+$112.28");
  await page.setViewportSize({ width: 1100, height: 780 });
  await recap.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".qa/weekly-recap-light.png" });
  expect(
    await recap.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  await page.reload();
  await expect(recap).toHaveCount(0);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("finance-last-visit:demo:2026-11")!),
  );
  expect(stored.spent).toBe(51228);
  expect(stored.entries).toBe(4);
});
test("weekly recap isolates months and workspaces and ignores damaged local preferences", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    localStorage.setItem(
      "finance-last-visit:demo:2026-11",
      JSON.stringify({
        version: 1,
        at: "2026-11-01T12:00:00Z",
        spent: 60000,
        income: 0,
        entries: 5,
        imports: 0,
      }),
    );
    localStorage.setItem("finance-last-visit:personal:2026-11", "malformed");
    localStorage.setItem("appearance-theme", "dark");
  });
  await page.reload();
  const recap = page.getByRole("region", { name: "Changes since last visit" });
  await expect(recap).toContainText("−$87.72");
  await page.setViewportSize({ width: 1100, height: 780 });
  await recap.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".qa/weekly-recap-dark.png" });
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(recap).toHaveCount(0);
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await expect(recap).toContainText("−$87.72");
  await page
    .getByRole("button", { name: "Workspace & backups", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Personal workspace Personal records/ })
    .click();
  await expect(recap).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Monthly overview" }),
  ).toBeVisible();
});
