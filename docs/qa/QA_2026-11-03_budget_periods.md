# Explicit late-entry budget periods - November 3, 2026

## Scope and outcome

Schema 23 adds an optional, reasoned later budget month to confirmed entries. Original transaction and account posting dates stay unchanged. Budgets, goal exclusions, annual allocations and shared monthly statements consistently use the selected budget period; badges and exports disclose it. Manual entries, transfers, refunds, individual import review, bill-payment recording and PayPal repayments expose the control. Automatic processing never chooses an override.

Previously closed financial entries cannot escape their lock by changing their period. Newly discovered late entries can use an open later period without rewriting frozen earlier reports. Clearing an override requires all affected periods to be open. Ordinary edits preserve it. Actual cash chronology, import identity, refund ordering and goal-support evidence remain authoritative.

## Review findings

- Audited reporting queries and close fingerprints separately from physical account dates. Goal exclusions and refund reversals follow the chosen budget period; actual earlier account changes still cannot invalidate closed goal-funding evidence.
- Internal reconciliation and purchase-review paths retain the canonical event and its override; provisional records cannot acquire an override before classification.
- Original-date disclosure replaces the old footer claim that entry date always determines the month. Statement exports show both actual date and budget month without exporting private override reasons.
- The initial new import UI case used an unsuitable wrapped-label locator. Correcting it to the existing accessible combobox convention resolved that fixture failure; the final full browser run passed.
- No known correctness/data-loss defect remains in this section. Future forecasts must continue using actual account dates rather than budget periods.

## Evidence

- **226 distinct core cases passed**: full 216-case existing baseline plus the final ten new budget-period integration cases. One native Windows OCR test remains intentionally ignored in the standard suite.
- **117 mocked browser cases passed** in the final full run. New cases cover required reason, actual-date retention, failed save/retry, discard cancellation, explicit clearing, bill recording, individual import confirmation and compact Light/Dracula presentation.
- Real SQLite checks cover frozen history, closed-source/destination locks, mixed import rollback, retry/undo/restore, goal funding/refunds, actual cash/checkpoints, card payments, bill links, carry-chain reconciliation, migration from schema 22 and corrupt restore rejection.
- TypeScript, Rustfmt, Prettier, Clippy with warnings denied and production Tauri/Vite build passed. Cargo hard-link fallback notices are environmental. Synthetic Light/Dracula screenshots inspected.
- Only temporary databases and synthetic fixtures were used. No personal app database or real exports were opened or migrated.

## Delivery and remaining work

`builds/Personal Finance Preview - Budget Periods.exe`, **17,630,208 bytes**. Release and delivered copy SHA-256: `5749036265A3AF67B8DB668E729834539AF7B6F533C61E2E8B313306661ECF32`. Older artifacts are retained; use this build or newer after schema 23.

Basic category/merchant trends follow immediately, then forecasts/statements and the remaining approved queue. Native WebView/Explorer clipboard/drop, issuer conventions, provider credentials, second-device handoff and installation remain unverified. All live-data testing stays at Jacob's final trial.
