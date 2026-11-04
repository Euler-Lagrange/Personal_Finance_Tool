# Combined categories and Claude API integration QA — November 4, 2026

## Scope and outcome

Jacob asked to integrate Claude's new API build with the latest app changes. Claude's source edits were already in this checkout, following schema 36 with schema 37. This pass independently reviewed and tested that combined source, preserved the Sheets category defaults, fourteen themes and contextual help, corrected one remaining PDF guard defect, and strengthened the optional live test. No user financial database was opened for QA.

The integrated code passes automated checks. After Jacob saved his key through **Imports → Optional AI providers**, the live Claude test also **passed** using the Sample workspace's configured credential and model. It sent only bundled synthetic PDFs and CSV through the production provider client; no financial database was opened and no real financial documents were sent. The provider accepted all three requests and reported usage. Account billing and credit balances were not inspected.

## Findings and corrections

- **The original PDF limit check was ineffective for large or scanned files.** Claude's guard checked the local extracted-page array, but local extraction stops at 100 pages and may produce no text. A synthetic 601-page blank PDF reproduced acceptance before the fix. The app now counts pages from the verified original bytes before preparing consent or sending an attachment, rejecting zero or more than 600 pages and unreadable/encrypted originals. Regression cases verify 1, 100 and 600-page originals succeed even without local text; 601 pages fail without creating a job; reviewed-text requests remain available. The actual page count also reaches proposal validation. See [request preparation](../../src-tauri/src/db/ai_jobs.rs) and `assistance_counts_original_pdf_pages_when_local_text_is_unavailable` in [AI job tests](../../src-tauri/src/tests/ai_jobs.rs).
- **The prior live test could accept an empty extraction.** It now uses the separate transaction-table fixture for transaction extraction and requires six rows, $624 of purchases and a $624 credit, populated statement fields and correct CSV column choices. It can use an explicitly selected app credential through Windows Credential Manager without opening the financial database. Credentials and raw provider output are not printed. The test remains explicitly ignored in normal runs; its separate live execution passed as recorded below.
- **Cross-feature preservation needed direct evidence.** Added `claude_api_upgrade_keeps_sheet_defaults_closed_month_and_reviewed_mapping` in [configuration tests](../../src-tauri/src/tests/ai_configuration.rs). It upgrades schema 36 to 37, preserves 26 category definitions, a customized Groceries default, closed-month totals and a legacy completed proposal, then accepts a new Claude role/index response with usage metadata. Request completion and mapping review create no money. Explicit import records a $100 shared Electric purchase with a $70 personal share. Backup/restore retains the result and usage, closed-month edits remain blocked, and Sample/Personal defaults remain isolated.

Retained Claude's fixes: role/index mapping wire format (7 union properties instead of 17), saved-setting preservation and an unsaved Claude default, high effort and larger output budget, longer cancellable transport timeout, billing/input classifications, nullable completed-request token usage and schema-37 migration. No model fallback or automatic retry was introduced. Financial classification/adoption still requires the existing review checks.

## Checks performed

| Check | Result |
| --- | --- |
| Full Rust suite after all production fixes | **342 passed, 0 failed, 3 ignored** |
| Full mocked browser suite | **196 passed**; no UI edits after this run |
| Explicit live Claude test after key setup | **1 passed**; statement PDF, transaction PDF and CSV mapping requests succeeded |
| PDF regression before correction | **Failed as expected**: oversized original was accepted |
| PDF regression after correction | Passed in the final full Rust suite |
| TypeScript and Prettier | Passed |
| Rust formatting and Clippy, all targets, warnings denied | Passed after the PDF fix |
| Production Windows/NSIS build and delivery | Passed; both copied SHA-256 hashes match their generated sources |
| Review packet and local documentation links | Passed; current packet regenerated from canonical documents |

The full suite ignored Windows OCR, an isolated Windows credential roundtrip and the live Claude test. The latter was subsequently selected explicitly and passed; OCR and the isolated credential roundtrip were not rerun. Logs are disposable, ignored workspace artifacts: `.qa/integrated-api-core-final.log`, `.qa/integrated-api-ui.log`, `.qa/integrated-api-pages-before.log`, `.qa/integrated-api-types.log`, `.qa/integrated-api-format.log`, `.qa/integrated-api-clippy-final.log`, `.qa/integrated-api-build.log` and `.qa/integrated-api-live.log`. Core tests use real SQLite in synthetic temporary stores; browser tests mock the native boundary.

