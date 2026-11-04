# Claude API fix plan

Date: November 4, 2026. Read-only review of the Claude request path by Claude (Fable 5.1) against the live platform docs. No source files were changed by the review. Codex implements; this file is the brief.

Decisions from Jacob: the default API model for the Claude provider is `claude-opus-5-5` at effort `high`.

Status: steps 1 to 6 and 8 were implemented later on November 4, 2026 (schema 37); see [the QA report](../qa/QA_2026-11-04_claude_api.md). Step 7's live test exists as an ignored core test and still needs a run with a Quantasys key.

Follow-up: Jacob requested integration with the latest category/UI work. The source already contained both migrations in sequence; [integration QA](../qa/QA_2026-11-04_api_integration.md) records the independent review, combined lifecycle regression, current build and latest live-test status. The live test now uses `transactions.pdf` for transaction extraction and asserts useful fixture results, not only schema validity. It also supports an explicitly selected, enabled app credential without putting a key in chat or shell command text.

## Scope and rules

- In scope: [client.rs](../../src-tauri/src/assistance/client.rs), [proposal.rs](../../src-tauri/src/assistance/proposal.rs), [configuration.rs](../../src-tauri/src/assistance/configuration.rs), [settings.rs](../../src-tauri/src/assistance/settings.rs), [ai_jobs.rs](../../src-tauri/src/db/ai_jobs.rs), [ai_configuration.rs](../../src-tauri/src/db/ai_configuration.rs), [AiProviders.tsx](../../src/AiProviders.tsx), [AiAssistance.tsx](../../src/AiAssistance.tsx), their tests, and the docs named in step 8.
- Out of scope: the OpenAI branch keeps its current behavior except where a shared change touches it. Do not add server-side refusal fallbacks or any model switching; [ASSISTANCE_DESIGN.md](ASSISTANCE_DESIGN.md) forbids silent fallback. Do not add prompt caching or batches; every request is a one-off with fresh material.
- QA uses synthetic fixtures only. The first live request must use `src-tauri/fixtures/pdf/statement.pdf` or another synthetic file, never a real statement.
- Follow [DEVELOPMENT_WORKFLOW.md](../DEVELOPMENT_WORKFLOW.md): implement, test, fix, build, verify the delivered copy, record a QA report.

## What is already correct

Endpoint `https://api.anthropic.com/v1/messages`; `x-api-key` plus `anthropic-version: 2026-10-21`; no `temperature`, `top_p` or `top_k` (rejected on that version); base64 document and image blocks before the text block, standard alphabet without line breaks; `output_config.format` with `type: "json_schema"` and no beta header; every object has `additionalProperties: false` and lists every property as required; no citations, no prefill, no `tool_choice`; thinking blocks skipped on decode; `refusal` and `max_tokens` stop reasons handled; the exhausted-credit 400 is detected from its message text; retry-after parsed; 5xx and 529 map to "unavailable"; key stored in Windows Credential Manager, header marked sensitive, HTTPS only, no redirects, no automatic retries; response capped at 1 MiB; provider error text never shown to the user.

## Findings

