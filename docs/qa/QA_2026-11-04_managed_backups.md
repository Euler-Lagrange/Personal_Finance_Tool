# QA — managed backups and extension completion, November 4, 2026

Release 0.8.0 / schema 43. This completes the authorized reliability pass and all six Pay & hours/backup sections. Testing used synthetic records, temporary databases/destinations and mocked browser responses. No actual financial records, real OneDrive folder, paystub or provider credential was used in this section.

## Scope and results

Folder selection/setup; complete age-encrypted SQLite/evidence archives; native debounced backup queue and import/close checkpoints; launch catch-up; optional Windows credential storage; independently recoverable passphrase; per-device owned retention; protected checkpoints; authenticated preview and atomic restore with preserved branch/retry receipt. Routine snapshots do not advance handoff ancestry. Live SQLite stays in local app data.

- Full native baseline: **384 passed, 0 failed, 3 environment/live cases ignored**, 127.71 seconds. Final affected suite after publication/retention/checkpoint corrections: **8 passed**. This includes actual Windows filesystem and junction checks, in addition to SQLite and encryption tests.
- Full mocked browser baseline: **220 passed**, 1.4 minutes. Four backup workflows rerun successfully after final layout changes; one additional delayed-workspace/status-retry case passes: **221 distinct browser cases verified**. Browser mocks do not establish native WebView or folder-picker acceptance.
- All-target Clippy with warnings denied, Rust formatting, TypeScript, Prettier and release-manifest agreement pass. Production installer build runs TypeScript/Vite and Windows release compilation; artifact results are recorded below.
- Light/Dracula folder and setup screenshots at 1100×820 were visually inspected. Full-width backup panel, left-aligned checkboxes and consistent form gaps corrected initial cramped/vertical checkbox layout. Existing theme/feature suites remained passing.

## Findings and corrections

1. A manual backup could accept a mistyped passphrase and silently create a differently encrypted member of the same backup set. A failing native regression reproduced it. Each set now has a small encrypted password check, validated before publishing a new copy; the correct original passphrase remains usable even when an older cloud archive is unavailable. It does not expose a plaintext secret or require older-file hydration.
2. Review found that cleanup after a failed exclusive create could remove a pre-existing temporary-name collision. Cleanup now only removes files successfully created by that operation. Native regressions preserve pre-existing local-stage and destination-partial files. Final Windows publication refuses replacing an existing destination name.
3. Retention now opens an owned archive with exclusive write/delete protection, verifies its bytes/hash, then deletes through that same Windows handle. Parent directory handles and ownership rechecks reject redirected managed folders. The actual synthetic junction test passed outside the sandbox after sandbox junction creation returned Access denied; no real destination was involved.
4. Restore retries retain the same receipt and do not overwrite later changes a second time. Stale previews reject replacement. Prior branches use a separate `.managed.sqlite` suffix and are excluded from ordinary 20-copy local rotation.
5. Browser-fixture corrections removed a collision with the browser's `window.status`, followed the app's normal return to Overview after switching workspace, and kept simulated read failures persistent under React Strict Mode. They do not represent native product defects. Pending responses are guarded by generation/workspace lifetime; the final delayed-workspace case passes.

## Integration evidence

Native cases retain imported purchases, source evidence, payroll rates/calendar evidence, closed totals and existing handoff history. Recovery works into a new isolated app directory using only the file and passphrase, with no local catalog/credential. Wrong passwords, corrupted/truncated files, wrong workspace, changed ownership, unavailable destinations, catalog traversal and redirected folders are rejected. Daily/monthly retention preserves newest/protected copies and leaves unknown/partial/other-device files alone. Changed older archives stop pruning while retaining the new validated copy.

Injected failures after copying a partial file and after publication but before catalog success preserve prior archives and live records; an orphaned complete archive remains independently restorable. The native command-boundary test verifies change queuing, unchanged-snapshot skipping, expedited checkpoints, workspace separation and saved finance remaining intact after backup failure. The final protected deletion/publication code is exercised by the affected eight-case suite. Production-strength age authentication/tamper coverage is also included in the full baseline.

## Explicit remaining acceptance checks

- Actual OneDrive upload, hydration/online-only behavior and paused sync; the UI always says **Cloud sync not verified**. No cloud API is implemented.
- Native folder picker/WebView interaction, high-DPI/manual accessibility, clean-PC installation, physical laptop transfer and recovery under a separate Windows sign-in. Temporary-directory portability tests do not establish these physical-device conditions.
- Actual paystub/tax-profile accuracy, personal issuer layouts and reconciliation remain in [the final trial](../LIVE_TRIAL.md). Unsupported tax years stay unavailable.
- Write interruption is exercised through deterministic failure injection. Actual disk exhaustion and a process kill during publication were not induced. Any file left before catalog completion is ignored by retention and must authenticate before restore.

No known correctness/data-loss defect remains from this section's review. This is a synthetic implementation/recovery checkpoint, not a security audit or a passed live-data trial.

## Delivery

Verified Windows artifact hashes are appended after the final copy check. Local disposable evidence includes `.qa/managed-full-core.log`, `.qa/managed-final-core.log`, `.qa/managed-final-clippy.log`, `.qa/managed-full-ui.log`, `.qa/managed-final-ui.log`, `.qa/managed-stale-ui-final.log`, `.qa/managed-build.log` and the layout images. Durable regression cases live in the repository.

- `builds/Personal Finance.exe`: **29,311,488 bytes**; SHA-256 `7CFDF3B0D69A28C09D3553C6FE873668AE38CFE012B3EE0BE21F67237E37F644`.
- `builds/Personal Finance Setup.exe`: **227,106,098 bytes**; SHA-256 `8FD52CF4B4C902AC55ECC7518947A1BA016A2415822B63F6B38B72F17937B871`.
- Production Windows/NSIS build completed; copied executable and installer match their built sources exactly. No running app stopped; `builds/` retains only these current verified files. The existing Vite bundle-size advisory is nonblocking.
