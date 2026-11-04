# Explicit late-entry budget periods

The remaining approved close workflow must offer both reopen-and-add and an explicit, reasoned budget-period override. Actual transaction and account-posting dates remain unchanged. A budget period is a reporting/allocation choice, not a replacement transaction date.

## Intended behavior

- Default reporting period is the transaction's actual month. A user can explicitly assign a confirmed late entry to a later open budget month, with a reason. No import rule chooses this automatically.
- Monthly budget, annual allocation totals, goal exclusions and shared monthly statements use the selected reporting period consistently. Transaction rows and exports retain the actual date and disclose the override. Reports label that they use budget periods; cash/checkpoint and funding-evidence chronology continue using actual dates.
- A previously closed transaction cannot escape its lock by changing its budget period: removing its existing financial contribution changes the closed fingerprint and rejects. A newly discovered entry assigned to a later open period can be added without altering a frozen earlier close. Existing closed goal-funding dependencies still prevent invalidating supported exclusions.
- A closed override destination remains locked. Clearing an override returns the entry to its actual month only when all affected periods are open. Deleting or correcting an overridden entry follows normal revision/dependency guards.
- Monthly shared history sorts by reporting period then actual date and retains the one household balance. Frozen prior reports remain unchanged; the current statement includes the late adjustment visibly. Account movement dates and amounts remain independent of this reporting order.

## Storage and integration

Add an optional `budgetOverride` choice to entry input: absent preserves any saved choice; a choice with a month sets it; an explicit null month removes it. Store the effective month and reason in a separate event-keyed table. Apply it within the same transaction as manual/import entry creation or revision. Normal internal entry edits must not silently remove it. Omit absent values during serialization to preserve prior operation receipts.

Reporting queries use the override month or original date month. Physical account dates, import identity/coverage, refund ordering and goal-withdrawal chronology keep their existing actual-date rules. Close fingerprints use the reporting period for adjusted entries, including their account effects, while leaving unadjusted values byte-compatible with schema 22. Include the override's financial identity in the destination fingerprint, preserving existing closed snapshots on migration.

Use the same control in manual entries, transfers, refunds and individual import review. Saving an override requires an explicit choice and reason; no automatic batch gains an override. Visible badges, original-date context, statement exports and annual report labels make the distinction reviewable.

## Acceptance checks

Exercise late manual and imported purchases, identical-file retry/undo, legitimate duplicates, refunds, goal-only funding, transfers/card payments, shared statements, mixed batches, stale revisions and atomic failures. Confirm original account chronology and import identity remain intact. Verify closed originals cannot be moved, closed destinations reject edits, clearing needs open affected periods, and unchanged closed snapshots survive migration/restore. Test failed saves, unsaved edits, date changes, disclosure and compact light/dark controls using synthetic data only.

Basic category/merchant trend reporting follows this dependency, then the approved forecast/statement section. This design does not replace or reduce the remaining build queue.

Implemented in schema 23; see [QA evidence](../qa/QA_2026-11-03_budget_periods.md). Basic trends were subsequently delivered; see [trend design](TRENDS_DESIGN.md).
