import { useEffect, useRef, useState, type FormEvent } from "react";
import { FileText, Plus } from "lucide-react";
import { command, money } from "./api";
import { Modal } from "./EntryDialog";
import type { Snapshot } from "./types";
import type { ImportDetail } from "./importTypes";
import "./pdfDocuments.css";
import PdfReuse from "./PdfReuse";
import PdfOriginal from "./PdfOriginal";
type Page = { number: number; lines: string[] };
type Field = {
  key: string;
  page: number;
  label: string;
  placement: string;
  dateFormat: string;
};
export type Definition = {
  name: string;
  kind: string;
  pageCount: number;
  identity: { page: number; text: string };
  currency: { page: number; text: string };
  fields: Field[];
  sumParts: { key: string; sign: number }[];
};
type Template = {
  id: string;
  revision: number;
  enabled: boolean;
  definition: Definition;
};
type Extraction = {
  values: {
    key: string;
    page: number;
    line: number;
    labelLine: number;
    raw: string;
    date: string | null;
    cents: number | null;
  }[];
  errors: string[];
  notes: string[];
};
type Review = {
  token: string;
  kind: string;
  targetName: string;
  priorAmountCents: number | null;
  newAmountCents: number;
  priorDueDate: string;
  dueDate: string;
  extraction: Extraction;
  calculation: { balanceCents: number | null; warnings: string[] } | null;
};
type Document = {
  pages: Page[];
  templates: Template[];
  applied: {
    id: string;
    kind: string;
    targetId: string;
    month: string;
    review: Review;
    note: string;
  } | null;
};
type Props = {
  data: Snapshot;
  detail: ImportDetail;
  changed: (message: string) => Promise<void>;
};
const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (v) => v.toUpperCase());
const required = (kind: string) =>
  kind === "bill"
    ? ["amount_due", "due_date"]
    : ["statement_balance", "closing_date", "due_date"];
const extras = (kind: string) =>
  kind === "bill"
    ? ["invoice_date", "subtotal", "tax", "fees"]
    : [
        "minimum_due",
        "previous_balance",
        "payments",
        "credits",
        "purchases",
        "fees",
        "interest",
      ];
