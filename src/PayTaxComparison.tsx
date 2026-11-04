import { useEffect, useRef, useState } from "react";
import { command, money } from "./api";
import { Modal } from "./EntryDialog";
import { HelpHeading } from "./HelpTip";
import { newTaxInputs, PayTaxFields, TaxBreakdown } from "./PayTax";
import type { PayView } from "./PayHours";
import type { PayObservation } from "./payTypes";
import type { TaxCalibration } from "./payTaxTypes";

export default function PayTaxComparison({
  workspace,
  view,
  observation,
  close,
  saved,
}: {
  workspace: string;
  view: PayView;
  observation: PayObservation;
  close: () => void;
  saved: () => void;
}) {
  const retained = view.state.calibrations?.[observation.id];
  const [input, setInput] = useState(() =>
    retained
      ? structuredClone(retained.estimate.inputs)
      : newTaxInputs(observation.payDate),
  );
  const [id] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<TaxCalibration | null>(null);
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
  const leave = () => {
    if (
      !busy &&
      (!dirty || window.confirm("Discard the unsaved withholding comparison?"))
    )
      close();
  };
  async function preview() {
    const seq = ++request.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const v = await command<TaxCalibration>("preview_pay_calibration", {
        workspace,
        id,
        observationId: observation.id,
        input,
      });
      if (seq === request.current) setResult(v);
    } catch (e) {
      if (seq === request.current) setError(String(e));
    } finally {
      if (seq === request.current) setBusy(false);
    }
  }
  async function save(remove = false) {
    const change = remove
      ? { kind: "removeCalibration", observationId: observation.id }
      : { kind: "calibration", id, observationId: observation.id, input };
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
      title={`Withholding comparison · ${observation.payDate}`}
      onClose={leave}
      busy={busy}
    >
      <div className="pay-form">
        <HelpHeading topic="payCalibration">
          <h3>Compare known pay with the tax model</h3>
        </HelpHeading>
        <p>
          Actual net:{" "}
          {observation.netCents === null
            ? "Unknown"
            : money(observation.netCents)}{" "}
          · {observation.regime}. Enter the historical elections and YTD context
          that applied to this paycheck. A saved comparison can support later
          calibrated predictions; it does not change this fact or add income.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error} Your draft is retained.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void preview();
          }}
        >
          <fieldset disabled={busy}>
            <PayTaxFields
              view={view}
              input={input}
              payDate={observation.payDate}
              benefits={observation.benefits}
              comparison
              change={(v) => {
                request.current++;
                setInput(v);
                setResult(null);
                setDirty(true);
              }}
            />
          </fieldset>
          <button className="secondary" disabled={busy}>
            {busy ? "Working…" : "Preview withholding comparison"}
          </button>
        </form>
        {result && (
          <section role="region" aria-label="Withholding comparison preview">
            <TaxBreakdown value={result.estimate} />
            <p>
              Actual minus modeled net:{" "}
              {result.observation.netCents !== null &&
              result.estimate.netCents !== null
                ? money(result.observation.netCents - result.estimate.netCents)
                : "Unavailable"}
            </p>
            <button
              className="primary"
              disabled={busy || result.estimate.netCents === null}
              onClick={() => void save()}
            >
              Save withholding comparison
            </button>
          </section>
        )}
        {retained && (
          <details>
            <summary>
              Retained comparison ·{" "}
              {view.calibrationCurrent?.[observation.id]
                ? "Current inputs"
                : "Inputs changed; excluded from calibration"}
            </summary>
            <TaxBreakdown value={retained.estimate} />
            <p>
              Retained actual net:{" "}
              {retained.observation.netCents === null
                ? "Unknown"
                : money(retained.observation.netCents)}
              . Updating replaces the active comparison; earlier versions remain
              in payroll history.
            </p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Remove this comparison from future calibration? Prior history and saved predictions remain.",
                  )
                )
                  void save(true);
              }}
            >
              Remove comparison
            </button>
          </details>
        )}
        <div className="pay-actions">
          <button className="secondary" disabled={busy} onClick={leave}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
