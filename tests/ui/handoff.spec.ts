import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.relation = "diverged";
    w.failApply = false;
    w.failPreview = false;
    w.failExport = false;
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
            accounts: [],
            categories: [],
            spentCents: 0,
            incomeCents: 0,
            budgetCents: 0,
            budgetConfigured: false,
            remainingCents: 0,
            householdCents: 0,
            householdMonthSpentCents: 0,
            monthlyCount: 0,
            incompleteImports: 0,
            dataPath: "synthetic.sqlite",
            backups: [],
          };
        }
        if (cmd === "handoff_export") {
          if (w.failExport) {
            w.failExport = false;
            throw "Synthetic lost reply. Retry the same operation.";
          }
          return {
            path: "C:\\Synthetic\\exports\\demo-transfer.pfinance.age",
            transfer: args.operation,
          };
        }
        if (cmd === "handoff_preview") {
          if (w.previewDelay) await new Promise((r) => setTimeout(r, 450));
          if (w.failPreview)
            throw "Unable to unlock this file. Check the passphrase and file integrity.";
          return {
            token: "synthetic-token",
            relationship: w.relation,
            requiresReplacementAck: [
              "diverged",
              "local_ahead",
              "unrelated",
            ].includes(w.relation),
            localEntries: 12,
            incomingEntries: 12,
            localSources: 3,
            incomingSources: 4,
            manifest: {
              label: "Laptop to desktop",
              createdAt: "2026-11-04T12:00:00Z",
              device: "synthetic-device",
              workspace: args.workspace,
            },
          };
        }
        if (cmd === "handoff_apply") {
          if (w.failApply) {
            w.failApply = false;
            throw "Synthetic lost reply. Retry the same operation.";
          }
          if (w.afterApplyFailRefresh) w.failRefresh = true;
          return {
            preserved: "synthetic.handoff.sqlite",
            alreadyApplied: false,
          };
        }
        if (cmd === "set_native_theme" || cmd === "handoff_folder") return;
        return [];
      },
    };
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Monthly overview" }),
  ).toBeVisible();
}
async function open(page: Page, mode: "Import" | "Export") {
  await page
    .getByRole("button", { name: "Workspace & backups", exact: true })
    .click();
  await page
    .getByRole("button", { name: `${mode} handoff`, exact: true })
    .click();
  return page.getByRole("dialog", { name: `${mode} encrypted handoff` });
}
async function select(page: Page) {
  await page.getByLabel("Handoff file", { exact: true }).setInputFiles({
    name: "synthetic.pfinance.age",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("Synthetic encrypted file"),
  });
  await page
    .getByLabel("Handoff passphrase", { exact: true })
    .fill("synthetic testing passphrase");
}
async function preview(page: Page) {
  await select(page);
  await page.getByRole("button", { name: "Unlock and preview" }).click();
  await expect(
    page.getByRole("region", { name: "Handoff review" }),
  ).toBeVisible();
}
async function confirm(page: Page) {
  await page.getByLabel(/Replace this computer/).check();
  await page.getByLabel(/I reviewed the selected/).check();
}
test("handoff export requires matching passphrases, retries the same operation and clears secrets after success", async ({
  page,
}) => {
  await setup(page);
  const d = await open(page, "Export");
  await d
    .getByLabel("Export passphrase", { exact: true })
    .fill("synthetic testing passphrase");
  await d
    .getByLabel("Repeat passphrase", { exact: true })
    .fill("different test passphrase");
  await d.getByLabel(/I have saved/).check();
  await expect(
    d.getByRole("button", { name: "Create encrypted file" }),
  ).toBeDisabled();
  await d
    .getByLabel("Repeat passphrase", { exact: true })
    .fill("synthetic testing passphrase");
  await page.evaluate(() => {
    (window as any).failExport = true;
  });
  await d.getByRole("button", { name: "Create encrypted file" }).click();
  await expect(d.getByRole("alert")).toContainText("lost reply");
  await d.getByRole("button", { name: "Create encrypted file" }).click();
  await expect(d.getByRole("status")).toContainText("Encrypted file saved");
  await expect(d.getByLabel("Export passphrase", { exact: true })).toHaveValue(
    "",
  );
  await expect(d.getByLabel("Repeat passphrase", { exact: true })).toHaveValue(
    "",
  );
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "handoff_export"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  await d.getByRole("button", { name: "Open export folder" }).click();
  await d.getByRole("button", { name: "Done", exact: true }).click();
  await expect(d).toHaveCount(0);
});
test("handoff divergence requires both approvals, retries once, and closes before a failed refresh", async ({
  page,
}) => {
  await setup(page);
  const d = await open(page, "Import");
  await preview(page);
  await expect(
    d.getByRole("heading", { name: "Both computers have changes" }),
  ).toBeVisible();
  const apply = d.getByRole("button", { name: "Import selected copy" });
  await expect(apply).toBeDisabled();
  await page.getByLabel(/I reviewed the selected/).check();
  await expect(apply).toBeDisabled();
  await page.getByLabel(/Replace this computer/).check();
  await page.evaluate(() => {
    (window as any).failApply = true;
  });
  await apply.click();
  await expect(d.getByRole("alert")).toContainText("lost reply");
  await page.evaluate(() => {
    (window as any).afterApplyFailRefresh = true;
  });
  await apply.click();
  await expect(d).toHaveCount(0);
  await expect(
    page.getByText(/Your change was saved, but the screen could not reload/),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "handoff_apply"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args).toEqual(calls[1].args);
});
test("handoff approvals are cleared on edits and failed previews; unchanged copies cannot apply", async ({
  page,
}) => {
  await setup(page);
  const d = await open(page, "Import");
  await preview(page);
  await confirm(page);
  await d
    .getByLabel("Handoff passphrase", { exact: true })
    .fill("different synthetic password");
  await expect(d.getByRole("region", { name: "Handoff review" })).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    (window as any).failPreview = true;
  });
  await d.getByRole("button", { name: "Unlock and preview" }).click();
  await expect(d.getByRole("alert")).toContainText("Unable to unlock");
  await page.evaluate(() => {
    (window as any).failPreview = false;
    (window as any).relation = "same";
  });
  await d.getByRole("button", { name: "Unlock and preview" }).click();
  await expect(
    d.getByRole("heading", { name: "Already up to date" }),
  ).toBeVisible();
  await expect(
    d.getByRole("button", { name: "Import selected copy" }),
  ).toHaveCount(0);
});
test("handoff drag and drop opens review without ordinary import and rejects mixed batches", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["Synthetic"], "one.pfinance.age"));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt }));
  });
  const d = page.getByRole("dialog", { name: "Import encrypted handoff" });
  await expect(d).toBeVisible();
  await expect(d.getByText("one.pfinance.age", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).calls.filter(
            (c: any) =>
              c.cmd === "ingest_import" || c.cmd === "ingest_import_path",
          ).length,
      ),
    )
    .toBe(0);
  await d.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["Synthetic"], "one.pfinance.age"));
    dt.items.add(new File(["Synthetic"], "two.csv"));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt }));
  });
  await expect(page.getByText(/Drop one handoff file at a time/)).toBeVisible();
  await expect(d).toHaveCount(0);
});
test("handoff delayed preview locks inputs and reopening in another workspace clears secrets", async ({
  page,
}) => {
  await setup(page);
  let d = await open(page, "Import");
  await select(page);
  await page.evaluate(() => {
    (window as any).previewDelay = true;
  });
  await d.getByRole("button", { name: "Unlock and preview" }).click();
  await expect(
    d.getByLabel("Handoff passphrase", { exact: true }),
  ).toBeDisabled();
  await expect(d.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  await expect(d.getByRole("region", { name: "Handoff review" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await d.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: /Personal workspace Personal records/ })
    .click();
  await page
    .getByRole("button", { name: "Workspace & backups", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import handoff", exact: true })
    .click();
  d = page.getByRole("dialog", { name: "Import encrypted handoff" });
  await expect(d.getByLabel("Handoff passphrase", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    d.getByText("Personal workspace", { exact: true }),
  ).toBeVisible();
});
for (const theme of ["light", "dark"]) {
  test(`handoff ${theme} compact visual review`, async ({ page }) => {
    await setup(page);
    await page.evaluate((theme) => {
      localStorage.setItem("appearance-theme", theme);
    }, theme);
    await page.reload();
    await page.setViewportSize({ width: 1100, height: 780 });
    const d = await open(page, "Import");
    await preview(page);
    await d
      .getByRole("heading", { name: "Both computers have changes" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.qa/handoff-${theme}.png` });
    await d
      .getByRole("button", { name: "Import selected copy" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.qa/handoff-${theme}-confirmation.png` });
    expect(
      await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
  });
}
