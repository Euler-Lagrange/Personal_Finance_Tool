import HelpTip, { HelpHeading } from "./HelpTip";
import ManagedBackups from "./ManagedBackups";
import { version as appVersion } from "../package.json";
import { pageInfo } from "./helpContent";
import VisitRecap, { useVisitBaseline } from "./VisitRecap";
import Handoff, { type HandoffOpen, type HandoffSelection } from "./Handoff";
import CashForecast from "./CashForecast";
import CardStatements from "./CardStatements";
import CashPlans from "./CashPlans";
import PayHours from "./PayHours";
import Annual, { MonthCloseControl } from "./Periods";
import SharedStatement from "./SharedStatement";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  FlaskConical,
  LayoutDashboard,
  List,
  LockKeyhole,
  Palette,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Target,
  Users,
  Upload,
  WandSparkles,
  RotateCcw,
  Wallet,
  ReceiptText,
  X,
} from "lucide-react";
import { command, dollars, money, monthName, shortDate, today } from "./api";
import EntryDialog, { Modal } from "./EntryDialog";
import MovementReview from "./MovementReview";
import TransferDialog from "./TransferDialog";
import RefundDialog from "./RefundDialog";
import Rules from "./Rules";
import PayPalDialog, { HouseholdTools } from "./Household";
import Bills, { BillOverview } from "./Bills";
import Goals, { GoalOverview } from "./Goals";
import Imports, { PendingActivityReview } from "./Imports";
import { useImportIntake, DropOverlay } from "./ImportIntake";
import { isTransfer, isBudgetOutflow } from "./types";
import { CategoryIcon } from "./CategoryIcon";
import { ThemePicker } from "./ThemePicker";
import Setup, { AccountIcon, BudgetTemplateDialog } from "./Setup";
import { readTheme, saveTheme, themeScheme, type ThemeId } from "./themes";
import type { Category, Entry, EntryKind, Snapshot, Workspace } from "./types";

type View =
  | "overview"
  | "transactions"
  | "budget"
  | "shared"
  | "settings"
  | "setup"
  | "imports"
  | "rules"
  | "bills"
  | "goals"
  | "annual"
  | "cash"
  | "statements"
  | "forecast"
  | "payroll";
const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "transactions", label: "Transactions", icon: List },
  { id: "imports", label: "Imports", icon: Upload },
  { id: "rules", label: "Merchant rules", icon: WandSparkles },
  { id: "budget", label: "Monthly budget", icon: Target },
  { id: "annual", label: "Annual reports", icon: ReceiptText },
  { id: "bills", label: "Bills", icon: ReceiptText },
  { id: "goals", label: "Savings goals", icon: Wallet },
  { id: "statements", label: "Card statements", icon: ReceiptText },
  { id: "cash", label: "Cash plans", icon: Wallet },
  { id: "payroll", label: "Pay & hours", icon: CalendarDays },
  { id: "forecast", label: "Cash timeline", icon: CalendarDays },
  { id: "shared", label: "Shared expenses", icon: Users },
  { id: "setup", label: "Accounts & categories", icon: Settings2 },
] as const;

