import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATION_COUNT, openDb } from "./db";
import { createApi } from "./api";
import { backupName, listBackups, pruneBackups, pruneSafetyCopies, restoreBackup, writeBackup } from "./backup";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-backup-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const entry = { date: "2026-12-05", description: "Corner market", amount_cents: 4200, kind: "expense", category_id: null, paid_by: "a" } as const;

describe("backup", () => {
  it("writes a full copy that can be restored over later changes", () => {
    const dataFile = path.join(dir, "finance.db");
    const folder = path.join(dir, "OneDrive", "Backups");
    fs.mkdirSync(folder, { recursive: true });
    let db = openDb(dataFile);
    let api = createApi(db);
    api["entries.create"](entry);
    const backup = writeBackup(db, folder, "Desk PC", new Date(2026, 11, 5, 21, 41, 7));
    expect(backup.file).toBe("finance-Desk_PC-20261205-214107.db");
    expect(backup.bytes).toBeGreaterThan(0);

    api["entries.create"]({ ...entry, description: "Added after the backup" });
    expect(api["entries.list"]({ month: "2026-12" })).toHaveLength(2);
    db.close();

    const kept = restoreBackup(path.join(folder, backup.file), dataFile, MIGRATION_COUNT, new Date(2026, 11, 6, 8, 0, 0));
    db = openDb(dataFile);
    api = createApi(db);
    expect(api["entries.list"]({ month: "2026-12" }).map((e) => e.description)).toEqual(["Corner market"]);
    expect(fs.existsSync(kept)).toBe(true);
    db.close();
  });

  it("reports a backup folder that has gone missing instead of creating it", () => {
    const db = openDb(path.join(dir, "finance.db"));
    const missing = path.join(dir, "unplugged", "Backups");
    expect(() => writeBackup(db, missing, "Desk", new Date())).toThrow("does not exist");
    expect(fs.existsSync(missing)).toBe(false);
    db.close();
  });

  it("refuses a file that is not a backup and leaves the data alone", () => {
    const dataFile = path.join(dir, "finance.db");
    openDb(dataFile).close();
    const before = fs.readFileSync(dataFile);
    const junk = path.join(dir, "finance-Desk-20261205-000000.db");
    fs.writeFileSync(junk, "not a database");
    expect(() => restoreBackup(junk, dataFile, MIGRATION_COUNT, new Date())).toThrow();
    expect(fs.readFileSync(dataFile).equals(before)).toBe(true);
  });

  it("keeps the newest 30 plus one per month, and only prunes this PC's files", () => {
    const folder = path.join(dir, "Backups");
    fs.mkdirSync(folder);
    const touch = (device: string, at: Date) => fs.writeFileSync(path.join(folder, backupName(device, at)), "x");
    for (let day = 1; day <= 28; day++) touch("Desk", new Date(2026, 9, day, 20, 0, 0));
    for (let day = 1; day <= 28; day++) touch("Desk", new Date(2026, 10, day, 20, 0, 0));
    touch("Laptop", new Date(2026, 8, 1, 9, 0, 0));
    fs.writeFileSync(path.join(folder, "notes.txt"), "mine");

    const removed = pruneBackups(folder, "Desk", 30);
    const left = listBackups(folder);
    expect(removed).toHaveLength(56 - 30);
    expect(left.filter((b) => b.device === "Desk")).toHaveLength(30);
    expect(left[0].file).toBe("finance-Desk-20261128-200000.db");
    expect(left.some((b) => b.file === "finance-Desk-20261028-200000.db")).toBe(true);
    expect(left.some((b) => b.device === "Laptop")).toBe(true);
    expect(fs.existsSync(path.join(folder, "notes.txt"))).toBe(true);
  });

  it("keeps only the newest few safety copies and leaves every other file alone", () => {
    const names = Array.from({ length: 11 }, (_, i) => `before-restore-202612${String(i + 10).padStart(2, "0")}-080000.db`);
    for (const name of [...names, "finance.db", "local.json", "before-restore-notes.txt"]) fs.writeFileSync(path.join(dir, name), "x");
    expect(pruneSafetyCopies(dir).sort()).toEqual(names.slice(0, 3));
    expect(fs.readdirSync(dir).sort()).toEqual([...names.slice(3), "before-restore-notes.txt", "finance.db", "local.json"].sort());
    expect(pruneSafetyCopies(dir)).toEqual([]);
  });
});
