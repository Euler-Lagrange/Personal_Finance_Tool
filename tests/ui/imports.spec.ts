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
async function setup(page: Page) {
  await page.addInitScript((snapshot) => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.sources = [];
    w.rules = [];
    w.refundPurchases = [
      {
        id: "purchase-1",
        date: "2026-10-01",
        description: "Original grocery purchase",
        amountCents: 10000,
        remainingCents: 10000,
        jacobCents: 7000,
        chelseaCents: 3000,
        payer: "jacob",
        categoryId: "groceries",
        accountId: "amex",
      },
    ];
    w.callbacks = {};
    w.listeners = {};
    w.delayImport = 0;
    w.failCommit = false;
    let counter = 0;
    w.nativeDrop = (paths: string[]) => {
      for (const handler of Object.values(
        w.listeners["tauri://drag-drop"] ?? {},
      ) as number[])
        w.callbacks[handler]({
          event: "tauri://drag-drop",
          id: handler,
          payload: { paths, position: { x: 100, y: 100 } },
        });
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (event: string, id: number) => {
        delete w.listeners[event]?.[id];
      },
    };
    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: (cb: unknown) => {
        const id = ++counter;
        w.callbacks[id] = cb;
        return id;
      },
      invoke: async (cmd: string, args: any) => {
        w.calls.push({ cmd, args });
        if (cmd === "plugin:event|listen") {
          w.listeners[args.event] ??= {};
          w.listeners[args.event][args.handler] = args.handler;
          return args.handler;
        }
        if (cmd === "plugin:event|unlisten") return;
        if (cmd === "snapshot")
          return {
            ...snapshot,
            ...w.extraSnapshot,
            workspace: args.workspace,
            month: args.month,
            incompleteImports: w.sources.filter(
              (s: any) =>
                s.workspace === args.workspace && s.source.pendingCount,
            ).length,
          };
        if (cmd === "preview_split") return [7000, 3000];
        if (cmd === "paypal_receipts")
          return [
            {
              id: "held-receipt",
              revision: 2,
              date: "2026-11-01",
              description: "Chelsea repayment",
              amountCents: 10000,
              availableCents: 10000,
            },
          ];
        if (cmd === "refund_purchases")
          return structuredClone(w.refundPurchases);
        if (cmd === "movement_matches")
          return structuredClone(w.movementMatches ?? []);
        if (cmd === "movement_detail") return structuredClone(w.movementDetail);
        if (cmd === "reconcile_movement") {
          if (w.failMovement) {
            w.failMovement = false;
            throw "Response interrupted. Retry the same reconciliation.";
          }
          return args.input.eventId;
        }
        if (cmd === "undo_movement") {
          if (w.failUndoMovement)
            throw "Later imports reference this reconciled movement. Undo those import links first.";
          return;
        }
        if (cmd === "get_activity_source")
          return structuredClone(
            w.sources.find((s: any) =>
              s.rows.some((r: any) => r.pendingEntry?.id === args.eventId),
            ),
          );
        if (cmd === "save_entry") {
          if (w.failSave)
            throw "Refund exceeds the remaining refundable amount.";
          for (const source of w.sources)
            for (const row of source.rows)
              if (row.pendingEntry?.id === args.input.id) {
                row.pendingEntry = null;
                source.source.classificationCount = 0;
              }
          return;
        }
        if (cmd === "suggest_categories") {
          const result = args.contexts.map((c: any) => ({
            rowId: c.rowId,
            categoryId:
              c.splitMode === "shared"
                ? "dining"
                : c.splitMode === "personal"
                  ? "personal"
                  : null,
            categoryAsk: !["shared", "personal"].includes(c.splitMode),
            explanations: [
              "Category: synthetic conditional merchant rule (v1)",
            ],
          }));
          if (w.suggestionDelay)
            await new Promise((resolve) =>
              setTimeout(resolve, w.suggestionDelay),
            );
          return result;
        }
        if (cmd === "purchase_review")
          return structuredClone(
            w.purchaseReview ?? { items: [], previous: [], undoId: null },
          );
        if (cmd === "preview_purchases") {
          if (w.failPurchasePreview)
            throw "Purchase changed. Reload merchant review.";
          // This UI fixture has $50 purchases, currently personal or awaiting sharing.
          const full = args.request.rows.length * 5000;
          const mode = args.request.changes.splitMode;
          const after =
            mode === "shared" ? full * 0.7 : mode === "equal" ? full / 2 : full;
          return {
            count: args.request.rows.length,
            beforeAllowanceCents: full,
            afterAllowanceCents: after,
            afterProvisionalCents: mode ? 0 : 5000,
            householdChangeCents: mode ? full - after : 0,
          };
        }
        if (cmd === "review_purchases") {
          if (w.failPurchaseReview) {
            w.failPurchaseReview = false;
            throw "Response interrupted. Retry the same review.";
          }
          w.purchaseReview.undoId = args.request.id;
          return;
        }
        if (cmd === "undo_purchase_review") {
          if (w.failPurchaseUndo)
            throw "Undo is unavailable because a purchase changed or its import links changed.";
          w.purchaseReview.undoId = null;
          return;
        }
        if (cmd === "list_rules") return structuredClone(w.rules);
        if (cmd === "preview_rule")
          return {
            count: 2,
            examples: [
              "Card.csv · Neighborhood Market",
              "Card.csv · Groceries",
            ],
          };
        if (cmd === "save_rule") {
          const r = { ...args.rule, revision: args.rule.revision + 1 };
          w.rules = [...w.rules.filter((x: any) => x.id !== r.id), r];
          return;
        }
        if (cmd === "list_imports")
          return w.sources
            .filter((s: any) => s.workspace === args.workspace)
            .map((s: any) => s.source);
        if (
          cmd === "ingest_import" ||
          cmd === "ingest_import_path" ||
          cmd === "paste_import"
        ) {
          if (w.delayImport)
            await new Promise((resolve) => setTimeout(resolve, w.delayImport));
          const name =
            args.name ??
            args.path?.split(/[\\/]/).pop() ??
            "Clipboard screenshot.png";
          if (name.includes("Broken")) throw "Unreadable file";
          const existing = w.sources.find(
            (s: any) =>
              s.source.name === name && s.workspace === args.workspace,
          );
          if (existing) return existing.source.id;
          const id = crypto.randomUUID();
          const image = name.endsWith("png");
          const detail = {
            workspace: args.workspace,
            source: {
              id,
              revision: 1,
              name,
              format: image ? "image" : "csv",
              accountId: null,
              state: "unconfigured",
              error: "",
              rowCount: 2,
              pendingCount: 2,
              importedCount: 0,
              linkedCount: 0,
              excludedCount: 0,
              createdAt: "2026-11-03",
            },
            dataset: {
              headers: ["Date", "Description", "Amount"],
              rows: [
                ["2026-11-02", "Neighborhood Market", "42.18"],
                ["2026-11-02", "Groceries", "17.25"],
              ],
              sheetNames: [],
              sheet: "",
              image,
              notes: image ? ["Screenshot coverage is partial."] : [],
            },
            mapping: {
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
            rows: [4218, 1725].map((amount, i) => ({
              id: crypto.randomUUID(),
              ordinal: i,
              raw: [
                "2026-11-02",
                i ? "Groceries" : "Neighborhood Market",
                String(amount / 100),
              ],
              candidate: {
                date: "2026-11-02",
                description: i ? "Groceries" : "Neighborhood Market",
                amountCents: amount,
                direction: "out",
                status: "unknown",
                sourceType: "",
                warnings: image ? ["Verify OCR against the screenshot."] : [],
              },
              bulkExpenseReason: "",
              disposition: "pending",
              eventId: null,
              matches: [],
            })),
            previewUrl: image
              ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1cAAAAASUVORK5CYII="
              : null,
            undoId: null,
          };
          w.sources.unshift(detail);
          return id;
        }
        const d = w.sources.find((s: any) => s.source.id === args.id);
        if (cmd === "get_import") return structuredClone(d);
        if (cmd === "import_profile") return null;
        if (cmd === "configure_import") {
          d.mapping = args.mapping;
          d.source.accountId = args.account;
          d.source.state = "review";
          d.source.revision++;
          for (const row of d.rows)
            row.candidate.status = args.mapping.postedConfirmed
              ? "posted"
              : "unknown";
          return;
        }
        if (cmd === "new_import_observation") {
          const prior = w.sources.find((s: any) => s.source.id === args.newId);
          if (prior) return args.newId;
          const next = structuredClone(d);
          next.source = {
            ...next.source,
            id: args.newId,
            revision: 1,
            accountId: null,
            state: "unconfigured",
            pendingCount: next.rows.length,
            importedCount: 0,
            linkedCount: 0,
            excludedCount: 0,
          };
          next.mapping.year = null;
          next.mapping.postedConfirmed = false;
          next.coverage = null;
          next.undoId = null;
          next.overlap = { items: [], notices: [] };
          next.observation = {
            parentId: d.source.id,
            parentName: d.source.name,
            suggestedAccountId: d.source.accountId,
          };
          next.rows = next.rows.map((r: any) => ({
            ...r,
            id: crypto.randomUUID(),
            bulkExpenseReason: "",
            disposition: "pending",
            eventId: null,
            matches: [],
            candidate: { ...r.candidate, status: "unknown" },
          }));
          w.sources.unshift(next);
          if (w.failObservationResponse) {
            w.failObservationResponse = false;
            throw "Observation response interrupted. Retry the same request.";
          }
          return args.newId;
        }
        if (cmd === "finalize_import_coverage") {
          if (w.coverageReceipt?.id === args.commitId)
            return w.coverageReceipt.receipt;
          if (args.pattern)
            d.downloadProfile = {
              profile: args.input.profile,
              dateBasis: args.input.dateBasis,
              completeness: args.input.completeness,
              pattern: args.pattern,
            };
          d.coverage = {
            ...args.input,
            accepted: false,
            newestActivityDate: "2026-11-02",
          };
          d.source.revision++;
          const receipt = {
            added: 0,
            linked: 0,
            excluded: 0,
            alreadyProcessed: false,
          };
          w.coverageReceipt = { id: args.commitId, receipt };
          if (w.failCoverageResponse) {
            w.failCoverageResponse = false;
            throw "Coverage response interrupted. Retry the same request.";
          }
          return receipt;
        }
        if (cmd === "reconcile_import") {
          if (w.reconciled?.id === args.commitId) return w.reconciled.receipt;
          let linked = 0,
            excluded = 0;
          for (const item of d.overlap.items) {
            if (!["link", "exclude"].includes(item.action)) continue;
            d.rows.find((r: any) => r.id === item.rowId).disposition =
              item.action === "link" ? "linked" : "excluded";
            if (item.action === "link") linked++;
            else excluded++;
          }
          d.overlap.items = d.overlap.items.filter(
            (i: any) => !["link", "exclude"].includes(i.action),
          );
          d.source.pendingCount -= linked + excluded;
          d.source.linkedCount += linked;
          d.source.excludedCount += excluded;
          d.source.revision++;
          d.undoId = args.commitId;
          const receipt = {
            added: 0,
            linked,
            excluded,
            alreadyProcessed: false,
          };
          w.reconciled = { id: args.commitId, receipt };
          if (w.failReconcileResponse) {
            w.failReconcileResponse = false;
            throw "Response interrupted; retry the same operation.";
          }
          return receipt;
        }
        if (cmd === "process_import") {
          if (w.failProcess) {
            w.failProcess = false;
            throw "Interrupted response. Retry this operation.";
          }
          return { added: 0, linked: 0, excluded: 0, alreadyProcessed: false };
        }
        if (cmd === "commit_import") {
          if (w.failCommit)
            throw typeof w.failCommit === "string"
              ? w.failCommit
              : "Possible duplicate found. Review before retrying.";
          let added = 0,
            linked = 0,
            excluded = 0;
          for (const decision of args.decisions) {
            const row = d.rows.find((r: any) => r.id === decision.rowId);
            row.disposition = ["add", "apply_rule", "bulk_expense"].includes(
              decision.action,
            )
              ? "imported"
              : decision.action === "link"
                ? "linked"
                : "excluded";
            if (["add", "apply_rule", "bulk_expense"].includes(decision.action))
              added++;
            else if (decision.action === "link") linked++;
            else excluded++;
          }
          d.source.pendingCount -= args.decisions.length;
          d.source.importedCount += added;
          d.source.linkedCount += linked;
          d.source.excludedCount += excluded;
          d.source.revision++;
          d.undoId = args.commitId;
          return { added, linked, excluded, alreadyProcessed: false };
        }
        if (cmd === "dismiss_import") {
          d.source.state = args.dismissed ? "dismissed" : "review";
          d.source.revision++;
          return;
        }
        if (cmd === "set_native_theme") return;
      },
    };
  }, snapshot);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Imports", exact: true })
    .click();
}
async function browse(page: Page, name = "Card.csv") {
  await page.getByLabel("Choose import files").setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Description,Amount\n2026-11-02,Market,42.18"),
  });
  await expect(
    page.getByRole("button", { name: new RegExp(name.replace(".", "\\.")) }),
  ).toBeVisible();
}
async function map(page: Page, name = "Card.csv") {
  await page
    .getByRole("button", { name: new RegExp(name.replace(".", "\\.")) })
    .click();
  await page.getByLabel("Account for this source").selectOption("amex");
  await page.getByLabel("Amount convention").selectOption("outflow_positive");
  await page.getByLabel("I confirm rows without a status").check();
  await page.getByRole("button", { name: "Apply mapping" }).click();
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toHaveCount(2);
}
test("browse, review, bulk commit and source evidence are distinct steps", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "commit_import")
          .length,
    ),
  ).toBe(0);
  await map(page);
  await page.getByLabel("Select visible held rows").check();
  await page.getByRole("button", { name: "Review 2 rows" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("groceries");
  await dialog.getByLabel("Purchase sharing").selectOption("shared");
  await dialog.getByLabel("I checked every selected").check();
  await dialog.getByRole("button", { name: "Import expenses" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("No held rows in this source.")).toBeVisible();
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "commit_import"),
  );
  expect(call.args.decisions).toHaveLength(2);
  expect(call.args.decisions[0].input.splitMode).toBe("shared");
  expect(call.args.decisions[0].input.amount).toBe("42.18");
  await page.screenshot({ path: ".qa/import-reviewed.png", fullPage: true });
});
test("native drop IPC and multi-file failure preserve unsaved form", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Description", { exact: true })
    .fill("Unsaved grocery note");
  await page.evaluate(() => {
    (window as any).nativeDrop([
      "C:\\synthetic\\Broken.csv",
      "C:\\synthetic\\Good.csv",
    ]);
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).sources.length))
    .toBe(1);
  await expect(
    page.getByRole("dialog").getByLabel("Description", { exact: true }),
  ).toHaveValue("Unsaved grocery note");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Imports", exact: true })
    .click();
  await expect(
    page.getByText("Unreadable file", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Good.csv/ })).toBeVisible();
});
test("image paste is explicit and text fields keep ordinary paste", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["image"], "Pasted.png", { type: "image/png" }));
    document.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByRole("button", { name: /Pasted.png/ })).toBeVisible();
  await page
    .getByRole("button", { name: "Paste screenshot", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Clipboard screenshot.png/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page.getByRole("button", { name: "Add expense", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Description", { exact: true })
    .focus();
  const prevented = await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "merchant");
    const event = new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "ingest_import")
          .length,
    ),
  ).toBe(1);
});
test("cancellation stops waiting files and workspace switch never redirects an in-flight source", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).delayImport = 600;
  });
  await page.getByLabel("Choose import files").setInputFiles(
    ["One.csv", "Two.csv", "Three.csv"].map((name) => ({
      name,
      mimeType: "text/csv",
      buffer: Buffer.from("fixture"),
    })),
  );
  await page.getByRole("button", { name: "Cancel waiting files" }).click();
  await expect(page.getByRole("button", { name: /One.csv/ })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "ingest_import")
          .length,
    ),
  ).toBe(1);
  await page.getByLabel("Choose import files").setInputFiles({
    name: "Old workspace.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("fixture"),
  });
  await page.getByRole("button", { name: "Start fresh" }).click();
  await expect(
    page.getByRole("heading", { name: "Monthly overview" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).sources.length))
    .toBe(2);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Imports", exact: true })
    .click();
  await expect(page.getByText("Your imports will appear here")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).sources.every((s: any) => s.workspace === "demo"),
    ),
  ).toBe(true);
});
test("duplicate rejection preserves row edits and retries the same operation ID", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("expense");
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("groceries");
  await dialog.getByLabel("I checked this row").check();
  await page.evaluate(() => {
    (window as any).failCommit = true;
  });
  await dialog
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Possible duplicate");
  await expect(dialog.getByLabel("Amount ($)", { exact: true })).toHaveValue(
    "42.18",
  );
  await dialog
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const ids = await page.evaluate(() =>
    (window as any).calls
      .filter((c: any) => c.cmd === "commit_import")
      .map((c: any) => c.args.commitId),
  );
  expect(ids.length).toBe(2);
  expect(ids[0]).toBe(ids[1]);
  await page.evaluate(() => {
    (window as any).failCommit = false;
  });
  await dialog
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
});
test("source mapping and review stay readable in light, Dracula and Marshmallow at desktop and compact sizes", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  for (const [theme, name] of [
    ["light", "Light"],
    ["dracula", "Dracula"],
    ["marshmallow", "Marshmallow"],
  ]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name, exact: true }).check();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Imports", exact: true })
      .click();
    await page.getByRole("button", { name: /Card.csv/ }).click();
    for (const width of [1440, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page
        .locator(".mapping summary")
        .filter({ hasText: "Account & column mapping" })
        .click();
      await expect(
        page.getByLabel("Transaction amount (not balance)"),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.qa/import-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await page
        .locator(".mapping summary")
        .filter({ hasText: "Account & column mapping" })
        .click();
    }
  }
});

