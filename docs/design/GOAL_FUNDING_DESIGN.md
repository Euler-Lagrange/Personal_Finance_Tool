# Account-backed goal funding

Implemented in schema 19. A goal references a unique real savings account. Target/date/monthly contribution and archive settings never create transactions. Its balance is the existing checkpoint plus subsequent effective account activity, with unknown retained when no usable checkpoint exists.

`goal_funding` assigns positive integer cents to one purchase line's Jacob share. Multiple assignments cannot exceed that share. Policy is snapshotted per assignment: `goal_only` or `count_monthly`. Editing a goal default does not rewrite saved assignments. The UI explicitly replaces an assignment identifier when applying the current policy.

Physical support is a real goal-to-checking withdrawal, a goal-to-original-card payment, or a purchase paid directly from that goal account. A withdrawal's total assigned amount across purchases cannot exceed its amount. Goal-to-goal transfers are not usable withdrawal sources, preventing double use of a chain. A missing link, unknown/negative source balance or unresolved source activity remains reviewable and provides no exclusion. A previously held assignment must be rechecked explicitly after evidence arrives. Later corrections can invalidate previously accepted support.

The budget projection preserves actual spending, purchase/debt consumption, household allocations and account activity. Only valid goal-only amounts reduce allowance usage. Refunds reverse the cumulative eligible fraction of Jacob's refunded share, rounded once across eligible goals and charged to the received month. A refund neither frees the original withdrawal's capacity nor creates a savings deposit. Actual returned cash is a separate transfer.

Writes replace an entry's assignments atomically with event/goal revisions, a confirmed review and a payload-bound operation receipt. Replaying the identical request is a no-op; reusing its identifier with changed payload rejects. Financial edits/deletion/undo of supporting entries are blocked until assignments are released. Dependent refunds must be removed before funding changes. Description and note edits remain available. Recovery validates structural allocations and sources while allowing reviewable unknown financial evidence.

## Implemented integration contracts and remaining review

- Month close must distinguish actual spending, goal exclusions and allowance usage. Pending funding affecting either a purchase or refund month prevents an unqualified close.
- Closing guards must cover transitive effects from checkpoint edits, account tracking changes, imported account activity, source posting dates and deletions. Checking only the changed event's month is insufficient.
- A pending funding assignment in an earlier month is included in the later refund month's `fundingReviewEntries` so the review action remains reachable.
- Contribution plans are scheduled expected cash outflows in the implemented forecast. No schedule itself creates a transfer or guarantees funding.
- Source date validation still uses the local calendar in coverage paths. Cross-timezone handoff/restore is an explicit code-review concern (G07 in [the review guide](../CODE_REVIEW_GUIDE.md)); same-timezone tests do not establish this behavior.
