import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
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
    ({ snapshot, options, pdfBytes }) => {
      const w = window as any;
      w.isTauri = true;
      w.calls = [];
      w.options = options;
      w.templates = [];
      w.pdfBytes = pdfBytes;
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
      w.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => 1,
        invoke: async (cmd: string, args: any) => {
          w.calls.push({ cmd, args: structuredClone(args) });
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
                headers: w.columnHeaders ?? [],
                rows: w.columnRows ?? [],
                sheetNames: [],
                sheet: "",
                image: false,
                assisted: !!w.aiStaged,
                notes: [],
              },
              mapping: {},
              rows: [],
              previewUrl: null,
              undoId: null,
            };
          if (cmd === "list_rules" || cmd === "list_goals") return [];
          if (cmd === "ai_provider_settings") {
            if (w.providerReadFailure) throw "Synthetic provider read failure";
            return (
              w.providers ??
              ["claude", "openai"].map((provider) => ({
                provider,
                revision: 0,
                enabled: false,
                model: "",
                hasKey: false,
              }))
            );
          }
          if (cmd === "ai_jobs") {
            if (w.aiReadFailure) throw "Synthetic request status unavailable";
            return structuredClone(w.aiJobs ?? []);
          }
          if (cmd === "ai_configuration") {
            if (w.configReadFailure) throw "Synthetic suggestion unavailable";
            return structuredClone(
              w.aiJobs.find((j: any) => j.id === args.id).proposal
                .configuration,
            );
          }
          if (cmd === "ai_mapping_preview") {
            const input = structuredClone(args.input);
            if (w.mappingDelay)
              await new Promise((r) => setTimeout(r, w.mappingDelay));
            return {
              token: JSON.stringify(input),
              candidates: [
                {
                  date: "2026-10-01",
                  description: "Store",
                  amountCents: 62400,
                  direction:
                    input.mapping.amountMode === "outflow_positive"
                      ? "out"
                      : "in",
                  status: input.mapping.postedConfirmed ? "posted" : "unknown",
                  currency: "USD",
                  warnings: [],
                },
                {
                  date: "2026-10-03",
                  description: "CARD PAYMENT",
                  amountCents: 62400,
                  direction:
                    input.mapping.amountMode === "outflow_positive"
                      ? "in"
                      : "out",
                  status: input.mapping.postedConfirmed ? "posted" : "unknown",
                  currency: "USD",
                  warnings: [],
                },
              ],
            };
          }
          if (cmd === "ai_mapping_apply") {
            if (w.mappingSaveFailure) throw "Synthetic mapping save failure";
            w.source.revision++;
            return;
          }
          if (cmd === "preview_pdf_table")
            return {
              token: "table-token",
              extraction: {
                headers: ["Date", "Description", "Amount"],
                rows: [["10/01/2026", "Store", "100.00"]],
                evidence: [{ page: 1, firstLine: 4, lastLine: 4 }],
              },
            };
          if (cmd === "save_pdf_table") {
            w.tableSaved = args.input;
            return;
          }
          if (cmd === "ai_document_application") {
            if (w.aiDocumentReadFailure)
              throw "Synthetic saved review unavailable";
            return w.aiDocumentApplied ?? null;
          }
          if (cmd === "ai_document_preview") {
            const input = structuredClone(args.input);
            if (w.aiDocumentDelay)
              await new Promise((r) => setTimeout(r, w.aiDocumentDelay));
            return {
              token: JSON.stringify(input),
              kind: input.month ? "statement" : "bill",
              warnings: ["Verify the total against the original document."],
              target: {
                targetName: input.month ? "American Express" : "Utility",
                priorAmountCents: 10000,
                newAmountCents: Math.round(Number(input.fields[0].value) * 100),
                priorDueDate: "2026-11-02",
                dueDate: input.fields.find((f: any) => f.key === "due_date")
                  .value,
                calculation: input.month
                  ? {
                      balanceCents: 10000,
                      warnings: ["Synthetic partial account coverage"],
                    }
                  : null,
              },
            };
          }
          if (cmd === "ai_document_apply") {
            if (!w.aiDocumentApplied) {
              w.aiDocumentApplied = {
                jobId: args.input.input.jobId,
                input: structuredClone(args.input.input),
                review: {
                  token: args.input.token,
                  kind: args.input.input.month ? "statement" : "bill",
                  warnings: [],
                  target: {
                    targetName: "Utility",
                    priorAmountCents: 10000,
                    newAmountCents: Math.round(
                      Number(args.input.input.fields[0].value) * 100,
                    ),
                    priorDueDate: "2026-11-02",
                    dueDate: "2026-11-05",
                    calculation: null,
                  },
                },
              };
              w.source.revision++;
            }
            if (w.aiDocumentLost) {
              w.aiDocumentLost = false;
              throw "Synthetic response lost after saving";
            }
            return;
          }
          if (cmd === "ai_rows_binding")
            return w.aiStaged
              ? { jobId: w.aiStaged.input.jobId, rows: w.aiStaged.input.rows }
              : null;
          if (cmd === "ai_rows_preview") {
            if (w.aiRowPreviewDelay)
              await new Promise((r) => setTimeout(r, w.aiRowPreviewDelay));
            if (w.aiRowPreviewFailure) throw "Synthetic row preview failure";
            return {
              token: JSON.stringify(args.input),
              previousRows: 0,
              candidates: args.input.rows.map((r: any) => ({
                date: r.date,
                description: r.description,
                amountCents: r.amount
                  ? Math.round(Number(r.amount) * 100)
                  : null,
                direction: r.direction,
                status: r.status,
                currency: r.currency ?? "",
                sourceType: "",
                warnings: ["AI-assisted reading requires individual review."],
              })),
            };
          }
          if (cmd === "ai_rows_stage") {
            if (w.aiRowStageFailure) throw "Synthetic row staging failure";
            w.aiStaged = args.input;
            w.source.revision++;
            w.source.rowCount = args.input.input.rows.length;
            return;
          }
          if (cmd === "ai_prepare") {
            return {
              token: "consent-token",
              model: "synthetic-model",
              sourceName: w.source.name,
              attachmentBytes: args.input.scope === "original" ? 1234 : 0,
              text: args.input.text,
            };
          }
          if (cmd === "ai_start") {
            w.aiJobs ??= [];
            let job = w.aiJobs.find((j: any) => j.id === args.input.id);
            if (!job) {
              w.aiSends = (w.aiSends ?? 0) + 1;
              job = {
                id: args.input.id,
                sourceId: args.input.input.sourceId,
                request: {
                  input: args.input.input,
                  model: "synthetic-model",
                  attachmentBytes:
                    args.input.input.scope === "original" ? 1234 : 0,
                },
                status: "running",
                createdAt: "2026-11-03T12:00:00Z",
                proposal: null,
                failure: null,
                retryNotBefore: null,
              };
              w.aiJobs.push(job);
            }
            if (w.aiStartLost) {
              w.aiStartLost = false;
              throw "Synthetic response lost after request saved";
            }
            return structuredClone(job);
          }
          if (cmd === "ai_cancel") {
            const j = w.aiJobs.find((j: any) => j.id === args.id);
            j.status = "cancelled";
            return structuredClone(j);
          }
          if (cmd === "save_ai_provider") {
            if (w.providerSaveFailure) throw "Synthetic provider save failure";
            w.savedProvider = args.input;
            return {
              provider: args.input.provider,
              revision: 1,
              enabled: args.input.enabled,
              model: args.input.model,
              hasKey: args.input.keyAction !== "remove",
            };
          }
          if (cmd === "pdf_original") {
            if (w.failPdfRead) throw "Synthetic original read failure";
            if (w.pdfDelay) await new Promise((r) => setTimeout(r, w.pdfDelay));
            return w.pdfBytes;
          }
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
              id: "application-1",
              kind: w.review.kind,
              targetId: args.input.input.targetId,
              month: args.input.input.month,
              review: structuredClone(w.review),
              note: args.input.input.note,
            };
            w.source.revision++;
            return;
          }
          if (cmd === "pdf_route_view") {
            if (w.failRouteRead) throw "Synthetic route read failure";
            const result = structuredClone({
              targetName: "Utility",
              templateVersion: 1,
              route: w.route ?? null,
              suggestedMarker: { page: 1, text: "Account: TEST-1234" },
              issue: w.routeIssue ?? null,
            });
            if (w.routeDelay)
              await new Promise((r) => setTimeout(r, w.routeDelay));
            return result;
          }
          if (cmd === "configure_pdf_route") {
            if (w.failRouteSave) {
              w.failRouteSave = false;
              throw "Synthetic interrupted route response";
            }
            w.route = {
              ...args.input,
              revision: args.input.revision + 1,
              templateVersion: 1,
            };
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
    {
      snapshot,
      options,
      pdfBytes: readFileSync(
        "src-tauri/fixtures/pdf/transactions.pdf",
      ).toString("base64"),
    },
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
async function existing(page: Page, statement = false) {
  await setup(page, { statement });
  await page.evaluate(() => {
    (window as any).templates = [(window as any).template];
  });
  await page.getByRole("button", { name: "All sources" }).click();
  await page.getByRole("button", { name: /Synthetic bill.pdf/ }).click();
}
async function review(page: Page, statement = false) {
  await page.getByRole("button", { name: "Review with template" }).click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel(statement ? "Card cycle" : "Existing bill")
    .selectOption(statement ? "amex" : "bill-1");
  await modal
    .getByLabel("Document reference / review note")
    .fill("Checked synthetic original");
  await modal.getByRole("button", { name: "Preview document changes" }).click();
  return modal;
}
test("template approval requires valid evidence and confirmation, retry keeps operation identity", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "New PDF template" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Template name").fill("Utility");
  await expect(
    modal.getByRole("button", { name: "Approve template version" }),
  ).toBeDisabled();
  await modal.getByRole("button", { name: "Preview sample" }).click();
  await expect(modal.getByText("Page 1, line 3")).toBeVisible();
  await modal.getByLabel("I checked the source values").check();
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await modal.getByRole("button", { name: "Approve template version" }).click();
  await expect(modal.getByRole("alert")).toContainText("interrupted");
  await modal.getByRole("button", { name: "Approve template version" }).click();
  await expect(modal).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Review with template" }),
  ).toBeEnabled();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "approve_pdf_template"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args).toEqual(calls[1].args);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review with template" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review with template" }),
  ).toBeEnabled();
});
test("mapping edits invalidate a delayed sample preview and failed evidence cannot be approved", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "New PDF template" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Template name").fill("Utility");
  await page.evaluate(() => {
    (window as any).delay = 400;
  });
  await modal.getByRole("button", { name: "Preview sample" }).click();
  await modal.getByLabel("Template name").fill("Revised");
  await page.waitForTimeout(550);
  await expect(modal.getByLabel("I checked the source values")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).delay = 0;
    (window as any).drift = true;
  });
  await modal.getByRole("button", { name: "Preview sample" }).click();
  await expect(modal.getByRole("alert")).toContainText("positions changed");
  await expect(
    modal.getByRole("button", { name: "Approve template version" }),
  ).toBeDisabled();
});
test("bill application shows changes, retries safely, and displays saved evidence once", async ({
  page,
}) => {
  await existing(page);
  const modal = await review(page);
  await expect(modal.getByText("Total:", { exact: false })).toContainText(
    "$100.00",
  );
  await expect(
    modal.getByRole("button", { name: "Apply document once" }),
  ).toBeDisabled();
  await modal.getByLabel("I checked the original document").check();
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await modal.getByRole("button", { name: "Apply document once" }).click();
  await expect(modal.getByRole("alert")).toContainText("interrupted");
  await modal.getByRole("button", { name: "Apply document once" }).click();
  await expect(page.getByText("Document already applied")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review with template" }),
  ).toBeDisabled();
  const c = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "apply_pdf_application"),
  );
  expect(c).toHaveLength(2);
  expect(c[0].args).toEqual(c[1].args);
  expect(c[0].args.input.input.month).toBe("");
});
test("target changes discard delayed application reviews and target loads can retry", async ({
  page,
}) => {
  await existing(page);
  await page.evaluate(() => {
    (window as any).failTargets = true;
  });
  await page.getByRole("button", { name: "Review with template" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("alert")).toContainText("target failure");
  await page.evaluate(() => {
    (window as any).failTargets = false;
  });
  await modal.getByRole("button", { name: "Retry target records" }).click();
  await modal.getByLabel("Existing bill").selectOption("bill-1");
  await modal.getByLabel("Document reference / review note").fill("Checked");
  await page.evaluate(() => {
    (window as any).delay = 400;
  });
  await modal.getByRole("button", { name: "Preview document changes" }).click();
  await modal.getByLabel("Target month").fill("2026-10");
  await page.waitForTimeout(550);
  await expect(modal.getByLabel("I checked the original document")).toHaveCount(
    0,
  );
  await expect(
    modal.getByRole("button", { name: "Apply document once" }),
  ).toBeDisabled();
});
test("statement review shows difference and incomplete coverage with correct card cycle", async ({
  page,
}) => {
  await existing(page, true);
  const modal = await review(page, true);
  await expect(modal.getByText(/Calculated statement:/)).toContainText(
    "$80.00",
  );
  await expect(modal.getByText(/Difference:/)).toContainText("$6.00");
  await expect(
    modal.getByText("Accepted complete coverage is missing."),
  ).toBeVisible();
  await modal.getByLabel("I checked the original document").check();
  await modal.getByRole("button", { name: "Apply document once" }).click();
  await expect(page.getByText("Document already applied")).toBeVisible();
  const c = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "apply_pdf_application"),
  );
  expect(c.args.input.input.targetId).toBe("amex");
  expect(c.args.input.input.month).toBe("2026-11");
});
test("scanned or legacy PDF has a local retry and original export, without an apply action", async ({
  page,
}) => {
  await setup(page, { empty: true });
  await expect(page.getByText("No supported text layer")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "New PDF template" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Export original PDF" }).click();
  await expect(page.getByText(/Original saved:/)).toContainText(
    "synthetic-exports/original.pdf",
  );
  await page.getByRole("button", { name: "Extract text locally" }).click();
  await expect(
    page.getByRole("button", { name: "New PDF template" }),
  ).toBeVisible();
});
test("document drift blocks application, and compact light and dark layouts remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 780 });
  await existing(page);
  await page.evaluate(() => {
    (window as any).drift = true;
  });
  const modal = await review(page);
  await expect(modal.getByRole("alert")).toContainText(
    "Label positions changed",
  );
  await expect(
    modal.getByRole("button", { name: "Apply document once" }),
  ).toBeDisabled();
  await modal.getByText("Extracted page text", { exact: true }).click();
  await expect(
    modal.getByText("Amount due: $86.00", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1100);
  await page.screenshot({ path: ".qa/pdf-review-light.png" });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: ".qa/pdf-review-dark.png" });
});

