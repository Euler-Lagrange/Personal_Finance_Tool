// Runs the built app as two PCs sharing one backup folder, closing each window the way a person would.
//   npm run closecheck
// PC one starts with made-up data and is closed: it must leave a backup and the phone glance page.
// PC two is a fresh install pointed at the same folder: it must come up holding PC one's data.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import electron from "electron";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "finance-close-"));
const folder = path.join(root, "shared-folder");
fs.mkdirSync(folder);
const linux = process.platform === "linux";
const args = [".", ...(linux ? ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [])];

function run(name, extra) {
  const dataDir = path.join(root, name);
  fs.mkdirSync(dataDir);
  const env = { ...process.env, FINANCE_DATA_DIR: dataDir, FINANCE_BACKUP_DIR: folder, FINANCE_DEVICE: name, FINANCE_CLOSE_AFTER: "5000", ...extra };
  delete env.NODE_OPTIONS;
  const result =
    linux && !process.env.DISPLAY
      ? spawnSync("xvfb-run", ["-a", "-s", "-screen 0 1600x1200x24", electron, ...args], { env, stdio: "ignore", timeout: 90_000 })
      : spawnSync(electron, args, { env, stdio: "ignore", timeout: 90_000 });
  return { dataDir, status: result.status };
}

const results = [];
const check = (step, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${ok ? "" : `  ${JSON.stringify(detail)}`}`);
};
const count = (file, table) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(`select count(*) n from ${table}`).get().n;
  } finally {
    db.close();
  }
};

const one = run("DeskPC", { FINANCE_DEMO: "1" });
const backups = fs.readdirSync(folder).filter((f) => /^finance-DeskPC-\d{8}-\d{6}\.db$/.test(f));
const glance = path.join(folder, "finance-glance.pdf");
const glanceBytes = fs.existsSync(glance) ? fs.readFileSync(glance) : Buffer.alloc(0);
check("closing the window quits the app cleanly", one.status === 0, one.status);
check("closing writes one backup to the folder", backups.length === 1, fs.readdirSync(folder));
check("closing writes the phone glance page", glanceBytes.subarray(0, 5).toString() === "%PDF-" && glanceBytes.length > 5000, glanceBytes.length);
const entries = backups.length === 1 ? count(path.join(folder, backups[0]), "entries") : 0;

const two = run("LaptopPC", {});
const laptopData = path.join(two.dataDir, "finance.db");
const local = fs.existsSync(path.join(two.dataDir, "local.json")) ? JSON.parse(fs.readFileSync(path.join(two.dataDir, "local.json"), "utf8")) : {};
check("a fresh install on the second PC opens and closes cleanly", two.status === 0, two.status);
check("the second PC comes up holding the first PC's data", entries > 0 && fs.existsSync(laptopData) && count(laptopData, "entries") === entries, [entries, local]);
check("the second PC remembers whose copy it holds", local.syncDevice === "DeskPC", local);
check(
  "the second PC, having changed nothing, leaves no copy of its own behind",
  fs.readdirSync(folder).filter((f) => f.startsWith("finance-LaptopPC-")).length === 0,
  fs.readdirSync(folder),
);

fs.rmSync(root, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
