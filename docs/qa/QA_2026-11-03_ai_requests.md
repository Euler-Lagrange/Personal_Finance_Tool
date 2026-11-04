# Optional AI request review - November 3, 2026

## Scope

Schema 31 adds explicitly configured Claude/OpenAI connections, protected device-local keys, source/material confirmation, saved request history, cancellation/restart recovery and validated field/transaction proposals. Providers start disabled. Native calls use fixed HTTPS endpoints, no redirects, no automatic retries, bounded input/output/timeouts and no tools. Input files are untrusted data. API billing/access is separate from the app and must be verified in the final trial.

This checkpoint ends at proposal review. Financial adoption, transaction staging, template suggestions and structured-file mapping suggestions remain in the next dependent section. No AI result in this build writes financial records.

## Findings and corrections

- Server Retry-After values initially had a one-day ceiling and accepted only delta seconds. The adapter now preserves the full wait and accepts HTTP-date headers. Native request creation enforces the saved provider wait. Credit/spend failures remain distinct and never automatically retry.
- Source/material/settings changes invalidate consent. Repeated IDs return their saved state without another send; a changed payload under the same ID is rejected. Cancellation and restart/restore interruption reject late results. Tests retain exact source bytes and reject corrupt request provenance before restore changes the current workspace.
- Invalid dates, amounts, currencies, unknown fields, oversized arrays and missing evidence are rejected. Unknown values and legitimate repeated rows survive. Signed statement credit balances remain supported. Failure messages omit raw provider errors, keys and financial material.
- Key replacement persists disabled settings before changing the Windows credential. An interrupted replacement stays disabled and requires reloading its advanced revision. Fake-vault tests cover masking, missing keys, removal and workspace isolation.
- Full migration tests initially retained the schema-31 table while simulating earlier schemas. The shared downgrade fixture now removes that table before testing upgrades; production migration checks were not weakened. Initial browser failures came from an extra navigation step after the fixture had already opened its source and an overly strict label lookup; corrected accessible locators pass.
- The new CSS initially used an undefined border token; it now uses the established theme line token. Final 1100 x 780 light/dark proposal views were inspected. Theme-transition capture is disabled to avoid capturing a half-repainted button.

## Checks

- Full native suite: **305 passed, 2 explicitly ignored environment tests**. The new coverage includes request identity, consent, cancellation/restart/restore, provider envelopes/errors, exact attachment bytes, proposal validation, schema-30 upgrade and corrupt restore isolation.
- Windows Credential Manager: the isolated random synthetic credential test first could not access Credential Manager under the restricted sign-in. The escalated run **passed read/write/replace/delete**, with cleanup. It never enumerates or reads existing credentials and contacts no provider. The other ignored native test is inherited OCR coverage.
- Full mocked browser suite: **170 passed**. New cases cover default-off settings, password masking, save/read failure retention, draft discard, explicit material confirmation, edited-consent invalidation, cancellation, lost-send-response identity, saved proposals and status/error retry without sending.
- TypeScript, Prettier, Rustfmt and Clippy with warnings denied pass. Clippy's new tuple-complexity finding was resolved with a named stored-row type; behavior is unchanged.
- Windows production build passes. Delivered `builds/Personal Finance Preview - AI Requests.exe`, **24,569,856 bytes**, SHA-256 **0162C61FD7CC265C7E207CC56AF94E819AEF04B1DF9981C83CAC3C2FE51C2059**. Release and delivered copy match. Use this build or newer after schema 31. Main bundle retains a nonblocking 591.18 kB / 164.43 kB gzip advisory.

## Remaining verification

No personal financial data or real provider request was used. Request envelope/state tests and mocked browser checks do not certify actual API access, credits, model support, provider interpretation, transport cancellation on a live connection or packaged native WebView behavior. Native key storage was separately exercised as stated above. Original Explorer drop/paste, real issuer samples and second-device use remain final-trial checks.

Saved request history includes the approved sent material and proposals in the financial backup; keys and device settings are excluded. Cancellation cannot retract already transmitted material or charges. Each source view shows the latest 100 requests. A request interrupted by restart needs an explicit new review to send again. Advanced template/mapping proposals and guarded financial adoption remain unfinished.