async function applied(page: Page) {
  await existing(page);
  const modal = await review(page);
  await modal.getByLabel("I checked the original document").check();
  await modal.getByRole("button", { name: "Apply document once" }).click();
  await page
    .getByText("Reuse this bill or statement destination", { exact: true })
    .click();
}
test("destination reuse is opt in, requires renewed confirmation and supports retry and pause", async ({
  page,
}) => {
  await applied(page);
  const save = page.getByRole("button", { name: "Save destination reuse" });
  const enabled = page.getByLabel("Automatically update this destination");
  const confirmed = page.getByLabel("I confirmed this destination");
  await expect(enabled).not.toBeChecked();
  await expect(save).toBeDisabled();
  await enabled.check();
  await confirmed.check();
  await page
    .getByLabel("Exact account-specific line")
    .fill("Account: TEST-1235");
  await expect(confirmed).not.toBeChecked();
  await expect(save).toBeDisabled();
  await confirmed.check();
  await page.evaluate(() => {
    (window as any).failRouteSave = true;
  });
  await save.click();
  await expect(page.getByRole("alert")).toContainText("interrupted route");
  await save.click();
  await expect(confirmed).not.toBeChecked();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "configure_pdf_route"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args).toEqual(calls[1].args);
  await enabled.uncheck();
  await confirmed.check();
  await save.click();
  await expect(enabled).not.toBeChecked();
  const last = await page.evaluate(() =>
    (window as any).calls
      .filter((c: any) => c.cmd === "configure_pdf_route")
      .at(-1),
  );
  expect(last.args.input.enabled).toBe(false);
  expect(last.args.input.revision).toBe(1);
});
test("destination read errors recover and changed templates cannot be enabled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).failRouteRead = true;
  });
  await applied(page);
  await expect(page.getByRole("alert")).toContainText("route read failure");
  await page.evaluate(() => {
    const w = window as any;
    w.failRouteRead = false;
    w.routeIssue = "Template changed. Apply the current version.";
  });
  await page.getByRole("button", { name: "Reload destination reuse" }).click();
  await expect(
    page.getByText("Template changed. Apply the current version."),
  ).toBeVisible();
  await page.getByLabel("Automatically update this destination").check();
  await page.getByLabel("I confirmed this destination").check();
  await expect(
    page.getByRole("button", { name: "Save destination reuse" }),
  ).toBeDisabled();
});
test("delayed destination reads cannot populate another workspace", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).routeDelay = 600;
  });
  await applied(page);
  await page
    .getByRole("button", { name: "Workspace & backups", exact: true })
    .click();
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await expect(page.getByText("Personal · USD", { exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  await expect(
    page.getByRole("button", { name: "Save destination reuse" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).calls.filter((c: any) => c.cmd === "configure_pdf_route"),
    ),
  ).toHaveLength(0);
});
test("destination settings fit a compact light and dark desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 780 });
  await applied(page);
  await page.getByLabel("Automatically update this destination").check();
  await page.getByLabel("Exact account-specific line").scrollIntoViewIfNeeded();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1100);
  await page.screenshot({ path: ".qa/pdf-reuse-light.png" });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: ".qa/pdf-reuse-dark.png" });
});

