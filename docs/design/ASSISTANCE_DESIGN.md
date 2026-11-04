# Optional reviewed document assistance

Implemented through schemas 31–34, with the Claude request fixes and completed-request token usage in schema 37. Provider connection/request/proposal review and guarded adoption use the existing import/document safeguards. Offline workflows remain available. This document retains checkpoint chronology below; the current combined verification and live-provider status are recorded in [integration QA](../qa/QA_2026-11-04_api_integration.md).

## Combined category/API verification

The schema-37 app retains the schema-36 Sheets preset, theme catalog and context help. `claude_api_upgrade_keeps_sheet_defaults_closed_month_and_reviewed_mapping` in [configuration tests](../../src-tauri/src/tests/ai_configuration.rs) covers the actual migration, legacy proposal recovery, new role/index wire response with token usage, explicit mapping review, an imported shared Electric expense, monthly defaults, closed-month locks, backup/restore and Sample/Personal isolation. Provider responses remain proposals; receiving or reviewing a mapping creates no spending.

The explicitly ignored `live_claude_structured_extraction_with_synthetic_fixtures` test now uses a real synthetic transaction-table PDF for the transactions task. It checks six rows and $624 of purchases plus a $624 credit, required statement values and actual CSV column choices; schema-valid empty output is insufficient. It can read `ANTHROPIC_API_KEY` from the test process or the selected app credential through Windows Credential Manager. For the latter, explicitly set `PERSONAL_FINANCE_LIVE_SETTINGS_ROOT` and `PERSONAL_FINANCE_LIVE_WORKSPACE` to the configured app root and `demo` or `personal`, with that provider enabled. It opens no financial database, sends only bundled synthetic fixtures and prints only model/effort/token/time metadata. The test remains excluded from normal suites and never retries or switches models automatically.

## Connection and requests

Live verification on November 4 passed using the saved Sample-workspace credential: statement PDF, transaction-table PDF and CSV mapping, all with synthetic material. Model `claude-opus-5-5` at high effort returned valid proposals and the expected fixture content. See [integration QA](../qa/QA_2026-11-04_api_integration.md) for usage, timing and remaining limits. No financial database or real statement was used; Personal settings remain separate.

- Claude/OpenAI selectable independently, off by default, with explicitly entered model IDs and per-request scope confirmation. Do not assume a subscription is an API credential or promise credit availability. No silent fallback or model/provider switching.
- Native-only HTTPS calls to fixed provider endpoints. No provider credentials in the browser after saving, database, audit payloads, backups, laptop transfer or logs. Store keys in Windows Credential Manager under app-root/workspace/provider names. Use local-only persistence. Settings contain only provider/model/enabled/revision, saved atomically outside the financial DB.
- Start with one stored source per request: reviewed/redacted extracted text or explicitly selected original PDF/image. Mapping requests can use a small text/header sample. Show exactly which material will leave the device and the selected provider/model. Never send accounts, ledger, other files or whole-workspace context implicitly. Documents are untrusted data; no tool execution or arbitrary URLs.
- Native preparation binds consent to source fingerprint/revision, selected content/task and current settings revision. A confirmed request gets a payload-bound job ID before network work. Repeating that ID does not bill a second request. Explicit retries use new IDs. Persist job states and source/provider/model provenance in SQLite; interrupted jobs require explicit retry after restart.
- Release the DB gate during network work. Bound input/output and timeout; disable redirects and automatic retries. Cancellation aborts local processing and discards late results; it cannot undo data already sent or provider charges. Read status by job ID/workspace; changed views never expose another source's result.
- Distinguish authentication, permissions, exhausted credits/spend caps, temporary rate limits, timeout/network, provider failure, refusal/truncation and malformed output. Honor Retry-After. Return safe actionable messages without echoing raw headers, keys or source data. Never keep retrying a billing failure.

## Claude request parameters (November 4, 2026)

Reviewed against the live platform docs; see [the fix plan](CLAUDE_API_FIX_PLAN.md) and [QA](../qa/QA_2026-11-04_claude_api.md).

