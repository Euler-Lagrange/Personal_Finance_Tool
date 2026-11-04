import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.monthClosed = false;
    w.changed = false;
    w.revision = 0;
    w.blocked = false;
    w.failClose = false;
    w.failRefresh = false;
    const category = {
      id: "gifts",
      name: "Gifts",
      groupName: "Wants",
      color: "#557788",
      limitCents: 50000,
      defaultLimitCents: 50000,
      spentCents: 30000,
      goalExcludedCents: 20000,
      allowanceCents: 10000,
      revision: 1,
      archived: false,
      icon: "gifts",
    };
    const totals = {
      spentCents: 30000,
      consumptionCents: 30000,
      debtPaymentCents: 0,
      incomeCents: 100000,
      cashRewardCents: 0,
      cardRewardCents: 0,
      goalExcludedCents: 20000,
      allowanceCents: 10000,
      budgetCents: 50000,
      remainingCents: 40000,
      savingsContributionCents: 20000,
      categories: [
        {
          id: "gifts",
          name: "Gifts",
          group: "Wants",
          limitCents: 50000,
          spentCents: 30000,
          goalExcludedCents: 20000,
          allowanceCents: 10000,
        },
      ],
    };
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        w.calls.push({ cmd, args });
        if (cmd === "snapshot") {
          if (w.failRefresh) throw "Synthetic refresh unavailable";
          return {
            workspace: args.workspace,
            month: args.month,
            entries: [],
            householdEntries: [],
            accounts: [],
            categories: [category],
            spentCents: 30000,
            goalExcludedCents: 20000,
            allowanceCents: 10000,
            incomeCents: 100000,
            budgetCents: 50000,
            remainingCents: 40000,
            budgetConfigured: true,
            householdCents: 0,
            householdMonthSpentCents: 0,
            monthlyCount: 1,
            incompleteImports: 0,
            dataPath: "synthetic.sqlite",
            backups: [],
            period: w.revision
              ? {
                  closed: w.monthClosed,
                  changed: w.changed,
                  closedAt: "2026-11-03T12:00:00Z",
                }
              : null,
          };
        }
        if (cmd === "bill_month" || cmd === "list_goals") return [];
        if (cmd === "close_review")
          return {
            month: args.month,
            revision: w.revision,
            closed: w.monthClosed,
            closedAt: w.revision ? "2026-11-03T12:00:00Z" : null,
            changed: w.changed,
            token: "review-token",
            blockers: w.blocked
              ? [
                  {
                    id: "funding",
                    message: "Review 1 goal funding assignment before closing.",
                  },
                ]
              : [],
            warnings: [
              {
                id: "coverage:amex",
                message:
                  "Amex has incomplete confirmed transaction-date coverage. Accept the checked gap.",
              },
              {
                id: "reconciliation",
                message:
                  "I reviewed the month; optional balance reconciliation does not certify live balances.",
              },
            ],
            totals,
            previous: w.revision ? totals : null,
          };
        if (cmd === "close_month") {
          if (w.failClose) throw "Synthetic close failure";
          w.monthClosed = true;
          w.changed = false;
          w.revision++;
          if (w.failAfterSave) w.failRefresh = true;
        }
        if (cmd === "reopen_month") {
          w.monthClosed = false;
          w.changed = true;
          w.revision++;
        }
        if (cmd === "annual_report") {
          const months = Array.from({ length: 12 }, (_, i) => ({
            month: `${args.year}-${String(i + 1).padStart(2, "0")}`,
            status:
              i === 8
                ? "closed"
                : i === 9
                  ? w.monthClosed
                    ? "closed"
                    : "open"
                  : i > 10
                    ? "future"
                    : "missing",
            changed: i === 9 && w.changed,
            totals:
              i === 9
                ? totals
                : i === 8
                  ? {
                      ...totals,
                      spentCents: 0,
                      consumptionCents: 0,
                      goalExcludedCents: 0,
                      allowanceCents: 0,
                      categories: [],
                    }
                  : null,
          }));
          const report = {
            year: args.year,
            months,
            closedMonths: w.monthClosed ? 2 : 1,
            actualSpendingCents: 30000,
            averageClosedSpendingCents: w.monthClosed ? 15000 : 0,
            averageClosedTotals: {
              ...totals,
              spentCents: 0,
              allowanceCents: 0,
              goalExcludedCents: 0,
              categories: [],
            },
          };
          if (w.delayYear === args.year)
            await new Promise((resolve) => (w.resolveYear = resolve));
          return report;
        }
      },
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Monthly budget", exact: true })
    .click();
}
async function review(page: Page) {
  await page
    .getByRole("button", { name: "Review month close", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Review and acknowledge",
      exact: true,
    }),
  ).toBeVisible();
  return dialog;
}
test("close requires every acknowledgement and retries the same operation with retained note", async ({
  page,
}) => {
  await setup(page);
  const d = await review(page);
  await expect(
    d.getByRole("button", { name: "Close month", exact: true }),
  ).toBeDisabled();
  await d.getByRole("checkbox").nth(0).check();
  await expect(
    d.getByRole("button", { name: "Close month", exact: true }),
  ).toBeDisabled();
  await d.getByRole("checkbox").nth(1).check();
  await d
    .getByLabel("Close note (optional)")
    .fill("Reviewed synthetic exports");
  await page.evaluate(() => ((window as any).failClose = true));
  await d.getByRole("button", { name: "Close month", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("failure");
  await expect(d.getByLabel("Close note (optional)")).toHaveValue(
    "Reviewed synthetic exports",
  );
  await page.evaluate(() => ((window as any).failClose = false));
  await d.getByRole("button", { name: "Close month", exact: true }).click();
  await expect(d).not.toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((x: any) => x.cmd === "close_month"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.input.id).toBe(calls[1].args.input.id);
  await expect(
    page.getByRole("button", { name: "Review / reopen month", exact: true }),
  ).toBeVisible();
});
test("blocking funding cannot be acknowledged away and reloading renews the checklist", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => ((window as any).blocked = true));
  const d = await review(page);
  for (const box of await d.getByRole("checkbox").all()) await box.check();
  await expect(
    d.getByRole("button", { name: "Close month", exact: true }),
  ).toBeDisabled();
  await expect(d).toContainText("Review 1 goal funding");
  await page.evaluate(() => ((window as any).blocked = false));
  await d
    .getByRole("button", { name: "Reload checklist", exact: true })
    .click();
  await expect(d.getByRole("checkbox").first()).not.toBeChecked();
  await expect(
    d.getByRole("button", { name: "Close month", exact: true }),
  ).toBeDisabled();
});
test("discard cancellation preserves choices and reopening requires an explicit reason", async ({
  page,
}) => {
  await setup(page);
  const d = await review(page);
  await d.getByLabel("Close note (optional)").fill("Keep this note");
  page.once("dialog", (dialog) => dialog.dismiss());
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(d).toBeVisible();
  for (const box of await d.getByRole("checkbox").all()) await box.check();
  await d.getByRole("button", { name: "Close month", exact: true }).click();
  await page
    .getByRole("button", { name: "Review / reopen month", exact: true })
    .click();
  const reopen = page.getByRole("dialog");
  await expect(
    reopen.getByRole("button", { name: "Reopen month", exact: true }),
  ).toBeDisabled();
  await reopen
    .getByLabel("Reason for reopening")
    .fill("Add late October purchase");
  await reopen
    .getByRole("button", { name: "Reopen month", exact: true })
    .click();
  await expect(
    page.getByText("Changed since close", { exact: true }),
  ).toBeVisible();
});
test("successful close followed by refresh failure does not resubmit the write", async ({
  page,
}) => {
  await setup(page);
  const d = await review(page);
  for (const box of await d.getByRole("checkbox").all()) await box.check();
  await page.evaluate(() => ((window as any).failAfterSave = true));
  await d.getByRole("button", { name: "Close month", exact: true }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByText(/Your change was saved, but the screen could not reload/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((x: any) => x.cmd === "close_month")
          .length,
    ),
  ).toBe(1);
});
test("annual report keeps actual goal purchases and closed-zero averages with missing months blank", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Annual reports", exact: true })
    .click();
  await expect(
    page.getByText("Average across 1 closed month", { exact: true }),
  ).toBeVisible();
  const table = page.getByRole("table").first();
  await expect(
    table.getByRole("row").filter({
      has: page.getByRole("rowheader", {
        name: "Actual spending",
        exact: true,
      }),
    }),
  ).toContainText("$300.00");
  await expect(
    table.getByRole("row").filter({
      has: page.getByRole("rowheader", {
        name: "Allowance used",
        exact: true,
      }),
    }),
  ).toContainText("$100.00");
  await expect(
    page.getByRole("button", { name: "Review September 2026", exact: true }),
  ).toHaveText("Final");
  await expect(table).toContainText("Not tracked");
  await page.setViewportSize({ width: 1100, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".qa/annual-Light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(
    () => (document.documentElement.dataset.theme = "dracula"),
  );
  await page
    .getByRole("button", { name: "Review October 2026", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: ".qa/month-close-Dracula.png",
    fullPage: true,
    animations: "disabled",
  });
});