test("original PDF renders real pages locally with navigation and bounded zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 780 });
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith("http://127.0.0.1:1420")
    )
      external.push(r.url());
  });
  await setup(page);
  await page.evaluate(() => {
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content =
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' ipc: http://ipc.localhost; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' blob:";
    document.head.append(meta);
  });
  await page.getByText("Original PDF pages", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "PDF page", exact: true }),
  ).toHaveValue("1", { timeout: 15000 });
  await expect(
    page.getByText("Rendering PDF page...", { exact: true }),
  ).toHaveCount(0);
  const canvas = page.getByRole("img", {
    name: "Original PDF page 1",
    exact: true,
  });
  await expect(canvas).toBeVisible();
  expect(
    await canvas.evaluate((c: HTMLCanvasElement) => {
      const pixels = c
        .getContext("2d")!
        .getImageData(0, 0, c.width, c.height).data;
      let nonwhite = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 180 && pixels[i + 3] > 0) nonwhite++;
      return nonwhite;
    }),
  ).toBeGreaterThan(500);
  await page.getByRole("button", { name: "Next PDF page" }).click();
  await expect(
    page.getByRole("img", { name: "Original PDF page 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next PDF page" }),
  ).toBeDisabled();
  await page.getByLabel("PDF zoom").selectOption("2");
  await expect(
    page.getByText("Rendering PDF page...", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Previous PDF page" }).click();
  await page.getByLabel("PDF zoom").selectOption("1");
  await expect(
    page.getByText("Rendering PDF page...", { exact: true }),
  ).toHaveCount(0);
  await page.locator(".pdf-canvas-scroll").scrollIntoViewIfNeeded();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1100);
  await page.screenshot({ path: ".qa/pdf-original-light.png" });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.waitForTimeout(200);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(async () =>
      page
        .getByRole("img", { name: "Original PDF page 1", exact: true })
        .evaluate((c: HTMLCanvasElement) => {
          const data = c
            .getContext("2d")!
            .getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i] < 180 && data[i + 3] > 0) n++;
          return n;
        }),
    )
    .toBeGreaterThan(500);
  await page.screenshot({ path: ".qa/pdf-original-dark.png" });
  expect(external).toEqual([]);
});
test("original PDF read failure and invalid bytes recover without losing source", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).failPdfRead = true;
  });
  await page.getByText("Original PDF pages", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("original read failure");
  const saved = await page.evaluate(() => (window as any).pdfBytes);
  await page.evaluate(() => {
    const w = window as any;
    w.failPdfRead = false;
    w.pdfBytes = btoa("not a PDF");
  });
  await page.getByRole("button", { name: "Retry PDF preview" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "PDF preview unavailable",
  );
  await page.evaluate((saved) => {
    (window as any).pdfBytes = saved;
  }, saved);
  await page.getByRole("button", { name: "Retry PDF preview" }).click();
  await expect(
    page.getByRole("img", { name: "Original PDF page 1", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("closing the PDF cancels delayed work and a new source context gets a fresh viewer", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).pdfDelay = 500;
  });
  await page.getByText("Original PDF pages", { exact: true }).click();
  await expect(page.getByText("Opening original PDF...")).toBeVisible();
  await page.getByText("Original PDF pages", { exact: true }).click();
  await page.waitForTimeout(600);
  await expect(page.locator(".pdf-canvas-scroll canvas")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).pdfDelay = 0;
  });
  await page.getByText("Original PDF pages", { exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Original PDF page 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All sources" }).click();
  await expect(page.locator(".pdf-canvas-scroll canvas")).toHaveCount(0);
});

test("original preview inside template editing preserves the unsaved mapping", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "New PDF template" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Template name").fill("Unsaved utility mapping");
  await modal.getByText("Original PDF pages", { exact: true }).click();
  await expect(
    modal.getByRole("img", { name: "Original PDF page 1", exact: true }),
  ).toBeVisible();
  await modal.getByRole("button", { name: "Next PDF page" }).click();
  await expect(
    modal.getByRole("img", { name: "Original PDF page 2", exact: true }),
  ).toBeVisible();
  await modal.getByText("Original PDF pages", { exact: true }).click();
  await expect(modal.getByLabel("Template name")).toHaveValue(
    "Unsaved utility mapping",
  );
  expect(
    await page.evaluate(() =>
      (window as any).calls.filter(
        (c: any) =>
          c.cmd === "approve_pdf_template" || c.cmd === "apply_pdf_application",
      ),
    ),
  ).toHaveLength(0);
});

