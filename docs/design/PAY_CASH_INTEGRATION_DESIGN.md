# Payroll and financial integration — section 5

Implemented in release 0.7.0 / schema 42; see [QA](../qa/QA_2026-11-04_pay_cash.md). Implements the approved extension's expected-income, deposit reconciliation, annual and month-close workflows using synthetic fixtures only.

## Boundaries and invariants

Payroll facts/predictions never create income. An explicit cash-plan approval chooses a saved prediction and one or more checking/savings destinations whose allocations equal its net estimate. The period has one stable payroll cash plan; later prediction or calendar changes show a difference until explicitly approved. Cancellation and completion stop expected cash without deleting actual deposits or history.

An existing generic paycheck schedule can be taken over from a reviewed date. Its affected slots are suppressed and marked managed by Pay & hours, including slots not yet materialized. This avoids a second forecast while preserving the original schedule and prior matches. Releasing a takeover is explicit and requires clearing overlapping active payroll plans first. Other generic income plans near the same payday require an explicit duplicate review; no automatic matching based solely on an amount.

Deposits are allocations of existing ordinary income entries, selected with their current revision. Multiple deposits can fulfill a period and one combined income entry can be allocated across periods, without exceeding its full amount. Each allocation's account must be a configured destination. Refunds, transfers, rewards and household repayments cannot qualify. Monetary/date/account changes and deletion/import undo of allocated entries require unlinking first; description/notes remain editable. Cash-plan matching and payroll matching cannot claim the same event independently. Closing a paid month requires acknowledgement of unfinished payroll reconciliation; payroll edits remain separate from the immutable financial snapshot.

The checking timeline shows only the remaining expected amount for that destination, or none after explicit completion/cancellation. Possible unallocated nearby income holds an expectation for review instead of silently double counting it. Recorded account activity remains included exactly once by the existing cash engine. Forecast-versus-deposit variance is separate from the known-paystub net comparison.

Annual payroll reporting separates dates worked (daily hours and exact earned gross) from dates paid (known paycheck facts, approved estimates and allocated bank deposits). Missing actual work stays unknown rather than becoming zero; predictions are labeled and never added to income totals. Finalizing a period retains a timesheet snapshot with its own status; later edits visibly invalidate that status rather than rewriting it. Month close retains a dated payroll explanation alongside its existing totals, without making the hours ledger financially authoritative.

New omitted-default snapshot fields preserve old replay hashes. Pure history validation is separate from current account/event references; old unlinked events may legitimately be deleted. Current reference validation, mutation guards, idempotency and all feature writes remain atomic. Recovery and encrypted handoff must retain matching, snapshots and old closed reports. No real payroll/account data is used for these checks.

## Acceptance evidence to record

One versus duplicate expectations; schedule takeover and release; rejected stale writes/retries; split/partial/combined deposits and over-allocation; correction/unlink/edit/delete/import undo; exclusion of refunds/transfers/settlements; expected amount replacement; month/year boundary and worked/paid separation; close/reopen/finalization; migration/restart/restore/tamper/handoff; full core/browser baselines and Windows delivery.
