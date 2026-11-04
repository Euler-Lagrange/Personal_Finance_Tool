# PDF transaction tables - November 3, 2026

## Scope

Schema 29 adds approved versioned templates for supported text-PDF tables. Exact identity/USD markers, ordered start/end markers on every page, explicit columns, and fixed pipe/tab/space/cell-line layouts produce pending rows in the existing importer. Each row retains page/line evidence. An explicit approval option enables automatic staging when exactly one active template recognizes a later document and all structural checks pass. Ambiguity/drift stays held. Staging posts no financial event.

Normal account/column/status/range confirmation, verified source defaults, matching, classification, refunds, transfers and undo remain authoritative. Provenance-backed PDFs can explicitly declare complete coverage; evidence-only PDFs cannot. Processed sources stay locked, and new observations retain provenance while renewing confirmation.

## Findings and integration

- Reproduced: recovery could accept a forged materialized row even though the saved PDF dataset/proof were intact. Restore now checks every row's ordinal, raw cells and parsed candidate against the approved PDF extraction and current column mapping; extra/missing rows are rejected.
- Real PDF fixtures include two equal purchases, five charges totaling $624 and a $624 payment across two pages. The resulting ledger preserves the twins, counts $624 of spending, and counts no extra spending for the card payment. A second overlapping PDF links the same six events. A new observation preserves table evidence. Month close followed by a $25 refund in November leaves October's saved report unchanged. Valid restore retains this history.
- Tests cover unknown/duplicate/missing markers, malformed row widths on a later page (no partial staging), Unicode, fixed layouts, unsupported separators, changed versions, paused/competing templates, repeated ingestion, operation retries, receipt/binding-write failure rollback, schema-28 upgrade, workspace isolation, restart and corrupt restore.
- Mocked UI covers approval/evidence/confirmation, automatic-staging choice, retry operation identity, mapping-edit invalidation, delayed previews, discard protection, staging into the existing mapping/coverage flow, processed locks, error/reload and compact themes. A failing UI test used the wrong existing button label; correcting its selector to Apply mapping resolved the harness failure.

## Checks

- Full core baseline: **283 passed, 1 explicitly ignored native Windows OCR test**. Final focused PDF-table run: **7 passed**, including the expanded close/refund lifecycle.
- Full mocked browser suite: **156 passed**, including five new table cases and all existing PDF document cases.
- TypeScript, Rustfmt, Prettier and Clippy with warnings denied pass. Windows release build passes. Environmental Cargo hard-link fallback notices remain nonblocking. Vite retains a 573.76 kB / 159.54 kB gzip bundle advisory for packaging.

All six pages of three synthetic PDFs were rendered and inspected. Compact Light/Dark table-evidence screenshots were inspected after allowing the existing theme transition to finish. Core tests use isolated SQLite; browser commands are mocked. No personal database, live export, credentials or real-provider call was used.

## Delivery and boundaries

Verified artifact: `builds/Personal Finance Preview - PDF Tables.exe`, **20,782,080 bytes**. Release and delivered copy share SHA-256 **58EE17F1FEBCE4E05F7F8282E87C7414C472E3D5E05A72DA68CA6B6156CEE1C6**. Use this build or newer after schema 29. Prior checkpoints remain available.

This supports bounded text layouts, not arbitrary spatial tables or wrapped descriptions. Every page must contain the chosen table markers; unrelated cover pages require a different supported export. Complete coverage remains an explicit user declaration, never inferred from row dates. Automatic staging only prepares rows; normal financial-import safeguards still apply. Document-field application to bills/statements remains separately reviewed. Native Windows paste/drop/export-folder, issuer, provider and second-device checks remain unverified where previously noted.

Next: automatic bill/statement target reuse, reviewed optional Claude/OpenAI assistance, encrypted handoff/packaging and final synthetic lifecycle checks. The full approved initial scope remains unfinished; live-data testing stays at the final user trial.