test("optional provider setup starts disabled, hides keys and preserves failed edits", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Optional AI providers", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByLabel("Enable requests to this provider"),
  ).not.toBeChecked();
  await expect(modal.getByLabel("API model ID")).toHaveAttribute(
    "placeholder",
    "claude-opus-5-5",
  );
  await expect(
    modal.getByText("Default: claude-opus-5-5 at high effort"),
  ).toBeVisible();
  await modal.getByLabel("API model ID").fill("synthetic-model");
  await modal.getByLabel("API key action").selectOption("replace");
  await modal.getByLabel("New API key").fill("synthetic-key-only");
  await expect(modal.getByLabel("New API key")).toHaveAttribute(
    "type",
    "password",
  );
  await modal.getByLabel("Enable requests to this provider").check();
  await page.evaluate(() => {
    (window as any).providerSaveFailure = true;
  });
  await modal.getByRole("button", { name: "Save provider settings" }).click();
  await expect(modal.getByRole("alert")).toContainText("save failure");
  await expect(modal.getByLabel("API model ID")).toHaveValue("synthetic-model");
  await page.evaluate(() => {
    (window as any).providerSaveFailure = false;
  });
  await modal.getByRole("button", { name: "Save provider settings" }).click();
  await expect(modal).toHaveCount(0);
  const saved = await page.evaluate(() => (window as any).savedProvider);
  expect(saved.provider).toBe("claude");
  expect(saved.enabled).toBe(true);
  await page
    .getByRole("button", { name: "Optional AI providers", exact: true })
    .click();
  await modal.getByLabel("API key action").selectOption("replace");
  await expect(modal.getByLabel("New API key")).toHaveValue("");
});
test("provider read retries and dirty provider changes require explicit discard", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).providerReadFailure = true;
  });
  await page
    .getByRole("button", { name: "Optional AI providers", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("alert")).toContainText("read failure");
  await page.evaluate(() => {
    (window as any).providerReadFailure = false;
  });
  await modal.getByRole("button", { name: "Reload provider settings" }).click();
  await modal.getByLabel("API model ID").fill("draft-model");
  page.once("dialog", (d) => d.dismiss());
  await modal
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("openai");
  await expect(
    modal.getByRole("combobox", { name: "Provider", exact: true }),
  ).toHaveValue("claude");
  await expect(modal.getByLabel("API model ID")).toHaveValue("draft-model");
  page.once("dialog", (d) => d.accept());
  await modal
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("openai");
  await expect(modal.getByLabel("API model ID")).toHaveValue("");
  await modal.getByLabel("API key action").selectOption("remove");
  await expect(
    modal.getByLabel("Enable requests to this provider"),
  ).toBeDisabled();
});