- Default model `claude-opus-5-5` when a device has no saved Claude settings; the user may replace it. Every Claude request sends `output_config.effort: "high"` and `max_tokens` 32,000, because thinking is always on for this model, counts toward the output budget, and a 200-row transaction proposal with evidence quotes needs roughly 16,000 output tokens. No `thinking`, sampling, prefill or `tool_choice` fields are sent; API version `2026-10-21`.
- Structured outputs allow at most 16 union-typed properties (`anyOf` or a `type` array) per request and 24 optional properties. Column suggestions therefore travel as `columns: [{role, index}]` pairs instead of ten nullable column properties; the stored `Mapping` shape is unchanged and older stored proposals still load. A core test counts both limits for every task schema.
- Transport stays non-streaming with a 600-second whole-request timeout and TCP keep-alive. Streaming is the follow-up if live requests approach that limit. The provider compiles a new schema once and caches it for 24 hours, so the first request per task is slower.
- Billing detection also recognizes the monthly spend-cap 429 (`details.error_code` = `enforced_spend_limit_reached`, no Retry-After) and a self-set spend limit 400 ("API usage limits"). 413 maps to an input error. Original PDFs must contain 1–600 pages, verified from the original bytes before request preparation; the local text extractor's 100-page ceiling or failure to extract scan text cannot bypass this guard. Unreadable/encrypted originals remain blocked, with reviewed text available. The selected provider/model can impose a lower limit. Completed jobs persist the provider's `usage` token counts (schema 37) and the request list shows them.
- Refusal fallbacks are deliberately not enabled: the design forbids silent model switching, and a refusal is surfaced for the manual workflow.

## Proposal review and adoption

- Operations: extract bill/statement fields or transaction rows with page/quote evidence; propose a declarative PDF document/table template or structured-file column mapping. Limit outputs, validate schemas and all financial/date conventions in Rust. Unknown values stay unresolved.
- Provider output is only a proposal. Show original PDF/image or sent text beside it, provider/model and warnings. User corrections and source confirmation precede adoption. Templates/mappings go through their existing native previews and approval; AI does not execute mappings or activate them itself.
- Reviewed transaction proposals stage evidence-backed rows with the same conservative individual-confirmation policy as screenshot readings, then use existing account, identity, payment/refund, categorization and shared-allocation checks. AI rows cannot bypass those checks or assert complete coverage automatically.
- Bill/statement proposals use explicit existing targets and the same authoritative paid-capacity, statement obligation, date, stale-review, duplicate-evidence and close protections. No extraction creates spending/payment. Preserve the reviewed proposal, source references and operation receipt.
- Validate assistance provenance and materialized rows during restore. Keys/settings stay device-local and are excluded from handoff; new devices start with providers off. Keep source data and keys out of fixtures.

## QA

Use synthetic sources, fake keys and mocked transports. Cover consent/source/settings invalidation, key masking, no external call while disabled, exact request envelopes, fixed endpoints/no redirects, response limits/refusal/truncation/errors, cancellation/restart/retry identity, same-workspace/source isolation, proposal correction/adoption, migration and corrupt restore. Validate actual Windows credential storage only with isolated synthetic credential names and cleanup. Real provider credentials/credits and issuer samples remain final-trial checks.

## Reference URLs recorded November 3, 2026

These are historical implementation references, not a live API compatibility check. The actual configured envelopes are in [client.rs](../../src-tauri/src/assistance/client.rs). Model/account access, version headers and provider behavior require independent verification; the documentation refresh made no provider request.

- OpenAI Responses structured output: https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses . Responses uses `text.format` JSON schema; file inputs accept inline base64. Use `store:false` and no tools.
- OpenAI files: https://developers.openai.com/api/docs/guides/file-inputs .
- OpenAI errors: https://developers.openai.com/api/docs/guides/error-codes . Billing/quota errors are distinct from temporary rate limits.
- Claude structured output: https://platform.claude.com/docs/en/build-with-claude/structured-outputs . Use `output_config.format`, not deprecated `output_format`.
- Claude PDFs: https://platform.claude.com/docs/en/build-with-claude/pdf-support . Use inline base64, without a persistent Files upload.
- Claude versions: https://platform.claude.com/docs/en/api/versioning . Explicit `anthropic-version:2026-10-21`; temperature/top_p/top_k are removed in this version.
- Claude errors: https://platform.claude.com/docs/en/api/errors . Billing/spend failures can differ from transient 429s; do not promise automatic renewal.
- Windows credentials: https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew and https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw .
- HTTP client: https://docs.rs/reqwest/0.13.5/reqwest/struct.ClientBuilder.html .

