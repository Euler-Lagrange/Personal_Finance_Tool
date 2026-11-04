import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, empty = false) {
  await page.addInitScript(
    ({ empty }) => {
      const w = window as any;
      w.isTauri = true;
      w.calls = [];
      const account = {
        id: "gift-account",
        name: "Gift savings",
        kind: "savings",
        activityCents: -20000,
        revision: 1,
        archived: false,
        trackingMode: "manual",
        balance: {
          checkpointDate: "2026-09-30",
          checkpointCents: 100000,
          knownChangeCents: -20000,
          estimatedCents: 80000,
          throughDate: "2026-11-03",
        },
      };
      w.goals = empty
        ? []
        : [
            {
              id: "gift",
              revision: 1,
              name: "Gift fund",
              accountId: account.id,
              accountName: account.name,
              accountArchived: false,
              targetCents: 150000,
              targetDate: "2027-01-01",
              monthlyCents: 10000,
              policy: "goal_only",
              archived: false,
              balance: account.balance,
            },
          ];
      w.funding = [];
      w.interest = false;
      w.pending = 0;
      w.excluded = 0;
      const entry = {
        id: "purchase",
        revision: 1,
        kind: "expense",
        date: "2026-11-02",
        description: "Birthday gift",
        amountCents: 30000,
        payer: "jacob",
        categoryId: "gifts",
        accountId: "amex",
        destinationAccountId: null,
        splitMode: "personal",
        splitValue: "",
        jacobCents: 30000,
        chelseaCents: 0,
        householdDeltaCents: 0,
        note: "",
        lines: [
          {
            id: "main",
            label: "Gift",
            categoryId: "gifts",
            amountCents: 30000,
            splitMode: "inherit",
            splitValue: "",
            jacobCents: 30000,
            chelseaCents: 0,
            originalLineId: null,
          },
        ],
      };
      w.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          w.calls.push({ cmd, args });
          if (cmd === "snapshot")
            return {
              workspace: args.workspace,
              month: args.month,
              entries: w.reviewElsewhere ? [] : [entry],
              fundingReviewEntries: w.reviewElsewhere ? [entry] : [],
              householdEntries: [],
              accounts: [
                account,
                {
                  ...account,
                  id: "pto-account",
                  name: "PTO savings",
                  balance: null,
                },
                {
                  id: "checking",
                  name: "Capital One 360",
                  kind: "checking",
                  activityCents: 20000,
                  revision: 1,
                  archived: false,
                },
                {
                  id: "amex",
                  name: "American Express",
                  kind: "credit",
                  activityCents: 30000,
                  revision: 1,
                  archived: false,
                },
              ],
              categories: [
                {
                  id: "gifts",
                  name: "Gifts",
                  groupName: "Wants",
                  color: "#bc8e96",
                  limitCents: 50000,
                  defaultLimitCents: 50000,
                  spentCents: 30000,
                  allowanceCents: 30000 - w.excluded,
                  goalExcludedCents: w.excluded,
                  revision: 1,
                  archived: false,
                  icon: "gifts",
                },
              ],
              spentCents: 30000,
              consumptionCents: 30000,
              allowanceCents: 30000 - w.excluded,
              goalExcludedCents: w.excluded,
              pendingFundingCount: w.reviewElsewhere ? 1 : w.pending,
              incomeCents: 0,
              budgetCents: 50000,
              budgetConfigured: true,
              remainingCents: 20000 + w.excluded,
              householdCents: 0,
              householdMonthSpentCents: 0,
              monthlyCount: 1,
              incompleteImports: 0,
              dataPath: "synthetic.sqlite",
              backups: [],
            };
          if (cmd === "bill_month") return [];
          if (cmd === "list_goals") return structuredClone(w.goals);
          if (cmd === "save_goal") {
            if (w.failGoal) throw "Goal settings changed. Reopen the goal.";
            const g = args.input;
            w.goals = [
              {
                ...g,
                revision: g.revision + 1,
                targetCents: Number(g.target) * 100,
                monthlyCents: Number(g.monthly) * 100,
                accountName: account.name,
                accountArchived: false,
                balance: account.balance,
              },
            ];
            return;
          }
          if (cmd === "funding_view")
            return {
              entry: { ...entry, revision: 1 + w.funding.length },
              rows: structuredClone(w.funding),
              withdrawals: [
                {
                  id: "withdrawal",
                  goalId: "gift",
                  date: "2026-11-01",
                  description: "Gift withdrawal",
                  amountCents: 20000,
                  availableCents: 20000,
                },
              ],
            };
          if (cmd === "save_funding") {
            if (w.failFunding)
              throw "This savings withdrawal is already allocated.";
            w.funding = args.request.rows.map((r: any) => ({
              ...r,
              eventId: "purchase",
              amountCents: Number(r.amount) * 100,
              policy: "goal_only",
              reviewed: !!r.withdrawalId,
              reason: r.withdrawalId
                ? ""
                : "Link the actual savings withdrawal.",
            }));
            w.pending = w.funding.filter((r: any) => !r.reviewed).length;
            w.excluded = w.funding
              .filter((r: any) => r.reviewed)
              .reduce((n: number, r: any) => n + r.amountCents, 0);
            return;
          }
          if (cmd === "goal_activity")
            return [
              {
                id: "interest",
                revision: w.interest ? 2 : 1,
                date: "2026-11-02",
                description: "Savings deposit",
                changeCents: 250,
                purpose: w.interest ? "Interest" : "Income / deposit",
                canLabelInterest: true,
              },
              {
                id: "withdrawal",
                revision: 1,
                date: "2026-11-01",
                description: "Gift withdrawal",
                changeCents: -20000,
                purpose: "Withdrawal",
                canLabelInterest: false,
              },
            ];
          if (cmd === "label_goal_interest") {
            w.interest = args.interest;
            return;
          }
          if (cmd === "balance_checkpoints") return [];
        },
      };
    },
    { empty },
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Savings goals", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Fund purchases from goals",
      exact: true,
    }),
  ).toBeVisible();
}
async function funding(page: Page) {
  await page
    .getByRole("button", { name: "Funding for Birthday gift", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Goal funding",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Add funding assignment", exact: true })
    .click();
  await dialog.getByLabel("Funded amount").fill("200.00");
  return dialog;
}
test("new goals use separate accounts and goal-only policy with retained edits after failure", async ({
  page,
}) => {
  await setup(page, true);
  await page.getByRole("button", { name: "New goal", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "New savings goal",
    exact: true,
  });
  await expect(
    dialog.getByRole("combobox", {
      name: "Funded purchase policy",
      exact: true,
    }),
  ).toHaveValue("goal_only");
  await dialog.getByLabel("Goal name").fill("Gift fund");
  await dialog.getByLabel("Target amount").fill("1500.00");
  await dialog.getByLabel("Monthly contribution plan").fill("100.00");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    (window as any).failGoal = true;
  });
  await dialog.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Goal settings changed",
  );
  await expect(dialog.getByLabel("Target amount")).toHaveValue("1500.00");
  await page.evaluate(() => {
    (window as any).failGoal = false;
  });
  await dialog.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Gift fund", exact: true }),
  ).toBeVisible();
  const writes = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_goal"),
  );
  expect(writes[1].args.input.policy).toBe("goal_only");
  expect(writes[1].args.input.accountId).toBe("gift-account");
});
test("funding requires explicit evidence review and retries one operation without losing choices", async ({
  page,
}) => {
  await setup(page);
  const dialog = await funding(page);
  await dialog
    .getByRole("combobox", { name: "Funding evidence", exact: true })
    .selectOption("withdrawal");
  await expect(
    dialog.getByRole("button", { name: "Save funding", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("I reviewed these assignments").check();
  await page.evaluate(() => {
    (window as any).failFunding = true;
  });
  await dialog
    .getByRole("button", { name: "Save funding", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("already allocated");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog.getByLabel("Funded amount")).toHaveValue("200.00");
  await page.evaluate(() => {
    (window as any).failFunding = false;
  });
  await dialog
    .getByRole("button", { name: "Save funding", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_funding"),
  );
  expect(calls[0].args.request.id).toBe(calls[1].args.request.id);
  expect(calls[1].args.request.rows[0].withdrawalId).toBe("withdrawal");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(page.locator(".hero-card")).toContainText("$100.00 used");
  await expect(page.locator(".hero-card")).toContainText("$200.00 goal-funded");
  await expect(page.locator(".metric-card").first()).toContainText(
    "$300.00 purchases",
  );
});
test("unsupported funding stays visible and changing assignments clears confirmation", async ({
  page,
}) => {
  await setup(page);
  const dialog = await funding(page);
  await dialog.getByLabel("I reviewed these assignments").check();
  await dialog.getByLabel("Funded amount").fill("150.00");
  await expect(
    dialog.getByLabel("I reviewed these assignments"),
  ).not.toBeChecked();
  await dialog.getByLabel("I reviewed these assignments").check();
  await dialog
    .getByRole("button", { name: "Save funding", exact: true })
    .click();
  await expect(
    page.getByText("1 goal funding assignments need review.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Funding for Birthday gift", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Goal funding", exact: true }),
  ).toContainText(
    "Saved assignment needs review: Link the actual savings withdrawal.",
  );
});
test("goal history labels interest explicitly and archiving retains history", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  const history = page.getByRole("dialog", {
    name: "Gift fund activity",
    exact: true,
  });
  await expect(history).toContainText("Withdrawal");
  await history
    .getByRole("button", { name: "Mark as interest", exact: true })
    .click();
  await expect(
    history.getByRole("button", { name: "Remove interest label", exact: true }),
  ).toBeVisible();
  await history
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit Gift fund", exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "Edit savings goal",
    exact: true,
  });
  await expect(
    edit.getByRole("combobox", { name: "Savings account", exact: true }),
  ).toBeDisabled();
  await edit.getByLabel("Archive goal").check();
  await edit.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Gift fund", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Show archived goals").check();
  await expect(
    page.getByRole("heading", { name: "Gift fund", exact: true }),
  ).toBeVisible();
});
test("goal cards and funding forms fit compact Light and Dracula layouts", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.screenshot({
    path: ".qa/goals-Light.png",
    animations: "disabled",
    fullPage: true,
  });
  const dialog = await funding(page);
  await dialog
    .getByRole("combobox", { name: "Funding evidence", exact: true })
    .selectOption("withdrawal");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dracula";
  });
  await page.screenshot({
    path: ".qa/funding-Dracula.png",
    animations: "disabled",
    fullPage: true,
  });
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await dialog.getByLabel("I reviewed these assignments").check();
  await expect(
    dialog.getByRole("button", { name: "Save funding", exact: true }),
  ).toBeEnabled();
});

test("a later refund month can open the original purchase's funding review", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).reviewElsewhere = true;
  });
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(
    page.getByText("1 goal funding assignments need review.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Funding for Birthday gift", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Goal funding", exact: true }),
  ).toContainText("Birthday gift");
});