The request review checked official [structured-output limits](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [model information](https://platform.claude.com/docs/en/models/overview), [PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support), [versioning](https://platform.claude.com/docs/en/api/versioning) and [error documentation](https://platform.claude.com/docs/en/api/errors). The app's 600-page ceiling is an absolute upper bound, not a guarantee that every selected model supports that many pages; smaller model limits, context and byte limits still apply.

## Live Claude verification

On November 4, after Jacob confirmed saving the key, `cargo test --manifest-path src-tauri/Cargo.toml live_claude -- --ignored --nocapture` completed successfully: **1 passed, 344 filtered out, 19.91 seconds**. The process explicitly selected the app's `demo` (Sample) provider settings and retrieved the key privately from Windows Credential Manager. `ANTHROPIC_API_KEY` was unset for this process so the saved app credential was the one tested. Model: `claude-opus-5-5`; effort: `high`; no retries or model changes.

| Synthetic task | Input tokens | Output tokens | Request time | Proposal warnings |
| --- | ---: | ---: | ---: | ---: |
| Statement PDF | 3,008 | 350 | 4.7 s | 0 |
| Transaction-table PDF | 4,667 | 782 | 8.7 s | 3 |
| CSV column mapping | 1,945 | 494 | 6.5 s | 4 |

All proposal schemas and fixture-content assertions passed. The statement returned the required balance/closing/due fields; the transaction PDF retained all six rows including identical purchases, with $624 of outgoing purchases and a separate $624 incoming credit; CSV mapping identified date, description and amount columns plus ISO dates and the expected sign convention. Warning counts were retained as metadata; their text was not logged or audited, and passing these fixtures does not remove the normal review requirement. Total reported usage was 9,620 input and 1,626 output tokens; no dollar-cost or promotional-credit claim is inferred from those counts.

This directly verifies authentication, selected-model access, these three wire schemas and response decoding. Real SQLite integration separately covers usage persistence and reviewed adoption. The live test does not exercise the native UI or create app history/financial records. The credential remains scoped to Sample; Personal requires its own provider configuration. No production source changed, so the previously verified app/installer hashes remain current and no rebuild was necessary.

## Delivery

`npm run build:installer` exited successfully before copying either artifact. TypeScript/Vite, Rust release compilation and NSIS packaging passed. Vite retains the existing nonblocking large-chunk advisory. The standalone executable and installer were copied only after absolute-path, ancestor/reparse-point, process and exclusive-access checks; both hashes match the generated source artifacts.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `Personal Finance.exe` (historical 0.1.0) | 26,522,624 | `B199FBA2BBF97D82163FDE4FE8B9A02C49BE45340C1957DA612562907BF4E18A` |
| `Initial Trial Setup.exe` (historical 0.1.0) | 226,469,769 | `82B2CE6C64847F3B5A0F61D7F590F8AF217F97D62324F93F6C607B6749FB622D` |

These artifacts were subsequently superseded by [reliability release 0.2.0](QA_2026-11-04_reliability.md); use the current README launch links.

The superseded `Personal Finance - Claude API.exe` and `Personal Finance - UI Review.exe` were both unlocked and removed after replacement verification. `builds/` now contains only the current app and installer. No running application was stopped; no files outside the checkout were deleted. Delivery logs and the bounded cleanup script remain under ignored `.qa/`. The app and installer are generated local artifacts excluded from Git.

## Remaining verification and limits

- The live check verifies the configured key/model and these three request schemas at the recorded time. Other models/tasks, future availability, invoiced cost and account credit balances remain unverified. Personal workspace provider settings were not configured or tested.
- The live test covers statement, transaction and column-mapping tasks. It does not by itself establish every provider task or the native UI workflow. Real issuer samples remain part of Jacob's final trial.
- Usage is retained only for completed proposals; refusal/truncation/invalid-output failures can still incur charges without retained usage. The UI shows reported token counts, not a dollar-cost total.
- Native Windows paste/drop/UI acceptance, clean-PC installation and physical second-device handoff were not repeated. The existing external checks in [the trial guide](../LIVE_TRIAL.md) remain open.
- Version remains 0.1.0, schema 37. The existing release-version discipline finding remains open. Payroll and automatic OneDrive-folder backups remain planned extensions, not part of this delivery.
