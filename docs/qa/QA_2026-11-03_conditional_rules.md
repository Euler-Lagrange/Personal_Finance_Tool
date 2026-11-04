# Conditional categories and held merchant groups - November 3, 2026

## Scope and outcome

Schema 18 supports category rules conditioned on Personal, Shared, or Chelsea-only allocation. Unconditional rules remain supported. Sharing is resolved first from a selected review choice, merchant sharing rule, or source default; unresolved sharing keeps the category unresolved when a conditional rule could affect it. Conditional category rules cannot also change sharing. Existing specificity remains description constraint, account constraint, then exact over prefix; at equal specificity a matching condition outranks an unconditional category. Equal winning conflicts require review.

Individual, held-batch and recorded-purchase review can explicitly check category suggestions for the selected sharing. Suggestions never overwrite a manually chosen category without acceptance, and delayed responses are discarded after the context changes. Shared/equal presets retain shared intent even on penny amounts; zero/100 percent and exact-dollar allocations resolve to the appropriate person. Old unconditional rules retain their serialized signature shape and upgrade to Any sharing state.

Held source rows can be grouped by normalized merchant and selected with the keyboard. Group selection covers only the displayed rows, never undisplayed rows beyond the 250-row view. Purchase batches offer personal, 70/30, equal, Chelsea-only and custom-percentage choices, Alt+1/2/3 presets, optional separate rule saving, and an unsaved-choice close guard. Original source descriptions and identity keys stay unchanged.

Both native purchase-batch paths recheck posted USD source values, extraction reliability, image status, identity and existing matches, plus exact source-type mappings. Batch purchases must retain source amount/date/account/description and use ordinary non-itemized input. Screenshots, uncertain values/types and possible existing activity require individual review. Writes remain atomic and retry-safe, with the existing guarded import undo. Real identical purchases remain separate.

## Findings and corrections

- A new regression reproduced a saved exact type code requiring review being bypassed by Apply merchant rules after import undo. The shared native eligibility gate now protects both rule batches and explicit held purchase batches. The final test verifies rejection without spending and disables the ready suggestion.
- A mixed eligible/nonpurchase batch and a changed-source-amount batch reject without partially writing the valid rows. Replays remain blocked, valid identical twins post separately, and untouched undo survives backup/restore.
- Three new browser checks initially used exact text-label selectors that included nested select-option text. Accessible combobox-role selectors corrected the tests; the underlying workflows passed. A fixture label was also aligned with its synthetic merchant examples.
- Rule-preview copy now describes potential merchant matches rather than claiming that every match will pass sharing/type checks. Removed a malformed separator in native preview text. Unsaved batch choices survive a declined discard prompt.

## Checks actually run

- **175 core tests passed**, with one native Windows OCR integration test intentionally ignored in the standard suite. Nine added real-SQLite scenarios cover conditional categories, source/rule/selected sharing, conflicts/specificity, provisional budget behavior, manual choices, exact source gates, atomic failures, legitimate twins/replay, retry/undo, schema-17 upgrade and corrupt recovery.
- **91 browser cases passed** in the final full suite. Four added workflows cover conditional rule preview invalidation, explicit category acceptance, delayed responses, merchant-group keyboard selection, sharing shortcuts, unsaved cancellation and unsafe batch rejection. Native IPC is mocked.
- Clippy with warnings denied, Rustfmt, Prettier, TypeScript/Vite and Tauri release builds passed. Cargo emitted the existing environment hard-link-cache fallback notice; no code lint failures remained.
- Final synthetic Light and Dracula screens visually inspected. The tall rule dialog scrolls to its preview and actions; the grouped review remains legible with themed controls.
- No real financial workspace was opened, migrated or used for tests.

## Delivery

- `builds/Personal Finance Preview - Conditional Rules.exe`
- **16,923,136** bytes. Release and copied executable SHA-256: `9D3A9CEAC2E7C915BB9FD722FB62A3ECE64D67470608A9AD9EF1122E89238F37`.
- Prior builds retained; no running app stopped. Use this build or newer after schema 18.

## Remaining work and verification gaps

The core import/review workflow now includes the planned conditional category rules and held/recorded merchant grouping. Savings goals and funding continue next, followed by shared reporting, close/annual reporting, pay/statement forecasts, PDF templates, optional reviewed AI, encrypted handoff and packaging. Cross-feature integration remains part of those sections.

Actual issuer-specific exports/sign/status/identifier conventions remain unverified; reusable generic mappings and exact user-verified type codes are supported. Explorer drop/clipboard interaction, provider credentials, second-device handoff and installation also remain unverified. PDFs are still evidence-only until their queued section. All live-data testing remains reserved for Jacob's final trial. Historical observation-date recovery across different machine timezones must be addressed before portable handoff is complete.
