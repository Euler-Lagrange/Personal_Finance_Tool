import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.cfg = {
      accountId: "amex",
      revision: 1,
      firstMonth: "2026-01",
      closingDay: 20,
      dueDay: 15,
      dueMonthOffset: 1,
      dateBasis: "posted",
      archived: false,
    };
    w.draft = {
      accountId: "amex",
      month: "2026-11",
      revision: 0,
      closingDate: "2026-11-20",
      dueDate: "2026-12-15",
      dateBasis: "posted",
      datesConfirmed: false,
      balance: null,
      note: "",
      evidenceSourceId: null,
    };
    w.calc = {
      inputFingerprint: "f".repeat(64),
      throughDate: "2026-11-03",
      checkpointDate: "2026-10-31",
      checkpointCents: 10000,
      changeCents: 52400,
      balanceCents: 62400,
      complete: false,
      assumedDateCount: 1,
      unresolvedCount: 0,
      gaps: [{ start: "2026-11-01", end: "2026-11-03" }],
      coverageSources: [],
      warnings: [
        "Future cutoff: only activity known through today is included.",
        "Accepted, complete coverage is missing between the checkpoint and cutoff.",
      ],
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
        if (cmd === "card_statement_month") {
          if (w.failRead) throw "Synthetic statement read failure";
          const result =
            args.workspace === "personal" || w.empty
              ? { configs: [], statements: [], evidence: [] }
              : {
                  configs: [structuredClone(w.cfg)],
                  statements:
                    args.month === "2026-11"
                      ? [
                          {
                            draft: structuredClone(w.draft),
                            calculation: structuredClone(w.calc),
                            confirmedBalanceCents:
                              w.draft.balance === null
                                ? null
                                : Number(w.draft.balance) * 100,
                            differenceCents:
                              w.draft.balance === null
                                ? null
                                : Number(w.draft.balance) * 100 - 62400,
                            changedSinceReview: !!w.changed,
                          },
                        ]
                      : [],
                  evidence: [
                    [
                      "amex",
                      { id: "pdf-1", name: "Synthetic card statement.pdf" },
                    ],
                  ],
                };
          if (w.delayMonth === args.month && args.workspace === "demo")
            return new Promise((resolve) => {
              w.finishMonth = () => resolve(result);
            });
          return result;
        }
        if (cmd === "review_card_statement") {
          if (w.failReview) throw "Synthetic calculation failure";
          return {
            token: "review-token",
            calculation: structuredClone(w.calc),
          };
        }
        if (
          cmd === "save_card_statement" ||
          cmd === "save_card_statement_config"
        ) {
          if (w.failWrite) throw "Synthetic write failure";
          if (cmd === "save_card_statement") {
            w.draft = structuredClone(args.input.draft);
            w.draft.revision++;
          } else {
            w.cfg = structuredClone(args.input);
            w.cfg.revision++;
            w.empty = false;
          }
        }
      },
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Card statements", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Card cycle settings", exact: true }),
  ).toBeVisible();
}
test("cycle settings preserve dirty input and retry one operation", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Edit American Express cycle" })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Usual closing day").fill("31");
  await d.getByLabel("Usual due day").fill("28");
  await d.getByLabel("Pause new cycle estimates").check();
  page.once("dialog", (x) => x.dismiss());
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(d).toBeVisible();
  await page.evaluate(() => ((window as any).failWrite = true));
  await d.getByRole("button", { name: "Save card cycle" }).click();
  await expect(d.getByRole("alert")).toContainText("Synthetic write failure");
  await page.evaluate(() => ((window as any).failWrite = false));
  await d.getByRole("button", { name: "Save card cycle" }).click();
  await expect(d).not.toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter(
      (c: any) => c.cmd === "save_card_statement_config",
    ),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.input).toMatchObject({
    closingDay: 31,
    dueDay: 28,
    archived: true,
  });
});
test("statement confirmation requires current calculation and review; failure preserves source and amount", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", {
      name: "Review American Express statement",
      exact: true,
    })
    .click();
  const d = page.getByRole("dialog");
  const save = d.getByRole("button", { name: "Save statement review" });
  await expect(save).toBeDisabled();
  await d.getByLabel("Closing date", { exact: true }).fill("2026-10-20");
  await d.getByLabel("I checked the issuer's closing and due dates").check();
  await d.getByLabel("Issued statement balance (optional)").fill("620.00");
  await d
    .getByLabel("Review note / statement reference")
    .fill("Synthetic issuer statement reviewed");
  await d
    .getByRole("combobox", { name: "Statement evidence", exact: true })
    .selectOption("pdf-1");
  await page.evaluate(() => ((window as any).failReview = true));
  await d.getByRole("button", { name: "Calculate and review" }).click();
  await expect(d.getByRole("alert")).toContainText(
    "Synthetic calculation failure",
  );
  await page.evaluate(() => ((window as any).failReview = false));
  await d.getByRole("button", { name: "Calculate and review" }).click();
  await d
    .getByLabel("I reviewed the dates, amount and calculation warnings")
    .check();
  await expect(save).toBeEnabled();
  await d.getByLabel("Issued statement balance (optional)").fill("621.00");
  await expect(save).toBeDisabled();
  await expect(
    d.getByLabel("I reviewed the dates, amount and calculation warnings"),
  ).not.toBeVisible();
  await d.getByRole("button", { name: "Calculate and review" }).click();
  await d
    .getByLabel("I reviewed the dates, amount and calculation warnings")
    .check();
  await page.evaluate(() => ((window as any).failWrite = true));
  await save.click();
  await expect(d.getByRole("alert")).toContainText("Synthetic write failure");
  await page.evaluate(() => ((window as any).failWrite = false));
  await save.click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByText("Confirmed minus calculated:", { exact: false }),
  ).toContainText("-$3.00");
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_card_statement"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.input.draft).toMatchObject({
    balance: "621.00",
    datesConfirmed: true,
    evidenceSourceId: "pdf-1",
  });
});
test("successful statement save survives failed refresh without resubmission", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", {
      name: "Review American Express statement",
      exact: true,
    })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("Review note / statement reference")
    .fill("Reviewed estimate with coverage gaps");
  await d.getByRole("button", { name: "Calculate and review" }).click();
  await d
    .getByLabel("I reviewed the dates, amount and calculation warnings")
    .check();
  await page.evaluate(() => ((window as any).failRefresh = true));
  await d.getByRole("button", { name: "Save statement review" }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).failRefresh = false));
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByText("Reviewed estimate with coverage gaps"),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).calls.filter((c: any) => c.cmd === "save_card_statement"),
    ),
  ).toHaveLength(1);
});
test("empty state and read retry discard late old month and workspace results", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => ((window as any).failRead = true));
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic statement read failure",
  );
  await page.evaluate(() => ((window as any).failRead = false));
  await page.getByRole("button", { name: "Retry statements" }).click();
  await expect(
    page.getByText("No statement cycles this month.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Review American Express statement",
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).delayMonth = "2026-10"));
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await expect(page.getByText(/Loading statements/)).toBeVisible();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Card statements", exact: true })
    .click();
  await expect(
    page.getByText("No statement cycles this month.", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).finishMonth());
  await expect(
    page.getByRole("button", {
      name: "Review American Express statement",
      exact: true,
    }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Configure card" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Configure card" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Credit card", exact: true }),
  ).toHaveValue("amex");
});
test("compact light and Dracula statement layouts expose gaps and changes", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.screenshot({
    path: ".qa/statements-Light.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dracula";
    (window as any).changed = true;
  });
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(
    page.getByText("Calculation inputs changed since your last review.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Review American Express statement",
      exact: true,
    })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("Review note / statement reference")
    .fill("Synthetic review");
  await d.getByRole("button", { name: "Calculate and review" }).click();
  await d.getByText("Coverage gaps (1)").click();
  await expect(d.getByText("2026-11-01 through 2026-11-03")).toBeVisible();
  await page.screenshot({
    path: ".qa/statements-Dracula.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
