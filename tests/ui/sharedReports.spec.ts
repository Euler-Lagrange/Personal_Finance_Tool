import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.failGroup = false;
    w.failExport = false;
    const entry = (
      id: string,
      kind: string,
      payer: string,
      amount: number,
      delta: number,
    ) => ({
      id,
      revision: 1,
      kind,
      payer,
      date: "2026-11-02",
      description: id,
      amountCents: amount,
      householdDeltaCents: delta,
      jacobCents: kind === "settlement" ? 0 : amount * 0.7,
      chelseaCents: kind === "settlement" ? 0 : amount * 0.3,
      categoryId: kind === "settlement" ? null : "groceries",
      accountId: payer === "jacob" ? "amex" : null,
      destinationAccountId: null,
      splitMode: "shared",
      splitValue: "",
      note: "PRIVATE NOTE",
      lines: [],
    });
    const entries = [
      entry("Electric bill", "expense", "jacob", 10000, 3000),
      entry("Dinner", "expense", "chelsea", 4000, -2800),
      entry("PayPal repayment", "settlement", "chelsea", 2000, -2000),
    ];
    const rows = entries.map((e, i) => ({
      entry: e,
      date: e.date,
      description: e.description,
      kind: e.kind,
      group: i === 0 ? "bills" : i === 1 ? "everyday" : "unassigned",
      groupReason:
        i === 0
          ? "Fully linked to bill payments"
          : "No linked bill payment; can be changed",
      overrideGroup: null,
      fullCents: e.amountCents,
      jacobCents: e.jacobCents,
      chelseaCents: e.chelseaCents,
      deltaCents: e.householdDeltaCents,
      balanceCents: [8000, 5200, 3200][i],
    }));
    w.report = {
      workspace: "demo",
      month: null,
      generatedAt: "2026-11-03T00:00:00Z",
      openingDate: "2026-10-31",
      openingCents: 5000,
      openingAdjustmentCents: 0,
      closingCents: 3200,
      billsCents: 3000,
      everydayCents: -2800,
      unassignedCents: 0,
      repaymentCents: -2000,
      pendingCount: 0,
      incompleteSources: 0,
      rows,
    };
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        w.calls.push({ cmd, args });
        if (cmd === "snapshot")
          return {
            workspace: args.workspace,
            month: args.month,
            entries,
            householdEntries: entries,
            accounts: [
              {
                id: "amex",
                name: "Amex",
                kind: "credit",
                revision: 1,
                archived: false,
                activityCents: 10000,
              },
            ],
            categories: [
              {
                id: "groceries",
                name: "Groceries",
                groupName: "Needs",
                color: "#557788",
                limitCents: 10000,
                spentCents: 9800,
                defaultLimitCents: 10000,
                revision: 1,
                archived: false,
                icon: "cart",
              },
            ],
            spentCents: 9800,
            incomeCents: 0,
            budgetCents: 10000,
            budgetConfigured: true,
            remainingCents: 200,
            householdCents: 3200,
            householdMonthSpentCents: 14000,
            monthlyCount: 3,
            incompleteImports: 0,
            dataPath: "synthetic.sqlite",
            backups: [],
          };
        if (
          cmd === "list_goals" ||
          cmd === "bill_month" ||
          cmd === "paypal_receipts"
        )
          return [];
        if (cmd === "household_opening")
          return {
            revision: 1,
            date: "2026-10-31",
            amountCents: 5000,
            note: "",
          };
        if (cmd === "shared_statement") {
          const r = structuredClone({
            ...w.report,
            month: args.month,
            workspace: args.workspace,
          });
          if (!args.month) {
            r.openingCents = 0;
            r.openingAdjustmentCents = 5000;
            r.rows.unshift({
              entry: null,
              date: "2026-10-31",
              description: "Reconciled opening balance",
              kind: "opening",
              group: "opening",
              groupReason: "",
              overrideGroup: null,
              fullCents: 0,
              jacobCents: 0,
              chelseaCents: 0,
              deltaCents: 5000,
              balanceCents: 5000,
            });
          }
          if (w.delayReport && !args.month)
            await new Promise((resolve) => (w.resolveReport = resolve));
          return r;
        }
        if (cmd === "set_household_group") {
          if (w.failGroup) throw "Transaction changed. Reload before saving.";
          const r = w.report.rows.find((r: any) => r.entry.id === args.event);
          r.overrideGroup = args.group;
          r.group = args.group ?? "everyday";
          r.entry.revision++;
        }
        if (cmd === "export_shared_statement") {
          if (w.failExport) throw "Export folder is unavailable.";
          return `C:\\Synthetic\\shared-${args.workspace}-${args.month ?? "all"}.${args.format}`;
        }
      },
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Shared expenses", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Export printable statement",
      exact: true,
    }),
  ).toBeVisible();
}
test("filters preserve full-period running balances and exports ignore display filters", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator(".statement-scroll tbody tr")).toHaveCount(4);
  await page
    .getByRole("combobox", { name: "Show activity", exact: true })
    .selectOption("bills");
  await expect(page.locator(".statement-scroll tbody tr")).toHaveCount(1);
  await expect(page.locator(".statement-scroll tbody")).toContainText(
    "+$80.00",
  );
  await expect(page.locator(".statement-summary")).toContainText("+$32.00");
  await page
    .getByRole("combobox", { name: "Statement period", exact: true })
    .selectOption("month");
  await page
    .getByRole("button", { name: "Export printable statement", exact: true })
    .click();
  await expect(
    page.getByText("Statement saved", { exact: true }),
  ).toBeVisible();
  const call = await page.evaluate(() =>
    (window as any).calls.findLast(
      (x: any) => x.cmd === "export_shared_statement",
    ),
  );
  expect(call.args).toEqual({
    workspace: "demo",
    month: expect.stringMatching(/^\d{4}-\d{2}$/),
    format: "html",
  });
  await page
    .getByRole("button", { name: "Open export folder", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((x: any) => x.cmd === "open_statement_folder"),
    ),
  ).toBe(true);
});
test("group failures retain choices and declined discard retains the edit", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Group Dinner", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Activity group",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Reporting group", exact: true })
    .selectOption("bills");
  page.once("dialog", (d) => d.dismiss());
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() => ((window as any).failGroup = true));
  await dialog.getByRole("button", { name: "Save group", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Transaction changed");
  await expect(dialog.getByRole("combobox")).toHaveValue("bills");
  await page.evaluate(() => ((window as any).failGroup = false));
  await dialog.getByRole("button", { name: "Save group", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("combobox", { name: "Show activity", exact: true })
    .selectOption("bills");
  await expect(page.locator(".statement-scroll tbody tr")).toHaveCount(2);
});
test("repayment tags explain one balance and export errors permit retry", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Group PayPal repayment", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Activity group",
    exact: true,
  });
  await expect(dialog).toContainText(
    "It still reduces the one household balance",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => ((window as any).failExport = true));
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  await expect(
    page.locator(".shared-statement").getByRole("alert"),
  ).toContainText("unavailable");
  await page.evaluate(() => ((window as any).failExport = false));
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  await expect(page.locator(".statement-path")).toContainText(".csv");
});
test("late all-history response cannot replace the selected-month statement", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any;
    w.delayReport = true;
    w.report.pendingCount = 2;
  });
  await page.getByRole("button", { name: "Group Dinner", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save group", exact: true })
    .click();
  await expect(
    page.getByText("Loading statement...", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).report.pendingCount = 3));
  await page
    .getByRole("combobox", { name: "Statement period", exact: true })
    .selectOption("month");
  await expect(
    page.getByText(/Provisional: 3 recorded movements/),
  ).toBeVisible();
  await page.evaluate(() => (window as any).resolveReport());
  await expect(
    page.getByText(/Provisional: 3 recorded movements/),
  ).toBeVisible();
  await expect(page.getByText(/Provisional: 2 recorded movements/)).toHaveCount(
    0,
  );
});
test("shared statement is readable in compact light and Dracula views", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1100, height: 850 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".qa/shared-statement-Light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(
    () => (document.documentElement.dataset.theme = "dracula"),
  );
  await page
    .getByRole("button", { name: "Group Electric bill", exact: true })
    .click();
  await page.screenshot({
    path: ".qa/shared-statement-Dracula.png",
    fullPage: true,
    animations: "disabled",
  });
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Save group", exact: true }),
  ).toBeVisible();
});
