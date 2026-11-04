import { HelpHeading } from "./HelpTip";
import PdfDocuments from "./PdfDocuments";
import AiProviders from "./AiProviders";
import AiAssistance from "./AiAssistance";
import MappingForm from "./MappingForm";
import PdfTables from "./PdfTables";
import BudgetPeriod, { guardPeriodClose } from "./BudgetPeriod";
import { PayPalFields, emptyPayPal } from "./Household";
import ChargeLines from "./ChargeLines";
import ImportCoverage from "./ImportCoverage";
import ImportClassification from "./ImportClassification";
import PurchaseReview from "./PurchaseReview";
import CategorySuggestion from "./CategorySuggestion";
import { MovementPicker } from "./MovementReview";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Clipboard,
  File,
  FileCheck2,
  Image,
  Upload,
  ArrowLeft,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { command, dollars, money, today } from "./api";
import { Modal } from "./EntryDialog";
import { RefundFields } from "./RefundDialog";
import { RuleEditor, newRule, type MerchantRule } from "./Rules";
import { IntakeProgress, type Intake } from "./ImportIntake";
import {
  isBudgetOutflow,
  type Snapshot,
  type EntryInput,
  type Entry,
  type EntryKind,
} from "./types";
import type {
  ImportDetail,
  ImportRow,
  ImportSource,
  ImportDecision,
  ImportReceipt,
} from "./importTypes";
import "./imports.css";

