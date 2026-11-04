import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CalendarDays, FileUp, Plus } from "lucide-react";
import { command } from "./api";
import { Modal } from "./EntryDialog";
import { IntakeProgress, type Intake } from "./ImportIntake";
import { HelpHeading } from "./HelpTip";
import PayPrediction from "./PayPrediction";
import { payAmount } from "./PayVariations";
import type { PayView } from "./PayHours";
import type {
  PayEvidence,
  PayHolidayChange,
  PayPeriod,
  PaySource,
  PaySourceDetail,
} from "./payTypes";
const Pdf = lazy(() => import("./PdfRenderer"));
const frequencies = ["weekly", "biweekly", "semimonthly", "monthly"];
const newPeriod = (year: number): PayPeriod => ({
  id: crypto.randomUUID(),
  name: "Paycheck",
  payDate: `${year}-01-01`,
  weeks: [],
  frequency: "",
  benefits: true,
  note: "",
  evidence: [],
});
type Draft = {
  periods: PayPeriod[];
  holidays: PayHolidayChange[];
  removePeriods: string[];
};
type Edit = { draft: Draft; sourceId?: string };

export default function PayCalendar({
  workspace,
  view,
  year,
  intake,
  importEpoch,
  mode,
  changed,
}: {
  workspace: string;
  view: PayView;
  year: number;
  intake: Intake;
  importEpoch: number;
  mode: "calendar" | "paychecks";
  changed: () => void;
}) {
  const [sources, setSources] = useState<PaySource[]>([]);
  const [sourceError, setSourceError] = useState("");
  const [reload, setReload] = useState(0);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [prediction, setPrediction] = useState<PayPeriod | null>(null);
  useEffect(() => {
    let live = true;
    setSourceError("");
    command<PaySource[]>("pay_sources", { workspace })
      .then((v) => {
        if (!Array.isArray(v))
          throw Error("Payroll sources could not be loaded.");
        if (live) setSources(v);
      })
      .catch((e) => {
        if (live) setSourceError(String(e));
      });
    return () => {
      live = false;
    };
  }, [workspace, importEpoch, reload]);
  const periods = Object.values(view.state.periods ?? {}).sort((a, b) =>
    a.payDate.localeCompare(b.payDate),
  );
  const empty = (): Draft => ({ periods: [], holidays: [], removePeriods: [] });
  const add = () =>
    setEdit({ draft: { ...empty(), periods: [newPeriod(year)] } });
  return (
    <>
      {mode === "calendar" && (
        <CalendarGrid view={view} year={year} periods={periods} />
      )}
      {mode === "paychecks" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <HelpHeading topic="payCalendar">
                <h2>Pay periods · {year}</h2>
              </HelpHeading>
              <p>
                Explicit workweek assignments and paydays. Withholding frequency
                is separate from the number of weeks paid.
              </p>
            </div>
            <button className="primary" onClick={add}>
              <Plus size={16} /> Add period
            </button>
          </div>
          <div className="pay-table-scroll">
            <table className="pay-table">
              <thead>
                <tr>
                  <th>Payday / period</th>
                  <th>Included weeks</th>
                  <th>Withholding</th>
                  <th>Benefits</th>
                  <th>Selected take-home</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {periods
                  .filter((p) => p.payDate.startsWith(`${year}-`))
                  .map((p) => (
                    <tr key={p.id}>
                      <th>
                        {p.payDate}
                        <small>{p.name}</small>
                        <small>
                          {p.evidence.length
                            ? "Source reviewed"
                            : "Manual calendar"}
                        </small>
                      </th>
                      <td>
                        {p.weeks.map((w) => (
                          <small key={w}>{w}</small>
                        ))}
                        {p.weeks.length === 3 && (
                          <small>Three-week period</small>
                        )}
                      </td>
                      <td>{p.frequency}</td>
                      <td>
                        {p.benefits ? "Normally apply" : "Deduction holiday"}
                      </td>
                      <td>
                        {payAmount(
                          view.state.forecasts?.[
                            view.state.selectedForecasts?.[p.id] ?? ""
                          ]?.netCents,
                        )}
                        <small>
                          {view.forecastStatus?.find(
                            (s) =>
                              s.id === view.state.selectedForecasts?.[p.id],
                          )?.stale
                            ? "Inputs changed"
                            : ""}
                        </small>
                        <button
                          className="text-button"
                          onClick={() => setPrediction(p)}
                        >
                          Predict pay
                        </button>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            setEdit({
                              draft: {
                                ...empty(),
                                periods: [{ ...p, evidence: [] }],
                              },
                            })
                          }
                        >
                          Edit
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            setEdit({
                              draft: { ...empty(), removePeriods: [p.id] },
                            })
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!periods.some((p) => p.payDate.startsWith(`${year}-`)) && (
            <p className="pay-footnote">
              Add a period or review a calendar source below. Each workweek can
              belong to only one paycheck.
            </p>
          )}
        </section>
      )}
      <section className="panel pay-source-panel">
        <div className="panel-heading">
          <div>
            <h2>Payroll calendar sources</h2>
            <p>
              Browse, drop or paste while on Pay & hours. Original documents
              stay separate from transaction imports. Paystub facts can be
              reviewed under Pay variations.
            </p>
          </div>
          <label className="secondary pay-file-button">
            <FileUp size={16} /> Browse documents
            <input
              type="file"
              multiple
              accept=".docx,.pdf,.csv,.tsv,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.bmp"
              onChange={(e) => {
                intake.addFiles(Array.from(e.target.files ?? []));
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        <div className="pay-source-body">
          <button className="secondary" onClick={intake.paste}>
            Paste calendar screenshot
          </button>
          <IntakeProgress intake={intake} />
          {sourceError && (
            <p role="alert" className="form-error">
              {sourceError}{" "}
              <button type="button" onClick={() => setReload((n) => n + 1)}>
                Reload sources
              </button>
            </p>
          )}
          <details>
            <summary>
              {sources.length} saved source{sources.length === 1 ? "" : "s"} ·
              open for review
            </summary>
            {sources.map((s) => (
              <div className="pay-source-row" key={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <small>
                    {s.format.toUpperCase()} ·{" "}
                    {s.applications
                      ? `${s.applications} prior review(s); history retained`
                      : "Not applied"}
                  </small>
                </div>
                <button
                  className="secondary"
                  onClick={() => setEdit({ draft: empty(), sourceId: s.id })}
                >
                  Review source
                </button>
              </div>
            ))}
            {!sources.length && (
              <p>
                No payroll documents yet. Imports do not approve holidays or
                create income.
              </p>
            )}
          </details>
          <details>
            <summary>Structured calendar columns</summary>
            <p>
              For CSV/Excel/DOCX tables, use kind, week_start, date, pay_date,
              name, frequency, benefits. Use one row per Monday-start workweek
              with kind “week”, or one holiday with kind “holiday” and date.
              Dates use YYYY-MM-DD; frequency is weekly, biweekly, semimonthly
              or monthly. benefits “no” marks a deduction holiday. Other layouts
              remain evidence for manual review.
            </p>
          </details>
        </div>
      </section>
      {edit && (
        <CalendarEditor
          key={edit.sourceId ?? edit.draft.periods[0]?.id ?? "remove"}
          edit={edit}
          workspace={workspace}
          view={view}
          year={year}
          close={() => setEdit(null)}
          saved={() => {
            setEdit(null);
            changed();
          }}
        />
      )}
      {prediction && (
        <PayPrediction
          key={prediction.id}
          workspace={workspace}
          view={view}
          period={prediction}
          close={() => setPrediction(null)}
          saved={() => {
            setPrediction(null);
            changed();
          }}
        />
      )}
    </>
  );
}

function CalendarGrid({
  view,
  year,
  periods,
}: {
  view: PayView;
  year: number;
  periods: PayPeriod[];
}) {
  const [month, setMonth] = useState("all");
  const months = Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`,
  );
  const markers = (day: string) => {
    const values = periods
      .filter((p) => p.payDate === day)
      .map((p) => `Payday: ${p.name}`);
    if (view.state.holidays[day])
      values.push(`Holiday: ${view.state.holidays[day]}`);
    const d = view.state.days[day];
    if (d?.sick) values.push(`${d.sick} sick hours recorded`);
    if (d?.plannedSick && d.worked === null)
      values.push(`${d.plannedSick} sick hours planned`);
    if (d?.unpaid) values.push(`${d.unpaid / 10000} unpaid hours`);
    return values;
  };
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <HelpHeading topic="payCalendar">
            <h2>
              <CalendarDays size={17} /> Calendar · {year}
            </h2>
          </HelpHeading>
          <p>
            Paydays, official holidays and time off. Unpaid holidays can still
            be worked.
          </p>
        </div>
        <label>
          Calendar view
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="all">Whole year</option>
            {months.map((m) => (
              <option key={m} value={m.slice(5)}>
                {new Date(`${m}-01T12:00:00Z`).toLocaleDateString(undefined, {
                  month: "long",
                  timeZone: "UTC",
                })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {month === "all" ? (
        <div className="pay-year-grid">
          {months.map((m) => {
            const events = Array.from(
              { length: 31 },
              (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`,
            ).flatMap((day) => markers(day).map((label) => ({ day, label })));
            return (
              <section key={m}>
                <h3>
                  {new Date(`${m}-01T12:00:00Z`).toLocaleDateString(undefined, {
                    month: "long",
                    timeZone: "UTC",
                  })}
                </h3>
                {events.length ? (
                  events.map((e, i) => (
                    <p key={i}>
                      <time>{e.day.slice(8)}</time> {e.label}
                    </p>
                  ))
                ) : (
                  <p>No calendar events</p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="pay-month-grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((n) => (
            <strong key={n}>{n}</strong>
          ))}
          {(() => {
            const first = new Date(`${year}-${month}-01T12:00:00Z`),
              offset = (first.getUTCDay() + 6) % 7,
              total = new Date(Date.UTC(year, Number(month), 0)).getUTCDate();
            return Array.from({ length: offset + total }, (_, i) => {
              if (i < offset) return <div key={i} aria-hidden="true" />;
              const day = `${year}-${month}-${String(i - offset + 1).padStart(2, "0")}`;
              return (
                <div key={day}>
                  <time>{i - offset + 1}</time>
                  {markers(day).map((m, j) => (
                    <small key={j}>{m}</small>
                  ))}
                  {periods
                    .filter((p) => p.weeks.includes(day))
                    .map((p) => (
                      <small key={p.id}>Week for {p.payDate} pay</small>
                    ))}
                </div>
              );
            });
          })()}
        </div>
      )}
    </section>
  );
}

