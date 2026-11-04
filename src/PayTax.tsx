import { useRef, useState } from "react";
import { command, money } from "./api";
import { Modal } from "./EntryDialog";
import { HelpHeading } from "./HelpTip";
import type { PayView } from "./PayHours";
import type {
  TaxProfile,
  TaxDeduction,
  TaxMask,
  TaxInputs,
  TaxEstimate,
  TaxResult,
} from "./payTaxTypes";
const labels: Record<keyof TaxMask, string> = {
  federal: "Federal",
  kentucky: "Kentucky",
  socialSecurity: "Social Security",
  medicare: "Medicare",
  local: "Local",
};
export const taxMask = (value: boolean): TaxMask => ({
  federal: value,
  kentucky: value,
  socialSecurity: value,
  medicare: value,
  local: value,
});
const newDeduction = (): TaxDeduction => ({
  id: crypto.randomUUID(),
  name: "",
  method: "fixed",
  amount: "0",
  percentBase: "hourlyGross",
  benefitsOnly: true,
  onPayDate: null,
  annualCap: null,
  reduces: taxMask(false),
});
export const newTaxInputs = (payDate: string, profileId = ""): TaxInputs => ({
  profileId,
  ytdDate: payDate,
  ytdConfirmed: false,
  socialSecurityYtd: null,
  medicareYtd: null,
  deductionYtd: {},
  localWageYtd: {},
  localTaxYtd: {},
  otherPay: [],
  oneTimeDeductions: [],
  deductionOverrides: {},
  calibrationLimit: "250",
});
export function TaxAmount({
  label,
  value,
  change,
  optional = false,
  percent = false,
}: {
  label: string;
  value: string | null;
  change: (v: string) => void;
  optional?: boolean;
  percent?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max={percent ? 100 : 100000000}
        step={percent ? "0.0001" : "0.01"}
        required={!optional}
        value={value ?? ""}
        onChange={(e) => change(e.target.value)}
      />
    </label>
  );
}
export function TaxCheck({
  label,
  value,
  change,
}: {
  label: string;
  value: boolean;
  change: (v: boolean) => void;
}) {
  return (
    <label className="checkbox-label">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => change(e.target.checked)}
      />
      {label}
    </label>
  );
}
function Masks({
  value,
  change,
  verb,
}: {
  value: TaxMask;
  change: (v: TaxMask) => void;
  verb: string;
}) {
  return (
    <div className="pay-tax-masks">
      <p>{verb}</p>
      {(Object.keys(labels) as (keyof TaxMask)[]).map((k) => (
        <TaxCheck
          key={k}
          label={labels[k]}
          value={value[k]}
          change={(v) => change({ ...value, [k]: v })}
        />
      ))}
    </div>
  );
}
function DeductionEditor({
  value,
  change,
  remove,
  oneTime = false,
}: {
  value: TaxDeduction;
  change: (v: TaxDeduction) => void;
  remove: () => void;
  oneTime?: boolean;
}) {
  const update = (v: Partial<TaxDeduction>) => change({ ...value, ...v });
  return (
    <section className="pay-tax-rule">
      <div className="pay-form-grid">
        <label>
          Deduction name
          <input
            required
            maxLength={120}
            value={value.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>
        <label>
          Amount method
          <select
            value={value.method}
            onChange={(e) => update({ method: e.target.value })}
          >
            <option value="fixed">Fixed dollars</option>
            <option value="percent">Percentage</option>
          </select>
        </label>
        <TaxAmount
          label={
            value.method === "fixed"
              ? "Deduction amount ($)"
              : "Deduction percentage"
          }
          percent={value.method === "percent"}
          value={value.amount}
          change={(amount) => update({ amount })}
        />
        {value.method === "percent" && (
          <label>
            Percentage base
            <select
              value={value.percentBase}
              onChange={(e) => update({ percentBase: e.target.value })}
            >
              <option value="hourlyGross">Hourly gross only</option>
              <option value="cashGross">
                All cash gross, including cash additions
              </option>
            </select>
          </label>
        )}
        {!oneTime && (
          <>
            <TaxAmount
              label="Annual deduction cap ($), optional"
              optional
              value={value.annualCap}
              change={(annualCap) => update({ annualCap: annualCap || null })}
            />
            <label>
              Only this pay date, optional
              <input
                type="date"
                min="1900-01-01"
                max="2100-12-31"
                value={value.onPayDate ?? ""}
                onChange={(e) => update({ onPayDate: e.target.value || null })}
              />
            </label>
          </>
        )}
      </div>
      <TaxCheck
        label="Skip on a benefits deduction holiday"
        value={value.benefitsOnly}
        change={(benefitsOnly) => update({ benefitsOnly })}
      />
      <Masks
        value={value.reduces}
        change={(reduces) => update({ reduces })}
        verb="Reduces these taxable wage bases (choose from payroll treatment)"
      />
      <button type="button" className="text-button" onClick={remove}>
        Remove deduction
      </button>
    </section>
  );
}
function newProfile(year: number): TaxProfile {
  return {
    id: crypto.randomUUID(),
    name: "",
    year,
    effectiveDate: `${year}-01-01`,
    regime: "Standard",
    reviewed: false,
    ordinaryResidentW2: false,
    federal: {
      status: "",
      stepTwo: false,
      credits: "0",
      otherIncome: "0",
      deductions: "0",
      extra: "0",
      exempt: false,
      roundDollars: false,
    },
    kentuckyExempt: false,
    kentuckyExtra: "0",
    localsReviewed: false,
    deductions: [],
    locals: [],
    note: "",
  };
}
export default function PayTaxSettings({
  workspace,
  view,
  year,
  changed,
}: {
  workspace: string;
  view: PayView;
  year: number;
  changed: () => void;
}) {
  const [edit, setEdit] = useState<TaxProfile | null>(null);
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <HelpHeading topic="payTax">
              <h2>Withholding profiles</h2>
            </HelpHeading>
            <p>
              Year-specific payroll elections and deductions. Verified offline
              rules: 2026 federal and Kentucky; local taxes use your configured
              rates.
            </p>
          </div>
          <button className="primary" onClick={() => setEdit(newProfile(year))}>
            Add withholding profile
          </button>
        </div>
        <div className="pay-holidays">
          {Object.values(view.state.taxProfiles ?? {})
            .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
            .map((p) => (
              <div key={p.id}>
                <time>{p.effectiveDate}</time>
                <strong>
                  {p.name}
                  <small>
                    {p.regime} · {p.reviewed ? "Reviewed" : "Needs review"}
                    {p.year !== 2026 ? " · Tax rules unavailable" : ""}
                  </small>
                </strong>
                <button
                  className="text-button"
                  onClick={() => setEdit(structuredClone(p))}
                >
                  Edit profile
                </button>
              </div>
            ))}
          {!Object.keys(view.state.taxProfiles ?? {}).length && (
            <p>
              No tax elections assumed. Add a profile from your payroll setup
              when ready; manual and known-pay predictions work without one.
            </p>
          )}
        </div>
      </section>
      {edit && (
        <ProfileEditor
          key={edit.id}
          workspace={workspace}
          view={view}
          initial={edit}
          close={() => setEdit(null)}
          saved={() => {
            setEdit(null);
            changed();
          }}
        />
      )}
    </>
  );
}
function ProfileEditor({
  workspace,
  view,
  initial,
  close,
  saved,
}: {
  workspace: string;
  view: PayView;
  initial: TaxProfile;
  close: () => void;
  saved: () => void;
}) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const update = (v: Partial<TaxProfile>) => {
    setP((p) => ({ ...p, reviewed: false, ...v }));
    setDirty(true);
  };
  const leave = () => {
    if (
      !busy &&
      (!dirty || window.confirm("Discard unsaved withholding profile edits?"))
    )
      close();
  };
  async function save(remove = false) {
    const change = remove
      ? { kind: "removeTaxProfile", id: p.id }
      : { kind: "taxProfile", profile: p };
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
    <Modal title="Withholding profile" onClose={leave} busy={busy}>
      <form
        className="pay-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && (
          <p role="alert" className="form-error">
            {error} Your draft is retained.
          </p>
        )}
        <fieldset disabled={busy}>
          <HelpHeading topic="payTax">
            <h3>Payroll setup</h3>
          </HelpHeading>
          <div className="pay-form-grid">
            <label>
              Profile name
              <input
                required
                maxLength={120}
                value={p.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              Payroll regime
              <input
                required
                maxLength={120}
                value={p.regime}
                onChange={(e) => update({ regime: e.target.value })}
              />
            </label>
            <label>
              Tax year
              <input
                type="number"
                min="1900"
                max="2100"
                required
                value={p.year}
                onChange={(e) => update({ year: Number(e.target.value) })}
              />
            </label>
            <label>
              Effective pay date
              <input
                type="date"
                min={`${p.year}-01-01`}
                max={`${p.year}-12-31`}
                required
                value={p.effectiveDate}
                onChange={(e) => update({ effectiveDate: e.target.value })}
              />
            </label>
          </div>
          <TaxCheck
            label="Ordinary US-resident W-2 wages with a 2020-or-later W-4 and standard employee FICA"
            value={p.ordinaryResidentW2}
            change={(ordinaryResidentW2) => update({ ordinaryResidentW2 })}
          />
          <p>
            Unsupported years, older W-4 forms, nonresident adjustments and
            special payroll treatments need a manual estimate. Rate changes
            belong in Hourly rate history.
          </p>
          <details open>
            <summary>Federal W-4 elections</summary>
            <div className="pay-form-grid">
              <label>
                W-4 filing status
                <select
                  required
                  value={p.federal.status}
                  onChange={(e) =>
                    update({
                      federal: { ...p.federal, status: e.target.value },
                    })
                  }
                >
                  <option value="">Choose from your W-4</option>
                  <option value="single">
                    Single / married filing separately
                  </option>
                  <option value="married">Married filing jointly</option>
                  <option value="head">Head of household</option>
                </select>
              </label>
              {(
                [
                  ["credits", "Step 3 annual credits ($)"],
                  ["otherIncome", "Step 4(a) annual other income ($)"],
                  ["deductions", "Step 4(b) annual deductions ($)"],
                  ["extra", "Step 4(c) extra per paycheck ($)"],
                ] as const
              ).map(([key, label]) => (
                <TaxAmount
                  key={key}
                  label={label}
                  value={p.federal[key]}
                  change={(v) =>
                    update({ federal: { ...p.federal, [key]: v } })
                  }
                />
              ))}
            </div>
            <TaxCheck
              label="W-4 Step 2 checkbox is checked"
              value={p.federal.stepTwo}
              change={(stepTwo) =>
                update({ federal: { ...p.federal, stepTwo } })
              }
            />
            <TaxCheck
              label="Exempt from federal income-tax withholding"
              value={p.federal.exempt}
              change={(exempt) => update({ federal: { ...p.federal, exempt } })}
            />
            <TaxCheck
              label="Employer rounds final federal withholding to whole dollars"
              value={p.federal.roundDollars}
              change={(roundDollars) =>
                update({ federal: { ...p.federal, roundDollars } })
              }
            />
          </details>
          <details>
            <summary>Kentucky and local withholding</summary>
            <TaxAmount
              label="Extra Kentucky withholding per paycheck ($)"
              value={p.kentuckyExtra}
              change={(kentuckyExtra) => update({ kentuckyExtra })}
            />
            <TaxCheck
              label="Exempt from Kentucky withholding"
              value={p.kentuckyExempt}
              change={(kentuckyExempt) => update({ kentuckyExempt })}
            />
            <p>
              2026 Kentucky uses its $3,360 annual standard deduction and 3.5%
              rate. Enter local rules from your payroll records; no city or
              county is inferred.
            </p>
            {p.locals.map((l, index) => {
              const local = (v: Partial<typeof l>) =>
                update({
                  localsReviewed: false,
                  locals: p.locals.map((x, j) =>
                    j === index ? { ...x, ...v } : x,
                  ),
                });
              return (
                <section className="pay-tax-rule" key={l.id}>
                  <label>
                    Local tax name
                    <input
                      required
                      maxLength={120}
                      value={l.name}
                      onChange={(e) => local({ name: e.target.value })}
                    />
                  </label>
                  <div className="pay-form-grid">
                    <TaxAmount
                      label="Local percentage"
                      percent
                      value={l.percent}
                      change={(percent) => local({ percent })}
                    />
                    <TaxAmount
                      label="Local fixed amount per paycheck ($)"
                      value={l.perPay}
                      change={(perPay) => local({ perPay })}
                    />
                    <TaxAmount
                      label="Annual local taxable-wage cap ($), optional"
                      optional
                      value={l.wageCap}
                      change={(wageCap) => local({ wageCap: wageCap || null })}
                    />
                    <TaxAmount
                      label="Annual local tax cap ($), optional"
                      optional
                      value={l.taxCap}
                      change={(taxCap) => local({ taxCap: taxCap || null })}
                    />
                  </div>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      update({
                        localsReviewed: false,
                        locals: p.locals.filter((_, j) => j !== index),
                      })
                    }
                  >
                    Remove local tax
                  </button>
                </section>
              );
            })}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                update({
                  localsReviewed: false,
                  locals: [
                    ...p.locals,
                    {
                      id: crypto.randomUUID(),
                      name: "",
                      percent: "0",
                      perPay: "0",
                      wageCap: null,
                      taxCap: null,
                    },
                  ],
                })
              }
            >
              Add local tax
            </button>
            <TaxCheck
              label="I reviewed local withholding, including if no local tax applies"
              value={p.localsReviewed}
              change={(localsReviewed) => update({ localsReviewed })}
            />
          </details>
          <details>
            <summary>
              Benefits and other deductions ({p.deductions.length})
            </summary>
            <p>
              These reduce cash pay. Choose each tax treatment independently; a
              retirement contribution need not reduce FICA wages.
            </p>
            {p.deductions.map((d, index) => (
              <DeductionEditor
                key={d.id}
                value={d}
                change={(value) =>
                  update({
                    deductions: p.deductions.map((x, j) =>
                      j === index ? value : x,
                    ),
                  })
                }
                remove={() =>
                  update({
                    deductions: p.deductions.filter((_, j) => j !== index),
                  })
                }
              />
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                update({ deductions: [...p.deductions, newDeduction()] })
              }
            >
              Add deduction rule
            </button>
          </details>
          <label>
            Profile notes
            <textarea
              maxLength={2000}
              value={p.note}
              onChange={(e) => update({ note: e.target.value })}
            />
          </label>
          <TaxCheck
            label="I reviewed this profile against my payroll elections and deduction rules"
            value={p.reviewed}
            change={(reviewed) => update({ reviewed })}
          />
        </fieldset>
        <div className="pay-actions">
          {view.state.taxProfiles?.[p.id] && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Remove this current profile? Retained predictions and prior profile history remain available.",
                  )
                )
                  void save(true);
              }}
            >
              Remove profile
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={leave}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save withholding profile"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PayTaxFields({
  view,
  input,
  change,
  payDate,
  benefits,
  calibrated = false,
  comparison = false,
}: {
  view: PayView;
  input: TaxInputs;
  change: (v: TaxInputs) => void;
  payDate: string;
  benefits: boolean;
  calibrated?: boolean;
  comparison?: boolean;
}) {
  const p = view.state.taxProfiles?.[input.profileId];
  const update = (v: Partial<TaxInputs>) => change({ ...input, ...v });
  const rules = (p?.deductions ?? []).filter(
    (d) =>
      (!d.benefitsOnly || benefits) &&
      (!d.onPayDate || d.onPayDate === payDate),
  );
  return (
    <div className="pay-tax-inputs">
      <HelpHeading topic="payYtd">
        <h3>
          {comparison
            ? "Historical withholding context"
            : "Withholding inputs for this paycheck"}
        </h3>
      </HelpHeading>
      <label htmlFor="pay-withholding-profile">Withholding profile</label>
      <select
        id="pay-withholding-profile"
        required
        value={input.profileId}
        onChange={(e) => change(newTaxInputs(payDate, e.target.value))}
      >
        <option value="">Choose a reviewed profile</option>
        {Object.values(view.state.taxProfiles ?? {}).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.year} · {p.regime}
            {p.reviewed ? "" : " · Needs review"}
          </option>
        ))}
      </select>
      {p && (
        <>
          <p>
            {p.name} takes effect {p.effectiveDate}. These inputs apply only to
            this payment; they do not update account balances.
          </p>
          <div className="pay-form-grid">
            <label>
              YTD context date
              <input
                type="date"
                min={`${payDate.slice(0, 4)}-01-01`}
                max={payDate}
                required
                value={input.ytdDate}
                onChange={(e) =>
                  update({ ytdDate: e.target.value, ytdConfirmed: false })
                }
              />
            </label>
            <TaxAmount
              label="SS taxable wages before this payment ($)"
              optional
              value={input.socialSecurityYtd}
              change={(socialSecurityYtd) =>
                update({
                  socialSecurityYtd: socialSecurityYtd || null,
                  ytdConfirmed: false,
                })
              }
            />
            <TaxAmount
              label="Medicare taxable wages before this payment ($)"
              optional
              value={input.medicareYtd}
              change={(medicareYtd) =>
                update({
                  medicareYtd: medicareYtd || null,
                  ytdConfirmed: false,
                })
              }
            />
          </div>
          <p>
            Use this employer’s year-to-date taxable wages immediately before
            the selected payment. For a future prediction, include expected
            intervening pay. Enter zero explicitly when confirmed; blank remains
            unknown.
          </p>
          {rules
            .filter((d) => d.annualCap !== null)
            .map((d) => (
              <TaxAmount
                key={d.id}
                label={`${d.name}: prior deduction YTD ($)`}
                optional
                value={input.deductionYtd[d.id] ?? null}
                change={(v) => {
                  const next = { ...input.deductionYtd };
                  if (v) next[d.id] = v;
                  else delete next[d.id];
                  update({ deductionYtd: next, ytdConfirmed: false });
                }}
              />
            ))}
          {p.locals.map((l) => (
            <div key={l.id}>
              {l.wageCap !== null && (
                <TaxAmount
                  label={`${l.name}: prior taxable wages ($)`}
                  optional
                  value={input.localWageYtd[l.id] ?? null}
                  change={(v) => {
                    const next = { ...input.localWageYtd };
                    if (v) next[l.id] = v;
                    else delete next[l.id];
                    update({ localWageYtd: next, ytdConfirmed: false });
                  }}
                />
              )}
              {l.taxCap !== null && (
                <TaxAmount
                  label={`${l.name}: prior local withholding ($)`}
                  optional
                  value={input.localTaxYtd[l.id] ?? null}
                  change={(v) => {
                    const next = { ...input.localTaxYtd };
                    if (v) next[l.id] = v;
                    else delete next[l.id];
                    update({ localTaxYtd: next, ytdConfirmed: false });
                  }}
                />
              )}
            </div>
          ))}
          <TaxCheck
            label="I confirmed all YTD values are for this employer, this paid year, immediately before this payment"
            value={input.ytdConfirmed}
            change={(ytdConfirmed) => update({ ytdConfirmed })}
          />
          <details>
            <summary>Per-paycheck deduction overrides</summary>
            <p>
              Blank uses the profile rule. A value replaces its amount for this
              payment, still respecting any annual cap and benefit holiday.
            </p>
            {rules.map((d) => (
              <TaxAmount
                key={d.id}
                label={`${d.name}: override amount ($)`}
                optional
                value={input.deductionOverrides[d.id] ?? null}
                change={(v) => {
                  const next = { ...input.deductionOverrides };
                  if (v) next[d.id] = v;
                  else delete next[d.id];
                  update({ deductionOverrides: next });
                }}
              />
            ))}
          </details>
          {!comparison && (
            <details>
              <summary>
                Other pay, reimbursements and one-time deductions
              </summary>
              {input.otherPay.map((o, index) => {
                const other = (v: Partial<typeof o>) =>
                  update({
                    otherPay: input.otherPay.map((x, j) =>
                      j === index ? { ...x, ...v } : x,
                    ),
                  });
                return (
                  <section className="pay-tax-rule" key={index}>
                    <label>
                      Other pay name
                      <input
                        required
                        maxLength={120}
                        value={o.name}
                        onChange={(e) => other({ name: e.target.value })}
                      />
                    </label>
                    <TaxAmount
                      label="Other pay amount ($)"
                      value={o.amount}
                      change={(amount) => other({ amount })}
                    />
                    <TaxCheck
                      label="Paid as cash (uncheck for a noncash benefit)"
                      value={o.cash}
                      change={(cash) => other({ cash })}
                    />
                    <Masks
                      value={o.taxable}
                      change={(taxable) => other({ taxable })}
                      verb="Included in these taxable wage bases"
                    />
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        update({
                          otherPay: input.otherPay.filter(
                            (_, j) => j !== index,
                          ),
                        })
                      }
                    >
                      Remove other pay
                    </button>
                  </section>
                );
              })}
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  update({
                    otherPay: [
                      ...input.otherPay,
                      {
                        name: "",
                        amount: "0",
                        cash: true,
                        taxable: taxMask(false),
                      },
                    ],
                  })
                }
              >
                Add other pay
              </button>
              <p>
                Review tax treatment for reimbursements and fringe benefits.
                Ordinary taxable additions need their applicable bases checked.
              </p>
              {input.oneTimeDeductions.map((d, index) => (
                <DeductionEditor
                  key={d.id}
                  value={d}
                  oneTime
                  change={(value) =>
                    update({
                      oneTimeDeductions: input.oneTimeDeductions.map((x, j) =>
                        j === index ? value : x,
                      ),
                    })
                  }
                  remove={() =>
                    update({
                      oneTimeDeductions: input.oneTimeDeductions.filter(
                        (_, j) => j !== index,
                      ),
                    })
                  }
                />
              ))}
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  update({
                    oneTimeDeductions: [
                      ...input.oneTimeDeductions,
                      {
                        ...newDeduction(),
                        benefitsOnly: false,
                        onPayDate: payDate,
                      },
                    ],
                  })
                }
              >
                Add one-time deduction
              </button>
            </details>
          )}
          {calibrated && (
            <TaxAmount
              label="Maximum calibration correction per paycheck ($)"
              value={input.calibrationLimit}
              change={(calibrationLimit) => update({ calibrationLimit })}
            />
          )}
        </>
      )}
    </div>
  );
}
export function TaxBreakdown({ value }: { value: TaxEstimate }) {
  return (
    <details open className="pay-tax-breakdown">
      <summary>
        Withholding calculation · {value.rules ?? "Needs setup"}
      </summary>
      <p>
        {value.profile.name} · {value.context.frequency} ·{" "}
        {value.context.payDate}
      </p>
      <div className="pay-table-scroll">
        <table className="pay-table">
          <tbody>
            <tr>
              <th>Cash gross</th>
              <td>{money(value.cashGrossCents)}</td>
            </tr>
            <tr>
              <th>Noncash additions</th>
              <td>{money(value.noncashCents)}</td>
            </tr>
            {value.deductions.map((l, i) => (
              <tr key={`d${i}`}>
                <th>{l.name}</th>
                <td>−{money(l.cents)}</td>
              </tr>
            ))}
            {value.taxes.map((l, i) => (
              <tr key={`t${i}`}>
                <th>{l.name}</th>
                <td>−{money(l.cents)}</td>
              </tr>
            ))}
            <tr>
              <th>Modeled take-home</th>
              <td>
                {value.netCents === null
                  ? "Needs review"
                  : money(value.netCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <details>
        <summary>Taxable wage bases and YTD context</summary>
        <ul>
          {(Object.keys(labels) as (keyof TaxMask)[]).map((k) => (
            <li key={k}>
              {labels[k]} wages: {money(value.wages[k])}
            </li>
          ))}
        </ul>
        <p>
          Prior SS wages: {value.inputs.socialSecurityYtd ?? "Unknown"}; prior
          Medicare wages: {value.inputs.medicareYtd ?? "Unknown"}. SS phase:{" "}
          {value.ssPhase}; Additional Medicare phase: {value.medicarePhase}.
        </p>
      </details>
      <ul>
        {value.warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </details>
  );
}
export function TaxResultDetails({ value }: { value: TaxResult }) {
  return (
    <>
      <TaxBreakdown value={value.estimate} />
      {value.correction && (
        <details open>
          <summary>
            Calibration · {value.correction.support.length} compatible earlier
            comparisons
          </summary>
          <p>
            Median residual:{" "}
            {value.correction.rawMedianCents === null
              ? "Unavailable"
              : money(value.correction.rawMedianCents)}
            ; applied correction:{" "}
            {value.correction.appliedCents === null
              ? "Unavailable"
              : money(value.correction.appliedCents)}
            ; residual spread:{" "}
            {value.correction.residualSpreadCents === null
              ? "Unavailable"
              : money(value.correction.residualSpreadCents)}
            .
          </p>
          <ul>
            {value.correction.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {value.correction.support.map((c) => (
            <p key={c.id}>
              {c.observation.payDate} · actual{" "}
              {c.observation.netCents === null
                ? "Unknown"
                : money(c.observation.netCents)}{" "}
              · modeled{" "}
              {c.estimate.netCents === null
                ? "Unknown"
                : money(c.estimate.netCents)}
            </p>
          ))}
        </details>
      )}
    </>
  );
}