export default function Imports({
  data,
  intake,
  epoch,
  saved,
}: {
  data: Snapshot;
  intake: Intake;
  epoch: number;
  saved: (message: string) => Promise<void>;
}) {
  const [sources, setSources] = useState<ImportSource[]>([]),
    [selected, setSelected] = useState<ImportDetail | null>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<ImportRow | null>(null),
    [bulk, setBulk] = useState(false);
  const [ruleBatch, setRuleBatch] = useState(false);
  const [groupHeld, setGroupHeld] = useState(false);
  const [merchantReview, setMerchantReview] = useState(false);
  const [mappingDirty, setMappingDirty] = useState(false);
  const observationAttempt = useRef<{
    source: string;
    revision: number;
    id: string;
  } | null>(null);
  const coverageAttempt = useRef<{ signature: string; id: string } | null>(
    null,
  );
  const reconcileAttempt = useRef<{
    source: string;
    revision: number;
    id: string;
  } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set()),
    [showProcessed, setShowProcessed] = useState(false),
    [showArchived, setShowArchived] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    request = useRef(0),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ++request.current;
    };
  }, []);
  async function list() {
    const result = await command<ImportSource[]>("list_imports", {
      workspace: data.workspace,
    });
    if (alive.current) setSources(result ?? []);
  }
  useEffect(() => {
    void list().catch((e) => setError(String(e)));
  }, [epoch, data.workspace]);
  async function open(id: string) {
    const token = ++request.current;
    setLoading(true);
    setError("");
    try {
      const detail = await command<ImportDetail>("get_import", {
        workspace: data.workspace,
        id,
      });
      if (token === request.current && alive.current) {
        setSelected(detail);
        setMappingDirty(false);
        setChecked(new Set());
        setShowProcessed(false);
      }
    } catch (e) {
      if (token === request.current) {
        setSelected(null);
        setError(
          `Import review could not reload. Open the source again. ${String(e)}`,
        );
      }
    } finally {
      if (token === request.current) setLoading(false);
    }
  }
  async function changed(message: string) {
    if (!alive.current) return;
    setEditing(null);
    setBulk(false);
    setRuleBatch(false);
    setMerchantReview(false);
    setChecked(new Set());
    try {
      await list();
      if (selected) await open(selected.source.id);
    } catch (e) {
      setSelected(null);
      setError(
        `Change saved, but import review could not reload. Open the source again. ${String(e)}`,
      );
    }
    await saved(message);
  }
  async function mutate(
    name: string,
    args: Record<string, unknown>,
    message: string | ((receipt: ImportReceipt) => string),
  ) {
    setBusy(true);
    setError("");
    try {
      const receipt = await command<ImportReceipt>(name, {
        workspace: data.workspace,
        ...args,
      });
      await changed(typeof message === "string" ? message : message(receipt));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function newObservation() {
    if (!selected || busy || mappingDirty) return;
    if (
      !window.confirm(
        "Confirm that you have a fresh download with these same contents. Create a separate observation, then confirm its account, posted status and download range? Earlier records and saved coverage will stay intact. Unsaved range edits will be discarded.",
      )
    )
      return;
    if (
      observationAttempt.current?.source !== selected.source.id ||
      observationAttempt.current?.revision !== selected.source.revision
    )
      observationAttempt.current = {
        source: selected.source.id,
        revision: selected.source.revision,
        id: crypto.randomUUID(),
      };
    setBusy(true);
    setError("");
    try {
      const id = await command<string>("new_import_observation", {
        workspace: data.workspace,
        id: selected.source.id,
        revision: selected.source.revision,
        newId: observationAttempt.current.id,
      });
      if (!alive.current) return;
      await list();
      await open(id);
      await saved(
        "New download observation created. Confirm account, status and coverage.",
      );
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const visible =
    selected?.rows.filter(
      (r) => showProcessed || r.disposition === "pending" || !!r.pendingEntry,
    ) ?? [];
  const pageRows = visible.slice(0, 250);
  const merchantOf = (row: ImportRow) =>
    row.merchant ??
    row.candidate.description
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const displayRows = groupHeld
    ? [...pageRows].sort(
        (a, b) =>
          merchantOf(a).localeCompare(merchantOf(b)) || a.ordinal - b.ordinal,
      )
    : pageRows;
  const picked = selected?.rows.filter((r) => checked.has(r.id)) ?? [];
  const readyRows =
    selected?.rows.filter(
      (r) => r.disposition === "pending" && r.suggestion?.ready,
    ) ?? [];
  return (
    <div className="imports-page">
      <section className="import-intake panel">
        <div className="import-intake-icon">
          <Upload size={27} />
        </div>
        <div>
          <h2>Drop your exports here</h2>
          <p>
            Or paste a screenshot with Ctrl+V. Everything is read and saved
            locally.
          </p>
          <small>
            CSV & Excel · PNG, JPG, WebP, BMP · PDF bills/statements · Up to 10
            MB per file
          </small>
        </div>
        <div className="import-toolbar">
          <button className="secondary" onClick={intake.paste}>
            <Clipboard size={16} /> Paste screenshot
          </button>
          <button className="primary" onClick={() => input.current?.click()}>
            <Upload size={16} /> Browse files
          </button>
        </div>
        <input
          ref={input}
          aria-label="Choose import files"
          type="file"
          multiple
          accept=".csv,.tsv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.bmp"
          hidden
          onChange={(e) => {
            intake.addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </section>
      <AiProviders key={data.workspace} workspace={data.workspace} />
      <IntakeProgress intake={intake} />
      <div className="import-explanation">
        <ShieldCheck size={16} />
        <span>
          Sources enter review first. Adding a file does not change spending.
          Confirm each export's account and download range. Saved defaults can
          process verified rows; uncertain details remain in review.
        </span>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => void list().catch((e) => setError(String(e)))}
          >
            Reload sources
          </button>
        </div>
      )}
      {loading && <p role="status">Opening source…</p>}
      {!selected ? (
        <section className="panel import-library">
          <div className="panel-heading">
            <div>
              <HelpHeading topic="sourceLibrary">
                <h2>Source library</h2>
              </HelpHeading>
              <p>Original files, review progress, and imported records.</p>
            </div>
            <label className="import-check">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />{" "}
              Show dismissed
            </label>
          </div>
          {sources.filter((s) => showArchived || s.state !== "dismissed")
            .length === 0 ? (
            <div className="import-empty">
              <File size={32} />
              <h3>Your imports will appear here</h3>
              <p>
                Start with an account export or a screenshot of posted
                transactions.
              </p>
            </div>
          ) : (
            sources
              .filter((s) => showArchived || s.state !== "dismissed")
              .map((s) => (
                <button
                  className="import-source"
                  key={s.id}
                  onClick={() => void open(s.id)}
                >
                  {s.format === "image" ? (
                    <Image size={24} />
                  ) : (
                    <FileCheck2 size={24} />
                  )}
                  <span>
                    <strong>{s.name}</strong>
                    <small>
                      {data.accounts.find((a) => a.id === s.accountId)?.name ??
                        "Choose an account"}{" "}
                      · {s.format.toUpperCase()} · {s.rowCount} extracted rows
                      <br />
                      {new Date(s.createdAt).toLocaleString()}
                    </small>
                  </span>
                  <span className="source-progress">
                    <strong>
                      {s.importedCount + s.linkedCount} recorded ·{" "}
                      {s.pendingCount + (s.classificationCount ?? 0)} to review
                    </strong>
                    <small>
                      {s.error
                        ? "Extraction needs attention"
                        : s.format === "pdf"
                          ? "Document review"
                          : s.state === "unconfigured"
                            ? "Set up columns"
                            : s.state}
                    </small>
                  </span>
                </button>
              ))
          )}
        </section>
      ) : (
        <>
          <div className="import-toolbar">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                ++request.current;
                setSelected(null);
                setChecked(new Set());
              }}
            >
              <ArrowLeft size={16} /> All sources
            </button>
            <span className="import-grow" />
            <button
              className="secondary"
              disabled={busy || mappingDirty}
              onClick={() => void newObservation()}
            >
              New download observation
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                !readyRows.length ||
                selected.source.state === "dismissed"
              }
              onClick={() => setRuleBatch(true)}
            >
              Review {readyRows.length} rule matches
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void mutate(
                  "dismiss_import",
                  {
                    id: selected.source.id,
                    revision: selected.source.revision,
                    dismissed: selected.source.state !== "dismissed",
                  },
                  selected.source.state === "dismissed"
                    ? "Source returned to review."
                    : "Source dismissed. Recorded transactions remain.",
                )
              }
            >
              {selected.source.state === "dismissed"
                ? "Return to review"
                : "Dismiss source"}
            </button>
            <button
              className="secondary"
              disabled={
                busy ||
                mappingDirty ||
                !selected.source.accountId ||
                selected.source.state === "dismissed"
              }
              onClick={() => setMerchantReview(true)}
            >
              Review purchases by merchant
            </button>
            {selected.undoId && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Undo the last review operation for this source? Only untouched transactions created by it will be removed. Existing linked transactions stay unchanged. Saved import defaults are retained.",
                    )
                  )
                    void mutate(
                      "undo_import",
                      { commitId: selected.undoId },
                      "Last import operation undone.",
                    );
                }}
              >
                <RotateCcw size={14} /> Undo last operation
              </button>
            )}
          </div>
          <section className="panel import-review">
            <div className="panel-heading">
              <div>
                <h2>{selected.source.name}</h2>
                {selected.observation && (
                  <p>
                    New observation of {selected.observation.parentName}. The
                    earlier source and its decisions are preserved.
                  </p>
                )}
                <p>
                  {selected.source.importedCount} added ·{" "}
                  {selected.source.linkedCount} linked ·{" "}
                  {selected.source.excludedCount} excluded ·{" "}
                  {selected.source.pendingCount} on hold
                  {!!selected.source.classificationCount &&
                    ` · ${selected.source.classificationCount} awaiting classification`}
                </p>
              </div>
              <span className="import-chip">
                {selected.source.format.toUpperCase()}
              </span>
            </div>
            {selected.source.error && (
              <div className="error" role="alert">
                {selected.source.error}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      "reextract_import",
                      {
                        id: selected.source.id,
                        revision: selected.source.revision,
                        sheet: null,
                      },
                      "Source extraction retried.",
                    )
                  }
                >
                  Retry extraction
                </button>
              </div>
            )}
            {selected.dataset.notes.map((n, i) => (
              <p className="import-caution" key={i}>
                {n}
              </p>
            ))}
            {selected.previewUrl && (
              <details className="source-image" open>
                <summary>
                  Original screenshot · compare dates, amounts, and missing rows
                </summary>
                <img
                  src={selected.previewUrl}
                  alt="Original imported account screenshot"
                />
              </details>
            )}
            {selected.source.state !== "dismissed" && (
              <AiAssistance
                key={`ai:${data.workspace}:${selected.source.id}:${selected.source.revision}`}
                workspace={data.workspace}
                data={data}
                detail={selected}
                changed={changed}
                disabled={mappingDirty}
              />
            )}
            {selected.dataset.sheetNames.length > 1 && (
              <label className="import-sheet">
                Worksheet (each source reviews one sheet)
                <select
                  disabled={
                    busy ||
                    selected.rows.some((r) => r.disposition !== "pending")
                  }
                  value={selected.dataset.sheet}
                  onChange={(e) =>
                    void mutate(
                      "reextract_import",
                      {
                        id: selected.source.id,
                        revision: selected.source.revision,
                        sheet: e.target.value,
                      },
                      "Worksheet selected.",
                    )
                  }
                >
                  {selected.dataset.sheetNames.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            )}
            {selected.source.format === "pdf" &&
              selected.source.state !== "dismissed" && (
                <PdfDocuments
                  key={`${data.workspace}:${selected.source.id}:${selected.source.revision}`}
                  data={data}
                  detail={selected}
                  changed={changed}
                />
              )}
            {selected.source.format === "pdf" &&
              selected.source.state !== "dismissed" && (
                <PdfTables
                  key={`tables:${data.workspace}:${selected.source.id}:${selected.source.revision}`}
                  data={data}
                  detail={selected}
                  changed={changed}
                />
              )}
            {selected.dataset.headers.length > 0 && (
              <MappingForm
                key={`${selected.source.id}:${selected.source.revision}`}
                detail={selected}
                data={data}
                busy={busy}
                dirty={() => setMappingDirty(true)}
                configure={(account, mapping) =>
                  mutate(
                    "configure_import",
                    {
                      id: selected.source.id,
                      revision: selected.source.revision,
                      account,
                      mapping,
                    },
                    "Source mapped. Review the rows below.",
                  )
                }
              />
            )}
            {selected.source.accountId &&
              (selected.source.format !== "pdf" ||
                selected.dataset.headers.length > 0) && (
                <>
                  <ImportCoverage
                    key={`coverage:${selected.source.id}:${selected.source.revision}`}
                    detail={selected}
                    busy={busy}
                    mappingDirty={mappingDirty}
                    confirm={(input, pattern, processSavedDefaults) => {
                      const signature = JSON.stringify([
                        selected.source.id,
                        selected.source.revision,
                        input,
                        pattern,
                        processSavedDefaults,
                      ]);
                      if (coverageAttempt.current?.signature !== signature)
                        coverageAttempt.current = {
                          signature,
                          id: crypto.randomUUID(),
                        };
                      return mutate(
                        "finalize_import_coverage",
                        {
                          id: selected.source.id,
                          revision: selected.source.revision,
                          commitId: coverageAttempt.current.id,
                          input,
                          pattern,
                          processSavedDefaults,
                        },
                        (receipt) =>
                          `Download coverage confirmed. ${receipt.added} account records added, ${receipt.linked} linked, ${receipt.excluded} excluded.`,
                      );
                    }}
                    reconcile={() => {
                      if (
                        reconcileAttempt.current?.source !==
                          selected.source.id ||
                        reconcileAttempt.current?.revision !==
                          selected.source.revision
                      )
                        reconcileAttempt.current = {
                          source: selected.source.id,
                          revision: selected.source.revision,
                          id: crypto.randomUUID(),
                        };
                      return mutate(
                        "reconcile_import",
                        {
                          id: selected.source.id,
                          revision: selected.source.revision,
                          commitId: reconcileAttempt.current.id,
                        },
                        "Existing occurrences reconciled; new and uncertain rows remain for review.",
                      );
                    }}
                  />
                  <ImportClassification
                    key={`classify:${selected.source.id}:${selected.source.revision}`}
                    detail={selected}
                    data={data}
                    disabled={
                      busy ||
                      mappingDirty ||
                      selected.source.state === "dismissed"
                    }
                    changed={changed}
                  />
                  <div className="import-toolbar review-toolbar">
                    <strong>
                      {visible.length}{" "}
                      {showProcessed ? "total" : "awaiting review"} rows
                    </strong>
                    <label className="import-check">
                      <input
                        type="checkbox"
                        checked={showProcessed}
                        onChange={(e) => setShowProcessed(e.target.checked)}
                      />{" "}
                      Show processed
                    </label>
                    <label className="import-check">
                      <input
                        type="checkbox"
                        checked={groupHeld}
                        onChange={(e) => setGroupHeld(e.target.checked)}
                      />
                      Group rows by merchant
                    </label>
                    <span className="import-grow" />
                    <button
                      className="secondary"
                      disabled={
                        busy ||
                        !picked.length ||
                        selected.source.state === "dismissed"
                      }
                      onClick={() => setBulk(true)}
                    >
                      Review {picked.length || "selected"} rows
                    </button>
                  </div>
                  <div className="import-table-wrap">
                    <table className="import-table">
                      <thead>
                        <tr>
                          <th>
                            <input
                              type="checkbox"
                              aria-label="Select visible held rows"
                              checked={
                                pageRows.some(
                                  (r) => r.disposition === "pending",
                                ) &&
                                pageRows
                                  .filter((r) => r.disposition === "pending")
                                  .every((r) => checked.has(r.id))
                              }
                              onChange={(e) =>
                                setChecked(
                                  new Set(
                                    e.target.checked
                                      ? pageRows
                                          .filter(
                                            (r) => r.disposition === "pending",
                                          )
                                          .map((r) => r.id)
                                      : [],
                                  ),
                                )
                              }
                            />
                          </th>
                          <th>Date</th>
                          <th>Description</th>
                          <th>Amount</th>
                          <th>Review</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {displayRows.map((r, index) => (
                          <Fragment key={r.id}>
                            {groupHeld &&
                              (index === 0 ||
                                merchantOf(displayRows[index - 1]) !==
                                  merchantOf(r)) && (
                                <tr className="held-merchant-heading">
                                  <td colSpan={6}>
                                    <label className="import-check">
                                      <input
                                        type="checkbox"
                                        aria-label={`Select held merchant ${merchantOf(r)}`}
                                        disabled={
                                          !displayRows.some(
                                            (v) =>
                                              merchantOf(v) === merchantOf(r) &&
                                              v.disposition === "pending",
                                          )
                                        }
                                        checked={
                                          displayRows.some(
                                            (v) =>
                                              merchantOf(v) === merchantOf(r) &&
                                              v.disposition === "pending",
                                          ) &&
                                          displayRows
                                            .filter(
                                              (v) =>
                                                merchantOf(v) ===
                                                  merchantOf(r) &&
                                                v.disposition === "pending",
                                            )
                                            .every((v) => checked.has(v.id))
                                        }
                                        onChange={(e) =>
                                          setChecked((old) => {
                                            const next = new Set(old);
                                            for (const value of displayRows.filter(
                                              (v) =>
                                                merchantOf(v) ===
                                                  merchantOf(r) &&
                                                v.disposition === "pending",
                                            )) {
                                              if (e.target.checked)
                                                next.add(value.id);
                                              else next.delete(value.id);
                                            }
                                            return next;
                                          })
                                        }
                                      />
                                      <strong>
                                        {merchantOf(r) ||
                                          "Unspecified merchant"}
                                      </strong>
                                      <span>
                                        {
                                          displayRows.filter(
                                            (v) =>
                                              merchantOf(v) === merchantOf(r),
                                          ).length
                                        }{" "}
                                        visible rows
                                      </span>
                                    </label>
                                  </td>
                                </tr>
                              )}
                            <tr>
                              <td>
                                <input
                                  aria-label={`Select row ${r.ordinal + 1}`}
                                  type="checkbox"
                                  disabled={r.disposition !== "pending"}
                                  checked={checked.has(r.id)}
                                  onChange={(e) =>
                                    setChecked((old) => {
                                      const next = new Set(old);
                                      if (e.target.checked) next.add(r.id);
                                      else next.delete(r.id);
                                      return next;
                                    })
                                  }
                                />
                              </td>
                              <td>{r.candidate.date ?? "Needs date"}</td>
                              <td>
                                <strong>
                                  {r.candidate.description ||
                                    "Needs description"}
                                </strong>
                                {r.candidate.sourceType && (
                                  <small>{r.candidate.sourceType}</small>
                                )}
                              </td>
                              <td className="amount">
                                {r.candidate.amountCents == null
                                  ? "Needs amount"
                                  : r.candidate.currency &&
                                      r.candidate.currency !== "USD"
                                    ? `${r.candidate.currency} ${dollars(r.candidate.amountCents)}`
                                    : money(r.candidate.amountCents)}
                                <small>
                                  {r.candidate.direction === "in"
                                    ? "Credit / in"
                                    : r.candidate.direction === "out"
                                      ? "Debit / out"
                                      : "Check sign"}
                                </small>
                              </td>
                              <td>
                                {r.disposition !== "pending" ? (
                                  <span className="import-chip">
                                    {r.pendingEntry
                                      ? r.pendingEntry.pending?.verifiedExpense
                                        ? "Awaiting split"
                                        : r.pendingEntry.pending?.kindHint ===
                                            "card_payment"
                                          ? "Payment to review"
                                          : r.pendingEntry.pending?.kindHint ===
                                              "transfer"
                                            ? "Transfer to review"
                                            : "Awaiting type"
                                      : r.disposition}
                                  </span>
                                ) : (
                                  <>
                                    <span>
                                      {r.matches.length
                                        ? `${r.matches.length} possible match${r.matches.length === 1 ? "" : "es"}`
                                        : r.candidate.status !== "posted"
                                          ? "Status needs review"
                                          : r.candidate.warnings.length
                                            ? "Check source"
                                            : "Ready to classify"}
                                    </span>
                                    {r.candidate.warnings.length > 0 && (
                                      <small>{r.candidate.warnings[0]}</small>
                                    )}
                                    {selected.overlap?.items.find(
                                      (i) => i.rowId === r.id,
                                    ) && (
                                      <small>
                                        {
                                          selected.overlap.items.find(
                                            (i) => i.rowId === r.id,
                                          )?.reason
                                        }
                                      </small>
                                    )}
                                  </>
                                )}
                              </td>
                              <td>
                                <button
                                  className="text-button"
                                  disabled={
                                    busy ||
                                    (r.disposition !== "pending" &&
                                      !r.pendingEntry) ||
                                    selected.source.state === "dismissed"
                                  }
                                  onClick={() => setEditing(r)}
                                >
                                  Review
                                </button>
                              </td>
                            </tr>
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {visible.length > 250 && (
                    <p className="import-caution">
                      Showing the first 250 rows. Processing or excluding rows
                      reveals the next group.
                    </p>
                  )}
                  {visible.length === 0 && (
                    <div className="import-empty">
                      <FileCheck2 size={28} />
                      <p>No held rows in this source.</p>
                    </div>
                  )}
                </>
              )}
          </section>
        </>
      )}
      {merchantReview && selected && (
        <PurchaseReview
          data={data}
          detail={selected}
          close={() => setMerchantReview(false)}
          changed={changed}
        />
      )}
      {editing && selected && (
        <RowReview
          key={editing.id}
          detail={selected}
          row={editing}
          data={data}
          close={() => setEditing(null)}
          changed={changed}
        />
      )}
      {bulk && selected && (
        <BulkReview
          detail={selected}
          rows={picked}
          data={data}
          close={() => setBulk(false)}
          changed={changed}
        />
      )}
      {ruleBatch && selected && (
        <SuggestedReview
          detail={selected}
          rows={readyRows}
          data={data}
          close={() => setRuleBatch(false)}
          changed={changed}
        />
      )}
    </div>
  );
}

