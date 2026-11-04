import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { command, money, today } from "./api";
import { Modal } from "./EntryDialog";
import { HelpHeading } from "./HelpTip";
import PayTaxComparison from "./PayTaxComparison";
import type { PayView } from "./PayHours";
import type {
  PayObservation,
  PayObservationInput,
  PaySource,
  PaySourceDetail,
  Empirical,
} from "./payTypes";
const Pdf = lazy(() => import("./PdfRenderer"));
export const payAmount = (n: number | null | undefined) =>
  n == null ? "—" : money(n);
const dollars = (c: number) => (c / 100).toFixed(2);
export function PayFrequency({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label>
      Withholding frequency
      <select required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose frequency</option>
        {["weekly", "biweekly", "semimonthly", "monthly"].map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
}
export function ModelSupport({ model }: { model: Empirical }) {
  return (
    <details className="pay-support">
      <summary>
        {model.observations.length} supporting paychecks ·{" "}
        {model.distinctGrossPoints} distinct gross amounts
        {model.extrapolated ? " · extrapolated" : ""}
      </summary>
      <p>
        Known gross range: {payAmount(model.minGrossCents)} –{" "}
        {payAmount(model.maxGrossCents)}. Largest observed net spread at the
        same gross: {payAmount(model.withinPointSpreadCents)}.
      </p>
      <ul>
        {model.warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
      <p>
        Interior-point fit error: {payAmount(model.fitMaeCents)} across{" "}
        {model.fitObservationCount ?? 0} observations. Each interior gross point
        is predicted from its neighbors with that point omitted. This is a fit
        check, not a future accuracy guarantee; at least three distinct gross
        points are needed.
      </p>
      <ul>
        {model.observations.map((o) => (
          <li key={o.id}>
            {o.payDate} · gross {money(o.grossCents)} · net{" "}
            {payAmount(o.netCents)} · {o.regime}
          </li>
        ))}
      </ul>
    </details>
  );
}
export default function PayVariations({
  workspace,
  view,
  year,
  importEpoch,
  changed,
}: {
  workspace: string;
  view: PayView;
  year: number;
  importEpoch: number;
  changed: () => void;
}) {
  const [edit, setEdit] = useState<PayObservation | "new" | null>(null);
  const [mode, setMode] = useState("known");
  const [comparison, setComparison] = useState<PayObservation | null>(null);
  const observations = Object.values(view.state.observations ?? {})
    .filter((o) => o.payDate.startsWith(`${year}-`))
    .sort((a, b) => b.payDate.localeCompare(a.payDate));
  return (
    <>
      <div className="pay-actions">
        <button
          className={mode === "known" ? "primary" : "secondary"}
          onClick={() => setMode("known")}
        >
          Known paychecks
        </button>
        <button
          className={mode === "scenario" ? "primary" : "secondary"}
          onClick={() => setMode("scenario")}
        >
          Compare hours
        </button>
      </div>
      {mode === "known" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <HelpHeading topic="payKnown">
                <h2>Known hourly variations · {year}</h2>
              </HelpHeading>
              <p>
                Reviewed paycheck facts. These records explain take-home pay
                without adding bank income.
              </p>
            </div>
            <button className="primary" onClick={() => setEdit("new")}>
              Add known paycheck
            </button>
          </div>
          <div className="pay-table-scroll">
            <table className="pay-table">
              <thead>
                <tr>
                  <th>Paid / rate</th>
                  <th>Paid hours</th>
                  <th>Gross</th>
                  <th>Take-home</th>
                  <th>Net / gross</th>
                  <th>Net / paid hour</th>
                  <th>Review</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {observations.map((o) => {
                  const hours = o.worked / 10000 + o.sick;
                  const issues = view.observationIssues?.[o.id] ?? [];
                  return (
                    <tr key={o.id}>
                      <th>
                        {o.payDate}
                        <small>
                          ${o.rate / 10000}/h · {o.regime}
                        </small>
                      </th>
                      <td>
                        {hours}
                        <small>{o.sick} sick</small>
                      </td>
                      <td>{money(o.grossCents)}</td>
                      <td>{payAmount(o.netCents)}</td>
                      <td>
                        {o.netCents !== null && o.grossCents > 0
                          ? `${((100 * o.netCents) / o.grossCents).toFixed(2)}%`
                          : "—"}
                      </td>
                      <td>
                        {o.netCents !== null && hours > 0
                          ? money(o.netCents / hours)
                          : "—"}
                      </td>
                      <td>
                        {issues.length ? (
                          <details>
                            <summary>Needs review</summary>
                            <ul>
                              {issues.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </details>
                        ) : (
                          "Reviewed"
                        )}
                        <small>
                          {o.evidence.length
                            ? "Source attached"
                            : "Manual fact"}
                        </small>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setEdit(o)}
                        >
                          Edit
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setComparison(o)}
                        >
                          Compare withholding
                        </button>
                        {view.state.calibrations?.[o.id] && (
                          <small>
                            {view.calibrationCurrent?.[o.id]
                              ? "Comparison saved"
                              : "Comparison inputs changed"}
                          </small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!observations.length && (
            <p className="pay-footnote">
              Add paychecks manually, or attach a payroll source and use its
              structured pay row. Missing take-home values stay blank. Add
              documents under Paychecks.
            </p>
          )}
        </section>
      ) : (
        <Scenarios workspace={workspace} year={year} />
      )}
      {edit && (
        <KnownEditor
          key={typeof edit === "string" ? "new" : edit.id}
          workspace={workspace}
          view={view}
          original={edit === "new" ? null : edit}
          importEpoch={importEpoch}
          close={() => setEdit(null)}
          saved={() => {
            setEdit(null);
            changed();
          }}
        />
      )}
      {comparison && (
        <PayTaxComparison
          key={comparison.id}
          workspace={workspace}
          view={view}
          observation={comparison}
          close={() => setComparison(null)}
          saved={() => {
            setComparison(null);
            changed();
          }}
        />
      )}
    </>
  );
}
function draft(o: PayObservation | null): PayObservationInput {
  return o
    ? {
        id: o.id,
        periodId: o.periodId,
        payDate: o.payDate,
        sick: o.sick,
        detailComplete: o.detailComplete,
        frequency: o.frequency,
        benefits: o.benefits,
        regime: o.regime,
        reviewed: o.reviewed,
        evidence: o.evidence,
        note: o.note,
        worked: String(o.worked / 10000),
        rate: String(o.rate / 10000),
        gross: dollars(o.grossCents),
        net: o.netCents === null ? null : dollars(o.netCents),
        otherGross: dollars(o.otherGrossCents),
        reimbursement: dollars(o.reimbursementCents),
        deductions: o.deductions.map((d) => ({
          name: d.name,
          amount: dollars(d.cents),
        })),
      }
    : {
        id: crypto.randomUUID(),
        periodId: null,
        payDate: today(),
        worked: "",
        sick: 0,
        rate: "93",
        gross: "",
        net: null,
        otherGross: "0",
        reimbursement: "0",
        deductions: [],
        detailComplete: false,
        frequency: "",
        benefits: true,
        regime: "Standard",
        reviewed: false,
        evidence: [],
        note: "",
      };
}
function KnownEditor({
  workspace,
  view,
  original,
  importEpoch,
  close,
  saved,
}: {
  workspace: string;
  view: PayView;
  original: PayObservation | null;
  importEpoch: number;
  close: () => void;
  saved: () => void;
}) {
  const [input, setInput] = useState(() => draft(original));
  const [details, setDetails] = useState(
    () =>
      original?.deductions
        .map((d) => `${d.name}\t${dollars(d.cents)}`)
        .join("\n") ?? "",
  );
  const [sources, setSources] = useState<PaySource[]>([]);
  const [sourceId, setSourceId] = useState(
    original?.evidence[0]?.sourceId ?? "",
  );
  const [source, setSource] = useState<PaySourceDetail | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const update = (v: Partial<PayObservationInput>) => {
    setInput((p) => ({ ...p, ...v }));
    setDirty(true);
  };
  useEffect(() => {
    let active = true;
    command<PaySource[]>("pay_sources", { workspace })
      .then((v) => {
        if (active) setSources(v);
      })
      .catch((e) => {
        if (active) setSourceError(String(e));
      });
    return () => {
      active = false;
    };
  }, [workspace, importEpoch, reload]);
  useEffect(() => {
    let active = true;
    setSource(null);
    setSourceError("");
    if (sourceId)
      command<PaySourceDetail>("pay_source", { workspace, id: sourceId })
        .then((s) => {
          if (active) setSource(s);
        })
        .catch((e) => {
          if (active) setSourceError(String(e));
        });
    return () => {
      active = false;
    };
  }, [workspace, sourceId, reload]);
  const leave = () => {
    if (!busy && (!dirty || window.confirm("Discard unsaved known-pay edits?")))
      close();
  };
  async function save(remove = false) {
    setError("");
    try {
      const deductions = details.trim()
        ? details
            .trim()
            .split(/\r?\n/)
            .map((row) => {
              const parts = row.split("\t");
              if (parts.length !== 2)
                throw Error(
                  "Use a deduction name, a tab, then its dollar amount on each row.",
                );
              return { name: parts[0], amount: parts[1] };
            })
        : [];
      if (sourceId && !input.evidence.length && !remove)
        throw Error("Choose supporting evidence for this known paycheck.");
      const change = remove
        ? { kind: "removeObservation", id: input.id }
        : { kind: "observation", input: { ...input, deductions } };
      const signature = JSON.stringify(change);
      if (operation.current?.signature !== signature)
        operation.current = { signature, id: crypto.randomUUID() };
      setBusy(true);
      await command("save_payroll", {
        workspace,
        revision: view.revision,
        operation: operation.current.id,
        change,
      });
      saved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={original ? "Edit known paycheck" : "Add known paycheck"}
      onClose={leave}
      busy={busy}
    >
      <form
        className="pay-form"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && (
          <p role="alert" className="form-error">
            {error} Your draft is retained.
          </p>
        )}
        <fieldset disabled={busy}>
          <HelpHeading topic="payKnown">
            <h3>Paycheck facts</h3>
          </HelpHeading>
          <p>
            Enter facts from a paystub or your known-pay table. Aggregate hours
            do not verify daily sick-time eligibility.
          </p>
          <div className="pay-form-grid">
            <label>
              Paid date
              <input
                type="date"
                min="1900-01-01"
                max="2100-12-31"
                required
                value={input.payDate}
                onChange={(e) => update({ payDate: e.target.value })}
              />
            </label>
            <label>
              Linked period
              <select
                value={input.periodId ?? ""}
                onChange={(e) => update({ periodId: e.target.value || null })}
              >
                <option value="">Historical / unlinked</option>
                {Object.values(view.state.periods ?? {})
                  .sort((a, b) => a.payDate.localeCompare(b.payDate))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.payDate} · {p.name}
                    </option>
                  ))}
              </select>
            </label>
            {(
              [
                ["worked", "Worked hours", "0", "1344", "0.0001"],
                ["sick", "Paid sick hours", "0", "80", "1"],
                [
                  "rate",
                  "Contractual hourly rate ($)",
                  "0.0001",
                  "10000",
                  "0.0001",
                ],
                ["gross", "Reported gross ($)", "0", "100000000", "0.01"],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <label key={key}>
                {label}
                <input
                  required
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={input[key]}
                  onChange={(e) =>
                    update({
                      [key]:
                        key === "sick"
                          ? Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              </label>
            ))}
            <label>
              Take-home pay ($), blank if unknown
              <input
                type="number"
                min="0"
                max="100000000"
                step="0.01"
                value={input.net ?? ""}
                onChange={(e) =>
                  update({ net: e.target.value === "" ? null : e.target.value })
                }
              />
            </label>
            <PayFrequency
              value={input.frequency}
              onChange={(frequency) => update({ frequency })}
            />
            <label>
              Payroll regime
              <input
                required
                maxLength={120}
                value={input.regime}
                onChange={(e) => update({ regime: e.target.value })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={input.benefits}
                onChange={(e) => update({ benefits: e.target.checked })}
              />
              Normal benefits deductions apply
            </label>
          </div>
          <p className="pay-footnote">
            Give materially different tax elections or benefit patterns
            different regime names. A new year or rate is automatically kept
            separate in estimates.
          </p>
          <details>
            <summary>Adjustments and deduction detail</summary>
            <div className="pay-form-grid">
              <label>
                Other gross adjustment ($)
                <input
                  type="number"
                  min="-100000000"
                  max="100000000"
                  step="0.01"
                  value={input.otherGross}
                  onChange={(e) => update({ otherGross: e.target.value })}
                />
              </label>
              <label>
                Reimbursements ($)
                <input
                  type="number"
                  min="0"
                  max="100000000"
                  step="0.01"
                  value={input.reimbursement}
                  onChange={(e) => update({ reimbursement: e.target.value })}
                />
              </label>
            </div>
            <label>
              Deduction rows: name, tab, dollar amount
              <textarea
                rows={4}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={input.detailComplete}
                onChange={(e) => update({ detailComplete: e.target.checked })}
              />
              All withholding and deduction detail is included
            </label>
            <p>
              Include federal, state, local, FICA and benefits when marking
              detail complete. Negative amounts describe reversals. Bonuses and
              reimbursements remain facts but are excluded from the ordinary
              hourly model.
            </p>
          </details>
          <details open={!!sourceId}>
            <summary>Attach or import from payroll evidence</summary>
            <label htmlFor="known-pay-source">Payroll source</label>
            <select
              id="known-pay-source"
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                update({ evidence: [] });
              }}
            >
              <option value="">Manual entry without attachment</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {sourceError && (
              <p role="alert">
                {sourceError}
                <button type="button" onClick={() => setReload((n) => n + 1)}>
                  Retry source
                </button>
              </p>
            )}
            {sourceId && !source && !sourceError && <p>Loading source…</p>}
            {source && (
              <>
                <PayEvidenceViewer workspace={workspace} source={source} />
                {!!source.document.payObservations?.length && (
                  <div>
                    <label htmlFor="known-pay-proposal">
                      Use structured pay row
                    </label>
                    <select
                      id="known-pay-proposal"
                      defaultValue=""
                      onChange={(e) => {
                        const p =
                          source.document.payObservations?.[
                            Number(e.target.value)
                          ];
                        if (p) {
                          setInput({
                            ...p.input,
                            id: input.id,
                            periodId: input.periodId,
                            evidence: [
                              {
                                sourceId,
                                location: p.location,
                                quote: p.quote,
                              },
                            ],
                          });
                          setDetails("");
                          setDirty(true);
                        }
                      }}
                    >
                      <option value="" disabled>
                        Choose a proposed row
                      </option>
                      {source.document.payObservations?.map((p, i) => (
                        <option key={i} value={i}>
                          {p.input.payDate} · {p.input.worked} worked hours ·{" "}
                          {p.location}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <label htmlFor="known-pay-location">Supporting location</label>
                <select
                  id="known-pay-location"
                  value={input.evidence[0]?.location ?? ""}
                  onChange={(e) => {
                    const c = source.document.chunks.find(
                      (c) => c.location === e.target.value,
                    );
                    update({
                      evidence: c
                        ? [{ sourceId, location: c.location, quote: c.text }]
                        : [],
                    });
                  }}
                >
                  <option value="">Choose evidence</option>
                  {source.document.chunks
                    .filter((c) => c.text.trim())
                    .map((c) => (
                      <option key={c.location}>{c.location}</option>
                    ))}
                </select>
              </>
            )}
            <p>
              Structured CSV/Excel/DOCX rows use kind=pay, pay_date,
              hours_worked, sick_hours, hourly_rate, gross_pay, net_pay,
              frequency, benefits (yes/no), regime. Use ISO dates and plain
              decimal amounts. Other layouts remain evidence for manual review.
            </p>
          </details>
          <label>
            Notes
            <textarea
              maxLength={2000}
              value={input.note}
              onChange={(e) => update({ note: e.target.value })}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={input.reviewed}
              onChange={(e) => update({ reviewed: e.target.checked })}
            />
            I reviewed these paycheck facts against my records
          </label>
          <p>
            Unreviewed or inconsistent facts can be saved for later review. They
            will not train the known-pay model.
          </p>
        </fieldset>
        <div className="pay-actions">
          {original && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Remove this known-pay record? Earlier revisions and saved forecasts are retained.",
                  )
                )
                  void save(true);
              }}
            >
              Remove known paycheck
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={leave}
          >
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || (!!sourceId && (!source || !!sourceError))}
          >
            {busy ? "Saving…" : "Save known paycheck"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function PayEvidenceViewer({
  workspace,
  source,
}: {
  workspace: string;
  source: PaySourceDetail;
}) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [path, setPath] = useState("");
  useEffect(() => {
    let live = true;
    setImage("");
    setError("");
    if (open && source.source.mime.startsWith("image/"))
      command<string>("pay_source_original", {
        workspace,
        id: source.source.id,
      })
        .then((v) => {
          if (live) setImage(v);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    return () => {
      live = false;
    };
  }, [workspace, source.source.id, source.source.mime, open]);
  return (
    <div className="pay-evidence">
      {source.document.warnings.map((w, i) => (
        <p key={i} className="import-caution">
          {w}
        </p>
      ))}
      <details>
        <summary>Extracted payroll text</summary>
        <div className="pay-source-text">
          {source.document.chunks.map((c) => (
            <section key={c.location}>
              <strong>{c.location}</strong>
              <pre>{c.text}</pre>
            </section>
          ))}
        </div>
      </details>
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Original payroll document</summary>
        {open && source.source.format === "pdf" && (
          <Suspense fallback={<p>Loading viewer…</p>}>
            <Pdf
              workspace={workspace}
              sourceId={source.source.id}
              sourceCommand="pay_source_original"
            />
          </Suspense>
        )}
        {open && image && (
          <img
            className="pay-source-image"
            src={`data:${source.source.mime};base64,${image}`}
            alt="Original paycheck evidence"
          />
        )}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            command<string>("export_pay_source", {
              workspace,
              id: source.source.id,
            })
              .then(setPath)
              .catch((e) => setError(String(e)))
          }
        >
          Export original
        </button>
        {path && (
          <p role="status">
            Saved original: {path}{" "}
            <button
              type="button"
              onClick={() =>
                command("open_pay_source_folder").catch((e) =>
                  setError(String(e)),
                )
              }
            >
              Open folder
            </button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </details>
    </div>
  );
}
type Scenario = {
  hours: number;
  grossCents: number;
  estimate: Empirical;
  extraHourNetCents: number | null;
};
function Scenarios({ workspace, year }: { workspace: string; year: number }) {
  const [frequency, setFrequency] = useState("");
  const [rows, setRows] = useState<Scenario[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const seq = ++sequence.current;
    setBusy(true);
    setError("");
    setRows(null);
    try {
      const v = await command<Scenario[]>("pay_scenarios", {
        workspace,
        input: {
          payDate: f.get("date"),
          rate: f.get("rate"),
          hours: String(f.get("hours"))
            .split(/[\s,]+/)
            .filter(Boolean),
          frequency,
          benefits: f.has("benefits"),
          regime: f.get("regime"),
          extrapolate: f.has("extrapolate"),
        },
      });
      if (seq === sequence.current) setRows(v);
    } catch (e) {
      if (seq === sequence.current) setError(String(e));
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <HelpHeading topic="payPredictions">
            <h2>Compare paid hours</h2>
          </HelpHeading>
          <p>
            Explore hypothetical totals using compatible earlier paychecks.
            Scenarios do not change weekly hours or save a forecast.
          </p>
        </div>
      </div>
      <form
        className="pay-form pay-scenario"
        onSubmit={submit}
        onChange={() => {
          sequence.current++;
          setBusy(false);
          setRows(null);
        }}
      >
        <fieldset disabled={busy}>
          <div className="pay-form-grid">
            <label>
              Prediction pay date
              <input
                name="date"
                type="date"
                required
                defaultValue={`${year}-12-31`}
                min="1900-01-01"
                max="2100-12-31"
              />
            </label>
            <label>
              Hourly rate ($)
              <input
                name="rate"
                type="number"
                min="0.0001"
                max="10000"
                step="0.0001"
                required
                defaultValue="93"
              />
            </label>
            <PayFrequency value={frequency} onChange={setFrequency} />
            <label>
              Payroll regime
              <input
                name="regime"
                required
                maxLength={120}
                defaultValue="Standard"
              />
            </label>
          </div>
          <label>
            Total paid hours, separated by commas
            <input
              name="hours"
              required
              defaultValue="56, 72, 75, 80, 85, 88, 90, 100, 120"
            />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="benefits" defaultChecked />
            Normal benefits deductions apply
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="extrapolate" />
            Allow estimates outside the known range
          </label>
        </fieldset>
        <button className="primary" disabled={busy}>
          {busy ? "Calculating…" : "Compare scenarios"}
        </button>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {rows && (
        <div className="pay-table-scroll">
          <table className="pay-table">
            <thead>
              <tr>
                <th>Paid hours</th>
                <th>Gross</th>
                <th>Predicted net</th>
                <th>Net / paid hour</th>
                <th>Net for +1 hour</th>
                <th>Support</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th>{r.hours / 10000}</th>
                  <td>{money(r.grossCents)}</td>
                  <td>{payAmount(r.estimate.netCents)}</td>
                  <td>
                    {r.estimate.netCents !== null && r.hours > 0
                      ? money(r.estimate.netCents / (r.hours / 10000))
                      : "—"}
                  </td>
                  <td>{payAmount(r.extraHourNetCents)}</td>
                  <td>
                    <ModelSupport model={r.estimate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
