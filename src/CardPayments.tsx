import { HelpHeading } from "./HelpTip";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { command, dollars, money } from "./api";
import { Modal } from "./EntryDialog";
import type { Snapshot } from "./types";
import "./cardPayments.css";

interface Carry {
  month: string;
  amountCents: number;
}
interface Obligation {
  month: string;
  revision: number;
  closingDate: string;
  dueDate: string;
  baseCents: number | null;
  carriedCents: number;
  newCents: number | null;
  paidCents: number;
  creditCents: number;
  remainingCents: number | null;
  carriedRemainingCents: number;
  statementRemainingCents: number | null;
  proposedCarry: Carry[];
  proposedBaseCents: number | null;
  proposedNewCents: number | null;
  needsReview: boolean;
  canReview: boolean;
  blockers: string[];
  warnings: string[];
  note: string;
}
interface Payment {
  id: string;
  revision: number;
  reviewRevision: number;
  description: string;
  kind: string;
  cardDate: string;
  bankDate: string | null;
  dateAssumed: boolean;
  amountCents: number;
  allocations: Carry[];
  note: string;
}
interface View {
  accountId: string;
  obligations: Obligation[];
  payments: Payment[];
  token: string;
}
type Props = {
  data: Snapshot;
  account: string;
  close: () => void;
  saved: (m: string) => Promise<void>;
};
type Edit =
  { kind: "obligation"; item: Obligation } | { kind: "payment"; item: Payment };
