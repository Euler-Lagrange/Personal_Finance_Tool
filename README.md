# Personal Finance Tool

A Windows desktop app for monthly budgeting, bills, savings goals and Jacob/Chelsea shared expenses. Ordinary finance workflows work offline. Optional Claude/OpenAI assistance produces proposals that must be reviewed before application.

Version **0.8.0** completes the reliability, Pay & hours and managed-folder backup extension. It adds encrypted destination backups, automatic copies while open, owned retention and reviewed restore. **384 core and 221 browser cases pass** across full baselines and final focused checks. Three prior live Claude requests using synthetic statement/transaction PDFs and CSV also passed with the saved Sample-workspace key. Actual issuer exports, other provider tasks/models, native paste/drop behavior, clean-PC installation and physical laptop transfer remain separate acceptance checks. See [current backup and extension QA](docs/qa/QA_2026-11-04_managed_backups.md).

## Open the app

The current build combines the Sheets-based **25 Needs/Wants categories plus Uncategorized**, editable planned limits, fourteen themes and context help with Claude's API fixes. It preserves custom categories and saved monthly budgets. Claude defaults to `claude-opus-5-5` at high effort; mapping proposals fit the structured-output limit, errors distinguish billing from throttling, completed requests display token usage, and original PDFs are page-counted independently of local text extraction.

- [Standalone application](builds/Personal%20Finance.exe): the current combined app; uses the installed WebView2 runtime.
- [Windows installer](builds/Personal%20Finance%20Setup.exe): the same app with Microsoft's offline WebView2 installer.

Review categories in **Accounts & categories → Categories & defaults**, then apply them through **Monthly budget → Copy budget limits**. Configure Claude in **Imports → Optional AI providers**. Provider settings and keys are separate for Sample and Personal; the saved Sample key passed the live synthetic check. See the [current QA report and hashes](docs/qa/QA_2026-11-04_managed_backups.md) for exact evidence and remaining limits. Open **Pay & hours → Pay settings** to set the rate/effective date, then enter weekly hours and review annual holiday/sick setup. Payroll documents can be browsed/dropped/pasted within Pay & hours, then reviewed before calendar application. Use **Pay variations** for known facts and hourly scenarios, and **Paychecks → Predict pay** to retain a manual or empirical estimate. Add reviewed withholding profiles in **Pay settings**; predictions can use offline tax rules or bounded calibration from earlier known paychecks. Approve expected pay and reconcile existing income in **Pay & deposits**; review worked-versus-paid results in **Annual payroll**. Open **Workspace & backups → Folder backups → Set up folder** to select a OneDrive/local folder and retain a recovery passphrase. Remember it on this Windows device to enable automatic copies while the app is open. Cloud sync is not verified. The [authorized build queue](docs/BUILD_QUEUE.md) is complete; actual records remain reserved for your final trial.

Close older Personal Finance windows first. Both are unsigned personal preview builds. No development server is needed. Delivery files are local artifacts excluded from Git; a fresh checkout must build them or obtain a verified release separately.

Superseded executables are removed only after verified replacement and lock checks; an older locked copy may remain temporarily. Use the current link above. No running app is stopped during delivery.

Start with the [live-data trial guide](docs/LIVE_TRIAL.md). Full operating instructions are in the [user guide](docs/USER_GUIDE.md). Ordinary data and backups live in your Windows app-data directory, outside this checkout; the app shows the exact location in **Workspace & backups**.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | React/TypeScript interface and themes |
| `src-tauri/src/` | Rust financial core, SQLite migrations, import/provider logic and core tests |
| `src-tauri/fixtures/` and `src-tauri/src/fixtures/` | Durable synthetic PDF, spreadsheet, image and migration fixtures |
| `tests/ui/` | Playwright tests with mocked native commands |
| `assets/` and `src-tauri/icons/` | Source artwork and Windows app icons |
| `scripts/` | Build support, including local PDF renderer assets |
| `docs/` | Requirements, architecture, user guide and implementation status |
| `docs/design/`, `docs/qa/`, `docs/reviews/` | Feature designs, QA records and review history |
| `builds/` | Current verified app and installer; ignored by Git |

The [documentation index](docs/README.md) links the current requirements and records. The [complete Claude review packet](docs/reviews/CLAUDE_REVIEW_CURRENT.md) is retained as one shareable Markdown file.

For Claude's independent code review, begin with [CODE_REVIEW_GUIDE.md](docs/CODE_REVIEW_GUIDE.md). It links the original screenshots, a requirements-to-code/test matrix, design rationale, current architecture and explicit verification gaps. Nine source references are preserved under `docs/reference/screenshots/`; they are separate from synthetic test fixtures.

After updating those canonical documents, run `npm run docs:refresh` to rebuild the current sections of the consolidated packet; `npm run docs:check` detects stale content. If sharing the Markdown outside this checkout, include its nine linked screenshot files too.

## Develop on Windows

Use Node.js/npm, the Rust MSVC toolchain and Visual Studio C++ Build Tools. Desktop development needs WebView2; browser tests use installed Microsoft Edge. Keep both `package-lock.json` and `src-tauri/Cargo.lock` in Git for reproducible dependency resolution.

```powershell
npm ci
npm run desktop
```

`npm run dev` runs the interface alone; native financial storage requires `npm run desktop`. The `predev` and `prebuild` scripts recreate ignored PDF renderer assets from the installed package. Tauri recreates its generated schemas and compiler output when building.

## Verify and build

Follow [AGENTS.md](AGENTS.md) and the [section QA workflow](docs/DEVELOPMENT_WORKFLOW.md). Use synthetic fixtures and isolated databases. Run Cargo commands sequentially.

```powershell
$env:CARGO_INCREMENTAL = '0'
npm run check
npm test
npm run test:ui
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npx prettier --check src tests/ui
npm run build:desktop
```

`build:desktop` writes `src-tauri/target/release/personal-finance.exe`. `npm run build:installer` additionally writes the NSIS installer under `src-tauri/target/release/bundle/nsis/`; initial packaging can require downloads of bundler tools and the offline WebView2 runtime.

Copy a delivery into `builds/` and verify its SHA-256 against the build output. Keep only the current app and installer, plus a prior version only when explicitly needed for rollback. Do not overwrite or remove a running executable. Record delivery hashes in `docs/qa/` and update the launch links above.

The Windows OCR environment check can be run separately:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml windows_ocr_reads_synthetic_transactions_locally -- --ignored
```

## Git and generated files

The repository excludes installed dependencies, executables, `dist/`, Rust `target/`, generated Tauri/PDF assets, `.qa/` output, local financial databases/handoffs and credentials. Durable test fixtures and both dependency lockfiles remain versioned. Line endings are normalized by `.gitattributes`.

The November 4 [cleanup report](docs/qa/QA_2026-11-04_cleanup.md) records removed artifacts and verification. Old checkpoint reports retain their historical filenames/hashes even when the corresponding generated files have been removed.
