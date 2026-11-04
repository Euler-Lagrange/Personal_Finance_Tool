import { useEffect, useState } from "react";
import { Download, FolderOpen } from "lucide-react";
import { command, money, monthName } from "./api";
import { Modal } from "./EntryDialog";
import type { Entry, Snapshot } from "./types";
import "./sharedStatement.css";

interface Row {
  reportingMonth?: string;
  payer?: string | null;
  entry: Entry | null;
  date: string;
  description: string;
  kind: string;
  group: string;
  groupReason: string;
  overrideGroup: string | null;
  fullCents: number;
  jacobCents: number;
  chelseaCents: number;
  deltaCents: number;
  balanceCents: number;
}
interface Report {
  closed?: boolean;
  workspace: string;
  month: string | null;
  generatedAt: string;
  openingDate: string | null;
  openingCents: number;
  openingAdjustmentCents: number;
  closingCents: number;
  billsCents: number;
  everydayCents: number;
  unassignedCents: number;
  repaymentCents: number;
  pendingCount: number;
  incompleteSources: number;
  rows: Row[];
}
const names: Record<string, string> = {
  bills: "Bills",
  everyday: "Everyday",
  unassigned: "Unassigned",
  opening: "Opening balance",
  expense: "Purchase",
  debt_payment: "Debt payment",
  refund: "Refund",
  settlement: "Repayment",
};
const signed = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;

