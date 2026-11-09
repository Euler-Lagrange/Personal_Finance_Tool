import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createApi, UserError, type CoreApi } from "./api";
import { listBackups, pruneBackups, restoreBackup, writeBackup } from "./backup";
import { MIGRATION_COUNT, openDb, type Db } from "./db";
import { loadDemo } from "./demo";
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
    saveLocal({ lastBackupRev: rev, lastBackupAt: now.toISOString() });
    lastError = null;
    return file;
  } catch (error) {
    lastError = `Backup failed: ${(error as Error).message}`;
    return null;
  }
}

/** Points backups at a folder and writes the first copy straight away, so a bad folder is reported now. */
function setBackupFolder(folder: string): string {
  const previous = local().backupFolder;
  saveLocal({ backupFolder: folder, lastBackupRev: undefined });
  backupIfChanged(true);
  if (lastError) {
    const message = lastError;
    saveLocal({ backupFolder: previous });
    lastError = null;
    throw new UserError(`That folder cannot be used. ${message}`);
  }
  return folder;
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
    // Used by the smoke test only: a screen never chooses where a file is written.
    "statement.write": (args: { month: string; person: Person; file: string }): Promise<string> => {
      if (!process.env.FINANCE_SMOKE) throw new UserError("Use Save PDF to choose where the statement goes");
      return writeStatement(args.month, args.person, args.file);
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
  setInterval(() => backupIfChanged(), BACKUP_EVERY_MS);
  if (process.env.FINANCE_SHOTS) win!.webContents.once("did-finish-load", () => void takeShots(win!, process.env.FINANCE_SHOTS!));
  if (process.env.FINANCE_SMOKE) win!.webContents.once("did-finish-load", () => void runSmoke(win!, process.env.FINANCE_SMOKE!));
});

app.on("before-quit", () => {
  if (db?.isOpen) {
    backupIfChanged();
    db.close();
  }
});

app.on("window-all-closed", () => app.quit());
