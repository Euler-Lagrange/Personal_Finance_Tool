import { HelpHeading } from "./HelpTip";
import { useEffect, useState } from "react";
import { command, dollars, money } from "./api";
import type { Category, EntryLine, LineInput } from "./types";
import "./charge-lines.css";

export const lineInputs = (lines?: EntryLine[]): LineInput[] =>
  (lines ?? []).map(
    ({ amountCents, jacobCents: _j, chelseaCents: _c, ...line }) => ({
      ...line,
      amount: dollars(amountCents),
    }),
  );
export const editableLines = (lines?: EntryLine[]) =>
  lines?.length === 1 &&
  lines[0].id === "main" &&
  !lines[0].label &&
  lines[0].splitMode === "inherit" &&
  !lines[0].originalLineId
    ? []
    : lineInputs(lines);
interface ChargeValue {
  amount: string;
  categoryId: string | null;
  splitMode: string;
  splitValue: string;
  lines?: LineInput[];
}
export default function ChargeLines({
  value,
  categories,
  change,
}: {
  value: ChargeValue;
  categories: Category[];
  change: (lines: LineInput[]) => void;
}) {
  const [preview, setPreview] = useState<EntryLine[] | null>(null),
    [error, setError] = useState("");
  const lines = value.lines ?? [];
  useEffect(() => {
    let alive = true;
    setPreview(null);
    setError("");
    if (value.lines?.length)
      command<EntryLine[]>("preview_lines", {
        amount: value.amount,
        mode: value.splitMode,
        value: value.splitValue,
        lines: value.lines,
      })
        .then((p) => {
          if (alive) setPreview(p);
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    return () => {
      alive = false;
    };
  }, [value.amount, value.splitMode, value.splitValue, value.lines]);
  function add() {
    change([
      ...lines,
      {
        id: crypto.randomUUID(),
        label: "",
        categoryId: value.categoryId ?? "uncategorized",
        amount: lines.length ? "" : value.amount,
        splitMode: "inherit",
        splitValue: "",
      },
    ]);
  }
  if (!lines.length)
    return (
      <button type="button" className="secondary" onClick={add}>
        Itemize categories & charges
      </button>
    );
  return (
    <section className="charge-lines" aria-label="Charge lines">
      <HelpHeading topic="chargeLines">
        <h3>Charge lines</h3>
      </HelpHeading>
      <p>
        Split the full amount into items with their own categories or sharing
        choices. Line amounts must add up to the full amount. Choose Use group
        split to use the purchase’s sharing choice; an exact shared amount
        applies to the inherited lines together.
      </p>
      {lines.map((l, i) => {
        const update = (patch: Partial<LineInput>) =>
          change(lines.map((v, n) => (n === i ? { ...v, ...patch } : v)));
        const calculated = preview?.find((p) => p.id === l.id);
        return (
          <fieldset
            key={l.id}
            className="charge-line"
            aria-label={`Charge ${i + 1}`}
          >
            <div className="form-grid">
              <label>
                Line description
                <input
                  maxLength={200}
                  value={l.label}
                  placeholder={`Charge ${i + 1}`}
                  onChange={(e) => update({ label: e.target.value })}
                />
              </label>
              <label>
                Line amount ($)
                <input
                  required
                  inputMode="decimal"
                  value={l.amount}
                  onChange={(e) => update({ amount: e.target.value })}
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Line category
                <select
                  value={l.categoryId}
                  onChange={(e) => update({ categoryId: e.target.value })}
                >
                  {categories
                    .filter((c) => !c.archived || c.id === l.categoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.archived ? " (archived)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Line sharing
                <select
                  value={l.splitMode}
                  onChange={(e) =>
                    update({ splitMode: e.target.value, splitValue: "" })
                  }
                >
                  <option value="inherit">Use group split</option>
                  <option value="personal">Jacob 100%</option>
                  <option value="chelsea">Chelsea 100%</option>
                  <option value="shared">Jacob 70% / Chelsea 30%</option>
                  <option value="equal">Equal 50 / 50</option>
                  <option value="percent">Custom Jacob percentage</option>
                  <option value="exact">Exact Jacob amount</option>
                </select>
              </label>
            </div>
            {["percent", "exact"].includes(l.splitMode) && (
              <label>
                {l.splitMode === "percent"
                  ? "Line Jacob percentage"
                  : "Line Jacob amount ($)"}
                <input
                  required
                  inputMode="decimal"
                  value={l.splitValue}
                  onChange={(e) => update({ splitValue: e.target.value })}
                />
              </label>
            )}
            <div className="charge-line-footer">
              <small>
                {calculated
                  ? `Jacob ${money(calculated.jacobCents)} · Chelsea ${money(calculated.chelseaCents)}`
                  : "Complete the amounts to preview shares"}
              </small>
              <button
                type="button"
                className="text-button"
                onClick={() => change(lines.filter((_, n) => n !== i))}
              >
                Remove line {i + 1}
              </button>
            </div>
          </fieldset>
        );
      })}
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      {preview && (
        <div className="dialog-notice">
          Group shares: Jacob{" "}
          <strong>
            {money(preview.reduce((a, l) => a + l.jacobCents, 0))}
          </strong>{" "}
          · Chelsea{" "}
          <strong>
            {money(preview.reduce((a, l) => a + l.chelseaCents, 0))}
          </strong>
        </div>
      )}
      <button
        type="button"
        className="secondary"
        disabled={lines.length >= 100}
        onClick={add}
      >
        Add charge line
      </button>
    </section>
  );
}
