// Launches the built app against a scratch folder with made-up data.
//   npm run shots [-- theme]   saves a picture of every screen into shots/
//   npm run smoke              drives the window like a person and checks the stored data
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import electron from "electron";

const smoke = process.argv[2] === "--smoke";
const theme = (!smoke && process.argv[2]) || "slate";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-shots-"));
const env = { ...process.env, FINANCE_DATA_DIR: dataDir, FINANCE_DEMO: "1", FINANCE_THEME: theme };
const report = path.join(dataDir, "smoke.json");
if (smoke) {
  fs.mkdirSync(path.join(dataDir, "backups"));
  Object.assign(env, { FINANCE_SMOKE: report, FINANCE_SMOKE_BACKUP_DIR: path.join(dataDir, "backups") });
}
else Object.assign(env, { FINANCE_SHOTS: path.resolve("shots"), FINANCE_SHOT_PREFIX: theme === "slate" ? "" : `${theme}-` });
delete env.NODE_OPTIONS;
const linux = process.platform === "linux";
const args = [".", ...(linux ? ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [])];
const result = linux && !process.env.DISPLAY
  ? spawnSync("xvfb-run", ["-a", "-s", "-screen 0 1600x2600x24", electron, ...args], { env, stdio: "inherit" })
  : spawnSync(electron, args, { env, stdio: "inherit" });
if (smoke && fs.existsSync(report)) {
  const failed = JSON.parse(fs.readFileSync(report, "utf8")).filter((r) => !r.ok);
  for (const r of failed) console.log(`DETAIL  ${r.step}: ${JSON.stringify(r.detail)}`);
} else if (smoke) {
  console.log("FAIL  the app exited without writing a smoke report");
}
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(result.status ?? 1);
