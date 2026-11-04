# Requirements and technical documentation reconciliation — November 4, 2026

Jacob requested current technical documentation for an independent Claude code review, with design choices tied to his needs and original screenshots. This checkpoint changes documentation, reference copies and a documentation-refresh script. It does not change financial application code, schema, real data or the delivered app/installer.

## Deliverables

- [Code review guide](../CODE_REVIEW_GUIDE.md): review order, evidence boundaries, high-value source paths, expected financial invariants, explicit limits and requested finding format.
- [Traceability matrix](../REQUIREMENTS_TRACEABILITY.md): 29 user/workflow needs mapped to rationale, production code, test files and limitations.
- [Decision record](../DESIGN_DECISIONS.md): 16 implemented choices with their motivating needs, tradeoffs and source evidence.
- [Current architecture](../ARCHITECTURE.md): runtime boundaries, actual storage/model, mutation/recovery paths, imports/AI, reporting, portability and resource limits. The old proposal is retained in historical review material.
- [Screenshot reference](../reference/SCREENSHOTS.md): six unchanged original images with descriptive filenames, hashes/dimensions, workflow interpretation and intentional corrections to spreadsheet conventions.
- Reconciled requirements/status and eight feature-design documents that still described already-delivered dependencies as future work. Historical QA/review records remain explicitly historical.
- `npm run docs:refresh` and `npm run docs:check`: refresh and verify the consolidated Claude packet's current review context, requirements and architecture while preserving original conversation/reviews and historical checkpoint sections.

## Findings made explicit

The current OCR/AI row flow is more conservative than the user's low-review goal; all such rows require individual confirmation. The 70/30 preset and participants are fixed, with per-record overrides but no global ratio editor or complete joint-finance mode. Generic file mappings are not certified issuer adapters. Local storage growth, physical device/native acceptance and constant preview-version numbering remain review boundaries.

Source inspection also identified a potential timezone-dependent coverage-validation rejection during restore/handoff: historical UTC observation instants are checked against the destination machine's local calendar. G07 in the review guide identifies exact source paths and a near-midnight reproduction scenario. This is a code-based hypothesis, not a newly executed runtime regression or a claimed fix. Prior same-timezone handoff tests do not cover it. No requirement was weakened to hide an implementation limit.

## Verification

The refresh check was first run against stale material and correctly failed, then passed after generation. A repeated refresh leaves the packet hash unchanged. Script/package formatting passes. All **791 local document/code/image links** resolve; all **29 requirement IDs**, **16 decision IDs** and explicit named regression references resolve. All **six original screenshot hashes** and both delivered binary hashes remain unchanged. No application source, migration or test file changed. Git whitespace verification is included in the final staging check. Financial/native/browser suites are not rerun solely for prose/reference changes; their original 334 core / 188 mocked browser evidence remains in [final build QA](QA_2026-11-04_final.md).

No screenshot was edited, used as a destructive fixture or transmitted to an API. Original attachment files outside the repository were only read/copied; nothing outside the project was deleted or changed. No Git commit, remote configuration or external Claude message was created.
