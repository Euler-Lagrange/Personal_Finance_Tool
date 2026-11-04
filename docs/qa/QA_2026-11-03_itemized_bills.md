# Itemized purchases and bill groups — November 3, 2026

## Scope and acceptance

Multiple category/charge lines on expenses, imported purchases and recurring bill plans; inherited group allocations and per-line overrides; original-line refunds; category budgets, household shares and a single account movement reconciling exactly. Partial/changed bill payments carry editable plan lines and require explicit amounts. Goal funding and closed-month corrections remain later sections.

## Review findings

- Centralized authoritative line allocation in Rust. The $1,954.79 group produces $1,368.35/$586.44. Largest remainders use stable line IDs for ties, and reordering does not change the result. Exact group-dollar shares apply to the inherited subtotal; explicit overrides are separate.
- Preserved immutable original allocations for refunds. Refund caps are checked per line as well as per purchase; a refund against an all-Jacob gift cannot consume another shared line's refundable balance. Earlier refund edits/removals revise affected later shares and revisions.
- Category totals now aggregate saved lines, while each event retains a single account effect. Bills/imports use the same core; linked financial edits/deletion and narrow undo remain protected.
- Recovery rejects line/header/category mismatches and damaged shares before replacing active data. Schema 6 fixtures migrate to one line per existing expense/refund without changing totals.
- Visual inspection found an undefined border token in the new line editor; corrected it to the shared theme token and checked Light/Dracula again. Browser fixture preview values were corrected to reflect the explicit sample allocations. Initial new-test failures were selector/fixture mistakes (exact label matching, two edit buttons, import row identity), corrected without weakening validation.

## Actual checks

- **78 core tests passed**, one Windows OCR integration test remains intentionally ignored in the normal suite (verified in the earlier import section, not rerun here).
- **49 browser cases passed** in the full suite. Three itemized-form tests passed again after the border-token/visual-fixture correction. Includes grouped payment editing, saved line IDs, category search, refund allocation and input preservation after failures. Browser commands are mocked.
- Nine new real-SQLite/core scenarios cover rent rounding, stable ties, overrides, bounds, budget/account reconciliation, Chelsea-paid changes, restart/restore/delete, partial/full line refunds, stale originals, bill→payment integration, import→refund→undo, failed writes, legacy migration and corrupted backups.
- Clippy `--all-targets -- -D warnings`, Rustfmt, Prettier and production TypeScript/Vite/Tauri build passed. Incremental compilation reports harmless hard-link fallback-to-copy warnings from the filesystem.
- Inspected compact Light and Dracula itemized forms. Dialog content scrolls; the browser checks report no page horizontal overflow at 1000px.

## Delivery and remaining verification

`builds/Personal Finance Preview - Itemized Bills.exe`: **15,669,248 bytes**. Release and copied file SHA-256: `CF10C8B777D759C6D41454CC8927E816FE7083597532D338A5F3ADE0597FC06C`.

No live financial data, provider credentials, native WebView interaction, Explorer drop/clipboard end-to-end, second-device or installer check was performed. The current section is a synthetic QA checkpoint, not a declaration that the whole app is complete. Account checkpoints/tracking modes, rewards/debt and PayPal reconciliation continue automatically; BUILD_QUEUE.md retains the remaining approved scope.
