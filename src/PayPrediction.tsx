import { useRef, useState, useEffect } from "react";
import { command } from "./api";
import { Modal } from "./EntryDialog";
import { HelpHeading } from "./HelpTip";
import { ModelSupport, payAmount } from "./PayVariations";
import { newTaxInputs, PayTaxFields, TaxResultDetails } from "./PayTax";
import type { PayView } from "./PayHours";
import type { PayPeriod, PayForecast, ForecastInput } from "./payTypes";

export default function PayPrediction({
  workspace,
  view,
  period,
  close,
  saved,
}: {
  workspace: string;
  view: PayView;
  period: PayPeriod;
  close: () => void;
  saved: () => void;
}) {
  const [input, setInput] = useState<ForecastInput>(() => ({
    id: crypto.randomUUID(),
    periodId: period.id,
    method: "manual",
    regime: "Standard",
    manualNet: "",
    reason: "",
    useUsual: false,
    extrapolate: false,
  }));
  const [result, setResult] = useState<PayForecast | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const request = useRef(0);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const update = (values: Partial<ForecastInput>) => {
    request.current++;
    setInput((p) => ({ ...p, ...values }));
    setResult(null);
    setDirty(true);
  };
  const leave = () => {
    if (
      !busy &&
      (!dirty || window.confirm("Discard the unsaved forecast draft?"))
    )
      close();
  };
  const forecasts = Object.values(view.state.forecasts ?? {})
    .filter((f) => f.input.periodId === period.id)
    .sort((a, b) => {
      const status = (id: string) =>
        view.forecastStatus?.find((s) => s.id === id)?.createdAt ?? "";
      return status(b.input.id).localeCompare(status(a.input.id));
    });
  async function preview() {
    const seq = ++request.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const f = await command<PayForecast>("preview_pay_forecast", {
        workspace,
        input,
      });
      if (seq === request.current) setResult(f);
    } catch (e) {
      if (seq === request.current) setError(String(e));
    } finally {
      if (seq === request.current) setBusy(false);
    }
  }
  async function save(change: unknown) {
    const signature = JSON.stringify(change);
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
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
      title={`Pay prediction · ${period.payDate}`}
      onClose={leave}
      busy={busy}
    >
      <div className="pay-form pay-prediction-dialog">
        <HelpHeading topic="payPredictions">
          <h3>{period.name}</h3>
        </HelpHeading>
        <p>
          Choose a method for this period. Saving retains the calculation and
          selects it for comparison; it does not create bank income.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error} Your draft is retained. An unchanged retry uses the same
            save request.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void preview();
          }}
        >
          <fieldset disabled={busy}>
            <div className="pay-form-grid">
              <label>
                Prediction method
                <select
                  value={input.method}
                  onChange={(e) =>
                    update({
                      method: e.target.value,
                      manualNet: e.target.value === "manual" ? "" : null,
                      extrapolate: false,
                      tax: ["tax", "calibrated"].includes(e.target.value)
                        ? (input.tax ?? newTaxInputs(period.payDate))
                        : undefined,
                    })
                  }
                >
                  <option value="manual">Manual take-home estimate</option>
                  <option value="known">Known-pay model</option>
                  <option value="tax">Offline withholding model</option>
                  <option value="calibrated">
                    Withholding with known-pay calibration
                  </option>
                </select>
              </label>
              <label>
                Payroll regime
                <input
                  required
                  maxLength={120}
                  value={input.regime}
                  onChange={(e) => update({ regime: e.target.value })}
                />
              </label>
              {input.method === "manual" && (
                <label>
                  Estimated take-home ($)
                  <input
                    type="number"
                    required
                    min="0"
                    max="100000000"
                    step="0.01"
                    value={input.manualNet ?? ""}
                    onChange={(e) => update({ manualNet: e.target.value })}
                  />
                </label>
              )}
            </div>
            <label>
              Reason / assumptions
              <textarea
                required
                maxLength={2000}
                value={input.reason}
                onChange={(e) => update({ reason: e.target.value })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={input.useUsual}
                onChange={(e) => update({ useUsual: e.target.checked })}
              />
              Assume usual hours for missing days, excluding known holidays
            </label>
            {input.method === "known" && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={input.extrapolate}
                  onChange={(e) => update({ extrapolate: e.target.checked })}
                />
                Allow extrapolation outside the known range
              </label>
            )}
            {input.tax && (
              <PayTaxFields
                view={view}
                input={input.tax}
                payDate={period.payDate}
                benefits={period.benefits}
                calibrated={input.method === "calibrated"}
                change={(tax) =>
                  update({
                    tax,
                    regime:
                      view.state.taxProfiles?.[tax.profileId]?.regime ??
                      input.regime,
                  })
                }
              />
            )}
            <p className="pay-footnote">
              Recorded actual hours replace plans. This period uses{" "}
              {period.frequency} withholding and{" "}
              {period.benefits
                ? "normal benefits deductions"
                : "a benefits deduction holiday"}
              . Change these on the calendar if needed.
            </p>
          </fieldset>
          <button className="secondary" disabled={busy}>
            {busy ? "Working…" : "Preview prediction"}
          </button>
        </form>
        {result && (
          <div
            className="pay-prediction-result"
            role="region"
            aria-label="Prediction preview"
          >
            <div className="pay-summary">
              <div>
                <span>Paid hours</span>
                <strong>{result.basis.paidHours / 10000}</strong>
              </div>
              <div>
                <span>Gross estimate</span>
                <strong>{payAmount(result.basis.grossCents)}</strong>
              </div>
              <div>
                <span>Take-home estimate</span>
                <strong>{payAmount(result.netCents)}</strong>
              </div>
            </div>
            <ul>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            {result.empirical && <ModelSupport model={result.empirical} />}
            {result.tax && <TaxResultDetails value={result.tax} />}
            <button
              className="primary"
              disabled={busy || result.netCents === null}
              onClick={() => void save({ kind: "forecast", input })}
            >
              Save and select prediction
            </button>
          </div>
        )}
        <section className="pay-prediction-history">
          <h3>Saved prediction history</h3>
          <p>
            Earlier versions retain their original inputs. “Inputs changed”
            means a new calculation may differ; the saved amount stays fixed.
          </p>
          {forecasts.length === 0 && (
            <p>No saved predictions for this period.</p>
          )}
          {forecasts.map((f) => {
            const s = view.forecastStatus?.find((s) => s.id === f.input.id);
            const selected =
              view.state.selectedForecasts?.[period.id] === f.input.id;
            return (
              <details key={f.input.id}>
                <summary>
                  {payAmount(f.netCents)} · {f.input.method} ·{" "}
                  {selected ? "Selected" : "Earlier version"}
                  {s?.stale ? " · Inputs changed" : ""}
                </summary>
                <p>
                  Saved {s?.createdAt ?? "time unavailable"}. {f.input.reason}
                </p>
                <p>
                  Original gross {payAmount(f.basis.grossCents)} ·{" "}
                  {f.basis.paidHours / 10000} paid hours · known actual net{" "}
                  {payAmount(s?.actualNetCents)} · actual minus prediction{" "}
                  {payAmount(s?.actualMinusForecastCents)}
                </p>
                <ul>
                  {f.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                {f.empirical && <ModelSupport model={f.empirical} />}
                {f.tax && <TaxResultDetails value={f.tax} />}
                <details>
                  <summary>Retained daily inputs</summary>
                  <div className="pay-table-scroll">
                    <table className="pay-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Work / sick hours</th>
                          <th>Rate</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.basis.days.map((d) => (
                          <tr key={d.date}>
                            <td>{d.date}</td>
                            <td>
                              {(d.hours.worked ?? d.hours.planned) / 10000} /{" "}
                              {d.hours.worked === null
                                ? d.hours.plannedSick
                                : d.hours.sick}
                            </td>
                            <td>
                              {d.rate === null
                                ? "Missing"
                                : `$${d.rate / 10000}`}
                            </td>
                            <td>
                              {d.assumed
                                ? "Usual week assumed"
                                : d.hours.worked === null
                                  ? "Plan"
                                  : "Actual"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void save({
                      kind: "selectForecast",
                      periodId: period.id,
                      id: selected ? null : f.input.id,
                    })
                  }
                >
                  {selected
                    ? "Clear selection"
                    : "Select this saved prediction"}
                </button>
              </details>
            );
          })}
        </section>
        <div className="pay-actions">
          <button className="secondary" disabled={busy} onClick={leave}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
