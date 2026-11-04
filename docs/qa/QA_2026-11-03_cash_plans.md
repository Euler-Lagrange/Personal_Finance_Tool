# Dated cash plans and actual matching - November 3, 2026

## Scope and outcome

Schema 24 adds a Cash plans view for expected paychecks, bank/savings transfers and household settlements. One-time, anchored weekly/every-14-day, monthly and twice-monthly schedules generate stable dated events. Short months clamp explicitly; two scheduled slots on the same clamped day stay distinct. Holiday/date/amount/account overrides apply to an individual event. Expected plans never create ledger income, spending or account activity.

Existing dated events retain their saved plan. A changed schedule affects dates not yet generated. Once dated events exist, cadence changes require ending the schedule and creating another; individual dates remain editable. Ending cancels unmatched slots after the end date; archiving cancels unmatched events from today onward. Matches and prior history remain. Re-enabling does not silently restore cancellations.

Explicit matching selects one compatible actual transaction by kind, bank endpoints and direction. Nearby dates/amounts are suggestions only. The selected actual amount fulfills the event with a visible variance; no remaining expected difference is invented. One actual transaction cannot fulfill multiple plans. Recording a missing actual transaction writes both entry and link atomically with a retry receipt, using its real date and optional explicit budget period. PayPal-held settlements remain outside checking.

Matched transactions protect financial fields, deletion and import undo until explicitly unlinked; descriptions/notes remain editable. Matching does not modify financial totals or erase closed history. Migration/recovery validates schedules, stable slots, compatible links and operation receipts. Workspaces remain isolated.

## Findings and fixes

- Reproduced a UI issue where unlinking could discard an unsaved plan note. Unlink is now disabled until the note is saved or discarded, with explanatory text. The regression failed before the fix and passed afterward.
- Rechecked schedule revision, cadence and account eligibility inside the write transaction. Event generation re-reads schedules after backup to avoid using a concurrently ended/edited schedule.
- Initial new UI fixture failures came from an exact wrapped-select label lookup and a mock delay incorrectly applied to both workspaces. The test uses the accessible combobox name and delays only the intended old workspace. Final six-case cash-plan run passes.
- Initial native test assertions inspected household-only rows for non-household income/transfers; corrected to the selected month's ledger. The authoritative accounting checks then passed.
- No known correctness/data-loss/workspace-isolation defect remains in this section. Complete cash forecasting and card statements remain the next dependencies.

## Checks actually run

- **237 core cases passed, 1 native Windows OCR case intentionally ignored**, full suite after schema 24. Seven new real SQLite scenarios cover anchored and leap/short-month cadence, legitimate same-day slots, no money from planning, overrides, ended/archived history, changed net pay, suggestions without automatic matching, exact retry behavior, guarded edits/deletion/import undo, actual savings/PayPal settlements, closed-period overrides, stale changes, final-write rollback, schema-23 migration and valid/corrupt restore.
- **128 distinct mocked browser cases pass**: full 128-case baseline had 126 pass plus two fixture failures; the final six-case cash-plan run passed after fixture corrections and the unsaved-note regression fix. Other frontend components were unchanged after the baseline.
- TypeScript, Prettier, Rustfmt and Clippy with warnings denied passed. Production TypeScript/Vite/Tauri build passed. Cargo hard-link fallback notices are environmental; Vite emits a nonblocking 500 kB chunk-size advisory (current JS about 517 kB minified / 146 kB gzip). Packaging/performance review can split routes later if warranted.
- Synthetic compact Light and Dracula views were inspected. Native WebView operation was not claimed from browser mocks.
- Only synthetic fixtures and temporary databases were used. No personal application database or live exports were opened, migrated or restored.

## Delivery and next work

`builds/Personal Finance Preview - Cash Plans.exe`, **17,775,104 bytes**. Release and delivered-copy SHA-256: `64CFFB8051B92457CECB1EED364267048B828C623EB6B1E193ED4DF8C86E9CFA`. Previous artifacts retained; use this build or newer after schema 24.

Continue the same queue section with calculated/confirmed card statements, explicit payment allocation and the checking cash timeline. Plans are not yet a safe-to-spend forecast. Statement/PDF/provider/device and installer checks remain in their approved sections. Native Explorer/clipboard/drop and actual issuer conventions remain unverified. Jacob's live-data trial stays at the end.
