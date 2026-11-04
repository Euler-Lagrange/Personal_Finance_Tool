import { test, expect, type Page } from "@playwright/test";
import type { Snapshot } from "../../src/types";

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
      id: "groceries",
      name: "Groceries",
      groupName: "Needs",
      color: "#abcdef",
      limitCents: 70000,
      defaultLimitCents: 70000,
      spentCents: 0,
      revision: 1,
      archived: false,
      icon: "groceries",
    },
  ],
  spentCents: 0,
  incomeCents: 0,
  budgetCents: 70000,
  budgetConfigured: true,
  remainingCents: 70000,
  householdCents: 0,
  householdMonthSpentCents: 0,
  monthlyCount: 0,
  incompleteImports: 0,
  dataPath: "synthetic.sqlite",
  backups: [],
};

async function setup(
  page: Page,
  options: { empty?: boolean; statement?: boolean } = {},
) {
  await page.addInitScript(
    ({ snapshot, options }) => {
      const w = window as any;
      w.isTauri = true;
      w.calls = [];
      w.options = options;
      w.templates = [];
      w.pages = options.empty
        ? []
        : [
            {
              number: 1,
              lines: [
                "SYNTHETIC UTILITY",
                "Currency: USD",
                "Amount due: $86.00",
                "Due date: 11/05/2026",
              ],
            },
          ];
      w.extraction = {
        values: [
          {
            key: "amount_due",
            cents: 8600,
            date: null,
            page: 1,
            line: 3,
            labelLine: 3,
            raw: "$86.00",
          },
          {
            key: "due_date",
            cents: null,
            date: "2026-11-05",
            page: 1,
            line: 4,
            labelLine: 4,
            raw: "11/05/2026",
          },
        ],
        errors: [],
        notes: ["Component arithmetic matches the total exactly."],
      };
      w.source = {
        id: "11111111-1111-4111-8111-111111111111",
        revision: 1,
        name: "Synthetic bill.pdf",
        format: "pdf",
        accountId: null,
        state: "evidence",
        error: "",
        rowCount: 0,
        pendingCount: 0,
        importedCount: 0,
        linkedCount: 0,
        excludedCount: 0,
        createdAt: "2026-11-03",
      };
      w.template = {
        id: "22222222-2222-4222-8222-222222222222",
        revision: 1,
        enabled: true,
        definition: {
          name: "Synthetic utility",
          kind: options.statement ? "statement" : "bill",
          pageCount: 1,
          identity: { page: 1, text: "SYNTHETIC UTILITY" },
          currency: { page: 1, text: "Currency: USD" },
          fields: [
            {
              key: "amount_due",
              page: 1,
              label: "Amount due",
              placement: "inline",
              dateFormat: "mdy",
            },
            {
              key: "due_date",
              page: 1,
              label: "Due date",
              placement: "inline",
              dateFormat: "mdy",
            },
          ],
          sumParts: [],
        },
      };
      w.review = {
        token: "fresh-review",
        kind: options.statement ? "statement" : "bill",
        targetName: options.statement
          ? "American Express - 2026-11"
          : "Utility",
        priorAmountCents: 10000,
        newAmountCents: 8600,
        priorDueDate: "2026-11-02",
        dueDate: "2026-11-05",
        extraction: w.extraction,
        calculation: options.statement
          ? {
              balanceCents: 8000,
              warnings: ["Accepted complete coverage is missing."],
            }
          : null,
      };
      w.tableTemplates = [];
      w.tableBinding = null;
      w.pages = [
        {
          number: 1,
          lines: [
            "SYNTHETIC UTILITY",
            "Currency: USD",
            "Transactions",
            "10/02/2026 | Market | 100.00",
            "10/02/2026 | Market | 100.00",
            "End transactions",
          ],
        },
      ];
      w.tableProof = {
        headers: ["Date", "Description", "Amount"],
        rows: [
          ["10/02/2026", "Market", "100.00"],
          ["10/02/2026", "Market", "100.00"],
        ],
        evidence: [
          { page: 1, firstLine: 4, lastLine: 4 },
          { page: 1, firstLine: 5, lastLine: 5 },
        ],
      };
      w.tableTemplate = {
        id: "33333333-3333-4333-8333-333333333333",
        revision: 1,
        enabled: true,
        definition: {
          name: "Synthetic table",
          identity: "SYNTHETIC UTILITY",
          currency: "Currency: USD",
          start: "Transactions",
          end: "End transactions",
          headers: ["Date", "Description", "Amount"],
          separator: "pipe",
          automatic: true,
        },
      };
      w.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => 1,
        invoke: async (cmd: string, args: any) => {
          w.calls.push({ cmd, args: structuredClone(args) });
          if (cmd === "pdf_table_view") {
            if (w.failTableRead) throw "Synthetic table load failure";
            return structuredClone({
              templates: w.tableTemplates.map((t: any) => ({
                template: t,
                recognized: true,
                issue: w.tableIssue ?? null,
              })),
              binding: w.tableBinding,
            });
          }
          if (cmd === "preview_pdf_table") {
            if (w.tableIssue) throw w.tableIssue;
            const r = structuredClone({
              token: "table-token",
              extraction: w.tableProof,
            });
            if (w.delay) await new Promise((r) => setTimeout(r, w.delay));
            return r;
          }
          if (cmd === "save_pdf_table") {
            if (w.failSave) {
              w.failSave = false;
              throw "Synthetic interrupted table response. Retry.";
            }
            const r = args.input.request;
            if (r.definition)
              w.tableTemplates = [
                {
                  id: r.templateId,
                  revision: r.templateRevision + 1,
                  enabled: true,
                  definition: r.definition,
                },
              ];
            else {
              w.tableBinding = {
                templateId: r.templateId,
                version: r.templateRevision,
                proof: structuredClone(w.tableProof),
              };
              w.source.revision++;
              w.source.rowCount = 2;
              w.source.pendingCount = 2;
            }
            return;
          }
          if (cmd === "set_pdf_table_enabled") {
            w.tableTemplates[0].enabled = args.enabled;
            return;
          }
          if (cmd === "import_profile") return null;
          if (cmd === "configure_import") {
            w.source.accountId = args.account;
            w.source.revision++;
            w.mapping = args.mapping;
            return;
          }

          if (cmd === "snapshot") {
            if (w.failRefresh) throw "Synthetic refresh failed";
            return {
              ...snapshot,
              workspace: args.workspace,
              month: args.month,
            };
          }
          if (cmd === "list_imports")
            return args.workspace === "personal"
              ? []
              : [structuredClone(w.source)];
          if (cmd === "get_import")
            return {
              source: structuredClone(w.source),
              dataset: {
                pdfPages: w.pages,
                headers: w.tableBinding ? w.tableProof.headers : [],
                rows: w.tableBinding ? w.tableProof.rows : [],
                sheetNames: [],
                sheet: "",
                image: false,
                notes: [],
              },
              mapping: w.mapping ?? {
                dateColumn: 0,
                descriptionColumn: 1,
                amountColumn: 2,
                debitColumn: null,
                creditColumn: null,
                statusColumn: null,
                typeColumn: null,
                amountMode: "",
                dateFormat: "month_first",
                year: null,
                postedConfirmed: false,
              },
              rows: w.tableBinding
                ? w.tableProof.rows.map((r: string[], i: number) => ({
                    id: `row-${i}`,
                    ordinal: i,
                    raw: r,
                    candidate: {
                      date: "2026-10-02",
                      description: "Market",
                      amountCents: 10000,
                      direction: "out",
                      status: "posted",
                      sourceType: "",
                      warnings: [],
                    },
                    disposition: w.processed ? "imported" : "pending",
                    eventId: null,
                    matches: [],
                    suggestion: { ready: false, explanations: [] },
                  }))
                : [],
              previewUrl: null,
              undoId: null,
            };
          if (cmd === "list_rules" || cmd === "list_goals") return [];
          if (cmd === "pdf_document") {
            if (w.failRead) throw "Synthetic PDF read failure";
            return structuredClone({
              pages: w.pages,
              templates: w.templates,
              applied: w.applied ?? null,
            });
          }
          if (cmd === "preview_pdf_template") {
            const result = structuredClone({
              token: "sample-token",
              extraction: {
                ...w.extraction,
                errors: w.drift ? ["Label positions changed."] : [],
              },
            });
            if (w.delay) await new Promise((r) => setTimeout(r, w.delay));
            return result;
          }
          if (cmd === "approve_pdf_template") {
            if (w.failSave) {
              w.failSave = false;
              throw "Synthetic interrupted response. Retry.";
            }
            w.templates = [
              {
                ...w.template,
                id: args.input.input.id,
                definition: args.input.input.definition,
              },
            ];
            return;
          }
          if (cmd === "set_pdf_template_enabled") {
            w.templates[0].enabled = args.enabled;
            return;
          }
          if (cmd === "bill_month") {
            if (w.failTargets) throw "Synthetic target failure";
            return [
              {
                id: "bill-1",
                cancelled: false,
                dueDate: "2026-11-02",
                plan: { name: "Utility" },
              },
            ];
          }
          if (cmd === "card_statement_month")
            return {
              configs: [],
              statements: [{ draft: { accountId: "amex" } }],
              evidence: [],
            };
          if (cmd === "preview_pdf_application") {
            if (w.drift)
              throw "Label positions changed. Approve a new template version.";
            const result = structuredClone(w.review);
            if (w.delay) await new Promise((r) => setTimeout(r, w.delay));
            return result;
          }
          if (cmd === "apply_pdf_application") {
            if (w.failSave) {
              w.failSave = false;
              throw "Synthetic interrupted response. Retry.";
            }
            w.applied = {
              kind: w.review.kind,
              targetId: args.input.input.targetId,
              month: args.input.input.month,
              review: structuredClone(w.review),
              note: args.input.input.note,
            };
            w.source.revision++;
            return;
          }
          if (cmd === "reextract_import") {
            w.pages = [
              { number: 1, lines: ["SYNTHETIC UTILITY", "Currency: USD"] },
            ];
            w.source.revision++;
            return;
          }
          if (cmd === "export_original_pdf")
            return "synthetic-exports/original.pdf";
          return null;
        },
      };
    },
    { snapshot, options },
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Imports", exact: true })
    .click();
  await page.getByRole("button", { name: /Synthetic bill.pdf/ }).click();
  await expect(
    page.getByRole("button", { name: "Export original PDF" }),
  ).toBeVisible();
}

