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

const row = {
  id: "balance-1",
  revision: 2,
  accountId: "checking",
  date: "2026-10-31",
  balanceCents: 100000,
  purpose: "opening",
  note: "Statement balance",
};
async function setup(page: Page, history = false) {
  await page.addInitScript(
    ({ snapshot, row, history }) => {
      const w = window as any;
      w.isTauri = true;
      w.calls = [];
      w.fail = false;
      w.rows = history ? [row] : [];
      w.data = structuredClone(snapshot);
      if (history)
        w.data.accounts[0].balance = {
          checkpointDate: "2026-10-31",
          checkpointCents: 100000,
          knownChangeCents: -2500,
          estimatedCents: 97500,
          throughDate: "2026-11-03",
        };
      w.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          w.calls.push({ cmd, args });
          if (cmd === "snapshot")
            return { ...w.data, workspace: args.workspace, month: args.month };
          if (cmd === "bill_month") return [];
          if (cmd === "balance_checkpoints") return w.rows;
          if (cmd === "save_checkpoint" && w.fail)
            throw "A balance already exists for this date. Edit that checkpoint instead.";
          if (cmd === "save_account") {
            const a = w.data.accounts.find((a: any) => a.id === args.input.id);
            Object.assign(a, args.input, { revision: a.revision + 1 });
            if (a.trackingMode === "untracked") a.balance = null;
          }
        },
      };
    },
    { snapshot, row, history },
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Accounts & categories", exact: true })
    .click();
}
test("opening balance confirmation and retry send no income or expense", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Balances for Capital One 360", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("End-of-day date").fill("2026-10-31");
  await d.getByLabel("Confirmed balance ($)", { exact: true }).fill("-12.34");
  await d
    .getByRole("combobox", { name: "Balance purpose", exact: true })
    .selectOption("opening");
  await expect(
    d.getByRole("button", { name: "Save balance", exact: true }),
  ).toBeDisabled();
  await d.getByLabel("This balance includes all posted activity").check();
  await page.evaluate(() => {
    (window as any).fail = true;
  });
  await d.getByRole("button", { name: "Save balance", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("already exists");
  await expect(
    d.getByLabel("Confirmed balance ($)", { exact: true }),
  ).toHaveValue("-12.34");
  await page.evaluate(() => {
    (window as any).fail = false;
  });
  await d.getByRole("button", { name: "Save balance", exact: true }).click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).calls);
  expect(calls.filter((c: any) => c.cmd === "save_entry")).toHaveLength(0);
  const saves = calls.filter((c: any) => c.cmd === "save_checkpoint");
  expect(saves).toHaveLength(2);
  expect(saves[0].args.input).toEqual(saves[1].args.input);
  expect(saves[0].args.input).toMatchObject({
    accountId: "checking",
    date: "2026-10-31",
    purpose: "opening",
    amount: "-12.34",
  });
});
test("balance history protects unsaved forms and removal requires explicit confirmation", async ({
  page,
}) => {
  await setup(page, true);
  await page
    .getByRole("button", { name: "Balances for Capital One 360", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Confirmed balance ($)", { exact: true }).fill("900");
  await d
    .getByRole("button", { name: "Edit balance 2026-10-31", exact: true })
    .click();
  await expect(d.getByRole("alert")).toContainText("Save or clear");
  await expect(
    d.getByLabel("Confirmed balance ($)", { exact: true }),
  ).toHaveValue("900");
  await d.getByRole("button", { name: "Clear form", exact: true }).click();
  await d
    .getByRole("button", { name: "Edit balance 2026-10-31", exact: true })
    .click();
  await expect(
    d.getByLabel("Confirmed balance ($)", { exact: true }),
  ).toHaveValue("1000.00");
  await d.getByRole("button", { name: "Remove balance", exact: true }).click();
  await d.getByRole("button", { name: "Keep balance", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) =>
          ["save_checkpoint", "delete_checkpoint", "save_entry"].includes(
            c.cmd,
          ),
        ).length,
    ),
  ).toBe(0);
  await d.getByRole("button", { name: "Remove balance", exact: true }).click();
  await d
    .getByRole("button", { name: "Remove checkpoint", exact: true })
    .click();
  await expect(d).toHaveCount(0);
  const c = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.cmd === "delete_checkpoint"),
  );
  expect(c.args).toMatchObject({ id: "balance-1", revision: 2 });
});
test("owned untracked mode hides running balances and compact themed account views remain readable", async ({
  page,
}) => {
  await setup(page, true);
  await expect(page.getByText("$975.00", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.screenshot({ path: ".qa/accounts-Light.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Edit account Capital One 360", exact: true })
    .click();
  let d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "Tracking mode", exact: true })
    .selectOption("untracked");
  await d.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Not tracked", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("radio", { name: "Dracula", exact: true }).check();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Accounts & categories", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Balances for Capital One 360", exact: true })
    .click();
  d = page.getByRole("dialog");
  await expect(
    d.getByRole("button", { name: "Save balance", exact: true }),
  ).toBeDisabled();
  await expect(
    d.getByText("This owned account has no running balance", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: ".qa/balances-Dracula.png" });
});
