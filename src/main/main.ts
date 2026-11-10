import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createApi, UserError, type CoreApi } from "./api";
import { listBackups, pruneBackups, restoreBackup, writeBackup } from "./backup";
import { MIGRATION_COUNT, openDb, type Db } from "./db";
import { loadDemo } from "./demo";
import { toXlsx } from "./export";
import { decideSync, isPristine, markSeen, newestCandidate } from "./sync";
import { glanceHtml } from "../core/glance";
import { toCsv } from "../core/csv";
import type { ExportRequest } from "../shared/types";
import { runSmoke, takeShots } from "./devtools";
import { readLocal, writeLocal } from "./local";
import { monthLabel } from "../core/dates";
import type { Person } from "../core/split";
import { statementHtml } from "../core/statement";
import type { BackupFile, BackupStatus, LocalConfig, SetupFile } from "../shared/types";

// Tests, screenshots and demos point the app at a scratch folder so they never touch real data.
if (process.env.FINANCE_DATA_DIR) app.setPath("userData", path.resolve(process.env.FINANCE_DATA_DIR));

const BACKUP_EVERY_MS = 10 * 60 * 1000;

let db: Db;
let core: CoreApi;
let win: BrowserWindow | null = null;
let lastError: string | null = null;
/** Something the window should tell the person once, such as data having been loaded from the other PC. */
let notice: string | null = null;
let lastSyncCheck = 0;

/** Automated runs must never stop on a question nobody is there to answer. */
const unattended = () => Boolean(process.env.FINANCE_SMOKE || process.env.FINANCE_SHOTS);
const GLANCE_FILE = "finance-glance.pdf";

const dataFile = () => path.join(app.getPath("userData"), "finance.db");
const localFile = () => path.join(app.getPath("userData"), "local.json");
const local = () => readLocal(localFile());
const saveLocal = (patch: object) => writeLocal(localFile(), { ...local(), ...patch });

function openData() {
  db = openDb(dataFile());
  core = createApi(db);
}

/** Copies the data file to the backup folder when something changed since the last copy. */
function backupIfChanged(force = false): BackupFile | null {
  const config = local();
  if (!config.backupFolder) return null;
  const rev = core["meta.rev"]();
  if (!force && config.lastBackupRev === rev) return null;
  try {
    const now = new Date();
    const file = writeBackup(db, config.backupFolder, config.device, now);
    pruneBackups(config.backupFolder, config.device);
    // A copy written with nothing changed is the same data as before, so it does not move the sync point.
    const moved = config.lastBackupRev !== rev || !config.syncTakenAt;
    saveLocal({ lastBackupRev: rev, lastBackupAt: now.toISOString(), ...(moved ? { syncDevice: file.device, syncTakenAt: file.takenAt } : {}) });
    lastError = null;
    return file;
  } catch (error) {
    lastError = `Backup failed: ${(error as Error).message}`;
    return null;
  }
}

/**
 * Looks in the backup folder for a newer copy saved by the other PC. It is loaded straight away when
 * that cannot lose anything; when both PCs have changes, the person chooses. Returns what was loaded.
 */
