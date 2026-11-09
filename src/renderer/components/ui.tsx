import { useState, type ReactNode } from "react";
import { formatMoney, moneyInput, parseMoney, type Cents } from "../../core/money";
import { describeSplit, sameSplit, type SplitSpec } from "../../core/split";
import type { Settings } from "../../shared/types";

export function Money({ cents, plus, tone }: { cents: Cents; plus?: boolean; tone?: boolean }) {
  const cls = tone ? (cents < 0 ? "money neg" : cents > 0 ? "money pos" : "money") : "money";
  return <span className={cls}>{formatMoney(cents, { plus })}</span>;
}

/** A text box for an amount. Calls `onCommit` with whole cents on Enter or when focus leaves. */
export function AmountInput(props: {
  cents: Cents | null;
  onCommit: (cents: Cents) => void;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  allowZero?: boolean;
  /** When given, emptying the box is allowed and calls this. */
  onClear?: () => void;
}) {
  const initial = props.cents === null ? "" : moneyInput(props.cents);
  const [text, setText] = useState(initial);
  const [bad, setBad] = useState(false);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setText(initial);
    setBad(false);
  }
  const commit = () => {
    if (text.trim() === initial || (text.trim() === "" && props.cents === null)) return setBad(false);
    if (text.trim() === "" && props.onClear) {
      setBad(false);
      return props.onClear();
    }
    const cents = parseMoney(text);
    if (cents === null || (cents === 0 && !props.allowZero)) return setBad(true);
    setBad(false);
    props.onCommit(cents);
  };
  return (
    <input
      className={`cell amount ${props.className ?? ""} ${bad ? "invalid" : ""}`}
      inputMode="decimal"
      aria-label={props.ariaLabel}
      aria-invalid={bad}
      title={bad ? "Enter an amount, such as 12.50" : undefined}
      placeholder={props.placeholder}
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

/** A text box that commits on Enter or blur and reverts on Escape. */
export function TextCell(props: { value: string; onCommit: (value: string) => void; ariaLabel: string; className?: string; placeholder?: string }) {
  const [text, setText] = useState(props.value);
  const [seen, setSeen] = useState(props.value);
  if (seen !== props.value) {
    setSeen(props.value);
    setText(props.value);
  }
  return (
    <input
      className={`cell ${props.className ?? ""}`}
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== props.value && props.onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setText(props.value);
      }}
    />
  );
}

export function splitLabel(spec: SplitSpec, settings: Settings): string {
  if (spec.type === "fixed") return `${formatMoney(spec.a_cents)} to ${settings.people.a}`;
  return describeSplit(spec, settings.people);
}

/**
 * Pick a split preset, or choose Custom and type either a percentage ("62.5") or a fixed
 * dollar amount ("$110.42") for person A. `leading` adds a first choice such as a bill's "Default".
 */
export function SplitSelect(props: {
  value: SplitSpec | null;
  onChange: (spec: SplitSpec) => void;
  settings: Settings;
  ariaLabel: string;
  className?: string;
  leading?: { label: string; active: boolean; onPick: () => void };
}) {
  const [custom, setCustom] = useState(false);
  const options: SplitSpec[] = [];
  for (const spec of [...props.settings.presets.map((p) => p.spec), ...(props.value ? [props.value] : [])]) {
    if (!options.some((o) => sameSplit(o, spec))) options.push(spec);
  }
  if (custom) {
    const done = (raw: string) => {
      const text = raw.trim();
      if (text.startsWith("$")) {
        const cents = parseMoney(text);
        if (cents !== null && cents >= 0) props.onChange({ type: "fixed", a_cents: cents });
      } else if (text !== "") {
        const pct = Number(text.replace(/%$/, ""));
        if (Number.isFinite(pct) && pct >= 0 && pct <= 100) props.onChange({ type: "percent", a: pct });
      }
      setCustom(false);
    };
    return (
      <input
        className={`cell ${props.className ?? ""}`}
        autoFocus
        aria-label={`Share for ${props.settings.people.a}: a percentage, or a dollar amount starting with $`}
        title={`Type a percentage such as 62.5, or a fixed amount such as $110.42, for ${props.settings.people.a}`}
        placeholder={`% or $ for ${props.settings.people.a}`}
        onBlur={(e) => done(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setCustom(false);
        }}
      />
    );
  }
  const index = props.value ? options.findIndex((o) => sameSplit(o, props.value!)) : -1;
  const selected = props.leading?.active ? "leading" : index === -1 ? "" : String(index);
  return (
    <select
      className={`cell ${props.className ?? ""}`}
      aria-label={props.ariaLabel}
      value={selected}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "custom") setCustom(true);
        else if (v === "leading") props.leading?.onPick();
        else if (v !== "") props.onChange(options[Number(v)]);
      }}
    >
      {selected === "" && <option value="">Leave as is</option>}
      {props.leading && <option value="leading">{props.leading.label}</option>}
      {options.map((o, i) => (
        <option key={i} value={i}>
          {splitLabel(o, props.settings)}
        </option>
      ))}
      <option value="custom">Custom…</option>
    </select>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div className="segmented" role="group" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button key={o.value} type="button" className={o.value === props.value ? "on" : ""} aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Progress of `used` against `total`. Turns to the warning colour when over. */
export function Bar({ used, total }: { used: Cents; total: Cents }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : used > 0 ? 100 : 0;
  return (
    <div className={`bar ${used > total ? "over" : ""}`} role="img" aria-label={`${formatMoney(used)} of ${formatMoney(total)}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Card(props: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${props.className ?? ""}`}>
      {(props.title || props.action) && (
        <header className="card-head">
          {props.title && <h2>{props.title}</h2>}
          {props.action}
        </header>
      )}
      {props.children}
    </section>
  );
}
