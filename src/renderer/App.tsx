import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutDashboard, List, PiggyBank, Scale, Settings as SettingsIcon, Target, Undo2, X } from "lucide-react";
import { change, dismissToast, undoLast, useQuery, useToasts, call, toast } from "./api";
import { applyTheme } from "./themes";
import { addMonths, monthLabel, monthOf, toISO } from "../core/dates";
import type { Category, Settings, View } from "../shared/types";
import { Segmented } from "./components/ui";
import { Dashboard } from "./screens/Dashboard";
import { Transactions } from "./screens/Transactions";
import { Budget } from "./screens/Budget";
import { SplitScreen } from "./screens/Split";
import { SettingsScreen } from "./screens/Settings";
import { Pay } from "./screens/Pay";
import { Savings } from "./screens/Savings";

export interface ScreenProps {
  month: string;
  view: View;
  settings: Settings;
  categories: Category[];
}

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "transactions", label: "Transactions", icon: List },
  { id: "budget", label: "Budget", icon: Target },
  { id: "split", label: "Bills & Split", icon: Scale },
  { id: "pay", label: "Pay", icon: CalendarDays },
  { id: "savings", label: "Savings", icon: PiggyBank },
] as const;

type Route = (typeof NAV)[number]["id"] | "settings";
const readRoute = (): Route => {
  const id = location.hash.replace(/^#\//, "");
  return id === "settings" || NAV.some((n) => n.id === id) ? (id as Route) : "dashboard";
};

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [month, setMonth] = useState(() => monthOf(toISO(new Date())));
  const [chosenView, setView] = useState<View>("a");
  const settings = useQuery("settings.get");
  const categories = useQuery("categories.list", { includeArchived: true });
  const local = useQuery("local.get");
  const undoLabel = useQuery("undo.peek");
  const backup = useQuery("backup.status");
  const toasts = useToasts();

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (local) applyTheme(local.theme);
  }, [local]);

  // Said once when the window opens: for instance, that the other PC's newer copy was loaded.
  useEffect(() => {
    void call("app.notice").then((message) => message && toast(message), () => undefined);
  }, []);

  // Ctrl+Z undoes the last saved change. While a text box holds typing that is not saved yet,
  // it undoes that typing instead.
  useEffect(() => {
    let typingIn: EventTarget | null = null;
    const onInput = (e: Event) => {
      const el = e.target as HTMLInputElement;
      typingIn = el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "date"].includes(el.type)) ? el : null;
    };
    const onLeave = (e: Event) => {
      if (e.target === typingIn) typingIn = null;
    };
    const onSubmit = () => (typingIn = null);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      if (typingIn && typingIn === document.activeElement) return;
      e.preventDefault();
      void undoLast();
    };
    window.addEventListener("input", onInput);
    window.addEventListener("focusout", onLeave);
    window.addEventListener("submit", onSubmit);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("input", onInput);
      window.removeEventListener("focusout", onLeave);
      window.removeEventListener("submit", onSubmit);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!settings || !categories) return <div className="loading">Loading…</div>;

  // With merged finances there is one budget: everything shows the household.
  const merged = settings.mergedFinances;
  const view: View = merged ? "hh" : chosenView;
  const props: ScreenProps = { month, view, settings, categories };
  const labelOf = (n: (typeof NAV)[number]) => (n.id === "split" && merged ? "Bills" : n.label);
  const title = route === "settings" ? "Settings" : labelOf(NAV.find((n) => n.id === route)!);
  const usesMonth = route === "dashboard" || route === "transactions" || route === "budget" || route === "split" || route === "pay" || route === "savings";
  const usesView = route === "dashboard" || route === "transactions" || route === "budget";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <PiggyBank size={18} />
          </span>
          <span>Household Finance</span>
        </div>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={route === n.id ? "nav on" : "nav"} aria-current={route === n.id ? "page" : undefined}>
              <n.icon size={17} aria-hidden="true" />
              {labelOf(n)}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a href="#/settings" className={route === "settings" ? "nav on" : "nav"} aria-current={route === "settings" ? "page" : undefined}>
            <SettingsIcon size={17} aria-hidden="true" />
            Settings
          </a>
          <p className={`backup-note ${backup?.lastError ? "bad" : ""}`}>
            {backup?.lastError ?? (backup?.folder ? (backup.lastBackupAt ? `Backed up ${new Date(backup.lastBackupAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Backup folder set") : "No backup folder yet")}
          </p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="topbar-tools">
            {usesMonth && (
              <div className="month-picker">
                <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
                  <ChevronLeft size={16} />
                </button>
                <span className="month-label">{monthLabel(month)}</span>
                <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
            {usesView && !merged && (
              <Segmented
                ariaLabel="Whose budget"
                value={view}
                onChange={setView}
                options={[
                  { value: "a", label: settings.people.a },
                  { value: "b", label: settings.people.b },
                  { value: "hh", label: "Household" },
                ]}
              />
            )}
            <button type="button" className="btn ghost" disabled={!undoLabel} title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : "Nothing to undo"} onClick={() => void undoLast()}>
              <Undo2 size={15} aria-hidden="true" />
              Undo
            </button>
          </div>
        </header>

        <main className="content">
          {route === "dashboard" && <Dashboard {...props} />}
          {route === "transactions" && <Transactions {...props} />}
          {route === "budget" && <Budget {...props} />}
          {route === "split" && <SplitScreen {...props} />}
          {route === "pay" && <Pay {...props} />}
          {route === "savings" && <Savings {...props} />}
          {route === "settings" && <SettingsScreen {...props} theme={local?.theme ?? "slate"} onTheme={(theme) => void change("local.setTheme", { theme })} />}
        </main>
      </div>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
