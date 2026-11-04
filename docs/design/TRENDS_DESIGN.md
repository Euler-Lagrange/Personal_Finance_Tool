# Basic spending trends

Read-only category and merchant/payee trends live in Annual reports. Use the same budget periods and closed-month totals as the annual report. Show twelve monthly values, signed changes, annual totals, and an average across closed months only. Missing/future periods remain blank; completed zero months count. Open months and unresolved activity are explicitly provisional.

Actual spending is Jacob's share after linked refunds, including goal-funded purchases, loan/debt payments and PayPal fees. Transfers, card payments, income, rewards and household settlements are excluded. Refunds belong to the original merchant in the refund's reporting period. Category details use exact saved line allocations; itemized purchases are not counted twice.

Merchant/payee grouping uses the current transaction description with case, punctuation and whitespace normalized, as existing merchant review does. It does not infer corporate ownership, apply new rules, or merge source identities. Labels and notes may change without changing frozen financial totals. The UI explains this limited grouping; advanced merchant enrichment remains follow-on work.

Selecting a category or merchant changes the chart and shows contributing transactions with actual dates, budget periods and personal amounts. Filtering a month narrows the details only. Search and sorting remain local to the already-loaded read-only report. Async requests must discard old-year/workspace results and hide stale results on failure.

Acceptance: reconcile both grouping totals with annual totals, including shared/Chelsea-paid/itemized/refund/goal/debt/fee cases; exclude payments and unresolved activity; preserve missing vs zero and final vs open; retain budget-period overrides and archived category history; no database writes. Synthetic UI checks cover filtering/drilldown, negative months, empty/error/loading/retry, stale requests and light/dark compact layout.

Implemented without a new schema migration; see [QA evidence](../qa/QA_2026-11-03_trends.md).