| # | Severity | Where | Problem | Fix |
| --- | --- | --- | --- | --- |
| 1 | Blocking | [configuration.rs:73](../../src-tauri/src/assistance/configuration.rs:73), [proposal.rs:62-67](../../src-tauri/src/assistance/proposal.rs:62) | Structured outputs allow at most 16 properties with union types (`anyOf` or a `type` array). The mapping task sends 17: six in the base schema, ten nullable column indices, one `configuration` anyOf. The API returns 400; the user sees the generic "provider rejected the request" message. | Step 2 |
| 2 | Blocking | [client.rs:85](../../src-tauri/src/assistance/client.rs:85) | `max_tokens` 8192. Thinking counts toward it and is always on for Opus 5.5. A 200-row transaction proposal with evidence quotes needs roughly 12,000 to 16,000 output tokens. Long statements return `stop_reason: max_tokens`, the job fails as incomplete, and the credit is spent. | Step 1 |
| 3 | Required | [client.rs:85](../../src-tauri/src/assistance/client.rs:85) | No `output_config.effort`. Opus 5.5 defaults to `medium`. Jacob wants `high`. | Step 1 |
| 4 | Required | [settings.rs:9-13](../../src-tauri/src/assistance/settings.rs:9), [AiProviders.tsx:178](../../src/AiProviders.tsx:178) | No default model. The user must know and type an ID. | Step 3 |
| 5 | Reliability | [client.rs:256-264](../../src-tauri/src/assistance/client.rs:256) | Non-streaming request with a 120 second total timeout. At `high` effort with a larger `max_tokens`, a long document can take several minutes. A timeout fails the job after the credit is spent. | Step 4 |
| 6 | Correctness | [client.rs:88-131](../../src-tauri/src/assistance/client.rs:88) | Three billing-type responses are misclassified. Spend-cap 429 (`error.details.error_code` = `enforced_spend_limit_reached`, no retry-after) shows as a rate limit that asks the user to wait. A self-set spend limit returns 400 with a message starting "You have reached your specified API usage limits" and shows as a generic request error. 413 `request_too_large` shows as a generic request error. | Step 5 |
| 7 | Correctness | [ai_jobs.rs:81-140](../../src-tauri/src/db/ai_jobs.rs:81) | PDF page count is known but not checked against the API maximum of 600 pages per request. | Step 5 |
| 8 | Visibility | [client.rs:140-239](../../src-tauri/src/assistance/client.rs:140), [ai_jobs.rs](../../src-tauri/src/db/ai_jobs.rs) | The response `usage` block is discarded. With a fixed $100 monthly credit, the user cannot see what a request cost. | Step 6 |
| 9 | Docs | [USER_GUIDE.md](../USER_GUIDE.md) Imports paragraph, [ASSISTANCE_DESIGN.md](ASSISTANCE_DESIGN.md) | No guidance on model choice, effort, limits, or that the Max plan API credit pays for these requests. | Step 8 |
| 10 | Verification | [QA_2026-11-03_ai_requests.md](../qa/QA_2026-11-03_ai_requests.md) | No live provider request has ever been made. Everything above is untested against the real API. | Step 7 |

### Union-type count per task (limit 16)

| Property | bill / statement / transactions | mapping | pdf_template | pdf_table |
| --- | --- | --- | --- | --- |
| `fields[].value` | 1 | 1 | 1 | 1 |
| `fields[].evidence.page` | 1 | 1 | 1 | 1 |
| `rows[].date`, `amount`, `currency` | 3 | 3 | 3 | 3 |
| `rows[].evidence.page` | 1 | 1 | 1 | 1 |
| `configuration` anyOf | 0 | 1 | 1 | 1 |
| ten `*Column` nullable integers | 0 | 10 | 0 | 0 |
| **Total** | **6** | **17** | **7** | **7** |

Optional-parameter count (limit 24) is zero for every task because every property is required.

## Implementation steps, in order

### Step 1: request body for Claude

File: [client.rs](../../src-tauri/src/assistance/client.rs) `body()`.

- Add constants near the top: `CLAUDE_MAX_TOKENS: u32 = 32_000` and `CLAUDE_EFFORT: &str = "high"`.
- Claude body becomes `{"model", "max_tokens": CLAUDE_MAX_TOKENS, "system", "messages", "output_config": {"effort": CLAUDE_EFFORT, "format": {"type": "json_schema", "schema": schema}}}`. Do not send a `thinking` field; Opus 5.5 runs adaptive thinking by default and rejects `disabled` and `budget_tokens`.
- Leave the OpenAI body unchanged.
- Tests in the same file: assert `b["max_tokens"] == 32000`, `b["output_config"]["effort"] == "high"`, `b["output_config"]["format"]["type"] == "json_schema"`, and that `thinking`, `temperature`, `tools` and `tool_choice` are absent.

### Step 2: mapping schema under the union limit

Files: [configuration.rs](../../src-tauri/src/assistance/configuration.rs), [ai_configuration.rs](../../src-tauri/src/db/ai_configuration.rs), [tests/ai_configuration.rs](../../src-tauri/src/tests/ai_configuration.rs).

