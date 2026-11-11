import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, FolderOpen, HardDriveDownload, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import { change, toast, useQuery, call } from "../api";
import type { ScreenProps } from "../App";
import type { Person, SplitSpec } from "../../core/split";
import type { Category, Settings } from "../../shared/types";
import { themes } from "../themes";
import { CATEGORY_ICONS, CategoryIcon } from "../components/Icon";
import { AmountInput, Card, TextCell, splitLabel } from "../components/ui";

const save = (patch: Partial<Settings>) => change("settings.update", patch);

function PercentInput({ value, onCommit, ariaLabel }: { value: number | undefined; onCommit: (v: number | undefined) => void; ariaLabel: string }) {
  return (
    <TextCell
      className="percent"
      ariaLabel={ariaLabel}
      placeholder="–"
      value={value === undefined ? "" : String(value)}
      onCommit={(text) => {
        if (text.trim() === "") return onCommit(undefined);
        const n = Number(text);
        if (Number.isFinite(n) && n >= 0 && n <= 100) onCommit(n);
        else toast("Enter a percentage from 0 to 100", "error");
      }}
    />
  );
}

export function SettingsScreen({ settings, categories, theme, onTheme }: ScreenProps & { theme: string; onTheme: (theme: string) => void }) {
  return (
    <div className="stack settings">
      <PeopleCard settings={settings} />
      <GroupsCard settings={settings} categories={categories} />
      <CategoriesCard settings={settings} categories={categories} />
      <BackupCard />
      <Card title="Appearance">
        <div className="theme-grid">
          {themes.map((t) => (
            <button key={t.id} type="button" className={`theme-chip ${theme === t.id ? "on" : ""}`} data-theme={t.id} aria-pressed={theme === t.id} onClick={() => onTheme(t.id)}>
              <span className="swatch" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {t.name}
              {theme === t.id && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
        <p className="muted">The theme is remembered on this PC only.</p>
      </Card>
      <SetupCard />
    </div>
  );
}

function PeopleCard({ settings }: { settings: Settings }) {
  const defaultA = settings.defaultSplit.type === "percent" ? settings.defaultSplit.a : 50;
  const opening = settings.openingBalanceCents;
  const merged = settings.mergedFinances;
  return (
    <Card title={merged ? "People" : "People and split"}>
      <div className="form-grid">
        <label>
          <span>First person</span>
          <TextCell className="boxed" value={settings.people.a} ariaLabel="First person's name" onCommit={(a) => void save({ people: { ...settings.people, a } })} />
        </label>
        <label>
          <span>Second person</span>
          <TextCell className="boxed" value={settings.people.b} ariaLabel="Second person's name" onCommit={(b) => void save({ people: { ...settings.people, b } })} />
        </label>
        {!merged && (
          <label>
            <span>Default share for {settings.people.a} (%)</span>
            <PercentInput value={defaultA} ariaLabel="Default share" onCommit={(a) => a !== undefined && void save({ defaultSplit: { type: "percent", a } })} />
          </label>
        )}
        {!merged && (
          <label>
            <span>Balance carried in from before the app</span>
            <span className="with-icon">
              <AmountInput className="boxed" cents={Math.abs(opening)} allowZero ariaLabel="Opening balance" onCommit={(c) => void save({ openingBalanceCents: opening < 0 ? -Math.abs(c) : Math.abs(c) })} />
              <select aria-label="Who owes the opening balance" value={opening < 0 ? "a" : "b"} onChange={(e) => void save({ openingBalanceCents: e.target.value === "a" ? -Math.abs(opening) : Math.abs(opening) })}>
                <option value="b">owed by {settings.people.b}</option>
                <option value="a">owed by {settings.people.a}</option>
              </select>
            </span>
          </label>
        )}
      </div>
      <label className="check-line merged-switch">
        <input type="checkbox" checked={merged} onChange={(e) => void save({ mergedFinances: e.target.checked })} />
        Our finances are merged
      </label>
      <p className="muted">
        {merged
          ? "There is one household budget. Splits, each person's own budget and the balance between you are hidden. Nothing was converted: untick this and they come back exactly as they were."
          : "Tick this if you stop keeping separate budgets. The app then shows one household budget and hides splits and the balance between you. Nothing is converted, so it can be unticked again."}
      </p>
      {!merged && <SplitPresets settings={settings} />}
    </Card>
  );
}

function SplitPresets({ settings }: { settings: Settings }) {
  const setPreset = (index: number, a: number | undefined) => {
    if (a === undefined) return;
    const presets = settings.presets.map((p, i) => (i === index ? { label: p.label, spec: { type: "percent", a } as SplitSpec } : p));
    void save({ presets });
  };
  return (
    <>
      <h3>Split presets</h3>
      <p className="muted">These appear in every split menu. Each is the share {settings.people.a} carries.</p>
      <ul className="chips">
        {settings.presets.map((p, i) => (
          <li key={i} className="chip">
            <PercentInput value={p.spec.type === "percent" ? p.spec.a : undefined} ariaLabel={`Preset ${i + 1} share`} onCommit={(a) => setPreset(i, a)} />
            <span className="muted">% · shows as {splitLabel(p.spec, settings)}</span>
            <button type="button" className="icon-btn" aria-label={`Remove preset ${splitLabel(p.spec, settings)}`} disabled={settings.presets.length <= 1} onClick={() => void save({ presets: settings.presets.filter((_, j) => j !== i) })}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="btn ghost" onClick={() => void save({ presets: [...settings.presets, { label: "", spec: { type: "percent", a: 75 } }] })}>
            <Plus size={14} aria-hidden="true" />
            Add preset
          </button>
        </li>
      </ul>
    </>
  );
}

function GroupsCard({ settings, categories }: { settings: Settings; categories: Category[] }) {
  const [name, setName] = useState("");
  const merged = settings.mergedFinances;
  const setTarget = (person: Person | "hh", grp: string, value: number | undefined) => {
    const mine = { ...settings.targets[person] };
    if (value === undefined) delete mine[grp];
    else mine[grp] = value;
    void save({ targets: { ...settings.targets, [person]: mine } });
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (settings.groups.includes(name.trim())) return toast(`"${name.trim()}" already exists`, "error");
    if (await save({ groups: [...settings.groups, name.trim()] })) setName("");
  };
  return (
    <Card title="Groups and targets">
      <p className="muted">A target is the share of planned income a group should take. Leave it blank for no target.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Group</th>
            {merged ? (
              <th className="num">Household target %</th>
            ) : (
              <>
                <th className="num">{settings.people.a} target %</th>
                <th className="num">{settings.people.b} target %</th>
              </>
            )}
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {settings.groups.map((g) => {
            const used = categories.some((c) => c.grp === g && c.kind === "expense");
            return (
              <tr key={g}>
                <td className="wide">
                  <TextCell value={g} ariaLabel={`Name of group ${g}`} onCommit={(to) => void change("groups.rename", { from: g, to })} />
                </td>
                {merged ? (
                  <td className="num">
                    <PercentInput value={settings.targets.hh?.[g]} ariaLabel={`${g} target for the household`} onCommit={(v) => setTarget("hh", g, v)} />
                  </td>
                ) : (
                  <>
                    <td className="num">
                      <PercentInput value={settings.targets.a?.[g]} ariaLabel={`${g} target for ${settings.people.a}`} onCommit={(v) => setTarget("a", g, v)} />
                    </td>
                    <td className="num">
                      <PercentInput value={settings.targets.b?.[g]} ariaLabel={`${g} target for ${settings.people.b}`} onCommit={(v) => setTarget("b", g, v)} />
                    </td>
                  </>
                )}
                <td className="actions">
                  <button type="button" className="icon-btn" aria-label={`Remove group ${g}`} title={used ? "Move its categories to another group first" : "Remove group"} disabled={used || settings.groups.length <= 1} onClick={() => void save({ groups: settings.groups.filter((x) => x !== g) })}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form className="inline-form add-line" onSubmit={(e) => void add(e)}>
        <input aria-label="New group" placeholder="Add a group" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn ghost" disabled={!name.trim()}>
          <Plus size={14} aria-hidden="true" />
          Add
        </button>
      </form>
    </Card>
  );
}

function CategoriesCard({ settings, categories }: { settings: Settings; categories: Category[] }) {
  const [name, setName] = useState("");
  const [grp, setGrp] = useState(settings.groups[0]);
  const active = categories.filter((c) => !c.archived);
  const archived = categories.filter((c) => c.archived);
  const patch = (id: number, p: Partial<Pick<Category, "name" | "grp" | "icon" | "archived">>) => void change("categories.update", { id, patch: p });
  const move = (id: number, by: number) => {
    const ids = active.map((c) => c.id);
    const from = ids.indexOf(id);
    const to = from + by;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void change("categories.reorder", { ids });
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const income = grp === "Income";
    if (await change("categories.create", { name, grp, kind: income ? "income" : "expense" })) setName("");
  };
  const remove = async (c: Category) => {
    const result = await change("categories.remove", { id: c.id });
    if (result) toast(result === "archived" ? `${c.name} has history, so it was archived` : `${c.name} deleted`);
  };
  return (
    <Card title="Categories">
      <p className="muted">Renaming applies everywhere, including past months. A category with history is archived, not deleted.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Icon</th>
            <th>Name</th>
            <th>Group</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {active.map((c, i) => (
            <tr key={c.id}>
              <td>
                <span className="with-icon">
                  <CategoryIcon name={c.icon} />
                  <select className="cell" aria-label={`Icon for ${c.name}`} value={c.icon ?? ""} onChange={(e) => patch(c.id, { icon: e.target.value || null })}>
                    <option value="">Default</option>
                    {Object.keys(CATEGORY_ICONS).map((k) => (
                      <option key={k} value={k}>
                        {k.replace(/-/g, " ")}
                      </option>
                    ))}
                  </select>
                </span>
              </td>
              <td className="wide">
                <TextCell value={c.name} ariaLabel={`Name of ${c.name}`} onCommit={(n) => patch(c.id, { name: n })} />
              </td>
              <td>
                {c.kind === "income" ? (
                  <span className="muted">Income</span>
                ) : (
                  <select className="cell" aria-label={`Group for ${c.name}`} value={c.grp} onChange={(e) => patch(c.id, { grp: e.target.value })}>
                    {[...new Set([...settings.groups, c.grp])].map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                )}
              </td>
              <td className="actions">
                <button type="button" className="icon-btn" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(c.id, -1)}>
                  <ArrowUp size={14} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Move ${c.name} down`} disabled={i === active.length - 1} onClick={() => move(c.id, 1)}>
                  <ArrowDown size={14} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Archive ${c.name}`} title="Archive" onClick={() => patch(c.id, { archived: true })}>
                  <Archive size={14} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Delete ${c.name}`} title="Delete" onClick={() => void remove(c)}>
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="inline-form add-line" onSubmit={(e) => void add(e)}>
        <input aria-label="New category name" placeholder="Add a category" value={name} onChange={(e) => setName(e.target.value)} />
        <select aria-label="Group for the new category" value={grp} onChange={(e) => setGrp(e.target.value)}>
          {settings.groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
          <option>Income</option>
        </select>
        <button type="submit" className="btn ghost" disabled={!name.trim()}>
          <Plus size={14} aria-hidden="true" />
          Add
        </button>
      </form>
      {archived.length > 0 && (
        <>
          <h3>Archived</h3>
          <ul className="chips">
            {archived.map((c) => (
              <li key={c.id} className="chip">
                {c.name}
                <button type="button" className="icon-btn" aria-label={`Restore ${c.name}`} title="Restore" onClick={() => patch(c.id, { archived: false })}>
                  <ArchiveRestore size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function BackupCard() {
  const status = useQuery("backup.status");
  const backups = useQuery("backup.list");
  if (!status) return null;
  const choose = async () => {
    const folder = await change("backup.chooseFolder");
    if (!folder) return;
    // A fresh install pointed at the folder the other PC uses has just taken that PC's data.
    const loaded = await call("app.notice").catch(() => null);
    toast(loaded ?? "Backup folder set and first copy written");
  };
  const now = async () => {
    const file = await change("backup.now");
    if (file) toast(`Backed up as ${file.file}`);
  };
  const restore = async (file: string, when: string) => {
    if (!window.confirm(`Replace everything in the app with the backup from ${when}?\n\nYour current data is kept on this PC as a "before-restore" file.`)) return;
    const done = await change("backup.restore", { file });
    if (done) toast("Backup restored");
  };
  const label = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  return (
    <Card title="Backup">
      <p className="muted">
        A full copy is written here when you close the app, and every ten minutes while there are changes. Pick a folder inside OneDrive so the copies reach your other PC, and choose the same folder there: each PC then loads the other's newer copy when it opens, and asks first if both have changes. The app keeps this PC's last 30 copies plus one per month. A read-only page for your phone, finance-glance.pdf, is saved in the same folder.
      </p>
      <p>
        <strong>Folder:</strong> {status.folder ?? "not chosen yet"}
      </p>
      {status.lastError && (
        <p className="field-error" role="alert">
          {status.lastError}
        </p>
      )}
      <div className="inline-form">
        <button type="button" className="btn" onClick={() => void choose()}>
          <FolderOpen size={15} aria-hidden="true" />
          {status.folder ? "Change folder" : "Choose folder"}
        </button>
        <button type="button" className="btn ghost" disabled={!status.folder} onClick={() => void now()}>
          <HardDriveDownload size={15} aria-hidden="true" />
          Back up now
        </button>
        <button type="button" className="btn ghost" disabled={!status.folder} onClick={() => void change("backup.openFolder")}>
          Open folder
        </button>
      </div>
      {backups && backups.length > 0 && (
        <table className="table compact">
          <thead>
            <tr>
              <th>Taken</th>
              <th>PC</th>
              <th className="num">Size</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {backups.slice(0, 12).map((b) => (
              <tr key={b.file}>
                <td>{label(b.takenAt)}</td>
                <td>{b.device}</td>
                <td className="num">{Math.max(1, Math.round(b.bytes / 1024))} KB</td>
                <td className="actions">
                  <button type="button" className="btn ghost" onClick={() => void restore(b.file, label(b.takenAt))}>
                    <RotateCcw size={14} aria-hidden="true" />
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function SetupCard() {
  const info = useQuery("app.info");
  const run = async () => {
    const result = await change("setup.chooseAndImport");
    if (result) toast(`Setup loaded: ${result.categories} categories added, ${result.budgetLines} planned amounts set`);
  };
  return (
    <Card title="Setup and data">
      <p className="muted">A setup file fills in names, the default split, categories and a first month's plan in one step. Ctrl+Z reverses it.</p>
      <div className="inline-form">
        <button type="button" className="btn" onClick={() => void run()}>
          <Upload size={15} aria-hidden="true" />
          Import a setup file
        </button>
      </div>
      {info && (
        <p className="muted small">
          Version {info.version} · Data file: {info.dataFile}
        </p>
      )}
    </Card>
  );
}
