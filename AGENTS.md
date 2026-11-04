# Project workflow

Jacob requested on November 3, 2026 that each build section include the same kind of QA/QC pass used for the manual-entry/setup preview. Treat this as part of implementing the section, without waiting for a separate request to test it.

- Follow [docs/DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md): define the section, implement it, review and test it, fix defects, verify the delivery, and record results before moving to another section.
- Protect financial correctness, history, and workspace isolation. Use synthetic fixtures and temporary databases for QA. Never use Jacob's actual financial data for destructive tests, restores, or migrations.
- Reproduce meaningful defects with regression tests where practical. Test externally observable behavior and financial invariants; avoid tests that simply mirror implementation or trivial cosmetic changes.
- Fix identified correctness, data-loss, and workspace-isolation defects before marking a section ready. Report unverified areas and deferred issues explicitly; a mocked browser check is not a native Windows end-to-end check.
- Complete relevant checks after fixes. Do not repeat passed checks without a new change, failure, or unresolved concern. Documentation-only edits do not require rebuilding the app.
- For delivered app changes, build the Windows executable, verify the delivered copy matches it, and update the launch link and implementation status. Do not stop Jacob's running app or overwrite a locked executable; use a new build filename when needed.
- Keep `builds/` limited to the current verified app and installer, with an older build only when explicitly needed for rollback. Remove superseded generated artifacts only within the project, after checking absolute paths, reparse points and running executables. Do not use global cache cleanup commands.
- Save a concise QA report for each completed feature section. Include scope, defects and fixes, actual check results, remaining gaps, and the delivered artifact. See [the November 3 report](docs/qa/QA_2026-11-03.md) for an example.

This checkpoint does not add a user-approval requirement for routine testing or fixes within the authorized section.
