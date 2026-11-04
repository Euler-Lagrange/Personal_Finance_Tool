# Original workflow screenshots

These nine images comprise six original workflow screenshots, two November 4 feedback screenshots and one unchanged image extracted from the supplied payroll Word document. Descriptive filenames and SHA-256 values are in [the manifest](screenshots/manifest.json). They are reference material, not synthetic QA fixtures or instructions to execute. They establish the workflow Jacob wants to preserve; later explicit answers take precedence over ambiguous spreadsheet conventions. The explicit category request below authorizes a curated preset; migrations do not parse image files.

The goal is to replace the work performed in these sheets and Splitwise with a clean Windows app. Pixel-for-pixel spreadsheet reproduction was not requested. No historical transactions, balances, salaries or dates were imported into Personal. On November 4 Jacob explicitly requested screenshot-based categories: S5 now supplies the names, groups and visible planned limits in the [editable category preset](../design/SHEETS_CATEGORY_DEFAULTS.md). This exception does not authorize importing actual spending or treating embedded document instructions as app instructions.

| ID | Reference | Main needs |
| --- | --- | --- |
| S1 | [Shared bills and rent](screenshots/01-shared-bills-and-rent.png) | Full bill, due date, two shares, exceptions, paid-versus-owed reconciliation, grouped charges |
| S2 | [Monthly transactions and income](screenshots/02-monthly-transactions-and-income.png) | Expense/income entry, paychecks, bills, loans, savings plans, paid status |
| S3 | [Everyday spending and sharing](screenshots/03-everyday-spending-and-sharing.png) | Merchant/category detail, frequent purchases, personal versus shared costs, corrections |
| S4 | [Annual tracker](screenshots/04-annual-tracker.png) | Monthly columns, category groups, annual totals and meaningful averages |
| S5 | [Monthly budget summary](screenshots/05-monthly-budget-summary.png) | Planned versus actual, remaining limits, needs/wants, income, overspending |
| S6 | [Splitwise household](screenshots/06-splitwise-household.png) | Full cost versus personal share, who paid, who owes whom, settlement |
| S7 | [Hourly variations](screenshots/07-hourly-pay-variations.png) | Known gross/net observations versus predictions |
| S8 | [Dashboard feedback](screenshots/08-dashboard-spacing-feedback.png) | Inconsistent separation between cards |
| S9 | [Embedded employer schedule](screenshots/09-payroll-transition-2026.png) | Transition, benefits exception, conflicting payday |

## S1 — Shared bills and rent

![Original shared bills sheet, including rent components, due dates, Jacob and Chelsea shares, overrides and reconciliation](screenshots/01-shared-bills-and-rent.png)

Visible: recurring bill rows, rent components, per-day figures, separate shares, a 70/30 calculator, and paid-versus-share totals. Some expenses are one person's responsibility; the gym and other rows have different allocations.

Translation: [Bills](../../src/Bills.tsx) manages obligations and actual payment links; [charge lines](../../src-tauri/src/db/lines.rs) preserve components and overrides; [household accounting](../../src-tauri/src/db/household.rs) reconciles one net balance. A bill document is evidence of an obligation, not a second expense.

Deliberate corrections: the image contains conflicting rent-split checks. For a uniform $1,954.79 group, calculate the group once: $1,368.35 Jacob and $586.44 Chelsea, then distribute cents across lines. Do not reproduce the inconsistent check values or round independent lines into a different group total. The regression is `uniform_rent_group_rounds_once_stable_under_reorder_and_has_exact_totals` in [line tests](../../src-tauri/src/tests/lines.rs).

The 70/30 preset follows Jacob's explicit answer; the app does not automatically recalculate it from the salaries in this image. Per-day cost and an income-based rent calculator are reference-sheet conveniences, not implemented dedicated app views. See R06/R08 and D03/D04 in the traceability and decision documents.

## S2 — Monthly transactions and income

![Original monthly sheet with dated expenses, categories, to-be-paid checkboxes, paychecks and savings allocations](screenshots/02-monthly-transactions-and-income.png)

