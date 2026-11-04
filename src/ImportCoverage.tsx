import { HelpHeading } from "./HelpTip";
import { useState } from "react";
import type {
  CoverageInput,
  ImportDetail,
  DownloadPattern,
} from "./importTypes";

function localTime(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
}

function suggestedRange(
  pattern: DownloadPattern,
  observed: string,
): [string, string] | null {
  if (pattern.kind === "manual" || !observed) return null;
  const parts = observed.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  let end = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])),
    start = new Date(end);
  if (pattern.kind === "trailing_days") {
    if (!pattern.days || pattern.days < 1 || pattern.days > 366) return null;
    start.setUTCDate(end.getUTCDate() - pattern.days + 1);
  } else if (pattern.kind === "month_to_date") start.setUTCDate(1);
  else if (pattern.kind === "previous_month") {
    end.setUTCDate(0);
    start = new Date(end);
    start.setUTCDate(1);
  }
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

export default function ImportCoverage({
  detail,
  busy,
  mappingDirty,
  confirm,
  reconcile,
}: {
  detail: ImportDetail;
  busy: boolean;
  mappingDirty: boolean;
  confirm: (
    input: CoverageInput,
    pattern: DownloadPattern | null,
    processSavedDefaults: boolean,
  ) => Promise<void>;
  reconcile: () => Promise<void>;
}) {
  const c = detail.coverage;
  const preset = detail.downloadProfile;
  const [pattern, setPattern] = useState<DownloadPattern>(
    preset?.pattern ?? { kind: "manual", days: null },
  );
  const [remember, setRemember] = useState(true);
  const [processSavedDefaults, setProcessSavedDefaults] = useState(true);
  const [start, setStart] = useState(c?.startDate ?? "");
  const [end, setEnd] = useState(c?.endDate ?? "");
  const [basis, setBasis] = useState(
    c?.dateBasis ?? preset?.dateBasis ?? "transaction",
  );
  const [kind, setKind] = useState(
    c?.completeness ?? preset?.completeness ?? "partial",
  );
  const [profile, setProfile] = useState(c?.profile ?? preset?.profile ?? "");
  const [observed, setObserved] = useState(c ? localTime(c.observedAt) : "");
  const [checked, setChecked] = useState(false);
  function suggest(nextPattern: DownloadPattern, time: string) {
    const range = suggestedRange(nextPattern, time);
    if (range) {
      setStart(range[0]);
      setEnd(range[1]);
    }
    setChecked(false);
  }
  const locked = !!c && !!detail.undoId;
  const disabled = busy || mappingDirty || detail.source.state === "dismissed";
  const eligible =
    detail.overlap?.items.filter((i) => ["link", "exclude"].includes(i.action))
      .length ?? 0;
  const dates = detail.rows
    .flatMap((r) => (r.candidate.date ? [r.candidate.date] : []))
    .sort();
  const newest = dates.at(-1);
  return (
    <section
      className="import-coverage"
      aria-label="Import coverage and identity"
    >
      <HelpHeading topic="importCoverage">
        <h3>Coverage &amp; completeness</h3>
      </HelpHeading>
      <div className="coverage-facts">
        <div>
          <small>Imported</small>
          <strong>
            {new Date(
              /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
                detail.source.createdAt,
              )
                ? detail.source.createdAt.replace(" ", "T") + "Z"
                : detail.source.createdAt,
            ).toLocaleString()}
          </strong>
        </div>
        <div>
          <small>Newest spending date in file</small>
          <strong>{newest ?? "No dated activity"}</strong>
        </div>
        <div>
          <small>Confirmed download range</small>
          <strong>
            {c ? `${c.startDate} to ${c.endDate}` : "Not confirmed"}
          </strong>
        </div>
      </div>
      {c && (
        <p className="form-intro">
          {c.completeness === "complete"
            ? c.accepted
              ? "Complete coverage accepted for overlap comparisons."
              : "Complete range declared; unresolved or unreliable rows still prevent accepted coverage."
            : `${c.completeness === "partial" ? "Partial" : "Incremental"} coverage; occurrence counts will not be used to match this source.`}{" "}
          {c.profile} · {c.dateBasis} dates · Observed{" "}
          {new Date(c.observedAt).toLocaleString()}
        </p>
      )}
      {!c && (
        <p className="form-intro">
          Row dates do not prove the download range. Confirm the actual export
          filters to compare overlapping downloads. Screenshots remain partial
          evidence.
        </p>
      )}
      {mappingDirty && (
        <p className="import-caution">
          Apply your column mapping changes before confirming coverage or
          reconciling rows.
        </p>
      )}
      <details className="mapping">
        <summary>
          Download range & completeness
          {locked ? " · retained with processed decisions" : ""}
        </summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (disabled || locked || !checked || !observed) return;
            void confirm(
              {
                startDate: start,
                endDate: end,
                dateBasis: basis,
                completeness: kind,
                profile: profile.trim(),
                observedAt: new Date(observed).toISOString(),
                inclusive: true,
              },
              remember ? pattern : null,
              processSavedDefaults,
            );
          }}
        >
          <fieldset disabled={disabled || locked}>
            {preset && !c && (
              <p className="form-intro">
                Saved profile suggestions are shown below. Enter the actual
                observation time and confirm the download filters; nothing is
                confirmed automatically.
              </p>
            )}
            <div className="mapping-grid">
              <label>
                Download pattern
                <select
                  value={pattern.kind}
                  onChange={(e) => {
                    const next = {
                      kind: e.target.value,
                      days: e.target.value === "trailing_days" ? 90 : null,
                    };
                    setPattern(next);
                    suggest(next, observed);
                  }}
                >
                  <option value="manual">Manual dates</option>
                  <option value="trailing_days">
                    Trailing days, including observation day
                  </option>
                  <option value="month_to_date">
                    Month to observation date
                  </option>
                  <option value="previous_month">
                    Previous calendar month
                  </option>
                </select>
              </label>
              {pattern.kind === "trailing_days" && (
                <label>
                  Inclusive days
                  <input
                    type="number"
                    min={1}
                    max={366}
                    required
                    value={pattern.days ?? ""}
                    onChange={(e) => {
                      const next = {
                        ...pattern,
                        days: e.target.value ? Number(e.target.value) : null,
                      };
                      setPattern(next);
                      suggest(next, observed);
                    }}
                  />
                </label>
              )}
              <label>
                Download start (inclusive)
                <input
                  type="date"
                  required
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setPattern({ kind: "manual", days: null });
                    setChecked(false);
                  }}
                />
              </label>
              <label>
                Download end (inclusive)
                <input
                  type="date"
                  required
                  value={end}
                  min={start || undefined}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    setPattern({ kind: "manual", days: null });
                    setChecked(false);
                  }}
                />
              </label>
              <label>
                Export date basis
                <select
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                >
                  <option value="transaction">
                    Transaction / spending date
                  </option>
                  <option
                    value="posted"
                    disabled={detail.mapping.postedDateColumn == null}
                  >
                    Posted date
                  </option>
                </select>
              </label>
              <label>
                Coverage type
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="partial">Partial / filtered activity</option>
                  <option
                    value="complete"
                    disabled={
                      detail.dataset.image ||
                      (detail.source.format === "pdf" &&
                        detail.dataset.headers.length === 0)
                    }
                  >
                    Complete posted activity in range
                  </option>
                  <option value="incremental">
                    Incremental / changes only
                  </option>
                </select>
              </label>
              <label>
                Export profile name
                <input
                  required
                  maxLength={100}
                  placeholder="e.g. Amex activity CSV"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                />
              </label>
              <label>
                Downloaded / observed at
                <input
                  type="datetime-local"
                  required
                  value={observed}
                  onChange={(e) => {
                    setObserved(e.target.value);
                    suggest(pattern, e.target.value);
                  }}
                />
              </label>
            </div>
            <p className="form-intro">
              Use the same profile name for exports with the same filters and
              format. Complete means every posted transaction in the inclusive
              range. Downloads with fewer rows never delete existing records.
            </p>
            <label className="import-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />{" "}
              Remember this profile and download pattern for this account and
              layout.
            </label>
            <label className="import-check">
              <input
                type="checkbox"
                checked={processSavedDefaults}
                onChange={(e) => setProcessSavedDefaults(e.target.checked)}
              />
              Use saved automatic processing defaults for this import
            </label>
            <p className="form-intro">
              Only a matching account, format and profile with automation
              enabled can process rows here. Clear this option to review or
              change the defaults first.
            </p>
            <label className="import-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />{" "}
              I checked the actual download range, date basis, completeness, and
              observation time.
            </label>
            <button
              className="secondary"
              type="submit"
              disabled={
                !checked || !start || !end || !profile.trim() || !observed
              }
            >
              Confirm download coverage
            </button>
          </fieldset>
        </form>
      </details>
      {detail.overlap?.notices.map((n, i) => (
        <p key={i} className="import-caution">
          {n}
        </p>
      ))}
      {eligible > 0 && (
        <div className="coverage-reconcile">
          <div>
            <strong>
              {eligible} unchanged occurrence{eligible === 1 ? "" : "s"}{" "}
              identified
            </strong>
            <p>
              Link existing records and preserve prior exclusions. Recorded
              amounts, categories, and sharing stay as you edited them.
            </p>
          </div>
          <button
            className="primary"
            disabled={disabled}
            onClick={() => void reconcile()}
          >
            Reconcile {eligible} unchanged rows
          </button>
        </div>
      )}
    </section>
  );
}
