# Card payments, credit decisions and carry review - November 3, 2026

## Scope and outcome

Schema 26 adds reviewed card obligations, exact-cent payment/credit allocations and cumulative-statement carry reconciliation. Each actual payment can cover several statements, with total capacity limited to the actual transaction and each target limited to its remaining new obligation. Partial payment leaves a remaining amount. Allocations never create another expense, account movement, income or household repayment.

Older unpaid debt is identified at each later cutoff and retains its original due date. For example, unpaid cumulative statements of 100, 150 and 200 produce new obligations of 100, 50 and 50. A later cycle distinguishes its remaining new charges, earlier debt still unpaid and the cumulative statement remainder. Paying only its new charges does not mark carried debt covered. Late allocations before the next cutoff invalidate carry; allocations after cutoff reduce the original obligation once.

Refunds/rewards require an explicit issuer-treatment decision. The user can apply a partial amount or record no payment reduction. Unreviewed post-close credits remain warnings. Card and bank posting dates stay separate; assumed dates are disclosed. Activity already included at cutoff cannot also pay that statement.

Financial/date snapshots protect reviewed transactions through edits, source links and import undo at the common write boundary. Notes/descriptions remain editable. Statement financial changes require releasing obligation/allocations/carry dependencies; notes/evidence remain editable. Audit records retain reviewed base/carry and payment/date snapshots even after a review is cleared. Stale tokens, revisions and atomic payload-bound receipts guard retries. Later payment reviews do not rewrite closed monthly financial reports.

The checking timeline remains next. This checkpoint does not claim a live bank balance or safe-to-spend forecast. Existing statement coverage/date assumptions remain visible.

## Findings and fixes

- Reproduced a restore crash using the minimum signed 64-bit integer as a corrupt obligation balance. Range validation now rejects it without overflowing, replacing active records or panicking. Allocation aggregation is bounded too.
- Reproduced a misleading UI status: a later statement said Covered when its new amount was paid but earlier carried debt remained. Added authoritative carried/cumulative remainders and the Earlier debt remains status. The regression failed before the correction and passes afterward.
- A refreshed calculated statement can differ from the previously reviewed obligation. The approval view now exposes the proposed current base separately from the old saved base, preventing approval against an incorrectly displayed amount.
- Integration verifies that a linked import cannot silently move a reviewed payment's card posting date; the failed import rolls back, and explicit release permits linking/undo. A payment already in a statement's cutoff is rejected as a second reduction.
- Receipt-failure tests roll back every review/allocation. Retries reuse the original operation, financial edits/deletion remain guarded, nonfinancial notes stay editable, and saved audit evidence survives clear/delete.
- No known financial, data-loss or workspace-isolation defect remains in this dependency. Actual issuer treatment, native UI and device checks remain separate.

## Checks actually run

- **253 core tests pass; 1 native Windows OCR test intentionally ignored**, using the full baseline and final focused checks. Nine new real SQLite cases cover shared payment capacity, partial/combined allocations, zero/partial credit treatment, three overlapping cycles, late carry correction, same-cutoff rejection, recalculated balances, closed-report preservation, financial guards, source posting-date links/undo, receipt rollback/retry, audit snapshots, schema-25 upgrade, valid/corrupt recovery and sample isolation. The final card-payment filter passed 10 cases: those nine plus an existing goal/card-payment integration case.
- **139 distinct mocked browser cases pass**: the full 139-case baseline passed; after the reproduced cumulative-status correction, all six payment cases passed again. Other UI components were unchanged after the baseline. Covered flows include carry review, decimal allocations, acknowledgement reset, retry identity, explicit no-reduction credit decisions, clearing, stale/included activity, failed refresh without resubmission, delayed old reads and compact themes.
- TypeScript, Rustfmt, Prettier and Clippy with warnings denied passed. Production TypeScript/Vite/Tauri build passed. Cargo hard-link notices are environmental; Vite's nonblocking chunk advisory remains (about 540 kB minified / 151 kB gzip). Packaging/performance review can split routes later if warranted.
- Synthetic compact Light and Dracula layouts inspected. Rust tests use real isolated SQLite; browser tests mock IPC. These are not native WebView/Explorer end-to-end checks.
- No personal application database, live export or real financial record was opened, migrated or restored for QA.

## Delivery and next work

Production build and copy verified: `builds/Personal Finance Preview - Card Payments.exe`, **18,437,120 bytes**; release/copy SHA-256 `42FEDB02F1DDAA8CBFAB7385CFAC0449125E8F4BFCFA59BC7C5089F8616062E5`. Previous checkpoint artifacts retained. Use this build or newer after schema 26.

Continue automatically with the checking cash timeline using full checking-paid bills, expected income, planned savings/settlements and remaining incremental card obligations. Carried totals shown for reconciliation must not be summed again. Preserve qualification for stale reviews, unreviewed credits, coverage and checkpoints. PDF templates, optional reviewed AI hooks, encrypted laptop handoff and packaging remain in the approved queue. Live-data testing stays at Jacob's final trial; native/issuer/provider/device/installer verification remains explicitly unperformed where no evidence exists.
