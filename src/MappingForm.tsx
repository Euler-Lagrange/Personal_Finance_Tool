import { useEffect, useRef, useState } from "react";
import { command } from "./api";
import type { ImportDetail, ImportMapping } from "./importTypes";
import type { Snapshot } from "./types";
export default function MappingForm({
  detail,
  data,
  busy,
  dirty,
  configure,
  suggestion,
  buttonLabel = "Apply mapping",
}: {
  detail: ImportDetail;
  data: Snapshot;
  busy: boolean;
  dirty: () => void;
  suggestion?: ImportMapping;
  buttonLabel?: string;
  configure: (account: string, mapping: ImportMapping) => Promise<void>;
}) {
  const [mapping, setMapping] = useState(suggestion ?? detail.mapping),
    [account, setAccount] = useState(
      detail.source.accountId ?? detail.observation?.suggestedAccountId ?? "",
    ),
    [profileError, setProfileError] = useState("");
  const version = useRef(0);
  useEffect(
    () => () => {
      ++version.current;
    },
    [],
  );
  const frozen = detail.rows.some((r) => r.disposition !== "pending");
  async function choose(value: string) {
    setAccount(value);
    const token = ++version.current;
    setProfileError("");
    if (!value || suggestion) return;
    try {
      const profile = await command<ImportMapping | null>("import_profile", {
        workspace: data.workspace,
        id: detail.source.id,
        account: value,
      });
      if (token === version.current) setMapping(profile ?? detail.mapping);
    } catch (e) {
      if (token === version.current) setProfileError(String(e));
    }
  }
  const column = (key: keyof ImportMapping, label: string) => (
    <label>
      {label}
      <select
        value={mapping[key] == null ? "" : String(mapping[key])}
        onChange={(e) => {
          ++version.current;
          setMapping((m) => ({
            ...m,
            [key]: e.target.value === "" ? null : Number(e.target.value),
            ...(key === "stableIdColumn" ? { stableIdsConfirmed: false } : {}),
          }));
        }}
      >
        <option value="">Choose column</option>
        {detail.dataset.headers.map((h, i) => (
          <option key={i} value={i}>
            {i + 1}. {h}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <details
      className="mapping"
      open={!!suggestion || !detail.source.accountId}
    >
      <summary>
        Account & column mapping{" "}
        {frozen ? "· locked after processing" : "· verify before review"}
      </summary>
      <fieldset
        disabled={busy || frozen}
        onChangeCapture={() => {
          ++version.current;
          dirty();
        }}
      >
        <div className="mapping-grid">
          <label>
            Account for this source
            <select
              value={account}
              onChange={(e) => void choose(e.target.value)}
            >
              <option value="">Choose account</option>
              {data.accounts
                .filter((a) => !a.archived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          {column("dateColumn", "Spending date column")}
          {column("descriptionColumn", "Description column")}
          <label>
            Amount convention
            <select
              value={mapping.amountMode}
              onChange={(e) =>
                setMapping((m) => ({ ...m, amountMode: e.target.value }))
              }
            >
              <option value="">Confirm how amounts work</option>
              <option value="outflow_positive">
                Positive = purchase / debit / out
              </option>
              <option value="inflow_positive">
                Positive = deposit / credit / in
              </option>
              <option value="separate">
                Separate debit and credit columns
              </option>
            </select>
          </label>
          {mapping.amountMode === "separate" ? (
            <>
              {column("debitColumn", "Debit / out column")}
              {column("creditColumn", "Credit / in column")}
            </>
          ) : (
            column("amountColumn", "Transaction amount (not balance)")
          )}
          <label>
            Date format
            <select
              value={mapping.dateFormat}
              onChange={(e) =>
                setMapping((m) => ({ ...m, dateFormat: e.target.value }))
              }
            >
              <option value="month_first">Month / day / year</option>
              <option value="day_first">Day / month / year</option>
              <option value="iso">Year-month-day</option>
            </select>
          </label>
          <label>
            Year if missing from source
            <input
              type="number"
              min="1900"
              max="2100"
              placeholder="Only if confirmed"
              value={mapping.year ?? ""}
              onChange={(e) =>
                setMapping((m) => ({
                  ...m,
                  year: e.target.value ? Number(e.target.value) : null,
                }))
              }
            />
          </label>
          {column("statusColumn", "Status column (optional)")}
          {column("typeColumn", "Transaction type (optional)")}
          {column("postedDateColumn", "Posted date column (optional)")}
          {column("stableIdColumn", "Stable source ID column (optional)")}
          {column(
            "currencyColumn",
            "Currency column (optional; otherwise USD)",
          )}
        </div>
        <label className="import-check">
          <input
            type="checkbox"
            checked={mapping.stableIdsConfirmed ?? false}
            disabled={mapping.stableIdColumn == null}
            onChange={(e) =>
              setMapping((m) => ({
                ...m,
                stableIdsConfirmed: e.target.checked,
              }))
            }
          />
          This ID uniquely identifies a transaction in this account across
          downloads. It is not a row number or card number.
        </label>
        <label className="import-check">
          <input
            type="checkbox"
            checked={mapping.postedConfirmed}
            onChange={(e) =>
              setMapping((m) => ({ ...m, postedConfirmed: e.target.checked }))
            }
          />{" "}
          I confirm rows without a status are posted, not pending.
        </label>
        <p className="form-intro">
          Check the raw sample below. Dates, signs, and the amount column vary
          between banks. Explicitly pending rows stay on hold. This import is
          partial coverage until you separately confirm its actual download
          range; it never removes missing transactions. Only USD is supported.
        </p>
        <div className="raw-sample">
          <table>
            <thead>
              <tr>
                {detail.dataset.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.dataset.rows.slice(0, 3).map((row, i) => (
                <tr key={i}>
                  {row.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {profileError && <p className="error">{profileError}</p>}
        <button
          className="primary"
          disabled={!account}
          onClick={() => void configure(account, mapping)}
        >
          {buttonLabel}
        </button>
      </fieldset>
    </details>
  );
}
