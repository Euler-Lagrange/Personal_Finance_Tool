import { useEffect, useState } from "react";
import { Plus, WandSparkles } from "lucide-react";
import { Modal } from "./EntryDialog";
import { command } from "./api";
import type { Snapshot } from "./types";
import "./rules.css";
export interface MerchantRule {
  id: string;
  revision: number;
  name: string;
  merchant: string;
  matchMode: string;
  accountId: string | null;
  descriptionContains: string;
  categoryScope?: string;
  categoryAction: string;
  categoryId: string | null;
  ownershipAction: string;
  splitMode: string;
  splitValue: string;
  enabled: boolean;
}
export function newRule(
  merchant = "",
  accountId: string | null = null,
  categoryId: string | null = null,
  splitMode = "personal",
  splitValue = "",
): MerchantRule {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    name: merchant.slice(0, 100),
    merchant,
    matchMode: "exact",
    accountId,
    descriptionContains: "",
    categoryScope: "any",
    categoryAction: categoryId ? "set" : "ask",
    categoryId,
    ownershipAction: [
      "personal",
      "shared",
      "equal",
      "chelsea",
      "percent",
    ].includes(splitMode)
      ? "set"
      : "ask",
    splitMode: ["personal", "shared", "equal", "chelsea", "percent"].includes(
      splitMode,
    )
      ? splitMode
      : "personal",
    splitValue: splitMode === "percent" ? splitValue : "",
    enabled: true,
  };
}
export function RuleEditor({
  data,
  initial,
  close,
  saved,
}: {
  data: Snapshot;
  initial: MerchantRule;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [rule, setRule] = useState(initial),
    [preview, setPreview] = useState<{
      count: number;
      examples: string[];
      key: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = JSON.stringify(rule);
  function update<K extends keyof MerchantRule>(
    key: K,
    value: MerchantRule[K],
  ) {
    setRule((r) => {
      const next = { ...r, [key]: value };
      if (key === "categoryScope" && value !== "any") {
        next.ownershipAction = "leave";
        if (next.categoryAction === "leave") next.categoryAction = "set";
      }
      if (key === "categoryAction" && value === "leave")
        next.categoryScope = "any";
      return next;
    });
    setPreview(null);
  }
  async function inspect() {
    setBusy(true);
    setError("");
    try {
      const p = await command<{ count: number; examples: string[] }>(
        "preview_rule",
        { workspace: data.workspace, rule },
      );
      setPreview({ ...p, key });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (preview?.key !== key) return;
    setBusy(true);
    setError("");
    try {
      await command("save_rule", { workspace: data.workspace, rule });
      close();
      await saved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={rule.revision ? "Edit merchant rule" : "Remember merchant"}
      onClose={close}
      busy={busy}
    >
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <p className="form-intro">
            Suggestions apply to unprocessed purchases. Saved transactions and
            manual choices stay unchanged. Matching ignores case and punctuation
            but keeps numbers.
          </p>
          <label>
            Rule name
            <input
              required
              maxLength={100}
              value={rule.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              Merchant phrase
              <input
                required
                minLength={2}
                maxLength={200}
                value={rule.merchant}
                onChange={(e) => update("merchant", e.target.value)}
              />
            </label>
            <label>
              Match
              <select
                value={rule.matchMode}
                onChange={(e) => update("matchMode", e.target.value)}
              >
                <option value="exact">Entire normalized description</option>
                <option value="prefix">
                  Description starts with this phrase
                </option>
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>
              Account scope
              <select
                value={rule.accountId ?? ""}
                onChange={(e) => update("accountId", e.target.value || null)}
              >
                <option value="">All accounts</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description also contains (optional)
              <input
                maxLength={200}
                value={rule.descriptionContains}
                onChange={(e) => update("descriptionContains", e.target.value)}
              />
            </label>
          </div>
          <label>
            Category applies when
            <select
              value={rule.categoryScope ?? "any"}
              onChange={(e) => update("categoryScope", e.target.value)}
            >
              <option value="any">Any sharing state</option>
              <option value="personal">Personal - Jacob 100%</option>
              <option value="shared">Shared between Jacob and Chelsea</option>
              <option value="chelsea">Chelsea 100%</option>
            </select>
            <small>
              For different personal/shared categories, save a rule for each
              state. Conditional category rules leave sharing unchanged.
            </small>
          </label>
          <div className="form-grid">
            <label>
              Category action
              <select
                value={rule.categoryAction}
                onChange={(e) => update("categoryAction", e.target.value)}
              >
                <option value="set">Set category</option>
                <option value="ask">Ask each time</option>
                <option value="leave">Leave category unchanged</option>
              </select>
            </label>
            <label>
              Sharing action
              <select
                disabled={(rule.categoryScope ?? "any") !== "any"}
                value={rule.ownershipAction}
                onChange={(e) => update("ownershipAction", e.target.value)}
              >
                <option value="set">Set sharing</option>
                <option value="ask">Ask each time</option>
                <option value="leave">Leave sharing unchanged</option>
              </select>
            </label>
          </div>
          {rule.categoryAction === "set" && (
            <label>
              Category
              <select
                required
                value={rule.categoryId ?? ""}
                onChange={(e) => update("categoryId", e.target.value || null)}
              >
                <option value="">Choose category</option>
                {data.categories
                  .filter((c) => !c.archived || c.id === rule.categoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.archived ? " (archived)" : ""}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {rule.ownershipAction === "set" && (
            <>
              <label>
                Sharing preset
                <select
                  value={rule.splitMode}
                  onChange={(e) => update("splitMode", e.target.value)}
                >
                  <option value="personal">Jacob 100% · personal</option>
                  <option value="shared">Jacob 70% / Chelsea 30%</option>
                  <option value="equal">Equal 50 / 50</option>
                  <option value="chelsea">Chelsea 100%</option>
                  <option value="percent">Custom Jacob percentage</option>
                </select>
              </label>
              {rule.splitMode === "percent" && (
                <label>
                  Jacob percentage
                  <input
                    required
                    inputMode="decimal"
                    value={rule.splitValue}
                    onChange={(e) => update("splitValue", e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <label className="import-check">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => update("enabled", e.target.checked)}
            />{" "}
            Rule enabled
          </label>
          <p className="form-intro">
            For each field, description constraints outrank account constraints,
            then exact matches outrank prefixes. Within the same specificity, a
            matching sharing condition outranks an unconditional category.
            Equally specific disagreements ask for review. Rules never infer
            refunds or payments.
          </p>
          {preview?.key === key && (
            <div className="rule-preview">
              <strong>
                {preview.count} held row(s) match merchant conditions
              </strong>
              {preview.examples.map((s, i) => (
                <p key={i}>{s}</p>
              ))}
              <small>
                Preview shows up to eight merchant matches. Sharing and
                transaction checks determine whether the rule applies. Saving
                creates suggestions; it does not post these rows.
              </small>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => void inspect()}
            >
              Preview matches
            </button>
            <button className="primary" disabled={preview?.key !== key}>
              {busy ? "Saving…" : "Save rule"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
export default function Rules({
  data,
  saved,
}: {
  data: Snapshot;
  saved: (message: string) => Promise<void>;
}) {
  const [rules, setRules] = useState<MerchantRule[]>([]),
    [editing, setEditing] = useState<MerchantRule | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    command<MerchantRule[]>("list_rules", { workspace: data.workspace })
      .then((r) => {
        if (alive) setRules(r ?? []);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [data.workspace]);
  async function reload() {
    try {
      setRules(
        await command<MerchantRule[]>("list_rules", {
          workspace: data.workspace,
        }),
      );
      setError("");
      await saved(
        "Merchant rule saved. Reopen an import to see updated suggestions.",
      );
    } catch (e) {
      setError(`Rule saved; list could not reload. ${String(e)}`);
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Merchant rules</h2>
          <p>Reusable category and sharing suggestions, stored on this PC.</p>
        </div>
        <button className="primary" onClick={() => setEditing(newRule())}>
          <Plus size={16} /> New rule
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!rules.length && (
        <div className="import-empty">
          <WandSparkles size={30} />
          <h3>Tag a merchant once</h3>
          <p>
            Use “Remember merchant” during import review, or create a rule here.
            Mixed-purpose merchants can ask for category or sharing.
          </p>
        </div>
      )}
      {rules.map((r) => (
        <button className="rule-item" key={r.id} onClick={() => setEditing(r)}>
          <WandSparkles size={20} />
          <span>
            <strong>{r.name}</strong>
            <small>
              {r.matchMode === "exact" ? "Exact" : "Starts with"}: {r.merchant}{" "}
              ·{" "}
              {data.accounts.find((a) => a.id === r.accountId)?.name ??
                "All accounts"}
            </small>
            <small>
              Category:{" "}
              {r.categoryAction === "set"
                ? data.categories.find((c) => c.id === r.categoryId)?.name
                : r.categoryAction}{" "}
              {(r.categoryScope ?? "any") !== "any"
                ? ` when ${r.categoryScope}`
                : ""}
              · Sharing:{" "}
              {r.ownershipAction === "set" ? r.splitMode : r.ownershipAction}
            </small>
          </span>
          <span className="import-chip">
            {r.enabled ? "Enabled" : "Disabled"}
          </span>
        </button>
      ))}
      {editing && (
        <RuleEditor
          data={data}
          initial={editing}
          close={() => setEditing(null)}
          saved={reload}
        />
      )}
    </section>
  );
}
