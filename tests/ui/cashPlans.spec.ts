import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    const plan = {
      name: "Payroll",
      kind: "income",
      amount: "1000",
      accountId: "checking",
      destinationAccountId: null,
      payer: "jacob",
    };
    w.schedule = {
      id: "schedule-1",
      revision: 1,
      anchor: "2026-11-01",
      cadence: "biweekly",
      secondDay: null,
      endDate: null,
      archived: false,
      plan,
    };
    w.event = {
      id: "event-1",
      scheduleId: "schedule-1",
      slot: "2026-11-01:0",
      scheduledDate: "2026-11-01",
      dueDate: "2026-11-01",
      revision: 1,
      plan,
      cancelled: false,
      note: "",
      actual: null,
    };
    w.candidates = [
      {
        id: "actual-1",
        revision: 1,
        date: "2026-11-01",
        description: "Payroll deposit",
        amountCents: 97500,
        suggested: false,
      },
      {
        id: "actual-2",
        revision: 1,
        date: "2026-11-01",
        description: "Other deposit",
        amountCents: 100000,
        suggested: true,
      },
    ];
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
                id: "savings",
                name: "Gift savings",
                kind: "savings",
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
        if (cmd === "cash_month") {
          if (w.failRead) throw "Synthetic plans unavailable";
          const result =
            args.workspace === "personal"
              ? { schedules: [], occurrences: [] }
              : {
                  schedules: [structuredClone(w.schedule)],
                  occurrences:
                    args.month === "2026-11" ? [structuredClone(w.event)] : [],
                };
          if (w.delayMonth === args.month && args.workspace === "demo")
            await new Promise((resolve) => (w.finishMonth = resolve));
          return result;
        }
        if (cmd === "cash_candidates") {
          if (w.failCandidates) throw "Synthetic candidates unavailable";
          return w.candidates;
        }
        if (
          [
            "save_cash_schedule",
            "save_cash_occurrence",
            "match_cash",
            "record_cash",
            "unmatch_cash",
          ].includes(cmd)
        ) {
          if (w.failWrite) throw "Synthetic write failure";
          if (cmd === "save_cash_schedule")
            w.schedule = { ...args.input, revision: args.input.revision + 1 };
          if (cmd === "save_cash_occurrence")
            w.event = {
              ...w.event,
              ...args.input,
              revision: w.event.revision + 1,
            };
          if (cmd === "match_cash") {
            w.event.actual = w.candidates.find(
              (c: any) => c.id === args.input.eventId,
            );
            w.event.revision++;
          }
          if (cmd === "record_cash") {
            const e = args.input.entry;
            w.event.actual = {
              id: e.id,
              revision: 1,
              date: e.date,
              description: e.description,
              amountCents: Math.round(Number(e.amount) * 100),
              suggested: false,
            };
            w.event.revision++;
          }
          if (cmd === "unmatch_cash") {
            w.event.actual = null;
            w.event.revision++;
          }
        }
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Cash plans", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Expected this month" }),
  ).toBeVisible();
}
test("new pay schedule uses anchored cadence, retains errors and retries one operation", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add cash plan" }).click();
  const d = page.getByRole("dialog");
  await expect(
    d.getByRole("combobox", { name: "Cadence", exact: true }),
  ).toHaveValue("biweekly");
  await d.getByLabel("Name", { exact: true }).fill("Job pay");
  await d.getByLabel("Expected amount").fill("5363.90");
  await d.getByLabel("First scheduled date").fill("2026-11-06");
  await page.evaluate(() => ((window as any).failWrite = true));
  await d.getByRole("button", { name: "Save cash plan", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Synthetic write failure");
  await expect(d.getByLabel("Expected amount")).toHaveValue("5363.90");
  page.once("dialog", (x) => x.dismiss());
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(d).toBeVisible();
  await page.evaluate(() => ((window as any).failWrite = false));
  await d.getByRole("button", { name: "Save cash plan", exact: true }).click();
  await expect(d).not.toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_cash_schedule"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.input).toMatchObject({
    anchor: "2026-11-06",
    cadence: "biweekly",
    secondDay: null,
    plan: { kind: "income", amount: "5363.90", accountId: "checking" },
  });
});
test("matching requires an explicit transaction and shows variance without recording money", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => ((window as any).failCandidates = true));
  await page
    .getByRole("button", { name: "Match transaction", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d.getByRole("alert")).toContainText("candidates unavailable");
  await page.evaluate(() => ((window as any).failCandidates = false));
  await d.getByRole("button", { name: "Retry candidates" }).click();
  await expect(d.getByLabel("Recorded transaction")).toHaveValue("");
  await expect(
    d.getByRole("button", { name: "Match transaction", exact: true }),
  ).toBeDisabled();
  await d.getByLabel("Recorded transaction").selectOption("actual-2");
  await d.getByRole("checkbox").check();
  await d.getByLabel("Recorded transaction").selectOption("actual-1");
  await expect(d.getByRole("checkbox")).not.toBeChecked();
  await expect(d).toContainText("-$25.00");
  await d.getByRole("checkbox").check();
  await d
    .getByRole("button", { name: "Match transaction", exact: true })
    .click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "Planned events" }),
  ).toContainText("Actual 2026-11-01");
  const calls = await page.evaluate(() => (window as any).calls);
  expect(calls.filter((c: any) => c.cmd === "match_cash")).toHaveLength(1);
  expect(
    calls.filter((c: any) => ["save_entry", "record_cash"].includes(c.cmd)),
  ).toHaveLength(0);
});
test("record actual retains the original date and clears confirmation after edits", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Record actual", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Actual amount").fill("1050.25");
  await d
    .getByRole("checkbox", {
      name: "This happened and needs a new transaction",
    })
    .check();
  await d.getByLabel("Actual date").fill("2026-10-31");
  await expect(
    d.getByRole("button", { name: "Record and match", exact: true }),
  ).toBeDisabled();
  await d.locator("summary").click();
  await d.getByLabel("Use a different budget month").check();
  await d
    .getByLabel("Reason for budget override")
    .fill("Late source after close");
  await d
    .getByRole("checkbox", {
      name: "This happened and needs a new transaction",
    })
    .check();
  await page.evaluate(() => ((window as any).failWrite = true));
  await d
    .getByRole("button", { name: "Record and match", exact: true })
    .click();
  await expect(d.getByRole("alert")).toContainText("write failure");
  await page.evaluate(() => ((window as any).failWrite = false));
  await d
    .getByRole("button", { name: "Record and match", exact: true })
    .click();
  await expect(d).not.toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "record_cash"),
  );
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.input.entry).toMatchObject({
    kind: "income",
    date: "2026-10-31",
    amount: "1050.25",
    accountId: "checking",
    budgetOverride: { month: "2026-11", reason: "Late source after close" },
  });
});
test("event override and matched unlink preserve drafts and require deliberate actions", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Edit Payroll on 2026-11-01" })
    .click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Expected date").fill("2026-11-02");
  await d.getByLabel("Expected amount").fill("1250");
  await d.getByLabel("Plan note").fill("Holiday override");
  page.once("dialog", (x) => x.dismiss());
  await d.getByRole("button", { name: "Close dialog" }).click();
  await expect(d).toBeVisible();
  await d
    .getByRole("button", { name: "Save planned event", exact: true })
    .click();
  await expect(d).not.toBeVisible();
  await page
    .getByRole("button", { name: "Match transaction", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.getByLabel("Recorded transaction").selectOption("actual-1");
  await d.getByRole("checkbox").check();
  await d
    .getByRole("button", { name: "Match transaction", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit Payroll on 2026-11-02" })
    .click();
  d = page.getByRole("dialog");
  await expect(d.getByLabel("Expected amount")).toBeDisabled();
  await d.getByLabel("Plan note").fill("Unsaved note must survive");
  await expect(
    d.getByRole("button", { name: "Unlink transaction" }),
  ).toBeDisabled();
  await d.getByLabel("Plan note").fill("Holiday override");
  page.once("dialog", (x) => x.dismiss());
  await d.getByRole("button", { name: "Unlink transaction" }).click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.filter((c: any) => c.cmd === "unmatch_cash"),
    ),
  ).toHaveLength(0);
  page.once("dialog", (x) => x.accept());
  await d.getByRole("button", { name: "Unlink transaction" }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Match transaction", exact: true }),
  ).toBeVisible();
});
test("successful write with failed refresh does not resubmit and delayed month stays isolated", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Edit schedule Payroll" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("End date (optional)").fill("2026-11-15");
  await page.evaluate(() => ((window as any).failRefresh = true));
  await d.getByRole("button", { name: "Save cash plan", exact: true }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByText(/Your change was saved, but the screen could not reload/),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).failRefresh = false));
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.filter((c: any) => c.cmd === "save_cash_schedule"),
    ),
  ).toHaveLength(1);
  await page.evaluate(() => ((window as any).delayMonth = "2026-10"));
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await expect(page.getByText("Loading cash plans...")).toBeVisible();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Expected this month" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).finishMonth());
  await expect(
    page.getByRole("button", { name: "Edit Payroll on 2026-11-01" }),
  ).toBeVisible();
});
test("workspace switch ignores a late old read and compact themes remain usable", async ({
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
    path: ".qa/cash-plans-Light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(
    () => (document.documentElement.dataset.theme = "dracula"),
  );
  await page.getByRole("button", { name: "Add cash plan" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Plan type").selectOption("transfer");
  await d.getByLabel("Name", { exact: true }).fill("Gift contribution");
  await d.getByLabel("Expected amount").fill("55");
  await page.screenshot({
    path: ".qa/cash-plan-Dracula.png",
    fullPage: true,
    animations: "disabled",
  });
  page.once("dialog", (x) => x.accept());
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => ((window as any).delayMonth = "2026-10"));
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await expect(page.getByText("Loading cash plans...")).toBeVisible();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await page.getByRole("button", { name: "Cash plans", exact: true }).click();
  await expect(
    page.getByText(
      "No planned events for this month. Add a schedule or a one-time plan.",
    ),
  ).toBeVisible();
  await page.evaluate(() => (window as any).finishMonth());
  await expect(
    page.getByText(
      "No planned events for this month. Add a schedule or a one-time plan.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit schedule Payroll" }),
  ).not.toBeVisible();
});

test("PayPal cash-out plans use explicit net deposits and match reconciled actuals", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add cash plan" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name", { exact: true }).fill("PayPal transfer");
  await d
    .getByRole("combobox", { name: "Plan type", exact: true })
    .selectOption("paypal_cashout");
  await d.getByLabel("Expected amount").fill("50");
  await expect(
    d.getByRole("combobox", { name: "Deposit account", exact: true }),
  ).toHaveValue("checking");
  await d.getByRole("button", { name: "Save cash plan", exact: true }).click();
  await expect(d).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).calls
          .filter((c: any) => c.cmd === "save_cash_schedule")
          .at(-1).args.input.plan.kind,
    ),
  ).toBe("paypal_cashout");
  await page.evaluate(() => {
    (window as any).event.plan.kind = "paypal_cashout";
  });
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Cash plans", exact: true }).click();
  await expect(
    page.getByText(
      "Record and reconcile the deposit in Shared expenses, then match it here.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record actual", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Match transaction", exact: true }),
  ).toBeVisible();
});
