import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.fail = false;
    w.failRefresh = false;
    w.monthClosed = false;
    w.category = {
      id: "groceries",
      name: "Groceries",
      groupName: "Needs",
      color: "#557788",
      limitCents: 10000,
      defaultLimitCents: 10000,
      spentCents: 12000,
      allowanceCents: 12000,
      revision: 1,
      archived: false,
      icon: "groceries",
      rolloverCents: 5000,
      availableCents: 15000,
      rolloverMode: "carry",
      rolloverToken: "policy-token",
    };
    const totals = {
      spentCents: 12000,
      allowanceCents: 12000,
      goalExcludedCents: 0,
      incomeCents: 0,
      budgetCents: 15000,
      remainingCents: 3000,
      categories: [],
    };
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        w.calls.push({ cmd, args });
        if (cmd === "snapshot") {
          if (w.failRefresh) throw "Synthetic refresh failed";
          return {
            workspace: args.workspace,
            month: args.month,
            entries: [],
            householdEntries: [],
            accounts: [],
            ...totals,
            categories: [w.category],
            budgetConfigured: true,
            householdCents: 0,
            householdMonthSpentCents: 0,
            monthlyCount: 1,
            incompleteImports: 0,
            dataPath: "synthetic.sqlite",
            backups: [],
            period: {
              closed: w.monthClosed,
              changed: !w.monthClosed,
              closedAt: "2026-11-01T12:00:00Z",
            },
          };
        }
        if (cmd === "bill_month" || cmd === "list_goals") return [];
        if (cmd === "save_budget_plan") {
          if (w.fail) throw "Synthetic save unavailable";
          w.category = {
            ...w.category,
            limitCents: Math.round(Number(args.input.amount) * 100),
            rolloverMode: args.input.mode,
          };
          return;
        }
        if (cmd === "close_review") {
          const target = args.carryTarget || "2026-11";
          if (w.failTarget === target)
            throw "Synthetic destination review failed";
          const result = {
            month: args.month,
            revision: 2,
            closed: w.monthClosed,
            closedAt: "2026-11-01T12:00:00Z",
            changed: true,
            token: `token-${target}`,
            totals,
            previous: totals,
            blockers:
              target === "2026-09"
                ? [
                    {
                      id: "carry_target",
                      message: "The rollover destination is closed.",
                    },
                  ]
                : [],
            warnings: [
              {
                id: "rollover",
                message: "Apply the listed signed rollover differences.",
              },
              { id: "reconciliation", message: "I reviewed the month." },
            ],
            carry: {
              targetMonth: target,
              targetClosed: target === "2026-09",
              lines: [
                {
                  categoryId: "groceries",
                  name: "Groceries",
                  mode: "carry",
                  remainderCents: 3000,
                  outputCents: 3000,
                  previousCents: 5000,
                  deltaCents: -2000,
                },
              ],
              history: [
                {
                  sourceMonth: "2026-08",
                  targetMonth: "2026-09",
                  name: "Groceries",
                  amountCents: 5000,
                  reason: "Original carry",
                },
              ],
            },
          };
          if (w.delayTarget === target)
            await new Promise((resolve) => (w.resolveTarget = resolve));
          return result;
        }
        if (cmd === "close_month") {
          if (w.fail) throw "Synthetic close unavailable";
          w.monthClosed = true;
          return;
        }
      },
    };
  });
  await page.goto("/");
  // Use August so both historical and current destinations are valid UI choices.
  for (let i = 0; i < 3; i++)
    await page
      .getByRole("button", { name: "Previous month", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Monthly budget", exact: true })
    .click();
}

test("budget uses available allowance and preserves base limit, carry policy and retry identity", async ({
  page,
}) => {
  await setup(page);
  const category = page.getByRole("button", { name: "Edit Groceries budget" });
  await expect(category).toContainText("$30.00 left");
  await expect(category).toContainText(
    "Base $100.00; carry adjustments $50.00",
  );
  await category.click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("Monthly limit ($)", { exact: true })).toHaveValue(
    "100.00",
  );
  await d.getByLabel("Unused allowance and overspending").selectOption("reset");
  await d.getByLabel("Monthly limit ($)", { exact: true }).fill("150");
  await page.evaluate(() => {
    (window as any).fail = true;
  });
  await d.getByRole("button", { name: "Save limit", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("unavailable");
  await expect(d.getByLabel("Unused allowance and overspending")).toHaveValue(
    "reset",
  );
  await page.evaluate(() => {
    (window as any).fail = false;
  });
  await d.getByRole("button", { name: "Save limit", exact: true }).click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_budget_plan"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.input).toEqual(calls[1].args.input);
  expect(calls[0].args.input).toMatchObject({
    month: "2026-08",
    amount: "150",
    mode: "reset",
    previousLimitCents: 10000,
    policyToken: "policy-token",
  });
});

test("historical carry shows only the difference, renews confirmation on destination change and retries once", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Review month close", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d).toContainText("Previously applied");
  await expect(d).toContainText("-$20.00");
  await d
    .getByLabel("Reason for carry or correction")
    .fill("Late grocery correction");
  await d
    .getByLabel("Apply the listed signed rollover differences.", {
      exact: true,
    })
    .check();
  await d.getByLabel("I reviewed the month.", { exact: true }).check();
  await d
    .getByLabel("Apply rollover differences to", { exact: true })
    .fill("2026-09");
  await expect(d).toContainText("The rollover destination is closed.");
  await expect(
    d.getByLabel("Apply the listed signed rollover differences.", {
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    d.getByRole("button", { name: "Close month", exact: true }),
  ).toBeDisabled();
  await d
    .getByLabel("Apply rollover differences to", { exact: true })
    .fill("2026-11");
  await expect(
    d.getByRole("heading", { name: "Resolve before closing" }),
  ).toHaveCount(0);
  await d
    .getByLabel("Apply the listed signed rollover differences.", {
      exact: true,
    })
    .check();
  await d.getByLabel("I reviewed the month.", { exact: true }).check();
  await page.evaluate(() => {
    (window as any).fail = true;
  });
  await d.getByRole("button", { name: "Close month", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("unavailable");
  await page.evaluate(() => {
    (window as any).fail = false;
  });
  await d.getByRole("button", { name: "Close month", exact: true }).click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "close_month"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.input).toEqual(calls[1].args.input);
  expect(calls[0].args.input.carry).toEqual({
    targetMonth: "2026-11",
    reason: "Late grocery correction",
  });
});

test("discard keeps edited budget and successful save with failed refresh never resubmits", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Edit Groceries budget" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Monthly limit ($)", { exact: true }).fill("160");
  page.once("dialog", (dialog) => dialog.dismiss());
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(d).toBeVisible();
  await page.evaluate(() => {
    (window as any).failRefresh = true;
  });
  await d.getByRole("button", { name: "Save limit", exact: true }).click();
  await expect(d).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "save_budget_plan")
          .length,
    ),
  ).toBe(1);
});

