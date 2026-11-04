import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.settings = { revision: 0, funding: [] };
    w.forecast = {
      accountId: "checking",
      asOf: "2026-11-03",
      through: "2026-12-03",
      settings: w.settings,
      opening: {
        balanceCents: 100000,
        checkpointDate: "2026-10-31",
        checkpointCents: 120000,
        changeCents: -20000,
        complete: false,
        gaps: [{ start: "2026-11-01", end: "2026-11-03" }],
        assumedDateCount: 1,
        unresolvedCount: 0,
        coverageSources: [],
      },
      lastObservedAt: "2026-11-02T12:00:00Z",
      rows: [
        {
          id: "pay",
          date: "2026-11-06",
          name: "Synthetic payroll",
          source: "income",
          amountCents: 100000,
          included: true,
          reason: "Expected net pay",
          runningCents: 200000,
        },
        {
          id: "bill",
          date: "2026-11-07",
          name: "Synthetic shared rent",
          source: "bill",
          amountCents: -100000,
          included: true,
          reason: "Full checking bill including shared amount",
          runningCents: 100000,
        },
        {
          id: "card",
          date: "2026-11-15",
          name: "Synthetic partial statement",
          source: "card_payment",
          amountCents: -40000,
          included: true,
          reason: "Incremental remaining obligation",
          runningCents: 60000,
        },
        {
          id: "held",
          date: "2026-11-15",
          name: "Unreviewed synthetic statement",
          source: "card_payment",
          amountCents: null,
          included: false,
          reason: "Review statement payments before projecting again",
          runningCents: null,
        },
      ],
      warnings: [
        "Coverage has gaps. These are known-plan subtotals, not a live bank balance.",
        "American Express needs a checking payment account.",
      ],
      endingKnownCents: 60000,
      lowestKnownCents: 60000,
      nextPayDate: "2026-11-06",
      beforeNextPayCents: 100000,
      incomplete: true,
    };
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        w.calls.push({ cmd, args: structuredClone(args) });
        if (cmd === "snapshot") {
          if (w.failRefresh) throw "Synthetic refresh failed";
          return {
            workspace: args.workspace,
            month: args.month,
            entries: [],
            householdEntries: [],
            accounts: [
              {
                id: "checking",
                name: "Capital One 360",
                kind: "checking",
                archived: false,
                revision: 1,
                activityCents: 0,
                trackingMode: "imported",
                balance: null,
              },
              {
                id: "amex",
                name: "American Express",
                kind: "credit",
                archived: false,
                revision: 1,
                activityCents: 0,
                trackingMode: "manual",
                balance: null,
              },
            ],
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
            dataPath: `synthetic-${args.workspace}.sqlite`,
            backups: [],
          };
        }

        if (cmd === "bill_month" || cmd === "list_goals") return [];
        if (cmd === "cash_forecast") {
          if (w.failRead) throw "Synthetic forecast read failed";
          const result = structuredClone(w.forecast);
          result.settings = structuredClone(w.settings);
          if (args.workspace === "personal") {
            result.rows = [];
            result.opening.balanceCents = null;
            result.opening.checkpointDate = null;
            result.endingKnownCents = null;
            result.lowestKnownCents = null;
            result.nextPayDate = null;
            result.beforeNextPayCents = null;
          }
          if (w.delay && args.workspace === "demo")
            return new Promise((resolve) => {
              w.finish = () => resolve(result);
            });
          return result;
        }
        if (cmd === "save_forecast_settings") {
          if (w.failWrite) throw "Synthetic forecast write failed";
          w.settings = structuredClone(args.input);
          w.settings.revision++;
          if (w.failAfterSave) w.failRead = true;
          return;
        }
      },
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Cash timeline", exact: true })
    .click();
  await expect(
    page
      .getByRole("heading", { name: "Checking cash timeline", exact: true })
      .last(),
  ).toBeVisible();
}
test("forecast separates cash assumptions, review items and budget room", async ({
  page,
}) => {
  await setup(page);
  await expect(
    page.getByRole("heading", { name: "1 item needs review" }),
  ).toBeVisible();
  await expect(
    page.getByText("Unreviewed synthetic statement", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText("Unreviewed synthetic statement"),
  ).toHaveCount(0);
  await expect(page.getByRole("table")).toContainText("-$1,000.00");
  await expect(
    page.getByText("Personal monthly allowance, separate from checking cash."),
  ).toBeVisible();
  await page.getByLabel("Forecast horizon").selectOption("90");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).calls
            .filter((c: any) => c.cmd === "cash_forecast")
            .at(-1).args.days,
      ),
    )
    .toBe(90);
  expect(
    await page.evaluate(() =>
      (window as any).calls.some(
        (c: any) => c.cmd.startsWith("save_") || c.cmd === "cash_month",
      ),
    ),
  ).toBe(false);
});
test("funding changes guard dirty close, preserve failed retry identity and recover read after success", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Card payment accounts", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "American Express", exact: true })
    .selectOption("checking");
  page.once("dialog", (dialog) => dialog.dismiss());
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(d).toBeVisible();
  await page.evaluate(() => ((window as any).failWrite = true));
  await d.getByRole("button", { name: "Save payment accounts" }).click();
  await expect(d.getByRole("alert")).toContainText("write failed");
  await page.evaluate(() => {
    (window as any).failWrite = false;
    (window as any).failAfterSave = true;
  });
  await d.getByRole("button", { name: "Save payment accounts" }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("read failed");
  const calls = await page.evaluate(() =>
    (window as any).calls.filter(
      (c: any) => c.cmd === "save_forecast_settings",
    ),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  await page.evaluate(() => ((window as any).failRead = false));
  await page.getByRole("button", { name: "Retry forecast" }).click();
  await page
    .getByRole("button", { name: "Card payment accounts", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("combobox", { name: "American Express", exact: true }),
  ).toHaveValue("checking");
});
test("late forecast response cannot replace a newly selected workspace", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => ((window as any).delay = true));
  await page.getByLabel("Forecast horizon").selectOption("60");
  await expect(page.getByText("Calculating known cash plans...")).toBeVisible();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Cash timeline", exact: true })
    .click();
  await page.evaluate(() => (window as any).finish());
  await expect(
    page.getByText("Synthetic payroll", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "No included cash movements in this horizon. Configure Cash plans, Bills and Card statements.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("No known opening balance.", { exact: false }),
  ).toBeVisible();
});
test("forecast compact Light and Dracula layouts keep amounts and assumptions visible", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.screenshot({
    path: ".qa/cash-forecast-Light.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page
      .locator(".cash-forecast")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.evaluate(
    () => (document.documentElement.dataset.theme = "dracula"),
  );
  await page.screenshot({
    path: ".qa/cash-forecast-Dracula.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Card payment accounts", exact: true })
    .click();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});
