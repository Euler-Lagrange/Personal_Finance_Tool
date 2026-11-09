import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { call, change, refresh, toast } from "../api";
import { addDays, isISODate, shortDate, toISO, weekday } from "../../core/dates";
import { formatMoney, moneyInput, parseMoney } from "../../core/money";
import { payPeriods, usBankHolidays } from "../../core/pay";
import type { Person } from "../../core/split";
import type { Category, KnownPaycheck, PayKind, PayMonth, PayProfile, PayProfileInput } from "../../shared/types";
import { AmountInput, Card, Segmented } from "../components/ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayLabel = (date: string) => `${WEEKDAYS[weekday(date)]} ${shortDate(date)}`;

/** "15, 31" or "15 and last" as days of the month. */
function parseDays(text: string): number[] {
  return text
    .split(/[\s,]+|and/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((t) => (t === "last" ? 31 : Number(t)));
}

interface Props {
  person: Person;
  name: string;
  profile: PayProfile | null;
  fit: PayMonth["fit"];
  categories: Category[];
  onDone?: () => void;
}

/** How one person is paid: the rate, the schedule, and the past paychecks predictions learn from. */
export function PaySettings({ person, name, profile, fit, categories, onDone }: Props) {
  const today = toISO(new Date());
  const s = profile?.schedule;
  const incomeCategories = categories.filter((c) => c.kind === "income" && !c.archived);
  const [kind, setKind] = useState<PayKind>(profile?.current.kind ?? "hourly");
  const [rate, setRate] = useState(profile?.current.rate_cents ? moneyInput(profile.current.rate_cents) : "");
  const [net, setNet] = useState(profile?.current.net_per_check_cents ? moneyInput(profile.current.net_per_check_cents) : "");
  const [from, setFrom] = useState(profile?.current.effective_date ?? `${today.slice(0, 4)}-01-01`);
  const [rule, setRule] = useState<"biweekly" | "monthdays">(s?.rule ?? "biweekly");
  const [anchor, setAnchor] = useState(s?.anchor ?? "");
  const [lag, setLag] = useState(String(s?.lagDays ?? 5));
  const [monthDays, setMonthDays] = useState((s?.monthDays?.length ? s.monthDays : [15, 31]).map((d) => (d === 31 ? "last" : d)).join(", "));
  const [sick, setSick] = useState(String(s?.sickHoursPerYear ?? 0));
  const [usual, setUsual] = useState(String(s?.usualHours ?? 80));
  const [goal, setGoal] = useState(s?.grossGoalCents ? moneyInput(s.grossGoalCents) : "");
  const [category, setCategory] = useState<number | null>(s?.incomeCategoryId ?? incomeCategories[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const hourly = kind === "hourly";

  const lagDays = rule === "monthdays" && !hourly ? 0 : Number(lag);
  const days = parseDays(monthDays);
  const ruleOk = Number.isInteger(lagDays) && lagDays >= 0 && (rule === "biweekly" ? isISODate(anchor) && weekday(anchor) === 1 : days.length > 0 && days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31));
  const closed = new Set([Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1].flatMap(usBankHolidays).map((h) => h.date));
  const upcoming = ruleOk
    ? payPeriods({ rule, anchor, lagDays, monthDays: days }, today, addDays(today, 70), closed)
        .filter((p) => p.pay_date >= today)
        .slice(0, 3)
    : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const goalCents = goal.trim() === "" ? null : parseMoney(goal);
    if (goal.trim() !== "" && goalCents === null) return setError("Enter the yearly goal as an amount, or leave it empty");
    const input: PayProfileInput = {
      person,
      kind,
      effective_date: from,
      rate_cents: hourly ? parseMoney(rate) : null,
      net_per_check_cents: hourly ? null : parseMoney(net),
      rule,
      anchor,
      lagDays,
      monthDays: days,
      sickHoursPerYear: hourly ? Number(sick) : 0,
      usualHours: hourly ? Number(usual) : 0,
      grossGoalCents: hourly ? goalCents : null,
      incomeCategoryId: category,
    };
    try {
      await call("pay.saveProfile", input);
      refresh();
      setError(null);
      toast("Pay settings saved");
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card title={profile ? `How ${name} is paid` : `Set up ${name}'s pay`} className="pay-settings">
      <form className="quickadd" onSubmit={(e) => void submit(e)}>
        <div className="quickadd-fields">
          <label>
            <span>Paid</span>
            <Segmented
              ariaLabel="How pay is worked out"
              value={kind}
              onChange={setKind}
              options={[
                { value: "hourly", label: "By the hour" },
                { value: "salaried", label: "Same every paycheck" },
              ]}
            />
          </label>
          {hourly ? (
            <label className="narrow">
              <span>Hourly rate</span>
              <input inputMode="decimal" value={rate} placeholder="0.00" onChange={(e) => (setRate(e.target.value), setError(null))} />
            </label>
          ) : (
            <label className="narrow">
              <span>Take-home per paycheck</span>
              <input inputMode="decimal" value={net} placeholder="0.00" onChange={(e) => (setNet(e.target.value), setError(null))} />
            </label>
          )}
          <label>
            <span>{hourly ? "Rate" : "Amount"} starts on</span>
            <input type="date" value={from} onChange={(e) => (setFrom(e.target.value), setError(null))} required />
          </label>
        </div>
        {profile && <p className="muted small">Keep the start date to correct this {hourly ? "rate" : "amount"}. Choose a later date to record a raise: earlier paychecks keep the old one.</p>}

        <div className="quickadd-fields">
          <label>
            <span>Pay arrives</span>
            <Segmented
              ariaLabel="How often pay arrives"
              value={rule}
              onChange={setRule}
              options={[
                { value: "biweekly", label: "Every two weeks" },
                { value: "monthdays", label: "On set days of the month" },
              ]}
            />
          </label>
          {rule === "biweekly" ? (
            <label>
              <span>A pay period starts on (a Monday)</span>
              <input type="date" value={anchor} onChange={(e) => (setAnchor(e.target.value), setError(null))} required />
            </label>
          ) : (
            <label>
              <span>Paydays</span>
              <input value={monthDays} placeholder="15, last" onChange={(e) => (setMonthDays(e.target.value), setError(null))} />
            </label>
          )}
          {(rule === "biweekly" || hourly) && (
            <label className="tiny">
              <span>{rule === "biweekly" ? "Paid this many days after it ends" : "Pay period ends this many days before payday"}</span>
              <input inputMode="numeric" value={lag} onChange={(e) => (setLag(e.target.value), setError(null))} />
            </label>
          )}
        </div>
        <p className="muted small" aria-live="polite">
          {upcoming.length > 0
            ? `Next paydays: ${upcoming.map((p) => dayLabel(p.pay_date)).join(", ")}. A payday on a weekend or bank holiday moves to the business day before.`
            : rule === "biweekly"
              ? "Pick any Monday that began a real pay period. The next paydays will show here so you can check them."
              : "Type the days of the month, such as 15, last."}
        </p>

        <div className="quickadd-fields">
          {hourly && (
            <label className="tiny" title="A pay period that is not over yet is predicted at this many hours until more are logged. Use 0 to predict only from logged hours.">
              <span>Usual hours a paycheck</span>
              <input inputMode="decimal" value={usual} onChange={(e) => (setUsual(e.target.value), setError(null))} />
            </label>
          )}
          {hourly && (
            <label className="tiny">
              <span>Sick hours a year</span>
              <input inputMode="decimal" value={sick} onChange={(e) => (setSick(e.target.value), setError(null))} />
            </label>
          )}
          {hourly && (
            <label className="narrow">
              <span>Yearly gross goal (optional)</span>
              <input inputMode="decimal" value={goal} placeholder="None" onChange={(e) => (setGoal(e.target.value), setError(null))} />
            </label>
          )}
          {incomeCategories.length > 1 && (
            <label>
              <span>Planned in the budget under</span>
              <select value={category ?? ""} onChange={(e) => setCategory(Number(e.target.value))}>
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="btn primary">
            Save
          </button>
          {profile && onDone && (
            <button type="button" className="btn ghost" onClick={onDone}>
              Close
            </button>
          )}
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>

      {profile && profile.rates.length > 1 && (
        <>
          <h3>Rates over time</h3>
          <ul className="chips">
            {profile.rates.map((r) => (
              <li key={r.id} className="chip">
                From {shortDate(r.effective_date)}, {r.effective_date.slice(0, 4)}: {r.kind === "hourly" ? `${formatMoney(r.rate_cents ?? 0)} an hour` : `${formatMoney(r.net_per_check_cents ?? 0)} a paycheck`}
                <button type="button" className="icon-btn" aria-label={`Remove the rate from ${r.effective_date}`} onClick={() => void change("pay.removeRate", { id: r.id })}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {profile && profile.current.kind === "hourly" && <KnownPaychecks person={person} history={profile.schedule.history} fit={fit} />}
    </Card>
  );
}

/** Past paychecks with a known gross and take-home. Predictions are a straight line through these. */
function KnownPaychecks({ person, history, fit }: { person: Person; history: KnownPaycheck[]; fit: PayMonth["fit"] }) {
  const [gross, setGross] = useState("");
  const [net, setNet] = useState("");
  const [noBenefits, setNoBenefits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (next: KnownPaycheck[]) => change("pay.setHistory", { person, history: next });
  const edit = (i: number, patch: Partial<KnownPaycheck>) => void save(history.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const g = parseMoney(gross);
    const n = parseMoney(net);
    if (g === null || n === null || g <= 0 || n <= 0) return setError("Enter the gross and the take-home of one paycheck");
    if (n > g) return setError("Take-home cannot be more than gross");
    setError(null);
    if ((await save([...history, { gross_cents: g, net_cents: n, ...(noBenefits ? { no_benefits: true } : {}) }])) !== undefined) {
      setGross("");
      setNet("");
      setNoBenefits(false);
    }
  };

  return (
    <>
      <h3>Known paychecks</h3>
      <p className="muted small">
        {fit
          ? `Predictions rest on ${fit.n} ordinary paychecks and miss by ${(fit.error * 100).toFixed(2)}% on average.`
          : "Add at least three past paychecks with their gross and take-home. Predictions start from there."}
        {fit?.noBenefitsExtra != null && ` A paycheck with no benefits taken out brings home about ${formatMoney(fit.noBenefitsExtra)} more.`} A paycheck whose real take-home is filled in on this screen counts too.
      </p>
      {history.length > 0 && (
        <div className="table-wrap known">
          <table className="table edit">
            <thead>
              <tr>
                <th className="num">Gross</th>
                <th className="num">Take-home</th>
                <th className="num">Kept</th>
                <th>No benefits taken out</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td className="num">
                    <AmountInput cents={h.gross_cents} ariaLabel={`Gross of known paycheck ${i + 1}`} onCommit={(gross_cents) => edit(i, { gross_cents })} />
                  </td>
                  <td className="num">
                    <AmountInput cents={h.net_cents} ariaLabel={`Take-home of known paycheck ${i + 1}`} onCommit={(net_cents) => edit(i, { net_cents })} />
                  </td>
                  <td className="num muted">{((h.net_cents / h.gross_cents) * 100).toFixed(1)}%</td>
                  <td>
                    <input type="checkbox" aria-label={`No benefits taken out of known paycheck ${i + 1}`} checked={!!h.no_benefits} onChange={(e) => edit(i, { no_benefits: e.target.checked })} />
                  </td>
                  <td>
                    <button type="button" className="icon-btn" aria-label={`Remove known paycheck ${i + 1}`} onClick={() => void save(history.filter((_, j) => j !== i))}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="inline-form known-add" onSubmit={(e) => void add(e)}>
        <input inputMode="decimal" aria-label="Gross of a past paycheck" placeholder="Gross" value={gross} onChange={(e) => (setGross(e.target.value), setError(null))} />
        <input inputMode="decimal" aria-label="Take-home of that paycheck" placeholder="Take-home" value={net} onChange={(e) => (setNet(e.target.value), setError(null))} />
        <label className="check-line">
          <input type="checkbox" checked={noBenefits} onChange={(e) => setNoBenefits(e.target.checked)} />
          No benefits taken out
        </label>
        <button type="submit" className="btn">
          <Plus size={15} aria-hidden="true" />
          Add paycheck
        </button>
        {error && (
          <span className="field-error" role="alert">
            {error}
          </span>
        )}
      </form>
    </>
  );
}
