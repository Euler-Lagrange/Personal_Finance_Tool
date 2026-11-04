# Card statement cutoff review - November 3, 2026

## Scope and outcome

Schema 25 delivers card-cycle configuration, qualified cutoff calculations and manual issuer confirmation. Settings support usual closing/due days, due-month offsets, short-month clamping, first cycle month, date basis and pause. Unsaved estimates are read-only; saved cycles retain dates when settings change. Explicit per-cycle dates, signed issuer balance, reference note and source evidence are reviewed before saving. Negative balances remain credits.

Calculations start at a known end-of-day checkpoint and add subsequent card-side liability changes through the cutoff, using effective account posting dates by default. Purchases, payments, refunds and rewards keep their signs; budget overrides never move account chronology. Accepted inclusive complete coverage must span the entire checkpoint-to-cutoff interval. Missing checkpoints, gaps, assumed dates, pending review and future cutoffs remain qualified. Transaction-date mode remains an assumption. The current card balance is never substituted for the statement balance.

Saved issuer balances remain unchanged when later imports or corrections change the calculation. Differences and changed-review notices remain visible. Review fingerprints include supporting record revisions, so offsetting corrections invalidate stale confirmations. Atomic payload-bound receipts, evidence account guards, optimistic revisions and recovery checks protect history. Reviews create no expense, payment, checkpoint, income or household movement.

Payment allocation, explicit post-close credit/carry review and checking forecasts are the next dependency checkpoint. This is not the complete statement-payment/forecast section and makes no remaining-due or safe-to-spend claim.

## Findings and fixes

- A corrupt no-checkpoint calculation with a nonzero activity subtotal initially passed recovery validation. The synthetic regression reproduced it; recovery now rejects inconsistent no-checkpoint state, and the final case passes without changing the active workspace.
- Review fingerprints now include supporting movement/checkpoint/source revisions. A synthetic pair of offsetting corrections preserves the total but invalidates the old review token and flags the saved review.
- Statement evidence could otherwise be reassigned to another account. Configuration now requires removing the source from saved statement reviews first; same-account updates and explicit detachment remain possible.
- The first migration fixture compared two live report generation timestamps. It now closes the synthetic month before checking exact frozen-report preservation across schema 24 to 25.
- Initial browser failures were fixture issues: exact wrapped-select label matching and an encoded loading-text literal. Accessible combobox locators and a stable loading-text match fix those assertions. A Windows text-encoding round trip also affected newly edited statement UI text; UTF-8 was restored explicitly, all touched files were scanned, and final screenshots were inspected.
- Review covered incomplete calculations, retry payload identity, field edits clearing confirmation, failed refresh after a successful write, delayed old-workspace responses and compact theme layout. No known money, data-loss or workspace-isolation defect remains in this delivered dependency.

## Checks actually run

- **244 core tests passed; 1 native Windows OCR test intentionally ignored**, full final suite. Seven new real SQLite scenarios cover posting/cutoff/checkpoint boundaries, budget-period independence, pending/accepted/partial coverage, same-day checkpoints, payments/refunds/rewards, credit balances, leap dates, future confirmation rejection, preserved cycles, revisions, receipt rollback/retry, evidence reassignment, offsetting corrections, migration, valid/corrupt restore and workspace isolation.
- **133 distinct mocked browser cases pass** across the full baseline and final focused checks. The full 133-case baseline had 132 pass and the loading-literal fixture failure. All five final statement cases passed after correcting that fixture and the statement-only presentation text/encoding. Other app components were unchanged after the baseline.
- TypeScript, Rustfmt, Prettier and Clippy with warnings denied passed. The production TypeScript/Vite/Tauri release build passed. Cargo hard-link fallback notices are environmental. Vite's nonblocking chunk advisory remains: approximately 529 kB minified / 149 kB gzip; route splitting remains a packaging/performance consideration.
- Synthetic compact Light and Dracula screenshots inspected. Browser tests use mocked IPC; core tests exercise isolated SQLite separately. Native WebView/Explorer clipboard/drop, real issuer conventions and device/installer checks remain unverified.
- No personal application database, live exports or real financial records were opened, migrated or restored for QA.

## Delivery and next work

`builds/Personal Finance Preview - Card Statements.exe`, **18,137,600 bytes**. Release and delivered-copy SHA-256: `E22C15575015FDC130167408E0FC302EEB627FB1FEFB7C986486D5E23F091F46`. Previous artifacts retained. Use this build or newer after schema 25.

Continue automatically into exact-cent payment allocations, explicit post-close credit decisions and cumulative-statement carry reconciliation, then the checking cash timeline. Older unpaid balances may already appear in a later statement; forecasting must not add overlapping face balances twice. See CARD_STATEMENTS_DESIGN.md and CASH_FLOW_DESIGN.md. The remaining approved PDF, optional reviewed AI, encrypted laptop handoff and packaging sections stay active. Jacob's live-data trial stays at the end.
