import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { listBackups, safeDevice } from "./backup";
import type { BackupFile } from "../shared/types";

// Two PCs, used one at a time, share one backup folder. Each PC notices when the other has saved a
// newer copy. It loads that copy by itself only when doing so cannot lose anything; otherwise it asks.

/** The backup this PC's data last matched: one it wrote, or one it loaded. */
export interface SyncState {
  device: string;
  takenAt: string;
}

/** A backup that might be loaded, with the record inside it of which backups its data already includes. */
export interface Candidate extends BackupFile {
  seen: Record<string, string>;
}

export type SyncDecision = { action: "none" } | { action: "load" | "ask"; candidate: Candidate };

const SEEN_KEY = "sync.seen";

/** For each PC, the newest of its backups that this data file has taken in. Travels inside the file. */
export function readSeen(db: DatabaseSync): Record<string, string> {
  try {
    const row = db.prepare("select value from settings where key = ?").get(SEEN_KEY) as { value: string } | undefined;
    const parsed = row ? (JSON.parse(row.value) as unknown) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Notes that this data file now includes a backup. Not a change a person made, so it is not counted as one. */
export function markSeen(db: DatabaseSync, backup: Pick<BackupFile, "device" | "takenAt">): void {
  const seen = readSeen(db);
  if ((seen[backup.device] ?? "") >= backup.takenAt) return;
  db.prepare("insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value").run(SEEN_KEY, JSON.stringify({ ...seen, [backup.device]: backup.takenAt }));
}

/** True while nothing has been entered on this PC: a fresh install that can take any copy without losing anything. */
export function isPristine(db: DatabaseSync): boolean {
  return ["entries", "recurring", "funds", "pay_profiles", "budget_lines", "work_days"].every(
    (table) => (db.prepare(`select count(*) n from ${table}`).get() as { n: number }).n === 0,
  );
}

/** The newest backup in the folder that another PC wrote (or, for a fresh install, that any PC wrote). */
export function newestCandidate(folder: string, device: string, anyDevice: boolean): Candidate | null {
  const backup = listBackups(folder).find((b) => anyDevice || b.device !== safeDevice(device));
  if (!backup) return null;
  let seen: Record<string, string> = {};
  try {
    const db = new DatabaseSync(path.join(folder, backup.file), { readOnly: true });
    try {
      seen = readSeen(db);
    } finally {
      db.close();
    }
  } catch {
    // An unreadable file is caught properly when it is loaded. Here it only means "nothing known".
  }
  return { ...backup, seen };
}

/**
 * What to do about the other PC's newest copy.
 * - Nothing, when there is none, it is not newer than what this PC has, or the person already said no to it.
 * - Load it, when this PC is a fresh install, or when this PC has no changes of its own and the copy
 *   was built on top of what this PC has.
 * - Ask, when both PCs have changes the other does not include.
 */
export function decideSync(input: { candidate: Candidate | null; state: SyncState | null; dirty: boolean; pristine: boolean; skipped: string | null }): SyncDecision {
  const { candidate, state } = input;
  if (!candidate) return { action: "none" };
  if (state && candidate.takenAt <= state.takenAt) return { action: "none" };
  if (input.pristine) return { action: "load", candidate };
  if (candidate.takenAt === input.skipped) return { action: "none" };
  const builtOnOurs = state !== null && !input.dirty && (candidate.device === state.device || (candidate.seen[state.device] ?? "") >= state.takenAt);
  return { action: builtOnOurs ? "load" : "ask", candidate };
}
