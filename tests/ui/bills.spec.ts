import { test, expect, type Page } from "@playwright/test";
import type { Snapshot } from "../../src/types";
import type { BillOccurrence } from "../../src/billTypes";
const snapshot: Snapshot = {
  workspace: "demo",
  month: "2026-11",
  entries: [],
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
      id: "amex",
      name: "American Express",
      kind: "credit",
      activityCents: 0,
      revision: 1,
      archived: false,
    },
  ],
  categories: [
    {
      id: "home",
      name: "Home",
      groupName: "Needs",
      color: "#557788",
      limitCents: 10000,
      defaultLimitCents: 10000,
      spentCents: 0,
      revision: 1,
      archived: false,
      icon: "home",
    },
  ],
  spentCents: 0,
  incomeCents: 0,
  budgetCents: 10000,
  budgetConfigured: true,
  remainingCents: 10000,
  householdCents: 0,
  householdMonthSpentCents: 0,
  monthlyCount: 0,
  incompleteImports: 0,
  dataPath: "synthetic.sqlite",
  backups: [],
};
const occurrence: BillOccurrence = {
  id: "occ-1",
  billId: "bill-1",
  period: "2026-11",
  revision: 1,
  dueDate: "2026-11-02",
  plan: {
    name: "Electric utility",
    merchant: "utility",
    amountCents: 10000,
    categoryId: "home",
    accountId: "checking",
    payer: "jacob",
    splitMode: "shared",
    splitValue: "",
    autopay: true,
  },
  actualCents: null,
  cancelled: false,
  note: "",
  paidCents: 0,
  remainingCents: 10000,
  previousCents: 9500,
  payments: [],
  evidence: [],
};
async function setup(page: Page, initial = occurrence) {
  await page.addInitScript(
    ({ snapshot, initial }) => {
      const w = window as any;
      w.isTauri = true;
      w.calls = [];
      w.bill = initial;
      w.failPayment = false;
      w.templates = [
        {
          id: "bill-1",
          revision: 1,
          firstDue: "2026-11-02",
          everyMonths: 1,
          endDate: null,
          archived: false,
          plan: initial.plan,
        },
      ];
      w.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          w.calls.push({ cmd, args });
          if (cmd === "snapshot")
            return {
              ...snapshot,
              workspace: args.workspace,
              month: args.month,
            };
          if (cmd === "bill_month")
            return args.workspace === "demo" ? [structuredClone(w.bill)] : [];
          if (cmd === "list_bill_templates")
            return structuredClone(w.templates);
          if (cmd === "save_bill_template") {
            w.templates.push({
              ...args.input,
              revision: 1,
              plan: { ...args.input.plan, amountCents: 7500 },
            });
            return;
          }
          if (cmd === "bill_candidates")
            return [
              {
                id: "expense-1",
                revision: 1,
                date: "2026-11-01",
                description: "Utility payment",
                amountCents: 15000,
                availableCents: 15000,
                suggested: true,
              },
            ];
          if (cmd === "save_bill_occurrence") {
            const i = args.input;
            w.bill = {
              ...w.bill,
              ...i,
              plan: { ...i.plan, amountCents: 10000 },
              actualCents:
                i.actualAmount === null
                  ? null
                  : Math.round(Number(i.actualAmount) * 100),
              revision: w.bill.revision + 1,
            };
            w.bill.remainingCents =
              (w.bill.actualCents ?? 10000) - w.bill.paidCents;
            return;
          }
          if (cmd === "link_bill_payment" || cmd === "record_bill_payment") {
            if (w.failPayment) throw "Payment could not be saved. Try again.";
            w.bill.paidCents = 4000;
            w.bill.remainingCents = (w.bill.actualCents ?? 10000) - 4000;
            w.bill.revision++;
            w.bill.payments = [
              {
                id: "link-1",
                eventId: "expense-1",
                date: "2026-11-01",
                description: "Utility payment",
                amountCents: 4000,
              },
            ];
            return;
          }
          if (cmd === "unlink_bill_payment") {
            w.bill.paidCents = 0;
            w.bill.remainingCents = w.bill.actualCents ?? 10000;
            w.bill.payments = [];
            w.bill.revision++;
            return;
          }
          if (cmd === "list_imports")
            return [
              { id: "pdf-1", name: "Utility invoice.pdf", format: "pdf" },
            ];
          if (cmd === "bill_evidence") {
            w.bill.evidence = args.remove
              ? []
              : [{ id: args.source, name: "Utility invoice.pdf" }];
            w.bill.revision++;
            return;
          }
          if (cmd === "preview_split") return [7000, 3000];
        },
      };
    },
    { snapshot, initial },
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Bills", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bills & payments" }),
  ).toBeVisible();
}
async function openBill(page: Page) {
  await page.locator(".bill-card").click();
  return page.getByRole("dialog", { name: "Electric utility", exact: true });
}

