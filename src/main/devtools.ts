import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupName, listBackups } from "./backup";
import { markSeen } from "./sync";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pictures of a screen in a second state: the screen's route, a dash, then a name. */
const VARIANTS: Record<string, string> = {
  "budget-year": `[...document.querySelectorAll(".toolbar .segmented button")].find((b) => b.textContent.trim().startsWith("All of")).click()`,
  "pay-settings": `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Pay settings").click()`,
  "pay-fixed": `[...document.querySelectorAll(".toolbar .segmented button")][1].click()`,
};

/** Dev helper: visit each screen, save a picture of it, then quit. */
export async function takeShots(win: BrowserWindow, dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const routes = (process.env.FINANCE_SHOT_ROUTES ?? "dashboard,transactions,budget,budget-year,split,pay,pay-settings,pay-fixed,savings,settings").split(",");
  await wait(1200);
  for (const route of routes) {
    await win.webContents.executeJavaScript(`location.hash = "#/${route.split("-")[0]}"`);
    await wait(500);
    if (VARIANTS[route]) {
      await win.webContents.executeJavaScript(VARIANTS[route]);
      await wait(600);
    }
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
    check("smoke run finished in time", false, "timed out after 180 seconds");
    finish();
  }, 180_000);
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

    await page(`location.hash = "#/split"; await sleep(700);
      const form = document.querySelector("form.add-bill");
      setValue(form.querySelector('input[placeholder="Electric"]'), "Smoke gym");
      setValue(form.querySelector('input[placeholder="varies"]'), "40");
      setValue(form.querySelectorAll("input")[2], "15");
      form.requestSubmit(); await sleep(600);`);
    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const findBill = `(await rpc("bills.list", { month: "${todayISO.slice(0, 7)}", today: "${todayISO}" })).rows.find((r) => r.name === "Smoke gym")`;
    let b = await page<{ entry: { date: string; amount_cents: number; a_cents: number; seen_in_bank: boolean } | null } | undefined>(`return ${findBill};`);
    check("adding a bill creates this month's entry on its due day", !!b?.entry && b.entry.amount_cents === 4000 && b.entry.a_cents === 2400 && b.entry.date.endsWith("-15"), b);

    await page(`const row = rowOf("Smoke gym"); row.querySelector('input[type="checkbox"]').click(); await sleep(400);
      commit(rowOf("Smoke gym").querySelector('input[aria-label="Smoke gym this month"]'), "45.50"); await sleep(500);`);
    b = await page(`return ${findBill};`);
    check("ticking Paid and changing this month's amount are saved", !!b?.entry && b.entry.seen_in_bank && b.entry.amount_cents === 4550, b);

    // ---- pay: the demo household has Alex paid by the hour and Sam on a fixed paycheck ----
    const payMonth = `(await rpc("pay.month", { person: "a", month: "${todayISO.slice(0, 7)}" }))`;
    await page(`location.hash = "#/pay"; await sleep(900);
      commit(document.querySelector(".cal-day:not(.out) .cal-hours"), "9.5"); await sleep(500);
      setValue(document.querySelector(".cal-day:not(.out) select.cal-tag"), "sick"); await sleep(500);`);
    const day = await page<{ hours: number; tag: string } | undefined>(`return ${payMonth}.days.find((d) => d.date === "${todayISO.slice(0, 7)}-01");`);
    check("hours and a sick tag typed in the calendar are saved", day?.hours === 9.5 && day.tag === "sick", day);

    await page(`const rows = document.querySelectorAll("table.paychecks tbody tr");
      commit(rows[rows.length - 1].querySelector('input[aria-label^="Real take-home"]'), "2100.00"); await sleep(600);`);
    let lastCheck = await page<{ id: number | null; actual_net_cents: number | null }>(`return ${payMonth}.paychecks.at(-1);`);
    check("a real take-home typed on a paycheck is stored", lastCheck.actual_net_cents === 210000 && lastCheck.id !== null, lastCheck);
    await page(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Undo").click(); await sleep(600);`);
    lastCheck = await page(`return ${payMonth}.paychecks.at(-1);`);
    check("undo hands that paycheck back to the schedule", lastCheck.actual_net_cents === null && lastCheck.id === null, lastCheck);

    await page(`setValue(document.querySelector(".whatif-hours input"), "90"); await sleep(700);`);
    const whatIf = await page<string>(`return document.querySelector("ul.whatif")?.textContent ?? "";`);
    check("the what-if works out pay for the hours typed", whatIf.includes("$4,320.00") && whatIf.includes("Take-home$"), whatIf);

    await page(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Plan $")).click(); await sleep(700);`);
    const income = await page<{ expected_cents: number; planned_cents: number }>(`return ${payMonth}.income;`);
    check("planning income from the paychecks sets the budget", income.expected_cents > 0 && income.planned_cents === income.expected_cents, income);

    await page(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Pay settings").click(); await sleep(500);
      const form = document.querySelector(".pay-settings form");
      setValue(form.querySelector('input[inputmode="decimal"]'), "50.00"); form.requestSubmit(); await sleep(800);`);
    const profile = await page<{ current: { rate_cents: number }; rates: unknown[]; schedule: { history: unknown[] } }>(`return await rpc("pay.profile", { person: "a" });`);
    check("a rate corrected in Pay settings is saved and keeps the known paychecks", profile.current.rate_cents === 5000 && profile.rates.length === 1 && profile.schedule.history.length === 10, profile.current);

    await page(`[...document.querySelectorAll(".toolbar .segmented button")].find((b) => b.textContent.trim() === "Sam").click(); await sleep(800);`);
    const fixed = await page<{ heads: string[]; calendar: boolean; rows: number }>(
      `return { heads: [...document.querySelectorAll("table.paychecks thead th")].map((th) => th.textContent.trim()), calendar: !!document.querySelector(".cal"), rows: document.querySelectorAll("table.paychecks tbody tr").length };`,
    );
    check("someone on a fixed paycheck gets paydays and no hours calendar", fixed.heads.includes("Expected") && !fixed.heads.includes("Hours") && !fixed.calendar && fixed.rows >= 2, fixed);

    // ---- savings ----
    const fundNamed = (name: string) => `(await rpc("funds.list", { month: "${todayISO.slice(0, 7)}" })).funds.find((f) => f.name === "${name}")`;
    await page(`location.hash = "#/savings"; await sleep(900);
      const form = document.querySelector("form.add-fund");
      setValue(form.querySelector('input[placeholder="Emergency fund"]'), "Smoke fund");
      setValue(form.querySelector('input[placeholder="0.00"]'), "500");
      form.requestSubmit(); await sleep(700);`);
    let smokeFund = await page<{ id: number; balance_cents: number } | undefined>(`return ${fundNamed("Smoke fund")};`);
    check("a fund added on the Savings screen starts at the balance typed", smokeFund?.balance_cents === 50000, smokeFund);
    await page(`commit(document.querySelector('input[aria-label="Balance of Smoke fund"]'), "620.00"); await sleep(600);`);
    smokeFund = await page(`return ${fundNamed("Smoke fund")};`);
    check("typing a fund's balance trues it up", smokeFund?.balance_cents === 62000, smokeFund);

    await page(`location.hash = "#/transactions"; await sleep(800);
      const select = rowOf("Smoke test market").querySelector('select[aria-label="Paid from"]');
      setValue(select, [...select.options].find((o) => o.textContent === "Smoke fund").value); await sleep(700);`);
    const fromFund = await page<{ from_fund: boolean } | undefined>(`return ${find};`);
    smokeFund = await page(`return ${fundNamed("Smoke fund")};`);
    check("a purchase marked as paid from a fund draws the fund down", fromFund?.from_fund === true && smokeFund?.balance_cents === 59000, [fromFund, smokeFund]);

    await page(`location.hash = "#/savings"; await sleep(900);
      const form = document.querySelector("form.add-renewal");
      setValue(form.querySelector('input[placeholder="Car registration"]'), "Smoke renewal");
      setValue(form.querySelector('input[placeholder="0.00"]'), "120");
      form.requestSubmit(); await sleep(900);`);
    const renewed = await page<{ next_date: string; amount_cents: number } | undefined>(`return (await rpc("renewals.list", { today: "${todayISO}" })).rows.find((r) => r.name === "Smoke renewal");`);
    const renewalEntry = await page<{ amount_cents: number } | undefined>(`return (await rpc("entries.list", { month: "${todayISO.slice(0, 7)}" })).find((e) => e.description === "Smoke renewal");`);
    check(
      "a renewal due today becomes an entry and moves on a year",
      renewed?.next_date === `${Number(todayISO.slice(0, 4)) + 1}${todayISO.slice(4)}` && renewalEntry?.amount_cents === 12000,
      [renewed, renewalEntry],
    );

    // ---- the year and export ----
    await page(`location.hash = "#/budget"; await sleep(700);
      [...document.querySelectorAll(".toolbar .segmented button")].find((b) => b.textContent.trim().startsWith("All of")).click(); await sleep(800);`);
    const yearTable = await page<{ heads: number; rows: number; merchants: number }>(
      `return { heads: document.querySelectorAll("table.year thead tr")[0]?.children.length ?? 0, rows: document.querySelectorAll("table.year tbody tr").length, merchants: document.querySelectorAll(".merchants li").length };`,
    );
    check("the year view shows twelve months, a total and an average per category", yearTable.heads === 15 && yearTable.rows > 5 && yearTable.merchants > 3, yearTable);
    const workbook = path.join(path.dirname(reportFile), "export.xlsx");
    const csvFile = path.join(path.dirname(reportFile), "export.csv");
    await page(`await rpc("export.write", { scope: "year", month: "${todayISO.slice(0, 7)}", format: "xlsx", file: ${JSON.stringify(workbook)} });
      await rpc("export.write", { scope: "month", month: "${todayISO.slice(0, 7)}", format: "csv", file: ${JSON.stringify(csvFile)} });`);
    const xlsxBytes = fs.existsSync(workbook) ? fs.readFileSync(workbook) : Buffer.alloc(0);
    const csvText = fs.existsSync(csvFile) ? fs.readFileSync(csvFile, "utf8") : "";
    check(
      "a year exports to an Excel workbook and a month to CSV",
      xlsxBytes.subarray(0, 2).toString() === "PK" && xlsxBytes.length > 3000 && csvText.startsWith("\ufeffDate,Description,Category") && csvText.includes("Smoke test market"),
      [xlsxBytes.length, csvText.slice(0, 60)],
    );
    if (process.env.FINANCE_SMOKE_KEEP_XLSX) fs.copyFileSync(workbook, process.env.FINANCE_SMOKE_KEEP_XLSX);

    // ---- rollover and the phone glance page ----
    const rollButton = `document.querySelector('button[aria-label="Roll Dining out over to the next month"]')`;
    await page(`location.hash = "#/dashboard"; await sleep(300); location.hash = "#/budget"; await sleep(800); ${rollButton}.click(); await sleep(600);`);
    const dining = await page<{ rollover_from: string | null } | undefined>(`return (await rpc("categories.list")).find((c) => c.name === "Dining out");`);
    const pressed = await page<string | null>(`return ${rollButton}.getAttribute("aria-pressed");`);
    check("a category switched to roll over starts with the month on screen", dining?.rollover_from === todayISO.slice(0, 7) && pressed === "true", [dining, pressed]);
    const glance = path.join(path.dirname(reportFile), "glance.pdf");
    await page(`await rpc("glance.write", { file: ${JSON.stringify(glance)} });`);
    const glanceBytes = fs.existsSync(glance) ? fs.readFileSync(glance) : Buffer.alloc(0);
    check("the phone glance page is written as a PDF", glanceBytes.subarray(0, 5).toString() === "%PDF-" && glanceBytes.length > 5000, glanceBytes.length);
    if (process.env.FINANCE_SMOKE_KEEP_GLANCE) fs.copyFileSync(glance, process.env.FINANCE_SMOKE_KEEP_GLANCE);

    const pdf = path.join(path.dirname(reportFile), "statement.pdf");
    await page(`await rpc("statement.write", { month: "${todayISO.slice(0, 7)}", person: "b", file: ${JSON.stringify(pdf)} });`);
    const bytes = fs.existsSync(pdf) ? fs.readFileSync(pdf) : Buffer.alloc(0);
    check("the statement is written as a PDF", bytes.subarray(0, 5).toString() === "%PDF-" && bytes.length > 5000, bytes.length);
    if (process.env.FINANCE_SMOKE_KEEP_PDF) fs.copyFileSync(pdf, process.env.FINANCE_SMOKE_KEEP_PDF);

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

      // ---- the other PC: plant copies in the folder as another PC would have left them ----
      const folder = process.env.FINANCE_SMOKE_BACKUP_DIR;
      await page(`await rpc("backup.now");`);
      const here = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "local.json"), "utf8")) as { syncDevice: string; syncTakenAt: string };
      const plant = (device: string, hoursAhead: number, description: string, builtOnOurs: boolean) => {
        const file = path.join(folder, backupName(device, new Date(Date.now() + hoursAhead * 3600_000)));
        fs.copyFileSync(path.join(folder, listBackups(folder).find((b) => b.device === here.syncDevice)!.file), file);
        const copy = new DatabaseSync(file);
        copy.prepare("update entries set description = ? where description = 'Smoke test market'").run(description);
        if (builtOnOurs) markSeen(copy, { device: here.syncDevice, takenAt: here.syncTakenAt });
        copy.close();
      };
      plant("OtherPC", 30, "From the other PC", true);
      const loaded = await page<string | null>(`return await rpc("sync.check");`);
      const taken = await page<{ description: string }[]>(`return await rpc("entries.list", { month: "${month}" });`);
      check(
        "a newer copy from the other PC, built on this PC's data, is loaded without asking",
        (loaded ?? "").startsWith("Loaded the copy OtherPC") && taken.some((e) => e.description === "From the other PC") && taken.length === after.length,
        loaded,
      );
      // A copy that does not include this PC's data needs the person's say-so, so nothing happens by itself.
      plant("ThirdPC", 60, "Should not be loaded", false);
      const held = await page<string | null>(`return await rpc("sync.check");`);
      const kept = await page<{ description: string }[]>(`return await rpc("entries.list", { month: "${month}" });`);
      check("a copy that was not built on this PC's data is never loaded by itself", held === null && kept.some((e) => e.description === "From the other PC") && !kept.some((e) => e.description === "Should not be loaded"), held);
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