function value(c: number | null) {
  return c === null ? "Unknown" : money(c);
}
function warnings(items: string[]) {
  return items.length ? (
    <ul className="card-payment-warnings">
      {items.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  ) : null;
}
function useWrite(done: () => void, saved: Props["saved"]) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const running = useRef(false),
    operation = useRef({ key: "", id: "" });
  async function write(cmd: string, args: Record<string, unknown>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const key = JSON.stringify({ cmd, args });
    if (key !== operation.current.key)
      operation.current = { key, id: crypto.randomUUID() };
    try {
      await command(cmd, { ...args, operation: operation.current.id });
    } catch (e) {
      setError(String(e));
      running.current = false;
      setBusy(false);
      return;
    }
    done();
    await saved("Card payment review saved.");
  }
  return { busy, error, write };
}
export default function CardPayments({ data, account, close, saved }: Props) {
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [edit, setEdit] = useState<Edit | null>(null);
  useEffect(() => {
    let live = true;
    setView(null);
    setError("");
    command<View>("card_payment_view", { workspace: data.workspace, account })
      .then((v) => {
        if (live) setView(v);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [data, account, reload]);
  const name = data.accounts.find((a) => a.id === account)?.name ?? account;
  if (edit && view)
    return edit.kind === "obligation" ? (
      <ObligationEditor
        data={data}
        account={account}
        close={() => setEdit(null)}
        saved={saved}
        item={edit.item}
        view={view}
      />
    ) : (
      <PaymentEditor
        data={data}
        account={account}
        close={() => setEdit(null)}
        saved={saved}
        item={edit.item}
        view={view}
      />
    );
  return (
    <Modal title={`${name} payments & credits`} onClose={close}>
      <div className="card-payments">
        <p className="muted">
          All tracked cycles for this card. Allocate actual payments once and
          review whether post-close credits satisfy an amount owed. Record
          missing transactions in Transactions first.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!view && !error && <p role="status">Loading card payments...</p>}
        <button className="secondary" onClick={() => setReload((r) => r + 1)}>
          Reload card records
        </button>
        {view && (
          <>
            <HelpHeading topic="cardPayments">
              <h3>Statement obligations</h3>
            </HelpHeading>
            {view.obligations.length === 0 && (
              <p>Save a statement review to track an obligation.</p>
            )}
            {view.obligations.map((o) => (
              <section
                className="card-obligation"
                key={o.month}
                aria-label={`${o.month} obligation`}
              >
                <div className="card-payment-heading">
                  <strong>{o.month}</strong>
                  <span>
                    {o.revision === 0
                      ? "Review needed"
                      : o.needsReview
                        ? "Changed · review needed"
                        : o.statementRemainingCents === 0
                          ? "Covered"
                          : o.remainingCents === 0
                            ? "Earlier debt remains"
                            : o.paidCents + o.creditCents > 0
                              ? "Partially covered"
                              : "Unpaid"}
                  </span>
                </div>
                <p className="muted">
                  Cutoff {o.closingDate} · due {o.dueDate}
                </p>
                <dl className="card-payment-amounts">
                  <div>
                    <dt>Statement balance</dt>
                    <dd>{value(o.baseCents)}</dd>
                  </div>
                  <div>
                    <dt>Carried from earlier</dt>
                    <dd>{money(o.carriedCents)}</dd>
                  </div>
                  <div>
                    <dt>New obligation</dt>
                    <dd>{value(o.newCents)}</dd>
                  </div>
                  <div>
                    <dt>Payments / approved credits</dt>
                    <dd>
                      {money(o.paidCents)} / {money(o.creditCents)}
                    </dd>
                  </div>
                  <div>
                    <dt>Remaining new amount</dt>
                    <dd>{value(o.remainingCents)}</dd>
                  </div>
                  <div>
                    <dt>Earlier debt still unpaid</dt>
                    <dd>{money(o.carriedRemainingCents)}</dd>
                  </div>
                  <div>
                    <dt>Total still owed from this statement</dt>
                    <dd>{value(o.statementRemainingCents)}</dd>
                  </div>
                </dl>
                {o.needsReview && (
                  <p className="statement-notice">
                    These amounts need review before they can support a reliable
                    cash projection.
                  </p>
                )}
                {warnings([...o.blockers, ...o.warnings])}
                <button
                  className="secondary"
                  onClick={() => setEdit({ kind: "obligation", item: o })}
                >
                  Review {o.month} obligation
                </button>
              </section>
            ))}
            <h3>Payments and credits</h3>
            {view.payments.length === 0 && (
              <p>No completed payments or identified credits for this card.</p>
            )}
            {view.payments.map((p) => (
              <section className="card-payment-event" key={p.id}>
                <div className="card-payment-heading">
                  <strong>{p.description}</strong>
                  <strong>{money(p.amountCents)}</strong>
                </div>
                <p className="muted">
                  {p.kind === "card_payment"
                    ? "Card payment"
                    : "Refund / reward credit"}{" "}
                  · card date {p.cardDate}
                  {p.bankDate ? ` · bank date ${p.bankDate}` : ""}
                  {p.dateAssumed ? " · posting date assumed" : ""}
                </p>
                <p>
                  {money(p.allocations.reduce((n, a) => n + a.amountCents, 0))}{" "}
                  allocated
                  {p.reviewRevision > 0
                    ? " · treatment reviewed"
                    : " · not reviewed"}
                </p>
                <button
                  className="secondary"
                  onClick={() => setEdit({ kind: "payment", item: p })}
                >
                  Review {p.description}
                </button>
              </section>
            ))}
          </>
        )}
        <div className="dialog-actions">
          <button className="secondary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
function ObligationEditor({
  data,
  account,
  close,
  saved,
  item: o,
  view,
}: Props & { item: Obligation; view: View }) {
  const [note, setNote] = useState(o.note),
    [confirmed, setConfirmed] = useState(false);
  const w = useWrite(close, saved);
  const back = () => {
    if (
      note === o.note ||
      window.confirm("Discard the unsaved obligation note?")
    )
      close();
  };
  function input() {
    return {
      accountId: account,
      month: o.month,
      revision: o.revision,
      token: view.token,
      note,
      confirmed,
    };
  }
  return (
    <Modal title={`Review ${o.month} obligation`} onClose={back} busy={w.busy}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void w.write("save_card_obligation", {
            workspace: data.workspace,
            input: input(),
          });
        }}
      >
        <fieldset disabled={w.busy} className="card-payment-form">
          <p>
            Separate debt already tracked in earlier cycles from the new amount
            in this statement.
          </p>
          <dl className="card-payment-amounts">
            <div>
              <dt>Statement balance</dt>
              <dd>{value(o.proposedBaseCents)}</dd>
            </div>
            {o.proposedCarry.map((c) => (
              <div key={c.month}>
                <dt>Includes unpaid {c.month} at cutoff</dt>
                <dd>{money(c.amountCents)}</dd>
              </div>
            ))}
            <div>
              <dt>Proposed new obligation</dt>
              <dd>{value(o.proposedNewCents)}</dd>
            </div>
          </dl>
          <p className="muted">
            Earlier unpaid amounts keep their original due dates. Payments
            already included at this cutoff cannot also pay this statement.
          </p>
          {warnings([...o.blockers, ...o.warnings])}
          <label>
            Obligation review note / issuer reference
            <textarea
              required
              maxLength={2000}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirmed this statement includes the displayed carried debt
          </label>
          {w.error && (
            <p role="alert" className="error">
              {w.error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="secondary" type="button" onClick={back}>
              Back
            </button>
            <button
              className="primary"
              disabled={!o.canReview || !confirmed || !note.trim()}
            >
              Confirm obligation
            </button>
          </div>
          {o.revision > 0 && (
            <button
              className="text-danger"
              type="button"
              disabled={!note.trim()}
              onClick={() => {
                if (
                  window.confirm(
                    "Clear this obligation review? Its allocations and later carried-debt links must be removed first. The statement and transactions stay saved.",
                  )
                )
                  void w.write("clear_card_obligation", {
                    workspace: data.workspace,
                    input: { ...input(), confirmed: true },
                  });
              }}
            >
              Clear obligation review
            </button>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
function PaymentEditor({
  data,
  account,
  close,
  saved,
  item: p,
  view,
}: Props & { item: Payment; view: View }) {
  const initial = Object.fromEntries(
    p.allocations.map((a) => [a.month, dollars(a.amountCents)]),
  );
  const [amounts, setAmounts] = useState<Record<string, string>>(initial),
    [note, setNote] = useState(p.note),
    [confirmed, setConfirmed] = useState(false);
  const w = useWrite(close, saved);
  const dirty =
    JSON.stringify(amounts) !== JSON.stringify(initial) || note !== p.note;
  const back = () => {
    if (!dirty || window.confirm("Discard the unsaved payment allocations?"))
      close();
  };
  const allocations = Object.entries(amounts)
    .filter(([, v]) => v.trim() !== "" && !/^0+(\.0{1,2})?$/.test(v.trim()))
    .map(([month, amount]) => ({ month, amount }));
  const total = allocations.reduce(
    (n, a) => n + Math.round(Number(a.amount) * 100),
    0,
  );
  function input() {
    return {
      accountId: account,
      eventId: p.id,
      eventRevision: p.revision,
      revision: p.reviewRevision,
      token: view.token,
      allocations,
      note,
      confirmed,
    };
  }
  return (
    <Modal
      title={`Allocate ${p.kind === "card_payment" ? "payment" : "credit"}`}
      onClose={back}
      busy={w.busy}
    >
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void w.write("save_card_payment_review", {
            workspace: data.workspace,
            input: input(),
          });
        }}
      >
        <fieldset disabled={w.busy} className="card-payment-form">
          <div className="card-payment-heading">
            <strong>{p.description}</strong>
            <strong>{money(p.amountCents)}</strong>
          </div>
          <p>
            Card posting date: {p.cardDate}
            {p.dateAssumed ? " (assumed from transaction date)" : ""}.
            {p.bankDate ? ` Bank posting date: ${p.bankDate}.` : ""}
          </p>
          <p className="muted">
            {p.kind === "card_payment"
              ? "Split this actual payment across the remaining new amounts below. Apply carried debt to its original cycle. Allocations do not record another payment or expense."
              : "A credit can reduce the account balance without satisfying the issuer's payment requirement. Allocate only the amount the issuer accepts toward the obligation; leave all fields blank to record no reduction."}
          </p>
          {view.obligations.length === 0 && (
            <p>Save and review a statement obligation first.</p>
          )}
          {view.obligations.map((o) => {
            const included = p.cardDate <= o.closingDate,
              disabled = o.revision === 0 || included;
            return (
              <label className="card-allocation-line" key={o.month}>
                <span>
                  {o.month} allocation
                  <small>
                    {included
                      ? "Already included at this cutoff"
                      : o.revision === 0
                        ? "Obligation review needed"
                        : `${value(o.remainingCents)} currently remaining${o.needsReview ? " · changed obligation; only reduce existing allocation" : ""}`}
                  </small>
                </span>
                <input
                  aria-label={`${o.month} allocation`}
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={disabled}
                  value={amounts[o.month] ?? ""}
                  onChange={(e) => {
                    setAmounts((a) => ({ ...a, [o.month]: e.target.value }));
                    setConfirmed(false);
                  }}
                />
              </label>
            );
          })}
          <p className="card-payment-summary">
            {Number.isFinite(total)
              ? `${money(total)} allocated · ${money(p.amountCents - total)} not applied`
              : "Check the allocation amounts."}
          </p>
          <label>
            Payment review note / issuer reference
            <textarea
              required
              maxLength={2000}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I verified the card posting date and how these amounts satisfy the
            issuer's obligations
          </label>
          {w.error && (
            <p role="alert" className="error">
              {w.error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={back}>
              Back
            </button>
            <button className="primary" disabled={!confirmed || !note.trim()}>
              Save allocations
            </button>
          </div>
          {p.reviewRevision > 0 && (
            <button
              type="button"
              className="text-danger"
              disabled={!note.trim()}
              onClick={() => {
                if (
                  window.confirm(
                    "Clear this saved treatment review and all its allocations? The actual transaction stays in your ledger.",
                  )
                )
                  void w.write("clear_card_payment_review", {
                    workspace: data.workspace,
                    input: { ...input(), allocations: [], confirmed: true },
                  });
              }}
            >
              Clear saved review and allocations
            </button>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
