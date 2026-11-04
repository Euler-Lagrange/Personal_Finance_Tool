# Verified import classification QA - November 3, 2026

## Scope and acceptance

This schema-13 dependency adds one-action processing after account/column setup and confirmed source coverage. Ordinary posted card charges with an empty source type can become expenses without merchant rules, using Uncategorized when necessary. Exact, explicitly selected source codes support purchases/fees/interest, rewards and bank income. Unknown or sign-conflicting types become verified account activity awaiting classification. No merchant-description substring identifies a card payment.

Source sharing defaults are Personal, Shared 70/30 or Ask. Saved merchant sharing rules take precedence; Ask/conflicts reserve the full verified purchase amount without assigning either person's confirmed spending or changing household debt. Unknown credits never create income or spending room. Unreliable amounts/dates/currency/OCR/identity remain held; explicitly pending bank rows are excluded. Identity links and exclusions are reconciled in the same atomic operation.

Recorded pending activity remains reviewable from Imports and the ledger. Resolving it preserves its verified account/date/amount/direction, replaces the account effect once, and updates confirmed spending/shares. Refund resolution retains original categories/shares. Retry receipts protect lost responses; later edits invalidate old retries. Undo refuses to reverse classified or subsequently referenced records. Coverage may be accepted for account identity even while financial classification remains unresolved; source review state and dashboard warnings retain that distinction.

## Findings and fixes

- A regression reproduced missing review details on a reused unclassified identity. The old all-time entry helper returned only household-affecting entries. It now reads all entries when requested; the household snapshot explicitly retains its existing filter. Pending source rows expose their canonical record ID and revision, including cross-source links.
- Visual inspection found an optimistic budget-status message despite unresolved activity. The status now stays provisional, category/overall allowances include labeled gross reservations, and household reporting labels confirmed activity. The browser regression checks both the provisional warning and absence of the reassuring message.
- Independently imported opposite payment legs could be counted again by a naive conversion. Conversion now rejects possible recorded counterparts, preserving both unresolved records until explicit two-record reconciliation is implemented. A regression also verifies successful single-sided card-payment resolution and its idempotent retry.
- Pending-review date/amount fields are read-only, and an unresolved split requires a new explicit allocation choice. The native core independently enforces immutable verified values.
- Test-only issues corrected: a synthetic dashboard override was lost on reload, and a receipt assertion required a Debug trait unnecessarily. Neither involved user data.

## Verification

- **131 core cases pass** across the full 128-case baseline and final focused additions/rerun (9 classification cases). One Windows OCR integration case remains deliberately ignored in the normal suite.
- **74 mocked browser cases pass** in the full suite, plus focused reruns after final review-label/status refinements. Existing theme coverage passed.
- Core scenarios cover no-rule first imports, exact type codes/sign conflicts, unknown debit/credit effects, provisional sharing, rule overrides/Ask, resolution retries/stale edits, linked refunds, overlap identities, undo/dependencies, card-payment resolution, missing coverage, invalid policy, schema-12 migration and tampered recovery.
- Clippy with warnings denied, Rustfmt, Prettier, TypeScript/Vite and Tauri release build pass. Rust emitted its existing filesystem hard-link cache fallback warning; it did not affect results.
- Synthetic compact Light import controls and Dracula dashboard screenshots inspected. Browser tests use mocked native IPC; Rust tests use real SQLite in temporary workspaces. No real financial database was opened for QA.

## Delivery

- `builds/Personal Finance Preview - Classification.exe`
- Size: **16,307,712 bytes**. Release/copy SHA-256 match: `9383A95AB17F0094CB1004C0C79084701BAA0134E7005B8BD4F93E92445366B4`.
- Old artifacts retained; no running app was stopped. Use this build or newer after schema 13.

## Remaining work and gaps

This is not full import completion. Processing is currently an explicit action using source-local choices. Reusable source classification profiles, automatic processing after confirmed setup, verified payment/transfer source conventions, explicit reconciliation of independently recorded opposite legs, grouped/keyboard merchant review and richer unresolved summaries remain next. Actual issuer formats still require final trial validation; the exact-code mapping makes no claim of verified built-in issuer conventions.

Native Explorer drop/clipboard interaction, installer/second-device behavior, actual issuer samples and AI-provider calls remain unverified. PDFs remain evidence only. No live-data trial was performed. Continue the approved autonomous build queue using synthetic fixtures; do not mark the overall goal complete at this checkpoint.
