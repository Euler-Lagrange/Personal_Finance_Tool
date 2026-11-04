import { useEffect, useState } from "react";
import { command } from "./api";
import { useWrite } from "./PdfDocuments";
type Anchor = { page: number; text: string };
type View = {
  targetName: string;
  templateVersion: number;
  route: {
    revision: number;
    enabled: boolean;
    marker: Anchor;
    templateVersion: number;
  } | null;
  suggestedMarker: Anchor | null;
  issue: string | null;
};
export default function PdfReuse({
  workspace,
  application,
  pages,
  saved,
}: {
  workspace: string;
  application: string;
  pages: { number: number; lines: string[] }[];
  saved: (message: string) => Promise<void>;
}) {
  const [view, setView] = useState<View | null>(null),
    [reload, setReload] = useState(0),
    [error, setError] = useState(""),
    [enabled, setEnabled] = useState(false),
    [marker, setMarker] = useState<Anchor>({ page: 1, text: "" }),
    [confirmed, setConfirmed] = useState(false);
  const refresh = async (message: string) => {
    setConfirmed(false);
    setReload((n) => n + 1);
    await saved(message);
  };
  const write = useWrite(() => {}, refresh);
  useEffect(() => {
    let live = true;
    setView(null);
    setError("");
    setConfirmed(false);
    command<View>("pdf_route_view", { workspace, application })
      .then((v) => {
        if (live && v) {
          setView(v);
          setEnabled(v.route?.enabled ?? false);
          setMarker(
            v.route?.marker ?? v.suggestedMarker ?? { page: 1, text: "" },
          );
        }
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [workspace, application, reload]);
  return (
    <details>
      <summary>Reuse this bill or statement destination</summary>
      <p>
        Future matching PDFs can update this destination after local checks. No
        payment or spending is recorded. Changed layouts, conflicting confirmed
        values and incomplete statement calculations stay in review.
      </p>
      {(error || write.error) && (
        <p role="alert" className="form-error">
          {error || write.error}{" "}
          <button className="secondary" onClick={() => setReload((n) => n + 1)}>
            Reload destination reuse
          </button>
        </p>
      )}
      {!view && !error && <p role="status">Loading destination settings...</p>}
      {view && (
        <fieldset className="pdf-form" disabled={write.busy}>
          <p>
            Destination: {view.targetName}. Approved template version{" "}
            {view.templateVersion}.
          </p>
          {view.issue && <p>{view.issue}</p>}
          {view.route &&
            view.route.templateVersion !== view.templateVersion && (
              <p>
                The saved route uses another template version. Review this
                destination again.
              </p>
            )}
          <label className="pdf-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setConfirmed(false);
              }}
            />
            Automatically update this destination for matching documents
          </label>
          <div className="pdf-form-grid">
            <label>
              Account marker page
              <select
                value={marker.page}
                onChange={(e) => {
                  setMarker({ ...marker, page: Number(e.target.value) });
                  setConfirmed(false);
                }}
              >
                {pages.map((p) => (
                  <option key={p.number} value={p.number}>
                    Page {p.number}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Exact account-specific line
              <input
                maxLength={200}
                value={marker.text}
                onChange={(e) => {
                  setMarker({ ...marker, text: e.target.value });
                  setConfirmed(false);
                }}
              />
            </label>
          </div>
          <p>
            Use a unique account or service identifier containing a digit, as
            printed in this PDF. This prevents another account's document from
            using the same destination.
          </p>
          <label className="pdf-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirmed this destination and account-specific marker for future
            documents.
          </label>
          <button
            className="secondary"
            disabled={
              !confirmed ||
              (!enabled && !view.route) ||
              (enabled && !!view.issue)
            }
            onClick={() =>
              void write.write(
                "configure_pdf_route",
                {
                  workspace,
                  input: {
                    applicationId: application,
                    revision: view.route?.revision ?? 0,
                    marker,
                    enabled,
                    confirmed,
                  },
                },
                enabled
                  ? "PDF destination reuse enabled."
                  : "PDF destination reuse paused.",
              )
            }
          >
            Save destination reuse
          </button>
        </fieldset>
      )}
    </details>
  );
}