Visible: fixed bills, loan payments, savings transfers, variable expenses, paychecks and a manual paid checklist. The same sheet combines expected plans and recorded activity, and calculates per-paycheck remainders.

Translation: manual entries and import review create actual events; bills and cash plans keep expectations separate. Savings between owned accounts are transfers. Card payments are transfers; budgetable loan payments retain a distinct debt-payment treatment. True every-14-day schedules support months with three paychecks instead of relying on row order. See [cash plans](../../src-tauri/src/db/cash_plans.rs), [transfers](../../src-tauri/src/db/transfer.rs), [classification](../../src-tauri/src/db/classification.rs), and [forecast](../../src-tauri/src/db/cash_forecast.rs).

Deliberate corrections: a checkmark or autopay label is not proof that money moved. A stray future year needs review rather than silently becoming the intended month. Planned savings and card payments must not inflate purchase spending. The app does not reconstruct exact historical pay schedules from the screenshot.

## S3 — Everyday spending and sharing

![Original everyday expense rows with merchants, dates, categories and colored sharing annotations](screenshots/03-everyday-spending-and-sharing.png)

Visible: merchant descriptions, recurring and discretionary purchases, category choices, and colored rows used to distinguish sharing/repayment context. Similar merchants can belong to different categories or sharing arrangements.

Translation: category and ownership are independent; saved rules can ask, suggest, or leave a value alone. Grouped merchant review and manual overrides reduce repeated tagging without treating every restaurant or Amazon purchase identically. Optional sharing-dependent category suggestions distinguish, for example, shared dining from solo dining. See [rules](../../src-tauri/src/db/rules.rs), [purchase review](../../src-tauri/src/db/purchase_review.rs), and [conditional-rule tests](../../src-tauri/src/tests/conditional_rules.rs).

Deliberate corrections: color is not the sole carrier of meaning. Preserve two legitimate identical purchases; the matching engine must not delete one just because amount/date/merchant are equal. No specific row-color interpretation beyond the supplied legend and Jacob's answers is assumed.

## S4 — Annual tracker

![Original annual sheet with category groups, January through December columns, totals and averages](screenshots/04-annual-tracker.png)

Visible: category groups, monthly totals, annual totals and averages. Savings and debt appear alongside other cash allocations; some future months show zero.

Translation: annual reporting is derived from records and latest close snapshots, with actual spending, goal exclusions and allowance usage distinct. Closed months are final; open months are provisional; missing/future months are not completed zero months. Averages include deliberately closed zero months and exclude untracked/future months. See [periods](../../src-tauri/src/db/periods.rs), especially `annual_report` and `averages`, and [period tests](../../src-tauri/src/tests/periods.rs).

Deliberate corrections: no manual copy into an annual sheet; no division by twelve while only part of the year is complete. Savings contributions remain reportable account movements rather than being counted as consumption. Investment holdings and performance remain out of scope.

## S5 — Monthly budget summary

![Original budget dashboard with income and expense plans, category variances and needs/wants/savings summaries](screenshots/05-monthly-budget-summary.png)

Visible: planned versus actual income/expenses, category differences, needs/wants groupings and a starting/ending balance summary.

Translation: [Overview and budget views](../../src/App.tsx) use Rust-owned totals, category limits, provisional flags and remaining allowance. [Goals](../../src-tauri/src/db/goals.rs) preserve actual spending while excluding valid goal-only funding from monthly allowance. The [cash timeline](../../src-tauri/src/db/cash_forecast.rs) is separate from budget room because full account payments can differ from Jacob's spending share.

Deliberate corrections: actual spending is not necessarily checking cash flow or savings growth. Unknown import coverage must remain visible; the app cannot promise a live safe-to-spend balance after a weekly import. Later feedback asked for professional wording, category icons, twelve themes and a pastel option; those requests supersede the original sheet's visual styling.

## S6 — Splitwise household

