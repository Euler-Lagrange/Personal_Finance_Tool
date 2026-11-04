# Card statement cutoff review

Schema 25 delivers the calculation and confirmation dependency of the approved statement/payment/forecast section. Payment allocation, post-close credit decisions, carry-forward reconciliation and the checking timeline follow automatically; this checkpoint does not claim those features complete.

## Behavior

Each card has a first cycle month, closing day, due day, due-month offset, date basis and pause control. Days 29-31 clamp to the last day of short months. A month view computes unsaved estimates without writing financial records. Reviewed cycles retain their original slot and saved dates when defaults change. Pause hides unsaved cycles but preserves reviewed history.

A cycle review can override nearby dates, select evidence assigned to that card and record a reason. Issuer-confirmed dates are required before confirming a signed balance; a negative amount represents credit. Future statements cannot be confirmed as issued. A review does not create a checkpoint, purchase, payment, income or household repayment. Confirmed amounts remain independent of the latest calculation.

## Calculation and uncertainty

Select the newest end-of-day checkpoint at or before the cutoff (or today for future cycles). Add all account liability changes strictly after that checkpoint through the cutoff. Card purchases, payments, refunds, rewards and known provisional account movements retain their signs. The account-side effective posting date controls the default calculation; a later budget period never changes it. The current card balance is not a substitute for the cutoff amount.

Complete coverage must span the entire checkpoint-to-cutoff interval. Coverage must be inclusive, accepted after row review, complete, and use the selected date basis. Excluded posted rows cannot establish completeness. Pending import rows, provisional recorded activity, assumed posting dates, future cutoffs and missing intervals remain visible. Transaction-date mode is always qualified as an estimate. A complete export without a checkpoint cannot establish a starting balance.

Calculation review captures dates, totals, gaps, accepted sources and a fingerprint of supporting records. Revisions and fingerprints invalidate stale confirmations, including offsetting ledger corrections. Later corrections can flag a saved review without rewriting the issuer balance. Difference means confirmed amount minus calculated subtotal; confirmation does not fill coverage gaps.

## Storage and QA

Configurations and saved cycles use optimistic revisions. Payload-bound operation receipts make retries idempotent; statement, receipt and audit writes are atomic. Attached evidence cannot be reassigned to another card until removed from those reviews. Restore validation checks schema, JSON/column identities, calculation arithmetic, ranges and receipts. Existing closed financial reports remain unchanged.

Tests use temporary SQLite workspaces and synthetic mocked browser data. They cover actual posting versus budget dates, checkpoint boundaries, incomplete/accepted coverage, payments/refunds/rewards, negative balances, leap-month dates, future confirmation rejection, changed defaults, stale reviews, offsetting corrections, evidence reassignment, receipt failure rollback, migration, restore corruption and workspace isolation.

## Payment allocation contract (implemented in schema 26)

Allocate only completed card-payment events, with exact-cent capacity shared across all statement allocations and explicit review of the card-side posting date. A payment already included at the cutoff cannot also reduce that issued obligation. Allocation must create no new account movement. Protect edits, deletes and import undo while dependencies exist.

Cumulative statement balances can include older unpaid debt. Do not sum overlapping face balances as separate checking outflows. Explicitly reconcile carried amounts and later payments before presenting a cash forecast; unknown overlap remains flagged. Post-close refunds/rewards affect current liability but do not automatically satisfy required payments. These workflows are implemented in the payment dependency described below.

## Payment dependency delivered

Schema 26 implements payment allocation, explicit credit decisions and carried-debt reconciliation. See [payment design](CARD_PAYMENT_DESIGN.md) and [QA results](../qa/QA_2026-11-03_card_payments.md). The checking timeline is delivered in schema 27; see CASH_FORECAST_DESIGN.md. The initial build queue is delivered with external acceptance and review limits listed in [the review guide](../CODE_REVIEW_GUIDE.md).
