# Sheets category defaults — November 4, 2026

Jacob asked to start with the categories in his screenshots and make the default setup as close as possible to his current Sheets workflow. This is explicit authorization to use category names and visible **planned** amounts from S5, not to import historical transactions, balances, income, or actual spending. S2/S3 corroborate the monthly category names; the older annual sheet S4 and individual vendors in S1/S7 are not a second taxonomy to append indiscriminately.

## Preset

The authoritative preset is [category_defaults.rs](../../src-tauri/src/category_defaults.rs). Both new workspaces receive 19 Needs, 6 Wants and Uncategorized, with explicit icons. Personal remains free of sample transactions and saved monthly budgets; use **Monthly budget → Copy budget limits → Category defaults** to apply the template to the selected month. New Sample workspaces use the same defaults and retain synthetic activity. Every default remains editable in **Accounts & categories → Categories & defaults**.

| Group | Category | Monthly default |
| --- | --- | ---: |
| Needs | Rent/Water/Trash | $1,310 |
| Needs | Internet | $70 |
| Needs | Heating Gas | $48 |
| Needs | Electric | $100 |
| Needs | Cell Phone | $98 |
| Needs | Subscriptions | $62 |
| Needs | Gym | $89 |
| Needs | Car/Renter's Insurance | $110 |
| Needs | Life/Disability Insurance | $71 |
| Needs | Pet Insurance | $86 |
| Needs | Auto Loan | $920 |
| Needs | Debt Flex Slot | $0 |
| Needs | Debt Flex Slot 2 | $0 |
| Needs | Student Loans | $140 |
| Needs | CSU/Work Expenses | $206 |
| Needs | Gas | $50 |
| Needs | Groceries | $700 |
| Needs | RX/Counseling | $100 |
| Needs | Needs Flex Expenses | $360 |
| Wants | Dates/Restaurants | $425 |
| Wants | Hobbies | $270 |
| Wants | Otter Gifts | $100 |
| Wants | Solo Dining | $100 |
| Wants | Flex Slot | $0 |
| Wants | Wants Flex Expenses | $417 |
| Other | Uncategorized | $0 |

Visible line items add to **$4,520 Needs + $1,312 Wants = $5,832**. S5 displays a $4,519 Needs subtotal and a different heading amount; screenshots cannot reveal hidden fractional inputs or formulas. Copy the displayed individual limits as editable whole-dollar defaults and calculate totals from them. Do not alter an arbitrary category to force the subtotal to agree.

Heating Gas has a flame icon; Gas uses a vehicle icon. Shared dining and Solo Dining are separate. Category choice does not silently choose sharing or payment type. Auto Loan/Student Loans are available to budgetable debt-payment entries; credit-card repayments continue to be transfers. The general Subscriptions category stays separate from the Hobbies/Work/Dining categories used for particular subscriptions in S2. No merchant rules are invented from screenshot rows.

Savings accounts/goals and their contributions remain separate from expense categories. Income, rewards, refunds and budget rollover retain their existing event/allowance treatment. The cropped Savings section does not establish complete goal amounts, account ownership or opening balances, so those are not seeded here. Existing named goals are untouched.

## Existing-workspace upgrade

Schema **36** is a data migration, with no new table or column. [Store open](../../src-tauri/src/db.rs) backs up an old workspace before [upgrade](../../src-tauri/src/migrations.rs); restore candidates are upgraded in isolation. The entire migration is transactional and writes an audit record.

- An untouched, unused factory workspace with all ten original definitions adopts the precise monthly names in place and receives the missing categories.
- A used/customized workspace retains old category IDs and names. Missing precise categories receive new IDs if necessary; events, rules, bill definitions, monthly limits and close snapshots are not reassigned.
- Only original definitions matching **all** factory name/group/color/limit/revision/archive/icon fields qualify for default updates. Untouched broad starter defaults become zero when replaced by detailed defaults, avoiding duplicate future template amounts. Already saved monthly limits do not change.
- Matching category names are compared case-insensitively, including archived ones. Existing customized defaults, icons, names and archive choices survive; matching archived categories are not revived. Occupied IDs use a separate ID rather than overwriting a category.
- The schema version prevents reapplying the preset on later starts. Subsequent edits remain edits. Existing workspaces may have more than 26 categories because retained history/customization takes priority over an exact count.

Before copying into an already configured month, review older broad limits that overlap with detailed categories. The copy dialog shows the active default count/total and preserves existing limits, including explicit zero, unless replacement is explicitly selected. Archiving does not erase saved monthly limits. This preserves the existing monthly-budget contract rather than silently redistributing a user's plan.

## Presentation and QA

Overview intentionally remains a five-category summary. It now reports the shown count and active catalog count and links to **View all categories**. Monthly budget and category setup expose the full catalog; search, manual entry and editing continue to use native snapshot categories. The help text explains the sheet-based defaults and the separate treatment of goals.

Tests: [preset/core migration cases](../../src-tauri/src/tests/sheet_defaults.rs), [budget template tests](../../src-tauri/src/tests.rs), [mocked UI navigation/copy/search/entry flow](../../tests/ui/app.spec.ts). Coverage includes fresh/empty upgrade, customized/archived/case-colliding categories, explicit zero monthly limits, closed snapshots/locks, rollback, repeated upgrade, restart and recovery. See [QA record](../qa/QA_2026-11-04_sheet_categories.md) for actual results and delivery hashes. No live workspace was opened or modified for testing.
