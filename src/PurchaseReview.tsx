import { useEffect, useRef, useState } from "react";
import { command, dollars, money } from "./api";
import CategorySuggestion from "./CategorySuggestion";
import { Modal } from "./EntryDialog";
import { RuleEditor, newRule, type MerchantRule } from "./Rules";
import type { Entry, Snapshot } from "./types";
import type { ImportDetail } from "./importTypes";
import "./purchase-review.css";

interface Item {
  rowId: string;
  merchant: string;
  entry: Entry;
  reason: string;
}
interface Choice {
  merchant: string;
  date: string;
  categoryId: string;
  splitMode: string;
  splitValue: string;
}
interface View {
  items: Item[];
  previous: Choice[];
  undoId: string | null;
}
interface Preview {
  count: number;
  beforeAllowanceCents: number;
  afterAllowanceCents: number;
  afterProvisionalCents: number;
  householdChangeCents: number;
}
const sharingNames: Record<string, string> = {
  personal: "Jacob 100%",
  shared: "Jacob 70% / Chelsea 30%",
  equal: "Equal 50 / 50",
  chelsea: "Chelsea 100%",
};
function sharing(mode: string, value: string) {
  return (
    sharingNames[mode] ??
    (mode === "percent"
      ? `${value}% Jacob`
      : mode === "exact"
        ? `$${value} Jacob`
        : "Awaiting split")
  );
}
export default function PurchaseReview({
  detail,
  data,
  close,
  changed,
}: {
  detail: ImportDetail;
  data: Snapshot;
  close: () => void;
  changed: (message: string) => Promise<void>;
}) {
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [filter, setFilter] = useState("");
  const [category, setCategory] = useState(""),
    [mode, setMode] = useState(""),
    [percent, setPercent] = useState("");
  const [preview, setPreview] = useState<{
      key: string;
      value: Preview;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const [rule, setRule] = useState<MerchantRule | null>(null),
    [notice, setNotice] = useState("");
  const attempt = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    command<View>("purchase_review", {
      workspace: data.workspace,
      source: detail.source.id,
    })
      .then((v) => {
        if (active) setView(v);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [data.workspace, detail.source.id, detail.source.revision]);
  const picked = view?.items.filter((r) => selected.has(r.entry.id)) ?? [];
  const merchants = [...new Set(picked.map((r) => r.merchant))];
  const previous =
    merchants.length === 1
      ? view?.previous.find((c) => c.merchant === merchants[0])
      : undefined;
  const payload = {
    sourceId: detail.source.id,
    sourceRevision: detail.source.revision,
    rows: picked.map((r) => ({
      rowId: r.rowId,
      eventId: r.entry.id,
      revision: r.entry.revision,
    })),
    changes: {
      categoryId: category || null,
      splitMode: mode || null,
      splitValue: mode === "percent" ? percent : "",
    },
  };
  const key = JSON.stringify(payload),
    validPreview = preview?.key === key;
  const dirty = selected.size > 0 || !!category || !!mode;
  function request() {
    if (attempt.current?.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    return { id: attempt.current.id, ...payload, confirmed: true };
  }
  function invalidate() {
    setPreview(null);
    setConfirmed(false);
  }
  function setSharing(value: string) {
    setMode(value);
    invalidate();
  }
  function toggle(items: Item[]) {
    const eligible = items.filter((r) => !r.reason);
    setSelected((old) => {
      const next = new Set(old),
        all = eligible.every((r) => next.has(r.entry.id));
      for (const r of eligible) {
        if (all) next.delete(r.entry.id);
        else next.add(r.entry.id);
      }
      return next;
    });
    invalidate();
  }
  function closeReview() {
    if (
      !busy &&
      (!dirty || window.confirm("Discard unsaved merchant review choices?"))
    )
      close();
  }
  async function inspect() {
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      const value = await command<Preview>("preview_purchases", {
        workspace: data.workspace,
        request: request(),
      });
      setPreview({ key, value });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!validPreview || !confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await command("review_purchases", {
        workspace: data.workspace,
        request: request(),
      });
      await changed(
        `${picked.length} purchase${picked.length === 1 ? "" : "s"} reviewed. Account movements preserved.`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function undo() {
    if (
      !view?.undoId ||
      !window.confirm(
        "Undo the last purchase review? This restores its previous categories and splits only while every affected purchase and source link is unchanged.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await command("undo_purchase_review", {
        workspace: data.workspace,
        id: view.undoId,
      });
      await changed("Purchase review undone. Previous allocations restored.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function remember() {
    const value = newRule(
      merchants[0],
      detail.source.accountId,
      category || null,
      mode || "personal",
      percent,
    );
    value.categoryAction = category ? "set" : "leave";
    value.ownershipAction = mode ? "set" : "leave";
    setRule(value);
  }
  const groups = new Map<string, Item[]>();
  for (const r of view?.items ?? []) {
    if (
      !`${r.merchant} ${r.entry.description}`
        .toLowerCase()
        .includes(filter.toLowerCase())
    )
      continue;
    const group = groups.get(r.merchant) ?? [];
    group.push(r);
    groups.set(r.merchant, group);
  }
  const categoryName = (id: string | null | undefined) =>
    data.categories.find((c) => c.id === id)?.name ?? "Uncategorized";
  return (
    <>
      <Modal
        title="Review purchases by merchant"
        onClose={closeReview}
        busy={busy}
      >
        <div
          className="merchant-review"
          onKeyDown={(e) => {
            if (!e.altKey || e.ctrlKey || e.metaKey || rule) return;
            const target = e.target as HTMLElement;
            if (
              target.matches(
                'textarea, input:not([type="checkbox"]), [contenteditable="true"]',
              )
            )
              return;
            const value = (
              { "1": "personal", "2": "shared", "3": "equal" } as Record<
                string,
                string
              >
            )[e.key];
            if (value && !busy) {
              e.preventDefault();
              setSharing(value);
            }
          }}
        >
          <p className="form-intro">
            Review recorded purchases, including those awaiting a split. Select
            a merchant or individual rows, then change category, sharing, or
            both. Dates, amounts and account movements stay intact.
          </p>
          {!view && !error && <p>Loading recorded purchases...</p>}
          {view && (
            <fieldset disabled={busy}>
              <div className="merchant-toolbar">
                <label>
                  Find merchant
                  <input
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </label>
                {view.undoId && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={dirty}
                    onClick={() => void undo()}
                  >
                    Undo last purchase review
                  </button>
                )}
              </div>
              {!view.items.length && (
                <p className="import-caution">
                  No recorded purchases in this source yet. Process verified
                  rows or review their transaction types first, then return
                  here.
                </p>
              )}
              <div className="merchant-groups" aria-label="Merchant groups">
                {[...groups].map(([merchant, rows]) => (
                  <section
                    className="merchant-group"
                    key={merchant}
                    aria-label={merchant || "Unspecified merchant"}
                  >
                    <label className="merchant-group-title">
                      <input
                        type="checkbox"
                        aria-label={`Select merchant ${merchant}`}
                        disabled={rows.every((r) => !!r.reason)}
                        checked={
                          rows.filter((r) => !r.reason).length > 0 &&
                          rows
                            .filter((r) => !r.reason)
                            .every((r) => selected.has(r.entry.id))
                        }
                        onChange={() => toggle(rows)}
                      />
                      <strong>{merchant || "Unspecified merchant"}</strong>
                      <span>
                        {rows.length} purchase{rows.length === 1 ? "" : "s"}
                      </span>
                    </label>
                    {rows.map((r) => (
                      <label className="merchant-purchase" key={r.entry.id}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.entry.description} on ${r.entry.date}`}
                          disabled={!!r.reason}
                          checked={selected.has(r.entry.id)}
                          onChange={() => toggle([r])}
                        />
                        <span>
                          <strong>{r.entry.description}</strong>
                          <small>
                            {r.entry.date} ·{" "}
                            {categoryName(
                              r.entry.pending?.categoryId ?? r.entry.categoryId,
                            )}{" "}
                            ·{" "}
                            {r.entry.pending
                              ? "Awaiting split"
                              : sharing(r.entry.splitMode, r.entry.splitValue)}
                          </small>
                          {r.reason && (
                            <small className="merchant-protected">
                              {r.reason}
                            </small>
                          )}
                        </span>
                        <strong>{money(r.entry.amountCents)}</strong>
                      </label>
                    ))}
                  </section>
                ))}
                {!!view.items.length && !groups.size && (
                  <p>No merchants match this filter.</p>
                )}
              </div>
              <div className="merchant-selected">
                <strong>
                  {picked.length} selected ·{" "}
                  {money(
                    picked.reduce((sum, r) => sum + r.entry.amountCents, 0),
                  )}{" "}
                  full amount
                </strong>
                <button
                  className="text-button"
                  type="button"
                  disabled={!selected.size}
                  onClick={() => {
                    setSelected(new Set());
                    invalidate();
                  }}
                >
                  Clear selection
                </button>
              </div>
              <div className="form-grid">
                <label>
                  Category change
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      invalidate();
                    }}
                  >
                    <option value="">Leave each category unchanged</option>
                    {data.categories
                      .filter((c) => !c.archived)
                      .map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Sharing change
                  <select
                    value={mode}
                    onChange={(e) => setSharing(e.target.value)}
                  >
                    <option value="">Leave each split unchanged</option>
                    {Object.entries(sharingNames).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                    <option value="percent">Custom Jacob percentage</option>
                  </select>
                </label>
              </div>
              {mode === "percent" && (
                <label>
                  Jacob percentage
                  <input
                    inputMode="decimal"
                    value={percent}
                    onChange={(e) => {
                      setPercent(e.target.value);
                      invalidate();
                    }}
                  />
                </label>
              )}
              <CategorySuggestion
                data={data}
                source={detail.source.id}
                disabled={busy}
                contexts={picked.map((r) => ({
                  rowId: r.rowId,
                  splitMode:
                    mode || (r.entry.pending ? "ask" : r.entry.splitMode),
                  splitValue: mode
                    ? mode === "percent"
                      ? percent
                      : ""
                    : r.entry.splitValue,
                  amount: dollars(r.entry.amountCents),
                }))}
                choose={(value) => {
                  setCategory(value);
                  invalidate();
                }}
              />
              <p className="merchant-shortcuts">
                Keyboard: Alt+1 personal · Alt+2 shared 70/30 · Alt+3 equal.
                Space selects a focused checkbox.
              </p>
              {previous && (
                <div className="merchant-previous">
                  <span>
                    Previous recorded choice ({previous.date}):{" "}
                    <strong>{categoryName(previous.categoryId)}</strong> ·{" "}
                    {sharing(previous.splitMode, previous.splitValue)}
                  </span>
                  <div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setCategory(previous.categoryId);
                        invalidate();
                      }}
                    >
                      Use previous category
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      disabled={
                        !sharingNames[previous.splitMode] &&
                        previous.splitMode !== "percent"
                      }
                      onClick={() => {
                        setMode(previous.splitMode);
                        setPercent(previous.splitValue);
                        invalidate();
                      }}
                    >
                      Use previous sharing
                    </button>
                  </div>
                </div>
              )}
              {validPreview && (
                <div className="merchant-impact" role="status">
                  <strong>
                    {preview.value.count} purchases ready for review
                  </strong>
                  <span>
                    Jacob's budget usage:{" "}
                    {money(preview.value.beforeAllowanceCents)} →{" "}
                    {money(preview.value.afterAllowanceCents)}
                  </span>
                  {preview.value.afterProvisionalCents > 0 && (
                    <span>
                      Includes {money(preview.value.afterProvisionalCents)}{" "}
                      still awaiting a split.
                    </span>
                  )}
                  <span>
                    Change in Chelsea's amount owed:{" "}
                    {money(preview.value.householdChangeCents)}
                  </span>
                  <small>
                    Positive means Chelsea owes more; negative means less.
                    Account balances stay unchanged.
                  </small>
                </div>
              )}
              {validPreview && (
                <label className="import-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I reviewed all selected purchases and confirm these category
                  and sharing changes.
                </label>
              )}
              {notice && <p role="status">{notice}</p>}
              <div className="dialog-actions">
                <button
                  className="secondary"
                  type="button"
                  disabled={merchants.length !== 1 || (!category && !mode)}
                  onClick={remember}
                >
                  Remember for next time...
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={!picked.length || (!category && !mode)}
                  onClick={() => void inspect()}
                >
                  Preview changes
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={!validPreview || !confirmed}
                  onClick={() => void apply()}
                >
                  {busy ? "Working..." : "Apply once"}
                </button>
              </div>
            </fieldset>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
      {rule && (
        <RuleEditor
          data={data}
          initial={rule}
          close={() => setRule(null)}
          saved={async () =>
            setNotice(
              "Merchant rule saved for future imports. Apply once to save the selected purchases separately.",
            )
          }
        />
      )}
    </>
  );
}
