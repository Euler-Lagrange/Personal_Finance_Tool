# Claude API request path QA — November 4, 2026

## Scope

Implement [the Claude API fix plan](../design/CLAUDE_API_FIX_PLAN.md) after a read-only review of the provider request path against the live platform docs. Jacob's decisions: the Claude provider defaults to `claude-opus-5-5` and every request runs at high effort. The section covers the request envelope, structured-output schema limits, transport timeout, billing-error classification, PDF page limits, persisted token usage (schema 37), provider-settings defaults, and documentation. The OpenAI branch is unchanged except where the shared response type touched it.

Excluded: streaming transport, refusal fallbacks (the design forbids silent model switching), prompt caching and batches. The live provider call remains an explicitly ignored test that needs a key from the Quantasys LLC Console organization; it was not run here.

See [client](../../src-tauri/src/assistance/client.rs), [configuration](../../src-tauri/src/assistance/configuration.rs), [proposal](../../src-tauri/src/assistance/proposal.rs), [settings](../../src-tauri/src/assistance/settings.rs), [jobs](../../src-tauri/src/db/ai_jobs.rs), [migration 037](../../src-tauri/src/migrations/037_ai_usage.sql), [provider settings UI](../../src/AiProviders.tsx) and [assistance UI](../../src/AiAssistance.tsx).

## Findings and corrections

- **Column-mapping requests exceeded a provider schema limit.** Structured outputs allow at most 16 union-typed properties per request. The mapping task sent 17 (six in the base proposal schema, ten nullable column indices, one `configuration` anyOf), which the API rejects with a 400 the app would have shown as a generic request error. Column suggestions now travel as `columns: [{role, index}]` pairs, bringing the task to 7. The stored `Mapping` shape is unchanged; a wire-to-stored conversion rejects repeated or unknown roles and negative indices, and older stored proposals still load. Regression: `every_task_schema_stays_within_provider_union_and_optional_limits` counts union-typed and optional properties for every task schema and checks that every object closes `additionalProperties`; `ai_configuration_mapping_wire_uses_role_index_pairs_and_still_reads_stored_shape` covers both shapes and the rejections.
- **Output budget was too small.** `max_tokens` 8192 could not hold a 200-row transaction proposal with evidence quotes, and thinking (always on for Opus 5.5) counts toward the same budget; long statements would have stopped at `max_tokens`, failed as incomplete, and still spent credit. Requests now send `max_tokens` 32,000 and `output_config.effort: "high"`. The envelope test pins both and the absence of `thinking`, `tool_choice`, `tools` and sampling fields.
- **No default model.** A device with no saved Claude settings now reports `claude-opus-5-5`; the settings dialog shows it as the placeholder with one line on effort and Max plan API credit billing. Saved settings always win. Covered by the settings unit test and the provider browser case.
- **Timeout too short for high effort.** The whole-request timeout rises from 120 to 600 seconds with TCP keep-alive. The request still runs in a cancellable background task.
- **Three billing responses were misclassified.** The monthly spend-cap 429 (`details.error_code` = `enforced_spend_limit_reached`, which carries no Retry-After) read as a rate limit asking the user to wait; a self-set spend limit 400 ("API usage limits") and an oversized-request 413 read as generic request errors. All three now map to billing or input failures with no retry wait. Covered by the failure-classification test, which also checks that 529 maps to "unavailable".
- **PDF page limit unenforced.** An original PDF with more than 600 locally extracted pages is refused before any request is prepared.
- **Token usage discarded.** Schema 37 adds `usage_json` to `ai_jobs`; completed requests persist the provider's input and output token counts, the request list shows them, and backup/restore carries them. Covered by `assistance_records_token_usage_and_upgrades_from_thirty_six`, which also upgrades a schema-36 workspace in place. The shared downgrade fixtures and the category-defaults legacy fixture now drop the new column when simulating older schemas; production migrations were not weakened.

## Checks actually performed

- Full Rust suite after the code changes: **337 passed, 3 failed, 3 ignored**. The three failures were the category-defaults legacy fixture that still carried the new column while simulating schema 35 (a test-fixture defect, not an upgrade defect). After the fixture fix, the focused rerun of sheet defaults, AI configuration, AI jobs, handoff and the final lifecycle passed (**27 passed**), and the full suite was rerun: **340 passed, 0 failed, 3 ignored** (the two inherited environment cases plus the new live-provider case).
- Focused core coverage added or changed: 4 new cases (schema limits, mapping wire shape, token usage with schema-36 upgrade, live ignored test) plus extended envelope, failure-classification, decode and settings-default assertions. The ignored live test `live_claude_structured_extraction_with_synthetic_fixtures` sends only `src-tauri/fixtures/pdf/statement.pdf` and a three-line synthetic CSV; run it explicitly with `cargo test --manifest-path src-tauri/Cargo.toml live_claude -- --ignored` after setting `ANTHROPIC_API_KEY` in that shell.
- Full mocked browser suite after the UI changes: **196 passed**. The PDF documents spec was rerun after adding the placeholder, help-text and token-usage assertions: **30 passed**.
- `npx tsc --noEmit`, `npx prettier --check src tests/ui`, `cargo fmt --check` (after formatting) and `cargo clippy --all-targets -- -D warnings`: passed.
- Documentation packet check (`npm run docs:check`) and link review: see below.

All core data came from temporary synthetic stores and fixtures. Browser tests mock the native boundary. No real provider request, real key, real statement or user database was used.

## Remaining verification

- No live Claude request has been made yet. Until the ignored live test runs with a Quantasys key, model acceptance, schema compilation under the 16-union limit, actual latency at high effort, and the credit draw-down are unverified. Record model, effort, token counts, elapsed seconds and the promotional-credit balance before and after in this report when it runs.
- Usage is persisted only for completed requests. A request that stops at `max_tokens` or is refused is billed but records no token counts.
- Requests stay non-streaming. If live requests approach the 600-second timeout, streaming over server-sent events is the next change.
- Native Windows interaction, installation on a clean PC and second-device use remain the existing external checks.

## Delivery

`npm run build:installer` exited successfully (release profile and NSIS bundle). Before copying, the running-process scan found only `builds/Personal Finance - UI Review.exe` in use and confirmed `builds/` is not a reparse point. Both copies match their generated sources by size and SHA-256.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `builds/Personal Finance - Claude API.exe` | 26,526,208 | `5036BD7CC5F588FE79AE4C5CD2BD3AF458427118D77ADABB2C66F79941272DFD` |
| `builds/Personal Finance 0.1.0 - Initial Trial Setup.exe` | 226,479,753 | `C5D28626615EBF9ABBFF64BDA557F1290B6DBECB6C7FB67C93D05317751A4CBF` |

Version 0.1.0, schema **37**. The superseded `Personal Finance - Sheets Setup.exe` was removed after verification; `Personal Finance - UI Review.exe` remains only because it is running and locked, and no application was stopped. Opening an older workspace backs it up and adds the usage column; no financial records change.