function useCommit(
  detail: ImportDetail,
  data: Snapshot,
  changed: (message: string) => Promise<void>,
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  async function commit(decisions: ImportDecision[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    const payload = JSON.stringify(decisions);
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, id: crypto.randomUUID() };
    try {
      const receipt = await command<ImportReceipt>("commit_import", {
        workspace: data.workspace,
        id: detail.source.id,
        revision: detail.source.revision,
        commitId: attempt.current.id,
        decisions,
      });
      await changed(
        `${receipt.added} added, ${receipt.linked} linked, ${receipt.excluded} excluded.`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, commit };
}
const decision = (
  row: ImportRow,
  action: string,
  input: EntryInput | null = null,
): ImportDecision => ({
  rowId: row.id,
  action,
  input,
  matchId: null,
  matchRevision: null,
  confirmed: true,
  separate: false,
});
function RowReview({
  detail,
  row,
  data,
  close,
  changed,
}: {
  detail: ImportDetail;
  row: ImportRow;
  data: Snapshot;
  close: () => void;
  changed: (message: string) => Promise<void>;
}) {
  const c = row.candidate,
    source = detail.source.accountId!;
  const pending = row.pendingEntry;
  const [action, setAction] = useState("hold"),
    [matchId, setMatchId] = useState(
      row.matches.length === 1 ? row.matches[0].id : "",
    );
  const [confirmed, setConfirmed] = useState(false),
    [separate, setSeparate] = useState(false);
  const [input, setInput] = useState<EntryInput>({
    id: pending?.id ?? row.id,
    revision: pending?.revision ?? 0,
    kind: "expense",
    date: pending?.date ?? c.date ?? "",
    description: pending?.description ?? c.description.slice(0, 200),
    amount: pending
      ? dollars(pending.amountCents)
      : c.amountCents == null
        ? ""
        : dollars(c.amountCents),
    payer: "jacob",
    categoryId:
      pending?.pending?.categoryId ?? row.suggestion?.categoryId ?? null,
    accountId: source,
    destinationAccountId: null,
    splitMode:
      pending?.pending?.verifiedExpense || row.suggestion?.ownershipAsk
        ? ""
        : (row.suggestion?.splitMode ?? "personal"),
    splitValue: row.suggestion?.splitValue ?? "",
    note: pending?.note ?? "",
    budgetOverride: pending?.budgetOverride,
  });
  const requestClose = guardPeriodClose(input, pending?.budgetOverride, close);
  const [remember, setRemember] = useState<MerchantRule | null>(null);
  const [ruleNotice, setRuleNotice] = useState("");
  const {
    busy: committing,
    error: commitError,
    commit,
  } = useCommit(detail, data, changed);
  const [resolving, setResolving] = useState(false),
    [resolutionError, setResolutionError] = useState("");
  const busy = committing || resolving,
    error = resolutionError || commitError;
  async function resolve() {
    setResolving(true);
    setResolutionError("");
    try {
      await command("save_entry", { workspace: data.workspace, input });
      await changed(
        "Activity classified. Account movement retained once; spending and sharing updated.",
      );
    } catch (e) {
      setResolutionError(String(e));
    } finally {
      setResolving(false);
    }
  }
  const update = <K extends keyof EntryInput>(key: K, value: EntryInput[K]) =>
    setInput((i) => ({ ...i, [key]: value }));
  function treatment(value: string) {
    setAction(value);
    if (
      [
        "expense",
        "income",
        "reward",
        "paypal_cashout",
        "debt_payment",
        "settlement",
        "transfer",
        "card_payment",
        "refund",
      ].includes(value)
    ) {
      const incoming = c.direction === "in";
      const movement = ["transfer", "card_payment"].includes(value);
      setInput((i) => ({
        ...i,
        kind: value as EntryKind,
        originalEventId: null,
        payer: value === "settlement" && incoming ? "chelsea" : "jacob",
        accountId: movement && incoming ? null : source,
        destinationAccountId: movement && incoming ? source : null,
        categoryId: isBudgetOutflow(value)
          ? (i.categoryId ?? "uncategorized")
          : null,
        lines: [],
        paypal: value === "paypal_cashout" ? emptyPayPal() : null,
      }));
    }
  }
  const movement = action === "transfer" || action === "card_payment";
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (action === "reconcile") return;
    if (pending) {
      void resolve();
      return;
    }
    const d = decision(
      row,
      action === "link" || action === "exclude" ? action : "add",
      action === "link" || action === "exclude" ? null : input,
    );
    d.confirmed = confirmed;
    d.separate = separate;
    if (action === "link") {
      const match = row.matches.find((m) => m.id === matchId);
      d.matchId = match?.id ?? null;
      d.matchRevision = match?.revision ?? null;
    }
    void commit([d]);
  }
  return (
    <>
      <Modal
        title={`Review row ${row.ordinal + 1}`}
        onClose={requestClose}
        busy={busy}
      >
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <div className="raw-row">{row.raw.join(" · ")}</div>
            {detail.overlap?.items.find((i) => i.rowId === row.id) && (
              <p className="import-caution">
                {detail.overlap.items.find((i) => i.rowId === row.id)?.reason}
              </p>
            )}
            {row.suggestion?.explanations.length ? (
              <div className="rule-preview">
                {row.suggestion.explanations.map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
              </div>
            ) : null}
            {ruleNotice && (
              <p className="dialog-notice" role="status">
                {ruleNotice}
              </p>
            )}
            {!pending && row.matches.length > 0 && (
              <div className="raw-row">
                <strong>Possible existing transactions</strong>
                {row.matches.map((m) => (
                  <p key={m.id}>
                    {m.date} · {m.description} · {money(m.amountCents)} ·{" "}
                    {m.kind.replace("_", " ")}
                  </p>
                ))}
              </div>
            )}
            {c.warnings.map((w) => (
              <p className="import-caution" key={w}>
                {w}
              </p>
            ))}
            <label>
              Treatment
              <select
                autoFocus
                value={action}
                onChange={(e) => treatment(e.target.value)}
              >
                <option value="hold">Hold — decide later</option>
                {pending && (
                  <option value="reconcile">Reconcile recorded movement</option>
                )}
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="reward">Reward or account credit</option>
                <option value="paypal_cashout">PayPal cash-out to bank</option>
                <option value="debt_payment">Loan/debt payment</option>
                <option value="refund">Refund of a purchase</option>
                <option value="card_payment">Credit card payment</option>
                <option value="transfer">Bank transfer</option>
                <option value="settlement">Repayment with Chelsea</option>
                {!pending && row.matches.length > 0 && (
                  <option value="link">Link an existing transaction</option>
                )}
                {!pending && (
                  <option value="exclude">Exclude this row from import</option>
                )}
              </select>
            </label>
            {action === "reconcile" && pending && (
              <MovementPicker
                data={data}
                entry={pending}
                sourceDate={c.postedDate ?? pending.date}
                changed={changed}
                onBusy={setResolving}
              />
            )}
            {pending?.pending?.kindHint && pending.note && (
              <p className="import-caution">{pending.note}</p>
            )}
            {action === "hold" && (
              <p className="form-intro">
                {pending
                  ? "The verified account movement is already recorded. Classify it here without adding it again. Purchases awaiting a split reserve their gross amount; unknown credits do not add spending room."
                  : "Uncertain rows can stay here until you confirm their identity and treatment. Held rows do not affect your totals."}
              </p>
            )}
            {action === "link" && (
              <label>
                Existing transaction
                <select
                  required
                  value={matchId}
                  onChange={(e) => setMatchId(e.target.value)}
                >
                  <option value="">Choose the same real transaction</option>
                  {row.matches.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.date} · {m.description} · {money(m.amountCents)} ·{" "}
                      {m.kind.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <small>
                  Linking records the source without adding spending, income, or
                  a second payment.
                </small>
              </label>
            )}
            {!["hold", "link", "exclude", "reconcile"].includes(action) && (
              <>
                <BudgetPeriod
                  input={input}
                  change={(i) => {
                    setInput(i);
                    setConfirmed(false);
                  }}
                  selectedMonth={data.month}
                />
                {action === "refund" && (
                  <RefundFields
                    data={data}
                    input={input}
                    update={setInput}
                    importAccount={source}
                  />
                )}
                <label>
                  Description
                  <input
                    required
                    maxLength={200}
                    value={input.description}
                    onChange={(e) => update("description", e.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Date
                    <input
                      type="date"
                      required
                      max={today()}
                      readOnly={!!pending}
                      value={input.date}
                      onChange={(e) => update("date", e.target.value)}
                    />
                  </label>
                  <label>
                    Amount ($)
                    <input
                      required
                      inputMode="decimal"
                      pattern="[0-9]+(\.[0-9]{1,2})?"
                      readOnly={!!pending}
                      value={input.amount}
                      onChange={(e) => update("amount", e.target.value)}
                    />
                  </label>
                </div>
                {movement ? (
                  <div className="form-grid">
                    <label>
                      From account
                      <select
                        required
                        value={input.accountId ?? ""}
                        onChange={(e) => update("accountId", e.target.value)}
                      >
                        <option value="">Choose bank account</option>
                        {data.accounts
                          .filter((a) => !a.archived && a.kind !== "credit")
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      To account
                      <select
                        required
                        value={input.destinationAccountId ?? ""}
                        onChange={(e) =>
                          update("destinationAccountId", e.target.value)
                        }
                      >
                        <option value="">Choose destination</option>
                        {data.accounts
                          .filter(
                            (a) =>
                              !a.archived &&
                              (action === "card_payment"
                                ? a.kind === "credit"
                                : a.kind !== "credit"),
                          )
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <p className="form-intro">
                    Source account:{" "}
                    {data.accounts.find((a) => a.id === source)?.name}
                  </p>
                )}
                {action === "paypal_cashout" && input.paypal && (
                  <PayPalFields
                    data={data}
                    value={input.paypal}
                    change={(paypal) => update("paypal", paypal)}
                  />
                )}
                {action === "reward" && (
                  <p className="form-intro">
                    A card credit reduces card debt without adding bank cash.
                    Use Refund for a purchase reversal.
                  </p>
                )}
                {action === "debt_payment" && (
                  <p className="form-intro">
                    Uses your monthly category budget and is reported separately
                    from purchases. Use Card payment for paying your own credit
                    card.
                  </p>
                )}
                {isBudgetOutflow(action) && (
                  <>
                    <label>
                      Category
                      <select
                        required
                        disabled={!!input.lines?.length}
                        value={input.categoryId ?? ""}
                        onChange={(e) => update("categoryId", e.target.value)}
                      >
                        <option value="">Choose category</option>
                        {data.categories
                          .filter((c) => !c.archived)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Expense allocation
                      <select
                        required
                        value={input.splitMode}
                        onChange={(e) => update("splitMode", e.target.value)}
                      >
                        <option value="">Choose sharing explicitly</option>
                        <option value="personal">Personal — Jacob 100%</option>
                        <option value="shared">
                          Shared — Jacob 70%, Chelsea 30%
                        </option>
                        <option value="equal">Equal — 50% each</option>
                        <option value="chelsea">Chelsea 100%</option>
                        <option value="percent">Custom Jacob percentage</option>
                        <option value="exact">Exact Jacob amount</option>
                      </select>
                    </label>
                    {["percent", "exact"].includes(input.splitMode) && (
                      <label>
                        {input.splitMode === "percent"
                          ? "Jacob percentage"
                          : "Jacob amount ($)"}
                        <input
                          required
                          inputMode="decimal"
                          value={input.splitValue}
                          onChange={(e) => update("splitValue", e.target.value)}
                        />
                      </label>
                    )}
                    {action === "expense" && (
                      <CategorySuggestion
                        data={data}
                        source={detail.source.id}
                        disabled={busy || !!input.lines?.length}
                        contexts={[
                          {
                            rowId: row.id,
                            splitMode: input.splitMode,
                            splitValue: input.splitValue,
                            amount: input.amount,
                          },
                        ]}
                        choose={(categoryId) =>
                          update("categoryId", categoryId)
                        }
                      />
                    )}
                    <ChargeLines
                      value={input}
                      categories={data.categories}
                      change={(lines) =>
                        setInput((i) => ({
                          ...i,
                          lines,
                          categoryId: lines[0]?.categoryId ?? i.categoryId,
                        }))
                      }
                    />
                  </>
                )}
                <label className="import-check">
                  <input
                    type="checkbox"
                    checked={separate}
                    onChange={(e) => setSeparate(e.target.checked)}
                  />{" "}
                  This is a separate transaction from any possible matches.
                </label>
              </>
            )}
            {action !== "hold" && action !== "reconcile" && (
              <label className="import-check">
                <input
                  required
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                {action === "exclude"
                  ? "I confirm this row should not be imported."
                  : "I checked this row against the source, including its date, amount, sign, and treatment."}
              </label>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {action === "expense" && (
              <button
                type="button"
                className="secondary"
                disabled={!!input.lines?.length}
                title={
                  input.lines?.length
                    ? "Merchant rules apply one category; itemized allocations stay on this purchase."
                    : undefined
                }
                onClick={() =>
                  setRemember(
                    newRule(
                      c.description,
                      source,
                      input.categoryId,
                      input.splitMode,
                      input.splitValue,
                    ),
                  )
                }
              >
                Remember merchant…
              </button>
            )}
            <div className="dialog-actions">
              <button
                className="secondary"
                type="button"
                onClick={requestClose}
              >
                Keep on hold / close
              </button>
              {action !== "reconcile" && (
                <button
                  className="primary"
                  disabled={
                    action === "hold" ||
                    !confirmed ||
                    (action !== "exclude" && c.status !== "posted")
                  }
                  type="submit"
                >
                  {busy
                    ? "Saving…"
                    : action === "link"
                      ? "Link transaction"
                      : action === "exclude"
                        ? "Exclude row"
                        : pending
                          ? "Classify activity"
                          : "Add transaction"}
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </Modal>
      {remember && (
        <RuleEditor
          data={data}
          initial={remember}
          close={() => setRemember(null)}
          saved={async () => {
            setRuleNotice(
              "Rule saved for unprocessed imports. This row keeps your current choices. Reopen the source to refresh bulk suggestions.",
            );
          }}
        />
      )}
    </>
  );
}

function SuggestedReview({
  detail,
  rows,
  data,
  close,
  changed,
}: {
  detail: ImportDetail;
  rows: ImportRow[];
  data: Snapshot;
  close: () => void;
  changed: (message: string) => Promise<void>;
}) {
  const { busy, error, commit } = useCommit(detail, data, changed);
  const [confirmed, setConfirmed] = useState(false),
    [twins, setTwins] = useState(false);
  const duplicate = rows.some((r, i) =>
    rows
      .slice(0, i)
      .some(
        (p) =>
          p.candidate.date === r.candidate.date &&
          p.candidate.amountCents === r.candidate.amountCents,
      ),
  );
  return (
    <Modal
      title={`Confirm ${rows.length} rule matches`}
      onClose={close}
      busy={busy}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void commit(
            rows.map((r) => ({
              ...decision(r, "apply_rule"),
              ruleSignature: r.suggestion!.signature,
              separate: twins,
            })),
          );
        }}
      >
        <fieldset disabled={busy}>
          <p className="form-intro">
            These posted purchases have clear values, resolved rules, and no
            existing match. Confirm the suggestions below. Other rows stay on
            hold.
          </p>
          <div className="bulk-preview">
            {rows.map((r) => (
              <div key={r.id}>
                <span>
                  {r.candidate.date} · {r.candidate.description}
                  <small style={{ display: "block" }}>
                    {
                      data.categories.find(
                        (c) => c.id === r.suggestion?.categoryId,
                      )?.name
                    }{" "}
                    ·{" "}
                    {
                      {
                        personal: "Jacob 100%",
                        shared: "Jacob 70% / Chelsea 30%",
                        equal: "Equal 50 / 50",
                        chelsea: "Chelsea 100%",
                        percent: "Custom",
                      }[r.suggestion?.splitMode ?? "personal"]
                    }
                    {r.suggestion?.splitMode === "percent"
                      ? ` ${r.suggestion.splitValue}% Jacob`
                      : ""}
                  </small>
                </span>
                <strong>{money(r.candidate.amountCents!)}</strong>
              </div>
            ))}
          </div>
          {duplicate && (
            <label className="import-check">
              <input
                type="checkbox"
                checked={twins}
                onChange={(e) => setTwins(e.target.checked)}
              />{" "}
              Equal-date, equal-amount rows are separate real purchases.
            </label>
          )}
          <label className="import-check">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I confirm these purchases, categories, and sharing allocations.
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={!confirmed || !rows.length || (duplicate && !twins)}
            >
              {busy ? "Importing…" : "Import with rules"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function BulkReview({
  detail,
  rows,
  data,
  close,
  changed,
}: {
  detail: ImportDetail;
  rows: ImportRow[];
  data: Snapshot;
  close: () => void;
  changed: (message: string) => Promise<void>;
}) {
  const [action, setAction] = useState("expense"),
    [category, setCategory] = useState(""),
    [mode, setMode] = useState("personal"),
    [splitValue, setSplitValue] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [twins, setTwins] = useState(false);
  const { busy, error, commit } = useCommit(detail, data, changed);
  const [remember, setRemember] = useState<MerchantRule | null>(null),
    [ruleNotice, setRuleNotice] = useState("");
  function requestClose() {
    if (busy) return;
    const dirty =
      action !== "expense" ||
      category !== "" ||
      mode !== "personal" ||
      splitValue !== "";
    if (!dirty || window.confirm("Discard the unsaved choices for these rows?"))
      close();
  }
  const merchants = [
    ...new Set(
      rows.map(
        (r) =>
          r.merchant ??
          r.candidate.description
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .trim(),
      ),
    ),
  ];
  const valid = rows.every(
    (r) =>
      r.bulkExpenseReason === "" &&
      !detail.dataset.image &&
      !detail.dataset.assisted &&
      r.candidate.status === "posted" &&
      r.candidate.direction === "out" &&
      r.candidate.amountCents &&
      r.candidate.date &&
      r.candidate.date <= today() &&
      r.candidate.description &&
      r.candidate.description.length <= 200 &&
      r.matches.length === 0 &&
      r.candidate.warnings.length === 0,
  );
  const duplicate = rows.some((r, i) =>
    rows
      .slice(0, i)
      .some(
        (other) =>
          other.candidate.date === r.candidate.date &&
          other.candidate.amountCents === r.candidate.amountCents,
      ),
  );
  function submit(e: React.FormEvent) {
    e.preventDefault();
    void commit(
      rows.map((r) =>
        decision(
          r,
          action === "exclude" ? "exclude" : "bulk_expense",
          action === "exclude"
            ? null
            : {
                id: r.id,
                revision: 0,
                kind: "expense",
                date: r.candidate.date!,
                description: r.candidate.description,
                amount: dollars(r.candidate.amountCents!),
                payer: "jacob",
                categoryId: category,
                accountId: detail.source.accountId,
                destinationAccountId: null,
                splitMode: mode,
                splitValue: mode === "percent" ? splitValue : "",
                note: "",
              },
        ),
      ),
    );
  }
  return (
    <>
      <Modal
        title={`Review ${rows.length} selected rows`}
        onClose={requestClose}
        busy={busy}
      >
        <form
          onSubmit={submit}
          onKeyDown={(e) => {
            if (
              e.altKey &&
              !e.ctrlKey &&
              !e.metaKey &&
              !busy &&
              !(e.target as HTMLElement).matches(
                'textarea,input:not([type="checkbox"]),[contenteditable="true"]',
              )
            ) {
              const choice = (
                { "1": "personal", "2": "shared", "3": "equal" } as Record<
                  string,
                  string
                >
              )[e.key];
              if (choice) {
                e.preventDefault();
                setMode(choice);
              }
            }
          }}
        >
          <fieldset disabled={busy}>
            <p className="form-intro">
              Bulk import is for ordinary posted purchases with clear values and
              no existing matches. Review screenshots, payments, credits, and
              ambiguous rows individually.
            </p>
            <label>
              Treatment
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                <option value="expense">All are expenses</option>
                <option value="exclude">Exclude all selected rows</option>
              </select>
            </label>
            {action === "expense" && (
              <>
                <label>
                  Category
                  <select
                    required
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">Choose category</option>
                    {data.categories
                      .filter((c) => !c.archived)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Purchase sharing
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="personal">Personal - Jacob 100%</option>
                    <option value="shared">
                      Shared - Jacob 70%, Chelsea 30%
                    </option>
                    <option value="equal">Equal 50 / 50</option>
                    <option value="chelsea">Chelsea 100%</option>
                    <option value="percent">Custom Jacob percentage</option>
                  </select>
                </label>
                {mode === "percent" && (
                  <label>
                    Jacob percentage
                    <input
                      required
                      inputMode="decimal"
                      value={splitValue}
                      onChange={(e) => setSplitValue(e.target.value)}
                    />
                  </label>
                )}
                <p className="form-intro">
                  Keyboard: Alt+1 personal, Alt+2 shared 70/30, Alt+3 equal.
                </p>
                <CategorySuggestion
                  data={data}
                  source={detail.source.id}
                  disabled={busy || !valid}
                  contexts={rows.map((r) => ({
                    rowId: r.id,
                    splitMode: mode,
                    splitValue: mode === "percent" ? splitValue : "",
                    amount:
                      r.candidate.amountCents == null
                        ? ""
                        : dollars(r.candidate.amountCents),
                  }))}
                  choose={setCategory}
                />
                <button
                  type="button"
                  className="text-button"
                  disabled={!category || merchants.length !== 1 || !valid}
                  onClick={() =>
                    setRemember(
                      newRule(
                        merchants[0],
                        detail.source.accountId,
                        category,
                        mode,
                        splitValue,
                      ),
                    )
                  }
                >
                  Remember merchant...
                </button>
                {ruleNotice && <p role="status">{ruleNotice}</p>}
                {!valid && (
                  <p className="error">
                    Some selected rows need individual review. Close this dialog
                    and review their details.
                  </p>
                )}
                {duplicate && (
                  <label className="import-check">
                    <input
                      type="checkbox"
                      required
                      checked={twins}
                      onChange={(e) => setTwins(e.target.checked)}
                    />{" "}
                    Same-date, same-amount rows are separate real purchases.
                  </label>
                )}
              </>
            )}
            <div className="bulk-preview">
              {rows.map((r) => (
                <div key={r.id}>
                  <span>
                    {r.candidate.date ?? "No date"} · {r.candidate.description}
                  </span>
                  <strong>
                    {r.candidate.amountCents == null
                      ? "?"
                      : money(r.candidate.amountCents)}
                  </strong>
                </div>
              ))}
            </div>
            <label className="import-check">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I checked every selected row against the source and confirm this
              treatment.
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                onClick={requestClose}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  !confirmed ||
                  (action === "expense" &&
                    (!valid || !category || (duplicate && !twins)))
                }
              >
                {busy
                  ? "Saving…"
                  : action === "exclude"
                    ? "Exclude rows"
                    : "Import expenses"}
              </button>
            </div>
          </fieldset>
        </form>
      </Modal>
      {remember && (
        <RuleEditor
          data={data}
          initial={remember}
          close={() => setRemember(null)}
          saved={async () =>
            setRuleNotice(
              "Rule saved for future imports. Your selected row choices are unchanged.",
            )
          }
        />
      )}
    </>
  );
}

export function PendingActivityReview({
  data,
  entry,
  close,
  changed,
}: {
  data: Snapshot;
  entry: Entry;
  close: () => void;
  changed: (message: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<ImportDetail | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    command<ImportDetail>("get_activity_source", {
      workspace: data.workspace,
      eventId: entry.id,
    })
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [data.workspace, entry.id]);
  const row = detail?.rows.find((r) => r.pendingEntry?.id === entry.id);
  if (detail && row)
    return (
      <RowReview
        detail={detail}
        row={row}
        data={data}
        close={close}
        changed={async (message) => {
          await changed(message);
          close();
        }}
      />
    );
  return (
    <Modal title="Review activity" onClose={close}>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : (
        <p>Loading source evidence...</p>
      )}
    </Modal>
  );
}
