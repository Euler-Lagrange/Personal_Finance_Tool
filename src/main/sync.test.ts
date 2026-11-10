import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApi } from "./api";
import { restoreBackup, writeBackup } from "./backup";
import { MIGRATION_COUNT, openDb, type Db } from "./db";
import { decideSync, isPristine, markSeen, newestCandidate, readSeen, type Candidate, type SyncState } from "./sync";

let dir: string;
let folder: string;
const open: Db[] = [];

/** One PC: its own data file, the shared backup folder, and the little it remembers between runs. */
class Pc {
  db: Db;
  state: SyncState | null = null;
  backedUpRev: number | undefined;
  skipped: string | null = null;
  constructor(public device: string) {
    this.db = this.openData();
  }
  private get file() {
    return path.join(dir, `${this.device}.db`);
  }
  private openData() {
    const db = openDb(this.file);
    open.push(db);
    return db;
  }
  get api() {
    return createApi(this.db);
  }
  add(description: string) {
    this.api["entries.create"]({ date: "2026-12-01", description, amount_cents: 1000, kind: "expense", category_id: null, paid_by: "a" });
  }
  entries() {
    return this.api["entries.list"]({ month: "2026-12" }).map((e) => e.description).sort();
  }
  /** Closing the app: a backup is written when something changed. */
  backup(at: string) {
    const rev = this.api["meta.rev"]();
    if (rev === this.backedUpRev) return;
    const file = writeBackup(this.db, folder, this.device, new Date(at));
    this.backedUpRev = rev;
    this.state = { device: file.device, takenAt: file.takenAt };
  }
  decide() {
    const pristine = isPristine(this.db);
    return decideSync({
      candidate: newestCandidate(folder, this.device, pristine),
      state: this.state,
      dirty: this.backedUpRev !== this.api["meta.rev"](),
      pristine,
      skipped: this.skipped,
    });
  }
  /** Opening the app: do what the decision says, as the app does. Returns the decision taken. */
  start(answer: "use" | "keep" = "keep") {
    const decision = this.decide();
    if (decision.action === "none") return "none";
    if (decision.action === "ask" && answer === "keep") {
      this.skipped = decision.candidate.takenAt;
      return "kept";
    }
    this.db.close();
    restoreBackup(path.join(folder, decision.candidate.file), this.file, MIGRATION_COUNT, new Date("2026-12-31T00:00:00"));
    this.db = this.openData();
    markSeen(this.db, decision.candidate);
    this.backedUpRev = this.api["meta.rev"]();
    this.state = { device: decision.candidate.device, takenAt: decision.candidate.takenAt };
    return decision.action === "ask" ? "used" : "loaded";
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-sync-"));
  folder = path.join(dir, "OneDrive");
  fs.mkdirSync(folder);
});
afterEach(() => {
  for (const db of open.splice(0)) if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("two PCs sharing a backup folder", () => {
  it("hands the data back and forth when they are used one at a time", () => {
    const desk = new Pc("Desk");
    desk.add("From the desk");
    desk.backup("2026-12-01T20:00:00");
    // A fresh install on the laptop takes the desk's copy without asking.
    const lap = new Pc("Lap");
    expect(lap.start()).toBe("loaded");
    expect(lap.entries()).toEqual(["From the desk"]);
    expect(readSeen(lap.db)).toEqual({ Desk: "2026-12-01T20:00:00" });
    lap.add("From the laptop");
    lap.backup("2026-12-02T09:00:00");
    // The desk has no changes of its own, and the laptop's copy was built on the desk's.
    expect(desk.start()).toBe("loaded");
    expect(desk.entries()).toEqual(["From the desk", "From the laptop"]);
    desk.add("Desk again");
    desk.backup("2026-12-03T18:00:00");
    expect(lap.start()).toBe("loaded");
    expect(lap.entries()).toEqual(["Desk again", "From the desk", "From the laptop"]);
    // Nothing new on either side: nothing happens.
    expect(lap.start()).toBe("none");
    expect(desk.start()).toBe("none");
  });

  it("asks when both PCs changed without seeing each other, and remembers a no", () => {
    const desk = new Pc("Desk");
    desk.add("Shared start");
    desk.backup("2026-12-01T20:00:00");
    const lap = new Pc("Lap");
    lap.start();
    // Both add something before either sees the other's copy.
    desk.add("Only on the desk");
    desk.backup("2026-12-02T08:00:00");
    lap.add("Only on the laptop");
    lap.backup("2026-12-02T09:00:00");
    expect(desk.decide().action).toBe("ask");
    expect(desk.start("keep")).toBe("kept");
    expect(desk.entries()).toEqual(["Only on the desk", "Shared start"]);
    // The same copy is not offered twice.
    expect(desk.start()).toBe("none");
    // Choosing the other copy replaces this PC's data and keeps a safety copy of what was here.
    lap.add("More on the laptop");
    lap.backup("2026-12-02T12:00:00");
    expect(desk.start("use")).toBe("used");
    expect(desk.entries()).toEqual(["More on the laptop", "Only on the laptop", "Shared start"]);
    expect(fs.readdirSync(dir).some((f) => f.startsWith("before-restore-"))).toBe(true);
  });

  it("asks rather than loads when this PC has changes that were never backed up", () => {
    const desk = new Pc("Desk");
    desk.add("Start");
    desk.backup("2026-12-01T20:00:00");
    const lap = new Pc("Lap");
    lap.start();
    lap.add("Laptop work");
    lap.backup("2026-12-02T09:00:00");
    desk.add("Typed while the backup folder was away");
    expect(desk.decide().action).toBe("ask");
  });

  it("asks a PC that has data but has never been in step with the folder", () => {
    const desk = new Pc("Desk");
    desk.add("Desk data");
    desk.backup("2026-12-01T20:00:00");
    const lap = new Pc("Lap");
    lap.add("Typed before choosing the backup folder");
    expect(isPristine(lap.db)).toBe(false);
    expect(lap.decide().action).toBe("ask");
  });

  it("ignores its own backups, older copies and an empty folder", () => {
    const desk = new Pc("Desk");
    expect(desk.decide().action).toBe("none");
    desk.add("Desk data");
    desk.backup("2026-12-01T20:00:00");
    expect(desk.decide().action).toBe("none");
    // A reinstalled desk with nothing on it takes its own old backup.
    desk.db.close();
    fs.rmSync(path.join(dir, "Desk.db"));
    const fresh = new Pc("Desk");
    expect(fresh.start()).toBe("loaded");
    expect(fresh.entries()).toEqual(["Desk data"]);
  });
});

describe("the sync decision", () => {
  const candidate = (over: Partial<Candidate> = {}): Candidate => ({ file: "f.db", device: "Lap", takenAt: "2026-12-02T09:00:00", bytes: 1, seen: {}, ...over });
  const mine: SyncState = { device: "Desk", takenAt: "2026-12-01T20:00:00" };
  const base = { state: mine, dirty: false, pristine: false, skipped: null };

  it("loads only what was built on this PC's data", () => {
    expect(decideSync({ ...base, candidate: candidate({ seen: { Desk: "2026-12-01T20:00:00" } }) }).action).toBe("load");
    expect(decideSync({ ...base, candidate: candidate({ seen: { Desk: "2026-12-01T21:00:00" } }) }).action).toBe("load");
    expect(decideSync({ ...base, candidate: candidate({ seen: { Desk: "2026-11-30T20:00:00" } }) }).action).toBe("ask");
    expect(decideSync({ ...base, candidate: candidate() }).action).toBe("ask");
    expect(decideSync({ ...base, dirty: true, candidate: candidate({ seen: { Desk: "2026-12-01T20:00:00" } }) }).action).toBe("ask");
    // This PC last loaded the laptop's copy and changed nothing: a later laptop copy follows on from it.
    expect(decideSync({ ...base, state: { device: "Lap", takenAt: "2026-12-01T08:00:00" }, candidate: candidate() }).action).toBe("load");
  });

  it("does nothing without a newer copy", () => {
    expect(decideSync({ ...base, candidate: null }).action).toBe("none");
    expect(decideSync({ ...base, candidate: candidate({ takenAt: "2026-12-01T20:00:00" }) }).action).toBe("none");
    expect(decideSync({ ...base, candidate: candidate({ takenAt: "2026-11-01T00:00:00" }) }).action).toBe("none");
    expect(decideSync({ ...base, skipped: "2026-12-02T09:00:00", candidate: candidate() }).action).toBe("none");
    expect(decideSync({ ...base, state: null, pristine: true, candidate: candidate({ takenAt: "2020-01-01T00:00:00" }) }).action).toBe("load");
    // An empty PC that already wrote its own (empty) copy does not keep reloading it.
    expect(decideSync({ ...base, pristine: true, candidate: candidate({ device: "Desk", takenAt: "2026-12-01T20:00:00" }) }).action).toBe("none");
    expect(decideSync({ ...base, pristine: true, candidate: candidate() }).action).toBe("load");
  });
});
