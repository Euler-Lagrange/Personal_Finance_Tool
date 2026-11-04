# Rewards and debt-payment reporting - November 3, 2026

## Scope and accounting

Manual and explicitly reviewed imported rewards/credits, budgetable loan/debt payments, bill payment treatment, refund integration, reporting, and schema-9 migration/recovery. This is an intermediate autonomous checkpoint using synthetic data. Source-specific automatic classification, household opening, PayPal allocations, statement reconciliation and principal/interest tracking are outside this sub-section and remain in the build queue.

- Rewards credit only the selected actual account: cash increases, card liability decreases. They create no category spending or household balance. Bonus/Cashback is shown separately as cash versus noncash card credits; ordinary income remains separate. Purchase adjustments use linked refunds instead, so one credit cannot also create rewards income.
- Loan/debt payments use the monthly category allowance and stored sharing/charge lines, but reports distinguish them from purchase consumption. Card payments remain transfers. Debt-payment refunds reduce debt-payment totals in the received month and reverse the original line/person allocations without becoming income.
- Bills retain a purchase/debt treatment default in each prepared plan. New payment forms inherit it with an explicit override. Existing payment links retain the transaction's treatment. Older plans deserialize as purchases. No old transaction is reclassified.
- New kinds retain exact-cent parsing, revisions, actual-date validation, account/archive checks and transactional writes. Imported direction must agree with the selected type. Unknown credits are never automatically guessed as rewards. Existing type cannot be changed in place.

## Review findings and corrections

- Expanded the bill recovery validator's old expense-only predicate to admit valid loan payments; otherwise a correct loan-bill backup would be rejected. Recovery tests now include debt bill links, rewards, checkpoints and refunds.
- Extended itemized/category aggregation, original-refund eligibility, import direction checks, and backup account-sign validation together. The integration tests distinguish financial reports from cash-account effects and verify edits/deletes reverse prior effects.
- Replaced four malformed separator characters introduced during editing, and labeled card rewards explicitly noncash. The dashboard labels its combined allowance figure Budget used, with purchase/debt subtotals.
- One new UI test initially queried a collapsed bill-details section; it now expands the section before checking the inherited treatment. The migration fixture initially rebuilt a referenced table with foreign keys enabled; corrected the isolated fixture setup to reproduce the real version-8 constraints. Neither failure changed user data.

## Actual checks

- Full existing Rust baseline: **84 passed, one deliberately ignored OCR integration test**. Eight new rewards/debt integration scenarios pass, including the final wrong-direction import rejection additions: **92 covered core cases** in total. Native OCR was verified in the earlier import section and was not rerun here.
- Full existing browser baseline: **52 passed**. Five new cases pass across focused runs/reruns: manual card reward and bank-only ordinary income, loan-form failure/retry, loan-bill inheritance, explicit import treatment controls, and reports/filtering/edit preservation. **57 covered browser cases** in total. Native commands are mocked in these tests.
- Real temporary SQLite integration covers actual account signs and balance estimates; edits changing account/month; stale and invalid mutations; itemized shared debt and later-month partial refunds; Chelsea-paid debt without Jacob account movement; loan bill retry/link protection; import retries, duplicates, direction conflicts and undo; actual old event CHECK-constraint upgrade with bill/refund/checkpoint preservation; and rejection of corrupt reward activity or debt allocations before replacing active data.
- Clippy `--all-targets -- -D warnings`, Rustfmt, Prettier and production TypeScript/Vite/Tauri build passed. Nonfatal incremental hard-link fallback warnings persist in this filesystem.
- Visually inspected synthetic compact Light reward and Dracula debt forms. The form body scrolls to the remaining controls/actions. Existing theme/navigation baseline passed; this is not a full accessibility audit.

## Delivery and remaining gaps

`builds/Personal Finance Preview - Rewards and Debt.exe`: **15,779,840 bytes**, schema 9. Release and copied artifact share SHA-256 `F594F832F1FEDD7D547099143667AC9FB2FCCDE694250F85BC1F32A96C14B0F0`.

No real financial database was opened or migrated. This checkpoint is not the final live-data build. Issuer-specific adapters, native WebView end-to-end, actual Explorer drop/clipboard interaction, provider credentials, installer and second-device behavior remain unverified. Next: reconciled household opening balance and PayPal receipt/cash-out allocations, followed by the remaining approved queue without routine user approval.
