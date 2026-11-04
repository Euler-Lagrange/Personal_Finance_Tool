# Shared reports and statements — November 3, 2026

## Scope and outcome

Schema 20 adds bills/everyday reporting groups, optional repayment tags, all-history/monthly statements, search/filtering, and local HTML/CSV exports. The one household balance remains authoritative: starting balance plus opening adjustment, bills/everyday/unassigned changes and repayments equals the ending balance. Running balances use all activity in chronological creation order, even when display filters hide some rows.

Fully linked bill payments default to Bills; unlinked purchases default to Everyday. Partly linked payments stay Unassigned rather than assigning unsupported portions of household debt. A reviewed override groups the whole transaction. Refunds inherit the original grouping unless explicitly overridden. Tagged repayments remain separate in the reconciliation and never establish independent group debts. Opening balances are included once; PayPal cash-outs, personal purchases, transfers and card payments do not become another shared charge or repayment.

Group edits preserve exact financial fields, use event revisions and audit atomically. Later financial changes still follow existing protections. Schema migration adds no tags to existing records. Recovery validates group definitions, and isolated old-schema upgrades preserve activity.

Exports contain the complete selected period regardless of table filters. They include full cost, person shares, payer/recipient, changes and running balance; private notes, account details and source documents are omitted. HTML is self-contained and printable through a browser. CSV text neutralizes formula-leading descriptions. Each file uses a new generated filename under the app's local `exports/shared-statements` folder, and Open export folder exposes that location. Export errors are visible; exporting sends no messages or payments.

## Findings and corrections

- Generating the export timestamp during rendering made successive exports of one report object differ. The report now captures its generation time once, so rendering and saving use the same statement content.
- Initial synthetic all-history UI data incorrectly treated the opening as an earlier-period balance. The fixture now includes its actual opening row and adjustment, matching native behavior. Focused checks and screenshots were refreshed.
- Failed audit writes roll back both tag and event revision. Stale repeated saves reject without changing money. Corrupt reporting groups cannot replace current data during restore.
- Late all-history responses cannot overwrite a newly selected monthly report. Save/export errors preserve user choices and permit retry; declining discard keeps the edit open.

## Checks actually run

- **197 distinct core tests pass** across the full 195-case baseline and the final nine-case reporting run, including two added failure/recovery scenarios. One native OCR integration test is intentionally ignored by the standard suite.
- **102 browser cases passed** in the full suite; all five reporting cases also passed after the final fixture correction. Native IPC is mocked.
- Clippy with warnings denied, Rustfmt, Prettier and the production TypeScript/Vite/Tauri build passed. Existing Cargo hard-link-cache fallback notices remain environmental.
- Synthetic compact Light/Dracula views inspected, including grouping controls. Wide statement columns scroll within the panel. The actual native-generated synthetic HTML export was opened in isolated Edge and visually inspected; hostile markup displayed as text.
- No real financial data was opened, migrated, restored or used for QA. Export-file tests used temporary folders; a synthetic HTML visual fixture was retained under `.qa`.

## Delivery

- `builds/Personal Finance Preview - Shared Statements.exe`
- **17,160,192** bytes. Release and copied executable SHA-256: `226007CAA6C7E3DA13D4F69B96B8CA8A6DE6E4E121A74355934C4FFB0F454BD0`.
- Prior builds retained and no running app stopped. Use this build or newer after schema 20.

## Remaining work and verification gaps

Month close, explicit reopen, reset/rollover and annual reporting continue next. A closed historical report must preserve or guard group changes, bill links and inherited refund grouping as well as financial totals. All-history reports are based on recorded activity; missing historical data and unresolved imports remain qualified. Grouping is whole-transaction reporting, not an allocation of an individual payment among multiple bill debts.

Native Explorer opening/clipboard/drop, actual issuer exports, provider credentials, second-device handoff and installation remain unverified. Native PDF generation is not part of this section; the exported HTML can be printed or saved as PDF in a browser. Optional AI, declarative PDF extraction, forecasts and encrypted handoff remain in the approved queue. Live-data testing stays reserved for Jacob's final trial.