export default function App() {
  const [handoff, setHandoff] = useState<HandoffOpen | null>(null);
  useEffect(() => {
    const handler = (event: Event) => {
      const items = (event as CustomEvent<HandoffSelection[]>).detail;
      if (document.querySelector("dialog[open]")) {
        if (
          !document.querySelector(
            'dialog[aria-label="Import encrypted handoff"]',
          )
        ) {
          setNotice("Close the current dialog before dropping a handoff file.");
          return;
        }
        window.dispatchEvent(
          new CustomEvent("finance-handoff-selection", { detail: items }),
        );
        return;
      }
      if (items.length === 1)
        setHandoff({ mode: "import", selection: items[0] });
    };
    window.addEventListener("finance-handoff-open", handler);
    return () => window.removeEventListener("finance-handoff-open", handler);
  }, []);
  const [theme, setTheme] = useState<ThemeId>(readTheme);
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    localStorage.getItem("workspace") === "personal" ? "personal" : "demo",
  );
  const [month, setMonth] = useState(today().slice(0, 7));
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<Snapshot | null>(null);
  const visitBaseline = useVisitBaseline(data);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [importEpoch, setImportEpoch] = useState(0);
  const intake = useImportIntake(
    workspace,
    (purpose) => {
      setImportEpoch((n) => n + 1);
      void saved(
        purpose === "payroll"
          ? "Source saved in Pay & hours for review. Totals unchanged."
          : "Source saved in Imports for review. Totals unchanged.",
      );
    },
    view === "payroll" ? "payroll" : "transactions",
  );
  useEffect(() => {
    command("set_native_theme", { dark: themeScheme(theme) === "dark" }).catch(
      () => {
        // Web previews have no native title bar. Content theming remains available.
      },
    );
  }, [theme]);
  function changeTheme(next: ThemeId) {
    setTheme(next);
    if (!saveTheme(next))
      setNotice(
        "Theme applied. This session cannot save appearance preferences.",
      );
  }
  const [editor, setEditor] = useState<{
    entry?: Entry;
    kind?: EntryKind;
    shared?: boolean;
  } | null>(null);
  const [budget, setBudget] = useState<Category | null>(null);
  const request = useRef(0);
  const selection = `${workspace}:${month}`;
  const activeSelection = useRef(selection);
  activeSelection.current = selection;
  const refresh = useCallback(async () => {
    if (activeSelection.current !== selection) return;
    const current = ++request.current;
    const snapshot = await command<Snapshot>("snapshot", { workspace, month });
    if (current === request.current && activeSelection.current === selection) {
      setData(snapshot);
      setError("");
    }
  }, [workspace, month, selection]);
  useEffect(() => {
    setLoading(true);
    setData(null);
    setError("");
    let alive = true;
    refresh()
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      ++request.current;
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function saved(message: string) {
    try {
      await refresh();
    } catch (e) {
      if (activeSelection.current === selection) {
        setData(null);
        setError(
          `Your change was saved, but the screen could not reload. Try again to reload your records. ${String(e)}`,
        );
      }
    }
    if (activeSelection.current === selection) setNotice(message);
  }
  function switchWorkspace(next: Workspace) {
    setHandoff(null);
    setWorkspace(next);
    localStorage.setItem("workspace", next);
    setEditor(null);
    setBudget(null);
    setView("overview");
  }
  function stepMonth(delta: number) {
    const d = new Date(`${month}-02T12:00:00`);
    d.setMonth(d.getMonth() + delta);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Wallet size={23} strokeWidth={1.7} />
          </div>
          <div>
            Personal Finance<span>Budget & expense tracking</span>
          </div>
        </div>
        <div className="workspace-pill">
          <span className="avatar">J</span>
          <div>
            Jacob’s workspace
            <small>
              {workspace === "demo" ? "Sample data" : "Personal · USD"}
            </small>
          </div>
        </div>
        <div className="nav-heading">YOUR FINANCES</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              <Icon size={19} strokeWidth={1.65} />
              {label}
              {view === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-dot" />
            Stored on this PC<small>Offline access enabled</small>
          </div>
          <button
            className={
              view === "settings" ? "settings-nav active" : "settings-nav"
            }
            onClick={() => setView("settings")}
          >
            <Settings2 size={19} />
            Workspace & backups
          </button>
          <div className="version">
            PERSONAL PREVIEW <span>v{appVersion}</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            My finances <span>/</span>{" "}
            {view === "settings"
              ? "Workspace"
              : navigation.find((n) => n.id === view)?.label}
          </div>
          <div className="topbar-actions">
            <button
              className="appearance-shortcut"
              onClick={() => {
                setView("settings");
                window.scrollTo({ top: 0 });
              }}
            >
              <Palette size={15} aria-hidden="true" />
              Appearance
            </button>
            <span className="private-label">
              <LockKeyhole size={13} />
              Local & private
            </span>
          </div>
        </header>
        {workspace === "demo" && (
          <div className="sample-banner">
            <FlaskConical size={16} />
            <span>
              <strong>Sample workspace</strong> · Illustrative data for testing.
            </span>
            <button onClick={() => switchWorkspace("personal")}>
              Start fresh <ArrowRight size={14} />
            </button>
          </div>
        )}
        <main>
          <section className="page-heading">
            <div>
              <span className="eyebrow">
                {view === "overview"
                  ? "SUMMARY"
                  : view === "shared"
                    ? "JACOB + CHELSEA"
                    : view === "settings" || view === "setup"
                      ? "CONFIGURATION"
                      : "MONTHLY RECORDS"}
              </span>
              <div className="help-heading">
                <h1>{pageInfo[view].title}</h1>
                <HelpTip key={view} topic={view} />
              </div>
              <p>{pageInfo[view].description}</p>
            </div>
            <div className="heading-actions">
              {(view === "overview" || view === "transactions") && (
                <button
                  className="secondary"
                  disabled={!data}
                  onClick={() => setEditor({ kind: "refund" })}
                >
                  <RotateCcw size={16} /> Record refund
                </button>
              )}
              {view !== "settings" &&
                view !== "setup" &&
                view !== "imports" &&
                view !== "rules" &&
                view !== "payroll" &&
                view !== "annual" && (
                  <div className="month-selector">
                    <button
                      aria-label="Previous month"
                      onClick={() => stepMonth(-1)}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <input
                      aria-label="Selected month"
                      type="month"
                      value={month}
                      onChange={(e) => {
                        if (/^\d{4}-\d{2}$/.test(e.target.value))
                          setMonth(e.target.value);
                      }}
                    />
                    <button
                      aria-label="Next month"
                      onClick={() => stepMonth(1)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                )}
              {view !== "settings" &&
                view !== "setup" &&
                (view === "overview" || view === "transactions") && (
                  <button
                    className="secondary"
                    disabled={!data}
                    onClick={() => setEditor({ kind: "transfer" })}
                  >
                    <ArrowRightLeft size={17} />
                    Move money
                  </button>
                )}
              {view !== "settings" &&
                view !== "setup" &&
                view !== "imports" &&
                view !== "rules" &&
                view !== "bills" &&
                view !== "goals" &&
                view !== "cash" &&
                view !== "statements" &&
                view !== "annual" && (
                  <button
                    className="primary"
                    disabled={!data}
                    onClick={() => setEditor({ shared: view === "shared" })}
                  >
                    <Plus size={18} />
                    Add expense
                  </button>
                )}
            </div>
          </section>
          {error && (
            <div className="error" role="alert">
              {error}
              <button
                className="secondary"
                onClick={() => refresh().catch((e) => setError(String(e)))}
              >
                Try again
              </button>
            </div>
          )}
          {loading && (
            <div className="loading">
              <div className="loader" />
              Opening your workspace…
            </div>
          )}
          {!loading && data && (
            <>
              {!!data.pendingFundingCount && (
                <div className="import-incomplete">
                  <span>
                    {data.pendingFundingCount} goal funding assignments need
                    review. Monthly allowance includes unsupported funding.
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setView("goals")}
                  >
                    Review funding
                  </button>
                </div>
              )}
              {view !== "imports" && data.incompleteImports > 0 && (
                <div className="import-incomplete">
                  <Upload size={16} />
                  <span>
                    {data.incompleteImports} source
                    {data.incompleteImports === 1 ? "" : "s"} still need review.
                    Unverified rows are held. Recorded activity awaiting
                    classification is labeled in your totals.
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setView("imports")}
                  >
                    Review imports
                  </button>
                </div>
              )}
              {view !== "imports" && intake.intakeError && (
                <div className="error" role="alert">
                  {intake.intakeError}
                </div>
              )}
              {view !== "imports" &&
                view !== "payroll" &&
                intake.jobs.length > 0 && (
                  <div className="import-incomplete">
                    <span>
                      {intake.jobs.filter((j) => j.state === "saved").length}{" "}
                      source(s) saved ·{" "}
                      {intake.jobs.filter((j) => j.state === "error").length}{" "}
                      intake error(s). Open Imports for progress and review.
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setView("imports")}
                    >
                      Open Imports
                    </button>
                  </div>
                )}
              {view === "imports" && (
                <Imports
                  key={workspace}
                  data={data}
                  intake={intake}
                  epoch={importEpoch}
                  saved={saved}
                />
              )}
              {view === "rules" && (
                <Rules key={workspace} data={data} saved={saved} />
              )}
              {view === "bills" && (
                <Bills
                  key={`${workspace}:${month}`}
                  data={data}
                  saved={saved}
                />
              )}
              {view === "goals" && (
                <Goals
                  key={`${workspace}:${month}`}
                  data={data}
                  saved={saved}
                  setup={() => setView("setup")}
                  move={() => setEditor({ kind: "transfer" })}
                />
              )}
              {view === "overview" && (
                <VisitRecap data={data} baseline={visitBaseline} />
              )}
              {view === "overview" && (
                <Overview
                  data={data}
                  go={setView}
                  edit={(e) => setEditor({ entry: e })}
                  add={() => setEditor({})}
                  settle={() => setEditor({ kind: "settlement" })}
                />
              )}
              {view === "transactions" && (
                <Transactions
                  data={data}
                  edit={(e) => setEditor({ entry: e })}
                  add={() => setEditor({})}
                />
              )}
              {view === "statements" && (
                <CardStatements
                  key={`${workspace}:${month}`}
                  data={data}
                  saved={saved}
                />
              )}
              {view === "forecast" && (
                <CashForecast key={workspace} data={data} />
              )}
              {view === "cash" && (
                <CashPlans
                  key={`${workspace}:${month}`}
                  data={data}
                  saved={saved}
                />
              )}
              {view === "payroll" && (
                <PayHours
                  key={workspace}
                  workspace={workspace}
                  intake={intake}
                  importEpoch={importEpoch}
                  accounts={data.accounts}
                />
              )}
              {view === "annual" && (
                <Annual key={workspace} data={data} saved={saved} />
              )}
              {view === "budget" && (
                <Budget data={data} edit={setBudget} saved={saved} />
              )}
              {view === "setup" && <Setup data={data} saved={saved} />}
              {view === "shared" && (
                <Shared
                  data={data}
                  edit={(e) => setEditor({ entry: e })}
                  settle={() => setEditor({ kind: "settlement" })}
                  cashout={() => setEditor({ kind: "paypal_cashout" })}
                  saved={saved}
                />
              )}
              {view === "settings" && (
                <Settings
                  data={data}
                  handoff={(mode) => setHandoff({ mode })}
                  change={switchWorkspace}
                  saved={saved}
                  theme={theme}
                  changeTheme={changeTheme}
                  configure={() => setView("setup")}
                />
              )}
              <footer className="page-footer">
                <ShieldCheck size={14} />
                {workspace === "demo" ? "Sample data" : "Your entries"} · Saved
                locally{" "}
                <span>
                  Amounts in USD · Budget periods; original dates retained
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {handoff && (
        <Handoff
          key={workspace}
          workspace={workspace}
          initial={handoff}
          close={() => setHandoff(null)}
          saved={saved}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <DropOverlay intake={intake} />
      {editor &&
        data &&
        !editor.entry?.movementLink &&
        isTransfer(editor.entry?.kind ?? editor.kind ?? "expense") && (
          <TransferDialog
            snapshot={data}
            entry={editor.entry}
            onClose={() => setEditor(null)}
            onSaved={saved}
          />
        )}
      {editor?.entry?.movementLink && data && (
        <MovementReview
          data={data}
          entry={editor.entry}
          close={() => setEditor(null)}
          changed={saved}
        />
      )}
      {editor?.entry?.kind === "unclassified" && data && (
        <PendingActivityReview
          data={data}
          entry={editor.entry}
          close={() => setEditor(null)}
          changed={saved}
        />
      )}
      {editor && data && (editor.entry?.kind ?? editor.kind) === "refund" && (
        <RefundDialog
          snapshot={data}
          entry={editor.entry}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {editor &&
        data &&
        (editor.entry?.kind ?? editor.kind) === "paypal_cashout" && (
          <PayPalDialog
            data={data}
            entry={editor.entry}
            close={() => setEditor(null)}
            saved={saved}
          />
        )}
      {editor &&
        data &&
        (editor.entry?.kind ?? editor.kind) !== "unclassified" &&
        (editor.entry?.kind ?? editor.kind) !== "refund" &&
        (editor.entry?.kind ?? editor.kind) !== "paypal_cashout" &&
        !isTransfer(editor.entry?.kind ?? editor.kind ?? "expense") && (
          <EntryDialog
            snapshot={data}
            {...editor}
            onClose={() => setEditor(null)}
            onSaved={saved}
          />
        )}
      {budget && data && (
        <BudgetDialog
          category={budget}
          data={data}
          close={() => setBudget(null)}
          saved={saved}
        />
      )}
    </div>
  );
}

function BalanceText({ amount }: { amount: number }) {
  return (
    <>
      {amount === 0
        ? "No outstanding balance"
        : amount > 0
          ? "Chelsea owes you"
          : "You owe Chelsea"}
    </>
  );
}
function Overview({
  data,
  go,
  edit,
  add,
  settle,
}: {
  data: Snapshot;
  go: (v: View) => void;
  edit: (e: Entry) => void;
  add: () => void;
  settle: () => void;
}) {
  const provisional = data.provisionalAllowanceCents ?? 0;
  const allowanceUsed = (data.allowanceCents ?? data.spentCents) + provisional;
  const used =
    data.budgetCents > 0
      ? Math.max(0, Math.min(100, (allowanceUsed / data.budgetCents) * 100))
      : 0;
  const overspent = data.categories.filter(
    (c) =>
      (c.allowanceCents ?? c.spentCents) + (c.provisionalCents ?? 0) >
      (c.availableCents ?? c.limitCents),
  );
  const top = data.categories
    .filter(
      (c) =>
        (c.availableCents ?? c.limitCents) !== 0 ||
        c.spentCents !== 0 ||
        !!c.provisionalCents,
    )
    .sort((a, b) => b.spentCents - a.spentCents)
    .slice(0, 5);
  return (
    <div className="overview-layout">
      <div className="stat-grid">
        <section className="hero-card">
          <div className="card-overline">
            <span>MONTHLY BUDGET</span>
            <Target size={19} />
          </div>
          <div className="hero-amount">
            {money(Math.abs(data.remainingCents))}
          </div>
          <div className="hero-caption">
            {data.budgetCents === 0 && allowanceUsed === 0
              ? "No monthly budget configured"
              : data.remainingCents < 0
                ? "over your monthly budget"
                : "left in your monthly budget"}
          </div>
          <div className="hero-track">
            <span style={{ width: `${used}%` }} />
          </div>
          <div className="hero-detail">
            <span>{money(allowanceUsed)} used</span>
            <span>{money(data.budgetCents)} planned</span>
          </div>
          {!!data.goalExcludedCents && (
            <p>
              {money(data.goalExcludedCents)} goal-funded spending excluded from
              allowance.
            </p>
          )}
          {!!data.pendingFundingCount && (
            <p>
              {data.pendingFundingCount} funding assignments need review.
              Unsupported amounts remain in monthly allowance.
            </p>
          )}
          {provisional > 0 && (
            <p>Includes {money(provisional)} awaiting split.</p>
          )}
          {!!data.unclassifiedCount && (
            <p>
              {data.unclassifiedCount} items awaiting classification. Totals
              remain provisional.
            </p>
          )}
        </section>
        <section className="metric-card">
          <div className="metric-icon">
            <ArrowUpRight size={21} />
          </div>
          <span>Budget used</span>
          <strong>{money(allowanceUsed)}</strong>
          <p>
            {money(data.consumptionCents ?? data.spentCents)} purchases ·{" "}
            {money(data.debtPaymentCents ?? 0)} loan/debt payments. Your share,
            less refunds.
          </p>
          <button className="text-button" onClick={() => go("transactions")}>
            View transactions <ArrowRight size={15} />
          </button>
        </section>
        <section className="metric-card">
          <div className="metric-icon green">
            <ArrowDownLeft size={21} />
          </div>
          <span>Income recorded</span>
          <strong>{money(data.incomeCents)}</strong>
          <p>
            Bonus / Cashback: {money(data.cashRewardCents ?? 0)} cash ·{" "}
            {money(data.cardRewardCents ?? 0)} noncash card credits.
          </p>
          <p>Repayments from Chelsea are excluded.</p>
          <div className="small-tag">
            {data.monthlyCount} entries this month
          </div>
        </section>
      </div>
      <div className="overview-columns">
        <section className="panel budget-overview">
          <div className="panel-heading">
            <div>
              <HelpHeading topic="budgetRoom">
                <h2>Spending by category</h2>
              </HelpHeading>
              <p>
                {top.length > 0
                  ? `Showing ${top.length} categories · ${data.categories.filter((c) => !c.archived).length} active in your budget`
                  : "Your allowance usage against category limits"}
              </p>
            </div>
            <button className="text-button" onClick={() => go("budget")}>
              View all categories <ArrowRight size={15} />
            </button>
          </div>
          {top.length ? (
            <div className="budget-bars">
              {top.map((c) => (
                <CategoryBar key={c.id} category={c} />
              ))}
            </div>
          ) : (
            <Empty
              title="No budget limits configured"
              text="Set monthly category limits to track remaining amounts and overspending."
              action="Configure budget"
              onAction={() => go("budget")}
            />
          )}
          {overspent.length > 0 && (
            <div className="attention">
              <CircleHelp size={16} />
              <span>
                {overspent.length}{" "}
                {overspent.length === 1 ? "category is" : "categories are"} over
                budget.
              </span>
              <button onClick={() => go("budget")}>
                Review budget <ArrowRight size={14} />
              </button>
            </div>
          )}
        </section>
        <div className="right-stack">
          <section className="panel shared-card">
            <div className="panel-heading">
              <HelpHeading topic="householdBalance">
                <h2>Household balance</h2>
              </HelpHeading>
              <Users size={19} />
            </div>
            <div className="avatars">
              <span className="avatar jacob">J</span>
              <span className="avatar chelsea">C</span>
              <span className="split-label">70 / 30 default split</span>
            </div>
            <span className="balance-label">
              <BalanceText amount={data.householdCents} />
            </span>
            <div className="balance-value">
              {money(Math.abs(data.householdCents))}
            </div>
            <p>
              Confirmed balance across all months. Unresolved activity is
              excluded.
            </p>
            <div className="shared-actions">
              <button
                className="secondary"
                disabled={!data.householdCents}
                onClick={settle}
              >
                Record repayment
              </button>
              <button
                className="icon-button"
                aria-label="View shared expenses"
                onClick={() => go("shared")}
              >
                <ArrowRight size={19} />
              </button>
            </div>
          </section>
          <section className="status-card">
            <div className="status-icon">
              {overspent.length ||
              data.unclassifiedCount ||
              data.pendingFundingCount ||
              data.incompleteImports ? (
                <CircleHelp size={18} />
              ) : (
                <Check size={18} />
              )}
            </div>
            <div>
              <h3>Budget status</h3>
              <p>
                {overspent.length
                  ? `Over budget: ${overspent.map((c) => c.name).join(", ")}.`
                  : data.unclassifiedCount ||
                      data.pendingFundingCount ||
                      data.incompleteImports
                    ? "Provisional: review unresolved activity before relying on the remaining budget."
                    : data.spentCents > 0
                      ? "Monthly allowance usage is within all category limits."
                      : "No spending recorded for the selected month."}
              </p>
            </div>
          </section>
        </div>
      </div>
      <div className="overview-planning">
        <BillOverview data={data} open={() => go("bills")} />
        <GoalOverview data={data} open={() => go("goals")} />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent activity</h2>
            <p>{monthName(data.month)} · All entry types</p>
          </div>
          <button className="text-button" onClick={() => go("transactions")}>
            View all <ArrowRight size={15} />
          </button>
        </div>
        <EntryTable
          entries={data.entries.slice(0, 5)}
          data={data}
          edit={edit}
          emptyAction={add}
        />
      </section>
    </div>
  );
}

function CategoryBar({ category: c }: { category: Category }) {
  const usage = (c.allowanceCents ?? c.spentCents) + (c.provisionalCents ?? 0);
  const limit = c.availableCents ?? c.limitCents;
  const over = usage > limit;
  return (
    <div className="category-bar">
      <div className="bar-label">
        <span>
          <CategoryIcon category={c} size={18} color={c.color} />
          {c.name}
        </span>
        <span>
          <strong>{money(usage)}</strong>
          <small> / {money(limit)}</small>
        </span>
      </div>
      <div className="track">
        <span
          style={{
            width: `${limit > 0 ? Math.max(0, Math.min(100, (usage / limit) * 100)) : over ? 100 : 0}%`,
            background: over ? "var(--warning)" : c.color,
          }}
        />
      </div>
      {!!c.rolloverCents && (
        <small>
          Base {money(c.limitCents)}; carry adjustments {money(c.rolloverCents)}
        </small>
      )}
      {!!c.goalExcludedCents && (
        <small>
          Actual spending {money(c.spentCents)}; goal-funded exclusion{" "}
          {money(c.goalExcludedCents)}
        </small>
      )}
      {!!c.provisionalCents && (
        <small>Includes {money(c.provisionalCents)} awaiting split</small>
      )}
      <div className={`bar-caption ${over ? "over" : ""}`}>
        {over ? `${money(usage - limit)} over` : `${money(limit - usage)} left`}
      </div>
    </div>
  );
}

function Empty({
  title,
  text,
  action,
  onAction,
}: {
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty">
      <Wallet size={30} strokeWidth={1.2} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="secondary" onClick={onAction}>
          {action}
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}

function EntryTable({
  entries,
  data,
  edit,
  emptyAction,
  shared = false,
}: {
  entries: Entry[];
  data: Snapshot;
  edit: (e: Entry) => void;
  emptyAction?: () => void;
  shared?: boolean;
}) {
  if (!entries.length)
    return (
      <Empty
        title="No entries found"
        text={
          shared
            ? "No shared purchases or repayments have been recorded."
            : "No entries match the selected month or filters."
        }
        action={emptyAction ? "Add entry" : undefined}
        onAction={emptyAction}
      />
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>{shared ? "Paid by" : "Category"}</th>
            <th>{shared ? "Chelsea’s share" : "Account"}</th>
            <th className="number">Full amount</th>
            <th className="number">
              {shared ? "Balance effect" : "Your share"}
            </th>
            <th>
              <span className="sr-only">Edit</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const category = data.categories.find((c) => c.id === e.categoryId);
            const account = data.accounts.find((a) => a.id === e.accountId);
            const destination = data.accounts.find(
              (a) => a.id === e.destinationAccountId,
            );
            return (
              <tr key={e.id}>
                <td className="date-cell" title={e.date}>
                  {shortDate(e.date)}
                  {e.budgetOverride?.month && (
                    <small title={e.budgetOverride.reason}>
                      Budget {monthName(e.budgetOverride.month)}
                    </small>
                  )}
                  {shared && <small>{e.date.slice(0, 4)}</small>}
                </td>
                <td>
                  <button className="entry-link" onClick={() => edit(e)}>
                    <span
                      className={`entry-icon ${e.kind}`}
                      style={
                        category
                          ? {
                              color: category.color,
                              backgroundColor: `${category.color}18`,
                            }
                          : {}
                      }
                    >
                      {e.kind === "unclassified" ? (
                        <CircleHelp size={17} />
                      ) : isBudgetOutflow(e.kind) || e.kind === "refund" ? (
                        <CategoryIcon category={category} size={18} />
                      ) : e.kind === "income" || e.kind === "reward" ? (
                        <ArrowDownLeft size={18} />
                      ) : isTransfer(e.kind) ? (
                        <ArrowRightLeft size={18} />
                      ) : (
                        <Users size={17} />
                      )}
                    </span>
                    <span>
                      {e.description}
                      <small>
                        {e.kind === "unclassified"
                          ? e.pending?.verifiedExpense
                            ? "Awaiting split - gross amount reserved"
                            : e.pending?.kindHint === "card_payment"
                              ? "Payment to review - account activity only"
                              : e.pending?.kindHint === "transfer"
                                ? "Transfer to review - account activity only"
                                : "Awaiting type - account activity only"
                          : isTransfer(e.kind)
                            ? `${e.kind === "card_payment" ? "Card payment" : "Bank transfer"} · no income or spending`
                            : e.kind === "settlement"
                              ? "Repayment · no income or spending"
                              : e.kind === "paypal_cashout"
                                ? "PayPal cash-out - bank deposit; fees use your budget"
                                : e.kind === "refund"
                                  ? "Refund · reverses original purchase shares"
                                  : e.kind === "reward"
                                    ? account?.kind === "credit"
                                      ? "Noncash reward / credit · reduces card debt"
                                      : "Cash reward / credit"
                                    : e.kind === "debt_payment"
                                      ? "Loan/debt payment · uses category budget"
                                      : e.kind === "income"
                                        ? "Income"
                                        : e.lines &&
                                            (e.lines.length > 1 ||
                                              e.lines.some(
                                                (l) =>
                                                  l.splitMode !== "inherit",
                                              ))
                                          ? `${e.payer === "jacob" ? "You" : "Chelsea"} paid · itemized shares`
                                          : `${e.payer === "jacob" ? "You" : "Chelsea"} paid${e.splitMode === "shared" ? " · shared 70 / 30" : e.splitMode === "personal" ? " · your expense" : e.splitMode === "chelsea" ? " · Chelsea’s expense" : " · custom split"}`}
                      </small>
                    </span>
                  </button>
                </td>
                <td>
                  {shared ? (
                    <span className={`person-chip ${e.payer}`}>
                      {e.payer === "jacob" ? "Jacob" : "Chelsea"}
                    </span>
                  ) : category ? (
                    <span className="category-chip">
                      <CategoryIcon
                        category={category}
                        size={14}
                        color={category.color}
                      />
                      {e.lines &&
                      new Set(e.lines.map((l) => l.categoryId)).size > 1
                        ? `${new Set(e.lines.map((l) => l.categoryId)).size} categories`
                        : category.name}
                    </span>
                  ) : (
                    <span className="muted">
                      {isTransfer(e.kind)
                        ? e.kind === "card_payment"
                          ? "Card payment"
                          : "Transfer"
                        : e.kind === "settlement"
                          ? "Settlement"
                          : e.kind === "paypal_cashout"
                            ? "PayPal cash-out"
                            : e.kind === "reward"
                              ? "Bonus / Cashback"
                              : "Income"}
                    </span>
                  )}
                </td>
                <td className={shared ? "numeric" : "account-cell"}>
                  {shared ? (
                    isBudgetOutflow(e.kind) || e.kind === "refund" ? (
                      money(
                        e.kind === "refund" ? -e.chelseaCents : e.chelseaCents,
                      )
                    ) : (
                      "—"
                    )
                  ) : isTransfer(e.kind) ? (
                    <span className="transfer-route">
                      {account?.name}
                      <small>→ {destination?.name}</small>
                    </span>
                  ) : (
                    (account?.name ??
                    (e.kind === "settlement"
                      ? "PayPal · held"
                      : "Chelsea paid"))
                  )}
                </td>
                <td className="number">
                  {money(e.kind === "refund" ? -e.amountCents : e.amountCents)}
                </td>
                <td
                  className={`number emphasized ${shared ? (e.householdDeltaCents > 0 ? "positive" : "") : ""}`}
                >
                  {shared
                    ? `${e.householdDeltaCents > 0 ? "+" : "−"}${money(Math.abs(e.householdDeltaCents))}`
                    : e.kind === "unclassified"
                      ? "Awaiting review"
                      : isBudgetOutflow(e.kind) ||
                          e.kind === "refund" ||
                          e.kind === "paypal_cashout"
                        ? money(
                            e.kind === "refund" ? -e.jacobCents : e.jacobCents,
                          )
                        : "—"}
                </td>
                <td>
                  <button
                    className="row-edit"
                    aria-label={`Edit ${e.description}`}
                    onClick={() => edit(e)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Transactions({
  data,
  edit,
  add,
}: {
  data: Snapshot;
  edit: (e: Entry) => void;
  add: () => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const entries = data.entries.filter(
    (e) =>
      (kind === "all" || e.kind === kind) &&
      [
        e.description,
        e.note,
        ...(e.lines ?? []).flatMap((l) => [
          l.label,
          data.categories.find((c) => c.id === l.categoryId)?.name,
        ]),
        data.categories.find((c) => c.id === e.categoryId)?.name,
        data.accounts.find((a) => a.id === e.accountId)?.name,
        data.accounts.find((a) => a.id === e.destinationAccountId)?.name,
        e.payer,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="table-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="Search transactions"
            placeholder="Search merchant, category, or note…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter transaction type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="expense">Purchases</option>
          <option value="debt_payment">Loan/debt payments</option>
          <option value="reward">Rewards / credits</option>
          <option value="paypal_cashout">PayPal cash-outs</option>
          <option value="refund">Refunds</option>
          <option value="income">Income</option>
          <option value="settlement">Repayments</option>
          <option value="transfer">Bank transfers</option>
          <option value="card_payment">Card payments</option>
        </select>
        <span className="muted">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      <EntryTable entries={entries} data={data} edit={edit} emptyAction={add} />
      <div className="panel-footnote">
        Select a description to edit. Your budget counts your share; account
        activity keeps the full payment.
      </div>
    </section>
  );
}

function Budget({
  data,
  edit,
  saved,
}: {
  data: Snapshot;
  edit: (c: Category) => void;
  saved: (message: string) => Promise<void>;
}) {
  const [copy, setCopy] = useState(false);
  const categories = data.categories.filter(
    (c) =>
      !c.archived ||
      c.spentCents !== 0 ||
      !!c.provisionalCents ||
      (c.availableCents ?? c.limitCents) !== 0,
  );
  return (
    <>
      <MonthCloseControl
        key={`${data.workspace}:${data.month}`}
        data={data}
        saved={saved}
      />
      <div className="summary-strip">
        <div>
          <span>Planned</span>
          <strong>{money(data.budgetCents)}</strong>
        </div>
        <div>
          <span>Budget used</span>
          <strong>
            {money(
              (data.allowanceCents ?? data.spentCents) +
                (data.provisionalAllowanceCents ?? 0),
            )}
          </strong>
          {!!data.goalExcludedCents && (
            <small>
              Actual spending {money(data.spentCents)}; goal-funded exclusion{" "}
              {money(data.goalExcludedCents)}
            </small>
          )}
          {!!data.provisionalAllowanceCents && (
            <small>
              Includes {money(data.provisionalAllowanceCents)} awaiting split
            </small>
          )}
        </div>
        <div>
          <span>{data.remainingCents >= 0 ? "Remaining" : "Over budget"}</span>
          <strong className={data.remainingCents >= 0 ? "positive" : "over"}>
            {money(Math.abs(data.remainingCents))}
          </strong>
        </div>
        <p>
          Limits apply to {monthName(data.month)}.<br />
          {data.budgetConfigured
            ? "Monthly limits are saved independently of defaults."
            : "This month has no saved limits yet."}
        </p>
      </div>
      <div className="budget-copy-row">
        <p>
          Start with category defaults or copy an earlier month. Existing limits
          are kept unless you choose to replace them.
        </p>
        <button className="secondary" onClick={() => setCopy(true)}>
          Copy budget limits
        </button>
      </div>
      <div className="budget-group-grid">
        {["Needs", "Wants", "Other"].map((group) => (
          <section className="panel budget-group" key={group}>
            <div className="panel-heading">
              <h2>{group}</h2>
              <span className="small-tag">
                {categories.filter((c) => c.groupName === group).length}{" "}
                categories
              </span>
            </div>
            {categories
              .filter((c) => c.groupName === group)
              .map((c) => (
                <button
                  className="editable-budget"
                  key={c.id}
                  onClick={() => edit(c)}
                  disabled={c.archived}
                  aria-label={`Edit ${c.name} budget`}
                >
                  <CategoryBar category={c} />
                  <span className="edit-limit">
                    {c.archived ? (
                      "Archived · Restore in Accounts & categories to edit"
                    ) : (
                      <>
                        Edit limit <ChevronRight size={14} />
                      </>
                    )}
                  </span>
                </button>
              ))}
          </section>
        ))}
      </div>
      {copy && (
        <BudgetTemplateDialog
          data={data}
          saved={saved}
          close={() => setCopy(false)}
        />
      )}
      <div className="soft-note">
        Category rollover defaults to reset. Carry includes surplus and
        overspending. Review signed adjustments at month close; savings, bills
        and household balances persist independently.
      </div>
    </>
  );
}

function Shared({
  data,
  edit,
  settle,
  saved,
  cashout,
}: {
  data: Snapshot;
  edit: (e: Entry) => void;
  settle: () => void;
  cashout: () => void;
  saved: (m: string) => Promise<void>;
}) {
  return (
    <>
      <HouseholdTools data={data} saved={saved} cashout={cashout} />
      <section className="shared-hero">
        <div>
          <div className="avatars">
            <span className="avatar jacob">J</span>
            <span className="avatar chelsea">C</span>
            <span>Jacob & Chelsea</span>
          </div>
          <span className="balance-label">
            <BalanceText amount={data.householdCents} />
          </span>
          <div className="balance-value">
            {money(Math.abs(data.householdCents))}
          </div>
          <p>Net balance across all months · Includes repayments</p>
        </div>
        <div className="shared-hero-right">
          <div className="split-circle">
            70<span>/</span>30
          </div>
          <p>
            Default for shared expenses.
            <br />
            Every split can be changed.
          </p>
          <button
            className="primary"
            disabled={!data.householdCents}
            onClick={settle}
          >
            Record repayment <ArrowRight size={16} />
          </button>
        </div>
      </section>
      <SharedStatement data={data} edit={edit} saved={saved} />
    </>
  );
}

function BudgetDialog({
  category,
  data,
  close,
  saved,
}: {
  category: Category;
  data: Snapshot;
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(dollars(category.limitCents));
  const [mode, setMode] = useState(category.rolloverMode ?? "reset");
  const attempt = useRef({ payload: "", id: "" });
  function leave() {
    if (
      (amount !== dollars(category.limitCents) ||
        mode !== (category.rolloverMode ?? "reset")) &&
      !window.confirm("Discard the unsaved budget changes?")
    )
      return;
    close();
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={`Budget for ${category.name}`} onClose={leave} busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (category.rolloverToken) {
              const input = {
                month: data.month,
                category: category.id,
                amount,
                mode,
                policyToken: category.rolloverToken,
                previousLimitCents: category.limitCents,
              };
              const payload = JSON.stringify(input);
              if (attempt.current.payload !== payload)
                attempt.current = { payload, id: crypto.randomUUID() };
              await command("save_budget_plan", {
                workspace: data.workspace,
                input: { ...input, id: attempt.current.id },
              });
            } else {
              await command("set_budget", {
                workspace: data.workspace,
                month: data.month,
                category: category.id,
                amount,
              });
            }
            close();
            await saved("Monthly budget saved.");
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <p className="form-intro">
            Set your limit for {monthName(data.month)}. Shared expenses count
            only your share.
          </p>
          <label>
            Monthly limit ($)
            <input
              autoFocus
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {category.rolloverToken && (
            <>
              <label>
                Unused allowance and overspending
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "reset" | "carry")}
                >
                  <option value="reset">Reset each month</option>
                  <option value="carry">Carry the signed remainder</option>
                </select>
              </label>
              <p className="muted">
                Applies to this category starting {monthName(data.month)}, until
                a later saved policy change. Base limits stay separate from
                carry. Closed months require reopening.
              </p>
              <p>
                Incoming carry: {money(category.rolloverCents ?? 0)}. Available
                allowance: base limit plus incoming carry.
              </p>
            </>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <span className="spacer" />
            <button type="button" className="secondary" onClick={leave}>
              Cancel
            </button>
            <button className="primary" type="submit">
              {busy ? "Saving…" : "Save limit"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function backupLabel(name: string) {
  return `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)} at ${name.slice(9, 11)}:${name.slice(11, 13)}:${name.slice(13, 15)} UTC`;
}
function Settings({
  data,
  change,
  saved,
  theme,
  changeTheme,
  configure,
  handoff,
}: {
  handoff: (mode: "export" | "import") => void;
  data: Snapshot;
  change: (w: Workspace) => void;
  saved: (message: string) => Promise<void>;
  theme: ThemeId;
  changeTheme: (theme: ThemeId) => void;
  configure: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState("");
  const [error, setError] = useState("");
  async function backup() {
    setBusy(true);
    setError("");
    try {
      await command("create_backup", { workspace: data.workspace });
      await saved("Recovery backup created.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function restoreBackup() {
    setBusy(true);
    setError("");
    try {
      await command("restore_backup", {
        workspace: data.workspace,
        name: restore,
      });
      await saved("Backup restored. The previous state was backed up first.");
      setRestore("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid">
      <ThemePicker theme={theme} onChange={changeTheme} />
      <section className="panel settings-panel">
        <div className="panel-heading">
          <HelpHeading topic="workspace">
            <h2>Current workspace</h2>
          </HelpHeading>
          <Database size={19} />
        </div>
        <p>
          {data.workspace === "demo"
            ? "A separate workspace with illustrative data for testing application features."
            : "Your personal records, stored separately from sample data. Add transactions and configure monthly limits here."}
        </p>
        <div className="workspace-switch">
          <button
            disabled={busy}
            className={data.workspace === "demo" ? "selected" : ""}
            onClick={() => change("demo")}
          >
            <FlaskConical size={19} />
            <strong>Sample workspace</strong>
            <small>Test with sample records</small>
          </button>
          <button
            disabled={busy}
            className={data.workspace === "personal" ? "selected" : ""}
            onClick={() => change("personal")}
          >
            <Wallet size={19} />
            <strong>Personal workspace</strong>
            <small>Personal records</small>
          </button>
        </div>
        <h3>Storage on this PC</h3>
        <code className="data-path">{data.dataPath}</code>
        <div className="soft-note">
          Uses your Windows account’s protection. The live database and local
          recovery copies do not have a separate app passphrase. Keep them on
          this PC. Use encrypted handoff files when moving to another computer.
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h2>Your accounts</h2>
          <button className="text-button" onClick={configure}>
            Manage accounts <ArrowRight size={15} />
          </button>
        </div>
        <p>
          Recorded activity only, without opening balances or imported
          statements. These are not your current bank balances.
        </p>
        <div className="account-list">
          {data.accounts.map((a) => (
            <div key={a.id}>
              <span className="account-badge">
                <AccountIcon kind={a.kind} />
              </span>
              <div>
                <strong>
                  {a.name}
                  {a.archived ? " · Archived" : ""}
                </strong>
                <small>
                  {a.kind === "credit"
                    ? "Change in card debt"
                    : a.kind === "savings"
                      ? "Change in savings cash"
                      : "Change in checking cash"}
                </small>
              </div>
              <strong className="numeric">
                {a.activityCents < 0 ? "−" : "+"}
                {money(Math.abs(a.activityCents))}
              </strong>
            </div>
          ))}
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <HelpHeading topic="handoff">
            <h2>Laptop handoff</h2>
          </HelpHeading>
          <LockKeyhole size={19} />
        </div>
        <p>
          Move this workspace between computers with an encrypted file. Work on
          one computer at a time; review any conflicting changes before
          importing.
        </p>
        <p>
          Each file includes your records and source documents. Passphrases are
          required. API keys and device preferences stay on this PC.
        </p>
        <div className="dialog-actions">
          <button className="secondary" onClick={() => handoff("export")}>
            Export handoff
          </button>
          <button className="primary" onClick={() => handoff("import")}>
            Import handoff
          </button>
        </div>
      </section>
      <ManagedBackups
        key={data.workspace}
        workspace={data.workspace}
        saved={saved}
      />
      <section className="panel settings-panel backup-panel">
        <div className="panel-heading">
          <div>
            <HelpHeading topic="recovery">
              <h2>Recovery backups</h2>
            </HelpHeading>
            <p>
              20 automatic copies retained · Handoff recovery copies kept
              separately
            </p>
          </div>
          <button className="secondary" disabled={busy} onClick={backup}>
            {busy ? "Working…" : "Back up now"}
          </button>
        </div>
        {error && !restore && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {data.backups.length ? (
          <div className="backup-list">
            {data.backups.map((b, i) => (
              <div key={b}>
                <ShieldCheck size={17} />
                <div>
                  {backupLabel(b)}
                  <small>
                    {b.endsWith(".managed.sqlite")
                      ? "Preserved before folder-backup restore · excluded from automatic rotation"
                      : b.endsWith(".handoff.sqlite")
                        ? "Preserved before handoff · excluded from automatic rotation"
                        : i === 0
                          ? "Most recent recovery point"
                          : "Local recovery point"}
                  </small>
                </div>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setRestore(b);
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">
            Your first change will create a recovery point. You can also make
            one now.
          </p>
        )}
      </section>
      <section className="build-note">
        <CircleHelp size={20} />
        <div>
          <h3>Preview capabilities</h3>
          <p>
            Manual entries, budgets, shared expenses, bank transfers, card
            payments, reviewed imports, merchant rules, refunds, recurring
            bills, payment matching, account-backed savings goals, and local
            recovery, month close/reopen, and annual reports are available.
            Budget rollover, cash forecasts, reviewed optional AI assistance,
            and encrypted laptop handoff are also available.
          </p>
        </div>
      </section>
      {restore && (
        <Modal
          title="Restore this recovery point?"
          busy={busy}
          onClose={() => setRestore("")}
        >
          <div className="restore-content">
            <p>
              Restore this workspace to <strong>{backupLabel(restore)}</strong>?
              Changes made after that point will leave the active workspace.
            </p>
            <p>
              Your current data will be backed up first so you can recover it.
            </p>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <div className="dialog-actions">
              <button
                disabled={busy}
                className="secondary"
                onClick={() => setRestore("")}
              >
                Cancel
              </button>
              <button
                disabled={busy}
                className="primary"
                onClick={restoreBackup}
              >
                {busy ? "Restoring…" : "Restore backup"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
