# Month close, annual reporting and rollover implementation

The approved scope is unchanged. Implement the dependency in two linked checkpoints: (1) close/reopen, financial locks, checklist and latest-close snapshots/annual reporting; (2) per-category signed carry, default reset, explicit historical correction previews and idempotent open-period adjustments. Advance automatically between them.

## Financial locks

Route every native mutation transaction through one commit guard. Compare a canonical financial fingerprint for each closed month before committing. Include that month's event financial fields and saved category/person lines, budgets, pending classifications, goal funding/exclusions and inherited funding dependencies. Exclude revisions and descriptive notes, so nonfinancial edits and later refunds do not lock an original purchase unnecessarily. Reject and roll back the complete operation if it changes a closed month. Keep original dates; the error identifies the month to reopen.

Closed account balance observations and bill obligations are snapshots, not claims that later payments cannot happen. A payment in a later open month may settle an older bill. Goals must remain supported: corrections affecting a closed month's funding exclusions require reopening the affected month. Broad import staging and source-evidence interactions need regression coverage, especially uncertain old evidence that could invalidate accepted goal funding.

Latest-close totals retain actual spending, consumption/debt, goal exclusions and allowance separately. Preserve one latest snapshot through reopen; replace it on reclose, with audit/backups retaining history. A reviewed token and revision prevent closing changed inputs. Capture acknowledgements for coverage gaps, uncategorized spending, unpaid/estimated bills and optional balance reconciliation. Uncertain posted money/type/sharing/funding is blocking; known uncategorized spending is acknowledgeable.

## Reporting

Closed monthly reports use their frozen snapshot; open reports use live records with Changed since close when applicable. Show future/missing months blank and explicitly tracked completed zero months as zero. Average only completed closed months and label that denominator. Keep actual goal-funded purchases in annual spending. Shared monthly exports preserve the close-time report while all-history reporting remains current.

## Rollover follow-through

One category setting: reset or carry signed remainder, reset by default. Savings, household/account balances and unpaid bills always persist independently. Carry affects allowance, never actual spending. Closing snapshots preserve the policy and remainder used at that close.

If reopening changes an already-carried remainder, preview the linked delta against prior applied corrections. Suggest applying it to the current open month with source/category/amount visible. Alternatively reopen affected periods. Closed successors remain unchanged. Reclose and repeated recalculation must reconcile prior corrections rather than applying the same delta twice. Test multi-hop, negative carry, goal-only exclusions, refunds, category changes, retries and recovery.

### Schema 22 implementation

Category policies are effective-dated changes, default reset. The budget editor changes the selected month's base limit and optionally the category policy beginning that month, until the next saved policy change. Base copying does not copy incoming carry. Archived categories retain their financial carry/history. Closed snapshots store their policy and incoming carry; changing a policy that would affect a closed month requires reopening it.

Carry is an append-only allowance ledger. Each nonzero line records source month/category, destination month, prior cumulative applied amount, newly calculated output, signed difference, close operation and reason. First close normally targets the next month. A changed historical close suggests the current open month; an explicitly reopened later month can be selected instead. The destination must follow the source and be open. Closing and all its carry lines commit atomically.

For a category, desired output is base limit plus incoming carry minus confirmed allowance use when Carry is enabled; Reset outputs zero. The new adjustment equals desired output minus the sum of all existing outgoing lines from that source/category. Original lines retain their destinations. A subsequent reclose or chain recalculation therefore uses the original incoming amounts and sees any already-applied correction in the source ledger, rather than propagating it twice. Existing corrections are not silently moved to newly reopened periods. The preview exposes prior destinations and only applies the remaining difference.

Financial fingerprints include effective Carry policies and all incoming/outgoing carry lines. Empty additions preserve schema-21 fingerprints. Close tokens also include the destination's financial fingerprint, so a changed preview must be reviewed again. Budget operation receipts bind retries to the same payload; expected base limits and policy tokens reject stale edits. Recovery validates the ordered correction chain, close reconciliation, policy dates, operation records and required tables before replacing a workspace.

This implements the rollover adjustment path after explicit reopening. The separate late-transaction budget-period override and basic merchant/category trends were subsequently delivered in the schema-23 checkpoint; see [budget periods](BUDGET_PERIOD_OVERRIDE_DESIGN.md) and [trends](TRENDS_DESIGN.md).
