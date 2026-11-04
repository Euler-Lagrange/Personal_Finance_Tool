# Category rollover and historical carry corrections — November 3, 2026

## Scope and outcome

Schema 22 adds per-category Reset/Carry policies, default Reset. The budget editor saves the month's base limit and an effective-dated policy beginning that month. Future saved policy changes retain their own dates; closed periods cannot be changed implicitly. Available allowance is base limit plus incoming signed carry. Actual spending, income, accounts, goals and household debt are unchanged by a carry adjustment.

Month close previews the current signed remainder, all previously applied carry from that source/category, and the new difference. First close normally targets the following month. A changed historical close suggests the current open month; an explicitly reopened later historical month can be selected instead. The reviewed destination, reason and acknowledgement are required when money changes. Closed destinations remain blocked.

Every adjustment records source month/category, destination, previous cumulative output, new output, difference, close operation and reason. Closing and its adjustments commit atomically. Repeated retries/reopen/reclose cannot repeat a delta. Original lines keep their destinations, so reclosing a successor uses its actual incoming amounts and does not recarry a correction already applied elsewhere. The preview shows prior destinations. Recovery verifies the correction chain and its agreement with closed snapshots.

Monthly bars, over-budget indicators and annual totals use available allowance and expose incoming carry separately. Budget copying retains base limits without copying prior carry. Archived category history remains visible. Schema-21 close fingerprints and frozen report contents survive migration unchanged when no new policy/carry applies.

## Findings and corrections

- Reproduced a failed destination-review load leaving the earlier checklist enabled. The UI now marks that preview unavailable, disables acknowledgements/submission and permits correcting the destination or reloading. The regression fails before the fix and passes afterward.
- An initial visual test treated Appearance as a popup, but it navigates to Workspace settings. The test now returns through Monthly budget before checking the controls; no application behavior was changed for that fixture issue.
- Annual compatibility rendering now treats an absent incoming-carry field in older snapshots/fixtures as zero instead of producing an invalid total.
- Budget writes check both the prior base limit and category-policy token. Identical retries use a payload-bound receipt; stale edits and failed audit writes leave no partial budget/policy/carry changes.

## Checks actually run

- **216 distinct core cases pass**, using the full 215-case baseline and final eight-case rollover run with an added budget-copy/archive scenario. One native Windows OCR test is intentionally ignored by the standard suite.
- **112 mocked browser cases pass** in the final full suite. Five new workflows cover effective policy/base limits, retry identity, historical differences, closed destination/reconfirmation, failed preview, discard/save-refresh behavior and compact Light/Dracula controls.
- Real SQLite scenarios cover three-month carry chains, signed overspending, repeated corrections/recloses, deliberate reopened destinations, reset reconciliation, goal-only funding and later refunds, stale destination tokens, atomic audit rollback, preserved schema-21 snapshots and valid/corrupt restore.
- TypeScript, Prettier, Rustfmt and Clippy with warnings denied passed. Existing Cargo hard-link fallback notices are environmental. Synthetic Light/Dracula screenshots were visually inspected; the longer close dialog scrolls within the modal.
- QA used only synthetic mocked UI and temporary databases. No actual account exports or personal application databases were opened, migrated or restored.

## Delivery

- `builds/Personal Finance Preview - Rollover.exe`
- **17,592,320 bytes**. Release and copied executable SHA-256: `DB5B62617BF148969401C6272C2B2DAC96FAAC9BF065BB0D75059AAE8BF7E5DF`.
- Production TypeScript/Vite/Tauri build passed. Previous executables remain available; no running app was stopped. Use this build or newer after schema 22.

## Remaining work and verification gaps

This completes signed carry and the correction path after explicit reopen. The separate late-entry budget-period override and basic merchant/category trends remain the next dependencies of the same queue section. A late transaction currently requires reopening its actual month; the app does not silently move its date. Prior corrections are retained in their recorded destinations, not automatically relocated when another month is reopened.

Native WebView/Explorer/clipboard/drop, issuer conventions, provider credentials, second-device handoff and installation remain unverified. Forecasts/statements, local PDF templates, optional reviewed AI and encrypted handoff remain in the approved build queue. All live-data testing remains reserved for Jacob's final trial.