test("grouped bill payment carries charge lines and permits explicit partial allocations", async ({
  page,
}) => {
  await setup(page, {
    ...occurrence,
    plan: {
      ...occurrence.plan,
      lines: [
        {
          id: "rent",
          label: "Rent",
          categoryId: "home",
          amountCents: 6000,
          splitMode: "inherit",
          splitValue: "",
          jacobCents: 4200,
          chelseaCents: 1800,
        },
        {
          id: "water",
          label: "Water",
          categoryId: "home",
          amountCents: 4000,
          splitMode: "personal",
          splitValue: "",
          jacobCents: 4000,
          chelseaCents: 0,
        },
      ],
    },
  });
  let d = await openBill(page);
  await d.getByRole("button", { name: "Link or record payment" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Payment method").selectOption("new");
  await expect(
    d
      .getByRole("group", { name: "Charge 2", exact: true })
      .getByLabel("Line sharing"),
  ).toHaveValue("personal");
  await d.getByLabel("Payment amount ($)", { exact: true }).fill("50");
  await d
    .getByRole("group", { name: "Charge 1", exact: true })
    .getByLabel("Line amount ($)", { exact: true })
    .fill("30");
  await d
    .getByRole("group", { name: "Charge 2", exact: true })
    .getByLabel("Line amount ($)", { exact: true })
    .fill("20");
  await d.getByLabel("This payment happened").check();
  await d.getByRole("button", { name: "Record payment", exact: true }).click();
  const saved = await page.evaluate(
    () =>
      (window as any).calls.find((c: any) => c.cmd === "record_bill_payment")
        .args.input,
  );
  expect(saved.amount).toBe("50");
  expect(saved.lines).toMatchObject([
    { id: "rent", amount: "30" },
    { id: "water", amount: "20", splitMode: "personal" },
  ]);
});

test("schedule defaults preserve shared split, cadence and separate autopay from payment", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator(".bill-card")).toContainText("Overdue");
  await expect(page.locator(".bill-card")).toContainText("Estimated");
  await page.getByRole("button", { name: "New bill", exact: true }).click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("Default sharing")).toHaveValue("shared");
  await d.getByLabel("Bill name", { exact: true }).fill("Water");
  await d.getByLabel("Expected amount ($)", { exact: true }).fill("75");
  await d.getByLabel("First due date").fill("2026-11-30");
  await d.getByLabel("Repeat every (months)").fill("3");
  await d.getByLabel("Autopay is enabled").check();
  await d.getByRole("button", { name: "Save schedule" }).click();
  await expect(d).toHaveCount(0);
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "save_bill_template"),
  );
  expect(call.args.input).toMatchObject({
    everyMonths: 3,
    firstDue: "2026-11-30",
    plan: { amount: "75", splitMode: "shared", autopay: true },
  });
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter(
          (c: any) => c.cmd === "save_entry" || c.cmd === "record_bill_payment",
        ).length,
    ),
  ).toBe(0);
});

