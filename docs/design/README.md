# Feature designs

The [architecture](../ARCHITECTURE.md) defines the system boundaries; these documents explain individual workflows and invariants.

Authorized extension: [Pay, hours, annual calendars and OneDrive-folder backups](PAY_HOURS_BACKUP_PLAN.md). Weekly hours/sick policy and [reviewed calendar intake/periods](PAY_CALENDAR_DESIGN.md) are implemented. [Known-pay observations and manual/empirical forecasts](PAY_FORECAST_DESIGN.md) are implemented. [Offline withholding/calibrated models](PAY_WITHHOLDING_DESIGN.md) are implemented in 0.6.0. [Financial integration](PAY_CASH_INTEGRATION_DESIGN.md) is implemented in 0.7.0; [managed destination backups](MANAGED_BACKUPS_DESIGN.md) complete the extension in 0.8.0.

- Imports: [identity and coverage](IMPORT_IDENTITY_DESIGN.md), [PDF templates](PDF_TEMPLATES_DESIGN.md), [tables](PDF_TABLES_DESIGN.md), [destination reuse](PDF_REUSE_DESIGN.md), [original viewer](PDF_VIEWER_DESIGN.md), [optional AI](ASSISTANCE_DESIGN.md) with its [Claude API fix plan](CLAUDE_API_FIX_PLAN.md).
- Planning: [cash plans](CASH_FLOW_DESIGN.md), [card statements](CARD_STATEMENTS_DESIGN.md), [card payment allocation](CARD_PAYMENT_DESIGN.md), [checking forecast](CASH_FORECAST_DESIGN.md).
- Budgets and reports: [Sheets category defaults](SHEETS_CATEGORY_DEFAULTS.md), [goal funding](GOAL_FUNDING_DESIGN.md), [month close](MONTH_CLOSE_DESIGN.md), [budget-period overrides](BUDGET_PERIOD_OVERRIDE_DESIGN.md), [trends](TRENDS_DESIGN.md).
- Portability: [encrypted laptop handoff](HANDOFF_DESIGN.md).
- Usability: [context help and page descriptions](CONTEXT_HELP_DESIGN.md).

See [implementation status](../IMPLEMENTATION_STATUS.md) and [QA reports](../qa/) for delivered scope and verification limits.
