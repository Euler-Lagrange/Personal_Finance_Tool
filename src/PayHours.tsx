import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Plus, Settings2 } from "lucide-react";
import { command, money, today } from "./api";
import { Modal } from "./EntryDialog";
import { HelpHeading } from "./HelpTip";
import "./payHours.css";
import PayCalendar from "./PayCalendar";
import PayVariations from "./PayVariations";
import PayTaxSettings from "./PayTax";
import PayCash, { PayAnnual } from "./PayCash";
import type { Account } from "./types";
import type { TaxProfile, TaxCalibration } from "./payTaxTypes";
import type {
  PayPeriod,
  PayObservation,
  PayForecast,
  ForecastStatus,
} from "./payTypes";
import type { Intake } from "./ImportIntake";

type Day = {
  planned: number;
  worked: number | null;
  sick: number;
  plannedSick: number;
  unpaid: number;
  note: string;
};
type DayInput = {
  date: string;
  planned: string;
  worked: string | null;
  sick: number;
  plannedSick: number;
  unpaid: string;
  note: string;
};
export type PayState = {
  employer: string;
  usualWeek: number[];
  rates: Record<string, number>;
  days: Record<string, Day>;
  holidays: Record<string, string>;
  holidayYears: number[];
  openingSickUsed: Record<string, number>;
  periods?: Record<string, PayPeriod>;
  observations?: Record<string, PayObservation>;
  forecasts?: Record<string, PayForecast>;
  selectedForecasts?: Record<string, string>;
  taxProfiles?: Record<string, TaxProfile>;
  calibrations?: Record<string, TaxCalibration>;
};
export type PayView = {
  revision: number;
  observationIssues?: Record<string, string[]>;
  forecastStatus?: ForecastStatus[];
  calibrationCurrent?: Record<string, boolean>;
  state: PayState;
  week: {
    start: string;
    end: string;
    worked: number;
    sick: number;
    forecastHours: number;
    actualGrossCents: number | null;
    forecastGrossCents: number | null;
    unrecordedDays: number;
    issues: { date: string; message: string; planned: boolean }[];
  };
  sickYear: {
    year: number;
    allowance: number;
    openingUsed: number | null;
    recorded: number;
    reserved: number;
    remaining: number | null;
    holidaysComplete: boolean;
  };
};
type Editor = {
  kind:
    | "days"
    | "settings"
    | "rate"
    | "holiday"
    | "year"
    | "removeRate"
    | "removeHoliday";
  date?: string;
};
const names = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const number = (units: number) => String(units / 10000);
const amount = (cents: number | null) =>
  cents === null ? "Needs review" : money(cents);
function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const blank: Day = {
  planned: 0,
  worked: null,
  sick: 0,
  plannedSick: 0,
  unpaid: 0,
  note: "",
};
function inputs(v: PayView): DayInput[] {
  return names.map((_, i) => {
    const date = shift(v.week.start, i);
    const d = v.state.days[date] ?? blank;
    return {
      date,
      planned: number(d.planned),
      worked: d.worked === null ? null : number(d.worked),
      sick: d.sick,
      plannedSick: d.plannedSick,
      unpaid: number(d.unpaid),
      note: d.note,
    };
  });
}