async function openAssistance(page: Page) {
  await setup(page);
  await page.evaluate(() => {
    (window as any).providers = [
      {
        provider: "claude",
        enabled: true,
        hasKey: true,
        revision: 1,
        model: "synthetic-model",
      },
    ];
  });
  await page
    .getByRole("button", { name: "AI document assistance", exact: true })
    .click();
  return page.getByRole("dialog", { name: "AI document assistance" });
}
test("AI requests require material confirmation and changed drafts invalidate consent", async ({
  page,
}) => {
  const modal = await openAssistance(page);
  await expect(modal.getByLabel("Source text to send")).toContainText(
    "Amount due",
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "ai_start").length,
    ),
  ).toBe(0);
  await modal
    .getByRole("button", { name: "Review request before sending" })
    .click();
  await expect(
    modal.getByRole("button", { name: "Send this request" }),
  ).toBeDisabled();
  await modal
    .getByLabel("I approve sending this material to this provider.")
    .check();
  await modal
    .getByLabel("Source text to send")
    .fill("Redacted source: amount due 86.00");
  await expect(
    modal.getByRole("button", { name: "Send this request" }),
  ).toHaveCount(0);
  await modal
    .getByRole("button", { name: "Review request before sending" })
    .click();
  await expect(
    modal.getByText("Text only; no attachment.", { exact: true }),
  ).toBeVisible();
  await modal
    .getByLabel("I approve sending this material to this provider.")
    .check();
  await modal.getByRole("button", { name: "Send this request" }).click();
  await expect(
    modal.getByRole("heading", { name: "bill · running" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).aiJobs[0].request.input.text),
  ).toBe("Redacted source: amount due 86.00");
  await modal.getByRole("button", { name: "Cancel request" }).click();
  await expect(
    modal.getByRole("heading", { name: "bill · cancelled" }),
  ).toBeVisible();
});
test("lost AI send responses retry the same ID and display source-backed proposals", async ({
  page,
}) => {
  const modal = await openAssistance(page);
  await modal.getByLabel("Material to send").selectOption("original");
  await modal.getByLabel("Source text to send").fill("");
  await modal
    .getByRole("button", { name: "Review request before sending" })
    .click();
  await expect(
    modal.getByText(/Original attachment: 1,234 bytes/),
  ).toBeVisible();
  await modal
    .getByLabel("I approve sending this material to this provider.")
    .check();
  await page.evaluate(() => {
    (window as any).aiStartLost = true;
  });
  await modal.getByRole("button", { name: "Send this request" }).click();
  await expect(modal.getByRole("alert")).toContainText("response lost");
  await modal.getByRole("button", { name: "Send this request" }).click();
  await expect(
    modal.getByRole("heading", { name: "bill · running" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).aiSends)).toBe(1);
  await page.evaluate(() => {
    const j = (window as any).aiJobs[0];
    j.status = "completed";
    j.proposal = {
      fields: [
        {
          key: "amount_due",
          value: "86.00",
          evidence: { page: 1, quote: "Amount due: $86.00" },
        },
      ],
      rows: [],
      warnings: ["Check all pages."],
    };
  });
  await expect(
    modal.getByRole("heading", { name: "bill · completed" }),
  ).toBeVisible();
  await expect(
    modal.getByRole("cell", { name: "86.00", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByText(/These values have not changed your records/),
  ).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 780 });
  await modal.locator(".assistance-body").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await page.screenshot({
    path: ".qa/ai-assistance-light.png",
    animations: "disabled",
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: ".qa/ai-assistance-dark.png",
    animations: "disabled",
  });
});
test("disabled AI stays offline and draft discard preserves edited source text", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "AI document assistance", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "AI document assistance" });
  await expect(
    modal.getByRole("button", { name: "Review request before sending" }),
  ).toBeDisabled();
  await modal.getByLabel("Source text to send").fill("draft source");
  page.once("dialog", (d) => d.dismiss());
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await expect(modal.getByLabel("Source text to send")).toHaveValue(
    "draft source",
  );
  page.once("dialog", (d) => d.accept());
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await expect(modal).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) =>
          ["ai_start", "ai_prepare"].includes(c.cmd),
        ).length,
    ),
  ).toBe(0);
});

