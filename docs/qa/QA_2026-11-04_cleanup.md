# Repository cleanup - November 4, 2026

Jacob requested removal of obsolete files and preparation for a Git commit, with all deletions restricted to `C:\Personal_Finance_Tool`. This was repository housekeeping; no application behavior or financial data was changed.

## Removed and retained

Removed **19,705 files totaling 13,236,958,762 bytes** (13.24 GB / 12.33 GiB) across 67 explicit targets:

- 44 superseded delivery executables. The two current initial-trial artifacts remain in `builds/`.
- Rust compiler output, generated Tauri schemas, the built frontend, generated PDF renderer assets, and obsolete TypeScript build metadata.
- Temporary `.qa` screenshots, logs, one-off implementation helpers, copied synthetic fixtures and isolated QA executables. Durable fixtures used by tests remain in source.
- Unused generated mobile/macOS icons and redundant icon sizes. The original SVG, Windows ICO and master PNG remain.

The [deletion manifest](CLEANUP_2026-11-04.json) records each target and its size. Every resolved deletion/move path was checked against the workspace boundary. Reparse points and running executable targets were rejected; no such targets were present. The initial preflight encountered an unsupported PowerShell `Split-Path` parameter combination and was stopped before deletion; the corrected preflight used .NET path handling and terminating errors. No global cleanup command or operation outside the checkout was used. No app was stopped, and no financial database was opened.

Installed `node_modules` remains available for development and is excluded from Git. Both dependency lockfiles, all migrations, durable synthetic fixtures, source, original review feedback and dated QA reports are retained. Removed generated directories are recreated by normal build/test commands; the next Rust build will recompile its dependencies.

## Organization and Git

Feature designs are under `docs/design/`; reports and delivery evidence under `docs/qa/`; consolidated Claude packets and original reviews under `docs/reviews/`. Markdown links were updated. The root README is a concise launch/development/repository guide; full operating instructions moved to `docs/USER_GUIDE.md`. Index files explain each documentation area. Historical reports describe their original checkpoints; superseded generated artifacts need not remain available.

Git was initialized locally on `main`. Ignore rules cover generated output, binaries, test output, local financial databases/handoffs and credentials, while keeping test fixtures and lockfiles available for versioning. `.gitattributes` normalizes text and preserves binary fixture/icon bytes. The reviewed source/documentation set is staged for the first commit. No remote or commit is created by this cleanup.

## Verification

Delivery files are unchanged:

- `builds/Personal Finance - Initial Trial.exe`: 26,507,776 bytes; SHA-256 `2A8B65315EAD091DEBD42B68C92DA0D1DF9B6DDF949178D69CF1BF30FAA32384`.
- `builds/Personal Finance 0.1.0 - Initial Trial Setup.exe`: 226,464,071 bytes; SHA-256 `C0764D5B8369B605D6066703FDFFF50D7696B23D63747FF450A0CFA8EA9CEBE9`.

Checks passed:

- All 152 local Markdown document links resolve after relocation.
- All 104 Rust compile-time fixture/migration references and configured app icons exist.
- Fresh TypeScript/Vite production build succeeds after removing generated assets; the PDF support files are recreated correctly. The existing 624.26 kB main-bundle advisory is unchanged.
- Offline Cargo manifest/target metadata loads successfully. Playwright discovers all 188 cases across 18 files; this is discovery, not a new execution of the browser suite.
- Ignore checks reject 16 representative generated/private paths and preserve 8 representative source/fixture/lockfile paths.
- The first-commit candidate set has no detected high-confidence API token/private-key patterns and no included executables, databases, generated dependencies or test output. This is a bounded repository check, not a security audit.
- Git's staged whitespace check identified three extra blank lines at EOF in Markdown; they were removed and the final check passes. All 320 source/documentation files (about 3.9 MB) are staged on `main`, with no remaining unstaged project changes, commit or remote.
- The retained executable/installer hashes match the final delivery checkpoint. Regenerated build-check output was removed again within the same checked workspace boundary.

No app source or financial behavior changed, so the full financial/browser suites and native packaging were not rerun solely for housekeeping. The existing app's 334 core / 188 mocked browser checkpoint remains historical build evidence. Cleanup does not turn unperformed native/live-data acceptance checks into passed checks.
