# Merchant purchase review - November 3, 2026

## Scope and outcome

Schema 17 adds merchant-grouped review for recorded purchases from a selected import, including verified purchases still awaiting sharing. Select a whole merchant group or individual records, search groups, change category and sharing independently, and preview the authoritative budget/shared-balance effect before applying once. Alt+1/2/3 choose personal, 70/30 or equal sharing; normal checkbox keyboard selection remains available. Previous recorded choices are editable suggestions, never automatic replacements.

Remember for next time opens the existing separate rule preview. Saving that rule does not apply the current batch; applying the batch does not implicitly save a rule. Merchant grouping ignores case and punctuation while preserving numbers. Source descriptions remain matching evidence even when financial display descriptions change.

Batch writes are one SQLite transaction. They preserve amounts, dates, payers, accounts, notes and unselected fields. Category-only edits preserve unresolved ownership and its gross provisional allowance. Choosing sharing resolves verified pending purchases once without another account movement. Itemized/per-line overrides and purchases protected by bill/refund links remain visible with individual-review explanations.

Review history stores checksummed before/after values and source-link versions. Undo restores untouched allocations atomically with increasing revisions. Later edits, deletions, new/changed import links or financial dependencies block reversal. A successful untouched reversal restores original import-undo eligibility only where the before-version exactly matched that import's recorded revision. Retry IDs prevent repeated writes after interrupted responses. Migration and recovery preserve history; malformed snapshots cannot replace the active workspace.

## Findings and corrections

- A regression reproduced a category-only batch clearing the value of an existing exact-dollar split. Preview failed before any write. The correction clears numeric split values only when sharing actually changes; the final test verifies the exact share, note, unchanged household amount and undo. Exact-dollar choices remain visible but are not offered as a single reusable sharing value for a differently sized batch.
- A synthetic failure on the final history write rolls back all earlier row changes. Stale, duplicated and foreign-source selections likewise leave the entire batch intact. Retry after removing the fault succeeds once.
- Visual review found inherited form-label styling stacking purchase rows vertically and missing inner dialog padding. Scoped row direction and padding fix the layout; a focused browser assertion protects the horizontal arrangement. Theme screenshots disable transitions so they show the settled palette.

## Checks actually run

- **166 core tests passed**, with one Windows OCR integration test intentionally ignored in the standard suite. Eight new real-SQLite scenarios exercise atomic changes, independent fields, pending ownership, previews/exact-dollar overrides, last-choice/group normalization, refund/itemized protection, later edits/links, undo/import undo, interrupted writes, migration, corrupt recovery and workspace isolation.
- **87 browser cases passed** in the full baseline. All four new merchant-review workflows passed; the two affected visual cases also passed after the scoped layout fix. Checks cover keyboard actions, protected selections, filtering with retained selections, preview invalidation, independent previous choices, retry IDs, unsaved cancellation, rule preview separated from applying a batch, and guarded undo errors. Native IPC is mocked.
- Clippy with warnings denied, Rustfmt, Prettier and TypeScript/Vite/Tauri release builds passed. Final synthetic Light and Dracula layouts visually inspected; the compact dialog scrolls for its confirmation/actions.
- No real financial workspace was opened or migrated for QA.

## Delivery

- `builds/Personal Finance Preview - Merchant Review.exe`
- **16,886,784** bytes. Release/copy SHA-256 `0A92C5EDEFC8354B6BD1C2CFFDA172B1217ED7157DBBD77215263FF41A1832DD`.
- Prior builds retained and no running app stopped. Use this build or newer after schema 17.

## Remaining work and verification gaps

This checkpoint groups already recorded purchases, including pending ownership. Unprocessed/uncertain source rows continue through existing processing or individual/bulk import review. Sharing-dependent category rules and grouped handling of remaining held rows are next within import completion, then the broader savings/reporting/close/forecast/PDF/AI/handoff queue. The approved target has not been reduced.

Real issuer exports, Explorer drop/clipboard interaction, provider credentials, second-device handoff and installation remain unverified. PDFs are still evidence-only. All live-data testing remains reserved for Jacob's final trial.
