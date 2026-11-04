# Account checkpoints and tracking modes — November 3, 2026

## Scope

Opening/confirmed end-of-day balances, correction/removal history, signed cash/card values, estimated balances from later recorded activity, and imported/manual/untracked owned-account modes. Account type remains checking/savings/card. Untracked owned endpoints can participate in transfers without a displayed balance. Merchant payments remain expenses. This completes the balance sub-section; rewards/debt reporting, household opening and PayPal allocations continue next.

## Accounting and review

- Checkpoints create no expense, income, household debt, or account-activity event. Activity through the checkpoint date is already included; only later recorded dates through today affect the estimate. Missing imports may change it. No checkpoint means unknown.
- Positive card balances represent debt; negative balances represent a credit. This is separate from statement remaining due. The five-purchase/$624-payment test confirms spending counts once while card debt returns to zero.
- Duplicate dates, stale revisions, cross-account checkpoint moves, invalid/future dates, unsupported signed amounts and new balances on archived/untracked accounts are rejected without partial writes. Mode changes retain prior history.
- Deleting a checkpoint explicitly falls back to an earlier one or an unknown balance. It never alters transactions. UI confirmation and unsaved-input guards prevent accidental edits/removals; cancelling removal sends no mutation.
- Clippy flagged a manual range comparison; replaced with an inclusive range check. Visual review found account action buttons running together; stacked them with spacing. Amount/estimate labels now occupy distinct readable elements. A browser exact-text selector exposed the original combined amount/label markup; no financial failure was involved.

## Actual checks

- Full existing core baseline: **78 passed, one OCR test intentionally ignored**. All six new balance scenarios passed, bringing current covered total to **84**. The native OCR test was verified in the prior import section and not rerun here.
- Full browser suite initially **51/52** passed; after correcting the amount presentation, all three balance cases passed, and the compact-layout case passed again after action spacing. Current total: **52 passing cases** across baseline and focused runs. IPC is mocked.
- Real SQLite checks include signed balances, opening balances with no income, date boundaries, card purchases/payments, revisions/corrections/deletion, tracking/archiving preservation, valid restore, schema-7 migration and corrupt-backup rejection.
- Clippy `--all-targets -- -D warnings`, Rustfmt, Prettier and production TypeScript/Vite/Tauri build passed. Filesystem incremental hard-link fallback warnings remain nonfatal.
- Visually inspected compact Light account list and Dracula balance-history form. Updated action spacing is readable; no horizontal page overflow at 1000px in the browser case.

## Delivery and limits

`builds/Personal Finance Preview - Account Balances.exe`: **15,765,504 bytes**. Release and delivery copy SHA-256 `E99BA740B3A4351663802E294B71337232C3552C9E92BB8E4A9BDC63B1D925D7`.

No live data, bank connectivity, complete-coverage reconciliation, native WebView end-to-end, Explorer drop/native clipboard, installer or second-device verification is claimed. All QA used synthetic fixtures/temporary databases. User data was not migrated or opened. The autonomous build queue remains active, with live-data acceptance reserved for Jacob at the end.
