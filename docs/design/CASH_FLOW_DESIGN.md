# Pay events, statements and cash forecasting

This section was implemented in schemas 24–27 after close/annual/trends, using synthetic QA checkpoints. No live account information was used for those checks. Jacob configures actual amounts/cadences in the app during the final trial.

## 1. Dated income and planned movements

Use explicitly configured dated schedules. Support anchored weekly/every-14-day pay, monthly or twice-monthly dates, and individual expected events. A 14-day cadence must produce three-paycheck months correctly; short-month dates clamp explicitly. Holidays and unusual amounts are per-occurrence overrides, not a guessed holiday calendar. Savings-transfer and settlement plans have independent schedules.

Expected events never create ledger income or account movements. Link actual matching deposits/transfers/settlements once, with visible source/account/date/amount. Recording a missing actual entry uses the existing ledger transaction and an idempotent operation receipt. End/archive schedules without erasing prior occurrences or matches. Editing a schedule does not rewrite an already reviewed occurrence. Unlink explicitly before financial edits to supporting actual entries; preserve notes, source identity, import undo guards and recovery.

## 2. Card statement obligations

Configure each card's usual closing day, due day, cycle relationship, short-month handling and activity-date basis. Preserve the scheduled dates as estimates until actual dates are confirmed. Each occurrence can override dates and amount with a reason/source. Calculate liability at the cutoff only from a known end-of-day checkpoint plus subsequent actual account activity; transaction budget overrides do not change this chronology.

Validate compatible posted-date coverage across the entire checkpoint-to-cutoff interval. No known starting balance means no calculated statement amount, even with a complete cycle export. Missing activity coverage or unresolved types makes the result incomplete; show known subtotal and gaps without implying accuracy. Compare any confirmed amount against calculation and expose discrepancies. No current card balance substitution.

Allocate actual card-payment transfers to one or more statements with exact cents, per-payment capacity and idempotent writes. Partial payment leaves remaining due. Payment allocation does not create another account movement or expense. Post-close credits affect current balance but do not automatically fulfill the issuer's payment obligation; adjustments require explicit review/evidence. Protect allocation dependencies through edits/import undo/restore.

## 3. Checking cash timeline

Start from an as-of checking checkpoint/estimate with coverage and last-observation context. Include full remaining scheduled checking bills, remaining card-statement payments, expected pay, planned savings and household settlements. Card purchases and card-paid bills belong in the statement estimate, not a second checking outflow. Matched/recorded activity must not also remain an expected movement. Use actual account dates and avoid reapplying movements already included in the opening balance.

Keep discretionary monthly budget remaining separate from projected checking cash. Pending PayPal receipts do not become checking cash until the cash-out is recorded; expected cash-outs require an explicit plan. Show dated assumptions, overdue/unmatched items and incomplete inputs. Weekly imports are not a live bank balance, and incomplete inputs never produce an exact safe-to-spend claim.

## Acceptance evidence

Test anchored 14-day cadence, short/leap months and overrides; repeated generate/link/record requests; end/archive behavior; actual versus expected amounts; mixed mutation rollback; stale revisions; migration and corrupt restore; import and closed-period dependencies. For statements, cover checkpoint boundaries, all liability-changing event types, partial coverage, two-sided payments, multiple statements, partial allocations, later refunds/credits and confirmed/calculated discrepancies. For cash, test a synthetic multi-account/month lifecycle with full shared cash outflows, goal transfers, PayPal holding/cash-out and no double counting. Verify empty/error/loading/dirty forms, workspace isolation and light/dark layouts in mocked UI. Native/issuer/device checks remain explicitly separate.

## Implementation checkpoint

Dated pay/savings/settlement plans and actual matching are implemented in schema 24; see [cash-plan QA](../qa/QA_2026-11-03_cash_plans.md). Saved occurrences retain their plan, explicit ending/archiving cancels unmatched later expectations, and cadence replacement uses a new schedule once dates exist. Card configuration, qualified cutoff calculation and issuer confirmation are implemented in schema 25; see CARD_STATEMENTS_DESIGN.md. Payment allocation and explicit post-close credit/carry review are implemented in schema 26; see CARD_PAYMENT_DESIGN.md. The checking cash timeline is delivered in schema 27; see CASH_FORECAST_DESIGN.md and QA_2026-11-03_cash_forecast.md. No live-data or native/issuer acceptance is implied.
