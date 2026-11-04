import { useEffect, useRef, useState, type FormEvent } from "react";
import { command } from "./api";
import { Modal } from "./EntryDialog";
import { TextEvidence, useWrite } from "./PdfDocuments";
import type { Snapshot } from "./types";
import type { ImportDetail } from "./importTypes";
export type Definition = {
  name: string;
  identity: string;
  currency: string;
  start: string;
  end: string;
  headers: string[];
  separator: string;
  automatic: boolean;
};
type Template = {
  id: string;
  revision: number;
  enabled: boolean;
  definition: Definition;
};
type Proof = {
  headers: string[];
  rows: string[][];
  evidence: { page: number; firstLine: number; lastLine: number }[];
};
type View = {
  templates: {
    template: Template;
    recognized: boolean;
    issue: string | null;
  }[];
  binding: { templateId: string; version: number; proof: Proof } | null;
};
type Props = {
  data: Snapshot;
  detail: ImportDetail;
  changed: (message: string) => Promise<void>;
};
function Evidence({ proof }: { proof: Proof }) {
  const [page, setPage] = useState(0);
  const count = Math.max(1, Math.ceil(proof.rows.length / 25));
  const current = Math.min(page, count - 1);
  return (
    <div className="pdf-values">
      <p>
        {proof.rows.length} extracted rows. Values remain unchanged until
        account and column interpretation is confirmed.
      </p>
      <table>
        <thead>
          <tr>
            <th>PDF evidence</th>
            {proof.headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {proof.rows.slice(current * 25, (current + 1) * 25).map((row, i) => {
            const e = proof.evidence[current * 25 + i];
            return (
              <tr key={i}>
                <td>
                  Page {e.page}, lines {e.firstLine}-{e.lastLine}
                </td>
                {row.map((v, n) => (
                  <td key={n}>{v || "(empty)"}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {count > 1 && (
        <div className="pdf-buttons">
          <button
            type="button"
            className="secondary"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            Previous evidence rows
          </button>
          <span>
            Page {current + 1} of {count}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={current === count - 1}
            onClick={() => setPage(current + 1)}
          >
            Next evidence rows
          </button>
        </div>
      )}
    </div>
  );
}
export default function PdfTables({ data, detail, changed }: Props) {
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [editor, setEditor] = useState<{
      template: Template | null;
      stage: boolean;
    } | null>(null);
  const refresh = async (message: string) => {
    setReload((n) => n + 1);
    await changed(message);
  };
  const action = useWrite(() => {}, refresh);
  useEffect(() => {
    let live = true;
    setView(null);
    setError("");
    command<View>("pdf_table_view", {
      workspace: data.workspace,
      id: detail.source.id,
    })
      .then((v) => {
        if (live) setView(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [data.workspace, detail.source.id, detail.source.revision, reload]);
  const locked = detail.rows.some((r) => r.disposition !== "pending");
  return (
    <section className="pdf-documents" aria-label="PDF transaction tables">
      <div className="pdf-heading">
        <h3>Transaction tables</h3>
        <button
          className="secondary"
          disabled={locked || !detail.dataset.pdfPages?.length}
          onClick={() => setEditor({ template: null, stage: false })}
        >
          New table template
        </button>
      </div>
      <p>
        Extract supported text tables into normal import review. Template
        approval and staging record no spending or payments.
      </p>
      {locked && (
        <p>
          Rows have been processed. Use a new download observation to review a
          different mapping.
        </p>
      )}
      {(error || action.error) && (
        <p className="form-error" role="alert">
          {error || action.error}{" "}
          <button className="secondary" onClick={() => setReload((n) => n + 1)}>
            Reload table templates
          </button>
        </p>
      )}
      {!view && !error && <p role="status">Loading table templates...</p>}
      {view && (
        <>
          {view.binding && (
            <details>
              <summary>
                Staged table evidence - version {view.binding.version}
              </summary>
              <Evidence proof={view.binding.proof} />
            </details>
          )}
          {view.templates.length === 0 && (
            <p>
              No transaction-table templates yet. Approve a sample to reuse its
              layout.
            </p>
          )}
          {view.templates.map(({ template: t, recognized, issue }) => (
            <article className="pdf-template" key={t.id}>
              <div>
                <strong>{t.definition.name}</strong>
                <small>
                  Version {t.revision} - {t.enabled ? "Active" : "Paused"} -{" "}
                  {recognized
                    ? issue
                      ? "Layout needs review"
                      : "Recognized layout"
                    : "Different document"}
                </small>
                <small>
                  {t.definition.automatic
                    ? "Matching future files stage automatically"
                    : "Manual staging"}
                </small>
                {issue && <p>{issue}</p>}
              </div>
              <div className="pdf-buttons">
                <button
                  className="secondary"
                  disabled={
                    locked ||
                    !t.enabled ||
                    !!issue ||
                    !recognized ||
                    action.busy
                  }
                  onClick={() => setEditor({ template: t, stage: true })}
                >
                  Review table rows
                </button>
                <button
                  className="text-button"
                  disabled={locked || action.busy}
                  onClick={() => setEditor({ template: t, stage: false })}
                >
                  Edit table template
                </button>
                <button
                  className="text-button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.write(
                      "set_pdf_table_enabled",
                      {
                        workspace: data.workspace,
                        id: t.id,
                        revision: t.revision,
                        enabled: !t.enabled,
                      },
                      t.enabled
                        ? "Table template paused."
                        : "Table template enabled.",
                    )
                  }
                >
                  {t.enabled ? "Pause table" : "Enable table"}
                </button>
              </div>
            </article>
          ))}
        </>
      )}
      {editor && (
        <TableTemplateEditor
          data={data}
          detail={detail}
          {...editor}
          close={() => setEditor(null)}
          saved={refresh}
        />
      )}
    </section>
  );
}
export function TableTemplateEditor({
  data,
  detail,
  template,
  stage,
  close,
  saved,
}: Omit<Props, "changed"> & {
  template: Template | null;
  stage: boolean;
  close: () => void;
  saved: Props["changed"];
}) {
  const [id] = useState(template?.id ?? crypto.randomUUID());
  const pages = detail.dataset.pdfPages ?? [];
  const [initial] = useState<Definition>(
    template?.definition ?? {
      name: "",
      identity: pages[0]?.lines[0] ?? "",
      currency:
        pages[0]?.lines.find((l) => /\bUSD\b/i.test(l)) ?? "Currency: USD",
      start: "Transactions",
      end: "End transactions",
      headers: ["Date", "Description", "Amount"],
      separator: "pipe",
      automatic: false,
    },
  );
  const [input, set] = useState(initial),
    [preview, setPreview] = useState<{
      token: string;
      extraction: Proof;
    } | null>(null),
    [loading, setLoading] = useState(false),
    [readError, setReadError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const active = useRef(true),
    sequence = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      ++sequence.current;
    };
  }, []);
  const { busy, error, write } = useWrite(close, saved);
  const dirty = JSON.stringify(input) !== JSON.stringify(initial) || confirmed;
  const requestClose = () => {
    if (!dirty || window.confirm("Discard this unsaved table review?")) close();
  };
  function change(next: Definition) {
    ++sequence.current;
    set(next);
    setPreview(null);
    setConfirmed(false);
    setLoading(false);
    setReadError("");
  }
  const request = {
    sourceId: detail.source.id,
    sourceRevision: detail.source.revision,
    templateId: id,
    templateRevision: template?.revision ?? 0,
    definition: stage ? null : input,
  };
  async function calculate(e: FormEvent) {
    e.preventDefault();
    const seq = ++sequence.current;
    setPreview(null);
    setConfirmed(false);
    setReadError("");
    setLoading(true);
    try {
      const p = await command<{ token: string; extraction: Proof }>(
        "preview_pdf_table",
        { workspace: data.workspace, input: request },
      );
      if (active.current && seq === sequence.current) setPreview(p);
    } catch (e) {
      if (active.current && seq === sequence.current) setReadError(String(e));
    } finally {
      if (active.current && seq === sequence.current) setLoading(false);
    }
  }
  return (
    <Modal
      title={stage ? "Review PDF table rows" : "Approve PDF table template"}
      busy={busy}
      onClose={requestClose}
    >
      <form className="pdf-form" onSubmit={calculate}>
        <fieldset disabled={busy}>
          <TextEvidence pages={pages} />
          {!stage && (
            <>
              <label>
                Table template name
                <input
                  required
                  maxLength={100}
                  value={input.name}
                  onChange={(e) => change({ ...input, name: e.target.value })}
                />
              </label>
              {(
                [
                  ["identity", "Exact document identity on page 1"],
                  ["currency", "Exact USD currency line on page 1"],
                  ["start", "Exact table start line on each page"],
                  ["end", "Exact table end line on each page"],
                ] as const
              ).map(([key, title]) => (
                <label key={key}>
                  {title}
                  <input
                    required
                    maxLength={300}
                    value={input[key]}
                    onChange={(e) =>
                      change({ ...input, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                Table columns (one name per line)
                <textarea
                  required
                  rows={4}
                  value={input.headers.join("\n")}
                  onChange={(e) =>
                    change({ ...input, headers: e.target.value.split("\n") })
                  }
                />
              </label>
              <label>
                Cell layout
                <select
                  value={input.separator}
                  onChange={(e) =>
                    change({ ...input, separator: e.target.value })
                  }
                >
                  <option value="pipe">Pipe separated (|)</option>
                  <option value="tab">Tab separated</option>
                  <option value="spaces">
                    Two or more spaces between cells
                  </option>
                  <option value="lines">One cell per text line</option>
                </select>
              </label>
              <label className="pdf-check">
                <input
                  type="checkbox"
                  checked={input.automatic}
                  onChange={(e) =>
                    change({ ...input, automatic: e.target.checked })
                  }
                />
                Automatically stage matching future PDFs for import review
              </label>
              <p>
                Every page must have both table markers. Wrapped descriptions or
                changing columns need another supported layout. Automatic
                staging requires exactly one enabled matching template and posts
                no money.
              </p>
            </>
          )}
          {stage && (
            <p>
              {template?.definition.name} - version {template?.revision}.
              Staging replaces unprocessed rows and resets column/coverage
              confirmation. Existing transactions stay unchanged.
            </p>
          )}
          {(error || readError) && (
            <p role="alert" className="form-error">
              {error || readError}
            </p>
          )}
          <button className="secondary" disabled={loading}>
            {loading ? "Checking table..." : "Preview table rows"}
          </button>
          {preview && (
            <>
              <Evidence proof={preview.extraction} />
              <label className="pdf-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I compared every extracted row with the original PDF and
                confirmed the table boundaries.
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
              disabled={!preview || !confirmed || busy}
              onClick={() =>
                void write(
                  "save_pdf_table",
                  {
                    workspace: data.workspace,
                    input: { request, token: preview?.token, confirmed },
                  },
                  stage
                    ? "PDF rows staged. Confirm account, columns and coverage before processing."
                    : "PDF table template version approved.",
                )
              }
            >
              {stage ? "Stage rows for review" : "Approve table template"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
