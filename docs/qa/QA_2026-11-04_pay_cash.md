# QA — payroll financial integration, November 4, 2026

Release 0.7.0 / schema 42. Synthetic temporary workspaces only; no personal payroll, balances, credentials or issuer files used.

## Scope

Explicit approved cash plans and generic-schedule takeover; account-split expectations and partial/combined deposit allocations; financial edit/delete/import-undo guards; recorded-work finalization; annual worked/paid separation; retained close explanation; migration, restart, restore and actual encrypted handoff.

## Findings and fixes

- Changing hours/rates without selecting a different prediction originally left the cash approval looking current. A failing regression now passes after comparing the retained calculation with current inputs.
- Moving a takeover date later could restore a generic paycheck alongside an active payroll estimate. A failing regression now passes; overlapping active plans must be completed/cancelled first. Explicit release has the same guard.
- An older category-upgrade test pretended a schema-35 fixture was current while omitting later payroll infrastructure. The stricter financial reference check exposed it. The fixture now supplies a complete current schema for customization/close, then removes later infrastructure before exercising the real upgrade. Production validation stays strict.
- Compact visual inspection found glued status/actions, then a shared 20px last-column rule. Spaced actions, block schedule captions and explicit equal payroll columns now remain readable at 1100px in Light/Dracula.

## Evidence

Full native baseline: 375 passed, one fixture failure, three environment/live tests ignored. After correction, that fixture and all seven payroll-cash cases passed: **376 distinct core cases verified**. Full mocked browser suite: **216 passed**; final layout workflow rerun passed. Clippy all-targets with warnings denied, TypeScript, formatting and release manifest agreement passed. Final Windows installer build runs the production TypeScript/Vite build. Existing chunk-size advisory remains nonblocking.

Coverage includes source-import undo protection, simultaneous generic/payroll allocation rejection, no income creation, old omitted-default replay hashes, corrupted reference restore rejection, retained close after later prediction selection, cross-year work/payment dates and encrypted handoff. Browser tests exercise draft/error retry, explicit duplicate acknowledgements, deposit revision/partial amount, takeover, timesheet review and annual presentation. Four Light/Dracula cash/annual screenshots inspected, with final cash screenshots rechecked after CSS corrections.

Native WebView interaction, high-DPI/manual accessibility, actual bank/paystub agreement and physical second-device behavior remain final-trial checks; browser mocks do not establish those. Managed destination backups are the next section.

## Delivery

Verified files and SHA-256 values are recorded below after build/copy validation.
- `builds/Personal Finance.exe`: 28,690,432 bytes; SHA-256 `F73B2693E7447572565948DF84BDE4F7BABCA4372C2B109921C96F4D78135EBA`.
- `builds/Personal Finance Setup.exe`: 227,003,515 bytes; SHA-256 `B0865C1671F33BA55AB22840039FFB84B1D032A5A6A7F54CDC2C42A05CBAD96A`.
- Production build and byte-for-byte delivery verification passed; no running application stopped. Logs: `.qa/pay-cash-build.log`, `.qa/pay-cash-delivery.json` (local disposable evidence).
