# Checking cash timeline

The forecast is a read-only projection from known account activity through today, with a 7-90 day horizon. Opening it must not materialize bill/pay occurrences, add transactions, approve matches, or change budgets. Persist only explicit card-to-checking funding choices; no card is assumed to be paid from a particular bank.

Use an end-of-day checkpoint plus effective account-date movements for the opening subtotal. Reuse the statement coverage engine for gaps, unresolved rows and assumed posting dates, with bank-appropriate wording. Show observation time and make clear that imports are not live balances. Missing checkpoints leave amounts unknown. Monthly budget room is a separate quantity, never a cash balance.

Merge saved bill/cash occurrences with virtual future schedule slots. Preserve overrides/cancellations and match actuals once; use full gross remaining checking bills regardless of personal share. Unlinked plausible actuals hold the expectation for review. Overdue unfulfilled plans are shown separately and excluded until rescheduled or matched, because their amounts may already be in the opening balance. Reviewed unpaid card obligations remain outstanding and are placed at the next forecast day when overdue, with an explicit warning.

Cards contribute remaining incremental obligations, never cumulative statement face totals. Unreviewed/stale obligations or unallocated payments make the affected estimate unknown. Future cycles estimate known unbilled liability plus configured future card bills at their expected charge dates. Do not add those bills directly to checking. Unknown starting card balances, missing cycles, unresolved credits, or uncertain bill matches remain visible; future discretionary purchases and interest are not invented. Scheduled due dates and charge dates are assumptions, not issuer confirmation.

Explicit PayPal cash-out plans are supported by cash plans and matched to recorded reconciled cash-outs. Outside-account settlements alone do not increase checking. Planned cash-outs are expectations, not reconciliation or income.

Each timeline row has a source, date, amount or unknown reason, and included/excluded status. Running figures are known-plan subtotals; missing/held inputs are always displayed and no safe-to-spend claim is made. Same-day outflows are ordered first as a conservative timing assumption, with no promise about bank posting order.

Acceptance: synthetic checking/card/pay/bill/goal/settlement lifecycle; recurring slots and saved overrides; posted-date boundaries; actual/matched suppression; partial and carried statement debt; unallocated payments; incomplete coverage; unknown balances; same-day ordering; stale configuration and idempotent retry; migration and corrupt restore; read-only generation; UI loading/errors/workspace races, compact light/dark layout. Live/native/issuer/device checks remain for the final trial.

## Delivered checkpoint

Implemented in schema 27. See [QA results](../qa/QA_2026-11-03_cash_forecast.md) for the full synthetic regression evidence and verified Windows artifact. Previously saved overdue plans remain visible; virtual unsaved bill/pay slots begin in the current month. Forecasts anchor to today independently of the selected budget month. Remaining document/provider/device work stays in BUILD_QUEUE.md.