- Replace the ten nullable column properties in `schema("mapping")` with one array: `"columns": {"type": "array", "items": {"type": "object", "properties": {"role": {"type": "string", "enum": ["date", "description", "amount", "debit", "credit", "status", "type", "postedDate", "stableId", "currency"]}, "index": {"type": "integer"}}, "required": ["role", "index"], "additionalProperties": false}}`. Keep `amountMode`, `dateFormat`, `year: {"type": "null"}`, `postedConfirmed: {"type": "boolean", "enum": [false]}`, `stableIdsConfirmed: {"type": "boolean", "enum": [false]}`. Mapping then has 7 union-typed properties.
- `Configuration` currently deserializes straight into `imports::types::Mapping`. Add a wire struct `MappingProposal { columns: Vec<ColumnRole>, amount_mode, date_format, year: Option<i32>, posted_confirmed: bool, stable_ids_confirmed: bool }` with `deny_unknown_fields`, and a conversion into `Mapping` that rejects a repeated role, a negative index, and an index beyond 79. Keep `Configuration::Mapping(Mapping)` as the stored form so completed jobs and `ai_configuration.rs` are unchanged; convert during `Proposal` deserialization or in `Configuration::validate`, whichever keeps `proposal_json` backward compatible with any existing completed job rows.
- Update the mapping instruction text in `instructions("mapping")` to describe `columns` as role and zero-based index pairs, each role at most once.
- Tests: wire round-trip; duplicate role rejected; index 80 rejected by `parse::validate_mapping`; existing adoption tests still pass.
- Add a regression test in [proposal.rs](../../src-tauri/src/assistance/proposal.rs) that walks `schema(task)` for every task and counts properties whose `type` is an array or that carry `anyOf`, asserting the count is at most 16, and counts properties missing from their object's `required`, asserting zero.

### Step 3: default model

Files: [settings.rs](../../src-tauri/src/assistance/settings.rs), [AiProviders.tsx](../../src/AiProviders.tsx), [tests/ui/pdfDocuments.spec.ts](../../tests/ui/pdfDocuments.spec.ts).

- In `settings::read`, when no settings file exists and `provider == "claude"`, return `Config { model: "claude-opus-5-5".into(), ..Default::default() }`. OpenAI keeps an empty default. A saved file always wins.
- In `AiProviders.tsx`, set the placeholder to `claude-opus-5-5` when the Claude provider is selected and add one line under the field: "Default: claude-opus-5-5 at high effort. Requests bill to the Console organization that owns the key, including Max plan API credits."
- Tests: a settings test that an unsaved Claude config reports the default model and `enabled: false`; the browser spec's provider mock at lines 205 to 215 supplies its own model values, so check the assertion at line 1111 that expects an empty model after switching providers and adjust it if the mock changes.

### Step 4: transport

File: [client.rs](../../src-tauri/src/assistance/client.rs) `send()`.

- Raise `.timeout` to 600 seconds and add `.tcp_keepalive(Duration::from_secs(60))` to the client builder. Keep `connect_timeout` at 15 seconds.
- Keep the request non-streaming. The job already runs in a background task with cancellation through `ai_cancel`. If live testing shows requests near the timeout, streaming over server-sent events is the follow-up: accumulate `content_block_delta` text deltas, read `stop_reason` from `message_delta`, and treat a mid-stream `error` event as a failure.
- The first request with a new schema is slower because the API compiles the schema once and caches it for 24 hours. Mention this in the user guide so a slow first call is not mistaken for a hang.

### Step 5: error classification and input limits

Files: [client.rs](../../src-tauri/src/assistance/client.rs) `http_failure()`, [ai_jobs.rs](../../src-tauri/src/db/ai_jobs.rs) `bound()`.

- Billing when `error.details.error_code == "enforced_spend_limit_reached"`, or when a 400 message contains "api usage limits". Keep the existing "credit balance" and "spend limit" checks. A billing failure never carries retry-after.
- Map 413 to kind `input` with "The source is too large for the provider. Use reviewed text or a smaller document."
- Keep 404 under `request`; the existing message already points at the model ID.
- In `bound()`, reject a PDF original whose `dataset.pdf_pages.len()` exceeds 600 with an input error before any request is prepared.
- Tests: extend `failures_distinguish_billing_from_retryable_throttles_and_never_echo_source_data` with the spend-cap 429 body `{"error":{"type":"rate_limit_error","details":{"error_code":"enforced_spend_limit_reached"}}}` expecting kind `billing` and no retry, the 400 "You have reached your specified API usage limits" body, and a 413.

### Step 6: usage visibility