test("AI status read errors retry without sending and provider failures stay actionable", async ({
  page,
}) => {
  const modal = await openAssistance(page);
  await page.evaluate(() => {
    const w = window as any;
    w.aiReadFailure = true;
    w.aiJobs = [
      {
        id: "failed-request",
        sourceId: w.source.id,
        request: {
          input: {
            sourceRevision: 1,
            provider: "claude",
            task: "bill",
            scope: "text",
            text: "synthetic",
          },
          model: "synthetic-model",
          attachmentBytes: 0,
        },
        status: "failed",
        createdAt: "2026-11-03T12:00:00Z",
        proposal: null,
        failure: {
          kind: "billing",
          message: "Check provider credits before sending again.",
          retryAfter: null,
        },
        retryNotBefore: null,
      },
    ];
  });
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "AI document assistance", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText("status unavailable");
  await page.evaluate(() => {
    (window as any).aiReadFailure = false;
  });
  await modal.getByRole("button", { name: "Refresh request status" }).click();
  await expect(
    modal.getByText("Check provider credits before sending again."),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).aiSends ?? 0)).toBe(0);
});

async function openAiRows(page: Page) {
  const parent = await openAssistance(page);
  await parent.getByRole("button", { name: "Close dialog" }).click();
  await page.evaluate(() => {
    const w = window as any;
    w.aiJobs = [
      {
        id: "synthetic-row-job",
        sourceId: w.source.id,
        request: {
          input: {
            sourceRevision: 1,
            provider: "claude",
            task: "transactions",
            scope: "text",
            text: "Synthetic rows",
          },
          model: "synthetic-model",
          attachmentBytes: 0,
        },
        status: "completed",
        createdAt: "2026-11-03T12:00:00Z",
        proposal: {
          fields: [],
          warnings: [],
          rows: [
            {
              date: "2026-10-01",
              description: "Synthetic store",
              amount: "100.00",
              direction: "out",
              status: "posted",
              currency: "USD",
              evidence: { page: 1, quote: "Store 100.00" },
            },
            {
              date: "2026-10-01",
              description: "Synthetic store",
              amount: "100.00",
              direction: "out",
              status: "posted",
              currency: "USD",
              evidence: { page: 1, quote: "Store 100.00" },
            },
          ],
        },
        failure: null,
        retryNotBefore: null,
        usage: { inputTokens: 1200, outputTokens: 340 },
      },
    ];
  });
  await page
    .getByRole("button", { name: "AI document assistance", exact: true })
    .click();
  await expect(parent.getByText("Tokens: 1,200 in · 340 out")).toBeVisible();
  await parent.getByRole("button", { name: "Review rows for import" }).click();
  return page.getByRole("dialog", { name: "Review AI transaction rows" });
}
test("AI row corrections require a new preview and staging retry preserves one operation", async ({
  page,
}) => {
  const modal = await openAiRows(page);
  await modal
    .getByLabel("Description 1", { exact: true })
    .fill("Corrected store");
  await modal.getByRole("button", { name: "Preview staged rows" }).click();
  await expect(
    modal.getByRole("button", { name: "Stage reviewed rows" }),
  ).toBeDisabled();
  await modal.getByLabel(/I checked these rows and source quotes/).check();
  await modal.getByLabel("Amount 1", { exact: true }).fill("101.25");
  await expect(
    modal.getByRole("button", { name: "Stage reviewed rows" }),
  ).toHaveCount(0);
  await modal.getByRole("button", { name: "Preview staged rows" }).click();
  await expect(modal.getByRole("cell", { name: /\$101.25/ })).toBeVisible();
  await modal.getByLabel(/I checked these rows and source quotes/).check();
  await page.evaluate(() => {
    (window as any).aiRowStageFailure = true;
  });
  await modal.getByRole("button", { name: "Stage reviewed rows" }).click();
  await expect(modal.getByRole("alert")).toContainText("staging failure");
  await expect(modal.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Corrected store",
  );
  await page.evaluate(() => {
    (window as any).aiRowStageFailure = false;
  });
  await modal.getByRole("button", { name: "Stage reviewed rows" }).click();
  await expect(modal).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "ai_rows_stage"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.input.input.rows).toHaveLength(2);
  await page.getByText("Reviewed AI row evidence", { exact: true }).click();
  await expect(
    page.getByText("Corrected store", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "AI document assistance", exact: true })
    .click();
  await page.getByRole("button", { name: "Review rows for import" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Review AI transaction rows" })
      .getByLabel("Description 1", { exact: true }),
  ).toHaveValue("Corrected store");
});
test("AI row preview discards late results and missing-row edits survive cancelled discard", async ({
  page,
}) => {
  const modal = await openAiRows(page);
  await page.evaluate(() => {
    (window as any).aiRowPreviewDelay = 400;
  });
  await modal.getByRole("button", { name: "Preview staged rows" }).click();
  await modal
    .getByLabel("Description 1", { exact: true })
    .fill("Changed during preview");
  await page.waitForTimeout(500);
  await expect(
    modal.getByRole("button", { name: "Stage reviewed rows" }),
  ).toHaveCount(0);
  await modal.getByRole("button", { name: "Add missing row" }).click();
  await modal
    .getByLabel("Description 3", { exact: true })
    .fill("Missing purchase");
  await modal
    .getByLabel("Source quote 3", { exact: true })
    .fill("Missing purchase 5.00");
  page.once("dialog", (d) => d.dismiss());
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await expect(modal.getByLabel("Description 3", { exact: true })).toHaveValue(
    "Missing purchase",
  );
  await modal.getByRole("button", { name: "Remove proposed row 2" }).click();
  await expect(modal.getByLabel("Description 2", { exact: true })).toHaveValue(
    "Missing purchase",
  );
  await page.setViewportSize({ width: 1100, height: 780 });
  await page.screenshot({
    path: ".qa/ai-rows-light.png",
    animations: "disabled",
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: ".qa/ai-rows-dark.png",
    animations: "disabled",
  });
});