test("remember merchant requires preview and preserves manual row choices", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const row = page.getByRole("dialog", { name: "Review row 1", exact: true });
  await row
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("expense");
  await row
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("groceries");
  await row.getByLabel("Expense allocation").selectOption("shared");
  await row
    .getByLabel("Description", { exact: true })
    .fill("My manual description");
  await row.getByRole("button", { name: "Remember merchant…" }).click();
  const rule = page.getByRole("dialog", {
    name: "Remember merchant",
    exact: true,
  });
  await expect(rule.getByLabel("Merchant phrase")).toHaveValue(
    "Neighborhood Market",
  );
  await expect(rule.getByLabel("Sharing preset")).toHaveValue("shared");
  await expect(
    rule.getByRole("button", { name: "Save rule", exact: true }),
  ).toBeDisabled();
  await rule.getByRole("button", { name: "Preview matches" }).click();
  await expect(
    rule.getByText("2 held row(s) match merchant conditions"),
  ).toBeVisible();
  await rule.getByLabel("Sharing action").selectOption("ask");
  await expect(
    rule.getByRole("button", { name: "Save rule", exact: true }),
  ).toBeDisabled();
  await rule.getByRole("button", { name: "Preview matches" }).click();
  await rule.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(rule).toHaveCount(0);
  await expect(row.getByLabel("Description", { exact: true })).toHaveValue(
    "My manual description",
  );
  await expect(row.getByLabel("Expense allocation")).toHaveValue("shared");
  const saves = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_rule"),
  );
  expect(saves[0].args.rule.ownershipAction).toBe("ask");
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "commit_import")
          .length,
    ),
  ).toBe(0);
  await row.getByLabel("I checked this row").check();
  await row
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "commit_import"),
  );
  expect(call.args.decisions[0].input.description).toBe(
    "My manual description",
  );
  expect(call.args.decisions[0].input.splitMode).toBe("shared");
});

