import { useEffect, useRef, useState } from "react";
import { command, money } from "./api";
import { Modal } from "./EntryDialog";
import { TextEvidence, useWrite } from "./PdfDocuments";
import PdfOriginal from "./PdfOriginal";
import type { AiJob, AiProposal } from "./AiAssistance";
import type { ImportDetail } from "./importTypes";
import type { Snapshot } from "./types";
type Field = AiProposal["fields"][number];
type Review = {
  token: string;
  kind: string;
  warnings: string[];
  target: {
    targetName: string;
    priorAmountCents: number | null;
    newAmountCents: number;
    priorDueDate: string;
    dueDate: string;
    calculation: { balanceCents: number | null; warnings: string[] } | null;
  };
};
type Input = {
  jobId: string;
  sourceRevision: number;
  fields: Field[];
  targetId: string;
  month: string;
  note: string;
  currencyConfirmed: boolean;
};
type Applied = { jobId: string; input: Input; review: Review };
const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (v) => v.toUpperCase());
function initialFields(job: AiJob): Field[] {
  const keys =
    job.request.input.task === "bill"
      ? ["amount_due", "due_date", "invoice_date", "subtotal", "tax", "fees"]
      : [
          "statement_balance",
          "closing_date",
          "due_date",
          "minimum_due",
          "previous_balance",
          "payments",
          "credits",
          "purchases",
          "fees",
          "interest",
        ];
  return keys.map((key) =>
    structuredClone(
      job.proposal?.fields.find((f) => f.key === key) ?? {
        key,
        value: null,
        evidence: { page: null, quote: "" },
      },
    ),
  );
}
export default function AiDocumentReview({
  data,
  detail,
  job,
  close,
  saved,
}: {
  data: Snapshot;
  detail: ImportDetail;
  job: AiJob;
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const workspace = data.workspace,
    kind = job.request.input.task;
  const [fields, setFields] = useState<Field[]>(() => initialFields(job)),
    [month, setMonth] = useState(data.month),
    [target, setTarget] = useState(""),
    [note, setNote] = useState(""),
    [currency, setCurrency] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [dirty, setDirty] = useState(false),
    [review, setReview] = useState<Review | null>(null),
    [applied, setApplied] = useState<Applied | null>(null),
    [ready, setReady] = useState(false),
    [targets, setTargets] = useState<{ id: string; name: string }[] | null>(
      null,
    ),
    [error, setError] = useState(""),
    [readError, setReadError] = useState(""),
    [reload, setReload] = useState(0),
    [reading, setReading] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const action = useWrite(close, saved);
  const invalidate = () => {
    generation.current++;
    setReview(null);
    setConfirmed(false);
    setReading(false);
    setError("");
    setDirty(true);
  };
  const requestClose = () => {
    if (
      !dirty ||
      applied ||
      window.confirm(
        "Discard these unsaved document corrections? The original AI result stays saved.",
      )
    )
      close();
  };
  useEffect(() => {
    let live = true;
    setReady(false);
    setReadError("");
    command<Applied | null>("ai_document_application", {
      workspace,
      source: detail.source.id,
    })
      .then((a) => {
        if (live) {
          setApplied(a);
          if (a) {
            setFields(a.input.fields);
            setNote(a.input.note);
            setReview(a.review);
          }
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) setReadError(String(e));
      });
    return () => {
      live = false;
    };
  }, [workspace, detail.source.id, reload]);
  useEffect(() => {
    if (!ready || applied) return;
    let live = true;
    setTargets(null);
    setTarget("");
    generation.current++;
    setReview(null);
    setConfirmed(false);
    setReading(false);
    setReadError("");
    const load =
      kind === "bill"
        ? command<any[]>("bill_month", { workspace, month }).then((rows) =>
            rows
              .filter((o) => !o.cancelled)
              .map((o) => ({
                id: o.id,
                name: `${o.plan.name} - ${o.dueDate}`,
              })),
          )
        : command<any>("card_statement_month", { workspace, month }).then((v) =>
            v.statements.map((s: any) => ({
              id: s.draft.accountId,
              name:
                data.accounts.find((a) => a.id === s.draft.accountId)?.name ??
                s.draft.accountId,
            })),
          );
    load
      .then((t) => {
        if (live) setTargets(t);
      })
      .catch((e) => {
        if (live) setReadError(String(e));
      });
    return () => {
      live = false;
    };
  }, [workspace, month, kind, ready, applied, reload, data.accounts]);
  const input: Input = {
    jobId: job.id,
    sourceRevision: detail.source.revision,
    fields,
    targetId: target,
    month: kind === "bill" ? "" : month,
    note,
    currencyConfirmed: currency,
  };
  const preview = async () => {
    const seq = ++generation.current;
    setReading(true);
    setReview(null);
    setConfirmed(false);
    setError("");
    try {
      const r = await command<Review>("ai_document_preview", {
        workspace,
        input,
      });
      if (seq === generation.current) setReview(r);
    } catch (e) {
      if (seq === generation.current) setError(String(e));
    } finally {
      if (seq === generation.current) setReading(false);
    }
  };
  const edit = (i: number, patch: Partial<Field>) => {
    invalidate();
    setFields((old) => old.map((f, n) => (n === i ? { ...f, ...patch } : f)));
  };
  return (
    <Modal
      title="Review AI document fields"
      busy={action.busy}
      onClose={requestClose}
    >
      <div className="assistance-body">
        <p>
          Compare these proposed values with the original and choose the
          existing bill or card statement. Applying them updates the obligation
          and links its evidence. Payments and spending are recorded separately.
        </p>
        {detail.source.format === "pdf" && (
          <PdfOriginal workspace={workspace} sourceId={detail.source.id} />
        )}
        {detail.previewUrl && (
          <details>
            <summary>Original source image</summary>
            <img
              className="assistance-image"
              src={detail.previewUrl}
              alt="Original document evidence"
            />
          </details>
        )}
        {!!detail.dataset.pdfPages?.length && (
          <TextEvidence pages={detail.dataset.pdfPages} />
        )}
        {applied && (
          <p role="status">
            This document was already applied. Saved corrections are shown
            below; further changes belong in the existing bill or statement.
          </p>
        )}
        {job.proposal?.warnings.map((w, i) => (
          <p key={i} className="import-caution">
            {w}
          </p>
        ))}
        {!ready && !readError && (
          <p role="status">Loading saved document review...</p>
        )}
        <fieldset disabled={action.busy || !ready || !!applied}>
          <p>
            Leave unknown optional values blank. Amounts use dollars and two
            decimal places. Each supplied value needs a source quote; PDF pages
            start at 1.
          </p>
          <div className="assistance-scroll">
            <table className="assistance-fields">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Reviewed value</th>
                  <th>Page</th>
                  <th>Source quote</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={f.key}>
                    <th scope="row">{label(f.key)}</th>
                    <td>
                      <input
                        aria-label={label(f.key)}
                        type={f.key.endsWith("date") ? "date" : "text"}
                        inputMode={
                          f.key.endsWith("date") ? undefined : "decimal"
                        }
                        value={f.value ?? ""}
                        onChange={(e) =>
                          edit(i, { value: e.target.value || null })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${label(f.key)} page`}
                        type="number"
                        min={1}
                        max={100}
                        value={f.evidence.page ?? ""}
                        onChange={(e) =>
                          edit(i, {
                            evidence: {
                              ...f.evidence,
                              page: e.target.value
                                ? Number(e.target.value)
                                : null,
                            },
                          })
                        }
                      />
                    </td>
                    <td>
                      <textarea
                        aria-label={`${label(f.key)} source quote`}
                        maxLength={2000}
                        value={f.evidence.quote}
                        onChange={(e) =>
                          edit(i, {
                            evidence: { ...f.evidence, quote: e.target.value },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!applied && (
            <>
              <div className="assistance-grid">
                <label>
                  Target month
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => {
                      invalidate();
                      setMonth(e.target.value);
                    }}
                  />
                </label>
                <label>
                  {kind === "bill" ? "Existing bill" : "Card cycle"}
                  <select
                    value={target}
                    onChange={(e) => {
                      invalidate();
                      setTarget(e.target.value);
                    }}
                  >
                    <option value="">Choose a record</option>
                    {targets?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {targets === null && !readError && ready && (
                <p role="status">Loading target records...</p>
              )}
              {targets?.length === 0 && (
                <p>
                  Configure a recurring bill or card statement cycle first, then
                  return to this review.
                </p>
              )}
              <label>
                Document reference / review note
                <textarea
                  maxLength={1000}
                  value={note}
                  onChange={(e) => {
                    invalidate();
                    setNote(e.target.value);
                  }}
                />
              </label>
              <label className="import-check">
                <input
                  type="checkbox"
                  checked={currency}
                  onChange={(e) => {
                    invalidate();
                    setCurrency(e.target.checked);
                  }}
                />
                I verified USD amounts and that this document belongs to the
                selected bill or card.
              </label>
              <button
                className="secondary"
                type="button"
                disabled={
                  reading || !target || !currency || !note.trim() || !month
                }
                onClick={() => void preview()}
              >
                {reading ? "Checking document..." : "Preview reviewed document"}
              </button>
            </>
          )}
        </fieldset>
        {(error || readError || action.error) && (
          <p role="alert" className="form-error">
            {error || readError || action.error}
          </p>
        )}
        {readError && (
          <button
            className="secondary"
            disabled={action.busy}
            onClick={() => setReload((n) => n + 1)}
          >
            Retry document records
          </button>
        )}
        {review && (
          <div className="assistance-consent">
            <h3>{review.target.targetName}</h3>
            <p>
              Total:{" "}
              {review.target.priorAmountCents === null
                ? "Not confirmed"
                : money(review.target.priorAmountCents)}{" "}
              &rarr; <strong>{money(review.target.newAmountCents)}</strong>
            </p>
            <p>
              Due date: {review.target.priorDueDate} &rarr;{" "}
              <strong>{review.target.dueDate}</strong>
            </p>
            {review.target.calculation && (
              <>
                <p>
                  Calculated statement:{" "}
                  {review.target.calculation.balanceCents === null
                    ? "Unknown"
                    : money(review.target.calculation.balanceCents)}
                  {review.target.calculation.balanceCents !== null && (
                    <>
                      {" "}
                      &middot; Difference:{" "}
                      {money(
                        review.target.newAmountCents -
                          review.target.calculation.balanceCents,
                      )}
                    </>
                  )}
                </p>
                {review.target.calculation.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </>
            )}
            {review.warnings.map((w, i) => (
              <p key={i} className="import-caution">
                {w}
              </p>
            ))}
            {applied ? (
              <p>Saved review note: {note}</p>
            ) : (
              <label className="import-check">
                <input
                  type="checkbox"
                  disabled={action.busy}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I checked the original document, corrected fields, selected
                record and changes above.
              </label>
            )}
          </div>
        )}
        <div className="dialog-actions">
          <button
            className="secondary"
            disabled={action.busy}
            onClick={requestClose}
          >
            {applied ? "Close review" : "Cancel"}
          </button>
          {!applied && (
            <button
              className="primary"
              disabled={action.busy || !review || !confirmed}
              onClick={() =>
                void action.write(
                  "ai_document_apply",
                  {
                    workspace,
                    input: { input, token: review?.token, confirmed },
                  },
                  "Reviewed document applied and evidence linked. No payment or expense was created.",
                )
              }
            >
              Apply reviewed document once
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