async function openAiDocument(page: Page, statement = false) {
  const parent = await openAssistance(page);
  await parent.getByRole("button", { name: "Close dialog" }).click();
  await page.evaluate((statement) => {
    const w = window as any;
    const pairs = statement
      ? [
          ["statement_balance", "126.00"],
          ["closing_date", "2026-10-20"],
          ["due_date", "2026-11-15"],
        ]
      : [
          ["amount_due", "86.00"],
          ["due_date", "2026-11-05"],
        ];
    w.aiJobs = [
      {
        id: "synthetic-document-job",
        sourceId: w.source.id,
        request: {
          input: {
            sourceRevision: 1,
            provider: "claude",
            task: statement ? "statement" : "bill",
            scope: "text",
            text: "Synthetic document",
          },
          model: "synthetic-model",
          attachmentBytes: 0,
        },
        status: "completed",
        createdAt: "2026-11-03T12:00:00Z",
        proposal: {
          fields: pairs.map(([key, value]) => ({
            key,
            value,
            evidence: { page: 1, quote: `${key}: ${value}` },
          })),
          rows: [],
          warnings: [],
        },
        failure: null,
        retryNotBefore: null,
      },
    ];
  }, statement);
  await page
    .getByRole("button", { name: "AI document assistance", exact: true })
    .click();
  await parent
    .getByRole("button", { name: "Review fields for bill or statement" })
    .click();
  return page.getByRole("dialog", { name: "Review AI document fields" });
}
test("AI document review preserves corrections and retries a lost response without applying twice", async ({
  page,
}) => {
  const modal = await openAiDocument(page);
  await modal.getByLabel("Existing bill").selectOption("bill-1");
  await modal
    .getByLabel("Document reference / review note")
    .fill("Checked synthetic utility bill");
  await modal.getByLabel("Amount due", { exact: true }).fill("88.00");
  await modal.getByLabel("Amount due source quote").fill("Amount due 88.00");
  const preview = modal.getByRole("button", {
    name: "Preview reviewed document",
  });
  await expect(preview).toBeDisabled();
  await modal.getByLabel(/I verified USD/).check();
  await preview.click();
  const apply = modal.getByRole("button", {
    name: "Apply reviewed document once",
  });
  await expect(apply).toBeDisabled();
  await modal
    .getByLabel(/I checked the original document, corrected fields/)
    .check();
  await modal.getByLabel("Amount due", { exact: true }).fill("89.00");
  await expect(apply).toBeDisabled();
  await preview.click();
  await expect(modal.getByText("$89.00", { exact: true })).toBeVisible();
  await modal
    .getByLabel(/I checked the original document, corrected fields/)
    .check();
  await page.evaluate(() => {
    (window as any).aiDocumentLost = true;
  });
  await apply.click();
  await expect(modal.getByRole("alert")).toContainText("response lost");
  await apply.click();
  await expect(modal).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "ai_document_apply"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  await page
    .getByRole("button", { name: "AI document assistance", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review fields for bill or statement" })
    .click();
  await expect(
    modal.getByText(/This document was already applied/),
  ).toBeVisible();
  await expect(modal.getByLabel("Amount due", { exact: true })).toHaveValue(
    "89.00",
  );
  await expect(modal.getByLabel("Amount due", { exact: true })).toBeDisabled();
  await expect(apply).toHaveCount(0);
});
test("AI statement review rejects delayed previews after edits and shows balance differences", async ({
  page,
}) => {
  const modal = await openAiDocument(page, true);
  await modal.getByLabel("Target month").fill("2026-10");
  await modal.getByLabel("Card cycle").selectOption("amex");
  await modal
    .getByLabel("Document reference / review note")
    .fill("Checked statement total and cutoff");
  await modal.getByLabel(/I verified USD/).check();
  await page.evaluate(() => {
    (window as any).aiDocumentDelay = 400;
  });
  await modal
    .getByRole("button", { name: "Preview reviewed document" })
    .click();
  await modal.getByLabel("Statement balance", { exact: true }).fill("125.00");
  await page.waitForTimeout(500);
  await expect(
    modal.getByLabel(/I checked the original document, corrected fields/),
  ).toHaveCount(0);
  page.once("dialog", (d) => d.dismiss());
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    modal.getByLabel("Statement balance", { exact: true }),
  ).toHaveValue("125.00");
  await modal
    .getByRole("button", { name: "Preview reviewed document" })
    .click();
  await expect(modal.getByText(/Difference: \$25.00/)).toBeVisible();
  await expect(
    modal.getByText("Synthetic partial account coverage"),
  ).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 780 });
  await modal.locator(".assistance-body").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: ".qa/ai-document-light.png",
    animations: "disabled",
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: ".qa/ai-document-dark.png",
    animations: "disabled",
  });
});
test("AI document history and target read failures keep edits unavailable until retry", async ({
  page,
}) => {
  const modal = await openAiDocument(page);
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await page.evaluate(() => {
    (window as any).aiDocumentReadFailure = true;
  });
  await page
    .getByRole("button", { name: "Review fields for bill or statement" })
    .click();
  await expect(modal.getByRole("alert")).toContainText(
    "saved review unavailable",
  );
  await expect(modal.getByLabel("Amount due", { exact: true })).toBeDisabled();
  await page.evaluate(() => {
    (window as any).aiDocumentReadFailure = false;
    (window as any).failTargets = true;
  });
  await modal.getByRole("button", { name: "Retry document records" }).click();
  await expect(modal.getByRole("alert")).toContainText("target failure");
  await page.evaluate(() => {
    (window as any).failTargets = false;
  });
  await modal.getByRole("button", { name: "Retry document records" }).click();
  await modal.getByLabel("Existing bill").selectOption("bill-1");
  await expect(modal.getByRole("alert")).toHaveCount(0);
});