async function openExisting(page: Page) {
  await setup(page);
  await page.evaluate(() => {
    (window as any).tableTemplates = [(window as any).tableTemplate];
  });
  await page.getByRole("button", { name: "All sources" }).click();
  await page.getByRole("button", { name: /Synthetic bill.pdf/ }).click();
}
test("table approval preserves line-separated column names, requires evidence and supports retry", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "New table template" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Table template name").fill("Card transactions");
  await expect(modal.getByLabel("Table columns")).toHaveValue(
    "Date\nDescription\nAmount",
  );
  await modal.getByLabel("Automatically stage").check();
  await modal.getByRole("button", { name: "Preview table rows" }).click();
  await expect(modal.getByText("Page 1, lines 4-4")).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Approve table template", exact: true }),
  ).toBeDisabled();
  await modal.getByLabel("I compared every extracted row").check();
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await modal
    .getByRole("button", { name: "Approve table template", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText("interrupted");
  await modal
    .getByRole("button", { name: "Approve table template", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(
    page.getByText("Matching future files stage automatically"),
  ).toBeVisible();
  const c = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_pdf_table"),
  );
  expect(c).toHaveLength(2);
  expect(c[0].args).toEqual(c[1].args);
  expect(c[0].args.input.request.definition.headers).toEqual([
    "Date",
    "Description",
    "Amount",
  ]);
});
test("staging keeps twins and opens the existing account and column review flow", async ({
  page,
}) => {
  await openExisting(page);
  await page.getByRole("button", { name: "Review table rows" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Preview table rows" }).click();
  await expect(modal.getByText("Market", { exact: true })).toHaveCount(2);
  await modal.getByLabel("I compared every extracted row").check();
  await modal.getByRole("button", { name: "Stage rows for review" }).click();
  await expect(modal).toHaveCount(0);
  await expect(
    page.getByText("Staged table evidence - version 1"),
  ).toBeVisible();
  await expect(page.getByLabel("Account for this source")).toBeVisible();
  await page.getByLabel("Account for this source").selectOption("amex");
  await page.getByLabel("Amount convention").selectOption("outflow_positive");
  await page.getByLabel("I confirm rows without a status").check();
  await page.getByRole("button", { name: "Apply mapping" }).click();
  await expect(
    page
      .getByLabel("Coverage type")
      .getByRole("option", { name: "Complete posted activity in range" }),
  ).toBeEnabled();
});
test("table edits invalidate delayed preview and discard needs explicit confirmation", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "New table template" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Table template name").fill("Table");
  await page.evaluate(() => {
    (window as any).delay = 350;
  });
  await modal.getByRole("button", { name: "Preview table rows" }).click();
  await modal.getByLabel("Cell layout").selectOption("lines");
  await page.waitForTimeout(450);
  await expect(modal.getByLabel("I compared every extracted row")).toHaveCount(
    0,
  );
  await expect(
    modal.getByRole("button", { name: "Approve table template", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (d) => d.dismiss());
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(modal).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(modal).toHaveCount(0);
});
test("changed layouts stay held, paused templates can resume, and read errors can retry", async ({
  page,
}) => {
  await openExisting(page);
  await page.getByRole("button", { name: "Pause table" }).click();
  await expect(
    page.getByRole("button", { name: "Review table rows" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Enable table" }).click();
  await expect(
    page.getByRole("button", { name: "Review table rows" }),
  ).toBeEnabled();
  await page.evaluate(() => {
    (window as any).failTableRead = true;
  });
  await page.getByRole("button", { name: "All sources" }).click();
  await page.getByRole("button", { name: /Synthetic bill.pdf/ }).click();
  await expect(page.getByRole("alert")).toContainText("table load failure");
  await page.evaluate(() => {
    (window as any).failTableRead = false;
    (window as any).tableIssue = "Page 2: unsupported row width.";
  });
  await page.getByRole("button", { name: "Reload table templates" }).click();
  await expect(page.getByText("Page 2: unsupported row width.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review table rows" }),
  ).toBeDisabled();
});
test("processed PDF rows cannot be remapped and evidence stays readable in compact themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 780 });
  await openExisting(page);
  await page.evaluate(() => {
    const w = window as any;
    w.tableBinding = {
      templateId: w.tableTemplate.id,
      version: 1,
      proof: w.tableProof,
    };
    w.processed = true;
  });
  await page.getByRole("button", { name: "All sources" }).click();
  await page.getByRole("button", { name: /Synthetic bill.pdf/ }).click();
  await expect(
    page.getByRole("button", { name: "New table template" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review table rows" }),
  ).toBeDisabled();
  await page.getByText("Staged table evidence - version 1").click();
  await page
    .getByText("Transaction tables", { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1100);
  await page.screenshot({ path: ".qa/pdf-tables-light.png" });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: ".qa/pdf-tables-dark.png" });
});
