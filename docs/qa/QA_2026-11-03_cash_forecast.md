# Checking cash timeline - November 3, 2026

## Scope and outcome

Schema 27 adds a read-only checking forecast over 7, 30, 60 or 90 days. Opening estimates use end-of-day checkpoints plus effective account-date movements, with accepted coverage, missing ranges, assumed dates and last source observation visible. The selected monthly budget remains separate from cash.

Saved bill/cash occurrences and virtual future schedule slots are combined without creating occurrences, transactions or audit records merely by opening the forecast. Overrides, cancellations and actual matches are preserved. Shared bills use their full checking outflow. Savings transfers, expected pay, direct household settlements and explicitly planned net PayPal deposits are included by account. PayPal-held repayments alone never become checking cash.

Card-to-checking funding choices are explicit and persistent. Reviewed remaining incremental obligations count once; carried statement face totals are never summed. Partial payments reduce only their linked obligations. Unallocated payments, stale obligations, missing cycles and unreviewed post-close credits stay qualified or unknown. Future cycles estimate known unbilled liability and scheduled card charges; card bills do not also appear as direct checking withdrawals. Credit balances carry into later projected cycles.

Possible recorded matches are held for review. Unfulfilled cash/bill plans due today or earlier are excluded until matched, cancelled or rescheduled because they may already be in opening activity. Reviewed overdue card debt remains outstanding and is assumed at the next forecast day, with its original due date disclosed. Same-day outflows precede deposits conservatively. The screen reports known-plan subtotals and unknown/excluded items, never an exact safe-to-spend amount.

Cash plans now support an explicit PayPal cash-out type. Record/reconcile the actual deposit in Shared expenses, then match it; the forecast does not invent receipt allocations or income. Settings use revisions, atomic payload-bound retries, audit snapshots and recovery validation.

## Findings and fixes

- Reproduced omitted future-dated card activity and duplicate future-dated pay: recorded movements now enter the correct account timeline/cutoff once, while plausible duplicate plans are held. Regression passes.
- Reproduced a bill duplicate risk when punctuation differed between the configured merchant and recorded description. Matching now uses the same normalized merchant text as the rule engine; the expected bill stays held rather than repeating the outflow.
- A repeated read returned warnings in arbitrary account order. Deterministic account ordering fixes unstable identical projections; the read-only fixture compares repeat results and proves no occurrence/event/audit writes.
- The expanded sidebar put Workspace & backups outside shorter windows. The full UI suite reproduced the inaccessible button. Sidebar scrolling now preserves access; the full final suite passes, including the original workspace-isolation test and every theme.
- Visual inspection found missing panel padding. Corrected spacing and inspected the final compact Light and Dracula views.
- Initial fixture failures involved an invalid non-UUID savings account, repayment without an owed balance, normalized timestamp expectation and an attempted close before month end. Corrected fixtures retain the real validation rules. The funding UI selector now uses its accessible combobox name.

## Checks actually run

- **263 core tests pass; 1 native Windows OCR case intentionally ignored** in the full final baseline. Ten new real SQLite cases cover read-only recurrence, three-paycheck months, full shared outflows, savings transfers, saved overrides/cancellations/matches, future recorded activity, partial/unallocated payments, carried debt, credit balances, PayPal holding/cash-out matching, coverage/posted dates/budget overrides/closed reports, unknown balances, same-day ordering, merchant normalization, settings retry/stale rejection, migration and corrupt restore.
- **144 mocked browser cases pass** in the final full suite, including all themes. Five new cases cover the forecast's assumptions and held amounts, horizon reads, dirty funding choices, write retry identity, successful write followed by failed read, delayed old-workspace results, explicit PayPal planning/matching and compact Light/Dracula layouts.
- TypeScript, Rustfmt, Prettier and Clippy with warnings denied pass. Production TypeScript/Vite/Tauri build passes. Vite retains a nonblocking chunk-size advisory (approximately 549 kB minified / 153 kB gzip); route splitting remains a packaging/performance consideration. Cargo hard-link notices are environmental.
- Final synthetic images: `.qa/cash-forecast-Light.png` and `.qa/cash-forecast-Dracula.png`, inspected after the padding/sidebar correction. Browser IPC is mocked; core tests use isolated real SQLite.
- No personal application database, real export, credentials or live financial record was opened or changed for QA.

## Delivery and limits

Verified artifact: `builds/Personal Finance Preview - Cash Timeline.exe`, **18,615,808 bytes**. Release and delivered copy share SHA-256 **3CBBBBDDE54143DD1157CDE1723FCD2CEA96D7881D1D0D2022C591484DC1C28E**. Older artifacts remain available; use this build or newer after schema 27.

Future discretionary purchases, interest, unconfigured accounts and timing changes are not predicted. Missing checkpoints remain unknown; incomplete coverage remains explicit. Forecast reads are anchored to today, independently of the selected budget month. Previously saved overdue expectations remain visible; virtual unsaved bill/pay slots start in the current month, rather than fabricating years of missed plans. Native WebView/Explorer interactions, issuer conventions, real provider requests, installer and second-device checks remain unverified where previously noted. This is not live-data acceptance.

The pay/statements/forecast section is delivered. Next: local text-layer PDF extraction and approved declarative bill/statement templates, then optional reviewed Claude/OpenAI hooks, encrypted laptop handoff/packaging and the final synthetic lifecycle. The full initial-scope objective remains unfinished; Jacob's live-data trial stays at the end.
