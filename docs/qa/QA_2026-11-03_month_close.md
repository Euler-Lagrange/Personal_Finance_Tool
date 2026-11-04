# Month close and annual reports — November 3, 2026

## Scope and outcome

Schema 21 adds an explicit close checklist, financial period locks, reasoned reopen, latest-close totals, frozen monthly shared statements, and annual/category reports. This is the first dependency checkpoint of the approved close/rollover section. Signed category carry and linked historical allowance corrections continue immediately next.

Closing requires an ended calendar month, resolved type/sharing/funding and reliable monetary rows. Held unknown/matching-date imports and unconfigured transaction sources block close. Verified Uncategorized charges, unpaid/estimated bills, incomplete confirmed transaction-date coverage and optional balance reconciliation require recorded acknowledgements. Close is not a certification of bank balances. A reviewed token and revision reject changed inputs; operation receipts make retries safe, including after reopening.

Every mutation transaction checks closed financial fingerprints before committing. An edit, delete, import batch, import undo, budget change or earlier goal-support correction that would change a closed month rolls back completely. Original transaction dates remain intact. Nonfinancial descriptions/notes and later-month refunds are allowed. Bills may still receive later payments. Shared monthly reports/exports preserve their close-time content; all-history shared reports remain current.

Reopen retains the prior snapshot and requires a reason. Changed since close identifies financial changes. Reclose replaces the latest snapshot while audit and recovery backups preserve history. Annual reports use frozen closed totals and live open totals, distinguish missing/future months from completed zeros, and average only closed months. Actual spending, goal exclusions, allowance use, income, cash/card rewards, debt and real savings contributions remain separate.

## Findings and corrections

- A shared transaction's group or description may change without changing money. Closed monthly reports therefore store their complete report/HTML/CSV rather than rendering later live grouping. Regression checks verify identical exports until reopen.
- Earlier balance evidence can invalidate a closed goal exclusion. The financial guard includes projected funding dependencies, so the entire attempted mutation rejects instead of rewriting past allowance silently.
- The initial browser fixture used the reserved window.closed property; renamed its synthetic state. A full-suite run during Vite source edits produced two detached/replaced UI failures. After edits stopped, the full suite passed. Source edits are kept out of concurrent browser verification.
- Global label styling stacked checklist boxes above their text. Local layout now aligns them in a row; annual table rows were condensed and redundant global month/entry controls removed from Annual reports. Light/Dracula screenshots were inspected.
- Annual changed-state calculation now propagates database failures instead of treating them as a changed report.

## Checks actually run

- **208 distinct core cases pass** across the 207-case full baseline and final 11-case period run, which added valid closed-backup/restart/receipt recovery. One native OCR integration test remains intentionally ignored in standard runs.
- **107 mocked browser cases pass** in the final stable full run. Five new workflows cover acknowledgements, blocking flags, reload/discard, retry identity, reopen reasons, save-success/refresh-failure, annual zeros/goals and compact themes.
- Native cases cover whole-batch late-import rollback, protected undo/opening/checkpoints, goal-source dependency, later refunds, stale tokens, audit failure, reclose retries, frozen exports, schema-20 migration, valid restore and rejection of corrupt snapshots, corrupt receipts and missing receipt tables.
- TypeScript, Clippy with warnings denied, Rustfmt, Prettier and production TypeScript/Vite/Tauri release passed. Existing Cargo hard-link fallback notices are environmental.
- No actual financial data or personal application database was opened or migrated. Core tests use temporary databases; browser tests use synthetic mocked IPC.

## Delivery

- `builds/Personal Finance Preview - Month Close.exe`
- **17,550,848 bytes**. Release and copied artifact SHA-256: `FDA4412274A6D0C276D15372F90082720605C9B09612B40543AA747031791BBD`.
- Previous builds retained; no running app stopped. Use this build or newer after schema 21.

## Remaining work and verification gaps

Rollover, historical allowance adjustments and basic category/merchant trend follow-through continue in the same approved queue section. Late entries currently require explicit reopen; an alternate budget-period override is not yet implemented. The lock can also reject new uncertain evidence that would invalidate closed goal funding; reopen and review the affected funding month before making that change.

Native Explorer/clipboard/drop and WebView end-to-end interaction, real issuer conventions, provider credentials, second-device handoff and installation remain unverified. Native Windows OCR was verified in an earlier isolated fixture, not rerun here. PDF extraction/templates, forecasts/statements, optional AI and encrypted handoff remain queued. Live-data testing stays reserved for Jacob's final trial.
