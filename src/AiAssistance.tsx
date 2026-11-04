import HelpTip from "./HelpTip";
import { useEffect, useRef, useState } from "react";
import { command } from "./api";
import { Modal } from "./EntryDialog";
import type { ImportDetail } from "./importTypes";
import PdfOriginal from "./PdfOriginal";
import AiRowsReview from "./AiRowsReview";
import AiDocumentReview from "./AiDocumentReview";
import AiConfigurationReview, {
  type Configuration,
} from "./AiConfigurationReview";
import type { Snapshot } from "./types";
import "./aiAssistance.css";

type Provider = {
  provider: string;
  enabled: boolean;
  model: string;
  hasKey: boolean;
};
type Input = {
  sourceId: string;
  sourceRevision: number;
  provider: string;
  task: string;
  scope: string;
  text: string;
};
type Consent = {
  token: string;
  model: string;
  sourceName: string;
  attachmentBytes: number;
  text: string;
};
type Evidence = { page: number | null; quote: string };
export type AiProposal = {
  configuration?: Configuration | null;
  fields: { key: string; value: string | null; evidence: Evidence }[];
  rows: {
    date: string | null;
    description: string;
    amount: string | null;
    direction: string;
    status: string;
    currency: string | null;
    evidence: Evidence;
  }[];
  warnings: string[];
};
export type AiJob = {
  id: string;
  sourceId: string;
  request: { input: Input; model: string; attachmentBytes: number };
  status: string;
  createdAt: string;
  finishedAt: string | null;
  proposal: AiProposal | null;
  failure: { kind: string; message: string; retryAfter: number | null } | null;
  retryNotBefore: number | null;
  usage?: { inputTokens: number; outputTokens: number } | null;
};
function sourceText(detail: ImportDetail) {
  const pages = detail.dataset.pdfPages ?? [];
  return (
    pages.length
      ? pages.map((p) => `Page ${p.number}\n${p.lines.join("\n")}`).join("\n\n")
      : [
          detail.dataset.headers.join("\t"),
          ...detail.dataset.rows.slice(0, 200).map((r) => r.join("\t")),
        ].join("\n")
  ).slice(0, 60000);
}
export default function AiAssistance({
  workspace,
  data,
  detail,
  changed,
  disabled = false,
}: {
  workspace: string;
  data: Snapshot;
  detail: ImportDetail;
  changed: (message: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="assistance-launch">
      <HelpTip topic="optionalAi" />
      <button
        className="secondary"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        AI document assistance
      </button>
      <span>
        {disabled
          ? "Save or discard column edits before AI review."
          : "Optional · confirm what to send"}
      </span>
      {detail.dataset.assisted && (
        <RowEvidence workspace={workspace} source={detail.source.id} />
      )}
      {open && (
        <Editor
          workspace={workspace}
          data={data}
          detail={detail}
          changed={changed}
          close={() => setOpen(false)}
        />
      )}
    </div>
  );
}
function Editor({
  workspace,
  data,
  detail,
  close,
  changed,
}: {
  workspace: string;
  data: Snapshot;
  detail: ImportDetail;
  close: () => void;
  changed: (message: string) => Promise<void>;
}) {
  const [configReview, setConfigReview] = useState<AiJob | null>(null);
  const [documentReview, setDocumentReview] = useState<AiJob | null>(null);
  const [rowReview, setRowReview] = useState<AiJob | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]),
    [jobs, setJobs] = useState<AiJob[]>([]),
    [provider, setProvider] = useState("claude"),
    [task, setTask] = useState(
      detail.source.format === "pdf" ? "bill" : "transactions",
    ),
    [scope, setScope] = useState("text"),
    [text, setText] = useState(() => sourceText(detail)),
    [consent, setConsent] = useState<Consent | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [ready, setReady] = useState(false),
    [dirty, setDirty] = useState(false);
  const active = useRef(true),
    running = useRef(false),
    sendId = useRef<string | null>(null);
  const source = detail.source.id;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const j = await command<AiJob[]>("ai_jobs", { workspace, source });
        if (!live) return;
        setJobs(j);
        if (j.some((v) => v.status === "running"))
          timer = setTimeout(() => void poll(), 1500);
      } catch (e) {
        if (live) setError(String(e));
      }
    };
    setReady(false);
    command<Provider[]>("ai_provider_settings", { workspace })
      .then((p) => {
        if (live) {
          setProviders(p);
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [workspace, source, reload]);
  const current = providers.find((p) => p.provider === provider);
  const input: Input = {
    sourceId: source,
    sourceRevision: detail.source.revision,
    provider,
    task,
    scope,
    text,
  };
  const invalidate = () => {
    setConsent(null);
    setConfirmed(false);
    sendId.current = null;
    setDirty(true);
    setError("");
  };
  const perform = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (active.current) setError(String(e));
    } finally {
      if (active.current) {
        running.current = false;
        setBusy(false);
      }
    }
  };
  const prepare = () =>
    void perform(async () => {
      const c = await command<Consent>("ai_prepare", { workspace, input });
      if (active.current) {
        setConsent(c);
        setConfirmed(false);
        sendId.current = crypto.randomUUID();
      }
    });
  const send = () =>
    void perform(async () => {
      if (!consent || !confirmed || !sendId.current) return;
      await command<AiJob>("ai_start", {
        workspace,
        input: { id: sendId.current, input, token: consent.token, confirmed },
      });
      if (active.current) {
        setConsent(null);
        setConfirmed(false);
        setDirty(false);
        sendId.current = null;
        setReload((n) => n + 1);
      }
    });
  const cancel = (id: string) =>
    void perform(async () => {
      await command("ai_cancel", { workspace, id });
      if (active.current) setReload((n) => n + 1);
    });
  return (
    <Modal
      title="AI document assistance"
      busy={busy}
      onClose={() => {
        if (
          !dirty ||
          window.confirm(
            "Discard this unsent request draft? Saved requests remain available.",
          )
        )
          close();
      }}
    >
      <div className="assistance-body">
        <p>
          Review extracted facts from one source. Requests use your selected
          provider's API access. Results remain proposals until you review them.
        </p>
        {error && (
          <div role="alert" className="form-error">
            {error}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setError("");
                setReload((n) => n + 1);
              }}
            >
              Refresh request status
            </button>
          </div>
        )}
        <div className="assistance-grid">
          <section aria-label="Selected source">
            <h3>{detail.source.name}</h3>
            {detail.source.format === "pdf" && (
              <PdfOriginal workspace={workspace} sourceId={source} />
            )}
            {detail.previewUrl && (
              <img
                className="assistance-image"
                src={detail.previewUrl}
                alt="Selected source evidence"
              />
            )}
            <p>
              Check all pages and amounts against the original. The text sample
              can be incomplete; edit or redact it before sending.
            </p>
          </section>
          <section aria-label="Request material">
            <fieldset disabled={busy || !ready}>
              <label>
                AI provider
                <select
                  value={provider}
                  onChange={(e) => {
                    invalidate();
                    setProvider(e.target.value);
                  }}
                >
                  <option value="claude">Claude</option>
                  <option value="openai">OpenAI</option>
                </select>
              </label>
              <p>
                {current?.enabled && current.hasKey
                  ? `Model: ${current.model}`
                  : "Provider is disabled or has no saved key. Open Optional AI providers to configure it."}
              </p>
              <label>
                Extract
                <select
                  value={task}
                  onChange={(e) => {
                    invalidate();
                    setTask(e.target.value);
                  }}
                >
                  <option value="bill">Bill fields</option>
                  <option value="statement">Card statement fields</option>
                  <option value="transactions">Transaction rows</option>
                  {["csv", "excel"].includes(detail.source.format) && (
                    <option value="mapping">Suggest column mapping</option>
                  )}
                  {detail.source.format === "pdf" &&
                    !!detail.dataset.pdfPages?.length && (
                      <>
                        <option value="pdf_template">
                          Suggest bill/statement template
                        </option>
                        <option value="pdf_table">
                          Suggest transaction table template
                        </option>
                      </>
                    )}
                </select>
              </label>
              <label>
                Material to send
                <select
                  value={scope}
                  onChange={(e) => {
                    invalidate();
                    setScope(e.target.value);
                  }}
                >
                  <option value="text">Only the text below</option>
                  {["pdf", "image"].includes(detail.source.format) && (
                    <option value="original">
                      Original PDF or image plus text below
                    </option>
                  )}
                </select>
              </label>
              <label>
                Source text to send
                <textarea
                  rows={9}
                  value={text}
                  onChange={(e) => {
                    invalidate();
                    setText(e.target.value);
                  }}
                />
              </label>
              <p>
                {scope === "original"
                  ? "The entire selected original file will leave this PC, including all pages and visible personal details."
                  : "Only this text will leave this PC. The original file is not attached."}
              </p>
              <button
                className="secondary"
                type="button"
                disabled={
                  !current?.enabled ||
                  !current.hasKey ||
                  (scope === "text" && !text.trim())
                }
                onClick={prepare}
              >
                Review request before sending
              </button>
            </fieldset>
            {consent && (
              <div className="assistance-consent">
                <h3>Confirm this request</h3>
                <p>
                  {provider === "claude" ? "Claude" : "OpenAI"} ·{" "}
                  {consent.model} · {consent.sourceName}
                </p>
                <p>
                  {consent.attachmentBytes
                    ? `Original attachment: ${consent.attachmentBytes.toLocaleString()} bytes, plus the text below.`
                    : "Text only; no attachment."}
                </p>
                <pre>{consent.text || "No accompanying text."}</pre>
                <label className="import-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I approve sending this material to this provider.
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={!confirmed || busy}
                  onClick={send}
                >
                  Send this request
                </button>
                <p>
                  If sending reports an error, this button rechecks the same
                  request ID. A new request requires another review and may
                  incur another charge.
                </p>
              </div>
            )}
          </section>
        </div>
        <section aria-label="Saved AI requests">
          <h3>Saved requests</h3>
          <p>
            Closing this window keeps requests running. Cancelling discards the
            result locally; it cannot undo material already sent or provider
            charges.
          </p>
          {jobs.length === 0 && <p>No saved requests for this source.</p>}
          {jobs.map((j) => (
            <article className="assistance-job" key={j.id}>
              <h4>
                {j.request.input.task} · {j.status}
              </h4>
              <p>
                {j.request.input.provider} · {j.request.model} ·{" "}
                {new Date(j.createdAt).toLocaleString()}
              </p>
              {j.usage && (
                <p>
                  Tokens: {j.usage.inputTokens.toLocaleString()} in ·{" "}
                  {j.usage.outputTokens.toLocaleString()} out
                </p>
              )}
              {j.status === "running" && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => cancel(j.id)}
                >
                  Cancel request
                </button>
              )}
              {j.failure && <p role="status">{j.failure.message}</p>}
              {j.retryNotBefore && (
                <p>
                  Provider requested waiting until{" "}
                  {new Date(
                    Math.min(j.retryNotBefore * 1000, 8640000000000000),
                  ).toLocaleString()}
                  .
                </p>
              )}
              {["cancelled", "interrupted"].includes(j.status) && (
                <p>
                  No result was applied. Prepare a new request explicitly if you
                  want to try again.
                </p>
              )}
              {j.request.input.sourceRevision !== detail.source.revision && (
                <p className="import-caution">
                  The source has changed since this request. Compare this
                  historical proposal with the current source before using it.
                </p>
              )}
              <details>
                <summary>Material sent</summary>
                <p>
                  {j.request.attachmentBytes
                    ? "Original attachment and the text below were sent."
                    : "Only this text was sent."}
                </p>
                <pre>{j.request.input.text || "No accompanying text."}</pre>
              </details>
              {j.proposal && <ProposalView proposal={j.proposal} />}
              {j.proposal?.configuration && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !dirty ||
                      window.confirm(
                        "Discard the unsent request draft to review a saved configuration suggestion?",
                      )
                    ) {
                      setDirty(false);
                      setConfigReview(j);
                    }
                  }}
                >
                  Review configuration suggestion
                </button>
              )}

              {j.proposal &&
                ["bill", "statement"].includes(j.request.input.task) && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm(
                          "Discard the unsent request draft to review saved document fields?",
                        )
                      ) {
                        setDirty(false);
                        setDocumentReview(j);
                      }
                    }}
                  >
                    Review fields for bill or statement
                  </button>
                )}
              {j.proposal &&
                j.request.input.task === "transactions" &&
                ["pdf", "image"].includes(detail.source.format) && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !dirty ||
                        window.confirm(
                          "Discard the unsent request draft to review saved transaction rows?",
                        )
                      ) {
                        setDirty(false);
                        setRowReview(j);
                      }
                    }}
                  >
                    Review rows for import
                  </button>
                )}
            </article>
          ))}
        </section>
        {configReview && (
          <AiConfigurationReview
            data={data}
            detail={detail}
            job={configReview}
            close={() => setConfigReview(null)}
            saved={async (message) => {
              close();
              await changed(message);
            }}
          />
        )}
        {documentReview && (
          <AiDocumentReview
            data={data}
            detail={detail}
            job={documentReview}
            close={() => setDocumentReview(null)}
            saved={async (message) => {
              close();
              await changed(message);
            }}
          />
        )}
        {rowReview && (
          <AiRowsReview
            workspace={workspace}
            detail={detail}
            job={rowReview}
            close={() => setRowReview(null)}
            staged={async (message) => {
              close();
              await changed(message);
            }}
          />
        )}
      </div>
    </Modal>
  );
}
function RowEvidence({
  workspace,
  source,
}: {
  workspace: string;
  source: string;
}) {
  const [binding, setBinding] = useState<{ rows: AiProposal["rows"] } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setBinding(null);
    setError("");
    command<{ rows: AiProposal["rows"] } | null>("ai_rows_binding", {
      workspace,
      source,
    })
      .then((v) => {
        if (live) setBinding(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [workspace, source, reload]);
  return (
    <details className="assistance-evidence">
      <summary>Reviewed AI row evidence</summary>
      {error ? (
        <p role="alert">
          {error}
          <button className="secondary" onClick={() => setReload((n) => n + 1)}>
            Retry row evidence
          </button>
        </p>
      ) : binding ? (
        <ol>
          {binding.rows.map((r, i) => (
            <li key={i}>
              <strong>{r.description}</strong> ·{" "}
              {r.evidence.page ? `Page ${r.evidence.page}: ` : ""}
              {r.evidence.quote}
            </li>
          ))}
        </ol>
      ) : (
        <p>Loading reviewed source quotes...</p>
      )}
    </details>
  );
}
export function ProposalView({ proposal: p }: { proposal: AiProposal }) {
  const evidence = (e: Evidence) => (
    <span>
      {e.page ? `Page ${e.page}: ` : ""}
      {e.quote || "No source value found"}
    </span>
  );
  return (
    <div className="assistance-proposal">
      <p className="import-caution">
        Unconfirmed proposal. Verify every value and missing row. These values
        have not changed your records.
      </p>
      {p.warnings.map((w, i) => (
        <p key={i}>{w}</p>
      ))}
      {p.fields.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Proposed value</th>
              <th>Source quote</th>
            </tr>
          </thead>
          <tbody>
            {p.fields.map((f) => (
              <tr key={f.key}>
                <td>{f.key.replaceAll("_", " ")}</td>
                <td>{f.value ?? "Unresolved"}</td>
                <td>{evidence(f.evidence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.rows.length > 0 && (
        <div className="assistance-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Direction / status</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.date ?? "Unresolved"}</td>
                  <td>{r.description}</td>
                  <td>
                    {r.currency ?? "Unknown currency"}{" "}
                    {r.amount ?? "Unresolved"}
                  </td>
                  <td>
                    {r.direction} / {r.status}
                  </td>
                  <td>{evidence(r.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!p.fields.length && !p.rows.length && (
        <p>
          No values were extracted. Use the source's manual review workflow.
        </p>
      )}
    </div>
  );
}
