# Build sections and QA/QC

Adopted November 3, 2026 at Jacob's request. Every substantive build section includes a QA/QC checkpoint before it is reported complete and work moves to the next section. Testing and corrections are part of the section, not a separate task that Jacob must remember to request.

Later November 3, Jacob authorized chaining all remaining approved sections without routine monitoring, including cross-feature integration tests as work progresses. Follow [the build queue](BUILD_QUEUE.md), advance automatically after each checkpoint, and reserve **all live-data testing for his final trial**. Use synthetic fixtures and isolated workspaces throughout autonomous development. External checks requiring actual credentials, issuer exports, a second device, or unavailable native permissions must stay explicitly unverified while independent work proceeds.

## Section lifecycle

1. **Define the outcome.** State the user workflow being delivered, its acceptance criteria, and what remains outside the section. Check the current requirements and implementation status.
2. **Implement the section.** Keep financial calculations in the authoritative native core, preserve existing records, and make error states understandable.
3. **Review beyond the happy path.** Inspect the affected code and follow realistic workflows. Include malformed input, edits, retries, interruptions, and relevant interactions with existing features.
4. **Reproduce and fix defects.** Add meaningful regression tests where practical, observe failure before the fix, and verify the corrected behavior. Also verify that rejection logic continues to accept valid cases.
5. **Verify the finished section.** Run the applicable checks below. Fix failures and rerun affected checks; repeat broader checks only when the changes or remaining uncertainty justify them.
6. **Deliver and record evidence.** Build the release executable for app changes, verify its copied artifact, update the README launch path and implementation status, and save a QA report. Summarize the outcome and any material limits for Jacob.

## What to review

| Area | Checks when affected |
| --- | --- |
| Money and accounting | Exact cents and rounding; allocation totals; account signs; separation of spending, income, repayments, and transfers; edits/deletes reversing prior effects; no double counting. |
| Imports and matching | Overlapping exports/screenshots, repeated paste, screenshot-to-CSV matching, legitimate same-amount twins, OCR uncertainty and cropped rows, refunds, transfers/card payments, ambiguous matches, source dates/signs, partial coverage, and partial failures. Add these checks as those features are implemented. |
| Storage and recovery | Atomic writes, stale revisions, restart persistence, old-schema upgrades, rollback, valid and invalid restores, retention, and unchanged live records after rejection. |
| Workspace and asynchronous work | Sample/personal isolation, rapid month/workspace changes, delayed responses, duplicate submissions, successful writes followed by failed refreshes, and retry behavior. |
| User interface | Main workflow, empty/error/loading states, keyboard use and focus, compact desktop layout, and readable amounts and labels. Import intake must cover paste/drop/browse equivalence, multi-file failures, progress, cancellation/retry, and unsaved edits. Verify native Windows file drops separately from browser mocks. Review representative light/dark themes; run the full theme suite when shared appearance changes. |
| Offline operation and privacy | Local assets and normal offline workflows; no unexpected external calls or financial-data exposure. Do not claim a security audit from these checks alone. |
| Delivery | Production build, correct executable copy and launch path, retained user data, and native smoke testing when available with an isolated test workspace/profile. |

Use synthetic data and temporary databases. Do not migrate, restore, delete, or otherwise mutate Jacob's actual databases for testing. Never present fixture screenshots as his records.

## Checks at a feature-section boundary

For substantive app changes, use the existing full core and browser suites as the baseline, plus focused cases for the new behavior:

```powershell
npm test
npm run test:ui
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npx prettier --check src tests/ui
npm run build:desktop
```

The desktop build already runs the TypeScript/Vite production build. Avoid an unnecessary duplicate build unless it helps diagnose a failure. Run Cargo commands sequentially to avoid competing for the same build directory; independent UI checks can run alongside them.

For a small fix, scale the checks to its actual risk and affected behavior. For documentation-only changes, verify content and links; do not rebuild or rerun financial tests solely for prose edits. Existing passed checks can count toward the checkpoint if no subsequent change invalidated them.

Browser tests currently use mocked native commands. Rust tests exercise real SQLite operations separately. Native WebView interaction, installation, and second-device behavior require their own evidence. If a tool limitation prevents one of these checks, document exactly what remains unverified and continue the independent checks; do not label the missing check as passed.

## Completion criteria and report

A section is ready for the next build section when its acceptance criteria are met, applicable checks pass, identified money/data-loss/workspace-isolation defects are fixed, and delivery evidence is recorded. Testing limitations or nonblocking issues must be visible in the report. A known serious defect keeps the section incomplete until resolved; ordinary testing and fixes do not require a new approval from Jacob.

Save reports under `docs/qa/QA_YYYY-MM-DD_<section>.md` (the first report retains its existing filename). Keep each report concise:

- Scope and acceptance criteria, including excluded features.
- Findings: failure example, impact, correction, and regression evidence.
- Checks actually run and their results; distinguish core, mocked UI, native UI, and visual inspection.
- Remaining defects or verification gaps, with their impact on readiness.
- Delivered executable and copy verification, or why no app build was needed.
- Next section and any genuinely needed user input.

Update [implementation status](IMPLEMENTATION_STATUS.md) and the [README](../README.md) as appropriate. The [November 3 QA report](qa/QA_2026-11-03.md) is the initial example. A completed checkpoint establishes the state of that section; it does not certify unbuilt parts of the product.

Keep the current app and installer in ignored `builds/`. Once a replacement is verified, remove superseded binaries only when they are not running and have no specific rollback purpose. Compiler output, generated PDF assets and `.qa` screenshots/logs are disposable; source fixtures and dated reports are durable. Cleanup must stay within this checkout, verify resolved target paths and reject reparse points before recursive operations. Never clean global caches or app-data directories as part of repository maintenance.

When a section changes behavior, update [traceability](REQUIREMENTS_TRACEABILITY.md), the affected [decision](DESIGN_DECISIONS.md), and any [review gap](CODE_REVIEW_GUIDE.md) alongside its feature design. Refresh the consolidated packet with `npm run docs:refresh` and verify `npm run docs:check`. Keep original screenshot references separate from synthetic test data. Documentation must distinguish user requirements, implemented choices, passed evidence and unverified behavior.
