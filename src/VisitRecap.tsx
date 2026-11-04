import { useEffect, useRef } from "react";
import { money, monthName } from "./api";
import type { Snapshot } from "./types";
interface Visit {
  version: 1;
  at: string;
  spent: number;
  income: number;
  entries: number;
  imports: number;
}
export const visitKey = (data: Pick<Snapshot, "workspace" | "month">) =>
  `finance-last-visit:${data.workspace}:${data.month}`;
function read(key: string): Visit | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      !v ||
      v.version !== 1 ||
      typeof v.at !== "string" ||
      !Number.isFinite(Date.parse(v.at)) ||
      Date.parse(v.at) > Date.now() + 300000
    )
      return null;
    if (
      ![v.spent, v.income, v.entries, v.imports].every((n) =>
        Number.isSafeInteger(n),
      )
    )
      return null;
    if (
      v.entries < 0 ||
      v.imports < 0 ||
      Math.abs(v.spent) > 1e12 ||
      Math.abs(v.income) > 1e12
    )
      return null;
    return v;
  } catch {
    return null;
  }
}
// Keep the prior visit fixed throughout this window's session. Successful reads
// update the next visit's checkpoint even while another screen is selected.
export function useVisitBaseline(data: Snapshot | null): Visit | null {
  const baselines = useRef(new Map<string, Visit | null>());
  const key = data ? visitKey(data) : null;
  if (key && !baselines.current.has(key)) baselines.current.set(key, read(key));
  useEffect(() => {
    if (!data || !key) return;
    try {
      const v: Visit = {
        version: 1,
        at: new Date().toISOString(),
        spent: data.spentCents,
        income: data.incomeCents,
        entries: data.monthlyCount,
        imports: data.incompleteImports,
      };
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* A blocked preference store must not prevent offline finance work. */
    }
  }, [data, key]);
  return key ? (baselines.current.get(key) ?? null) : null;
}
export default function VisitRecap({
  data,
  baseline,
}: {
  data: Snapshot;
  baseline: Visit | null;
}) {
  if (!baseline) return null;
  const rows = [
    {
      label: "Personal spending",
      value: data.spentCents - baseline.spent,
      currency: true,
    },
    {
      label: "Recorded income",
      value: data.incomeCents - baseline.income,
      currency: true,
    },
    {
      label: "Recorded entries",
      value: data.monthlyCount - baseline.entries,
      currency: false,
    },
    {
      label: "Sources needing review",
      value: data.incompleteImports - baseline.imports,
      currency: false,
    },
  ].filter((r) => r.value !== 0);
  if (!rows.length) return null;
  return (
    <section
      className="panel visit-recap"
      aria-label="Changes since last visit"
    >
      <div>
        <h2>Since your last visit</h2>
        <p>
          {monthName(data.month)} · Compared with{" "}
          {new Date(baseline.at).toLocaleString()}
        </p>
      </div>
      <dl>
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd className="numeric">
              {r.value > 0 ? "+" : "−"}
              {r.currency
                ? money(Math.abs(r.value))
                : Math.abs(r.value).toLocaleString()}
            </dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Net changes on this computer. Corrections and refunds can reduce totals;
        this is not a list of individual changes.
      </p>
    </section>
  );
}
