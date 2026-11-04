import { useEffect, useRef, useState } from "react";
import { command, money } from "./api";
import { Modal } from "./EntryDialog";
import { useWrite } from "./PdfDocuments";
import PdfOriginal from "./PdfOriginal";
import type { AiJob, AiProposal } from "./AiAssistance";
import type { ImportDetail, ImportCandidate } from "./importTypes";
type Row = AiProposal["rows"][number];
type Preview = {
  token: string;
  previousRows: number;
  candidates: ImportCandidate[];
};
export default function AiRowsReview({
  workspace,
  detail,
  job,
  close,
  staged,
}: {
  workspace: string;
  detail: ImportDetail;
  job: AiJob;
  close: () => void;
  staged: (message: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
      structuredClone(job.proposal?.rows ?? []),
    ),
    [preview, setPreview] = useState<Preview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [reading, setReading] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const [seedReady, setSeedReady] = useState(!detail.dataset.assisted),
    [seedReload, setSeedReload] = useState(0);
  useEffect(() => {
    if (!detail.dataset.assisted) return;
    let live = true;
    setSeedReady(false);
    setError("");
    command<{ jobId: string; rows: Row[] } | null>("ai_rows_binding", {
      workspace,
      source: detail.source.id,
    })
      .then((b) => {
        if (!b) throw new Error("Saved row review is missing.");
        if (live) {
          if (b.jobId === job.id) setRows(structuredClone(b.rows));
          setSeedReady(true);
        }
      })
      .catch((e) => {
        if (live) setError(`Reviewed rows could not be loaded. ${String(e)}`);
      });
    return () => {
      live = false;
    };
  }, [
    workspace,
    detail.source.id,
    detail.dataset.assisted,
    job.id,
    seedReload,
  ]);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const action = useWrite(close, staged);
  const input = { jobId: job.id, sourceRevision: detail.source.revision, rows };
  const change = (next: Row[]) => {
    generation.current++;
    setReading(false);
    setPreview(null);
    setConfirmed(false);
    setRows(next);
    setDirty(true);
    setError("");
  };
  const edit = (i: number, patch: Partial<Row>) =>
    change(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const review = async () => {
    const seq = ++generation.current;
    setReading(true);
    setError("");
    setPreview(null);
    setConfirmed(false);
    try {
      const p = await command<Preview>("ai_rows_preview", { workspace, input });
      if (seq === generation.current) setPreview(p);
    } catch (e) {
      if (seq === generation.current) setError(String(e));
    } finally {
      if (seq === generation.current) setReading(false);
    }
  };
  return (
    <Modal
      title="Review AI transaction rows"
      busy={action.busy}
      onClose={() => {
        if (
          !dirty ||
          window.confirm(
            "Discard the edited transaction proposal? The original AI result stays saved.",
          )
        )
          close();
      }}
    >
      <div className="assistance-body">
        <p>
          Correct the proposed rows against the original, including missing or
          repeated transactions. Staging replaces this source's unprocessed rows
          and opens the usual import review; it does not record money.
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
              alt="Original evidence for reviewed AI rows"
            />
          </details>
        )}
        {job.proposal?.warnings.map((w, i) => (
          <p className="import-caution" key={i}>
            {w}
          </p>
        ))}
        {(error || action.error) && (
          <p className="form-error" role="alert">
            {error || action.error}
          </p>
        )}
        {!seedReady && (
          <p role="status">
            Loading saved row corrections...{" "}
            <button
              type="button"
              className="secondary"
              onClick={() => setSeedReload((n) => n + 1)}
            >
              Retry saved row review
            </button>
          </p>
        )}
        <fieldset disabled={action.busy || !seedReady}>
          <div className="assistance-scroll">
            <table className="assistance-edit">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Date / amount</th>
                  <th>Direction / status / currency</th>
                  <th>Evidence</th>
                  <th>Keep</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} aria-label={`Proposed row ${i + 1}`}>
                    <td>
                      <label>
                        Description {i + 1}
                        <input
                          value={r.description}
                          maxLength={500}
                          onChange={(e) =>
                            edit(i, { description: e.target.value })
                          }
                        />
                      </label>
                    </td>
                    <td>
                      <label>
                        Date {i + 1}
                        <input
                          type="date"
                          value={r.date ?? ""}
                          onChange={(e) =>
                            edit(i, { date: e.target.value || null })
                          }
                        />
                      </label>
                      <label>
                        Amount {i + 1}
                        <input
                          inputMode="decimal"
                          value={r.amount ?? ""}
                          placeholder="Unresolved"
                          onChange={(e) =>
                            edit(i, { amount: e.target.value || null })
                          }
                        />
                      </label>
                    </td>
                    <td>
                      <label>
                        Direction {i + 1}
                        <select
                          value={r.direction}
                          onChange={(e) =>
                            edit(i, { direction: e.target.value })
                          }
                        >
                          <option value="unknown">Unknown</option>
                          <option value="out">
                            Out: purchase / withdrawal
                          </option>
                          <option value="in">
                            In: payment / credit / deposit
                          </option>
                        </select>
                      </label>
                      <label>
                        Status {i + 1}
                        <select
                          value={r.status}
                          onChange={(e) => edit(i, { status: e.target.value })}
                        >
                          <option value="unknown">Unknown</option>
                          <option value="pending">Pending</option>
                          <option value="posted">Posted</option>
                        </select>
                      </label>
                      <label>
                        Currency {i + 1}
                        <input
                          value={r.currency ?? ""}
                          placeholder="Unknown"
                          maxLength={3}
                          onChange={(e) =>
                            edit(i, {
                              currency: e.target.value.toUpperCase() || null,
                            })
                          }
                        />
                      </label>
                    </td>
                    <td>
                      <label>
                        Page {i + 1}
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={r.evidence.page ?? ""}
                          onChange={(e) =>
                            edit(i, {
                              evidence: {
                                ...r.evidence,
                                page: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Source quote {i + 1}
                        <textarea
                          rows={3}
                          value={r.evidence.quote}
                          maxLength={2000}
                          onChange={(e) =>
                            edit(i, {
                              evidence: {
                                ...r.evidence,
                                quote: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        aria-label={`Remove proposed row ${i + 1}`}
                        onClick={() => change(rows.filter((_, n) => n !== i))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-toolbar">
            <button
              type="button"
              className="secondary"
              disabled={rows.length >= 200}
              onClick={() =>
                change([
                  ...rows,
                  {
                    date: null,
                    description: "",
                    amount: null,
                    direction: "unknown",
                    status: "unknown",
                    currency: null,
                    evidence: { page: null, quote: "" },
                  },
                ])
              }
            >
              Add missing row
            </button>
            <button
              type="button"
              className="primary"
              disabled={reading || !rows.length}
              onClick={() => void review()}
            >
              Preview staged rows
            </button>
          </div>
          {preview && (
            <section aria-label="Reviewed staging preview">
              <h3>{preview.candidates.length} rows to stage</h3>
              <p>
                This replaces {preview.previousRows} unprocessed source rows.
                Existing financial records remain unchanged. Account setup and
                individual transaction confirmation follow.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Review notes</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.candidates.map((c, i) => (
                    <tr key={i}>
                      <td>{c.date ?? "Unresolved"}</td>
                      <td>{c.description}</td>
                      <td>
                        {c.amountCents === null
                          ? "Unresolved"
                          : money(c.amountCents)}{" "}
                        · {c.direction}
                      </td>
                      <td>{c.warnings.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label className="import-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I checked these rows and source quotes, including missing or
                repeated transactions.
              </label>
              <button
                type="button"
                className="primary"
                disabled={!confirmed}
                onClick={() =>
                  void action.write(
                    "ai_rows_stage",
                    {
                      workspace,
                      input: { input, token: preview.token, confirmed },
                    },
                    "Reviewed AI rows staged. Confirm account and each transaction before importing.",
                  )
                }
              >
                Stage reviewed rows
              </button>
            </section>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}
