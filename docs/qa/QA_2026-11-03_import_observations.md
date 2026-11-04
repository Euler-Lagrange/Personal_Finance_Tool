# Repeated download observations and saved patterns - November 3, 2026

## Scope and behavior

Schema 12 completes the repeated-observation and saved-pattern dependencies within import completion. Source-aware automatic classification, provisional accounting/sharing and grouped review are still next. All QA is synthetic.

- Stored evidence bytes are separate from source observations. Existing source IDs, raw rows, decisions, attachments, coverage and financial links survive migration. Multiple observations share one evidence BLOB, including empty downloads and identical files used for different accounts. Evidence quotas count unique bytes, not observation copies; backup snapshots still contain complete evidence.
- Ordinary duplicate intake reopens the latest existing observation and does not refresh coverage. **New download observation** explicitly creates another source review from identical contents. The user confirms that the fresh download has the same contents. The earlier source/range/decisions remain intact. Account/status and missing-year confirmation are renewed; no financial event or coverage is created by the observation itself.
- Creation uses a request UUID and parent revision. Repeating an interrupted request returns the same observation; stale parents, reused operation IDs and invalid UUIDs are rejected. The prior account is a visible suggestion, not a configured account. Reconciliation then uses the existing occurrence engine to link matching purchases without new spending.
- Saved patterns include manual dates, 1-366 inclusive trailing days, month to observation date and previous calendar month. Profiles retain name, date basis and completeness within account, format, image-status and mapping-layout scope. Suggested dates derive from the explicitly entered observation time, including leap-year boundaries. They never confirm coverage automatically. Manually changing dates selects manual mode and clears confirmation.
- Coverage and remembered-profile writes are one transaction. A pattern/date mismatch rolls both back. Raw evidence, observation ancestry, profile fields, bounds and existing identity provenance are validated before recovery. Source bytes are validated once per evidence object rather than once per repeated observation.

## Findings and fixes

- Reproduced a profile-boundary issue: OCR data with the same columns/mapping could inherit a complete CSV profile suggestion. Profiles now include format and image status in their key. The native coverage guard already rejected complete images; the fix also prevents the misleading suggestion. The regression checks that screenshot evidence does not inherit the export profile.
- Updated legacy-schema test fixtures to restore the original source table and embedded bytes before simulating older versions. This prevents fake downgrade fixtures from retaining schema-12 storage. Production migration preserves existing references with foreign keys checked before commit.
- Browser retries simulate successful observation creation followed by a lost response. The same request ID yields one new observation and retains the old coverage. Canceling the creation confirmation makes no native call. Dirty mapping edits disable creation; its confirmation discloses that unsaved range edits will be discarded.

## Actual checks

- Final full Rust suite: **122 passed, one native OCR case intentionally ignored**. Seven new integration cases cover byte deduplication, repeated confirmations, unchanged financial totals, empty observations across accounts/dates, stale/replayed requests, workspace isolation, saved pattern scope, atomic mismatches, leap-month limits, corruption and schema-11 migration/restore. The full existing bills/refunds/transfers/PayPal/account suite remains green.
- Full mocked browser suite: **71 passed**. Three new cases cover creation/cancel/retry with retained prior coverage, saved 90-day suggestions without silent acceptance, and calendar/manual-edit behavior. Existing source/currency/identity, compact layout and all-theme checks pass.
- Clippy `--all-targets -- -D warnings`, Rustfmt, Prettier and production TypeScript/Vite/Tauri build pass. Nonfatal incremental-cache hard-link fallback warnings remain.
- Visually inspected updated compact Light and Dracula coverage forms, including pattern controls and the separate remember/confirm choices. No clipped controls or page-width overflow was observed in those synthetic views.

## Delivery and limits

`builds/Personal Finance Preview - Import Observations.exe`, schema 12, **16,263,680 bytes**. Release and delivered copy SHA-256: `DF709882AC3903D13369919249DC012DDECC4FDCE37BA7B7F0C7BCD5F925D291`.

No real user database was opened or migrated. Native WebView/Explorer/clipboard end-to-end, actual issuer exports, provider credentials, installer and second-device behavior remain unverified. Separate observation creation confirms the user's statement about a fresh identical download; it cannot independently prove bank coverage. This is not the final live-data build. Continue automatically with source-aware imports, provisional totals and grouped review, then the remaining approved queue.
