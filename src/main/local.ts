import fs from "node:fs";
import os from "node:os";
import type { LocalConfig } from "../shared/types";

/** Per-PC settings (theme, backup folder). Kept beside the data file, never inside it. */
export function readLocal(file: string): LocalConfig & {
  lastBackupRev?: number;
  lastBackupAt?: string | null;
  /** The backup this PC's data last matched: one it wrote, or one it loaded from the other PC. */
  syncDevice?: string;
  syncTakenAt?: string;
  /** A newer copy from the other PC that the person chose not to use. */
  syncSkipped?: string;
} {
  const defaults = { theme: "slate", backupFolder: null, device: os.hostname() || "PC" };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return defaults;
  }
}

export function writeLocal(file: string, config: object): void {
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}
