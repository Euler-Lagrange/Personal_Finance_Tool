// Development mode: hot-reloading screens, with the real main process.
//   npm run dev            uses your real data file
//   npm run dev -- --demo  uses a scratch folder with made-up data
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import electron from "electron";
import { createServer } from "vite";

await import("./build-main.mjs");
const server = await createServer({ configFile: "vite.config.mts" });
await server.listen();
const url = server.resolvedUrls.local[0];

const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.NODE_OPTIONS;
let scratch = null;
if (process.argv.includes("--demo")) {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "finance-dev-"));
  Object.assign(env, { FINANCE_DATA_DIR: scratch, FINANCE_DEMO: "1" });
}
const linux = process.platform === "linux";
const child = spawn(electron, [".", ...(linux ? ["--no-sandbox"] : [])], { env, stdio: "inherit" });
child.on("exit", async (code) => {
  await server.close();
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(code ?? 0);
});
