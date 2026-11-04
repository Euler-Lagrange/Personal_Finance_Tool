# Reliability checkpoint — November 4, 2026

Status: completed with the native-interaction limits below. This begins Jacob's authorized continuous reliability → Pay & hours → destination-backups queue. Real financial-data testing remains reserved for the final trial.

## Cross-timezone recovery

G07 was reproduced with a synthetic SQLite store: an Oct 31 00:30 UTC+14 source observation is persisted as Oct 30 10:30 UTC. Restoring the confirmed Oct 31 coverage on this machine failed because recovery converted it into the receiving computer's calendar. The regression failed with the expected coverage-date error before correction.

New confirmations still enforce the current device's local date and reject future observation instants. Recovery now validates saved UTC instants independently of the destination timezone. Old rows did not retain their original offset; rather than invent one, historical validation permits only civil dates possible at that instant through UTC+14. It still rejects future instants, invalid ranges and coverage ending after the latest possible source day. UTC normalization, source/layout checks and reconciliation ordering remain unchanged. No financial data is rewritten, and schema stays 37.

The regression preserves accepted coverage and $10 spending through backup/restore and an encrypted handoff to a separate temporary root. A deliberately impossible historical timestamp is rejected without replacing the valid workspace. See [identity validation](../../src-tauri/src/db/identity.rs) and `saved_midnight_coverage_restores_without_reinterpreting_the_source_timezone` in [tests](../../src-tauri/src/tests/identity.rs). New payroll civil dates will be stored directly, avoiding this ambiguity for new payroll data.

## Release discipline and native isolation

Version advances to **0.2.0** across npm, npm lock, Cargo and Tauri. The sidebar displays the actual package version. [The release check](../../scripts/check-release-version.mjs) runs before production frontend builds and rejects version mismatch or disabled installer downgrade protection. Equal-version historical 0.1.0 previews cannot be retroactively distinguished; standalone old executables are not blocked by the installer. Database newer-schema rejection remains independent.

A debug-only `PERSONAL_FINANCE_TEST_ROOT` can select an absolute isolated data folder for native UI checks, with an explicit QA window title. Release builds ignore it and use the normal app directory. A separate WebView profile is selected for native QA launches. Synthetic records, credentials and app preferences stay separate from Jacob's app data.

## Verification and delivery

- Regression: failed before the fix; passed during the current full suite, including restore and handoff.
- Full browser suite: **196 passed**.
- TypeScript, Prettier and release-version check: passed.
- Full core suite: **343 passed, 0 failed, 3 ignored**. No live API test was repeated.
- Clippy (all targets, warnings denied) and Rust formatting: passed.
- Native debug app launched with isolated financial and WebView data under `.qa/native-reliability-*`. The actual Windows window displayed the sample dashboard, categories and v0.2.0 correctly; Transactions navigation was observed. Input automation encountered a 14×14 reported window-bound error and inconsistent targeting; a newer control entry point also failed to initialize. Paste/drop/file-picker interaction is **not verified** by this attempt. Only the owned debug session was closed; the real app/profile was not touched.
- Production TypeScript/Vite/Rust release and NSIS installer build: passed. The existing Vite large-chunk advisory remains nonblocking.

## Delivery

Both copies were made after the successful build exit, with project-path/reparse/lock checks, and match the generated SHA-256 hashes. The superseded 0.1.0 installer was removed only after successful replacement; `builds` contains the current app and installer. No user app was stopped and no files outside the project were deleted.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| [Personal Finance.exe](../../builds/Personal%20Finance.exe) | 26,522,112 | `990D1C6EA41BF49205FA02F5B12C440E493BB79A1C7B944D44BA93BF98A05108` |
| [Personal Finance Setup.exe](../../builds/Personal%20Finance%20Setup.exe) | 226,485,769 | `A9A2C20993B5F4A3B293CE10541301E8085EFD2D544C68CAB373D55CB6C65DA0` |

Release 0.2.0, schema 37. The next authorized section is pay policy and weekly hours. Installer execution on a clean machine, actual Windows paste/drop/file-picker behavior and physical laptop transfer remain final-trial checks.

Logs are ignored artifacts under `.qa/reliability-*`. No live API request or real financial file is used in this checkpoint.
