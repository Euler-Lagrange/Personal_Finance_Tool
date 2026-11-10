import { useState } from "react";
import { Pencil, Settings2 } from "lucide-react";
import { change, toast, useQuery } from "../api";
import type { ScreenProps } from "../App";
import { addDays, monthLabel, shortDate, toISO } from "../../core/dates";
import { formatMoney } from "../../core/money";
import type { Person } from "../../core/split";
import type { DayTag, PayMonth, PaycheckPatch, PaycheckView } from "../../shared/types";
import { AmountInput, Bar, Card, Segmented } from "../components/ui";
import { PaySettings, dayLabel } from "./PaySettings";

type Props = Pick<ScreenProps, "month" | "view" | "settings" | "categories">;

const hoursText = (n: number) => String(Number(n.toFixed(2)));
const longDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const TAG_LABELS: Record<DayTag, string> = { worked: "Worked", sick: "Sick", holiday: "Holiday", off: "Off" };

export function Pay({ month, view, settings, categories }: Props) {
  const [person, setPerson] = useState<Person>(view === "b" ? "b" : "a");
  const [open, setOpen] = useState(false);
  const data = useQuery("pay.month", { person, month });
  // While switching person the previous person's answer is still on hand. Wait for the right one.
  if (!data || data.person !== person) return null;
  const { profile } = data;
  const name = settings.people[person];
  const hourly = profile?.current.kind === "hourly";
  const formKey = JSON.stringify([person, profile?.rates, profile && { ...profile.schedule, history: undefined }]);

  return (
    <div className="stack">
      <div className="toolbar">
        <Segmented
          ariaLabel="Whose pay"
          value={person}
          onChange={(p) => (setPerson(p), setOpen(false))}
          options={[
            { value: "a", label: settings.people.a },
            { value: "b", label: settings.people.b },
          ]}
        />
        {profile && (
          <span className="muted">
            {hourly ? `${formatMoney(profile.current.rate_cents ?? 0)} an hour` : `${formatMoney(profile.current.net_per_check_cents ?? 0)} a paycheck`} ·{" "}
            {profile.schedule.rule === "biweekly" ? "paid every two weeks" : "paid on set days of the month"}
          </span>
        )}
        <span className="grow" />
        {profile && (
          <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Settings2 size={15} aria-hidden="true" />
            Pay settings
          </button>
        )}
      </div>

      {(!profile || open) && <PaySettings key={formKey} person={person} name={name} profile={profile} fit={data.fit} categories={categories} onDone={() => setOpen(false)} />}

      {profile && hourly && (
        <div className="grid pay">
          <Calendar data={data} person={person} month={month} />
          <div className="stack">
            <WhatIf person={person} start={profile.schedule.usualHours || 80} canFlagBenefits={data.fit?.noBenefitsExtra != null} />
            <YearCard data={data} />
          </div>
        </div>
      )}
      {profile && <Paychecks key={`${person}:${month}`} data={data} person={person} month={month} />}
      {profile && !hourly && <YearCard data={data} />}
    </div>
  );
}

// ---- calendar ----------------------------------------------------------------

