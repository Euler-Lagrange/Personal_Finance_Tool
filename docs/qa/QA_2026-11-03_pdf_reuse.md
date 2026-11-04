# PDF destination reuse - November 3, 2026

## Scope

Schema 30 adds explicit opt-in reuse of an approved bill/statement template and destination. A unique exact account identifier, the approved template version, identity/currency/field layout, and component arithmetic must pass before updating an obligation. Bills select their active schedule by due month. Statements require complete local calculation matching the issuer total. Table staging remains independent and may share the same PDF.

Automatic updates create no expense, payment, transfer, checkpoint or settlement. Conflicting confirmed values, manual due-date overrides, cancelled/archived schedules, large date shifts, multiple destinations and changed layouts stay in review. Failed updates retain the PDF and pending table rows with a held reason. Settings are revision checked and explicitly confirmed, with payload-bound retries and application provenance.

## Findings and integration

- Reproduced a manual due-date overwrite: an estimated December bill moved by hand to December 4 was automatically replaced by December 5. Automatic reuse now holds when a saved date differs from both its schedule and the extracted date. The regression verifies the original date remains intact.
- One PDF can stage transaction rows and update its card statement. Its row mapping can still be confirmed for the bound account; changing accounts or re-extracting approved source text is rejected. Backup/restore retains both evidence paths. Pending rows create no spending.
- Nine new native-core cases cover next-month bill creation, repeated bytes, marker mismatch, opt-in/pause/stale versions, operation retries, cancellation/archival, arithmetic/layout drift, date shifts, injected receipt failure with complete savepoint rollback, exact/incomplete/conflicting statement calculations, competing routes, schema-29 upgrade, restart, isolation and corrupted restore rejection.
- Four new mocked browser cases cover explicit opt-in/renewed confirmation, same-operation retries, pause, failed-read recovery, changed-version blocking, delayed reads across workspace changes and compact themes. A test initially filled the unchanged marker, so it did not exercise an edit; using a changed value corrected the harness. The table/core harness also needed an explicit amount-sign choice and paused automation while preparing the competing template.
- Visual inspection found checkbox text stacked below its control because of inherited column direction. The PDF checkbox rule now explicitly uses a row. Final Light/Dark views are readable at 1100 x 780.
- A verification run exhausted C: disk space in generated Rust caches. Only the resolved project `src-tauri/target/debug/incremental` directory was removed, recovering about 5 GB. Subsequent checks disable incremental caching; source, financial data and delivered builds were untouched.

## Checks and delivery

- Full core suite: **292 passed, 1 explicitly ignored native OCR test**.
- Full mocked browser suite: **160 passed**, including the existing theme suite. Focused PDF document suite: 11 passed; final new core integration suite: 9 passed.
- TypeScript, Rustfmt, Prettier and Clippy with warnings denied pass. Windows production build passes. Vite retains a nonblocking 576.68 kB / 160.30 kB gzip chunk advisory.
- Verified release/copy match: `builds/Personal Finance Preview - PDF Reuse.exe`, **20,759,552 bytes**, SHA-256 **E61E96E7CCD58B9D71FB37E90B8F1539539FDADBA100B8CE4D1575759EAD7051**. Use this build or newer after schema 30. Prior checkpoints remain available.

## Limits

Browser IPC is mocked; Rust tests use temporary synthetic SQLite workspaces. No personal database, issuer export, real account credential or provider call was used. Actual issuer layouts, native Windows WebView/paste/drop/export-folder and second-device behavior remain unverified. Bounded table layouts and source extraction limitations from the previous checkpoint remain. A statement whose imported rows are still unreviewed may need manual application after their review; automatic reuse never guesses completeness.

Next: reviewed optional Claude/OpenAI assistance, original PDF display, encrypted laptop handoff/packaging and final synthetic integration. Live-data testing stays at Jacob's final trial.