test("rule batch requires confirmation and keeps stale-rule failures visible", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page.getByRole("button", { name: "All sources", exact: true }).click();
  await page.evaluate(() => {
    const w = window as any;
    w.sources[0].rows[0].suggestion = {
      categoryId: "groceries",
      splitMode: "shared",
      splitValue: "",
      categoryAsk: false,
      ownershipAsk: false,
      ready: true,
      signature: "reviewed-v1",
      explanations: ["Category: Market (v1)"],
    };
    w.failCommit =
      "Rule suggestions changed. Reload the source before applying rules.";
  });
  await page.getByRole("button", { name: /Card.csv/ }).click();
  await page.getByRole("button", { name: "Review 1 rule matches" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Groceries · Jacob 70% / Chelsea 30%"),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Import with rules" }),
  ).toBeDisabled();
  await dialog.getByLabel("I confirm these purchases").check();
  await dialog.getByRole("button", { name: "Import with rules" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Rule suggestions changed",
  );
  await page.evaluate(() => {
    (window as any).failCommit = false;
  });
  await dialog.getByRole("button", { name: "Import with rules" }).click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "commit_import"),
  );
  expect(calls[0].args.decisions[0]).toMatchObject({
    action: "apply_rule",
    ruleSignature: "reviewed-v1",
    input: null,
  });
  expect(calls[0].args.commitId).toBe(calls[1].args.commitId);
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toHaveCount(1);
});

test("manual and imported refunds retain original links and the actual receiving account", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record refund", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Original purchase", exact: true })
    .selectOption("purchase-1");
  await expect(dialog.getByText(/Remaining refundable:/)).toContainText(
    "$100.00",
  );
  await dialog.getByLabel("Refund received into").selectOption("checking");
  await dialog.getByLabel("Refund amount ($)", { exact: true }).fill("125");
  await page.evaluate(() => {
    (window as any).failSave = true;
  });
  await dialog.getByRole("button", { name: "Save refund" }).click();
  await expect(dialog.getByRole("alert")).toContainText("exceeds");
  await expect(dialog.getByLabel("Refund received into")).toHaveValue(
    "checking",
  );
  await dialog.getByLabel("Refund amount ($)", { exact: true }).fill("25");
  await page.evaluate(() => {
    (window as any).failSave = false;
  });
  await dialog.getByRole("button", { name: "Save refund" }).click();
  await expect(dialog).toHaveCount(0);
  const save = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_entry").at(-1),
  );
  expect(save.args.input).toMatchObject({
    kind: "refund",
    originalEventId: "purchase-1",
    accountId: "checking",
    amount: "25",
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Imports", exact: true })
    .click();
  await browse(page);
  await map(page);
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("refund");
  await dialog
    .getByRole("combobox", { name: "Original purchase", exact: true })
    .selectOption("purchase-1");
  await expect(dialog.getByLabel("Refund received into")).toHaveCount(0);
  await dialog.getByLabel("I checked this row").check();
  await dialog
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const commit = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "commit_import"),
  );
  expect(commit.args.decisions[0].input).toMatchObject({
    kind: "refund",
    originalEventId: "purchase-1",
    accountId: "amex",
  });
});