Files: [client.rs](../../src-tauri/src/assistance/client.rs), [ai_jobs.rs](../../src-tauri/src/db/ai_jobs.rs), a new migration `036_ai_usage.sql`, [AiAssistance.tsx](../../src/AiAssistance.tsx).

- `decode` returns the parsed proposal value today. Return the proposal together with `usage.input_tokens` and `usage.output_tokens` read from the top-level response (absent for OpenAI responses is fine; store null).
- Add a nullable `usage_json` column to `ai_jobs`, persist it in `ai_finish`, expose `usage` on `Job`, and show "in / out tokens" on the completed job row in `AiAssistance.tsx`.
- Tests: decode returns usage for a Claude envelope; `ai_finish` stores it; the schema validation in `ai_jobs::validate` tolerates null.
- If this step is deferred, record it as a gap in the QA report rather than dropping it.

### Step 7: live verification with synthetic data

- Add an ignored core test `live_claude_structured_extraction` that reads `ANTHROPIC_API_KEY` from the environment, sends `src-tauri/fixtures/pdf/statement.pdf` through `client::body` and `client::send` for the `statement` task and the `transactions` task, and asserts a validated `Proposal`. Run it explicitly with `cargo test live_claude -- --ignored` using a key from the Quantasys LLC organization. Never run it in the normal suite.
- Also run the `mapping` task once against `src-tauri/src/fixtures/import.xlsx` text to prove the schema compiles under the 16-union limit.
- Record in the QA report: model, effort, input and output tokens, elapsed seconds, and the promotional-credit balance before and after from platform.claude.com/settings/billing.
- Expected failure text when the credit is exhausted: "Your credit balance is too low to access the Anthropic API." The app must show its billing message, not the raw text.

### Step 8: docs, build, delivery

- [USER_GUIDE.md](../USER_GUIDE.md) Imports paragraph: name the default model, say effort is fixed at high, say the Max plan API credit pays for requests when the key belongs to the linked Console organization, note the slower first request per task, and the 600-page and 10 MB limits.
- [ASSISTANCE_DESIGN.md](ASSISTANCE_DESIGN.md): record `claude-opus-5-5`, effort `high`, `max_tokens` 32,000, 600 second timeout, the 16-union schema budget, and the decision not to use refusal fallbacks.
- [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md): new checkpoint entry with test counts and the live-call result.
- New QA report `docs/qa/QA_2026-11-04_claude_api.md` in the format of the November 3 reports.
- Build the Windows executable under a new filename, verify the delivered copy matches, update the launch link. Do not stop a running app or overwrite a locked executable.

## Reference facts from the platform docs

- Structured outputs: supported schema features are basic types, `enum`, `const`, `anyOf`, `allOf`, `$ref`; limits are 24 optional parameters and 16 union-typed parameters per request; over the internal grammar limit returns 400 "Schema is too complex for compilation"; incompatible with citations and prefill; works with thinking, PDFs and images. https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Opus 5.5: thinking always on, `disabled` and `budget_tokens` return 400, effort default `medium`, thinking counts toward `max_tokens`, $4 input and $20 output per million tokens. Classifier declines arrive as HTTP 200 with `stop_reason: "refusal"`. https://platform.claude.com/docs/en/api/errors
- PDF input: 128 MB request limit on the first-party API, 600 pages per request. https://platform.claude.com/docs/en/build-with-claude/pdf-support
- Images: oversized images are downscaled automatically to a 2,576 pixel long edge; cost is one token per 28 by 28 pixel patch. https://platform.claude.com/docs/en/build-with-claude/vision
- Errors: 400 `invalid_request_error`, 401 `authentication_error`, 402 `billing_error`, 403 `permission_error`, 404 `not_found_error`, 413 `request_too_large`, 429 `rate_limit_error`, 500 `api_error`, 504 `timeout_error`, 529 `overloaded_error`. The spend-cap 429 has no retry-after and carries `details.error_code`. https://platform.claude.com/docs/en/api/errors
- Rate limits: an organization linked to a Max plan is at least Start tier, which allows 4,000 requests and 2,000,000 input tokens per minute on Opus 5.5 with a $500 monthly spend cap that credit usage counts toward. https://platform.claude.com/docs/en/api/rate-limits
- API credits: $100 per month on Max, spent before purchased credits, expire each billing cycle, cover the Claude API but not Claude Code. https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
