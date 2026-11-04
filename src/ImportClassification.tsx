import { HelpHeading } from "./HelpTip";
import { useEffect, useRef, useState } from "react";
import { command } from "./api";
import type { Snapshot } from "./types";
import type {
  ClassificationPolicy,
  ImportDetail,
  ImportReceipt,
} from "./importTypes";

export default function ImportClassification({
  detail,
  data,
  disabled,
  changed,
}: {
  detail: ImportDetail;
  data: Snapshot;
  disabled: boolean;
  changed: (message: string) => Promise<void>;
}) {
  const card =
    data.accounts.find((a) => a.id === detail.source.accountId)?.kind ===
    "credit";
  const saved =
    detail.classificationPolicy ?? detail.classificationProfile?.policy;
  const [remember, setRemember] = useState(true);
  const [automatic, setAutomatic] = useState(
    detail.classificationProfile?.automatic ?? true,
  );
  const [policy, setPolicy] = useState<ClassificationPolicy>(() => ({
    ordinaryCardCharges: saved?.ordinaryCardCharges ?? card,
    ownership: saved?.ownership ?? "personal",
    types: [
      ...new Set(
        [
          ...(saved?.types.map((t) => t.code) ?? []),
          ...detail.rows.map((r) => r.candidate.sourceType),
        ].filter(Boolean),
      ),
    ].map((code) => ({
      code,
      kind: saved?.types.find((t) => t.code === code)?.kind ?? "ask",
      accountId: saved?.types.find((t) => t.code === code)?.accountId,
    })),
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function process() {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    const signature = JSON.stringify([
      detail.source.id,
      detail.source.revision,
      policy,
      remember,
      automatic,
    ]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    try {
      const receipt = await command<ImportReceipt>("process_import", {
        workspace: data.workspace,
        id: detail.source.id,
        revision: detail.source.revision,
        commitId: attempt.current.id,
        policy,
        preferences: { remember, automatic },
      });
      if (!active.current) return;
      await changed(
        `${receipt.added} account records added, ${receipt.linked} linked, ${receipt.excluded} excluded.${remember ? " Reusable defaults saved." : " Defaults applied to this source only."} Items needing classification remain in review.`,
      );
    } catch (e) {
      if (active.current) setError(String(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className="import-coverage" aria-label="Automatic classification">
      <HelpHeading topic="verifiedActivity">
        <h3>Process verified activity</h3>
      </HelpHeading>
      <p className="form-intro">
        Clean card purchases can count immediately, even without merchant rules.
        Unknown types affect the account only. Purchases awaiting a split
        reserve their full amount until reviewed.
      </p>
      {detail.classificationProfile && (
        <p className="form-intro">
          Saved defaults for {detail.classificationProfile.profile}. Future
          matching exports{" "}
          {detail.classificationProfile.automatic
            ? "process verified rows when you confirm their range"
            : "wait for you to process them"}
          .
        </p>
      )}
      <fieldset disabled={disabled || busy || !detail.coverage}>
        {card && (
          <label className="import-check">
            <input
              type="checkbox"
              checked={policy.ordinaryCardCharges}
              onChange={(e) =>
                setPolicy((p) => ({
                  ...p,
                  ordinaryCardCharges: e.target.checked,
                }))
              }
            />
            Treat posted card charges with an empty type code as purchases.
          </label>
        )}
        <label>
          Default purchase sharing
          <select
            value={policy.ownership}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, ownership: e.target.value }))
            }
          >
            <option value="personal">Personal - Jacob 100%</option>
            <option value="shared">Shared - Jacob 70%, Chelsea 30%</option>
            <option value="ask">Ask - reserve the gross amount</option>
          </select>
          <small>
            Saved merchant sharing rules take precedence. Ask and conflicting
            rules always require review.
          </small>
        </label>
        {policy.types.length > 0 && (
          <details>
            <summary>Verify source type codes ({policy.types.length})</summary>
            <p className="form-intro">
              Verify exact codes from the export. Assign a counterpart account
              only when that code always describes movements between those two
              accounts. Otherwise leave it awaiting classification. Refunds
              still need their original purchase.
            </p>
            {policy.types.map((t, index) => (
              <div key={t.code}>
                <label>
                  Source code: {t.code}
                  <select
                    value={t.kind}
                    onChange={(e) =>
                      setPolicy((p) => ({
                        ...p,
                        types: p.types.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                kind: e.target.value,
                                accountId: undefined,
                              }
                            : v,
                        ),
                      }))
                    }
                  >
                    <option value="ask">Awaiting classification</option>
                    <option value="expense">Purchase / fee / interest</option>
                    <option value="reward">Reward / cashback</option>
                    {!card && <option value="income">Income</option>}
                    <option value="card_payment">Credit-card payment</option>
                    {!card && <option value="transfer">Bank transfer</option>}
                  </select>
                </label>
                {["card_payment", "transfer"].includes(t.kind) && (
                  <label>
                    Other account for {t.code}
                    <select
                      aria-label={`Other account for ${t.code}`}
                      value={t.accountId ?? ""}
                      onChange={(e) =>
                        setPolicy((p) => ({
                          ...p,
                          types: p.types.map((v, i) =>
                            i === index
                              ? { ...v, accountId: e.target.value || undefined }
                              : v,
                          ),
                        }))
                      }
                    >
                      <option value="">Choose counterpart account</option>
                      {data.accounts
                        .filter(
                          (a) =>
                            a.id !== detail.source.accountId &&
                            (a.id === t.accountId ||
                              (!a.archived &&
                                (t.kind === "card_payment" && !card
                                  ? a.kind === "credit"
                                  : a.kind !== "credit"))),
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id} disabled={a.archived}>
                            {a.name}
                            {a.archived ? " (archived - requires review)" : ""}
                          </option>
                        ))}
                    </select>
                    <small>
                      Verified movements do not add spending or income. Both
                      exports link only when the account pair and identity
                      checks support one match.
                    </small>
                  </label>
                )}
              </div>
            ))}
          </details>
        )}
        <label className="import-check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember defaults for this account, format and download profile
        </label>
        {remember && (
          <label className="import-check">
            <input
              type="checkbox"
              checked={automatic}
              onChange={(e) => setAutomatic(e.target.checked)}
            />
            Process future matching exports when I confirm their download range
          </label>
        )}
        <p className="form-intro">
          These settings take effect when you process or save below. Uncertain
          rows stay in review. Turning off Remember applies changes to this
          source only; it does not delete saved defaults.
        </p>
        {!detail.coverage && (
          <p className="import-caution">
            Confirm the download range first. To change saved defaults before
            processing this import, clear "Use saved automatic processing
            defaults" in the range form. Unreliable dates, amounts and
            identities stay on hold.
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={
            !detail.coverage ||
            policy.types.some(
              (t) =>
                ["card_payment", "transfer"].includes(t.kind) && !t.accountId,
            )
          }
          onClick={() => void process()}
        >
          {busy
            ? "Processing..."
            : detail.rows.some((r) => r.disposition === "pending")
              ? "Process verified rows"
              : "Save import defaults"}
        </button>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