test("rule management and refund forms fit light and dark compact layouts", async ({
  page,
}) => {
  await setup(page);
  for (const [theme, name] of [
    ["light", "Light"],
    ["dracula", "Dracula"],
  ]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name, exact: true }).check();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Merchant rules", exact: true })
      .click();
    await page.getByRole("button", { name: "New rule", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Rule name").fill("Grocery shopping");
    await dialog.getByLabel("Merchant phrase").fill("Market");
    await dialog.getByLabel("Category action").selectOption("set");
    await dialog
      .getByRole("combobox", { name: "Category", exact: true })
      .selectOption("groceries");
    await dialog.getByLabel("Sharing preset").selectOption("shared");
    await dialog.getByRole("button", { name: "Preview matches" }).click();
    await page.setViewportSize({ width: 1000, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.qa/rules-${theme}.png`,
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Save rule", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Grocery shopping/ })
      .last()
      .click();
    await dialog.getByLabel("Rule enabled").uncheck();
    await dialog.getByRole("button", { name: "Preview matches" }).click();
    await dialog
      .getByRole("button", { name: "Save rule", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /Grocery shopping/ }).last(),
    ).toContainText("Disabled");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Overview", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Record refund", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("combobox", { name: "Original purchase", exact: true })
      .selectOption("purchase-1");
    await dialog.getByLabel("Refund amount ($)", { exact: true }).fill("25.00");
    await page.screenshot({
      path: `.qa/refund-${theme}.png`,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("explicit import treatments offer debt allocation and card reward without guessing", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const d = page.getByRole("dialog");
  const treatment = d.getByRole("combobox", { name: "Treatment", exact: true });
  await expect(treatment).toHaveValue("hold");
  await treatment.selectOption("debt_payment");
  await d
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("groceries");
  await d
    .getByRole("combobox", { name: "Expense allocation", exact: true })
    .selectOption("shared");
  await expect(d.getByText(/reported separately from purchases/)).toBeVisible();
  await treatment.selectOption("reward");
  await expect(
    d.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveCount(0);
  await expect(
    d.getByRole("button", { name: "Remember merchant" }),
  ).toHaveCount(0);
  await expect(d.getByText(/A card credit reduces card debt/)).toBeVisible();
  await treatment.selectOption("debt_payment");
  await d
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("groceries");
  await d
    .getByRole("combobox", { name: "Expense allocation", exact: true })
    .selectOption("shared");
  await d.getByLabel("I checked this row").check();
  await d.getByRole("button", { name: "Add transaction", exact: true }).click();
  const saved = await page.evaluate(
    () =>
      (window as any).calls.find((c: any) => c.cmd === "commit_import").args
        .decisions[0].input,
  );
  expect(saved).toMatchObject({
    kind: "debt_payment",
    accountId: "amex",
    categoryId: "groceries",
    lines: [],
  });
});

test("checking cashout import records receipt allocations without making another settlement", async ({
  page,
}) => {
  await setup(page);
  await browse(page, "Checking.csv");
  await page.getByRole("button", { name: /Checking.csv/ }).click();
  await page.getByLabel("Account for this source").selectOption("checking");
  await page.getByLabel("Amount convention").selectOption("inflow_positive");
  await page.getByLabel("I confirm rows without a status").check();
  await page.getByRole("button", { name: "Apply mapping" }).click();
  await page.evaluate(() => {
    (window as any).sources[0].rows[0].candidate.direction = "in";
  });
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("paypal_cashout");
  await d.getByRole("checkbox", { name: /^Chelsea repayment/ }).check();
  await d
    .getByLabel("Amount from Chelsea repayment ($)", { exact: true })
    .fill("42.18");
  await d.getByLabel("I checked this row").check();
  await d.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(d).toHaveCount(0);
  const saved = await page.evaluate(
    () =>
      (window as any).calls.find((c: any) => c.cmd === "commit_import").args
        .decisions[0].input,
  );
  expect(saved).toMatchObject({
    kind: "paypal_cashout",
    accountId: "checking",
    amount: "42.18",
    payer: "jacob",
    paypal: {
      receipts: [{ id: "held-receipt", revision: 2, amount: "42.18" }],
      fee: "0",
      other: "0",
    },
  });
});

async function reopenSource(page: Page, name = "Card.csv") {
  await page.getByRole("button", { name: "All sources", exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(name.replace(".", "\\.")) })
    .click();
}
async function coverageForm(page: Page) {
  await page
    .getByText("Download range & completeness", { exact: true })
    .click();
  await page.getByLabel("Download start (inclusive)").fill("2026-10-01");
  await page.getByLabel("Download end (inclusive)").fill("2026-11-02");
  await page
    .getByRole("combobox", { name: "Coverage type", exact: true })
    .selectOption("complete");
  await page.getByLabel("Export profile name").fill("Amex activity CSV");
  await page.getByLabel("Downloaded / observed at").fill("2026-11-02T23:00");
}
test("coverage keeps observation and inclusive filters separate from activity extrema", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page
    .getByText("Download range & completeness", { exact: true })
    .click();
  await expect(page.getByLabel("Download start (inclusive)")).toHaveValue("");
  await expect(page.getByLabel("Download end (inclusive)")).toHaveValue("");
  await expect(page.getByLabel("Downloaded / observed at")).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Coverage type", exact: true }),
  ).toHaveValue("partial");
  await page
    .getByText("Download range & completeness", { exact: true })
    .click();
  await coverageForm(page);
  await expect(
    page.getByRole("button", { name: "Confirm download coverage" }),
  ).toBeDisabled();
  await page.getByLabel("I checked the actual download range").check();
  await page.getByRole("button", { name: "Confirm download coverage" }).click();
  await expect(
    page.getByText("2026-10-01 to 2026-11-02", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /unresolved or unreliable rows still prevent accepted coverage/,
    ),
  ).toBeVisible();
  const calls = await page.evaluate(() => (window as any).calls);
  const c = calls.find((c: any) => c.cmd === "finalize_import_coverage");
  expect(c.args.input).toMatchObject({
    startDate: "2026-10-01",
    endDate: "2026-11-02",
    inclusive: true,
    dateBasis: "transaction",
    profile: "Amex activity CSV",
    completeness: "complete",
  });
  expect(
    calls.filter((c: any) => ["commit_import", "save_entry"].includes(c.cmd)),
  ).toHaveLength(0);
});
test("reconciliation retries one operation and leaves uncertain rows for review", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate(() => {
    const w = window as any,
      d = w.sources[0];
    w.failReconcileResponse = true;
    d.overlap = {
      items: [
        {
          rowId: d.rows[0].id,
          action: "link",
          reason: "Confirmed source ID already represented.",
        },
        {
          rowId: d.rows[1].id,
          action: "review",
          reason: "Extra occurrence in a stable interior date.",
        },
      ],
      notices: ["A smaller export never deletes existing activity."],
    };
  });
  await reopenSource(page);
  await expect(
    page.getByText("Extra occurrence in a stable interior date."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reconcile 1 unchanged rows" })
    .click();
  await expect(page.getByText(/Response interrupted/)).toBeVisible();
  await page
    .getByRole("button", { name: "Reconcile 1 unchanged rows" })
    .click();
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toHaveCount(1);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "reconcile_import"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.commitId).toBe(calls[1].args.commitId);
  expect(
    await page.evaluate(() => (window as any).sources[0].source.linkedCount),
  ).toBe(1);
});
test("unsaved column edits block coverage and identity actions until mapping is applied", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate(() => {
    const d = (window as any).sources[0];
    d.overlap = {
      items: [
        { rowId: d.rows[0].id, action: "link", reason: "Already represented" },
      ],
      notices: [],
    };
  });
  await reopenSource(page);
  await page
    .locator(".mapping summary")
    .filter({ hasText: "Account & column mapping" })
    .click();
  await page.getByLabel("Year if missing from source").fill("2026");
  await expect(
    page.getByRole("button", { name: "Reconcile 1 unchanged rows" }),
  ).toBeDisabled();
  await page
    .getByText("Download range & completeness", { exact: true })
    .click();
  await expect(page.getByLabel("Download start (inclusive)")).toBeDisabled();
  await expect(page.getByLabel("Year if missing from source")).toHaveValue(
    "2026",
  );
  await page.getByRole("button", { name: "Apply mapping" }).click();
  await expect(
    page.getByRole("button", { name: "Reconcile 1 unchanged rows" }),
  ).toBeEnabled();
});
test("stable IDs require explicit confirmation and a new column resets that confirmation", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate(() => {
    (window as any).sources[0].dataset.headers.push(
      "Transaction ID",
      "Posted Date",
      "Currency",
    );
  });
  await reopenSource(page);
  await page
    .locator(".mapping summary")
    .filter({ hasText: "Account & column mapping" })
    .click();
  const confirmation = page.getByLabel(
    "This ID uniquely identifies a transaction",
  );
  await expect(confirmation).toBeDisabled();
  await page.getByLabel("Stable source ID column (optional)").selectOption("3");
  await confirmation.check();
  await page.getByLabel("Stable source ID column (optional)").selectOption("");
  await expect(confirmation).not.toBeChecked();
  await page.getByLabel("Stable source ID column (optional)").selectOption("3");
  await confirmation.check();
  await page.getByLabel("Posted date column (optional)").selectOption("4");
  await page
    .getByLabel("Currency column (optional; otherwise USD)")
    .selectOption("5");
  await page.getByRole("button", { name: "Apply mapping" }).click();
  const c = await page.evaluate(() =>
    (window as any).calls
      .filter((c: any) => c.cmd === "configure_import")
      .at(-1),
  );
  expect(c.args.mapping).toMatchObject({
    stableIdColumn: 3,
    stableIdsConfirmed: true,
    postedDateColumn: 4,
    currencyColumn: 5,
  });
});
test("screenshots cannot claim complete coverage and controls fit compact light and dark views", async ({
  page,
}) => {
  await setup(page);
  await browse(page, "Screen.png");
  await map(page, "Screen.png");
  await page
    .getByText("Download range & completeness", { exact: true })
    .click();
  await expect(
    page
      .getByRole("combobox", { name: "Coverage type", exact: true })
      .locator('option[value="complete"]'),
  ).toHaveAttribute("disabled", "");
  await page.getByRole("button", { name: "All sources", exact: true }).click();
  await browse(page);
  await map(page);
  for (const [theme, name] of [
    ["light", "Light"],
    ["dracula", "Dracula"],
  ]) {
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name, exact: true }).check();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Imports", exact: true })
      .click();
    await page.getByRole("button", { name: /Card.csv/ }).click();
    await coverageForm(page);
    await page.setViewportSize({ width: 1000, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("region", { name: "Import coverage and identity" })
      .screenshot({
        path: `.qa/coverage-${theme}.png`,
        animations: "disabled",
      });
  }
});

test("source currency and identity flags remain explicit in individual review", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate(() => {
    const d = (window as any).sources[0];
    d.rows[0].candidate.currency = "EUR";
    d.rows[0].candidate.warnings = [
      "Only verified USD source rows can post. Correct the currency mapping first.",
    ];
    d.overlap = {
      items: [
        {
          rowId: d.rows[0].id,
          action: "review",
          reason: "Source currency needs review.",
        },
      ],
      notices: [],
    };
  });
  await reopenSource(page);
  await expect(page.getByRole("cell", { name: /^EUR 42\.18/ })).toBeVisible();
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Source currency needs review.")).toBeVisible();
  await expect(dialog.getByText(/Only verified USD source rows/)).toBeVisible();
});

test("new download observations require confirmation and retry without replacing prior coverage", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate(() => {
    const w = window as any,
      d = w.sources[0];
    w.failObservationResponse = true;
    d.coverage = {
      startDate: "2026-10-01",
      endDate: "2026-11-01",
      dateBasis: "transaction",
      completeness: "complete",
      profile: "Amex activity CSV",
      observedAt: "2026-11-01T23:00:00Z",
      inclusive: true,
      accepted: true,
      newestActivityDate: "2026-11-01",
    };
  });
  await reopenSource(page);
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "New download observation", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter(
          (c: any) => c.cmd === "new_import_observation",
        ).length,
    ),
  ).toBe(0);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "New download observation", exact: true })
    .click();
  await expect(
    page.getByText(/Observation response interrupted/),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "New download observation", exact: true })
    .click();
  await expect(page.getByText(/New observation of Card.csv/)).toBeVisible();
  await expect(page.getByLabel("Account for this source")).toHaveValue("amex");
  await expect(
    page.getByLabel("I confirm rows without a status"),
  ).not.toBeChecked();
  await expect(
    page.getByRole("region", { name: "Import coverage and identity" }),
  ).toHaveCount(0);
  const state = await page.evaluate(() => {
    const w = window as any;
    return {
      calls: w.calls.filter((c: any) => c.cmd === "new_import_observation"),
      sources: w.sources,
    };
  });
  expect(state.calls).toHaveLength(2);
  expect(state.calls[0].args.newId).toBe(state.calls[1].args.newId);
  expect(state.sources).toHaveLength(2);
  expect(state.sources[1].coverage.endDate).toBe("2026-11-01");
  expect(state.sources[0].coverage).toBeNull();
});
test("saved trailing download pattern suggests dates but never silently confirms a range", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate(() => {
    const d = (window as any).sources[0];
    d.downloadProfile = {
      profile: "Amex 90 days",
      dateBasis: "transaction",
      completeness: "complete",
      pattern: { kind: "trailing_days", days: 90 },
    };
  });
  await reopenSource(page);
  await page
    .getByText("Download range & completeness", { exact: true })
    .click();
  await expect(page.getByLabel("Download start (inclusive)")).toHaveValue("");
  await expect(page.getByLabel("Export profile name")).toHaveValue(
    "Amex 90 days",
  );
  await page.getByLabel("Downloaded / observed at").fill("2026-11-02T18:00");
  await expect(page.getByLabel("Download start (inclusive)")).toHaveValue(
    "2026-08-05",
  );
  await expect(page.getByLabel("Download end (inclusive)")).toHaveValue(
    "2026-11-02",
  );
  await expect(
    page.getByRole("button", { name: "Confirm download coverage" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter(
          (c: any) => c.cmd === "finalize_import_coverage",
        ).length,
    ),
  ).toBe(0);
  await page.getByLabel("I checked the actual download range").check();
  await page.getByRole("button", { name: "Confirm download coverage" }).click();
  const call = await page.evaluate(() =>
    (window as any).calls.find(
      (c: any) => c.cmd === "finalize_import_coverage",
    ),
  );
  expect(call.args.pattern).toEqual({ kind: "trailing_days", days: 90 });
  expect(call.args.input.startDate).toBe("2026-08-05");
});
test("calendar patterns handle February and manual edits clear the pattern and confirmation", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page
    .getByText("Download range & completeness", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Download pattern", exact: true })
    .selectOption("previous_month");
  await page.getByLabel("Downloaded / observed at").fill("2024-03-05T18:00");
  await expect(page.getByLabel("Download start (inclusive)")).toHaveValue(
    "2024-02-01",
  );
  await expect(page.getByLabel("Download end (inclusive)")).toHaveValue(
    "2024-02-29",
  );
  await page.getByLabel("I checked the actual download range").check();
  await page.getByLabel("Download start (inclusive)").fill("2024-02-02");
  await expect(
    page.getByRole("combobox", { name: "Download pattern", exact: true }),
  ).toHaveValue("manual");
  await expect(
    page.getByLabel("I checked the actual download range"),
  ).not.toBeChecked();
  await page
    .getByRole("combobox", { name: "Download pattern", exact: true })
    .selectOption("month_to_date");
  await expect(page.getByLabel("Download start (inclusive)")).toHaveValue(
    "2024-03-01",
  );
  await expect(page.getByLabel("Download end (inclusive)")).toHaveValue(
    "2024-03-05",
  );
});

test("verified processing checks coverage and exact code choices, preserving operation ID on retry", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await expect(
    page.getByRole("button", { name: "Process verified rows", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    const w = window as any;
    const d = w.sources[0];
    d.coverage = {
      startDate: "2026-11-01",
      endDate: "2026-11-03",
      dateBasis: "transaction",
      completeness: "complete",
      profile: "Synthetic CSV",
      observedAt: "2026-11-03T18:00:00Z",
      accepted: false,
      inclusive: true,
    };
    d.rows[0].candidate.sourceType = "SALE";
    d.rows[1].candidate.sourceType = "PAYMENT";
    w.failProcess = true;
  });
  await page.getByRole("button", { name: "All sources" }).click();
  await page.getByRole("button", { name: /Card.csv/ }).click();
  const panel = page.getByRole("region", { name: "Automatic classification" });
  await panel
    .getByRole("combobox", { name: "Default purchase sharing" })
    .selectOption("ask");
  await panel.getByText("Verify source type codes (2)").click();
  await panel
    .getByRole("combobox", { name: "Source code: SALE", exact: true })
    .selectOption("expense");
  await panel.getByRole("button", { name: "Process verified rows" }).click();
  await expect(panel.getByRole("alert")).toContainText("Interrupted response");
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.screenshot({
    path: ".qa/classification-light.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Process verified rows" }).click();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "process_import"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.commitId).toBe(calls[1].args.commitId);
  expect(calls[0].args.policy).toEqual({
    ordinaryCardCharges: true,
    ownership: "ask",
    types: [
      { code: "SALE", kind: "expense" },
      { code: "PAYMENT", kind: "ask" },
    ],
  });
});

test("recorded pending activity remains reviewable and resolves canonical entry without another import", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate(() => {
    const d = (window as any).sources[0];
    const row = d.rows[0];
    row.disposition = "linked";
    row.eventId = "canonical-activity";
    row.pendingEntry = {
      id: "canonical-activity",
      revision: 1,
      kind: "unclassified",
      date: "2026-11-02",
      description: "Neighborhood Market",
      amountCents: 4218,
      payer: "jacob",
      categoryId: null,
      accountId: "amex",
      destinationAccountId: null,
      splitMode: "none",
      splitValue: "",
      jacobCents: 0,
      chelseaCents: 0,
      householdDeltaCents: 0,
      note: "",
      lines: [],
      pending: {
        direction: "out",
        verifiedExpense: true,
        categoryId: "groceries",
      },
    };
    d.source.pendingCount = 1;
    d.source.classificationCount = 1;
  });
  await page.getByRole("button", { name: "All sources" }).click();
  await page.getByRole("button", { name: /Card.csv/ }).click();
  await expect(page.getByText("Awaiting split", { exact: true })).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "Neighborhood Market" })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Review row 1" });
  await expect(dialog).toContainText("already recorded");
  await dialog
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("expense");
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("groceries");
  await dialog
    .getByRole("combobox", { name: "Expense allocation" })
    .selectOption("shared");
  await dialog.getByLabel("I checked this row against the source").check();
  await dialog.getByRole("button", { name: "Classify activity" }).click();
  await expect(dialog).toBeHidden();
  const calls = await page.evaluate(() => (window as any).calls);
  const save = calls.find((c: any) => c.cmd === "save_entry");
  expect(save.args.input).toMatchObject({
    id: "canonical-activity",
    revision: 1,
    amount: "42.18",
    kind: "expense",
    splitMode: "shared",
    accountId: "amex",
  });
  expect(calls.some((c: any) => c.cmd === "commit_import")).toBe(false);
});

test("dashboard distinguishes provisional allowance from confirmed spending and unknown types", async ({
  page,
}) => {
  await setup(page);
  await page.addInitScript(() => {
    (window as any).extraSnapshot = {
      spentCents: 7000,
      provisionalAllowanceCents: 10000,
      unclassifiedCount: 2,
      remainingCents: 53000,
      categories: [
        {
          id: "groceries",
          name: "Groceries",
          groupName: "Needs",
          color: "#789abc",
          limitCents: 70000,
          defaultLimitCents: 70000,
          spentCents: 7000,
          provisionalCents: 10000,
          revision: 1,
          archived: false,
          icon: "groceries",
        },
      ],
    };
  });
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(
    page.getByText("Includes $100.00 awaiting split.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "2 items awaiting classification. Totals remain provisional.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator(".hero-amount")).toHaveText("$530.00");
  await expect(page.locator(".status-card")).toContainText(
    "Provisional: review unresolved activity",
  );
  await expect(page.locator(".status-card")).not.toContainText(
    "within all category limits",
  );
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dracula"),
  );
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.screenshot({
    path: ".qa/classification-dracula.png",
    fullPage: true,
  });
});

async function pendingMovement(page: Page) {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate(() => {
    const w = window as any;
    const d = w.sources[0],
      row = d.rows[0];
    row.disposition = "imported";
    row.eventId = row.id;
    row.candidate.direction = "in";
    row.candidate.amountCents = 62400;
    row.candidate.description = "Card payment received";
    row.raw = ["2026-11-02", "Card payment received", "-624.00"];
    row.candidate.postedDate = "2026-11-03";
    row.pendingEntry = {
      id: row.id,
      revision: 1,
      kind: "unclassified",
      date: "2026-11-02",
      description: "Card payment received",
      amountCents: 62400,
      payer: "jacob",
      categoryId: null,
      accountId: "amex",
      destinationAccountId: null,
      splitMode: "none",
      splitValue: "",
      jacobCents: 0,
      chelseaCents: 0,
      householdDeltaCents: 0,
      note: "",
      pending: { direction: "in", verifiedExpense: false, categoryId: null },
    };
    d.source.classificationCount = 1;
    w.movementMatches = [
      {
        ...row.pendingEntry,
        id: "bank-movement",
        description: "Amex payment",
        accountId: "checking",
        pending: { direction: "out", verifiedExpense: false, categoryId: null },
        activityDates: [{ accountId: "checking", date: "2026-11-02" }],
      },
    ];
  });
  await page.getByRole("button", { name: "All sources" }).click();
  await page.getByRole("button", { name: /Card.csv/ }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Card payment received" })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("reconcile");
}
test("movement matching requires an explicit pair and source confirmation, with an idempotent retry", async ({
  page,
}) => {
  await pendingMovement(page);
  const dialog = page.getByRole("dialog", { name: "Review row 1" });
  const submit = dialog.getByRole("button", {
    name: "Reconcile movement",
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await dialog
    .getByRole("combobox", { name: "Matching movement", exact: true })
    .selectOption("bank-movement");
  await expect(submit).toBeDisabled();
  await expect(dialog).toContainText("Source date 2026-11-03");
  await dialog.getByLabel("I checked both sources").check();
  await page.evaluate(() => ((window as any).failMovement = true));
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText("Response interrupted");
  await page.setViewportSize({ width: 1100, height: 800 });
  await submit.scrollIntoViewIfNeeded();
  await expect(
    dialog.getByRole("button", { name: "Classify activity", exact: true }),
  ).toBeHidden();
  await page.screenshot({
    path: ".qa/movement-match-light.png",
    fullPage: true,
  });
  await submit.click();
  await expect(dialog).toBeHidden();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "reconcile_movement"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.input.operationId).toBe(calls[1].args.input.operationId);
  expect(calls[0].args.input).toMatchObject({
    revision: 1,
    matchId: "bank-movement",
    matchRevision: 1,
    confirmed: true,
  });
});
test("movement matching keeps unknown activity unchanged when there is no supported counterpart", async ({
  page,
}) => {
  await pendingMovement(page);
  const dialog = page.getByRole("dialog", { name: "Review row 1" });
  await dialog
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("hold");
  await page.evaluate(() => ((window as any).movementMatches = []));
  await dialog
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("reconcile");
  await expect(dialog).toContainText(
    "No compatible recorded movement has this amount",
  );
  await expect(
    dialog.getByRole("button", { name: "Reconcile movement", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Keep on hold / close" }).click();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "reconcile_movement"),
    ),
  ).toBe(false);
});
test("reconciled ledger records show both account dates and protect undo when later imports depend on them", async ({
  page,
}) => {
  await setup(page);
  await page.addInitScript(() => {
    const w = window as any;
    const entry = {
      id: "reconciled-payment",
      revision: 2,
      kind: "card_payment",
      date: "2026-11-01",
      description: "Reconciled payment",
      amountCents: 62400,
      payer: "jacob",
      accountId: "checking",
      destinationAccountId: "amex",
      categoryId: null,
      splitMode: "none",
      splitValue: "",
      jacobCents: 0,
      chelseaCents: 0,
      householdDeltaCents: 0,
      note: "",
      movementLink: "reconciliation-1",
      activityDates: [
        { accountId: "checking", date: "2026-11-01" },
        { accountId: "amex", date: "2026-11-03" },
      ],
    };
    w.extraSnapshot = { entries: [entry], monthlyCount: 1 };
    w.movementDetail = {
      id: "reconciliation-1",
      canonicalId: entry.id,
      revision: 2,
      undone: false,
      first: {
        id: "first",
        kind: "unclassified",
        date: "2026-11-01",
        accountId: "checking",
        description: "Bank payment",
        amount: "624.00",
      },
      second: {
        id: "second",
        kind: "unclassified",
        date: "2026-11-03",
        accountId: "amex",
        description: "Card payment received",
        amount: "624.00",
      },
      dates: entry.activityDates,
    };
    w.failUndoMovement = true;
  });
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Transactions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit Reconciled payment", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Reconciled movement",
    exact: true,
  });
  await expect(dialog).toContainText("Capital One 360 · 2026-11-01");
  await expect(dialog).toContainText("American Express · 2026-11-03");
  await expect(
    dialog.getByRole("button", { name: "Undo reconciliation" }),
  ).toBeDisabled();
  await dialog.getByLabel("Restore the original records").check();
  await dialog.getByRole("button", { name: "Undo reconciliation" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Later imports reference",
  );
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dracula"),
  );
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.screenshot({
    path: ".qa/movement-history-dracula.png",
    fullPage: true,
  });
  await page.evaluate(() => ((window as any).failUndoMovement = false));
  await dialog.getByRole("button", { name: "Undo reconciliation" }).click();
  await expect(dialog).toBeHidden();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "undo_movement"),
  );
  expect(calls.map((c: any) => c.args.id)).toEqual([
    "reconciliation-1",
    "reconciliation-1",
  ]);
});

test("coverage retry keeps one operation and carries the pause choice", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await coverageForm(page);
  await page
    .getByLabel("Use saved automatic processing defaults for this import")
    .uncheck();
  await page.getByLabel("I checked the actual download range").check();
  await page.evaluate(() => {
    (window as any).failCoverageResponse = true;
  });
  await page.getByRole("button", { name: "Confirm download coverage" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Coverage response interrupted. Retry the same request.",
  );
  await page.getByRole("button", { name: "Confirm download coverage" }).click();
  await expect(
    page.getByText("2026-10-01 to 2026-11-02", { exact: true }),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter(
      (c: any) => c.cmd === "finalize_import_coverage",
    ),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.commitId).toBe(calls[1].args.commitId);
  expect(calls[0].args.processSavedDefaults).toBe(false);
  expect(calls[1].args.processSavedDefaults).toBe(false);
});

test("reusable defaults retain absent type codes and can disable automation after all rows are processed", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate(() => {
    const d = (window as any).sources[0];
    d.coverage = {
      startDate: "2026-11-01",
      endDate: "2026-11-03",
      dateBasis: "transaction",
      completeness: "complete",
      profile: "Synthetic CSV",
      observedAt: "2026-11-03T18:00:00Z",
      accepted: true,
      inclusive: true,
    };
    d.classificationProfile = {
      profile: "Synthetic CSV",
      automatic: true,
      policy: {
        ordinaryCardCharges: true,
        ownership: "shared",
        types: [{ code: "PAST REWARD", kind: "reward" }],
      },
    };
    d.rows.forEach((r: any) => {
      r.disposition = "imported";
    });
    d.source.pendingCount = 0;
    d.source.importedCount = d.rows.length;
  });
  await reopenSource(page);
  const panel = page.getByRole("region", { name: "Automatic classification" });
  await expect(
    panel.getByRole("combobox", { name: "Default purchase sharing" }),
  ).toHaveValue("shared");
  await panel.getByText("Verify source type codes (1)").click();
  await expect(
    panel.getByRole("combobox", {
      name: "Source code: PAST REWARD",
      exact: true,
    }),
  ).toHaveValue("reward");
  await panel
    .getByLabel(
      "Process future matching exports when I confirm their download range",
    )
    .uncheck();
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await page.screenshot({
    path: ".qa/import-defaults-light.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Save import defaults" }).click();
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "process_import"),
  );
  expect(call.args.preferences).toEqual({ remember: true, automatic: false });
  expect(call.args.policy.types).toEqual([
    { code: "PAST REWARD", kind: "reward" },
  ]);
});

test("source-only defaults are explicit and cannot be edited before range confirmation", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  const panel = page.getByRole("region", { name: "Automatic classification" });
  await expect(
    panel.getByRole("combobox", { name: "Default purchase sharing" }),
  ).toBeDisabled();
  await coverageForm(page);
  await page.getByLabel("I checked the actual download range").check();
  await page.getByRole("button", { name: "Confirm download coverage" }).click();
  await panel
    .getByLabel(
      "Remember defaults for this account, format and download profile",
    )
    .uncheck();
  await expect(
    panel.getByLabel(
      "Process future matching exports when I confirm their download range",
    ),
  ).toHaveCount(0);
  await panel
    .getByRole("combobox", { name: "Default purchase sharing" })
    .selectOption("ask");
  await page.evaluate(
    () => (document.documentElement.dataset.theme = "dracula"),
  );
  await expect(
    page.getByRole("button", { name: "All sources", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await page.screenshot({
    path: ".qa/import-defaults-dracula.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Process verified rows" }).click();
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "process_import"),
  );
  expect(call.args.preferences.remember).toBe(false);
  expect(call.args.policy.ownership).toBe("ask");
});

async function paymentCodes(page: Page, bank = false) {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate((bank) => {
    const w = window as any,
      d = w.sources[0];
    if (bank) d.source.accountId = "checking";
    d.rows[0].candidate.sourceType = "PAYMENT";
    d.classificationProfile = {
      profile: "Amex activity CSV",
      automatic: true,
      policy: {
        ordinaryCardCharges: true,
        ownership: "personal",
        types: [
          {
            code: "OLD PAYMENT",
            kind: "card_payment",
            accountId: bank ? "amex" : "checking",
          },
        ],
      },
    };
    w.extraSnapshot = {
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
        {
          id: "gifts",
          name: "Gift savings",
          kind: "savings",
          activityCents: 0,
          revision: 1,
          archived: false,
        },
        {
          id: "archived",
          name: "Old bank",
          kind: "checking",
          activityCents: 0,
          revision: 1,
          archived: true,
        },
      ],
    };
  }, bank);
  await reopenSource(page);
  await coverageForm(page);
  await page
    .getByLabel("Use saved automatic processing defaults for this import")
    .uncheck();
  await page.getByLabel("I checked the actual download range").check();
  await page.getByRole("button", { name: "Confirm download coverage" }).click();
  const panel = page.getByRole("region", { name: "Automatic classification" });
  await panel.getByText("Verify source type codes (2)").click();
  return panel;
}
test("payment codes require a compatible counterpart and preserve it through retries and absent codes", async ({
  page,
}) => {
  const panel = await paymentCodes(page);
  const kind = panel.getByRole("combobox", {
    name: "Source code: PAYMENT",
    exact: true,
  });
  await kind.selectOption("card_payment");
  const other = panel.getByRole("combobox", {
    name: "Other account for PAYMENT",
    exact: true,
  });
  await expect(
    panel.getByRole("button", { name: "Process verified rows" }),
  ).toBeDisabled();
  await expect(
    other.getByRole("option", { name: "American Express", exact: true }),
  ).toHaveCount(0);
  await expect(
    other.getByRole("option", { name: "Old bank", exact: true }),
  ).toHaveCount(0);
  await other.selectOption("checking");
  await kind.selectOption("reward");
  await expect(other).toHaveCount(0);
  await kind.selectOption("card_payment");
  await expect(other).toHaveValue("");
  await other.selectOption("checking");
  await page.evaluate(() => {
    (window as any).failProcess = true;
  });
  await panel.getByRole("button", { name: "Process verified rows" }).click();
  await expect(panel.getByRole("alert")).toContainText("Interrupted response");
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await page.screenshot({
    path: ".qa/payment-codes-light.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Process verified rows" }).click();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "process_import"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.commitId).toBe(calls[1].args.commitId);
  expect(calls[0].args.policy.types).toEqual([
    { code: "OLD PAYMENT", kind: "card_payment", accountId: "checking" },
    { code: "PAYMENT", kind: "card_payment", accountId: "checking" },
  ]);
});
test("checking conventions filter bank transfers and card payments to the right account kinds", async ({
  page,
}) => {
  const panel = await paymentCodes(page, true);
  const kind = panel.getByRole("combobox", {
    name: "Source code: PAYMENT",
    exact: true,
  });
  await kind.selectOption("card_payment");
  const other = panel.getByRole("combobox", {
    name: "Other account for PAYMENT",
    exact: true,
  });
  await expect(
    other.getByRole("option", { name: "Gift savings", exact: true }),
  ).toHaveCount(0);
  await other.selectOption("amex");
  await kind.selectOption("transfer");
  await expect(
    other.getByRole("option", { name: "American Express", exact: true }),
  ).toHaveCount(0);
  await other.selectOption("gifts");
  await page.evaluate(
    () => (document.documentElement.dataset.theme = "dracula"),
  );
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await page.screenshot({
    path: ".qa/payment-codes-dracula.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Process verified rows" }).click();
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "process_import"),
  );
  expect(call.args.policy.types[1]).toEqual({
    code: "PAYMENT",
    kind: "transfer",
    accountId: "gifts",
  });
});
test("known pending payment displays its reason and stays available for explicit reconciliation", async ({
  page,
}) => {
  await pendingMovement(page);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.evaluate(() => {
    const e = (window as any).sources[0].rows[0].pendingEntry;
    e.pending.kindHint = "card_payment";
    e.note =
      "Verified source code PAYMENT: Card payment from Capital One 360 to American Express. The other account already has possible pending activity; reconcile the two records.";
  });
  await reopenSource(page);
  const row = page
    .getByRole("row")
    .filter({ hasText: "Card payment received" });
  await expect(row).toContainText("Payment to review");
  await row.getByRole("button", { name: "Review", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review row 1" });
  await expect(dialog).toContainText(
    "The other account already has possible pending activity",
  );
  await dialog
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("reconcile");
  await expect(
    dialog.getByRole("button", { name: "Reconcile movement", exact: true }),
  ).toBeDisabled();
});

async function merchantReview(page: Page) {
  await setup(page);
  await browse(page);
  await map(page);
  await page.evaluate(() => {
    const w = window as any;
    function item(
      id: string,
      description: string,
      merchant: string,
      pending = false,
      reason = "",
    ) {
      return {
        rowId: `row-${id}`,
        merchant,
        reason,
        entry: {
          id,
          revision: 2,
          kind: pending ? "unclassified" : "expense",
          date: "2026-11-02",
          description,
          amountCents: 5000,
          payer: "jacob",
          accountId: "amex",
          destinationAccountId: null,
          categoryId: pending ? null : "groceries",
          splitMode: pending ? "none" : "personal",
          splitValue: "",
          jacobCents: pending ? 0 : 5000,
          chelseaCents: 0,
          householdDeltaCents: 0,
          note: "",
          lines: [],
          pending: pending
            ? {
                verifiedExpense: true,
                direction: "out",
                categoryId: "groceries",
              }
            : null,
        },
      };
    }
    w.purchaseReview = {
      items: [
        item("a", "Neighborhood Market", "neighborhood market"),
        item("b", "NEIGHBORHOOD-MARKET", "neighborhood market", true),
        item(
          "c",
          "Neighborhood Market",
          "neighborhood market",
          false,
          "Linked bills or refunds protect this purchase's allocations.",
        ),
        item("d", "Market 2", "market 2"),
      ],
      previous: [
        {
          merchant: "neighborhood market",
          date: "2026-10-23",
          categoryId: "groceries",
          splitMode: "equal",
          splitValue: "",
        },
      ],
      undoId: "previous-review",
    };
  });
  await page
    .getByRole("button", { name: "Review purchases by merchant", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Review purchases by merchant" });
}
test("merchant groups support keyboard sharing and atomic preview with retry", async ({
  page,
}) => {
  const dialog = await merchantReview(page);
  const group = dialog.getByRole("checkbox", {
    name: "Select merchant neighborhood market",
    exact: true,
  });
  await group.check();
  await group.focus();
  await page.keyboard.press("Alt+2");
  await expect(dialog.getByLabel("Sharing change")).toHaveValue("shared");
  await expect(dialog.getByLabel("Category change")).toHaveValue("");
  await expect(dialog).toContainText("2 selected");
  await expect(
    dialog.getByRole("button", { name: "Apply once", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("$100.00");
  await dialog.getByLabel("I reviewed all selected purchases").check();
  await page.evaluate(() => {
    (window as any).failPurchaseReview = true;
  });
  await dialog.getByRole("button", { name: "Apply once", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Response interrupted");
  await dialog.getByRole("button", { name: "Apply once", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "review_purchases"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.request).toEqual(calls[1].args.request);
  expect(calls[0].args.request.rows.map((r: any) => r.eventId)).toEqual([
    "a",
    "b",
  ]);
  expect(calls[0].args.request.changes).toEqual({
    categoryId: null,
    splitMode: "shared",
    splitValue: "",
  });
});
test("merchant review keeps choices independent and invalidates stale previews", async ({
  page,
}) => {
  const dialog = await merchantReview(page);
  await dialog
    .getByRole("checkbox", {
      name: "Select merchant neighborhood market",
      exact: true,
    })
    .check();
  await dialog
    .getByRole("button", { name: "Use previous category", exact: true })
    .click();
  await expect(dialog.getByLabel("Sharing change")).toHaveValue("");
  await dialog
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await dialog.getByLabel("I reviewed all selected purchases").check();
  await dialog
    .getByRole("button", { name: "Use previous sharing", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Apply once", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByLabel("Sharing change")).toHaveValue("equal");
  await dialog.getByLabel("Find merchant").fill("Market 2");
  await expect(dialog).toContainText("2 selected");
  await dialog
    .getByRole("checkbox", { name: "Select merchant market 2", exact: true })
    .check();
  await expect(dialog).toContainText("3 selected");
  await expect(
    dialog.getByRole("button", {
      name: "Remember for next time...",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog.getByLabel("Find merchant").fill("");
  await dialog
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await page.setViewportSize({ width: 1100, height: 850 });
  await expect(dialog.locator(".merchant-purchase").first()).toHaveCSS(
    "flex-direction",
    "row",
  );
  await page.screenshot({
    path: ".qa/merchant-review-light.png",
    animations: "disabled",
    fullPage: true,
  });
  page.once("dialog", (d) => d.dismiss());
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
});
test("merchant review remembers an independently previewed rule without posting selected changes", async ({
  page,
}) => {
  const dialog = await merchantReview(page);
  await dialog
    .getByRole("checkbox", {
      name: "Select merchant neighborhood market",
      exact: true,
    })
    .check();
  await dialog.getByLabel("Category change").selectOption("groceries");
  await dialog
    .getByRole("button", { name: "Remember for next time...", exact: true })
    .click();
  const rule = page.getByRole("dialog", {
    name: "Remember merchant",
    exact: true,
  });
  await expect(rule.getByLabel("Sharing action")).toHaveValue("leave");
  await expect(
    rule.getByRole("button", { name: "Save rule", exact: true }),
  ).toBeDisabled();
  await rule
    .getByRole("button", { name: "Preview matches", exact: true })
    .click();
  await rule.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(rule).toHaveCount(0);
  await expect(dialog).toContainText("Merchant rule saved for future imports");
  const calls = await page.evaluate(() => (window as any).calls);
  expect(calls.filter((c: any) => c.cmd === "review_purchases")).toHaveLength(
    0,
  );
  expect(
    calls.find((c: any) => c.cmd === "save_rule").args.rule.ownershipAction,
  ).toBe("leave");
  await expect(dialog.getByLabel("Category change")).toHaveValue("groceries");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dracula";
  });
  await page.screenshot({
    path: ".qa/merchant-review-dracula.png",
    animations: "disabled",
    fullPage: true,
  });
});
test("merchant review reports guarded undo and preview errors without losing selection", async ({
  page,
}) => {
  const dialog = await merchantReview(page);
  await page.evaluate(() => {
    (window as any).failPurchaseUndo = true;
  });
  page.once("dialog", (d) => d.accept());
  await dialog
    .getByRole("button", { name: "Undo last purchase review", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("import links changed");
  await dialog
    .getByRole("checkbox", {
      name: "Select merchant neighborhood market",
      exact: true,
    })
    .check();
  await dialog.getByLabel("Category change").selectOption("groceries");
  await page.evaluate(() => {
    (window as any).failPurchasePreview = true;
  });
  await dialog
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Purchase changed");
  await expect(dialog).toContainText("2 selected");
  await expect(
    dialog.getByRole("button", { name: "Apply once", exact: true }),
  ).toBeDisabled();
});

async function conditionalSetup(page: Page) {
  await setup(page);
  await browse(page);
  await page.evaluate(() => {
    (window as any).extraSnapshot = {
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
        {
          id: "dining",
          name: "Dining together",
          groupName: "Wants",
          color: "#abcdef",
          limitCents: 42500,
          defaultLimitCents: 42500,
          spentCents: 0,
          revision: 1,
          archived: false,
          icon: "dining",
        },
        {
          id: "personal",
          name: "Personal spending",
          groupName: "Wants",
          color: "#abcdef",
          limitCents: 10000,
          defaultLimitCents: 10000,
          spentCents: 0,
          revision: 1,
          archived: false,
          icon: "personal",
        },
      ],
    };
  });
  await map(page);
}
test("conditional category rules leave sharing unchanged and require a new preview after scope edits", async ({
  page,
}) => {
  await conditionalSetup(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Merchant rules", exact: true })
    .click();
  await page.getByRole("button", { name: "New rule", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Remember merchant",
    exact: true,
  });
  await dialog.getByLabel("Rule name").fill("Neighborhood Market category");
  await dialog.getByLabel("Merchant phrase").fill("Neighborhood Market");
  await dialog.getByLabel("Category applies when").selectOption("shared");
  await expect(dialog.getByLabel("Sharing action")).toHaveValue("leave");
  await expect(dialog.getByLabel("Sharing action")).toBeDisabled();
  await dialog.getByLabel("Category action").selectOption("set");
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("dining");
  await dialog
    .getByRole("button", { name: "Preview matches", exact: true })
    .click();
  await dialog.getByLabel("Category applies when").selectOption("personal");
  await expect(
    dialog.getByRole("button", { name: "Save rule", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("personal");
  await dialog
    .getByRole("button", { name: "Preview matches", exact: true })
    .click();
  await page.screenshot({
    path: ".qa/conditional-rules-light.png",
    animations: "disabled",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Save rule", exact: true }).click();
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "save_rule"),
  );
  expect(call.args.rule.categoryScope).toBe("personal");
  expect(call.args.rule.ownershipAction).toBe("leave");
});
test("sharing category suggestions require explicit acceptance and discard delayed results after another sharing choice", async ({
  page,
}) => {
  await conditionalSetup(page);
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review row 1",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("expense");
  await dialog
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("groceries");
  await dialog.getByLabel("Expense allocation").selectOption("shared");
  await expect(
    dialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("groceries");
  await dialog
    .getByRole("button", { name: "Check category suggestions", exact: true })
    .click();
  await expect(dialog).toContainText("Suggested category: Dining together");
  await expect(
    dialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("groceries");
  await dialog
    .getByRole("button", { name: "Use suggested category", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("dining");
  await page.evaluate(() => {
    (window as any).suggestionDelay = 500;
  });
  await dialog
    .getByRole("button", { name: "Check category suggestions", exact: true })
    .click();
  await dialog.getByLabel("Expense allocation").selectOption("personal");
  await expect(
    dialog.getByRole("button", {
      name: "Check category suggestions",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Use suggested category", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("dining");
  await dialog
    .getByRole("button", { name: "Check category suggestions", exact: true })
    .click();
  await expect(dialog).toContainText("Suggested category: Personal spending");
  await dialog
    .getByRole("button", { name: "Use suggested category", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("personal");
});
test("held merchant grouping supports keyboard selection, conditional suggestions and guarded batch posting", async ({
  page,
}) => {
  await conditionalSetup(page);
  await page.evaluate(() => {
    const d = (window as any).sources[0];
    for (const [i, r] of d.rows.entries()) {
      r.merchant = "neighborhood market";
      r.candidate.description = i
        ? "NEIGHBORHOOD-MARKET"
        : "Neighborhood Market";
      r.bulkExpenseReason = "";
    }
  });
  await reopenSource(page);
  await page.getByLabel("Group rows by merchant").check();
  const group = page.getByRole("checkbox", {
    name: "Select held merchant neighborhood market",
    exact: true,
  });
  await group.focus();
  await page.keyboard.press("Space");
  await page
    .getByRole("button", { name: "Review 2 rows", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review 2 selected rows",
    exact: true,
  });
  await dialog.getByLabel("Purchase sharing").focus();
  await page.keyboard.press("Alt+2");
  await expect(dialog.getByLabel("Purchase sharing")).toHaveValue("shared");
  await dialog
    .getByRole("button", { name: "Check category suggestions", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Use suggested category", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("dining");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("dining");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dracula";
  });
  await page.screenshot({
    path: ".qa/held-groups-dracula.png",
    animations: "disabled",
    fullPage: true,
  });
  await dialog.getByLabel("I checked every selected row").check();
  await dialog
    .getByRole("button", { name: "Import expenses", exact: true })
    .click();
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "commit_import"),
  );
  expect(call.args.decisions).toHaveLength(2);
  expect(
    call.args.decisions.every(
      (d: any) =>
        d.action === "bulk_expense" &&
        d.input.categoryId === "dining" &&
        d.input.splitMode === "shared",
    ),
  ).toBe(true);
});
test("grouped rows with unresolved source types cannot use the purchase batch", async ({
  page,
}) => {
  await conditionalSetup(page);
  await page.evaluate(() => {
    const d = (window as any).sources[0];
    d.rows[0].bulkExpenseReason =
      "This source type needs individual classification before purchase batching.";
  });
  await reopenSource(page);
  await page
    .getByRole("checkbox", { name: "Select visible held rows", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Review 2 rows", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review 2 selected rows",
    exact: true,
  });
  await expect(dialog).toContainText(
    "Some selected rows need individual review",
  );
  await expect(
    dialog.getByRole("button", { name: "Import expenses", exact: true }),
  ).toBeDisabled();
});

test("individual import budget-period override is explicit, preserves source date and resets confirmation", async ({
  page,
}) => {
  await setup(page);
  await browse(page);
  await map(page);
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "Treatment", exact: true })
    .selectOption("expense");
  await d
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("groceries");
  const actual = await d.getByLabel("Date", { exact: true }).inputValue();
  await d.getByLabel("I checked this row").check();
  await d.locator("summary").filter({ hasText: "Budget period" }).click();
  await d.getByLabel("Use a different budget month").check();
  await d.getByLabel("Budget month", { exact: true }).fill("2026-12");
  await d
    .getByLabel("Reason for budget override")
    .fill("Reviewed late import allocation");
  await expect(d.getByLabel("I checked this row")).not.toBeChecked();
  await d.getByLabel("I checked this row").check();
  await page.evaluate(() => {
    (window as any).failCommit = "Synthetic unavailable";
  });
  await d.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("unavailable");
  await expect(d.getByLabel("Date", { exact: true })).toHaveValue(actual);
  await page.evaluate(() => {
    (window as any).failCommit = false;
  });
  await d.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "commit_import"),
  );
  expect(calls[0].args.commitId).toBe(calls[1].args.commitId);
  expect(calls[1].args.decisions[0].input).toMatchObject({
    date: actual,
    budgetOverride: {
      month: "2026-12",
      reason: "Reviewed late import allocation",
    },
  });
});