export default function SharedStatement({
  data,
  edit,
  saved,
}: {
  data: Snapshot;
  edit: (e: Entry) => void;
  saved: (m: string) => Promise<void>;
}) {
  const [scope, setScope] = useState("all"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0);
  const [groupRow, setGroupRow] = useState<Row | null>(null),
    [exporting, setExporting] = useState(false),
    [exportPath, setExportPath] = useState("");
  const month = scope === "month" ? data.month : null;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setExportPath("");
    command<Report>("shared_statement", { workspace: data.workspace, month })
      .then((r) => {
        if (alive) {
          setReport(r ?? null);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(String(e));
          setReport(null);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [data, month, reload]);
  const rows = (report?.rows ?? []).filter(
    (r) =>
      (filter === "all" ||
        (filter === "repayments"
          ? r.kind === "settlement"
          : r.group === filter)) &&
      `${r.description} ${r.entry?.payer ?? r.payer ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  async function exportReport(format: string) {
    setExporting(true);
    setError("");
    setExportPath("");
    try {
      setExportPath(
        await command<string>("export_shared_statement", {
          workspace: data.workspace,
          month,
          format,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="panel shared-statement">
      <div className="panel-heading">
        <div>
          <h2>Shared transaction history</h2>
          <p>One household balance, with bills and everyday activity.</p>
        </div>
      </div>
      <div className="statement-controls">
        <label>
          Statement period
          <select
            value={scope}
            disabled={exporting}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">All recorded history</option>
            <option value="month">{monthName(data.month)}</option>
          </select>
        </label>
        <label>
          Show activity
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All activity</option>
            <option value="bills">Bills</option>
            <option value="everyday">Everyday</option>
            <option value="unassigned">Unassigned</option>
            <option value="repayments">Repayments</option>
          </select>
        </label>
        <label>
          Search shared activity
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Description or payer"
          />
        </label>
      </div>
      {loading && <p className="statement-message">Loading statement...</p>}
      {error && (
        <div className="statement-message" role="alert">
          {error}
          <button
            className="text-button"
            disabled={loading || exporting}
            onClick={() => setReload((n) => n + 1)}
          >
            Reload statement
          </button>
        </div>
      )}
      {!loading && report && (
        <>
          {report.closed && (
            <p className="statement-message">
              Final statement saved at month close. Reopen the month to update
              it; all-history reporting uses current records.
            </p>
          )}
          <div className="statement-summary">
            <div>
              <span>Before period</span>
              <strong>{signed(report.openingCents)}</strong>
            </div>
            <div>
              <span>Bills change</span>
              <strong>{signed(report.billsCents)}</strong>
            </div>
            <div>
              <span>Everyday change</span>
              <strong>{signed(report.everydayCents)}</strong>
            </div>
            <div>
              <span>Repayments change</span>
              <strong>{signed(report.repaymentCents)}</strong>
            </div>
            <div>
              <span>Period end balance</span>
              <strong>{signed(report.closingCents)}</strong>
            </div>
          </div>
          <p className="statement-message">
            Positive means Chelsea owes you; negative means you owe Chelsea.
            Groups describe whole transactions. Filters do not change balances
            or exports.
          </p>
          {(report.openingAdjustmentCents !== 0 ||
            report.unassignedCents !== 0) && (
            <p className="statement-message">
              Opening adjustment in period:{" "}
              {signed(report.openingAdjustmentCents)} · Unassigned activity
              change: {signed(report.unassignedCents)}
            </p>
          )}
          {!report.openingDate && (
            <p className="statement-message">
              No reconciled opening balance is set. Totals use recorded activity
              only.
            </p>
          )}
          {(report.pendingCount > 0 || report.incompleteSources > 0) && (
            <p className="statement-message" role="status">
              Provisional: {report.pendingCount} recorded movements in this
              period await review; {report.incompleteSources} import sources in
              the workspace are incomplete.
            </p>
          )}
          <div className="statement-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date / group</th>
                  <th>Description</th>
                  <th>Full amount</th>
                  <th>Your share</th>
                  <th>Chelsea's share</th>
                  <th>Balance change</th>
                  <th>Running balance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r, i) => (
                  <tr key={r.entry?.id ?? `opening-${i}`}>
                    <td>
                      {r.date}
                      {r.reportingMonth &&
                        r.reportingMonth !== r.date.slice(0, 7) && (
                          <small>Budget {monthName(r.reportingMonth)}</small>
                        )}
                      <small>{names[r.group] ?? r.group}</small>
                    </td>
                    <td>
                      <strong>{r.description}</strong>
                      <small>
                        {names[r.kind] ?? r.kind}
                        {(r.entry?.payer ?? r.payer)
                          ? ` · ${(r.entry?.payer ?? r.payer) === "jacob" ? "Jacob" : "Chelsea"} ${r.kind === "refund" ? "received" : "paid"}`
                          : ""}
                      </small>
                    </td>
                    <td className="number">
                      {r.kind === "opening" ? "—" : money(r.fullCents)}
                    </td>
                    <td className="number">
                      {["opening", "settlement"].includes(r.kind)
                        ? "—"
                        : money(r.jacobCents)}
                    </td>
                    <td className="number">
                      {["opening", "settlement"].includes(r.kind)
                        ? "—"
                        : money(r.chelseaCents)}
                    </td>
                    <td className="number">{signed(r.deltaCents)}</td>
                    <td className="number emphasized">
                      {signed(r.balanceCents)}
                    </td>
                    <td>
                      {r.entry && (
                        <div className="statement-actions">
                          <button
                            className="text-button"
                            onClick={() => edit(r.entry!)}
                            aria-label={`Edit ${r.description}`}
                          >
                            Edit
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setGroupRow(r)}
                            aria-label={`Group ${r.description}`}
                          >
                            Group
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <p className="statement-message">
              No shared activity matches these filters.
            </p>
          )}
          {rows.length > 500 && (
            <p className="statement-message">
              Showing the first 500 matches. Narrow the period or search to see
              others; exports include the complete period.
            </p>
          )}
          <div className="statement-export">
            <button
              className="secondary"
              disabled={exporting}
              onClick={() => void exportReport("html")}
            >
              <Download size={16} />
              Export printable statement
            </button>
            <button
              className="secondary"
              disabled={exporting}
              onClick={() => void exportReport("csv")}
            >
              Export CSV
            </button>
            <small>
              Includes all activity in the selected period. Private notes and
              account details are excluded. Files are saved locally.
            </small>
          </div>
          {exportPath && (
            <div className="statement-message" role="status">
              <strong>Statement saved</strong>
              <p className="statement-path">{exportPath}</p>
              <button
                className="secondary"
                onClick={() =>
                  void command("open_statement_folder").catch((e) =>
                    setError(String(e)),
                  )
                }
              >
                <FolderOpen size={16} />
                Open export folder
              </button>
            </div>
          )}
        </>
      )}
      <div className="panel-footnote">
        Repayments recorded here do not send money. Record them after payment is
        made or received. A PayPal cash-out is not another repayment.
      </div>
      {groupRow && (
        <GroupDialog
          row={groupRow}
          workspace={data.workspace}
          close={() => setGroupRow(null)}
          saved={saved}
        />
      )}
    </section>
  );
}

function GroupDialog({
  row,
  workspace,
  close,
  saved,
}: {
  row: Row;
  workspace: string;
  close: () => void;
  saved: (m: string) => Promise<void>;
}) {
  const initial = row.overrideGroup ?? "automatic";
  const [group, setGroup] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function leave() {
    if (group !== initial && !window.confirm("Discard this group change?"))
      return;
    close();
  }
  return (
    <Modal title="Activity group" onClose={leave} busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await command("set_household_group", {
              workspace,
              event: row.entry!.id,
              revision: row.entry!.revision,
              group: group === "automatic" ? null : group,
            });
            close();
            await saved("Activity group updated.");
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          <strong>{row.description}</strong>
        </p>
        <p className="muted">
          {row.groupReason}. This groups the whole transaction and does not
          change its amount, shares, or the household balance.
        </p>
        <label>
          Reporting group
          <select
            value={group}
            disabled={busy}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="automatic">Automatic</option>
            <option value="bills">Bills</option>
            <option value="everyday">Everyday</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        {row.kind === "settlement" && (
          <p className="muted">
            A repayment tag is context only. It still reduces the one household
            balance.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={leave}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save group
          </button>
        </div>
      </form>
    </Modal>
  );
}
