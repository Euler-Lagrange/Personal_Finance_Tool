# Reusable import defaults QA - November 3, 2026

## Scope and acceptance

Schema 15 saves verified classification choices for the same account, exact format/mapping and named download profile. The editor preserves previously configured type codes even when they are absent from this file. Remember and automatic-processing choices are separate. A source-only change does not erase a saved profile; saving with automation off disables future automatic use for that profile. Defaults can be saved after every row is processed or from an empty confirmed export.

Confirming a later download range can process verified rows with the matching enabled profile in one native transaction. Coverage, download-pattern changes, financial records, identity links, source policy and the retry receipt commit together. The range form has a per-import pause switch. A hint before confirmation can populate the editor but cannot authorize records. Unknown types remain unclassified account activity; unreliable amounts, dates or identity stay held. Existing manual financial edits remain intact through overlap reconciliation. First-time defaults still require explicit processing/saving; no issuer-specific convention is presumed.

Range confirmation appears before the processing settings. Settings stay disabled until a range exists, avoiding unsaved choices that would be ignored during automatic confirmation. Undo removes only eligible records/links from the selected operation; saved defaults remain and the confirmation explains this. Earlier migration data does not acquire enabled profiles automatically.

## Findings and corrections

- The previous zero-decision early return would discard settings changes when no rows needed processing. Metadata-only actions now persist settings and an idempotent receipt, with no invented financial entries. Empty-source and fully-processed-source cases cover this behavior.
- Remapping an account, column mapping or worksheet clears the source-local policy. Reusable lookup independently requires the exact account/format/mapping/profile context. Cross-account, changed mapping, changed profile and sample/personal isolation are exercised.
- A synthetic database write failure after range confirmation rolls back coverage, source revision, records and the receipt. Retrying the same operation after the fault is removed succeeds once; a lost response returns the existing receipt. Changed payloads and stale/undone operations are rejected.
- Browser QA caught a layout refactor placing the settings panel inside each pending row. It was moved to one source-level panel after range confirmation; all 30 import browser cases pass afterward. A test locator was also corrected to read the alert containing both error text and its reload button.
- Merchant sharing remains limited to expenses; a focused invariant check verifies that an exact reward treatment does not create shared spending or household debt.

## Checks actually run

- **148 core tests pass** across the full 146-case passing baseline and the final 8-case profile suite, including two later additions. One Windows OCR integration case remains intentionally ignored in the standard suite.
- Eight new core scenarios cover persisted defaults, overlapping exports and manual edits, unknown types and malformed rows, account/mapping/profile/workspace scope, atomic rollback, retries, undo, per-source pause, disabling automation, empty exports, reward accounting, schema-14 migration and invalid backup rejection. Tests use real SQLite in temporary workspaces.
- **80 browser cases pass** across the full-suite baseline and final 30-case import rerun. The three new cases cover interrupted coverage responses, per-source pause, absent source codes, disabling automation with zero pending rows, source-only preferences and disabled setup before range confirmation. Native IPC is mocked.
- Final Clippy with warnings denied, Rustfmt, Prettier, TypeScript/Vite and Tauri release builds pass. Existing hard-link cache fallback warnings were nonfatal.
- Final synthetic Light and Dracula layouts visually inspected. No actual financial database was opened or migrated for QA.

## Delivery

- `builds/Personal Finance Preview - Import Defaults.exe`
- **16,706,048 bytes**. Release and delivered copy match SHA-256 `F6E3BA10EC7F147EDAD766D210E44874C4361E31CEF15AD0D8E7D5F94F3B81CC`.
- Earlier builds retained; no running app was stopped. Use this build or newer after schema 15.

## Remaining work

Next: verified payment/transfer source-code conventions with explicit counterpart accounts, then grouped merchant review and keyboard/batch handling. A PAYMENT-like description or the sum of purchases must never alone prove a payment. Existing explicit movement reconciliation remains available. This is an import dependency checkpoint, not completion of the broader approved goal.

Actual issuer exports, native Explorer drop/clipboard interaction, installation on another Windows device, encrypted handoff and real AI-provider calls remain unverified. PDFs remain evidence-only. Jacob's live-data trial remains at the end; independent work continues without routine monitoring.