function Calendar({ data, person, month }: { data: PayMonth; person: Person; month: string }) {
  const today = toISO(new Date());
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const holidays = new Map(data.bankHolidays.map((h) => [h.date, h.name]));
  const paydays = new Map(data.paychecks.map((p) => [p.pay_date, p]));
  const weeks: string[][] = [];
  for (let d = data.gridStart; d <= data.gridEnd; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  const band = (date: string) => data.paychecks.findIndex((p) => p.period_start <= date && date <= p.period_end);
  const monthHours = data.days.filter((d) => d.date.startsWith(month)).reduce((t, d) => t + d.hours, 0);

  return (
    <Card title={`Hours in ${monthLabel(month)}`} action={<span className="muted">{hoursText(monthHours)} hours</span>}>
      <div className="cal">
        <div className="cal-row cal-head" aria-hidden="true">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span key={d}>{d}</span>
          ))}
          <span>Week</span>
        </div>
        {weeks.map((week) => (
          <div className="cal-row" key={week[0]}>
            {week.map((date) => {
              const day = byDate.get(date);
              const hours = day?.hours ?? 0;
              const tag = day?.tag ?? "worked";
              const payday = paydays.get(date);
              const set = (h: number, t: DayTag) => void change("pay.setDay", { person, date, hours: h, tag: t });
              const b = band(date);
              return (
                <div key={date} className={`cal-day ${b === -1 ? "" : b % 2 === 0 ? "band-a" : "band-b"} ${date.startsWith(month) ? "" : "out"} ${date === today ? "today" : ""} ${tag !== "worked" ? `is-${tag}` : ""}`}>
                  <div className="cal-top">
                    <span className="cal-num">{Number(date.slice(8))}</span>
                    {holidays.has(date) && !payday && (
                      <span className="cal-holiday" title={`${holidays.get(date)}: banks are closed`}>
                        {holidays.get(date)}
                      </span>
                    )}
                    {payday && (
                      <span className="tag payday" title={payday.predicted_net_cents !== null ? `Payday: about ${formatMoney(payday.actual_net_cents ?? payday.predicted_net_cents)}` : "Payday"}>
                        Payday
                      </span>
                    )}
                  </div>
                  <HoursInput hours={hours} ariaLabel={`Hours on ${longDate(date)}`} onCommit={(h) => set(h, tag === "off" ? "worked" : tag)} />
                  <select className="cal-tag" aria-label={`Kind of day, ${longDate(date)}`} value={tag} onChange={(e) => set(hours, e.target.value as DayTag)}>
                    {(Object.keys(TAG_LABELS) as DayTag[]).map((t) => (
                      <option key={t} value={t}>
                        {TAG_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            <div className="cal-week">
              <strong>{hoursText(week.reduce((t, d) => t + (byDate.get(d)?.hours ?? 0), 0))}</strong>
            </div>
          </div>
        ))}
      </div>
      <p className="muted small cal-note">The two shades mark pay periods. Sick hours count as paid. A day tagged Holiday also moves a payday that would land on it.</p>
    </Card>
  );
}

function HoursInput({ hours, onCommit, ariaLabel }: { hours: number; onCommit: (hours: number) => void; ariaLabel: string }) {
  const initial = hours === 0 ? "" : hoursText(hours);
  const [text, setText] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [bad, setBad] = useState(false);
  if (seen !== initial) {
    setSeen(initial);
    setText(initial);
    setBad(false);
  }
  const commit = () => {
    const t = text.trim();
    if (t === initial) return setBad(false);
    const n = t === "" ? 0 : Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 24) return setBad(true);
    setBad(false);
    onCommit(n);
  };
  return (
    <input
      className={`cal-hours ${bad ? "invalid" : ""}`}
      inputMode="decimal"
      aria-label={ariaLabel}
      aria-invalid={bad}
      title={bad ? "Enter hours from 0 to 24" : undefined}
      placeholder="0"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(initial);
          setBad(false);
        }
      }}
    />
  );
}

// ---- what if -----------------------------------------------------------------

function WhatIf({ person, start, canFlagBenefits }: { person: Person; start: number; canFlagBenefits: boolean }) {
  const [text, setText] = useState(hoursText(start));
  const [noBenefits, setNoBenefits] = useState(false);
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 400;
  const result = useQuery("pay.whatIf", { person, hours: valid ? n : 0, no_benefits: canFlagBenefits && noBenefits });
  return (
    <Card title="What if">
      <label className="whatif-hours">
        <input inputMode="decimal" aria-invalid={!valid} className={valid ? "" : "invalid"} value={text} onChange={(e) => setText(e.target.value)} />
        <span>hours in a pay period</span>
      </label>
      {canFlagBenefits && (
        <label className="check-line">
          <input type="checkbox" checked={noBenefits} onChange={(e) => setNoBenefits(e.target.checked)} />
          No benefits taken out
        </label>
      )}
      {valid && result && (
        <ul className="plain whatif">
          <li className="row-line">
            <span className="muted">Gross</span>
            <span className="money">{formatMoney(result.gross_cents)}</span>
          </li>
          <li className="row-line">
            <span className="muted">Take-home</span>
            <strong className="money">{result.net_cents === null ? "Not yet" : `${result.uncertain ? "about " : ""}${formatMoney(result.net_cents)}`}</strong>
          </li>
          {result.extra_hour_cents !== null && (
            <li className="row-line">
              <span className="muted">One more hour brings home</span>
              <span className="money">{formatMoney(result.extra_hour_cents)}</span>
            </li>
          )}
        </ul>
      )}
      {valid && result?.net_cents === null && <p className="muted small">Take-home shows once three known paychecks are added in Pay settings.</p>}
      {valid && result?.uncertain && <p className="muted small">This is well outside the paychecks the prediction has seen, so treat it as a rough guess.</p>}
      {!valid && <p className="field-error">Enter a number of hours</p>}
    </Card>
  );
}

// ---- the year ----------------------------------------------------------------

function YearCard({ data }: { data: PayMonth }) {
  const y = data.year;
  const schedule = data.profile!.schedule;
  const hourly = data.profile!.current.kind === "hourly";
  const top = Math.max(1, ...y.checks.map((c) => c.net_cents));
  const perCheck = y.hoursToGoal !== null && y.checksLeft > 0 ? y.hoursToGoal / y.checksLeft : null;
  return (
    <Card title={`${y.year} by payday`}>
      <ul className="plain">
        {hourly && (
          <li className="row-line">
            <span className="muted">Hours</span>
            <span className="money">{hoursText(y.hours)}</span>
          </li>
        )}
        {hourly && (
          <li className="row-line">
            <span className="muted">Gross</span>
            <span className="money">{formatMoney(y.gross_cents)}</span>
          </li>
        )}
        <li className="row-line">
          <span className="muted">Take-home, real and predicted</span>
          <span className="money">{formatMoney(y.net_cents)}</span>
        </li>
        {hourly && (schedule.sickHoursPerYear > 0 || y.sickUsedHours > 0) && (
          <li className="row-line">
            <span className="muted">Sick hours used</span>
            <span className="money">
              {hoursText(y.sickUsedHours)} of {hoursText(schedule.sickHoursPerYear)}
            </span>
          </li>
        )}
      </ul>
      {hourly && schedule.grossGoalCents !== null && y.hoursToGoal !== null && (
        <div className="goal">
          <Bar used={Math.min(y.gross_cents, schedule.grossGoalCents)} total={schedule.grossGoalCents} />
          <p className="muted small">
            {y.hoursToGoal === 0
              ? `Past the ${formatMoney(schedule.grossGoalCents)} goal.`
              : `${hoursText(y.hoursToGoal)} hours to reach ${formatMoney(schedule.grossGoalCents)}${perCheck !== null && perCheck <= 200 ? `, about ${hoursText(Math.ceil(perCheck * 10) / 10)} a paycheck over the ${y.checksLeft} left` : ""}.`}
          </p>
        </div>
      )}
      {hourly && y.checks.length > 0 && (
        <div className="strip" role="img" aria-label={`${y.checks.length} paychecks in ${y.year}, ${y.checks.filter((c) => c.actual).length} with their real take-home filled in`}>
          {y.checks.map((c) => (
            <span
              key={c.pay_date}
              className={c.actual ? "real" : ""}
              style={{ height: `${Math.max(4, (c.net_cents / top) * 100)}%` }}
              title={`${shortDate(c.pay_date)}: ${c.net_cents > 0 ? formatMoney(c.net_cents) : "nothing yet"}${c.actual ? "" : c.net_cents > 0 ? " predicted" : ""}`}
            />
          ))}
        </div>
      )}
      <p className="muted small">{hourly ? "Counts only hours and paychecks entered here." : `${y.checks.length} paydays in ${y.year}.`}</p>
    </Card>
  );
}

// ---- paychecks ---------------------------------------------------------------

function Paychecks({ data, person, month }: { data: PayMonth; person: Person; month: string }) {
  const [editing, setEditing] = useState<number | null>(null);
  const hourly = data.paychecks.some((p) => p.kind === "hourly");
  const { income } = data;
  const plan = async () => {
    const cents = await change("pay.planIncome", { person, month });
    if (cents !== undefined) toast(`Planned ${income.category_name} income for ${monthLabel(month)} is now ${formatMoney(cents)}`);
  };
  return (
    <Card title="Paychecks">
      {data.paychecks.length === 0 ? (
        <p className="muted">No paycheck touches {monthLabel(month)}.</p>
      ) : (
        <div className="scroll-x">
          <table className="table edit paychecks">
            <thead>
              <tr>
                <th>Payday</th>
                {hourly && <th className="num">Hours</th>}
                {hourly && (
                  <th className="num" title="Hours times the rate. Type the gross from the pay stub if it differs.">
                    Gross
                  </th>
                )}
                <th className="num">{hourly ? "Predicted" : "Expected"}</th>
                <th className="num" title="The real deposit, once it lands">
                  Take-home
                </th>
                {hourly && (
                  <th className="num" title="How far the prediction was from the real take-home">
                    Miss
                  </th>
                )}
                {hourly && (
                  <th className="check" title="Tick when no benefits come out of this paycheck. Once one such paycheck has its real take-home, the app learns how much extra to expect.">
                    No benefits
                  </th>
                )}
                <th className="num" title="This person's share of the bills dated from this payday up to the next one">
                  Bills before next
                </th>
                {data.savingsGroup && (
                  <th className="num" title={`What the budget plans for ${data.savingsGroup} that month, divided across the paychecks that land in it`}>
                    Set aside
                  </th>
                )}
                <th className="num">Left</th>
                <th aria-label="Change dates" />
              </tr>
            </thead>
            <tbody>
              {data.paychecks.map((p, i) => (
                <PaycheckRow key={i} p={p} person={person} hourly={hourly} hasFit={data.fit !== null} showSetAside={data.savingsGroup !== null} editing={editing === i} onEdit={() => setEditing(editing === i ? null : i)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {income.checks > 0 && (
        <p className="pay-income">
          <span>
            {income.checks} {income.checks === 1 ? "paycheck lands" : "paychecks land"} in {monthLabel(month)}: <strong className="money">{formatMoney(income.expected_cents)}</strong> expected.
            {income.category_name && (income.planned_cents === income.expected_cents ? ` The budget plans the same under ${income.category_name}.` : ` The budget plans ${formatMoney(income.planned_cents)} under ${income.category_name}.`)}
          </span>
          {income.category_name && income.planned_cents !== income.expected_cents && income.expected_cents > 0 && (
            <button type="button" className="btn" onClick={() => void plan()}>
              Plan {formatMoney(income.expected_cents)}
            </button>
          )}
        </p>
      )}
    </Card>
  );
}

function PaycheckRow(props: { p: PaycheckView; person: Person; hourly: boolean; hasFit: boolean; showSetAside: boolean; editing: boolean; onEdit: () => void }) {
  const { p, person, hourly } = props;
  const update = (patch: PaycheckPatch) => void change("pay.updatePaycheck", { person, id: p.id, period_start: p.period_start, patch });
  const takeHome = p.actual_net_cents ?? p.predicted_net_cents;
  const left = takeHome === null ? null : takeHome - p.bills_cents - p.set_aside_cents;
  const miss = p.actual_net_cents && p.predicted_net_cents !== null ? (p.predicted_net_cents - p.actual_net_cents) / p.actual_net_cents : null;
  const date = (label: string, key: "pay_date" | "period_start" | "period_end") => (
    <label>
      <span>{label}</span>
      <input className="cell date" type="date" value={p[key]} onChange={(e) => e.target.value && update({ [key]: e.target.value })} />
    </label>
  );
  return (
    <tr>
      <td className="wide">
        {props.editing ? (
          <div className="pay-dates">
            {date("Paid", "pay_date")}
            {date("From", "period_start")}
            {date("To", "period_end")}
          </div>
        ) : (
          <>
            <strong>{dayLabel(p.pay_date)}</strong>
            {p.kind === "hourly" && (
              <span className="muted small pay-period">
                for {shortDate(p.period_start)} to {shortDate(p.period_end)}
              </span>
            )}
          </>
        )}
      </td>
      {hourly && (
        <td className="num">
          {p.kind === "hourly" ? hoursText(p.hours) : ""}
          {p.assumed_hours !== null && (
            <span className="muted small pay-period" title="This pay period is not over, so the prediction uses the usual hours from Pay settings until more are logged">
              plans on {hoursText(p.assumed_hours)}
            </span>
          )}
        </td>
      )}
      {hourly && (
        <td className="num">
          {p.kind === "hourly" && (
            <span title={p.actual_gross_cents === null ? undefined : `Typed from the pay stub. Hours times the rate gives ${formatMoney(p.gross_cents)}; empty the box to go back to that.`}>
              <AmountInput
                cents={p.actual_gross_cents ?? p.gross_cents}
                className={p.actual_gross_cents === null ? "" : "typed"}
                allowZero
                ariaLabel={`Gross for the ${shortDate(p.pay_date)} paycheck`}
                onCommit={(c) => update({ actual_gross_cents: c === p.gross_cents ? null : c })}
                onClear={() => update({ actual_gross_cents: null })}
              />
            </span>
          )}
        </td>
      )}
      <td className="num" title={p.predicted_net_cents === null ? (props.hasFit ? "No hours in this pay period yet" : "Add three known paychecks in Pay settings to see predictions") : p.uncertain ? "Well outside the known paychecks, so a rough guess" : undefined}>
        {p.predicted_net_cents === null ? <span className="muted">–</span> : <span className="money">{`${p.uncertain ? "≈ " : ""}${formatMoney(p.predicted_net_cents)}`}</span>}
      </td>
      <td className="num">
        <AmountInput cents={p.actual_net_cents} placeholder="0.00" ariaLabel={`Real take-home for the ${shortDate(p.pay_date)} paycheck`} onCommit={(c) => update({ actual_net_cents: c })} onClear={() => update({ actual_net_cents: null })} />
      </td>
      {hourly && (
        <td className="num" title={miss !== null ? `Predicted ${formatMoney(p.predicted_net_cents!)}, came in at ${formatMoney(p.actual_net_cents!)}` : undefined}>
          {miss === null ? "" : <span className={Math.abs(miss) >= 0.02 ? "money neg" : "money"}>{`${miss > 0 ? "+" : ""}${(miss * 100).toFixed(1)}%`}</span>}
        </td>
      )}
      {hourly && <td className="check">{p.kind === "hourly" && <input type="checkbox" aria-label={`No benefits taken out of the ${shortDate(p.pay_date)} paycheck`} checked={p.no_benefits} onChange={(e) => update({ no_benefits: e.target.checked })} />}</td>}
      <td className="num">
        {p.bills.length === 0 ? (
          <span className="muted">–</span>
        ) : (
          <details className="bills-due">
            <summary className="money">{formatMoney(p.bills_cents)}</summary>
            <ul className="plain">
              {p.bills.map((b) => (
                <li key={`${b.name}${b.date}`}>
                  <span>
                    {b.name} <span className="muted">· {shortDate(b.date)}</span>
                  </span>
                  <span className="money">{formatMoney(b.cents)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
      {props.showSetAside && <td className="num">{p.set_aside_cents === 0 ? <span className="muted">–</span> : <span className="money">{formatMoney(p.set_aside_cents)}</span>}</td>}
      <td className="num">{takeHome === null ? <span className="muted">–</span> : <span className={left! < 0 ? "money neg" : "money"}>{formatMoney(left!)}</span>}</td>
      <td>
        <button type="button" className="icon-btn" aria-label={`Change the dates of the ${shortDate(p.pay_date)} paycheck`} aria-pressed={props.editing} title="Change the dates" onClick={props.onEdit}>
          <Pencil size={14} />
        </button>
      </td>
    </tr>
  );
}