test("bill edits must be saved before linking and partial allocations preserve the transaction", async ({
  page,
}) => {
  await setup(page);
  let d = await openBill(page);
  await d.getByLabel("Actual amount due ($)", { exact: true }).fill("120");
  await d.getByRole("button", { name: "Link or record payment" }).click();
  await expect(d.getByRole("alert")).toContainText("Save your bill changes");
  await d.getByRole("button", { name: "Save bill", exact: true }).click();
  d = await openBill(page);
  await d.getByRole("button", { name: "Link or record payment" }).click();
  d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "Existing expense", exact: true })
    .selectOption("expense-1");
  await d
    .getByLabel("Amount allocated to this bill ($)", { exact: true })
    .fill("40");
  await d.getByLabel("I confirm this transaction").check();
  await d.getByRole("button", { name: "Link payment", exact: true }).click();
  await expect(page.locator(".bill-card")).toContainText("Part paid");
  await expect(page.locator(".bill-card")).toContainText("$80.00");
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "link_bill_payment"),
  );
  expect(call.args.input).toMatchObject({
    eventId: "expense-1",
    eventRevision: 1,
    amount: "40",
  });
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter(
          (c: any) => c.cmd === "save_entry" || c.cmd === "record_bill_payment",
        ).length,
    ),
  ).toBe(0);
  await page.getByRole("tab", { name: "Changed amounts" }).click();
  await expect(page.locator(".bill-card")).toContainText(
    "Previous confirmed $95.00",
  );
});

test("recorded payment failures preserve input and retry one operation", async ({
  page,
}) => {
  await setup(page);
  let d = await openBill(page);
  await d.getByRole("button", { name: "Link or record payment" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Payment method").selectOption("new");
  await d.getByLabel("Payment amount ($)", { exact: true }).fill("40.00");
  await d.getByLabel("This payment happened").check();
  await page.evaluate(() => {
    (window as any).failPayment = true;
  });
  await d.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("could not be saved");
  await expect(d.getByLabel("Payment amount ($)", { exact: true })).toHaveValue(
    "40.00",
  );
  await page.evaluate(() => {
    (window as any).failPayment = false;
  });
  await d.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "record_bill_payment"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[0].args.input).toMatchObject({
    kind: "expense",
    amount: "40.00",
    splitMode: "shared",
    accountId: "checking",
  });
});

test("invoice attachment and payment unlinking do not create or delete financial entries", async ({
  page,
}) => {
  await setup(page, {
    ...occurrence,
    actualCents: 10000,
    paidCents: 4000,
    remainingCents: 6000,
    payments: [
      {
        id: "link-1",
        eventId: "expense-1",
        date: "2026-11-01",
        description: "Utility payment",
        amountCents: 4000,
      },
    ],
  });
  let d = await openBill(page);
  await d
    .getByRole("combobox", { name: "Source document", exact: true })
    .selectOption("pdf-1");
  await d.getByLabel("Bill notes").fill("Keep this unsaved detail");
  await d.getByRole("button", { name: "Attach evidence" }).click();
  await expect(d.getByRole("alert")).toContainText("Save your bill changes");
  await expect(d.getByLabel("Bill notes")).toHaveValue(
    "Keep this unsaved detail",
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "bill_evidence")
          .length,
    ),
  ).toBe(0);
  await d.getByLabel("Bill notes").fill("");
  await d.getByRole("button", { name: "Attach evidence" }).click();
  d = await openBill(page);
  await expect(
    d.getByText("Utility invoice.pdf", { exact: true }),
  ).toBeVisible();
  await d.getByLabel("Bill notes").fill("Keep this payment note");
  await d.getByRole("button", { name: "Unlink payment" }).click();
  await expect(d.getByRole("alert")).toContainText("Save your bill changes");
  await expect(d.getByLabel("Bill notes")).toHaveValue(
    "Keep this payment note",
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter(
          (c: any) => c.cmd === "unlink_bill_payment",
        ).length,
    ),
  ).toBe(0);
  await d.getByLabel("Bill notes").fill("");
  await d.getByRole("button", { name: "Unlink payment" }).click();
  await expect(page.locator(".bill-card")).toContainText("$0.00 paid");
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) =>
          ["save_entry", "delete_entry", "record_bill_payment"].includes(c.cmd),
        ).length,
    ),
  ).toBe(0);
});