function CalendarEditor({
  edit,
  workspace,
  view,
  year,
  close,
  saved,
}: {
  edit: Edit;
  workspace: string;
  view: PayView;
  year: number;
  close: () => void;
  saved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => structuredClone(edit.draft));
  const [source, setSource] = useState<PaySourceDetail | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [exportPath, setExportPath] = useState("");
  const [original, setOriginal] = useState(false);
  const [image, setImage] = useState("");
  const operation = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => {
    let live = true;
    if (edit.sourceId)
      command<PaySourceDetail>("pay_source", { workspace, id: edit.sourceId })
        .then((s) => {
          if (live) setSource(s);
        })
        .catch((e) => {
          if (live) setSourceError(String(e));
        });
    return () => {
      live = false;
    };
  }, [workspace, edit.sourceId]);
  useEffect(() => {
    let live = true;
    if (original && source?.source.format === "image")
      command<string>("pay_source_original", {
        workspace,
        id: source.source.id,
      })
        .then((s) => {
          if (live) setImage(s);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    return () => {
      live = false;
    };
  }, [workspace, original, source]);
  const modify = (d: Draft) => {
    setDraft(d);
    setDirty(true);
    setConfirmed(false);
  };
  const leave = () => {
    if (
      !busy &&
      (!dirty || window.confirm("Discard these unsaved calendar changes?"))
    )
      close();
  };
  const evidence = (location: string): PayEvidence => ({
    sourceId: source!.source.id,
    location,
    quote:
      source!.document.chunks.find((c) => c.location === location)?.text ?? "",
  });
  function propose() {
    if (!source) return;
    const periods = new Map<string, PayPeriod>(),
      holidays: PayHolidayChange[] = [];
    for (const s of source.document.suggestions) {
      const e = {
        sourceId: source.source.id,
        location: s.location,
        quote: s.quote,
      };
      if (s.kind === "holiday")
        holidays.push({
          date: s.date,
          name: s.name || "Official holiday",
          evidence: e,
        });
      else {
        const key = JSON.stringify([s.payDate, s.frequency, s.benefits]);
        const p = periods.get(key) ?? {
          ...newPeriod(year),
          name: s.name || `Paycheck ${s.payDate}`,
          payDate: s.payDate,
          frequency: s.frequency,
          benefits: s.benefits,
        };
        if (!p.weeks.includes(s.date)) {
          p.weeks.push(s.date);
          p.evidence.push(e);
        }
        periods.set(key, p);
      }
    }
    modify({ periods: [...periods.values()], holidays, removePeriods: [] });
  }
  async function apply() {
    const change = {
      kind: "calendar",
      review: { sourceId: edit.sourceId ?? null, ...draft, reason, confirmed },
    };
    const signature = JSON.stringify(change);
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await command("save_payroll", {
        workspace,
        operation: operation.current.id,
        revision: view.revision,
        change,
      });
      saved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const existing = Object.values(view.state.periods ?? {});
  const owners = new Map<string, string>();
  for (const p of existing) {
    if (
      !draft.removePeriods.includes(p.id) &&
      !draft.periods.some((next) => next.id === p.id)
    )
      for (const week of p.weeks) owners.set(week, p.payDate);
  }
  const conflicts: { week: string; previous: string; proposed: string }[] = [];
  for (const p of draft.periods)
    for (const week of p.weeks.filter(Boolean)) {
      const previous = owners.get(week);
      if (previous) conflicts.push({ week, previous, proposed: p.payDate });
      owners.set(week, p.payDate);
    }
  return (
    <Modal
      title={
        edit.sourceId ? "Review payroll calendar source" : "Review pay period"
      }
      onClose={leave}
      busy={busy}
    >
      <form
        className="pay-form pay-calendar-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
        onChange={() => setDirty(true)}
      >
        {sourceError && (
          <p role="alert" className="form-error">
            {sourceError} Close and reopen this source to retry.
          </p>
        )}
        {edit.sourceId && !source && !sourceError && (
          <p role="status">Loading calendar evidence…</p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error} Your draft is retained.
          </p>
        )}
        <fieldset
          disabled={busy || !!sourceError || (!!edit.sourceId && !source)}
        >
          {source && (
            <div className="pay-evidence">
              <strong>{source.source.name}</strong>
              {source.document.warnings.map((w, i) => (
                <p key={i} className="import-caution">
                  {w}
                </p>
              ))}
              <details>
                <summary>
                  Extracted source evidence ({source.document.chunks.length}{" "}
                  locations)
                </summary>
                <div className="pay-source-text">
                  {source.document.chunks.map((c) => (
                    <section key={c.location}>
                      <strong>{c.location}</strong>
                      <pre>{c.text}</pre>
                    </section>
                  ))}
                </div>
              </details>
              <details onToggle={(e) => setOriginal(e.currentTarget.open)}>
                <summary>Original document</summary>
                {original && source.source.format === "pdf" && (
                  <Suspense fallback={<p>Loading viewer…</p>}>
                    <Pdf
                      workspace={workspace}
                      sourceId={source.source.id}
                      sourceCommand="pay_source_original"
                    />
                  </Suspense>
                )}
                {original && image && (
                  <img
                    className="pay-source-image"
                    src={`data:${source.source.mime};base64,${image}`}
                    alt="Original payroll source"
                  />
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    try {
                      setExportPath(
                        await command<string>("export_pay_source", {
                          workspace,
                          id: source.source.id,
                        }),
                      );
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Export original
                </button>
                {exportPath && (
                  <p role="status">
                    Saved original: {exportPath}{" "}
                    <button
                      type="button"
                      className="text-button"
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
              </details>
              {source.document.suggestions.length > 0 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (
                      !dirty ||
                      window.confirm(
                        "Replace this draft with the source's table proposals?",
                      )
                    )
                      propose();
                  }}
                >
                  Use table proposals ({source.document.suggestions.length})
                </button>
              )}
              {!source.document.suggestions.length && (
                <p>
                  No safe table proposals were found. Add periods or holidays
                  below after comparing the original.
                </p>
              )}
            </div>
          )}
          <HelpHeading topic="payCalendar">
            <h3>Changes to review</h3>
          </HelpHeading>
          {conflicts.length > 0 && (
            <section className="pay-review" role="alert">
              <h3>Resolve overlapping workweeks</h3>
              <p>
                Choose the existing period under Apply as to replace it, or
                remove the conflicting proposal. Confirmation alone cannot
                approve two paychecks for one workweek.
              </p>
              {conflicts.map((c, i) => (
                <p key={i}>
                  Week {c.week}: {c.previous} → {c.proposed}
                </p>
              ))}
            </section>
          )}
          <p>
            Whole weeks begin on Monday. Review full years, unusual paydays,
            frequency and benefits exceptions. Replacing a period keeps its
            identity; overlapping assignments must be resolved before saving.
          </p>
          {draft.removePeriods.map((id) => (
            <p key={id}>
              Remove {view.state.periods?.[id]?.name} (
              {view.state.periods?.[id]?.payDate}) and its workweek assignments.
            </p>
          ))}
          {draft.periods.map((p, i) => {
            const update = (patch: Partial<PayPeriod>) =>
              modify({
                ...draft,
                periods: draft.periods.map((x, j) =>
                  j === i ? { ...x, ...patch } : x,
                ),
              });
            return (
              <section
                className="pay-calendar-draft"
                key={i}
                aria-label={`Period ${i + 1}`}
              >
                <div className="pay-actions">
                  <strong>Period {i + 1}</strong>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      modify({
                        ...draft,
                        periods: draft.periods.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Remove from draft
                  </button>
                </div>
                <label>
                  Apply as
                  <select
                    value={existing.some((x) => x.id === p.id) ? p.id : "new"}
                    onChange={(e) =>
                      update({
                        id:
                          e.target.value === "new"
                            ? crypto.randomUUID()
                            : e.target.value,
                      })
                    }
                  >
                    <option value="new">New pay period</option>
                    {existing.map((x) => (
                      <option key={x.id} value={x.id}>
                        Replace {x.name} · {x.payDate}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="pay-usual-inputs">
                  <label>
                    Period name
                    <input
                      required
                      maxLength={120}
                      value={p.name}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </label>
                  <label>
                    Pay date
                    <input
                      required
                      type="date"
                      min="1900-01-01"
                      max="2100-12-31"
                      value={p.payDate}
                      onChange={(e) => update({ payDate: e.target.value })}
                    />
                  </label>
                  <label>
                    Withholding frequency
                    <select
                      required
                      value={p.frequency}
                      onChange={(e) => update({ frequency: e.target.value })}
                    >
                      <option value="">Choose frequency</option>
                      {frequencies.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={p.benefits}
                      onChange={(e) => update({ benefits: e.target.checked })}
                    />{" "}
                    Benefits normally deducted
                  </label>
                </div>
                <label htmlFor={`pay-weeks-${i}`}>
                  Workweeks (Monday dates, separated by commas)
                </label>
                <input
                  id={`pay-weeks-${i}`}
                  required
                  value={p.weeks.join(", ")}
                  onChange={(e) =>
                    update({
                      weeks: e.target.value.split(/[,\n]/).map((v) => v.trim()),
                    })
                  }
                  placeholder="2026-05-25, 2026-06-01, 2026-06-08"
                />
                <label>
                  Exception / period note
                  <input
                    maxLength={2000}
                    value={p.note}
                    onChange={(e) => update({ note: e.target.value })}
                  />
                </label>
                {source && (
                  <>
                    <p>
                      Supporting locations:{" "}
                      {p.evidence.map((e) => e.location).join(", ") ||
                        "Choose evidence"}
                    </p>
                    <label>
                      Replace supporting location
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value)
                            update({ evidence: [evidence(e.target.value)] });
                        }}
                      >
                        <option value="">Choose a source excerpt</option>
                        {source.document.chunks.map((c) => (
                          <option value={c.location} key={c.location}>
                            {c.location} · {c.text.slice(0, 65)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </section>
            );
          })}
          {draft.holidays.map((h, i) => (
            <section
              className="pay-calendar-draft"
              key={i}
              aria-label={`Holiday ${i + 1}`}
            >
              <div className="pay-actions">
                <strong>Holiday {i + 1}</strong>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    modify({
                      ...draft,
                      holidays: draft.holidays.filter((_, j) => j !== i),
                    })
                  }
                >
                  Remove from draft
                </button>
              </div>
              <div className="pay-usual-inputs">
                <label>
                  Holiday date
                  <input
                    type="date"
                    required
                    value={h.date}
                    onChange={(e) =>
                      modify({
                        ...draft,
                        holidays: draft.holidays.map((x, j) =>
                          j === i ? { ...x, date: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Holiday name
                  <input
                    required
                    maxLength={120}
                    value={h.name ?? ""}
                    onChange={(e) =>
                      modify({
                        ...draft,
                        holidays: draft.holidays.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              {source && (
                <label>
                  Supporting location
                  <select
                    required
                    value={h.evidence?.location ?? ""}
                    onChange={(e) =>
                      modify({
                        ...draft,
                        holidays: draft.holidays.map((x, j) =>
                          j === i
                            ? { ...x, evidence: evidence(e.target.value) }
                            : x,
                        ),
                      })
                    }
                  >
                    <option value="">Choose evidence</option>
                    {source.document.chunks.map((c) => (
                      <option value={c.location} key={c.location}>
                        {c.location} · {c.text.slice(0, 65)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </section>
          ))}
          <div className="pay-actions">
            <button
              type="button"
              className="secondary"
              onClick={() =>
                modify({
                  ...draft,
                  periods: [...draft.periods, newPeriod(year)],
                })
              }
            >
              Add period to draft
            </button>
            {source && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  modify({
                    ...draft,
                    holidays: [
                      ...draft.holidays,
                      { date: `${year}-01-01`, name: "", evidence: null },
                    ],
                  })
                }
              >
                Add holiday to draft
              </button>
            )}
          </div>
          <label>
            Review / conflict decision
            <input
              required
              maxLength={2000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setConfirmed(false);
              }}
              placeholder="What you checked and how conflicting dates were resolved"
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I reviewed the full dates, week assignments and source conflicts.
          </label>
          <p>
            Applying holidays reopens the year's holiday-list review. This
            calendar does not record a deposit.
          </p>
        </fieldset>
        <div className="pay-actions">
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
            disabled={
              busy ||
              !confirmed ||
              conflicts.length > 0 ||
              (!draft.periods.length &&
                !draft.holidays.length &&
                !draft.removePeriods.length)
            }
          >
            {busy ? "Saving…" : "Apply reviewed calendar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