export default function PayHours({
  workspace,
  intake,
  importEpoch,
  accounts,
}: {
  workspace: string;
  intake: Intake;
  importEpoch: number;
  accounts: Account[];
}) {
  const [day, setDay] = useState(today());
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const [tab, setTab] = useState<
    | "weeks"
    | "calendar"
    | "paychecks"
    | "variations"
    | "settings"
    | "cash"
    | "annual"
  >("weeks");
  const [view, setView] = useState<PayView | null>(null);
  const [error, setError] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setView(null);
    command<PayView>("payroll_view", { workspace, day, year })
      .then((v) => {
        if (current) setView(v);
      })
      .catch((e) => {
        if (current) setError(String(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [workspace, day, year, epoch]);
  return (
    <div className="pay-hours">
      <div className="pay-toolbar">
        <div role="tablist" aria-label="Pay & hours views">
          {(
            [
              "weeks",
              "paychecks",
              "variations",
              "cash",
              "annual",
              "calendar",
              "settings",
            ] as const
          ).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "primary" : "secondary"}
              onClick={() => setTab(t)}
            >
              {t === "weeks"
                ? "Weekly hours"
                : t === "paychecks"
                  ? "Paychecks"
                  : t === "variations"
                    ? "Pay variations"
                    : t === "cash"
                      ? "Pay & deposits"
                      : t === "annual"
                        ? "Annual payroll"
                        : t === "calendar"
                          ? "Holidays & allowance"
                          : "Pay settings"}
            </button>
          ))}
        </div>
        {tab === "weeks" ? (
          <div className="pay-week-picker">
            <button
              className="icon-button"
              aria-label="Previous workweek"
              disabled={loading}
              onClick={() => setDay(shift(day, -7))}
            >
              <ChevronLeft size={18} />
            </button>
            <label>
              Week containing
              <input
                type="date"
                min="1900-01-01"
                max="2100-12-31"
                value={day}
                onChange={(e) => {
                  if (e.target.value) setDay(e.target.value);
                }}
              />
            </label>
            <button
              className="icon-button"
              aria-label="Next workweek"
              disabled={loading}
              onClick={() => setDay(shift(day, 7))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        ) : (
          <label>
            {tab === "paychecks" || tab === "variations" || tab === "cash"
              ? "Paid year"
              : tab === "annual"
                ? "Report year"
                : "Allowance / holiday year"}
            <input
              type="number"
              min="1900"
              max="2100"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </label>
        )}
      </div>
      {notice && (
        <p className="pay-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}{" "}
          <button className="secondary" onClick={() => setEpoch((n) => n + 1)}>
            Reload Pay & hours
          </button>
        </div>
      )}
      {loading && <p role="status">Loading pay and hours…</p>}
      {view && (
        <>
          {tab === "cash" && (
            <PayCash
              workspace={workspace}
              view={view}
              accounts={accounts}
              year={year}
              changed={() => {
                setNotice(
                  "Payroll cash review saved locally. Recorded income remains unchanged.",
                );
                setEpoch((n) => n + 1);
              }}
            />
          )}
          {tab === "annual" && <PayAnnual workspace={workspace} year={year} />}
          {tab === "variations" && (
            <PayVariations
              workspace={workspace}
              view={view}
              year={year}
              importEpoch={importEpoch}
              changed={() => {
                setNotice(
                  "Known pay saved locally. Reloading the view; no bank deposit was created.",
                );
                setEpoch((n) => n + 1);
              }}
            />
          )}
          {tab === "weeks" && (
            <>
              <div className="pay-summary">
                <section className="panel">
                  <span>Recorded work</span>
                  <strong>{number(view.week.worked)} h</strong>
                  <small>
                    {view.week.sick} recorded sick hours ·{" "}
                    {view.week.unrecordedDays} days without actual hours
                  </small>
                </section>
                <section className="panel">
                  <span>Gross from recorded hours</span>
                  <strong>{amount(view.week.actualGrossCents)}</strong>
                  <small>Before withholding and deductions</small>
                </section>
                <section className="panel">
                  <span>Planned week gross</span>
                  <strong>{amount(view.week.forecastGrossCents)}</strong>
                  <small>
                    {number(view.week.forecastHours)} paid hours · actuals
                    replace plans as entered
                  </small>
                </section>
              </div>
              {view.week.issues.length > 0 && (
                <section
                  className="pay-review"
                  aria-label="Hours needing review"
                >
                  <h2>Review before relying on this pay estimate</h2>
                  <ul>
                    {view.week.issues.map((issue, i) => (
                      <li key={i}>
                        <strong>{issue.date}</strong> — {issue.message}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <HelpHeading topic="payrollHours">
                      <h2>
                        {view.week.start} – {view.week.end}
                      </h2>
                    </HelpHeading>
                    <p>
                      Track worked hours separately from your plan. Blank actual
                      hours mean not recorded; enter 0 for a confirmed day off.
                    </p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => setEditor({ kind: "days" })}
                  >
                    Edit this week
                  </button>
                </div>
                <div className="pay-table-scroll">
                  <table className="pay-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Planned work</th>
                        <th>Worked</th>
                        <th>Sick</th>
                        <th>Planned sick</th>
                        <th>Unpaid absence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {names.map((name, i) => {
                        const date = shift(view.week.start, i),
                          d = view.state.days[date] ?? blank;
                        return (
                          <tr key={date}>
                            <th scope="row">
                              {name}
                              <small>
                                {date}
                                {view.state.holidays[date] &&
                                  ` · ${view.state.holidays[date]}`}
                              </small>
                              {d.note && <small>{d.note}</small>}
                            </th>
                            <td>{number(d.planned)}</td>
                            <td>
                              {d.worked === null ? "—" : number(d.worked)}
                            </td>
                            <td>{d.sick}</td>
                            <td>{d.worked === null ? d.plannedSick : "—"}</td>
                            <td>{number(d.unpaid)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="pay-footnote">
                  Worked overtime and holiday hours use your regular rate.
                  Unworked time is unpaid except valid sick time. These
                  estimates do not record a bank deposit.
                </p>
              </section>
            </>
          )}
          {tab === "calendar" && (
            <>
              <PayCalendar
                workspace={workspace}
                view={view}
                year={year}
                intake={intake}
                importEpoch={importEpoch}
                mode="calendar"
                changed={() => {
                  setNotice(
                    "Reviewed calendar saved locally. Financial transactions are unchanged.",
                  );
                  setEpoch((n) => n + 1);
                }}
              />
              <div className="pay-summary">
                <section className="panel">
                  <HelpHeading topic="payrollSick">
                    <h2>{year} sick allowance</h2>
                  </HelpHeading>
                  <strong>
                    {view.sickYear.remaining === null
                      ? "Setup needed"
                      : `${view.sickYear.remaining} h available`}
                  </strong>
                  <small>
                    40 hours each January 1; unused allowance does not carry
                    forward.
                  </small>
                </section>
                <section className="panel">
                  <span>Recorded / reserved</span>
                  <strong>
                    {view.sickYear.recorded} h / {view.sickYear.reserved} h
                  </strong>
                  <small>
                    {view.sickYear.openingUsed === null
                      ? "Earlier use has not been confirmed."
                      : `${view.sickYear.openingUsed} hours used outside these records.`}{" "}
                    Requested sick time is deducted conservatively, including
                    unresolved entries.
                  </small>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Official PSW holidays</h2>
                    <p>
                      {view.sickYear.holidaysComplete
                        ? "This year’s holiday list is marked reviewed."
                        : "This year’s holiday list still needs review. Sick-pay estimates remain flagged."}
                    </p>
                  </div>
                  <div className="pay-actions">
                    <button
                      className="secondary"
                      onClick={() => setEditor({ kind: "year" })}
                    >
                      Review year setup
                    </button>
                    <button
                      className="primary"
                      onClick={() => setEditor({ kind: "holiday" })}
                    >
                      <Plus size={16} /> Add holiday
                    </button>
                  </div>
                </div>
                <div className="pay-holidays">
                  {Object.entries(view.state.holidays)
                    .filter(([d]) => d.startsWith(`${year}-`))
                    .map(([d, name]) => (
                      <div key={d}>
                        <time>{d}</time>
                        <strong>{name}</strong>
                        <button
                          className="text-button"
                          onClick={() =>
                            setEditor({ kind: "holiday", date: d })
                          }
                        >
                          Edit
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            setEditor({ kind: "removeHoliday", date: d })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  {!Object.keys(view.state.holidays).some((d) =>
                    d.startsWith(`${year}-`),
                  ) && <p>No official holidays entered for this year.</p>}
                </div>
                <p className="pay-footnote">
                  A holiday can be worked at the regular rate. Sick time cannot
                  be used on that date. Editing the list reopens its review.
                </p>
              </section>
            </>
          )}
          {tab === "settings" && (
            <>
              <PayTaxSettings
                workspace={workspace}
                view={view}
                year={year}
                changed={() => {
                  setNotice(
                    "Withholding profile saved locally. Existing predictions retain their original inputs.",
                  );
                  setEpoch((n) => n + 1);
                }}
              />
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>{view.state.employer}</h2>
                    <p>
                      Monday–Sunday workweek · W-2 payroll · straight-time
                      overtime
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setEditor({ kind: "settings" })}
                  >
                    <Settings2 size={16} /> Edit usual week
                  </button>
                </div>
                <div className="pay-usual">
                  {names.map((n, i) => (
                    <div key={n}>
                      <span>{n}</span>
                      <strong>{number(view.state.usualWeek[i])} h</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <HelpHeading topic="payrollRates">
                      <h2>Hourly rate history</h2>
                    </HelpHeading>
                    <p>
                      Each rate applies from its effective date until the next
                      change.
                    </p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => setEditor({ kind: "rate" })}
                  >
                    <Plus size={16} /> Add rate
                  </button>
                </div>
                <div className="pay-holidays">
                  {Object.entries(view.state.rates).map(([d, rate]) => (
                    <div key={d}>
                      <time>{d}</time>
                      <strong>${number(rate)} / hour</strong>
                      <button
                        className="text-button"
                        onClick={() => setEditor({ kind: "rate", date: d })}
                      >
                        Edit
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          setEditor({ kind: "removeRate", date: d })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {!Object.keys(view.state.rates).length && (
                    <p>
                      Add your starting rate and effective date. Your current
                      $93/hour rate is offered in the editor.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
          {tab === "paychecks" && (
            <PayCalendar
              workspace={workspace}
              view={view}
              year={year}
              intake={intake}
              importEpoch={importEpoch}
              mode="paychecks"
              changed={() => {
                setNotice(
                  "Reviewed calendar saved locally. Financial transactions are unchanged.",
                );
                setEpoch((n) => n + 1);
              }}
            />
          )}
          {editor && (
            <PayEditor
              key={`${editor.kind}:${editor.date ?? ""}`}
              editor={editor}
              view={view}
              workspace={workspace}
              year={year}
              close={() => setEditor(null)}
              saved={() => {
                setEditor(null);
                setNotice(
                  "Pay & hours saved locally. Recorded financial transactions are unchanged.",
                );
                setEpoch((n) => n + 1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function PayEditor({
  editor,
  view,
  workspace,
  year,
  close,
  saved,
}: {
  editor: Editor;
  view: PayView;
  workspace: string;
  year: number;
  close: () => void;
  saved: () => void;
}) {
  const [days, setDays] = useState(() => inputs(view));
  const [paste, setPaste] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const title = {
    days: "Edit weekly hours",
    settings: "Usual workweek",
    rate: "Hourly rate",
    holiday: "Official PSW holiday",
    year: "Review year setup",
    removeRate: "Remove hourly rate",
    removeHoliday: "Remove official holiday",
  }[editor.kind];
  const leave = () => {
    if (
      !busy &&
      (!dirty || window.confirm("Discard these unsaved pay and hours edits?"))
    )
      close();
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    const value = (k: string) => String(fields.get(k) ?? "");
    let change: Record<string, unknown>;
    switch (editor.kind) {
      case "days":
        change = { kind: "days", days };
        break;
      case "settings":
        change = {
          kind: "settings",
          employer: value("employer"),
          usualWeek: names.map((_, i) => value(`usual-${i}`)),
        };
        break;
      case "rate":
        change = {
          kind: "rate",
          effectiveDate: value("date"),
          hourlyRate: value("rate"),
        };
        break;
      case "holiday":
        change = { kind: "holiday", date: value("date"), name: value("name") };
        break;
      case "year":
        change = {
          kind: "year",
          year,
          openingSickUsed: Number(value("opening")),
          holidaysComplete: fields.has("holidays"),
        };
        break;
      case "removeRate":
        change = { kind: "removeRate", effectiveDate: editor.date };
        break;
      case "removeHoliday":
        change = { kind: "removeHoliday", date: editor.date };
        break;
    }
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
  function pasteRows() {
    try {
      const next = days.map((d) => ({ ...d }));
      const seen = new Set<string>();
      for (const row of paste.trim().split(/\r?\n/)) {
        const [date, planned, worked, sick, plannedSick, unpaid, ...note] =
          row.split("\t");
        const index = next.findIndex((d) => d.date === date);
        if (
          index < 0 ||
          seen.has(date) ||
          unpaid === undefined ||
          ![sick, plannedSick].every((v) => /^\d+$/.test(v))
        )
          throw Error(
            "Use one row per date in this week, with all six columns separated by tabs. Sick hours must be whole numbers.",
          );
        seen.add(date);
        next[index] = {
          date,
          planned,
          worked: worked === "" ? null : worked,
          sick: Number(sick),
          plannedSick: Number(plannedSick),
          unpaid,
          note: note.join(" "),
        };
      }
      setDays(next);
      setDirty(true);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Modal title={title} onClose={leave} busy={busy}>
      <form
        className="pay-form"
        onSubmit={submit}
        onChange={() => setDirty(true)}
      >
        {error && (
          <p role="alert" className="form-error">
            {error} Your draft is retained. Retrying unchanged values reuses the
            same save request.
          </p>
        )}
        <fieldset disabled={busy}>
          {editor.kind === "days" && (
            <>
              <HelpHeading topic="payrollHours">
                <h3>Plan and record each day</h3>
              </HelpHeading>
              <p>
                Worked hours can be blank until recorded. Sick hours are whole
                numbers. A conflicting sick allocation is flagged while actual
                work is retained.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setDays(
                    days.map((d, i) => ({
                      ...d,
                      planned: number(view.state.usualWeek[i]),
                    })),
                  );
                  setDirty(true);
                }}
              >
                Copy usual week into plan
              </button>
              <div className="pay-table-scroll">
                <table className="pay-table pay-input-table">
                  <thead>
                    <tr>
                      <th>Day / note</th>
                      <th>Planned work</th>
                      <th>Worked</th>
                      <th>Sick</th>
                      <th>Planned sick</th>
                      <th>Unpaid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d, i) => (
                      <tr key={d.date}>
                        <th scope="row">
                          {names[i]}
                          <small>{d.date}</small>
                          <input
                            aria-label={`${names[i]} note`}
                            maxLength={2000}
                            value={d.note}
                            onChange={(e) =>
                              setDays(
                                days.map((x, j) =>
                                  i === j ? { ...x, note: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </th>
                        {(
                          [
                            "planned",
                            "worked",
                            "sick",
                            "plannedSick",
                            "unpaid",
                          ] as const
                        ).map((field) => (
                          <td key={field}>
                            <input
                              type="number"
                              min="0"
                              max="24"
                              step={
                                field === "sick" || field === "plannedSick"
                                  ? "1"
                                  : "0.0001"
                              }
                              aria-label={`${names[i]} ${field}`}
                              value={d[field] ?? ""}
                              onChange={(e) =>
                                setDays(
                                  days.map((x, j) =>
                                    i === j
                                      ? {
                                          ...x,
                                          [field]:
                                            field === "sick" ||
                                            field === "plannedSick"
                                              ? Number(e.target.value)
                                              : field === "worked" &&
                                                  e.target.value === ""
                                                ? null
                                                : e.target.value,
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Paste weekly rows from a spreadsheet</summary>
                <p>
                  Columns: date, planned work, worked, sick, planned sick,
                  unpaid, optional note. Use YYYY-MM-DD dates and tabs; leave
                  worked blank if unknown.
                </p>
                <label htmlFor="pay-weekly-paste">Weekly rows</label>
                <textarea
                  id="pay-weekly-paste"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={4}
                />
                <button type="button" className="secondary" onClick={pasteRows}>
                  Use pasted rows in draft
                </button>
              </details>
            </>
          )}
          {editor.kind === "settings" && (
            <>
              <label>
                Employer
                <input
                  name="employer"
                  required
                  maxLength={100}
                  defaultValue={view.state.employer}
                />
              </label>
              <p>
                Copying this pattern fills planned hours only. Overtime is paid
                at your regular rate.
              </p>
              <div className="pay-usual-inputs">
                {names.map((name, i) => (
                  <label key={name}>
                    {name}
                    <input
                      name={`usual-${i}`}
                      type="number"
                      min="0"
                      max="24"
                      step="0.0001"
                      required
                      defaultValue={number(view.state.usualWeek[i])}
                    />
                  </label>
                ))}
              </div>
            </>
          )}
          {editor.kind === "rate" && (
            <>
              <HelpHeading topic="payrollRates">
                <h3>Rate and effective date</h3>
              </HelpHeading>
              <label>
                Effective date
                <input
                  name="date"
                  type="date"
                  required
                  min="1900-01-01"
                  max="2100-12-31"
                  readOnly={!!editor.date}
                  defaultValue={editor.date ?? today()}
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
                  defaultValue={
                    editor.date ? number(view.state.rates[editor.date]) : "93"
                  }
                />
              </label>
              <p>
                Changes recalculate hour-based estimates. Imported income and
                past bank transactions are unchanged.
              </p>
            </>
          )}
          {editor.kind === "holiday" && (
            <>
              <label>
                Holiday date
                <input
                  name="date"
                  type="date"
                  min={`${year}-01-01`}
                  max={`${year}-12-31`}
                  readOnly={!!editor.date}
                  required
                  defaultValue={editor.date ?? `${year}-01-01`}
                />
              </label>
              <label>
                Holiday name
                <input
                  name="name"
                  maxLength={120}
                  required
                  defaultValue={
                    editor.date ? view.state.holidays[editor.date] : ""
                  }
                />
              </label>
              <p>
                Use the official PSW list. You can work this day, but cannot use
                sick time. Saving reopens the year’s holiday review.
              </p>
            </>
          )}
          {editor.kind === "year" && (
            <>
              <HelpHeading topic="payrollSick">
                <h3>{year} allowance and calendar</h3>
              </HelpHeading>
              <label>
                Sick hours used outside these records
                <input
                  name="opening"
                  type="number"
                  min="0"
                  max="40"
                  step="1"
                  required
                  defaultValue={view.sickYear.openingUsed ?? 0}
                />
              </label>
              <p>
                Count only earlier sick hours that are not already entered in
                Weekly hours. The annual allowance is 40 hours and resets
                January 1.
              </p>
              <label className="import-check">
                <input
                  name="holidays"
                  type="checkbox"
                  defaultChecked={view.sickYear.holidaysComplete}
                />
                I have reviewed the complete official PSW holiday list for{" "}
                {year}.
              </label>
            </>
          )}
          {(editor.kind === "removeRate" ||
            editor.kind === "removeHoliday") && (
            <p>
              Remove the{" "}
              {editor.kind === "removeRate" ? "rate effective" : "holiday on"}{" "}
              {editor.date}? This can change estimates or sick-time eligibility.
              The prior change remains in local history.
            </p>
          )}
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
          <button className="primary" disabled={busy}>
            {busy
              ? "Saving…"
              : editor.kind.startsWith("remove")
                ? "Remove"
                : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