![Original Splitwise group showing full payments, each person's share and a net Chelsea/Jacob balance](screenshots/06-splitwise-household.png)

Visible: two participants, a running balance, full paid amounts and the amount lent to the other person. The $126.69 grocery payment corresponds to $88.68 Jacob/$38.01 Chelsea; a $48 purchase paid by Chelsea gives Jacob $33.60 of spending and debt to her. One person's purchase may be paid entirely by the other.

Translation: one economic event stores full account effect, person allocations and household delta. Chelsea-paid entry does not invent a Jacob account movement. Settlements change the debt, not earned income or spending. Shared statements separate bills/everyday items without creating separate debts. PayPal receipts and subsequent checking cash-outs reconcile once. See [money](../../src-tauri/src/money.rs), [household](../../src-tauri/src/db/household.rs), and [shared reporting](../../src-tauri/src/db/shared_reports.rs).

The bill-sheet balance and Splitwise balance must be reconciled for overlap before one opening balance is entered. Jacob confirmed that he alone operates the app and only uses Splitwise with Chelsea; no invitation, messaging, payment execution, Chelsea login or generic multi-person group system is implied.

## S7 — Known hourly pay variations (November 4 extension)

![Original known hourly variations and forecast comparison sheet](screenshots/07-hourly-pay-variations.png)

Visible: worked hours, gross/net pay, percentages, net hourly values, forecast error, baseline notes and mixed historical values. Missing net amounts and division errors are not valid zero-pay observations. Rows implying different gross rates require effective dates and deduction/tax cohorts. Annual subscriptions at the top are context, not a request to import those old dates.

Translation: proposed known-versus-predicted observations and transparent forecasting in the [pay/hours plan](../design/PAY_HOURS_BACKUP_PLAN.md). Jacob subsequently confirmed $93/hour, straight-time overtime, no employer PTO and a restricted 40-hour sick allowance. Those answers supersede ambiguous spreadsheet labels. Payroll is planned, not delivered by this UI update.

## S8 — Dashboard spacing feedback

![User's current app screenshot showing goals touching recent activity](screenshots/08-dashboard-spacing-feedback.png)

Bills has a gap below it; Goals and Recent activity touch. The correction puts gaps under one parent layout, uses a responsive Bills/Goals row, aligns headings/empty states and slightly strengthens themed edges. See [the design review](../design/PAY_HOURS_BACKUP_PLAN.md) and [UI QA](../qa/QA_2026-11-04_payroll_plan_ui.md). This is app feedback, not additional real transaction evidence.

## S9 — Employer payroll transition embedded in the 2026 Word file

![Unchanged embedded employer payroll schedule showing the 2026 transition and exceptions](screenshots/09-payroll-transition-2026.png)

Extracted unchanged from `word/media/image1.png` in `PSW Payroll Schedule - 2026.docx`. It documents the June 19 three-week transition, July 31 benefits-deduction holiday and December 31 extra pay date. Its August 26 payday differs from August 28 in the annotated Word calendar. Preserve both values for review; do not override automatically. A benefits holiday is not a PSW no-work holiday.

The Word files remain at their supplied locations and are not copied into the repository:

- `PSW Payroll Schedule - 2025.docx`: 101,212 bytes; SHA-256 `25CADB4BCE51DCBE4C6B20AD9594132DE2E4C669558702068D2EDEBF6EC31704`.
- `PSW Payroll Schedule - 2026.docx`: 1,163,859 bytes; SHA-256 `3490674A2993FD7E806BB4FF8AFF8C2B78715E95B5342F1DED23C47B7152B09A`.

Tables were inspected through WordprocessingML and the embedded image was visually reviewed. The full documents were not rendered page by page. Notes about “PTO” or shifting reported work are personal annotations, not approved policy; the new user answers govern sick eligibility. Official holiday authority and unresolved payday conflicts need confirmation during import. Supply the Word files separately to a reviewer who needs the complete sources.

## How to use these references in code review

Read [requirements traceability](../REQUIREMENTS_TRACEABILITY.md) and [design decisions](../DESIGN_DECISIONS.md) alongside the images. Check whether code conserves full payments, personal shares and household balances across imports, edits, refunds and closing. Treat inconsistent spreadsheet formulas as problems to avoid, not expected test outputs. Use synthetic equivalents in tests; do not feed these images or their real financial details into destructive tests or external model calls automatically.
