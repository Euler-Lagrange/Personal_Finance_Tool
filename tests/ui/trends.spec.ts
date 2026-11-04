import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        w.calls.push({ cmd, args });
        if (cmd === "snapshot")
          return {
            workspace: args.workspace,
            month: args.month,
            entries: [],
            householdEntries: [],
            accounts: [],
            categories: [],
            spentCents: 0,
            consumptionCents: 0,
            debtPaymentCents: 0,
            incomeCents: 0,
            budgetCents: 0,
            remainingCents: 0,
            budgetConfigured: false,
            householdCents: 0,
            householdMonthSpentCents: 0,
            monthlyCount: 0,
            incompleteImports: 0,
            provisionalAllowanceCents: 0,
            unclassifiedCount: 0,
            pendingFundingCount: 0,
            fundingReviewEntries: [],
            goalExcludedCents: 0,
            allowanceCents: 0,
            dataPath: "synthetic.sqlite",
            backups: [],
          };
        if (cmd === "bill_month" || cmd === "list_goals") return [];
        const values = [
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          0,
          10000,
          -3000,
          5000,
          null,
        ];
        const months = values.map((n, i) => ({
          month: `${args.year}-${String(i + 1).padStart(2, "0")}`,
          status:
            i === 11
              ? "future"
              : i < 7
                ? "missing"
                : i === 10
                  ? "open"
                  : "closed",
          spentCents: n,
          unresolvedCount: i === 10 ? 1 : 0,
        }));
        if (cmd === "annual_report")
          return {
            year: args.year,
            months: months.map((m) => ({ ...m, totals: null })),
            closedMonths: 3,
            actualSpendingCents: 12000,
            averageClosedSpendingCents: 2333,
          };
        if (cmd === "trends_report") {
          if (w.failTrends) throw "Synthetic trend report unavailable";
          const row = (id: string, name: string) => ({
            id,
            name,
            months: values,
            totalCents: 12000,
            closedAverageCents: 2333,
          });
          const report = {
            year: args.year,
            months,
            categories: [row("groceries", `Groceries ${args.year}`)],
            merchants: [row("market", "Market #1")],
            incompleteImportCount: 1,
            entries: [
              {
                id: "a",
                date: `${args.year}-09-12`,
                month: `${args.year}-09`,
                description: "Market #1",
                merchantId: "market",
                kind: "expense",
                amountCents: 10000,
                categories: [{ categoryId: "groceries", amountCents: 10000 }],
              },
              {
                id: "b",
                date: `${args.year}-09-29`,
                month: `${args.year}-10`,
                description: "Late refund",
                merchantId: "market",
                kind: "refund",
                amountCents: -3000,
                categories: [{ categoryId: "groceries", amountCents: -3000 }],
              },
              {
                id: "c",
                date: `${args.year}-11-01`,
                month: `${args.year}-11`,
                description: "Market #1",
                merchantId: "market",
                kind: "expense",
                amountCents: 5000,
                categories: [{ categoryId: "groceries", amountCents: 5000 }],
              },
            ],
          };
          if (w.empty) {
            report.categories = [];
            report.merchants = [];
            report.entries = [];
          }
          if (w.delayYear === args.year)
            await new Promise((resolve) => (w.resolveTrends = resolve));
          return report;
        }
      },
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Annual reports", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Spending trends", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Spending trends", exact: true }),
  ).toBeVisible();
}
test("category and merchant drilldowns preserve negative months and actual dates", async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByText(/1 unresolved records/)).toBeVisible();
  await page
    .getByRole("button", { name: "Groceries 2026", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Groceries 2026", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /October 2026: -\$30.00/ }).click();
  const detail = page.getByRole("region", {
    name: "Contributing transactions",
  });
  await expect(detail).toContainText("2026-09-29");
  await expect(detail).toContainText("October 2026");
  await expect(detail).toContainText("1 records");
  await expect(detail).not.toContainText("2026-11-01");
  await expect(
    page.getByRole("button", { name: /July 2026: Not tracked/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /August 2026: \$0.00, Final/ }),
  ).toBeEnabled();
  await page.getByLabel("Group spending by").selectOption("merchants");
  await expect(
    page.getByText(/Refunds use the original merchant/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Market #1", exact: true }).click();
  await expect(detail).toContainText("Late refund");
  await page.getByLabel("Detail month").selectOption("");
  await expect(detail).toContainText("3 records");
  await expect(detail).toContainText("$120.00");
  expect(
    await page.evaluate(() =>
      (window as any).calls.filter((c: any) =>
        /^(save_|delete_|close_|reopen_|commit_)/.test(c.cmd),
      ),
    ),
  ).toEqual([]);
});
test("search empty state keeps explicit selection and clear resets the chart", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Groceries 2026", exact: true })
    .click();
  await page.getByLabel("Find a group").fill("unmatched");
  await expect(page.getByText("No groups match this search.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Groceries 2026", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all spending" }).click();
  await expect(
    page.getByRole("heading", { name: "All spending", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).empty = true));
  await page.getByLabel("Report year").fill("2025");
  await page.getByLabel("Find a group").fill("");
  await expect(
    page.getByText("No recorded spending in the tracked months of this year."),
  ).toBeVisible();
  await expect(
    page.getByText("No contributing transactions for this selection."),
  ).toBeVisible();
});
test("failed new year hides old money and retry loads the selected year", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => ((window as any).failTrends = true));
  await page.getByLabel("Report year").fill("2025");
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic trend report unavailable",
  );
  await expect(
    page.getByRole("region", { name: "Monthly spending trend" }),
  ).not.toBeVisible();
  await page.evaluate(() => ((window as any).failTrends = false));
  await page.getByRole("button", { name: "Retry trends" }).click();
  await expect(
    page.getByRole("button", { name: "Groceries 2025", exact: true }),
  ).toBeVisible();
});
test("delayed older year cannot replace current results", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => ((window as any).delayYear = 2025));
  await page.getByLabel("Report year").fill("2025");
  await expect(page.getByText("Loading spending trends...")).toBeVisible();
  await page.getByLabel("Report year").fill("2024");
  await expect(
    page.getByRole("button", { name: "Groceries 2024", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).resolveTrends());
  await expect(
    page.getByRole("button", { name: "Groceries 2024", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Groceries 2025", exact: true }),
  ).not.toBeVisible();
});
test("compact light and dark presentation keeps chart scrolling inside its panel", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".qa/trends-Light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(
    () => (document.documentElement.dataset.theme = "dracula"),
  );
  await page.getByLabel("Group spending by").selectOption("merchants");
  await page.screenshot({
    path: ".qa/trends-Dracula.png",
    fullPage: true,
    animations: "disabled",
  });
});