const field = (key: string): Field => ({
  key,
  page: 1,
  label: label(key),
  placement: "inline",
  dateFormat: "mdy",
});
export function TextEvidence({ pages }: { pages: Page[] }) {
  const [index, setIndex] = useState(0);
  const page = pages[index] ?? pages[0];
  return (
    <details className="pdf-text">
      <summary>Extracted page text</summary>
      {page ? (
        <>
          <label>
            Evidence page
            <select
              value={page.number}
              onChange={(e) => setIndex(Number(e.target.value) - 1)}
            >
              {pages.map((p) => (
                <option key={p.number} value={p.number}>
                  Page {p.number}
                </option>
              ))}
            </select>
          </label>
          <ol>
            {page.lines.map((line, i) => (
              <li key={i}>
                <span>{line}</span>
              </li>
            ))}
          </ol>
          <p>
            Line numbers refer to extracted text. Compare with the original PDF
            when approving a mapping.
          </p>
        </>
      ) : (
        <p>No supported text layer is available.</p>
      )}
    </details>
  );
}
function Values({ value }: { value: Extraction }) {
  return (
    <div className="pdf-values">
      {value.errors.length > 0 && (
        <div role="alert" className="form-error">
          <strong>Review required</strong>
          <ul>
            {value.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {value.values.map((v) => (
            <tr key={v.key}>
              <td>{label(v.key)}</td>
              <td>
                {v.date ?? (v.cents === null ? "Unresolved" : money(v.cents))}
              </td>
              <td>
                Page {v.page}, line {v.line}
                <small>{v.raw}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {value.notes.map((n, i) => (
        <p key={i}>{n}</p>
      ))}
    </div>
  );
}
export function useWrite(close: () => void, saved: Props["changed"]) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true),
    running = useRef(false),
    operation = useRef({ key: "", id: "" });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function write(
    cmd: string,
    args: Record<string, unknown>,
    message: string,
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const key = JSON.stringify({ cmd, args });
    if (operation.current.key !== key)
      operation.current = { key, id: crypto.randomUUID() };
    try {
      await command(cmd, { ...args, operation: operation.current.id });
    } catch (e) {
      if (active.current) {
        setError(String(e));
        setBusy(false);
        running.current = false;
      }
      return;
    }
    if (active.current) {
      close();
      try {
        await saved(message);
      } finally {
        if (active.current) {
          setBusy(false);
          running.current = false;
        }
      }
    }
  }
  return { busy, error, write };
}
export default function PdfDocuments({ data, detail, changed }: Props) {
  const [doc, setDoc] = useState<Document | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [editor, setEditor] = useState<Template | null | undefined>(),
    [apply, setApply] = useState<Template | null>(null),
    [exported, setExported] = useState("");
  const refresh = async (message: string) => {
    setReload((n) => n + 1);
    await changed(message);
  };
  const action = useWrite(() => {}, refresh);
  useEffect(() => {
    let live = true;
    setDoc(null);
    setError("");
    command<Document>("pdf_document", {
      workspace: data.workspace,
      id: detail.source.id,
    })
      .then((d) => {
        if (live) setDoc(d);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [data.workspace, detail.source.id, detail.source.revision, reload]);
  async function exportPdf() {
    setError("");
    try {
      setExported(
        await command<string>("export_original_pdf", {
          workspace: data.workspace,
          id: detail.source.id,
        }),
      );
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="pdf-documents">
      <div className="pdf-heading">
        <div>
          <h3>
            <FileText size={18} /> PDF fields &amp; templates
          </h3>
          <p>
            Extract locally, review the evidence, then update an existing bill
            or card statement.
          </p>
        </div>
        <button className="secondary" onClick={() => void exportPdf()}>
          Export original PDF
        </button>
      </div>
      {exported && (
        <p className="pdf-export">
          Original saved: {exported}{" "}
          <button
            className="text-button"
            onClick={() =>
              void command("open_pdf_folder").catch((e) => setError(String(e)))
            }
          >
            Open PDF folder
          </button>
        </p>
      )}
      {(error || action.error) && (
        <p role="alert" className="form-error">
          {error || action.error}{" "}
          <button className="secondary" onClick={() => setReload((n) => n + 1)}>
            Reload PDF review
          </button>
        </p>
      )}
      {!doc ? (
        <p role="status">Loading PDF evidence...</p>
      ) : (
        <>
          <PdfOriginal workspace={data.workspace} sourceId={detail.source.id} />
          <TextEvidence pages={doc.pages} />
          {doc.pages.length === 0 ? (
            <div className="pdf-empty">
              <p>
                This source has no extracted text. Retry local extraction for an
                older evidence-only PDF. Scans and unsupported files can be
                entered manually.
              </p>
              <button
                className="secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.write(
                    "reextract_import",
                    {
                      workspace: data.workspace,
                      id: detail.source.id,
                      revision: detail.source.revision,
                      sheet: null,
                    },
                    "PDF extraction retried.",
                  )
                }
              >
                Extract text locally
              </button>
            </div>
          ) : (
            <>
              {doc.applied && (
                <article className="pdf-applied">
                  <h4>Document already applied</h4>
                  <p>
                    {doc.applied.review.targetName}:{" "}
                    {money(doc.applied.review.newAmountCents)}, due{" "}
                    {doc.applied.review.dueDate}. {doc.applied.note}
                  </p>
                  <p>
                    Its saved evidence remains here. Further manual corrections
                    belong in the existing bill or statement.
                  </p>
                  <Values value={doc.applied.review.extraction} />
                  <PdfReuse
                    workspace={data.workspace}
                    application={doc.applied.id}
                    pages={doc.pages}
                    saved={refresh}
                  />
                </article>
              )}
              <div className="pdf-heading">
                <h4>Reusable document templates</h4>
                <button className="secondary" onClick={() => setEditor(null)}>
                  <Plus size={15} /> New PDF template
                </button>
              </div>
              {!doc.templates.length && (
                <p>
                  Approve a template using this document as the sample. Later
                  matching PDFs can use it offline.
                </p>
              )}
              {doc.templates.map((t) => (
                <article className="pdf-template" key={t.id}>
                  <div>
                    <strong>{t.definition.name}</strong>
                    <small>
                      {label(t.definition.kind)} · Version {t.revision} ·{" "}
                      {t.enabled ? "Active" : "Paused"}
                    </small>
                  </div>
                  <div className="pdf-buttons">
                    <button
                      className="secondary"
                      disabled={!t.enabled || !!doc.applied}
                      onClick={() => setApply(t)}
                    >
                      Review with template
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setEditor(t)}
                    >
                      Edit mapping
                    </button>
                    <button
                      className="text-button"
                      disabled={action.busy}
                      onClick={() =>
                        void action.write(
                          "set_pdf_template_enabled",
                          {
                            workspace: data.workspace,
                            id: t.id,
                            revision: t.revision,
                            enabled: !t.enabled,
                          },
                          t.enabled ? "Template paused." : "Template enabled.",
                        )
                      }
                    >
                      {t.enabled ? "Pause" : "Enable"}
                    </button>
                  </div>
                </article>
              ))}
            </>
          )}
          {editor !== undefined && (
            <TemplateEditor
              data={data}
              detail={detail}
              pages={doc.pages}
              value={editor}
              close={() => setEditor(undefined)}
              saved={refresh}
            />
          )}{" "}
          {apply && (
            <ApplicationEditor
              data={data}
              detail={detail}
              template={apply}
              pages={doc.pages}
              close={() => setApply(null)}
              saved={refresh}
            />
          )}
        </>
      )}
    </section>
  );
}
export function TemplateEditor({
  data,
  detail,
  pages,
  value,
  close,
  saved,
}: Omit<Props, "changed"> & {
  pages: Page[];
  value: Template | null;
  close: () => void;
  saved: Props["changed"];
}) {
  const [id] = useState(value?.id ?? crypto.randomUUID());
  const [initial] = useState<Definition>(
    value?.definition ?? {
      name: "",
      kind: "bill",
      pageCount: pages.length,
      identity: { page: 1, text: pages[0]?.lines[0] ?? "" },
      currency: {
        page: 1,
        text:
          pages[0]?.lines.find((l) => /\bUSD\b/i.test(l)) ?? "Currency: USD",
      },
      fields: required("bill").map(field),
      sumParts: [],
    },
  );
  const [input, set] = useState(initial),
    [review, setReview] = useState<{
      token: string;
      extraction: Extraction;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [loading, setLoading] = useState(false),
    [readError, setReadError] = useState("");
  const sequence = useRef(0),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      ++sequence.current;
    };
  }, []);
  const dirty = JSON.stringify(input) !== JSON.stringify(initial) || confirmed;
  const requestClose = () => {
    if (!dirty || window.confirm("Discard these unsaved PDF template changes?"))
      close();
  };
  const { busy, error, write } = useWrite(close, saved);
  const sample = {
    sourceId: detail.source.id,
    sourceRevision: detail.source.revision,
    id,
    revision: value?.revision ?? 0,
    definition: input,
  };
  function change(d: Definition) {
    ++sequence.current;
    set(d);
    setReview(null);
    setConfirmed(false);
    setLoading(false);
    setReadError("");
  }
  function update(index: number, values: Partial<Field>) {
    change({
      ...input,
      fields: input.fields.map((f, i) =>
        i === index ? { ...f, ...values } : f,
      ),
    });
  }
  async function preview(e: FormEvent) {
    e.preventDefault();
    const seq = ++sequence.current;
    setLoading(true);
    setReadError("");
    setReview(null);
    setConfirmed(false);
    try {
      const r = await command<{ token: string; extraction: Extraction }>(
        "preview_pdf_template",
        { workspace: data.workspace, input: sample },
      );
      if (active.current && seq === sequence.current) setReview(r);
    } catch (e) {
      if (active.current && seq === sequence.current) setReadError(String(e));
    } finally {
      if (active.current && seq === sequence.current) setLoading(false);
    }
  }
  return (
    <Modal
      title={value ? "Edit PDF template" : "New PDF template"}
      busy={busy}
      onClose={requestClose}
    >
      <form className="pdf-form" onSubmit={preview}>
        <fieldset disabled={busy}>
          <PdfOriginal workspace={data.workspace} sourceId={detail.source.id} />
          <TextEvidence pages={pages} />
          <div className="pdf-form-grid">
            <label>
              Template name
              <input
                required
                maxLength={100}
                value={input.name}
                onChange={(e) => change({ ...input, name: e.target.value })}
              />
            </label>
            <label>
              Document type
              <select
                value={input.kind}
                onChange={(e) =>
                  change({
                    ...input,
                    kind: e.target.value,
                    fields: required(e.target.value).map(field),
                    sumParts: [],
                  })
                }
              >
                <option value="bill">Bill / invoice</option>
                <option value="statement">Credit card statement</option>
              </select>
            </label>
            <label>
              Expected pages
              <input
                required
                type="number"
                min={1}
                max={100}
                value={input.pageCount}
                onChange={(e) =>
                  change({ ...input, pageCount: Number(e.target.value) })
                }
              />
            </label>
          </div>
          {(["identity", "currency"] as const).map((key) => (
            <div className="pdf-anchor" key={key}>
              <label>
                {key === "identity"
                  ? "Exact biller / document identity line"
                  : "Exact USD currency line"}
                <input
                  required
                  maxLength={200}
                  value={input[key].text}
                  onChange={(e) =>
                    change({
                      ...input,
                      [key]: { ...input[key], text: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                {label(key)} page
                <input
                  type="number"
                  required
                  min={1}
                  max={input.pageCount}
                  value={input[key].page}
                  onChange={(e) =>
                    change({
                      ...input,
                      [key]: { ...input[key], page: Number(e.target.value) },
                    })
                  }
                />
              </label>
            </div>
          ))}
          <h3>Field labels</h3>
          <p>
            Use exact labels. Values must follow the label on the same line or
            the next extracted line. A statement balance must not use Minimum
            due.
          </p>
          {input.fields.map((f, i) => (
            <div className="pdf-field" key={f.key}>
              <strong>{label(f.key)}</strong>
              <div className="pdf-form-grid">
                <label>
                  {label(f.key)} label
                  <input
                    required
                    maxLength={150}
                    value={f.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                </label>
                <label>
                  {label(f.key)} page
                  <input
                    required
                    type="number"
                    min={1}
                    max={input.pageCount}
                    value={f.page}
                    onChange={(e) =>
                      update(i, { page: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  {label(f.key)} position
                  <select
                    value={f.placement}
                    onChange={(e) => update(i, { placement: e.target.value })}
                  >
                    <option value="inline">After label</option>
                    <option value="next_line">Next line</option>
                  </select>
                </label>
                {f.key.endsWith("_date") ? (
                  <label>
                    {label(f.key)} format
                    <select
                      value={f.dateFormat}
                      onChange={(e) =>
                        update(i, { dateFormat: e.target.value })
                      }
                    >
                      <option value="mdy">MM/DD/YYYY</option>
                      <option value="dmy">DD/MM/YYYY</option>
                      <option value="iso">YYYY-MM-DD</option>
                    </select>
                  </label>
                ) : (
                  !required(input.kind).includes(f.key) && (
                    <label>
                      {label(f.key)} arithmetic
                      <select
                        value={
                          input.sumParts.find((p) => p.key === f.key)?.sign ?? 0
                        }
                        onChange={(e) =>
                          change({
                            ...input,
                            sumParts: [
                              ...input.sumParts.filter((p) => p.key !== f.key),
                              ...(Number(e.target.value)
                                ? [{ key: f.key, sign: Number(e.target.value) }]
                                : []),
                            ],
                          })
                        }
                      >
                        <option value={0}>Not part of sum</option>
                        <option value={1}>Add to total</option>
                        <option value={-1}>Subtract from total</option>
                      </select>
                    </label>
                  )
                )}
              </div>
              {!required(input.kind).includes(f.key) && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    change({
                      ...input,
                      fields: input.fields.filter((x) => x.key !== f.key),
                      sumParts: input.sumParts.filter((x) => x.key !== f.key),
                    })
                  }
                >
                  Remove {label(f.key)}
                </button>
              )}
            </div>
          ))}
          <label>
            Add optional field
            <select
              value=""
              onChange={(e) => {
                if (e.target.value)
                  change({
                    ...input,
                    fields: [...input.fields, field(e.target.value)],
                  });
              }}
            >
              <option value="">Choose another field</option>
              {extras(input.kind)
                .filter((key) => !input.fields.some((f) => f.key === key))
                .map((key) => (
                  <option key={key} value={key}>
                    {label(key)}
                  </option>
                ))}
            </select>
          </label>
          {(readError || error) && (
            <p role="alert" className="form-error">
              {readError || error}
            </p>
          )}
          <button className="secondary" disabled={loading}>
            {loading ? "Checking sample..." : "Preview sample fields"}
          </button>
          {review && (
            <>
              <Values value={review.extraction} />
              {review.extraction.errors.length === 0 && (
                <label className="pdf-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I checked the source values, identity, currency and field
                  mapping.
                </label>
              )}
            </>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={requestClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                !review ||
                review.extraction.errors.length > 0 ||
                !confirmed ||
                busy
              }
              onClick={() =>
                void write(
                  "approve_pdf_template",
                  {
                    workspace: data.workspace,
                    input: { input: sample, token: review?.token, confirmed },
                  },
                  "PDF template version approved. No financial record was changed.",
                )
              }
            >
              Approve template version
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function ApplicationEditor({
  data,
  detail,
  template,
  pages,
  close,
  saved,
}: Omit<Props, "changed"> & {
  template: Template;
  pages: Page[];
  close: () => void;
  saved: Props["changed"];
}) {
  const [month, setMonth] = useState(data.month),
    [targets, setTargets] = useState<{ id: string; name: string }[] | null>(
      null,
    ),
    [target, setTarget] = useState(""),
    [note, setNote] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [readError, setReadError] = useState(""),
    [loading, setLoading] = useState(false),
    [reload, setReload] = useState(0);
  const sequence = useRef(0),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      ++sequence.current;
    };
  }, []);
  const dirty = target !== "" || note !== "" || confirmed;
  const requestClose = () => {
    if (!dirty || window.confirm("Discard this unsaved document application?"))
      close();
  };
  const { busy, error, write } = useWrite(close, saved);
  function invalidate() {
    ++sequence.current;
    setReview(null);
    setConfirmed(false);
    setLoading(false);
    setReadError("");
  }
  useEffect(() => {
    let live = true;
    setTargets(null);
    setTarget("");
    invalidate();
    const load =
      template.definition.kind === "bill"
        ? command<any[]>("bill_month", {
            workspace: data.workspace,
            month,
          }).then((rows) =>
            rows
              .filter((o) => !o.cancelled)
              .map((o) => ({
                id: o.id,
                name: `${o.plan.name} - ${o.dueDate}`,
              })),
          )
        : command<any>("card_statement_month", {
            workspace: data.workspace,
            month,
          }).then((v) =>
            v.statements.map((s: any) => ({
              id: s.draft.accountId,
              name:
                data.accounts.find((a) => a.id === s.draft.accountId)?.name ??
                s.draft.accountId,
            })),
          );
    load
      .then((v) => {
        if (live) setTargets(v);
      })
      .catch((e) => {
        if (live) setReadError(String(e));
      });
    return () => {
      live = false;
    };
  }, [data.workspace, month, template.definition.kind, reload]);
  const input = {
    sourceId: detail.source.id,
    sourceRevision: detail.source.revision,
    templateId: template.id,
    templateRevision: template.revision,
    targetId: target,
    month: template.definition.kind === "bill" ? "" : month,
    note,
  };
  async function preview(e: FormEvent) {
    e.preventDefault();
    const seq = ++sequence.current;
    setLoading(true);
    setReview(null);
    setReadError("");
    setConfirmed(false);
    try {
      const r = await command<Review>("preview_pdf_application", {
        workspace: data.workspace,
        input,
      });
      if (active.current && seq === sequence.current) setReview(r);
    } catch (e) {
      if (active.current && seq === sequence.current) setReadError(String(e));
    } finally {
      if (active.current && seq === sequence.current) setLoading(false);
    }
  }
  return (
    <Modal title="Review PDF application" busy={busy} onClose={requestClose}>
      <form className="pdf-form" onSubmit={preview}>
        <fieldset disabled={busy}>
          <p>
            {template.definition.name} · Version {template.revision}. This
            updates a bill or statement; it records no payment or spending.
          </p>
          <PdfOriginal workspace={data.workspace} sourceId={detail.source.id} />
          <TextEvidence pages={pages} />
          <div className="pdf-form-grid">
            <label>
              Target month
              <input
                type="month"
                required
                value={month}
                onChange={(e) => {
                  invalidate();
                  setMonth(e.target.value);
                }}
              />
            </label>
            <label>
              {template.definition.kind === "bill"
                ? "Existing bill"
                : "Card cycle"}
              <select
                required
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
          {targets === null && !readError && (
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
              required
              maxLength={1000}
              value={note}
              onChange={(e) => {
                invalidate();
                setNote(e.target.value);
              }}
            />
          </label>
          {(error || readError) && (
            <p role="alert" className="form-error">
              {error || readError}
            </p>
          )}
          {targets === null && readError && (
            <button
              type="button"
              className="secondary"
              onClick={() => setReload((n) => n + 1)}
            >
              Retry target records
            </button>
          )}
          <button className="secondary" disabled={loading || !target}>
            {loading ? "Checking document..." : "Preview document changes"}
          </button>
          {review && (
            <>
              <div className="pdf-comparison">
                <h3>{review.targetName}</h3>
                <p>
                  Total:{" "}
                  {review.priorAmountCents === null
                    ? "Not confirmed"
                    : money(review.priorAmountCents)}{" "}
                  → <strong>{money(review.newAmountCents)}</strong>
                </p>
                <p>
                  Due date: {review.priorDueDate} →{" "}
                  <strong>{review.dueDate}</strong>
                </p>
                {review.calculation && (
                  <>
                    <p>
                      Calculated statement:{" "}
                      {review.calculation.balanceCents === null
                        ? "Unknown"
                        : money(review.calculation.balanceCents)}
                      {review.calculation.balanceCents !== null && (
                        <>
                          {" "}
                          · Difference:{" "}
                          {money(
                            review.newAmountCents -
                              review.calculation.balanceCents,
                          )}
                        </>
                      )}
                    </p>
                    {review.calculation.warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </>
                )}
              </div>
              <Values value={review.extraction} />
              <label className="pdf-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I checked the original document, selected record and changes
                above.
              </label>
            </>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={requestClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={!review || !confirmed || busy}
              onClick={() =>
                void write(
                  "apply_pdf_application",
                  {
                    workspace: data.workspace,
                    input: { input, token: review?.token, confirmed },
                  },
                  "PDF values applied and evidence linked. No payment or expense was created.",
                )
              }
            >
              Apply document once
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
