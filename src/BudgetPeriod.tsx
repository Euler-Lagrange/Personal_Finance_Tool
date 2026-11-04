import { useState } from "react";
import { monthName } from "./api";
import type { EntryInput } from "./types";
import "./budgetPeriod.css";

export function guardPeriodClose(
  input: EntryInput,
  initial: EntryInput["budgetOverride"],
  close: () => void,
) {
  return () => {
    if (
      JSON.stringify(input.budgetOverride ?? null) !==
        JSON.stringify(initial ?? null) &&
      !window.confirm("Discard the unsaved budget-period choice?")
    )
      return;
    close();
  };
}
export default function BudgetPeriod({
  input,
  change,
  selectedMonth,
}: {
  input: EntryInput;
  change: (i: EntryInput) => void;
  selectedMonth: string;
}) {
  const [open, setOpen] = useState(!!input.budgetOverride?.month);
  const choice = input.budgetOverride;
  const enabled = choice?.month != null;
  const actual = input.date.slice(0, 7);
  return (
    <details
      className="budget-period"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        Budget period
        {enabled ? ` · ${choice?.month || "choose month"}` : " (optional)"}
      </summary>
      <p>
        Normally this entry uses its transaction month. For a late entry, you
        can reopen that month in Monthly budget or explicitly assign it to a
        later open budget month.
      </p>
      <label className="period-choice">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            change({
              ...input,
              budgetOverride: e.target.checked
                ? {
                    month: selectedMonth > actual ? selectedMonth : "",
                    reason: "",
                  }
                : { month: null, reason: "Return to the transaction month" },
            })
          }
        />
        <span>Use a different budget month</span>
      </label>
      {enabled && (
        <>
          <label>
            Budget month
            <input
              type="month"
              required
              min={actual || undefined}
              value={choice?.month ?? ""}
              onChange={(e) =>
                change({
                  ...input,
                  budgetOverride: {
                    month: e.target.value,
                    reason: choice?.reason ?? "",
                  },
                })
              }
            />
          </label>
          <label>
            Reason for budget override
            <textarea
              required
              maxLength={2000}
              value={choice?.reason ?? ""}
              onChange={(e) =>
                change({
                  ...input,
                  budgetOverride: {
                    month: choice?.month ?? "",
                    reason: e.target.value,
                  },
                })
              }
            />
          </label>
          <p className="period-explanation">
            Actual date remains <strong>{input.date || "unset"}</strong>.
            Budgets, annual totals and shared statements use{" "}
            <strong>
              {choice?.month ? monthName(choice.month) : "your chosen month"}
            </strong>
            . Account posting dates stay unchanged. Existing closed entries
            still require reopening before moving them.
          </p>
        </>
      )}
      {!enabled && choice && (
        <p>
          Saving returns this entry to its actual transaction month. That month
          must be open.
        </p>
      )}
    </details>
  );
}
