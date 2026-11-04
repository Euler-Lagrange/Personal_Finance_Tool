# Movement reconciliation QA - November 3, 2026

## Scope and acceptance

Schema 14 adds explicit reconciliation of separately recorded account movements. A pending imported bank debit and compatible card credit (or savings/checking credit) can become one payment/transfer. A pending extra movement can also link to an already recorded complete payment. Both sources, occurrence identities and stable aliases remain attached to the surviving event. Amounts must agree; account direction and ownership are validated. Equal amounts only suggest matches and never prove payment identity or infer it from purchase totals.

The review screen requires a selected counterpart and confirmation against both sources. It shows the account context and dates; unsupported/unmatched rows stay unresolved. The ledger opens reconciled movements in a source/history view with an explicit undo. Undo restores original records, source dispositions, aliases and account effects, using higher revisions so stale pre-reconciliation inputs cannot apply. Original import undo and ordinary event edits/removal are protected until reconciliation is undone. Later imports referencing the canonical movement must be undone first.

Per-account dates preserve differing bank/card posting days. New imports retain a reliable explicitly mapped posting date for the imported account; otherwise the recorded transaction date is the fallback. Checkpoint estimates use each account's activity date. Editing a spending date preserves an explicit source posting date. Reconciliation of older records can adopt their mapped source posting evidence; this checkpoint does not silently backfill all historical imports.

## Findings and corrections

- A focused regression demonstrated that changing a purchase's spending date discarded its separately verified posting date. Explicit activity dates now survive ordinary spending-date edits; account changes retain dates only for still-included accounts. The regression verifies the distinct September spending date and October posting date.
- Matching to an existing payment can involve two occurrence identities for the same account. Reconciliation coalesces their row/alias references, preserves the prior mappings, and restores them exactly on undo. Round-trip recovery and alias-count assertions cover this case.
- Snapshot history is checksummed and validated on restore/undo; malformed recovery cannot replace current data. Selected event revisions and captured source rows are rechecked inside the write transaction.
- Synthetic QA caught an omitted SQL snapshot-checksum parameter; the transaction rolled back and the binding was corrected before delivery. A test-only checkpoint-call argument was also corrected.
- Visual review found missing modal body padding and a nonstandard danger-button class. The history dialog now uses the existing form layout and button styling. The unrelated classification submit button is absent during reconciliation review.

## Checks actually run

- **140 core tests pass** across the full 137-case baseline and the final 9-case reconciliation rerun/additions. One Windows OCR integration test remains deliberately ignored in the standard suite.
- Nine reconciliation scenarios cover both import orders, retry IDs, bank/card effects, zero income/spending/household changes, existing-payment linking, independent activity dates/checkpoints, exact undo, stable-alias coalescing, later-import dependencies, bank transfers, unsupported credit-card outflows, stale/unconfirmed requests, schema-13 upgrade, corrupted recovery and spending-date edits.
- **77 browser tests pass** in the final full suite. Three new mocked UI scenarios cover explicit pair/confirmation, interrupted-response retries, no-match holds, ledger history, per-account dates and blocked/retried undo. Existing theme tests passed.
- Clippy with warnings denied, Rustfmt, Prettier, TypeScript/Vite and Tauri release build pass. Existing filesystem hard-link cache fallback warnings did not affect results.
- Synthetic compact Light matching and Dracula history dialogs visually inspected, including the final padding/button correction. Browser tests mock native IPC; core tests exercise real SQLite in temporary workspaces. No actual financial database was opened or migrated for QA.

## Delivery

- `builds/Personal Finance Preview - Reconciliation.exe`
- **16,677,376 bytes**. Release and copied artifact match SHA-256 `B741297BCEFC61A53338962DF1A546937FFC60C0F729281E9F33F335BEE44BC7`.
- Earlier builds retained; no running app was stopped. Use this build or newer after schema 14.

## Remaining work

Import completion remains in progress. Next: reusable source classification defaults, verified source payment conventions and automatic follow-through after confirmed setup, then grouped/keyboard merchant review. A reconciled movement must be undone before editing its financial fields; later source links must first be released. Matching remains explicit evidence review, not an issuer-verified automatic match. More general manual posting-date editing remains part of account/statement completion.

Actual issuer exports, native Explorer drop/clipboard interaction, installer/second-device behavior and real AI-provider calls remain unverified. PDFs remain evidence only. The approved broader queue is unchanged, live-data testing remains reserved for Jacob's final trial, and this checkpoint does not complete the overall goal.
