# Known pay and retained predictions — November 4, 2026

## Scope

Section 3 of the authorized extension: known paycheck facts, reviewed source attachments and structured pay rows, manual/empirical predictions per period, separate hourly scenarios, retained versions and actual-net comparison. All fixtures use temporary databases and synthetic documents. Real payroll records were not opened or imported.

Native gross sums exact daily rate/hour products across the whole period before rounding once. Empirical cohorts match paid year, rate, frequency, benefits pattern and named regime. Target/future observations, unreviewed/inconsistent facts, special pay/reimbursements and duplicate representations cannot inflate support. Missing net is not zero. At least two gross points are required; extrapolation is explicit. Interior-point fit error excludes each interior gross point before predicting it from its neighbors; it is not a confidence interval.

## Findings and fixes

- A saved paycheck's edit draft originally spread read-only monetary fields back into the strict write input. The new edit-after-save browser case failed with the dialog retained; explicit input-field mapping fixes it. The same case verifies a lost-response retry creates one record and preserves null net.
- Implicit source-select labeling made the evidence workflow fail exact-label lookup. Explicit label associations fix the workflow and preserve the exact supporting quote through a reviewed save.
- Compact visual inspection found checkbox direction inherited from global labels. Local row direction and reduced form-grid margins restore readable spacing in Light/Dracula.
- Regression cases exercise a fractional-cent total whose whole-period result differs from summing weekly rounded amounts; actuals replace plans and missing-day assumptions do not write actual work. Invalid sick allocation preserves work while blocking calculated gross.

## Verification

- Full core baseline: **361 passed, 0 failed, 3 environment/live tests ignored**, 147.78 seconds. Includes actual SQLite migration/recovery/handoff, native parsing, financial isolation and the production encryption fixture.
- Full mocked browser baseline: **210 passed**, 1.3 minutes. Five added workflows cover facts/retries/edits, source proposals, prediction freshness/version selection, average versus incremental net, and successful save followed by failed refresh.
- Final fit-error/release checks: all six native known-pay cases and all 14 payroll browser workflows passed; TypeScript, Prettier, Rust formatting and Clippy with warnings denied passed. No application change after those checks invalidated them.
- Compact 1100×820 known-pay and prediction dialogs inspected in Light and Dracula. Screenshots/logs are disposable under `.qa/pay-forecast-*`.
- Browser checks mock Tauri calls; native tests exercise the calculation/storage separately. Native Windows paste/drop/file-picker interaction, installer acceptance and physical laptop transfer remain unverified. No provider requests were made for this section.

## Delivery and remaining work

Release **0.5.0 / schema 40** built successfully, including the NSIS installer with offline WebView2. Copied files were SHA-256 compared with the completed build; no running application was stopped. Schema 40 is a reader barrier; new empty snapshot fields are omitted to preserve older history hashes. Recovery replays changes, validates retained sources and rejects modified forecasts without replacing valid records.

| Delivered file | Bytes | SHA-256 |
| --- | ---: | --- |
| `builds/Personal Finance.exe` | 27,515,392 | `81FB99D9FF108A85644C7446D521F9B8245DF0404287E09E466160C83983421C` |
| `builds/Personal Finance Setup.exe` | 226,743,568 | `4B5845596F87043ED81A38A472AAE3C103A88F26609BE267310FAF2187668E4D` |

Existing Vite chunk-size advisory remains nonblocking; runtime assets are local. Clean-PC installation and native input checks remain the explicit gaps above.

Withholding/calibrated models are section 4. Expected cash plans, split/partial actual deposit matching, annual payroll reports and month-close integration are section 5. Managed OneDrive-folder backups are section 6. Arbitrary paystub layouts remain evidence for manual review; recognized structured pay rows are drafts. Real-data acceptance remains the final user trial.
