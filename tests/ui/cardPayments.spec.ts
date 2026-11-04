import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    const o = (
      month: string,
      base: number,
      carry: number,
      newAmount: number,
    ) => ({
      month,
      revision: 1,
      closingDate: `${month}-20`,
      dueDate: month === "2026-09" ? "2026-10-15" : "2026-11-15",
      baseCents: base,
      carriedCents: carry,
      newCents: newAmount,
      paidCents: 0,
      creditCents: 0,
      remainingCents: newAmount,
      carriedRemainingCents: carry,
      statementRemainingCents: base,
      proposedBaseCents: base,
      proposedCarry: carry ? [{ month: "2026-09", amountCents: carry }] : [],
      proposedNewCents: newAmount,
      needsReview: false,
      canReview: true,
      blockers: [],
      warnings: [],
      note: "Synthetic carry review",
    });
    w.pv = {
      accountId: "amex",
      token: "payment-token",
      obligations: [
        o("2026-09", 10000, 0, 10000),
        o("2026-10", 15000, 10000, 5000),
      ],
      payments: [
        {
          id: "payment-1",
          revision: 1,
          reviewRevision: 0,
          description: "Checking card payment",
          kind: "card_payment",
          cardDate: "2026-10-25",
          bankDate: "2026-10-24",
          dateAssumed: false,
          amountCents: 12000,
          allocations: [],
          note: "",
        },
        {
          id: "credit-1",
          revision: 1,
          reviewRevision: 0,
          description: "Reward redemption",
          kind: "reward",
          cardDate: "2026-10-26",
          bankDate: null,
          dateAssumed: true,
          amountCents: 1500,
          allocations: [],
          note: "",
        },
      ],
    };

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

        if (cmd === "card_payment_view") {
          if (w.failPaymentRead) throw "Synthetic card payment read failure";
          const result = structuredClone(w.pv);
          if (w.delayPayments)
            return new Promise((resolve) => {
              w.finishPayments = () => resolve(result);
            });
          return result;
        }
        if (
          [
            "save_card_obligation",
            "clear_card_obligation",
            "save_card_payment_review",
            "clear_card_payment_review",
          ].includes(cmd)
        ) {
          if (w.failPaymentWrite) throw "Synthetic allocation write failure";
          if (cmd.includes("obligation")) {
            const row = w.pv.obligations.find(
              (o: any) => o.month === args.input.month,
            );
            row.revision = cmd.startsWith("clear") ? 0 : row.revision + 1;
            row.needsReview = cmd.startsWith("clear");
            row.note = args.input.note;
          } else {
            const p = w.pv.payments.find(
              (p: any) => p.id === args.input.eventId,
            );
            p.reviewRevision = cmd.startsWith("clear")
              ? 0
              : p.reviewRevision + 1;
            p.note = args.input.note;
            p.allocations = cmd.startsWith("clear")
              ? []
              : args.input.allocations.map((a: any) => ({
                  month: a.month,
                  amountCents: Math.round(Number(a.amount) * 100),
                }));
            for (const o of w.pv.obligations) {
              o.paidCents = 0;
              o.creditCents = 0;
              for (const p of w.pv.payments)
                for (const a of p.allocations)
                  if (a.month === o.month) {
                    if (p.kind === "card_payment") o.paidCents += a.amountCents;
                    else o.creditCents += a.amountCents;
                  }
              o.remainingCents = o.newCents - o.paidCents - o.creditCents;
            }
          }
          for (const o of w.pv.obligations) {
            o.carriedRemainingCents = o.proposedCarry.reduce(
              (n: number, c: any) =>
                n +
                Math.min(
                  c.amountCents,
                  Math.max(
                    0,
                    w.pv.obligations.find((x: any) => x.month === c.month)
                      .remainingCents,
                  ),
                ),
              0,
            );
            o.statementRemainingCents =
              o.remainingCents + o.carriedRemainingCents;
          }
          return;
        }
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
async function open(page: Page) {
  await page
    .getByRole("button", {
      name: "Payments & credits for American Express",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Statement obligations", exact: true }),
  ).toBeVisible();
}
test("carried debt review shows incremental amount, preserves errors and retries once", async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await page
    .getByRole("button", { name: "Review 2026-10 obligation", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d.getByText("Includes unpaid 2026-09 at cutoff")).toBeVisible();
  await expect(d.getByText("$100.00", { exact: true })).toBeVisible();
  await expect(d.getByText("$50.00", { exact: true })).toBeVisible();
  await d
    .getByLabel("Obligation review note / issuer reference")
    .fill("Confirmed carry on issuer statement");
  await expect(
    d.getByRole("button", { name: "Confirm obligation" }),
  ).toBeDisabled();
  await d
    .getByLabel(
      "I confirmed this statement includes the displayed carried debt",
    )
    .check();
  await page.evaluate(() => ((window as any).failPaymentWrite = true));
  await d.getByRole("button", { name: "Confirm obligation" }).click();
  await expect(d.getByRole("alert")).toContainText(
    "Synthetic allocation write failure",
  );
  page.once("dialog", (x) => x.dismiss());
  await d.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    d.getByLabel("Obligation review note / issuer reference"),
  ).toHaveValue("Confirmed carry on issuer statement");
  await page.evaluate(() => ((window as any).failPaymentWrite = false));
  await d.getByRole("button", { name: "Confirm obligation" }).click();
  await expect(
    page.getByRole("heading", { name: "Statement obligations" }),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_card_obligation"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.input).toMatchObject({
    month: "2026-10",
    confirmed: true,
  });
});
test("combined payment uses decimal allocations and clears acknowledgement after edits", async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await page
    .getByRole("button", { name: "Review Checking card payment", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d.getByText(/Bank posting date: 2026-10-24/)).toBeVisible();
  await d.getByLabel("2026-09 allocation", { exact: true }).fill("70.00");
  await d.getByLabel("2026-10 allocation", { exact: true }).fill("50.00");
  await d
    .getByLabel("Payment review note / issuer reference")
    .fill("Split actual payment");
  const confirm = d.getByLabel(
    "I verified the card posting date and how these amounts satisfy the issuer's obligations",
  );
  await confirm.check();
  await d.getByLabel("2026-09 allocation", { exact: true }).fill("69.99");
  await expect(confirm).not.toBeChecked();
  await expect(
    d.getByRole("button", { name: "Save allocations" }),
  ).toBeDisabled();
  await d.getByLabel("2026-09 allocation", { exact: true }).fill("70.00");
  await confirm.check();
  await page.evaluate(() => ((window as any).failPaymentWrite = true));
  await d.getByRole("button", { name: "Save allocations" }).click();
  await expect(d.getByRole("alert")).toContainText(
    "Synthetic allocation write failure",
  );
  await page.evaluate(() => ((window as any).failPaymentWrite = false));
  await d.getByRole("button", { name: "Save allocations" }).click();
  await expect(
    page.getByRole("region", { name: "2026-09 obligation" }),
  ).toContainText("$30.00");
  await expect(
    page.getByRole("region", { name: "2026-10 obligation" }),
  ).toContainText("Earlier debt remains");
  const calls = await page.evaluate(() =>
    (window as any).calls.filter(
      (c: any) => c.cmd === "save_card_payment_review",
    ),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.input.allocations).toEqual([
    { month: "2026-09", amount: "70.00" },
    { month: "2026-10", amount: "50.00" },
  ]);
});
test("credit may be reviewed without reducing payment and clear review is explicit", async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await page
    .getByRole("button", { name: "Review Reward redemption", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d.getByText(/assumed from transaction date/)).toBeVisible();
  await expect(
    d.getByText(/leave all fields blank to record no reduction/),
  ).toBeVisible();
  await d
    .getByLabel("Payment review note / issuer reference")
    .fill("Issuer does not count reward toward this payment");
  await d
    .getByLabel(
      "I verified the card posting date and how these amounts satisfy the issuer's obligations",
    )
    .check();
  await d.getByRole("button", { name: "Save allocations" }).click();
  const call = await page.evaluate(() =>
    (window as any).calls.find(
      (c: any) => c.cmd === "save_card_payment_review",
    ),
  );
  expect(call.args.input.allocations).toEqual([]);
  await page
    .getByRole("button", { name: "Review Reward redemption", exact: true })
    .click();
  page.once("dialog", (x) => x.dismiss());
  await d
    .getByRole("button", { name: "Clear saved review and allocations" })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.filter(
        (c: any) => c.cmd === "clear_card_payment_review",
      ),
    ),
  ).toHaveLength(0);
  page.once("dialog", (x) => x.accept());
  await d
    .getByRole("button", { name: "Clear saved review and allocations" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Statement obligations" }),
  ).toBeVisible();
});
test("stale obligation blocks approval and included payments cannot be allocated", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any;
    w.pv.obligations[1].canReview = false;
    w.pv.obligations[1].needsReview = true;
    w.pv.obligations[1].blockers = ["Review the earlier obligation first."];
    w.pv.payments[0].cardDate = "2026-10-10";
  });
  await open(page);
  await page
    .getByRole("button", { name: "Review 2026-10 obligation", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel(
      "I confirmed this statement includes the displayed carried debt",
    )
    .check();
  await expect(
    d.getByRole("button", { name: "Confirm obligation" }),
  ).toBeDisabled();
  await d.getByRole("button", { name: "Back", exact: true }).click();
  await page
    .getByRole("button", { name: "Review Checking card payment", exact: true })
    .click();
  await expect(
    d.getByLabel("2026-10 allocation", { exact: true }),
  ).toBeDisabled();
  await expect(
    d.getByLabel("2026-09 allocation", { exact: true }),
  ).toBeEnabled();
});
test("failed refresh after saved allocations does not submit again; late reads stay isolated", async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await page
    .getByRole("button", { name: "Review Checking card payment", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("2026-09 allocation", { exact: true }).fill("20");
  await d
    .getByLabel("Payment review note / issuer reference")
    .fill("Partial payment");
  await d
    .getByLabel(
      "I verified the card posting date and how these amounts satisfy the issuer's obligations",
    )
    .check();
  await page.evaluate(() => ((window as any).failRefresh = true));
  await d.getByRole("button", { name: "Save allocations" }).click();
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).failRefresh = false));
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.filter(
        (c: any) => c.cmd === "save_card_payment_review",
      ),
    ),
  ).toHaveLength(1);
  await open(page);
  await page.evaluate(() => ((window as any).failPaymentRead = true));
  await page.getByRole("button", { name: "Reload card records" }).click();
  await expect(d.getByRole("alert")).toContainText(
    "Synthetic card payment read failure",
  );
  await page.evaluate(() => {
    (window as any).failPaymentRead = false;
    (window as any).delayPayments = true;
  });
  await page.getByRole("button", { name: "Reload card records" }).click();
  await expect(d.getByText("Loading card payments...")).toBeVisible();
  await d.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Card statements", exact: true })
    .click();
  await page.evaluate(() => (window as any).finishPayments());
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Payments & credits for American Express",
      exact: true,
    }),
  ).not.toBeVisible();
});
test("compact Light and Dracula payment reviews remain readable", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await open(page);
  await page.screenshot({
    path: ".qa/card-payments-Light.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.evaluate(
    () => (document.documentElement.dataset.theme = "dracula"),
  );
  await page
    .getByRole("button", { name: "Review Checking card payment", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("2026-09 allocation", { exact: true }).fill("70.00");
  await d.getByLabel("2026-10 allocation", { exact: true }).fill("50.00");
  await page.screenshot({
    path: ".qa/card-payments-Dracula.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