async function openAiConfiguration(page: Page, kind = "mapping") {
  const parent = await openAssistance(page);
  await parent.getByRole("button", { name: "Close dialog" }).click();
  await page.evaluate((kind) => {
    const w = window as any;
    const mapping = {
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
      debitColumn: null,
      creditColumn: null,
      statusColumn: null,
      typeColumn: null,
      postedDateColumn: null,
      stableIdColumn: null,
      currencyColumn: null,
      stableIdsConfirmed: false,
      amountMode: "outflow_positive",
      dateFormat: "iso",
      year: null,
      postedConfirmed: false,
    };
    const definition =
      kind === "mapping"
        ? mapping
        : kind === "pdf_template"
          ? structuredClone(w.template.definition)
          : {
              name: "Suggested table",
              identity: "SYNTHETIC UTILITY",
              currency: "Currency: USD",
              start: "Transactions",
              end: "End transactions",
              headers: ["Date", "Description", "Amount"],
              separator: "pipe",
              automatic: false,
            };
    if (kind === "mapping") {
      w.source.format = "csv";
      w.columnHeaders = ["Date", "Description", "Amount"];
      w.columnRows = [
        ["2026-10-01", "Store", "624.00"],
        ["2026-10-03", "CARD PAYMENT", "-624.00"],
      ];
    }
    w.aiJobs = [
      {
        id: "synthetic-config-job",
        sourceId: w.source.id,
        request: {
          input: {
            sourceRevision: 1,
            provider: "openai",
            task: kind,
            scope: "text",
            text: "Synthetic configuration source",
          },
          model: "synthetic-model",
          attachmentBytes: 0,
        },
        status: "completed",
        createdAt: "2026-11-03T12:00:00Z",
        proposal: {
          fields: [],
          rows: [],
          warnings: ["Verify the proposal against the original."],
          configuration: { kind, definition },
        },
        failure: null,
        retryNotBefore: null,
      },
    ];
  }, kind);
  await page.getByRole("button", { name: "All sources" }).click();
  await page.getByRole("button", { name: /Synthetic bill.pdf/ }).click();
  await page
    .getByRole("button", { name: "AI document assistance", exact: true })
    .click();
  await parent
    .getByRole("button", { name: "Review configuration suggestion" })
    .click();
  return page.getByRole("dialog", {
    name:
      kind === "mapping"
        ? "Review suggested columns"
        : kind === "pdf_template"
          ? "Edit PDF template"
          : "Approve PDF table template",
  });
}
test("AI column suggestions keep confirmations empty and require parsed review before saving", async ({
  page,
}) => {
  const modal = await openAiConfiguration(page);
  await expect(
    modal.getByLabel(/I confirm rows without a status/),
  ).not.toBeChecked();
  await expect(modal.getByLabel("Year if missing from source")).toHaveValue("");
  await modal.getByLabel("Account for this source").selectOption("amex");
  await expect(modal.getByLabel("Amount convention")).toHaveValue(
    "outflow_positive",
  );
  await modal
    .getByRole("button", { name: "Preview suggested columns" })
    .click();
  await expect(
    modal.getByRole("cell", { name: "$624.00 in", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Apply reviewed columns" }),
  ).toBeDisabled();
  await modal.getByLabel(/I checked the account, dates, signs/).check();
  await modal.getByLabel(/I confirm rows without a status/).check();
  await expect(
    modal.getByRole("button", { name: "Apply reviewed columns" }),
  ).toHaveCount(0);
  await modal
    .getByRole("button", { name: "Preview suggested columns" })
    .click();
  await modal.getByLabel(/I checked the account, dates, signs/).check();
  await page.evaluate(() => {
    (window as any).mappingSaveFailure = true;
  });
  await modal.getByRole("button", { name: "Apply reviewed columns" }).click();
  await expect(modal.getByRole("alert")).toContainText("mapping save failure");
  await page.evaluate(() => {
    (window as any).mappingSaveFailure = false;
  });
  await modal.getByRole("button", { name: "Apply reviewed columns" }).click();
  await expect(modal).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "ai_mapping_apply"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
});
test("AI column edits discard late previews and closing a dirty suggestion preserves choices", async ({
  page,
}) => {
  const modal = await openAiConfiguration(page);
  await modal.getByLabel("Account for this source").selectOption("amex");
  await page.evaluate(() => {
    (window as any).mappingDelay = 400;
  });
  await modal
    .getByRole("button", { name: "Preview suggested columns" })
    .click();
  await modal.getByLabel("Amount convention").selectOption("inflow_positive");
  await page.waitForTimeout(500);
  await expect(modal.getByRole("heading", { name: "Parsed rows" })).toHaveCount(
    0,
  );
  page.once("dialog", (d) => d.dismiss());
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await expect(modal.getByLabel("Amount convention")).toHaveValue(
    "inflow_positive",
  );
  await page.setViewportSize({ width: 1100, height: 780 });
  await page.screenshot({
    path: ".qa/ai-mapping-light.png",
    animations: "disabled",
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: ".qa/ai-mapping-dark.png",
    animations: "disabled",
  });
});
test("AI PDF suggestions open existing editors and cannot skip local preview confirmation", async ({
  page,
}) => {
  const modal = await openAiConfiguration(page, "pdf_template");
  await expect(modal.getByLabel("Template name")).toHaveValue(
    "Synthetic utility",
  );
  await expect(
    modal.getByRole("button", { name: "Approve template version" }),
  ).toBeDisabled();
  await modal.getByRole("button", { name: "Preview sample fields" }).click();
  await modal
    .getByLabel(/I checked the source values, identity, currency and field/)
    .check();
  await modal.getByRole("button", { name: "Approve template version" }).click();
  await expect(modal).toHaveCount(0);
  const writes = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "approve_pdf_template"),
  );
  expect(writes).toHaveLength(1);
});
test("AI table suggestions start with automation disabled and use the existing approval flow", async ({
  page,
}) => {
  const modal = await openAiConfiguration(page, "pdf_table");
  await expect(
    modal.getByLabel(/Automatically stage matching future PDFs/),
  ).not.toBeChecked();
  await modal.getByRole("button", { name: "Preview table rows" }).click();
  await modal.getByLabel(/I compared every extracted row/).check();
  await modal.getByRole("button", { name: "Approve table template" }).click();
  await expect(modal).toHaveCount(0);
  const writes = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_pdf_table"),
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].args.input.request.definition.automatic).toBe(false);
});
