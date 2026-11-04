import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, configured = false) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ configured }) => {
      const w = window as any;
      w.isTauri = true;
      w.calls = [];
      w.configured = configured;
      w.config = {
        revision: 1,
        root: "C:\\Synthetic\\OneDrive",
        workspace: "demo",
        workspaceId: "synthetic-workspace",
        device: "synthetic-device",
        daily: 30,
        monthly: 12,
        automatic: true,
        remembered: true,
        records: [
          {
            id: "copy-1",
            file: "synthetic.pfbackup",
            createdAt: "2026-11-04T15:00:00Z",
            bytes: 1048576,
            protected: false,
          },
        ],
        lastError: null,
        lastAttempt: "2026-11-04T15:00:00Z",
      };
      w.backupStatus = () => ({
        config: w.configured ? structuredClone(w.config) : null,
        folder: w.configured
          ? "C:\\Synthetic\\OneDrive\\Personal Finance Backups\\workspace\\device\\snapshots"
          : null,
        queued: false,
        running: false,
        cloudSyncVerified: false,
      });
      w.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any = {}) => {
          w.calls.push({ cmd, args: structuredClone(args) });
          if (cmd === "snapshot")
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
          if (cmd === "backup_status") {
            if (w.failStatus) {
              throw "Synthetic unavailable status";
            }
            const response = w.backupStatus();
            if (args.workspace === "personal") response.config = null;
            if (w.holdStatus) {
              w.holdStatus = false;
              await new Promise((r) => {
                w.releaseStatus = r;
              });
            }
            if (w.delayStatus) await new Promise((r) => setTimeout(r, 450));
            return response;
          }
          if (cmd === "backup_choose_folder") return "C:\\Synthetic\\OneDrive";
          if (cmd === "backup_configure") {
            if (w.failSetup) {
              w.failSetup = false;
              throw "Synthetic setup failed";
            }
            w.configured = true;
            Object.assign(w.config, {
              ...args.input,
              revision: args.input.revision + 1,
              remembered: args.input.remember,
            });
            return w.backupStatus();
          }
          if (cmd === "backup_run") {
            if (w.failRun) {
              w.failRun = false;
              throw "Synthetic destination unavailable";
            }
            return w.backupStatus();
          }
          if (cmd === "backup_pause") {
            w.config.automatic = false;
            w.config.revision++;
            return w.backupStatus();
          }
          if (cmd === "backup_protect") {
            w.config.records[0].protected = args.protected;
            w.config.revision++;
            return w.backupStatus();
          }
          if (cmd === "managed_backup_preview") {
            if (w.failPreview) {
              w.failPreview = false;
              throw "Wrong passphrase or damaged backup";
            }
            return {
              token: "review-token",
              localEntries: 5,
              incomingEntries: 8,
              incomingSources: 3,
              manifest: {
                createdAt: "2026-11-04T15:00:00Z",
                workspace: args.workspace,
                device: "other-device",
                schema: 43,
              },
            };
          }
          if (cmd === "managed_backup_restore") {
            if (w.failRestore) {
              w.failRestore = false;
              throw "Synthetic lost restore reply";
            }
            return { preserved: "synthetic.managed.sqlite" };
          }
          return [];
        },
      };
    },
    { configured },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Monthly overview" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Workspace & backups", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Folder backups", exact: true }),
  ).toBeVisible();
}
test("folder setup requires retained matching secret, clears approval on edits and retains failed drafts", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Set up folder", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "Folder backup settings" });
  await d.getByRole("button", { name: "Browse folders" }).click();
  await expect(d.getByLabel("Destination folder")).toHaveValue(
    "C:\\Synthetic\\OneDrive",
  );
  await d
    .getByLabel("Backup passphrase", { exact: true })
    .fill("synthetic recovery passphrase");
  await d
    .getByLabel("Repeat backup passphrase")
    .fill("not the same passphrase");
  await d.getByLabel(/I have retained/).check();
  await expect(
    d.getByRole("button", { name: "Save backup settings" }),
  ).toBeDisabled();
  await d
    .getByLabel("Repeat backup passphrase")
    .fill("synthetic recovery passphrase");
  await expect(d.getByLabel(/I have retained/)).not.toBeChecked();
  await d.getByLabel(/I have retained/).check();
  await page.evaluate(() => {
    (window as any).failSetup = true;
  });
  await d.getByRole("button", { name: "Save backup settings" }).click();
  await expect(d.getByRole("alert")).toContainText("setup failed");
  await expect(d.getByLabel("Destination folder")).toHaveValue(
    "C:\\Synthetic\\OneDrive",
  );
  await d.getByRole("button", { name: "Save backup settings" }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByText(
      "Cloud sync not verified · Automatic copies run while the app is open.",
    ),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "backup_configure"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[1].args.input).toMatchObject({
    daily: 30,
    monthly: 12,
    automatic: true,
    remember: true,
    recoveryConfirmed: true,
  });
});
test("folder backup retry, protected copies and pause preserve clear local-only success", async ({
  page,
}) => {
  await setup(page, true);
  await page
    .getByRole("button", { name: "Save folder backup", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "Save folder backup" });
  await d.getByLabel(/Protect this checkpoint/).check();
  await page.evaluate(() => {
    (window as any).failRun = true;
  });
  await d.getByRole("button", { name: "Save encrypted copy" }).click();
  await expect(d.getByRole("alert")).toContainText("destination unavailable");
  await expect(d.getByLabel(/Protect this checkpoint/)).toBeChecked();
  await d.getByRole("button", { name: "Save encrypted copy" }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByText("Backup saved to selected folder. Cloud sync not verified."),
  ).toBeVisible();
  await page.getByText("Saved copies (1)", { exact: true }).click();
  await page.getByRole("button", { name: "Protect", exact: true }).click();
  await expect(page.getByText(/Protected checkpoint/)).toBeVisible();
  await page.getByRole("button", { name: "Pause automatic backups" }).click();
  await expect(page.getByText("Manual backups", { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).calls);
  expect(
    calls
      .filter((c: any) => c.cmd === "backup_run")
      .every((c: any) => c.args.protected && c.args.workspace === "demo"),
  ).toBeTruthy();
  expect(
    calls.filter((c: any) =>
      ["save_entry", "handoff_export", "restore_backup"].includes(c.cmd),
    ),
  ).toHaveLength(0);
});
test("folder restore validates first, invalidates edited preview and retries the same restore receipt", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Restore an encrypted backup" })
    .click();
  const d = page.getByRole("dialog", {
    name: "Restore encrypted folder backup",
  });
  await d.getByLabel("Backup file", { exact: true }).setInputFiles({
    name: "synthetic.pfbackup",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic encrypted bytes"),
  });
  await d
    .getByLabel("Recovery passphrase")
    .fill("synthetic recovery passphrase");
  await page.evaluate(() => {
    (window as any).failPreview = true;
  });
  await d.getByRole("button", { name: "Preview restore" }).click();
  await expect(d.getByRole("alert")).toContainText("Wrong passphrase");
  await expect(
    d.getByRole("button", { name: "Restore reviewed backup" }),
  ).not.toBeVisible();
  await d.getByRole("button", { name: "Preview restore" }).click();
  await expect(
    d.getByRole("button", { name: "Restore reviewed backup" }),
  ).toBeDisabled();
  await d.getByLabel(/Preserve my current branch/).check();
  await d
    .getByLabel("Recovery passphrase")
    .fill("changed synthetic passphrase");
  await expect(
    d.getByRole("button", { name: "Restore reviewed backup" }),
  ).not.toBeVisible();
  await d.getByRole("button", { name: "Preview restore" }).click();
  await d.getByLabel(/Preserve my current branch/).check();
  await page.evaluate(() => {
    (window as any).failRestore = true;
  });
  await d.getByRole("button", { name: "Restore reviewed backup" }).click();
  await expect(d.getByRole("alert")).toContainText("lost restore reply");
  await d.getByRole("button", { name: "Restore reviewed backup" }).click();
  await expect(d.getByRole("status")).toContainText("Restore completed");
  await expect(d.getByLabel("Recovery passphrase")).not.toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter(
      (c: any) => c.cmd === "managed_backup_restore",
    ),
  );
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.input.token).toBe("review-token");
});
test("folder controls and setup remain readable at laptop width in light and dark themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 820 });
  await setup(page, true);
  for (const theme of ["light", "dracula"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page
      .getByRole("heading", { name: "Folder backups", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.qa/managed-folder-${theme}.png` });
    await page
      .getByRole("button", { name: "Backup settings", exact: true })
      .click();
    const d = page.getByRole("dialog", { name: "Folder backup settings" });
    await expect(d).toBeVisible();
    await expect
      .poll(() => d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
      .toBeTruthy();
    await page.screenshot({ path: `.qa/managed-setup-${theme}.png` });
    await d.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("delayed folder status cannot cross workspace switches and status errors can retry", async ({
  page,
}) => {
  await setup(page, true);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.evaluate(() => {
    (window as any).holdStatus = true;
  });
  await page
    .getByRole("button", { name: "Workspace & backups", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).releaseStatus))
    .toBe("function");
  await page
    .getByRole("button", { name: /Personal workspace Personal records/ })
    .click();
  await page
    .getByRole("button", { name: "Workspace & backups", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Set up folder", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).releaseStatus();
  });
  await expect(
    page.getByRole("button", { name: "Save folder backup", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.evaluate(() => {
    (window as any).failStatus = true;
  });
  await page
    .getByRole("button", { name: "Workspace & backups", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("unavailable status");
  await page.evaluate(() => {
    (window as any).failStatus = false;
  });
  await page.getByRole("button", { name: "Reload backup status" }).click();
  await expect(page.getByRole("alert")).not.toBeVisible();
});
