import { HelpHeading } from "./HelpTip";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Plus, PiggyBank, X } from "lucide-react";
import { command, dollars, money } from "./api";
import { Modal } from "./EntryDialog";
import Balances from "./Balances";
import type { Account, Entry, Snapshot } from "./types";
import "./goals.css";

function goalDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
interface Goal {
  id: string;
  revision: number;
  name: string;
  accountId: string;
  accountName: string;
  accountArchived: boolean;
  targetCents: number;
  targetDate: string | null;
  monthlyCents: number;
  policy: "goal_only" | "count_monthly";
  archived: boolean;
  balance: Account["balance"];
}
interface GoalDraft {
  id: string;
  revision: number;
  name: string;
  accountId: string;
  target: string;
  targetDate: string | null;
  monthly: string;
  policy: Goal["policy"];
  archived: boolean;
}
interface Funding {
  id: string;
  eventId: string;
  lineId: string;
  goalId: string;
  amountCents: number;
  policy: Goal["policy"];
  withdrawalId: string | null;
  reviewed: boolean;
  reason: string;
}
interface FundingDraft {
  id: string;
  lineId: string;
  goalId: string;
  goalRevision: number;
  amount: string;
  withdrawalId: string | null;
}
interface FundingView {
  entry: Entry;
  rows: Funding[];
  withdrawals: {
    id: string;
    goalId: string;
    date: string;
    description: string;
    amountCents: number;
    availableCents: number;
  }[];
}
interface Activity {
  id: string;
  revision: number;
  date: string;
  description: string;
  changeCents: number;
  purpose: string;
  canLabelInterest: boolean;
}
function useGoals(data: Snapshot) {
  const [goals, setGoals] = useState<Goal[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    command<Goal[]>("list_goals", { workspace: data.workspace })
      .then((items) => {
        if (alive) setGoals(items ?? []);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [data]);
  return { goals, error };
}
const policyName = (policy: Goal["policy"]) =>
  policy === "goal_only"
    ? "Use goal budget only"
    : "Also use monthly category allowance";
export function GoalOverview({
  data,
  open,
}: {
  data: Snapshot;
  open: () => void;
}) {
  const { goals, error } = useGoals(data);
  const active = (goals ?? []).filter((g) => !g.archived);
  return (
    <section className="panel goal-overview">
      <div className="panel-heading">
        <div>
          <HelpHeading topic="goals">
            <h2>Savings goals</h2>
          </HelpHeading>
          <p>Real account balances and planned contributions.</p>
        </div>
        <button className="text-button" onClick={open}>
          View goals <ArrowRight size={15} />
        </button>
      </div>
      <div className="goal-overview-items">
        {error ? (
          <p role="alert">Goals could not load. Open Savings goals to retry.</p>
        ) : goals === null ? (
          <p>Loading goals...</p>
        ) : !active.length ? (
          <p className="muted">
            Add your separate savings accounts, then attach a goal to each.
          </p>
        ) : (
          active.slice(0, 4).map((g) => (
            <div key={g.id}>
              <span>{g.name}</span>
              <strong>
                {g.balance
                  ? money(g.balance.estimatedCents)
                  : "Balance unknown"}
              </strong>
              <small>
                {money(g.targetCents)} target ·{" "}
                {g.balance ? "estimated balance" : "checkpoint needed"}
              </small>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
export default function Goals({
  data,
  saved,
  setup,
  move,
}: {
  data: Snapshot;
  saved: (message: string) => Promise<void>;
  setup: () => void;
  move: () => void;
}) {
  const { goals, error } = useGoals(data);
  const [editing, setEditing] = useState<GoalDraft | null>(null),
    [archived, setArchived] = useState(false),
    [history, setHistory] = useState<Goal | null>(null),
    [balance, setBalance] = useState<Account | null>(null),
    [funding, setFunding] = useState<string | null>(null),
    [search, setSearch] = useState("");
  const eligible = data.accounts.filter(
    (a) =>
      a.kind === "savings" &&
      !a.archived &&
      !(goals ?? []).some((g) => g.accountId === a.id),
  );
  const purchaseEntries = [
    ...new Map(
      [...data.entries, ...(data.fundingReviewEntries ?? [])].map((e) => [
        e.id,
        e,
      ]),
    ).values(),
  ];
  const purchases = purchaseEntries.filter(
    (e) =>
      ["expense", "debt_payment"].includes(e.kind) &&
      e.jacobCents > 0 &&
      `${e.description} ${e.date}`.toLowerCase().includes(search.toLowerCase()),
  );
  function edit(g: Goal) {
    setEditing({
      id: g.id,
      revision: g.revision,
      name: g.name,
      accountId: g.accountId,
      target: dollars(g.targetCents),
      targetDate: g.targetDate,
      monthly: dollars(g.monthlyCents),
      policy: g.policy,
      archived: g.archived,
    });
  }
  return (
    <div className="goals-page">
      <div className="goal-toolbar">
        <button
          className="primary"
          disabled={!goals || !eligible.length}
          onClick={() =>
            setEditing({
              id: crypto.randomUUID(),
              revision: 0,
              name: "",
              accountId: eligible[0]?.id ?? "",
              target: "",
              targetDate: null,
              monthly: "0.00",
              policy: "goal_only",
              archived: false,
            })
          }
        >
          <Plus size={17} /> New goal
        </button>
        <button className="secondary" onClick={setup}>
          Manage accounts
        </button>
        <button className="secondary" onClick={move}>
          Record savings transfer
        </button>
        <label className="import-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          Show archived goals
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {goals === null && !error && <p>Loading savings goals...</p>}
      {!!goals && !eligible.length && (
        <p className="form-intro">
          Each goal uses a separate savings account. Add another savings account
          in Accounts & categories when needed.
        </p>
      )}
      {goals?.length === 0 && (
        <section className="panel goal-empty">
          <PiggyBank size={30} />
          <h2>Your savings, by purpose</h2>
          <p>
            Create a goal for Gift, PTO, your emergency fund or another separate
            account. A goal does not create a bank balance or move money.
          </p>
        </section>
      )}
      <div className="goal-grid">
        {(goals ?? [])
          .filter((g) => archived || !g.archived)
          .map((g) => (
            <section className="panel goal-card" key={g.id}>
              <div className="goal-card-heading">
                <PiggyBank size={22} />
                <div>
                  <h2>{g.name}</h2>
                  <small>
                    {g.accountName}
                    {g.archived ? " · archived" : ""}
                  </small>
                </div>
                <button
                  className="text-button"
                  onClick={() => edit(g)}
                  aria-label={`Edit ${g.name}`}
                >
                  Edit
                </button>
              </div>
              <div className="goal-value">
                {g.balance
                  ? money(g.balance.estimatedCents)
                  : "Balance unknown"}
                <small>of {money(g.targetCents)} target</small>
              </div>
              {g.balance && (
                <div className="track">
                  <span
                    style={{
                      width: `${Math.max(0, Math.min(100, (g.balance.estimatedCents / g.targetCents) * 100))}%`,
                    }}
                  />
                </div>
              )}
              <p className="muted">
                {g.balance
                  ? `Estimate through ${goalDate(g.balance.throughDate)} · checkpoint ${goalDate(g.balance.checkpointDate)}`
                  : "Add a dated balance before relying on available goal funds."}
              </p>
              <div className="goal-facts">
                <span>{money(g.monthlyCents)} planned per month</span>
                <span>
                  {g.targetDate
                    ? `Target ${goalDate(g.targetDate)}`
                    : "No target date"}
                </span>
                <span>{policyName(g.policy)}</span>
              </div>
              <div className="goal-card-actions">
                <button className="secondary" onClick={() => setHistory(g)}>
                  Activity
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    setBalance(
                      data.accounts.find((a) => a.id === g.accountId) ?? null,
                    )
                  }
                >
                  Balances
                </button>
              </div>
            </section>
          ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <HelpHeading topic="goalFunding">
              <h2>Fund purchases from goals</h2>
            </HelpHeading>
            <p>
              Purchases stay in spending history. Eligible goal-only funding
              reduces only your monthly allowance usage.
            </p>
          </div>
        </div>
        <div className="goal-purchases">
          <label>
            Search purchases and funding to review
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {!purchases.length && (
            <p className="muted">
              No matching purchases with your share in this month. Record or
              import the purchase first, or choose another month above.
            </p>
          )}
          {purchases.slice(0, 250).map((e) => (
            <div className="goal-purchase" key={e.id}>
              <div>
                <strong>{e.description}</strong>
                <small>
                  {goalDate(e.date)} · your share {money(e.jacobCents)} · full
                  amount {money(e.amountCents)}
                </small>
              </div>
              <button
                className="secondary"
                disabled={!goals}
                onClick={() => setFunding(e.id)}
                aria-label={`Funding for ${e.description}`}
              >
                Goal funding
              </button>
            </div>
          ))}
          {purchases.length > 250 && (
            <small>
              Showing 250 matching purchases. Narrow the search to find another.
            </small>
          )}
        </div>
      </section>
      {editing && (
        <GoalEditor
          data={data}
          initial={editing}
          eligible={eligible}
          close={() => setEditing(null)}
          saved={saved}
        />
      )}
      {history && (
        <GoalHistory
          data={data}
          goal={history}
          close={() => setHistory(null)}
          saved={saved}
        />
      )}
      {balance && (
        <Balances
          account={balance}
          workspace={data.workspace}
          close={() => setBalance(null)}
          saved={saved}
        />
      )}
      {funding && goals && (
        <FundingDialog
          key={funding}
          data={data}
          event={funding}
          goals={goals}
          close={() => setFunding(null)}
          saved={saved}
        />
      )}
    </div>
  );
}
function GoalEditor({
  data,
  initial,
  eligible,
  close,
  saved,
}: {
  data: Snapshot;
  initial: GoalDraft;
  eligible: Account[];
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const [input, setInput] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const update = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) =>
    setInput((i) => ({ ...i, [key]: value }));
  function requestClose() {
    if (
      !busy &&
      (JSON.stringify(input) === JSON.stringify(initial) ||
        window.confirm("Discard the unsaved goal changes?"))
    )
      close();
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await command("save_goal", { workspace: data.workspace, input });
      close();
      await saved(
        "Savings goal saved. Existing purchase policies are unchanged.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const choices = initial.revision
    ? data.accounts.filter((a) => a.id === initial.accountId)
    : eligible;
  return (
    <Modal
      title={initial.revision ? "Edit savings goal" : "New savings goal"}
      onClose={requestClose}
      busy={busy}
    >
      <form onSubmit={(e) => void save(e)}>
        <fieldset disabled={busy}>
          <p className="form-intro">
            A goal uses its account's real balance. Targets and contribution
            plans do not move money.
          </p>
          <label>
            Goal name
            <input
              required
              maxLength={100}
              value={input.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>
          <label>
            Savings account
            <select
              disabled={!!initial.revision}
              value={input.accountId}
              onChange={(e) => update("accountId", e.target.value)}
            >
              {choices.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              Target amount
              <input
                required
                inputMode="decimal"
                value={input.target}
                onChange={(e) => update("target", e.target.value)}
              />
            </label>
            <label>
              Target date (optional)
              <input
                type="date"
                value={input.targetDate ?? ""}
                onChange={(e) => update("targetDate", e.target.value || null)}
              />
            </label>
          </div>
          <label>
            Monthly contribution plan
            <input
              required
              inputMode="decimal"
              value={input.monthly}
              onChange={(e) => update("monthly", e.target.value)}
            />
          </label>
          <label>
            Funded purchase policy
            <select
              value={input.policy}
              onChange={(e) =>
                update("policy", e.target.value as Goal["policy"])
              }
            >
              <option value="goal_only">Use goal budget only</option>
              <option value="count_monthly">
                Also use monthly category allowance
              </option>
            </select>
          </label>
          <p className="form-intro">
            Actual spending always includes the purchase. This default applies
            to new funding assignments; existing assignments keep their saved
            policy.
          </p>
          {!!initial.revision && (
            <label className="import-check">
              <input
                type="checkbox"
                checked={input.archived}
                onChange={(e) => update("archived", e.target.checked)}
              />{" "}
              Archive goal (keep history)
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={requestClose}>
              Cancel
            </button>
            <button className="primary">
              {busy ? "Saving..." : "Save goal"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function GoalHistory({
  data,
  goal,
  close,
  saved,
}: {
  data: Snapshot;
  goal: Goal;
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const [items, setItems] = useState<Activity[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    command<Activity[]>("goal_activity", {
      workspace: data.workspace,
      goal: goal.id,
    })
      .then((r) => {
        if (alive) setItems(r);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [data.workspace, goal.id, reload]);
  async function label(item: Activity) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await command("label_goal_interest", {
        workspace: data.workspace,
        goal: goal.id,
        event: item.id,
        revision: item.revision,
        interest: item.purpose !== "Interest",
      });
      setReload((x) => x + 1);
      await saved(
        "Savings income label updated. Account balance is unchanged.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${goal.name} activity`} onClose={close} busy={busy}>
      <div className="goal-history">
        <p>
          Contributions, withdrawals and transfers between goals reflect
          recorded account activity. Funding assignments do not create
          additional cash movements.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {items === null ? (
          <p>Loading activity...</p>
        ) : !items.length ? (
          <p>
            No recorded account activity. A balance checkpoint is separate from
            income and transfers.
          </p>
        ) : (
          items.map((a) => (
            <div className="goal-purchase" key={a.id}>
              <div>
                <strong>{a.description}</strong>
                <small>
                  {goalDate(a.date)} · {a.purpose}
                </small>
                {a.canLabelInterest && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void label(a)}
                  >
                    {a.purpose === "Interest"
                      ? "Remove interest label"
                      : "Mark as interest"}
                  </button>
                )}
              </div>
              <strong>{money(a.changeCents)}</strong>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
function FundingDialog({
  data,
  event,
  goals,
  close,
  saved,
}: {
  data: Snapshot;
  event: string;
  goals: Goal[];
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const [view, setView] = useState<FundingView | null>(null),
    [rows, setRows] = useState<FundingDraft[]>([]),
    [initial, setInitial] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const operation = useRef({ key: "", id: "" });
  useEffect(() => {
    let alive = true;
    command<FundingView>("funding_view", { workspace: data.workspace, event })
      .then((v) => {
        if (!alive) return;
        setView(v);
        const draft = v.rows.map((r) => ({
          id: r.id,
          lineId: r.lineId,
          goalId: r.goalId,
          goalRevision: goals.find((g) => g.id === r.goalId)?.revision ?? 0,
          amount: dollars(r.amountCents),
          withdrawalId: r.withdrawalId,
        }));
        setRows(draft);
        setInitial(JSON.stringify(draft));
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [data.workspace, event]);
  function change(next: FundingDraft[]) {
    setRows(next);
    setConfirmed(false);
  }
  function patch(id: string, next: Partial<FundingDraft>) {
    change(rows.map((r) => (r.id === id ? { ...r, ...next } : r)));
  }
  function requestClose() {
    if (
      !busy &&
      (!view ||
        JSON.stringify(rows) === initial ||
        window.confirm("Discard the unsaved funding assignments?"))
    )
      close();
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!view || busy || !confirmed) return;
    const payload = {
      eventId: event,
      revision: view.entry.revision,
      confirmed,
      rows,
    };
    const key = JSON.stringify(payload);
    if (operation.current.key !== key)
      operation.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await command("save_funding", {
        workspace: data.workspace,
        request: { id: operation.current.id, ...payload },
      });
      close();
      await saved(
        "Funding saved. Assignments without supporting evidence remain flagged and do not reduce monthly allowance.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const active = goals.filter((g) => !g.archived && !g.accountArchived);
  return (
    <Modal title="Goal funding" onClose={requestClose} busy={busy}>
      <form onSubmit={(e) => void save(e)}>
        <fieldset disabled={busy}>
          {view ? (
            <>
              <p className="form-intro">
                <strong>{view.entry.description}</strong>
                <br />
                {goalDate(view.entry.date)} · full spending{" "}
                {money(view.entry.amountCents)} · your share{" "}
                {money(view.entry.jacobCents)}
              </p>
              <p className="form-intro">
                Assign only your share of each charge. Link an actual savings
                withdrawal to checking, a payment from the goal to this card, or
                a purchase paid directly by the goal account. Unknown or
                insufficient funding stays flagged.
              </p>
              {!goals.length && (
                <p>Add a savings goal before assigning funding.</p>
              )}
              {rows.map((r, i) => {
                const g = goals.find((g) => g.id === r.goalId);
                const previous = view.rows.find(
                  (f) => f.id === r.id && f.goalId === r.goalId,
                );
                return (
                  <section
                    className="funding-row"
                    key={r.id}
                    aria-label={`Funding assignment ${i + 1}`}
                  >
                    <div className="funding-heading">
                      <h3>Assignment {i + 1}</h3>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove assignment ${i + 1}`}
                        onClick={() =>
                          change(rows.filter((x) => x.id !== r.id))
                        }
                      >
                        <X size={17} />
                      </button>
                    </div>
                    <label>
                      Purchase line
                      <select
                        value={r.lineId}
                        onChange={(e) =>
                          patch(r.id, { lineId: e.target.value })
                        }
                      >
                        {(view.entry.lines ?? [])
                          .filter((l) => l.jacobCents > 0)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.label ||
                                data.categories.find(
                                  (c) => c.id === l.categoryId,
                                )?.name ||
                                "Purchase"}{" "}
                              · your share {money(l.jacobCents)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="form-grid">
                      <label>
                        Goal
                        <select
                          value={r.goalId}
                          onChange={(e) => {
                            const g = goals.find(
                              (g) => g.id === e.target.value,
                            )!;
                            patch(r.id, {
                              goalId: g.id,
                              goalRevision: g.revision,
                              withdrawalId: null,
                            });
                          }}
                        >
                          {goals
                            .filter(
                              (g) =>
                                (!g.archived && !g.accountArchived) ||
                                g.id === r.goalId,
                            )
                            .map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                                {g.archived ? " (archived)" : ""}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Funded amount
                        <input
                          required
                          inputMode="decimal"
                          value={r.amount}
                          onChange={(e) =>
                            patch(r.id, { amount: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Funding evidence
                      <select
                        value={r.withdrawalId ?? ""}
                        onChange={(e) =>
                          patch(r.id, { withdrawalId: e.target.value || null })
                        }
                      >
                        <option value="">
                          {g?.accountId === view.entry.accountId
                            ? "Paid directly from this goal account"
                            : "Withdrawal not linked yet"}
                        </option>
                        {view.withdrawals
                          .filter((w) => w.goalId === r.goalId)
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              {goalDate(w.date)} · {w.description} ·{" "}
                              {money(w.availableCents)} available to assign
                            </option>
                          ))}
                      </select>
                    </label>
                    <small>
                      Policy saved with this assignment:{" "}
                      {policyName(previous?.policy ?? g?.policy ?? "goal_only")}
                    </small>
                    {previous && g && previous.policy !== g.policy && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          change(
                            rows.map((x) =>
                              x.id === r.id
                                ? { ...x, id: crypto.randomUUID() }
                                : x,
                            ),
                          )
                        }
                      >
                        Use current goal policy
                      </button>
                    )}
                    {!!previous?.reason && (
                      <p className="funding-warning">
                        Saved assignment needs review: {previous.reason}
                      </p>
                    )}
                  </section>
                );
              })}
              <button
                type="button"
                className="secondary"
                disabled={!active.length || rows.length >= 100}
                onClick={() =>
                  change([
                    ...rows,
                    {
                      id: crypto.randomUUID(),
                      goalId: active[0].id,
                      goalRevision: active[0].revision,
                      lineId:
                        view.entry.lines?.find((l) => l.jacobCents > 0)?.id ??
                        "main",
                      amount: "",
                      withdrawalId: null,
                    },
                  ])
                }
              >
                <Plus size={16} /> Add funding assignment
              </button>
              <label className="import-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                I reviewed these assignments. Unsupported funding will stay
                flagged.
              </label>
              <p className="form-intro">
                Refunds use the original assignment policy. Returning cash to
                savings requires a separate actual transfer. Remove assignments
                here before changing a funded purchase or withdrawal.
              </p>
            </>
          ) : (
            !error && <p>Loading purchase funding...</p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={requestClose}>
              Cancel
            </button>
            <button className="primary" disabled={!view || !confirmed}>
              {busy ? "Saving..." : "Save funding"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
