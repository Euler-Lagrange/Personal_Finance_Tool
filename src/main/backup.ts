import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Db } from "./db";
import type { BackupFile } from "../shared/types";

const NAME = /^finance-(.+)-(\d{8})-(\d{6})\.db$/;
const pad = (n: number) => String(n).padStart(2, "0");

export const safeDevice = (device: string) => device.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "PC";

export function backupName(device: string, at: Date): string {
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `finance-${safeDevice(device)}-${day}-${time}.db`;
}

function parseName(file: string): { device: string; takenAt: string } | null {
  const m = NAME.exec(file);
  if (!m) return null;
  const [, device, d, t] = m;
  return { device, takenAt: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}` };
}

/** Writes a complete, consistent copy of the open database into `folder`. */
export function writeBackup(db: Db, folder: string, device: string, at: Date): BackupFile {
  // The folder is chosen through the system dialog, so it must already exist. If it has gone
  // (OneDrive paused, drive unplugged), say so instead of quietly creating it somewhere else.
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error("The backup folder does not exist");
  const file = backupName(device, at);
  const target = path.join(folder, file);
  if (fs.existsSync(target)) fs.rmSync(target);
  db.prepare("vacuum into ?").run(target);
  return { file, device: safeDevice(device), takenAt: parseName(file)!.takenAt, bytes: fs.statSync(target).size };
}

/** Every backup in the folder, newest first. Files with other names are ignored. */
export function listBackups(folder: string): BackupFile[] {
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .flatMap((file) => {
      const parsed = parseName(file);
      return parsed ? [{ file, ...parsed, bytes: fs.statSync(path.join(folder, file)).size }] : [];
    })
    .sort((x, y) => (x.takenAt < y.takenAt ? 1 : x.takenAt > y.takenAt ? -1 : 0));
}

/**
 * Keeps this PC's newest `keepLast` backups plus its newest backup of each month.
 * Never touches another PC's backups or files it does not recognise.
 */
export function pruneBackups(folder: string, device: string, keepLast = 30): string[] {
  const mine = listBackups(folder).filter((b) => b.device === safeDevice(device));
  const keep = new Set(mine.slice(0, keepLast).map((b) => b.file));
  const seenMonths = new Set<string>();
  for (const b of mine) {
    const month = b.takenAt.slice(0, 7);
    if (!seenMonths.has(month)) {
      seenMonths.add(month);
      keep.add(b.file);
    }
  }
  const removed = mine.filter((b) => !keep.has(b.file)).map((b) => b.file);
  for (const file of removed) fs.rmSync(path.join(folder, file));
  return removed;
}

/** Opens a backup read-only and confirms it is a healthy database this version can read. */
export function checkBackup(file: string, maxVersion: number): void {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const ok = (db.prepare("pragma integrity_check").get() as { integrity_check: string }).integrity_check;
    if (ok !== "ok") throw new Error("That backup file is damaged");
    const version = (db.prepare("pragma user_version").get() as { user_version: number }).user_version;
    if (version < 1) throw new Error("That file is not a backup from this app");
    if (version > maxVersion) throw new Error("That backup comes from a newer version of the app");
  } finally {
    db.close();
  }
}

/**
 * Replaces the live data file with a backup. The current data is kept beside it as
 * `before-restore-<time>.db`, so a restore can itself be reversed.
 */
export function restoreBackup(backupFile: string, dataFile: string, maxVersion: number, at: Date): string {
  checkBackup(backupFile, maxVersion);
  const stamp = backupName("x", at).slice("finance-x-".length, -3);
  const kept = path.join(path.dirname(dataFile), `before-restore-${stamp}.db`);
  if (fs.existsSync(dataFile)) fs.copyFileSync(dataFile, kept);
  fs.copyFileSync(backupFile, dataFile);
  return kept;
}
