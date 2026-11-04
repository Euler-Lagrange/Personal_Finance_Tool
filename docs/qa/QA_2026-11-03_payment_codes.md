# Payment codes and linked posting dates - November 3, 2026

## Scope and outcome

Schema 16 extends verified exact source codes with card payments and bank transfers. Each movement code requires an explicit compatible owned counterpart account. Remembered profiles reuse those choices; migration does not enable new automation. A description containing PAYMENT or charges totaling the payment amount never establishes a payment by itself.

Importing the bank or card first creates one complete movement when identity is clear. The other source can link the existing movement without duplicating account effects, spending, income or shared debt. Unknown independently recorded counterpart activity stays pending for explicit reconciliation. Archived counterpart accounts preserve a reviewable hint instead of manufacturing a second leg. Exact source values and source-account identity continue to control eligibility.

Each account keeps its own confirmed posting date. Linked evidence supplies a date only when consistent; explicit dates take precedence. Undoing a source link removes its date evidence. Reconciliation undo restores only originally explicit dates, so derived dates do not become permanent. Checkpoint estimates use the resulting account dates.

## Findings and corrections

- A regression reproduced a duplicate payment when the second source's date was more than three days away. Movement review now includes distant compatible records, while automatic linking retains its three-day limit and exact account-pair checks. Distant cases stay held for explicit review rather than being silently added.
- Equal-amount twins and multiple source rows proposing the same target are held independently; unrelated verified purchases continue. Distinct verified stable IDs remain distinct, while conflicting/repeated IDs cannot bypass identity review.
- Conflicting linked posting dates hold the affected row without failing unrelated processing. Recovery rejects corrupted date evidence and a tampered effective-date view.
- Reconciliation undo originally risked converting derived posting dates into permanent explicit dates. Separate saved explicit-date provenance now preserves later source-unlink behavior; a regression exercises reconciliation, undo, source unlink and backup restore.
- Browser QA found the counterpart selector's accessible name included its explanatory text. It now has an explicit label. A new test used an outdated reconciliation button name and was corrected. Older-schema test setup was also corrected to remove dependent new views before rebuilding the legacy events table.

## Checks actually run

- **158 core tests passed**, with one Windows OCR integration test intentionally ignored by the standard suite. Ten new scenarios cover both import orders, five purchases totaling $624 plus one payment, separate posting dates/checkpoint estimates, pending-leg reconciliation, equal twins, distant matches, account/code/direction validation, saved profiles, retries, undo, migration and rejected recovery. All financial checks use real SQLite in temporary workspaces.
- **83 browser cases passed** across the 80 passing existing cases in the full baseline and the final focused rerun of all three new cases. These cover compatible account choices, required counterparts, absent remembered codes, interrupted-response retries, transfer/payment choice changes and pending-payment explanations. IPC is mocked.
- Clippy with warnings denied, Rustfmt, Prettier and the TypeScript/Vite/Tauri release build passed. Synthetic Light and Dracula layouts were visually inspected.
- No actual financial workspace was opened or migrated for QA.

## Delivery

- `builds/Personal Finance Preview - Payment Codes.exe`
- **16,689,152 bytes**. Release and delivered copy match SHA-256 `CCCA883FE9E8AB2E44F7F916F40CC97E17B8F728BEAF150BA4A248555A7B0907`.
- Earlier executables retained; no running app stopped. Use this build or newer after schema 16.

## Remaining work and verification gaps

Next: merchant-grouped review with independent category/sharing choices, keyboard and batch actions, rule preview and preserved manual edits. This is an import checkpoint within the larger approved queue.

Exact-code configuration is explicit and account-specific; generic PAYMENT/DEBIT codes that can refer to different counterpart accounts must remain awaiting classification. No real issuer export or provider credential has been tested. PDFs remain evidence-only. Actual Explorer drop/clipboard interaction, second-device handoff and installation remain unverified. Jacob's live-data trial stays at the end.
