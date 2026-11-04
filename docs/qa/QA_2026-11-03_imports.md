# Reviewed import section — November 3, 2026

## Scope

Delivered a reviewed offline importer: file selection, native drag/drop wiring, explicit clipboard image paste, per-file queue progress/retry/cancellation, persistent original evidence, CSV/TSV and Excel mapping, Windows OCR, source previews, individual and bulk purchase review, existing-event links, atomic/idempotent financial commits, and narrow undo. Existing manual forms and sample/personal isolation remain intact. This completes the reviewed-import slice, with the native interaction verification gap below.

No automatic posting, institution-specific adapter certification, complete overlap engine, refund/reward accounting, PDF extraction, recurring bills, AI, or bank reconciliation is implied. PDFs are evidence-only. Held rows do not affect financial totals, and incomplete sources are shown on the dashboard. Screenshot coverage is partial and every OCR row requires confirmation. Limits and the SQLite evidence-storage tradeoff are documented in README and implementation status.

## Findings and corrections

- **Excel amounts became dates:** calamine's generic date conversion accepts numeric cells. A synthetic workbook reproduced `$123.45` becoming `1900-05-02`. Conversion now applies only to date-typed cells; the regression test verifies both the real date cell and unchanged monetary cell.
- **Two-digit years:** a full-year parser accepted `26` as year 0026 and prevented the two-digit fallback. A regression reproduced the rejected date; filtering unsupported years before accepting a format now correctly reads `11/02/26` with either selected month/day order.
- **Saved operation followed by failed review refresh:** the source detail is cleared on reload failure so stale pending controls cannot invite another attempt. Existing revision/idempotency safeguards also prevent replay. In-flight mapping-profile responses are discarded when the user changes fields.
- **Repeat files versus repeated purchases:** exact bytes and normalized image pixels identify the source; equal transaction rows retain distinct identities. Tests preserve legitimate twins while duplicate candidates require linking or explicit separate-purchase confirmation.
- **Card payments on two exports:** five purchases totaling $624, a card-side payment import, and a linked checking-side payment row leave spending at $624, income at $0, and one payment event. Matching never uses the sum of purchases as proof of identity.
- **Partial writes and undo:** a bad final row rolls the entire batch back; retrying a committed operation returns its receipt. Edited/deleted/externally referenced imported events block undo. Multiple occurrences in one source cannot link to one event. Linking and exclusion can be undone without editing existing manual events.
- **Recovery:** schema 3 and older backups migrate in isolation. Damaged evidence bytes, invalid JSON, and broken decision/commit relationships are rejected before replacing live data. Source originals remain present after undo and restore.
- Two initial browser failures were test locator errors for nested select labels; accessible combobox-role locators fixed them. The full suite then passed. Theme capture uses the real picker and settled animations.

## Verification

- `cargo test`: **47 passed**, with one environment-dependent Windows OCR test excluded from the default run.
- Explicit Windows OCR integration: **passed** on a generated account screenshot, including merchant/amount extraction. This uses the real local OCR engine, not a mock. It does not establish accuracy on every bank layout or confirm missing rows.
- `npx playwright test`: **35 passed** with synthetic data and mocked IPC. Includes paste, file picker, native-event payload handling, batch failures, cancellation, unsaved form preservation, workspace switches, operation-ID retries, row review, bulk confirmation, all twelve existing themes, and compact layouts.
- Focused final theme capture covers Light, Dracula, and Marshmallow at 1440 and 1000 pixels. Screenshots are under `.qa/import-*.png`; the fixtures are synthetic. These checks are not a comprehensive accessibility audit.
- Clippy with `--all-targets -- -D warnings`: **passed**. Rust formatting, Prettier, and production TypeScript/Vite: **passed**. Cargo reported a non-failing incremental-cache hard-link fallback on this filesystem.
- Native QA configuration uses identifier `com.jacob.personal-finance.import-qa`, separate from the user's real application. Its debug executable built and exposed `Personal Finance - Import QA`. Computer Use inspection failed with **`Computer Use app approval timed out`**. Actual Explorer-to-app drops, native clipboard-to-UI behavior, and full native WebView review remain **unverified**, despite their mocked UI coverage. The QA process was closed afterward. No real personal database was opened, migrated, or restored.

## Delivery

Production executable: `builds/Personal Finance Preview - Imports.exe` (**15,051,264 bytes**). The standard production identifier is retained; launch it after closing older previews. Schema 4 upgrades existing data after making a recovery snapshot. The final native release build succeeded after the date fix. SHA-256 of both compiled and delivered copies: `DD6CD38E925B2C8F2184ED388170BA950418B20F71517AF2546B001A1A247366`; equality verified.

## Next section

Calibrate with representative Capital One 360 and card exports, add reusable merchant/category rules, then implement refund accounting and fuller overlap/payment reconciliation. A real export or account screenshot would help verify issuer conventions. Actual native Explorer/paste verification remains an explicit follow-up rather than a claimed pass.