test("estimated total stays reviewable after matching and bills fit compact light/dark layouts", async ({
  page,
}) => {
  await setup(page, {
    ...occurrence,
    paidCents: 10000,
    remainingCents: 0,
    payments: [
      {
        id: "link-1",
        eventId: "expense-1",
        date: "2026-11-01",
        description: "Utility payment",
        amountCents: 10000,
      },
    ],
  });
  await expect(page.locator(".bill-card")).toContainText("Verify total");
  let d = await openBill(page);
  await d
    .getByRole("button", { name: "Use paid total as actual bill amount" })
    .click();
  await expect(
    d.getByLabel("Actual amount due ($)", { exact: true }),
  ).toHaveValue("100.00");
  await d.getByRole("button", { name: "Save bill", exact: true }).click();
  await expect(page.locator(".bill-status")).toHaveText("Paid");
  for (const theme of ["Light", "Dracula"]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name: theme, exact: true }).check();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Bills", exact: true })
      .click();
    await page.setViewportSize({ width: 1000, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `.qa/bills-${theme}.png`, fullPage: true });
    d = await openBill(page);
    await page.screenshot({ path: `.qa/bill-details-${theme}.png` });
    await d.getByRole("button", { name: "Close", exact: true }).click();
  }
});

test("loan bill inherits debt treatment and keeps it on explicit payment", async ({
  page,
}) => {
  await setup(page, {
    ...occurrence,
    plan: { ...occurrence.plan, paymentKind: "debt_payment" },
  });
  let d = await openBill(page);
  await d
    .getByText("Expected amount, category & sharing", { exact: true })
    .click();
  await expect(
    d.getByRole("combobox", { name: /Payment treatment/ }),
  ).toHaveValue("debt_payment");
  await d.getByRole("button", { name: "Link or record payment" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Payment method").selectOption("new");
  await expect(
    d.getByRole("combobox", { name: "Payment treatment", exact: true }),
  ).toHaveValue("debt_payment");
  await d.getByLabel("This payment happened").check();
  await d.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(d).toHaveCount(0);
  const saved = await page.evaluate(
    () =>
      (window as any).calls.find((c: any) => c.cmd === "record_bill_payment")
        .args.input,
  );
  expect(saved).toMatchObject({
    kind: "debt_payment",
    accountId: "checking",
    amount: "100.00",
    splitMode: "shared",
  });
});

test("recorded bill payment can disclose a late budget period without changing payment date", async ({
  page,
}) => {
  await setup(page);
  let d = await openBill(page);
  await d.getByRole("button", { name: "Link or record payment" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Payment method").selectOption("new");
  await d.getByLabel("Payment date", { exact: true }).fill("2026-10-20");
  await d.getByLabel("This payment happened").check();
  await d.locator("summary").filter({ hasText: "Budget period" }).click();
  await d.getByLabel("Use a different budget month").check();
  await d
    .getByLabel("Reason for budget override")
    .fill("October payment entered after close");
  await expect(d.getByLabel("This payment happened")).not.toBeChecked();
  await d.getByLabel("This payment happened").check();
  await d.getByRole("button", { name: "Record payment", exact: true }).click();
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "record_bill_payment"),
  );
  expect(call.args.input).toMatchObject({
    date: "2026-10-20",
    budgetOverride: {
      month: "2026-11",
      reason: "October payment entered after close",
    },
  });
});
