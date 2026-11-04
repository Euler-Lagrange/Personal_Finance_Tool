# Import identity and confirmed coverage - November 3, 2026

## Scope

Schema 11 adds preserved source occurrence identities, optional confirmed account-scoped IDs, explicit inclusive download ranges/observation times, compatible full-export count comparisons, and unchanged-row reconciliation. This is a completed dependency within the continuing import section; new-row automatic classification and provisional review are not implemented yet. All QA uses synthetic data.

## Behavior

- Imported time, newest spending date in the file and confirmed download range are separate facts. Actual filter boundaries, transaction/posted-date basis, completeness, profile and observation time require explicit confirmation. Row extrema never establish coverage. Empty complete ranges are valid; unresolved or unreliable posted rows prevent accepted coverage. Images and evidence-only PDFs cannot claim complete coverage.
- Optional posted-date, stable-ID and currency mappings are exposed. IDs require explicit confirmation that they persist per transaction across downloads. Repeated IDs or conflicting source values remain reviewable. Different verified IDs preserve identical real purchases. IDs are account-scoped; only USD financial rows can post.
- ID-free comparisons use the latest accepted compatible observation covering each date, preserving occurrence counts without summing overlapping files. Raw descriptions retain punctuation, digits and case, normalizing whitespace only. Profile, columns and date basis must agree. Partial/incremental sources do not use count matching. Older accepted observations do not displace newer ones.
- Existing occurrences can be reconciled without changing financial events, including after manual amount/description/category/sharing edits. Excluded and deleted evidence is retained. Reduced counts warn and never delete. Extra stable-interior occurrences require review; prior final posted day/final five transaction days are conservative eligibility heuristics, not verified issuer guarantees. Eligibility does not yet automatically post new records.
- Reconciliation retries reuse the same operation receipt. Source revisions guard stale decisions. Later operations retain dependencies; undo must proceed in dependency order and cannot erase edited/otherwise-referenced events. Mapping changes invalidate coverage. Processed coverage stays locked with its decisions.
- Merchant-rule batches recheck occurrence eligibility in the native transaction. Existing/ambiguous occurrence evidence cannot be bypassed by a rule. Individual manual overrides remain explicit.
- Schema 10 migration backfills existing imported/linked/excluded occurrences without inventing coverage or changing money. Older recovery fixtures also migrate. Recovery checks layout hashes, source compatibility, normalized observation times, alias provenance/account scope and dependency ordering before replacing current data.

## Findings and fixes

1. Reproduced an excluded-twin resurrection path: a reduced accepted export omitted the excluded occurrence, so the next export initially labeled it new. Historical excluded/removed occurrence checks now hold that extra row for review, while allowing genuinely new activity.
2. Reproduced acceptance of a corrupted coverage layout hash during restore. Recovery now rejects altered layouts, invented aliases and incompatible source/date-basis/account relationships; current records remain unchanged after rejection.
3. Reproduced merchant-rule duplication after manually editing the original imported amount. The broad amount/date matcher no longer found it, allowing the rule to recreate it. Rule suggestions and native batch validation now consult preserved source identity first. The regression verifies rejection, reconciliation and unchanged corrected spending.
4. UI checks initially used exact implicit-select labels, a disabled-option matcher and an amount text node that included its direction sublabel. These harness assertions were corrected and rerun; no passing native interaction is inferred from browser mocks.

## Actual checks

- Final full core suite: **115 passed, one native OCR case intentionally ignored**. Fifteen identity/coverage cases cover three overlapping exports, twins, different/conflicting IDs, exclusions/deletions, edited records/rules, old observations, empty ranges, posted versus transaction windows, incompatible profiles/partial exports, stale revisions, currency, image limits, dependency undo, schema-10 upgrade/restore and corrupt recovery. Existing bills/refunds/PayPal/transfers/account tests also pass.
- Browser baseline plus final focused runs: **68 covered cases pass**. The full 67-case run passed 65 with two new selector failures; corrected cases passed. After final import-only changes, all 18 import cases pass across a 17-pass run and the corrected final currency assertion. The other 50 baseline cases remain applicable. Six new UI cases cover range confirmation, interrupted-response retry, dirty-mapping protection, explicit ID confirmation/reset, partial screenshots, compact themes and currency/identity warnings. Native IPC is mocked.
- Clippy `--all-targets -- -D warnings`, Rustfmt, Prettier and production TypeScript/Vite/Tauri build pass. Nonfatal incremental-cache hard-link fallback warnings remain.
- Visually inspected synthetic compact Light and Dracula coverage controls. Range fields, selectors, confirmation and help text remain readable. Existing import theme/layout cases also pass.

## Delivery and remaining work

`builds/Personal Finance Preview - Import Coverage.exe`, schema 11, **16,197,632 bytes**. Release and delivered copy SHA-256: `A50B750EA13EBF5DCA596909C749EF055D6FDA37B8C43C8AE009DB7DE410AEB8`.

This build retains one coverage declaration per source. Exact-byte repeats reopen the original source and do not establish a new observation or refresh coverage. Separate confirmed observations for byte-identical downloads, saved range/profile patterns, source-aware classification, provisional account/sharing review and merchant-grouped keyboard review remain part of import completion before statements/close can rely on coverage. Current generic mappings and settling windows have not been verified against actual issuer exports.

No real financial database was opened or migrated for QA. Native WebView/Explorer/clipboard end-to-end, issuer/provider credentials, installer and second-device checks remain unverified. PDF extraction, goals, shared statements, close/annual reports, forecasts, optional AI and encrypted handoff remain queued. Continue automatically with the remaining import dependencies; Jacob's live-data trial stays at the end.