## Historical request-only checkpoint (schema 31)

Schema 31 stores source-bound request IDs, exact sent text, content hashes, provider/model/settings revision, lifecycle states, proposed output and safe failures. Fields and transaction rows are supported in this checkpoint. At that checkpoint, adoption had not yet been added. Schemas 32–34 below now implement reviewed row staging, document application and configuration suggestions; none bypasses financial guards.

Normal startup reads mark requests from an earlier app session interrupted; restore marks saved running requests interrupted before copying the validated candidate. Repeating a saved ID only returns its prior state. Native background tasks release the database lock during the request; cancellation aborts the local task and terminal states reject late results. Server retry waits support delta seconds and HTTP dates and are never shortened to one day. Billing errors do not start an automatic retry.

Keys are scoped to this app data directory, workspace and provider. The Windows generic credential uses local-machine persistence for the signed-in user; JSON settings contain no key and sit outside SQLite backups. A key replacement first persists disabled settings, so interrupted replacement cannot leave an enabled partial configuration. This is operating-system credential protection, not an app passphrase or encrypted live database.

The UI shows text-only versus the entire original attachment, requires a separate confirmation, invalidates consent when edited, and retains the same request ID after a lost IPC response. It displays up to the latest 100 requests for a source. History includes sent material, quotes, page references, model and warnings. Unknown values stay unresolved. Actual provider billing, supported models and issuer interpretation still require the final live trial.

## Guarded adoption checkpoints

Adoption is divided into transaction rows, document obligations, and declarative mapping/template suggestions, each with its own QA/build checkpoint. All three adoption checkpoints below are now implemented; the division records their verification sequence.

Schema 32 stages edited transaction proposals from PDF/image sources into the existing import queue. Every change clears preview/confirmation; the native token binds the source revision, original proposal and prior source dataset. Staging is atomic and retry-safe, replaces only unprocessed rows, retains the original AI result and reviewed corrections, and creates no financial event. Reopening a review reloads its saved corrections. Structured exports continue to use column mapping.

An explicit assisted marker and reviewed binding survive observations and restore. Assisted rows always carry uncertainty warnings and require individual confirmation; they cannot use automatic/bulk purchase posting or claim complete account coverage. Unknown dates/amounts/status/currency stay unresolved. The existing posted-USD, direction, account, duplicate, refund and payment guards still apply. Approved local PDF table bindings cannot be overwritten by AI staging, or vice versa. Original extraction cannot be rerun over reviewed AI evidence; a fresh reviewed proposal can replace unprocessed AI rows.

Restore validates the original proposal hash, review/token, staged dataset, every raw row, parsed candidate and review-policy marker. Review receipts and source quotes remain available after rows are processed. Original local PDF text continues to be checked against the file bytes.


Schema 33 applies corrected bill/statement fields only after source quotes, explicit USD/target confirmation, reference note and native preview. Missing components produce an arithmetic warning; complete components must equal the total. Shared obligation logic protects bill paid capacity, statement calculations and existing payment obligations. The immutable source fingerprint is consumed once across local templates and AI applications, including fresh observations. The application, reviewed input, original-proposal hash, preview proof, source revision and audit are atomic and validated on restore. Reopening displays saved corrections read-only. Corrections to an applied target use its existing bill/statement workflow. No application records spending or a payment.


Schema 34 adds task-specific strict configuration schemas for structured column, PDF document and PDF table suggestions. Older proposal serialization remains byte-for-byte compatible when configuration is absent. Provider proposals cannot set posting/stable-ID confirmation, a missing year or automatic table staging. Native source checks reject mismatched formats, changed/dismissed sources and processed rows. An unsupported layout can return no configuration with an explanation.

Column adoption reuses the authoritative importer configuration writer inside a single transaction, adding a parsed preview token and immutable AI review receipt. The token binds corrected columns, exact source dataset, original proposal and account revision. Applying changes only mapping/rows/profiles and invalidates classification/coverage; it records no money. Recovery checks the receipt and original proposal. Template suggestions seed existing editors and retain their native source-backed local extraction/approval proofs; their corrected approved definitions and original AI job remain separately inspectable. No template is activated by receiving a provider response.