test("compact carry and policy review remain readable in light and dark themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  await setup(page);
  for (const theme of ["Light", "Dracula"]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name: theme, exact: true }).click();
    await page
      .getByRole("button", { name: "Monthly budget", exact: true })
      .click();
    await page.getByRole("button", { name: "Edit Groceries budget" }).click();
    await page.screenshot({
      path: `.qa/rollover-policy-${theme}.png`,
      fullPage: true,
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review month close", exact: true })
      .click();
    const d = page.getByRole("dialog");
    await expect(d.getByLabel("Reason for carry or correction")).toBeVisible();
    await page.screenshot({
      path: `.qa/rollover-close-${theme}.png`,
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

test("failed destination review cannot submit an earlier preview", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Review month close", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("Reason for carry or correction")).toBeVisible();
  await page.evaluate(() => {
    (window as any).failTarget = "2026-10";
  });
  await d
    .getByLabel("Apply rollover differences to", { exact: true })
    .fill("2026-10");
  await expect(d.getByRole("alert")).toContainText("destination review failed");
  await expect(
    d.getByLabel("Apply the listed signed rollover differences.", {
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    d.getByRole("button", { name: "Close month", exact: true }),
  ).toBeDisabled();
  await d
    .getByLabel("Apply rollover differences to", { exact: true })
    .fill("2026-11");
  await expect(d.getByRole("alert")).toHaveCount(0);
  await d
    .getByLabel("Apply the listed signed rollover differences.", {
      exact: true,
    })
    .check();
  await d.getByLabel("I reviewed the month.", { exact: true }).check();
  await expect(
    d.getByRole("button", { name: "Close month", exact: true }),
  ).toBeEnabled();
});
