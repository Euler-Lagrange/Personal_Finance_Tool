import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Dev helper: visit each screen, save a picture of it, then quit. */
export async function takeShots(win: BrowserWindow, dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const routes = (process.env.FINANCE_SHOT_ROUTES ?? "dashboard,transactions,budget,split,pay,savings,settings").split(",");
  await wait(1200);
  for (const route of routes) {
    await win.webContents.executeJavaScript(`location.hash = "#/${route}"`);
    await wait(500);
    const height = (await win.webContents.executeJavaScript("Math.max(document.querySelector('.content')?.scrollHeight ?? 0, 0) + 90")) as number;
    win.setContentSize(1320, Math.min(Math.max(height, 880), 2400));
    await wait(350);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${process.env.FINANCE_SHOT_PREFIX ?? ""}${route}.png`), image.toPNG());
    win.setContentSize(1320, 880);
  }
  app.quit();
}

/**
 * Dev helper: drive the real window the way a person would (type, click, undo) and check the
 * stored data after each step. Writes a JSON report and exits non-zero on any failure.
 */
export async function runSmoke(win: BrowserWindow, reportFile: string): Promise<void> {
  const page = <T>(code: string) => win.webContents.executeJavaScript(`(async () => { ${HELPERS}\n${code} })()`) as Promise<T>;
  const results: { step: string; ok: boolean; detail?: unknown }[] = [];
  const finish = () => {
    fs.writeFileSync(reportFile, JSON.stringify(results, null, 2));
    app.exit(results.length > 0 && results.every((r) => r.ok) ? 0 : 1);
  };
  const check = (step: string, ok: boolean, detail?: unknown) => {
    results.push({ step, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${step}`);
  };
  // A stuck step must fail the run, not hang it.
  const watchdog = setTimeout(() => {
    check("smoke run finished in time", false, "timed out after 90 seconds");
    finish();
  }, 90_000);
  const month = new Date().toISOString().slice(0, 7);
  const find = `(await rpc("entries.list", { month: "${month}" })).find((e) => e.description === "Smoke test market")`;
  try {
    await wait(1200);
    await page(`location.hash = "#/transactions"; await sleep(500);
      const form = document.querySelector("form.quickadd");
      setValue(form.querySelector('input[placeholder="Corner Market"]'), "Smoke test market");
      setValue(form.querySelector('input[placeholder="0.00"]'), "25.00");
      form.requestSubmit(); await sleep(500);`);
    let e = await page<{ id: number; amount_cents: number; a_cents: number; b_cents: number } | undefined>(`return ${find};`);
    check("quick-add saves an entry with the default split", !!e && e.amount_cents === 2500 && e.a_cents === 1500 && e.b_cents === 1000, e);

    await page(`const row = rowOf("Smoke test market"); commit(row.querySelector('input[aria-label="Amount"]'), "30.00"); await sleep(500);`);
    e = await page(`return ${find};`);
    check("editing the amount in place recomputes both shares", !!e && e.amount_cents === 3000 && e.a_cents === 1800, e);

    await page(`const row = rowOf("Smoke test market"); const s = row.querySelector('select[aria-label="Paid by"]'); setValue(s, "b"); await sleep(500);`);
    const paid = await page<{ paid_by: string } | undefined>(`return ${find};`);
    check("changing who paid in place is saved", paid?.paid_by === "b", paid);

    await page(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Undo").click(); await sleep(500);`);
    const undone = await page<{ paid_by: string } | undefined>(`return ${find};`);
    check("the Undo button reverses the last change", undone?.paid_by === "a", undone);

    await page(`const row = rowOf("Smoke test market"); row.querySelector('input[type="checkbox"]').click(); await sleep(300);
      [...document.querySelectorAll(".bulkbar button")].find((b) => b.textContent.includes("Delete")).click(); await sleep(500);`);
    check("bulk delete removes the selected entry", (await page(`return ${find} ?? null;`)) === null);

    await page(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })); await sleep(600);`);
    e = await page(`return ${find};`);
    check("Ctrl+Z brings the deleted entry back", !!e && e.amount_cents === 3000, e);

    await page(`location.hash = "#/budget"; await sleep(600); commit(document.querySelector('input[aria-label="Planned for Groceries"]'), "500"); await sleep(500);`);
    const planned = await page<number>(`return (await rpc("budget.get", { month: "${month}", view: "a" })).rows.find((r) => r.name === "Groceries").planned;`);
    check("a planned amount typed on the Budget screen is saved", planned === 50000, planned);

    await page(`location.hash = "#/settings"; await sleep(600); [...document.querySelectorAll(".theme-chip")].find((b) => b.textContent.includes("Dracula")).click(); await sleep(500);`);
    const theme = await page<string>(`return document.documentElement.dataset.theme;`);
    check("picking a theme applies it", theme === "dracula", theme);

    await page(`location.hash = "#/dashboard"; await sleep(600); [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Settle up").click(); await sleep(300);
      [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Record").click(); await sleep(600);`);
    const balance = await page<number>(`return (await rpc("balance.get", {})).cents;`);
    check("Settle up clears the balance", balance === 0, balance);

    if (process.env.FINANCE_SMOKE_BACKUP_DIR) {
      const dir = JSON.stringify(process.env.FINANCE_SMOKE_BACKUP_DIR);
      await page(`await rpc("backup.setFolder", { folder: ${dir} }); location.hash = "#/settings"; await sleep(700);`);
      const first = await page<{ file: string }[]>(`return await rpc("backup.list");`);
      check("choosing a backup folder writes the first copy", first.length === 1, first);
      const before = await page<number>(`return (await rpc("entries.list", { month: "${month}" })).length;`);
      await page(`await rpc("entries.create", { date: "${month}-01", description: "Added after the backup", amount_cents: 999, kind: "expense", category_id: null, paid_by: "a" });`);
      await page(`window.confirm = () => true; location.hash = "#/dashboard"; await sleep(300); location.hash = "#/settings"; await sleep(700);
        [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Restore").click(); await sleep(900);`);
      const after = await page<{ description: string }[]>(`return await rpc("entries.list", { month: "${month}" });`);
      check("Restore puts the data back to the backup", after.length === before && !after.some((x) => x.description === "Added after the backup"), after.length);
      const bad = await page<string>(`try { await rpc("backup.setFolder", { folder: ${dir} + "-missing" }); return "accepted"; } catch (e) { return e.message; }`);
      const still = await page<{ folder: string }>(`return await rpc("backup.status");`);
      check("a folder that cannot be written is refused and the old one kept", bad.startsWith("That folder cannot be used") && still.folder === process.env.FINANCE_SMOKE_BACKUP_DIR, [bad, still.folder]);
    }
  } catch (error) {
    check("smoke run completed", false, String(error));
  }
  clearTimeout(watchdog);
  finish();
}

const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rpc = async (method, arg) => { const res = await window.finance.rpc(method, arg); if (!res.ok) throw new Error(res.error); return res.value; };
  const setValue = (el, value) => {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  };
  const commit = (el, value) => { setValue(el, value); el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); };
  const rowOf = (description) => [...document.querySelectorAll("table.edit tbody tr")].find((tr) => [...tr.querySelectorAll("input")].some((i) => i.value === description));
`;