function syncFromOtherPc(): string | null {
  const config = local();
  if (!config.backupFolder || !db?.isOpen) return null;
  lastSyncCheck = Date.now();
  let decision;
  try {
    const pristine = isPristine(db);
    decision = decideSync({
      candidate: newestCandidate(config.backupFolder, config.device, pristine),
      state: config.syncDevice && config.syncTakenAt ? { device: config.syncDevice, takenAt: config.syncTakenAt } : null,
      dirty: config.lastBackupRev !== core["meta.rev"](),
      pristine,
      skipped: config.syncSkipped ?? null,
    });
  } catch {
    return null;
  }
  if (decision.action === "none") return null;
  const { candidate } = decision;
  const when = new Date(candidate.takenAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (decision.action === "ask") {
    if (unattended()) return null;
    const choice = dialog.showMessageBoxSync({
      type: "question",
      title: "Two copies of your data",
      message: `${candidate.device} saved a newer copy on ${when}, and this PC has changes that copy does not include.`,
      detail: `Using ${candidate.device}'s copy replaces what is on this PC. A safety copy of this PC's data is kept beside the data file. Keeping this PC's data leaves the other copy in the backup folder, where Settings can still restore it.`,
      buttons: [`Use ${candidate.device}'s copy`, "Keep this PC's data"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (choice !== 0) {
      saveLocal({ syncSkipped: candidate.takenAt });
      return null;
    }
  }
  db.close();
  try {
    restoreBackup(path.join(config.backupFolder, candidate.file), dataFile(), MIGRATION_COUNT, new Date());
  } catch (error) {
    openData();
    lastError = `The newer copy from ${candidate.device} could not be loaded: ${(error as Error).message}`;
    return null;
  }
  openData();
  markSeen(db, candidate);
  saveLocal({ syncDevice: candidate.device, syncTakenAt: candidate.takenAt, syncSkipped: undefined, lastBackupRev: core["meta.rev"]() });
  return `Loaded the copy ${candidate.device} saved on ${when}`;
}

/** Writes the phone glance page beside the backups. It is a convenience, so a failure is never an error. */
async function writeGlance(file: string): Promise<string> {
  const html = glanceHtml(core["glance.data"]());
  const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // A tall, narrow page reads on a phone without zooming.
    fs.writeFileSync(file, await page.webContents.printToPDF({ printBackground: true, pageSize: { width: 4.4, height: 9.4 }, margins: { top: 0.22, bottom: 0.22, left: 0, right: 0 } }));
    return file;
  } finally {
    page.destroy();
  }
}
const refreshGlance = (): Promise<unknown> => {
  const folder = local().backupFolder;
  return folder && !unattended() ? writeGlance(path.join(folder, GLANCE_FILE)).catch(() => undefined) : Promise.resolve();
};

/** Points backups at a folder and writes the first copy straight away, so a bad folder is reported now. */
function setBackupFolder(folder: string): string {
  const previous = local().backupFolder;
  saveLocal({ backupFolder: folder, lastBackupRev: undefined });
  // A fresh install pointed at a folder the other PC already uses takes that PC's data first,
  // so its own empty copy never becomes the newest thing in the folder.
  const loaded = fs.existsSync(folder) && isPristine(db) ? syncFromOtherPc() : null;
  if (loaded) {
    // The folder plainly works, and this PC now holds exactly what was in it: nothing to write yet.
    notice = loaded;
    return folder;
  }
  backupIfChanged(true);
  if (lastError) {
    const message = lastError;
    saveLocal({ backupFolder: previous });
    lastError = null;
    throw new UserError(`That folder cannot be used. ${message}`);
  }
  return folder;
}

/** Writes a month or year as an Excel workbook, or its transactions as CSV (with a mark so Excel reads accents correctly). */
function writeExport(args: ExportRequest & { format: "xlsx" | "csv" }, file: string): string {
  const { sheets } = core["export.tables"](args);
  fs.writeFileSync(file, args.format === "xlsx" ? toXlsx(sheets) : `\ufeff${toCsv(sheets[0].rows)}`);
  return file;
}

/** Renders one person's statement for a month and writes it as a PDF. */
async function writeStatement(month: string, person: Person, file: string): Promise<string> {
  const html = statementHtml(core["statement.data"]({ month, person }));
  const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    fs.writeFileSync(file, await page.webContents.printToPDF({ printBackground: true, pageSize: "Letter" }));
    return file;
  } finally {
    page.destroy();
  }
}

function createShellApi() {
  return {
    "local.get": (): LocalConfig => {
      const { theme, backupFolder, device } = local();
      return { theme, backupFolder, device };
    },
    "local.setTheme": (args: { theme: string }): void => saveLocal({ theme: args.theme }),
    "app.info": () => ({ version: app.getVersion(), dataFile: dataFile() }),
    /** Hands over, once, anything the window should tell the person. */
    "app.notice": (): string | null => {
      const message = notice;
      notice = null;
      return message;
    },

    "backup.status": (): BackupStatus => {
      const config = local();
      return { folder: config.backupFolder, device: config.device, lastBackupAt: config.lastBackupAt ?? null, lastError, dataFile: dataFile() };
    },
    "backup.chooseFolder": async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog(win!, {
        title: "Choose a backup folder",
        message: "Pick a folder inside OneDrive so backups reach your other PC",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return setBackupFolder(result.filePaths[0]);
    },
    "backup.setFolder": (args: { folder: string }): string => setBackupFolder(args.folder),
    "backup.now": (): BackupFile => {
      if (!local().backupFolder) throw new UserError("Choose a backup folder first");
      const file = backupIfChanged(true);
      if (!file) throw new UserError(lastError ?? "The backup could not be written");
      void refreshGlance();
      return file;
    },
    "backup.list": (): BackupFile[] => {
      const folder = local().backupFolder;
      return folder ? listBackups(folder) : [];
    },
    "backup.restore": (args: { file: string }): { kept: string } => {
      const folder = local().backupFolder;
      if (!folder) throw new UserError("Choose a backup folder first");
      const source = path.join(folder, path.basename(args.file));
      if (!fs.existsSync(source)) throw new UserError("That backup is no longer in the folder");
      db.close();
      try {
        const kept = restoreBackup(source, dataFile(), MIGRATION_COUNT, new Date());
        return { kept };
      } catch (error) {
        throw new UserError((error as Error).message);
      } finally {
        openData();
        saveLocal({ lastBackupRev: undefined });
      }
    },
    "backup.openFolder": (): void => {
      const folder = local().backupFolder;
      if (folder) void shell.openPath(folder);
    },

    "statement.save": async (args: { month: string; person: Person }): Promise<string | null> => {
      const name = core["settings.get"]().people[args.person];
      const config = local() as { statementFolder?: string };
      const fileName = `${name} statement ${monthLabel(args.month)}.pdf`.replace(/[\\/:*?"<>|]/g, "");
      const result = await dialog.showSaveDialog(win!, {
        title: "Save the statement",
        defaultPath: path.join(config.statementFolder ?? app.getPath("documents"), fileName),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (result.canceled || !result.filePath) return null;
      saveLocal({ statementFolder: path.dirname(result.filePath) });
      return writeStatement(args.month, args.person, result.filePath);
    },
    // Used by the smoke test only: it plants a copy "from another PC" and checks that it is taken in.
    "sync.check": (): string | null => {
      if (!process.env.FINANCE_SMOKE) throw new UserError("The other PC's copies are checked when the app starts");
      return syncFromOtherPc();
    },
    "glance.write": (args: { file: string }): Promise<string> => {
      if (!process.env.FINANCE_SMOKE) throw new UserError("The glance page is saved with the backups");
      return writeGlance(args.file);
    },
    // Used by the smoke test only: a screen never chooses where a file is written.
    "statement.write": (args: { month: string; person: Person; file: string }): Promise<string> => {
      if (!process.env.FINANCE_SMOKE) throw new UserError("Use Save PDF to choose where the statement goes");
      return writeStatement(args.month, args.person, args.file);
    },

    "export.save": async (args: ExportRequest & { format: "xlsx" | "csv" }): Promise<string | null> => {
      const { title } = core["export.tables"](args);
      const config = local() as { exportFolder?: string };
      const result = await dialog.showSaveDialog(win!, {
        title: "Save the export",
        defaultPath: path.join(config.exportFolder ?? app.getPath("documents"), `${title}.${args.format}`),
        filters: [args.format === "xlsx" ? { name: "Excel workbook", extensions: ["xlsx"] } : { name: "Comma-separated values", extensions: ["csv"] }],
      });
      if (result.canceled || !result.filePath) return null;
      saveLocal({ exportFolder: path.dirname(result.filePath) });
      return writeExport(args, result.filePath);
    },
    // Used by the smoke test only: a screen never chooses where a file is written.
    "export.write": (args: ExportRequest & { format: "xlsx" | "csv"; file: string }): string => {
      if (!process.env.FINANCE_SMOKE) throw new UserError("Use Export to choose where the file goes");
      return writeExport(args, args.file);
    },

    "setup.chooseAndImport": async (): Promise<{ categories: number; budgetLines: number } | null> => {
      const result = await dialog.showOpenDialog(win!, {
        title: "Import a setup file",
        filters: [{ name: "Setup file", extensions: ["json"] }],
        properties: ["openFile"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      let parsed: SetupFile;
      try {
        parsed = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8")) as SetupFile;
      } catch {
        throw new UserError("That file is not a setup file");
      }
      return core["setup.import"](parsed);
    },
  };
}

export type ShellApi = ReturnType<typeof createShellApi>;
export type Api = CoreApi & ShellApi;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    title: "Household Finance",
    backgroundColor: "#1f2733",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  win.on("closed", () => (win = null));
  // Windows is shutting down or signing out: there may be no orderly quit, so save a copy now.
  win.on("session-end", () => {
    if (db?.isOpen) backupIfChanged();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  openData();
  if (process.env.FINANCE_DEMO && core["entries.list"]({ month: new Date().toISOString().slice(0, 7) }).length === 0) {
    // A few hundred made-up rows in a scratch folder: no need to wait on the disk after each one.
    db.exec("pragma synchronous = off");
    loadDemo(core);
    db.exec("pragma synchronous = full");
  }
  if (process.env.FINANCE_THEME) saveLocal({ theme: process.env.FINANCE_THEME });
  if (process.env.FINANCE_BACKUP_DIR) saveLocal({ backupFolder: path.resolve(process.env.FINANCE_BACKUP_DIR) });
  if (process.env.FINANCE_DEVICE) saveLocal({ device: process.env.FINANCE_DEVICE });
  // Before anything is shown: take in a newer copy from the other PC, if there is one.
  notice = syncFromOtherPc();
  const shellApi = createShellApi();

  ipcMain.handle("rpc", async (_event, method: string, arg: unknown) => {
    try {
      const fn = (core as Record<string, unknown>)[method] ?? (shellApi as Record<string, unknown>)[method];
      if (typeof fn !== "function") throw new Error(`Unknown method ${method}`);
      return { ok: true, value: await (fn as (a: unknown) => unknown)(arg) };
    } catch (error) {
      const message = error instanceof UserError ? error.message : `Something went wrong. ${(error as Error).message}`;
      return { ok: false, error: message };
    }
  });

  createWindow();
  setInterval(() => {
    if (backupIfChanged()) void refreshGlance();
  }, BACKUP_EVERY_MS);
  // Coming back to an app left open: the other PC may have been used in the meantime.
  win!.on("focus", () => {
    if (Date.now() - lastSyncCheck < 60_000 || unattended()) return;
    const loaded = syncFromOtherPc();
    if (loaded) {
      notice = loaded;
      win?.webContents.reload();
    }
  });
  // For the close-down check: shut the window as a person would, a few seconds after it opens.
  if (process.env.FINANCE_CLOSE_AFTER) setTimeout(() => win?.close(), Number(process.env.FINANCE_CLOSE_AFTER));
  if (process.env.FINANCE_SHOTS) win!.webContents.once("did-finish-load", () => void takeShots(win!, process.env.FINANCE_SHOTS!));
  if (process.env.FINANCE_SMOKE) win!.webContents.once("did-finish-load", () => void runSmoke(win!, process.env.FINANCE_SMOKE!));
});

// Closing: write a backup if anything changed, then the glance page, then quit. Writing the page takes
// a moment and uses a hidden window, so quitting is held until it is done or six seconds have passed.
let closing: "no" | "working" | "done" = "no";
app.on("before-quit", (event) => {
  if (closing === "done" || !db?.isOpen) return;
  if (closing === "working") return event.preventDefault();
  const wrote = backupIfChanged();
  if (!wrote || unattended()) {
    db.close();
    closing = "done";
    return;
  }
  closing = "working";
  event.preventDefault();
  void Promise.race([refreshGlance(), new Promise((resolve) => setTimeout(resolve, 6000))]).finally(() => {
    closing = "done";
    if (db.isOpen) db.close();
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (closing !== "working") app.quit();
});
