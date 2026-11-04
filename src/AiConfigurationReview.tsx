import { useEffect, useRef, useState } from "react";
import { command, money } from "./api";
import { Modal } from "./EntryDialog";
import {
  TemplateEditor,
  useWrite,
  type Definition as DocumentDefinition,
} from "./PdfDocuments";
import {
  TableTemplateEditor,
  type Definition as TableDefinition,
} from "./PdfTables";
import MappingForm from "./MappingForm";
import type { AiJob } from "./AiAssistance";
import type {
  ImportCandidate,
  ImportDetail,
  ImportMapping,
} from "./importTypes";
import type { Snapshot } from "./types";
export type Configuration =
  | { kind: "mapping"; definition: ImportMapping }
  | { kind: "pdf_template"; definition: DocumentDefinition }
  | { kind: "pdf_table"; definition: TableDefinition };
type Props = {
  data: Snapshot;
  detail: ImportDetail;
  job: AiJob;
  close: () => void;
  saved: (message: string) => Promise<void>;
};
export default function AiConfigurationReview(props: Props) {
  const [configuration, setConfiguration] = useState<Configuration | null>(
      null,
    ),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const [id] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let live = true;
    setError("");
    setConfiguration(null);
    command<Configuration>("ai_configuration", {
      workspace: props.data.workspace,
      id: props.job.id,
      revision: props.detail.source.revision,
    })
      .then((c) => {
        if (live) setConfiguration(c);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [
    props.data.workspace,
    props.detail.source.id,
    props.detail.source.revision,
    props.job.id,
    reload,
  ]);
  if (configuration?.kind === "pdf_template")
    return (
      <TemplateEditor
        data={props.data}
        detail={props.detail}
        pages={props.detail.dataset.pdfPages ?? []}
        value={{
          id,
          revision: 0,
          enabled: false,
          definition: configuration.definition,
        }}
        close={props.close}
        saved={props.saved}
      />
    );
  if (configuration?.kind === "pdf_table")
    return (
      <TableTemplateEditor
        data={props.data}
        detail={props.detail}
        template={{
          id,
          revision: 0,
          enabled: false,
          definition: configuration.definition,
        }}
        stage={false}
        close={props.close}
        saved={props.saved}
      />
    );
  if (configuration?.kind === "mapping")
    return <MappingReview {...props} suggestion={configuration.definition} />;
  return (
    <Modal title="Open configuration suggestion" onClose={props.close}>
      <div className="assistance-body">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              className="secondary"
              onClick={() => setReload((n) => n + 1)}
            >
              Retry configuration suggestion
            </button>
          </>
        ) : (
          <p role="status">Checking source and suggestion...</p>
        )}
      </div>
    </Modal>
  );
}
function MappingReview({
  data,
  detail,
  job,
  suggestion,
  close,
  saved,
}: Props & { suggestion: ImportMapping }) {
  const [review, setReview] = useState<{
      token: string;
      candidates: ImportCandidate[];
      input: {
        jobId: string;
        sourceRevision: number;
        account: string;
        mapping: ImportMapping;
      };
    } | null>(null),
    [error, setError] = useState(""),
    [reading, setReading] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [dirty, setDirty] = useState(false),
    [page, setPage] = useState(0);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  const action = useWrite(close, saved);
  const invalidate = () => {
    sequence.current++;
    setReview(null);
    setReading(false);
    setConfirmed(false);
    setDirty(true);
    setError("");
    setPage(0);
  };
  const preview = async (account: string, mapping: ImportMapping) => {
    const input = {
      jobId: job.id,
      sourceRevision: detail.source.revision,
      account,
      mapping,
    };
    const seq = ++sequence.current;
    setReading(true);
    setReview(null);
    setConfirmed(false);
    setError("");
    setDirty(true);
    setPage(0);
    try {
      const p = await command<{ token: string; candidates: ImportCandidate[] }>(
        "ai_mapping_preview",
        { workspace: data.workspace, input },
      );
      if (sequence.current === seq) setReview({ ...p, input });
    } catch (e) {
      if (sequence.current === seq) setError(String(e));
    } finally {
      if (sequence.current === seq) setReading(false);
    }
  };
  const requestClose = () => {
    if (
      !dirty ||
      window.confirm(
        "Discard these unsaved column suggestions? The original request stays saved.",
      )
    )
      close();
  };
  return (
    <Modal
      title="Review suggested columns"
      busy={action.busy}
      onClose={requestClose}
    >
      <div className="assistance-body">
        <p>
          Review dates, signs and columns against the source. Posting status, a
          missing year and stable IDs need your own confirmation. Saving columns
          prepares the normal import review and records no money.
        </p>
        {job.proposal?.warnings.map((w, i) => (
          <p key={i} className="import-caution">
            {w}
          </p>
        ))}
        <MappingForm
          detail={detail}
          data={data}
          busy={action.busy}
          dirty={invalidate}
          configure={preview}
          suggestion={suggestion}
          buttonLabel={
            reading ? "Checking columns..." : "Preview suggested columns"
          }
        />
        {(error || action.error) && (
          <p role="alert" className="form-error">
            {error || action.error}
          </p>
        )}
        {review && (
          <>
            <h3>Parsed rows</h3>
            <p>
              {review.candidates.length} rows. Review both purchases and
              payments before confirming a sign convention.
            </p>
            <div className="assistance-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Amount / direction</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {review.candidates
                    .slice(page * 25, (page + 1) * 25)
                    .map((r, i) => (
                      <tr key={i}>
                        <td>{r.date ?? "Unresolved"}</td>
                        <td>{r.description}</td>
                        <td>
                          {r.amountCents === null
                            ? "Unresolved"
                            : money(r.amountCents)}{" "}
                          {r.direction}
                        </td>
                        <td>
                          {r.status} {r.currency}
                          {r.warnings.map((w, n) => (
                            <p key={n}>{w}</p>
                          ))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {review.candidates.length > 25 && (
              <div className="pdf-buttons">
                <button
                  className="secondary"
                  disabled={!page}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Previous parsed rows
                </button>
                <span>
                  Page {page + 1} of {Math.ceil(review.candidates.length / 25)}
                </span>
                <button
                  className="secondary"
                  disabled={(page + 1) * 25 >= review.candidates.length}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Next parsed rows
                </button>
              </div>
            )}
            <label className="import-check">
              <input
                type="checkbox"
                disabled={action.busy}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I checked the account, dates, signs and parsed amounts against the
              source.
            </label>
            <button
              className="primary"
              disabled={action.busy || !confirmed}
              onClick={() =>
                void action.write(
                  "ai_mapping_apply",
                  {
                    workspace: data.workspace,
                    input: {
                      input: review.input,
                      token: review.token,
                      confirmed,
                    },
                  },
                  "Reviewed columns saved. Continue with the normal transaction import review.",
                )
              }
            >
              Apply reviewed columns
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
