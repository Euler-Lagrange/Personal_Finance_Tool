# QA/QC — bank transfers and card payments

November 3, 2026. This section delivers manual recording, editing, and removal of bank transfers and card payments. Automatic import recognition and matching are explicitly deferred to the importer section. The user's live databases were not opened or changed during implementation or QA.

## Acceptance criteria and results

| Scenario | Verified outcome |
| --- | --- |
| Five purchases of $100, $125.50, $48.25, $200, and $150.25, followed by a $624 card payment | Spending stays $624; card activity returns to zero; checking activity decreases $624; there are six events, not seven. Retrying the same submission is rejected without another payment. |
| January purchase, February card payment | January's spending and budget remain unchanged; February has the payment event with no new income or spending. Chelsea's shared balance is unaffected. |
| Checking-to-savings, then edited savings-to-savings transfer | The old account effects are removed and the new accounts/amount/date take effect together. Deleting reverses both effects; stale edits/deletes are rejected. |
| Partial payment or payment covering unrecorded prior history | Accepted without assuming an opening balance, statement balance, or a match to recent purchase totals. |
| Bad input or a failed destination write | Same account, missing accounts, invalid cents/zero, future dates, wrong account kinds, shared/category allocations, and new archived references are rejected. A simulated database failure on the second account entry leaves no partial event, source activity, or create audit record. |
| Archived account history | Original source/destination references remain available for historical edits; new movements exclude archived choices. |
| Upgrades and recovery | Version 1/2 records, custom setup, revisions, notes, category icons, monthly limits, and prior account activity survive. Failed upgrades roll back. Both transfer entries restore together; missing, extra, wrongly signed, or mismatched entries in a backup are rejected before live data replacement. |
| UI workflows | Bank/card mode selection, decimal-string submissions, account filtering, destination search, editing, delete confirmation/cancel, backend errors, missing accounts, archived choices, Escape, compact layouts, and representative theme contrast pass. |

## Review and corrections

- Expanded the existing one-account recovery checks to validate the exact number, identities, and signs of both transfer entries. The earlier QA regressions remain in the suite.
- Kept card payments separate from purchases and repayments to Chelsea. Shared spending and monthly budget totals continue to derive only from the appropriate event types.
- Kept historical event types fixed during edits, preserved archived references only in their original roles, and required distinct source/destination accounts.
- Used existing theme tokens for transfer panels and icons; corrected an undefined border token during review. Updated preview capability text and date wording to include transfers accurately.
- One existing migration assertion initially expected schema 2; it was updated to the current schema version 3. This was a test expectation change, not a lost-data failure.

No unresolved correctness, data-loss, or workspace-isolation defect was found within this section's tested scope. The verification limits below still apply.

## Checks

- `npm test`: **32 passed** using real SQLite databases in temporary directories, including nine new transfer-focused cases.
- `npx playwright test`: **29 passed** in one full run, including five new transfer cases and all twelve existing theme cases. Tests use synthetic fixtures and mocked native commands. Subsequent UI edits only clarified capability/footer text and singular entry counts.
- Clippy with warnings denied: passed. Incremental-cache hard-link warnings caused fallback copying in this environment; no Clippy findings.
- TypeScript check, Rust formatting, and Prettier checks: passed.
- Screenshots inspected: light bank-transfer form and transaction history, plus the compact Marshmallow card-payment form. Dracula/Marshmallow form readability was also checked programmatically; screenshots are synthetic data.
- `npm run build:desktop`: passed, including the production TypeScript/Vite build. Delivered as `builds/Personal Finance Preview - Transfers.exe`; its SHA-256 matches the compiled release executable.

## Limits and next section

The app records movements that already occurred; it does not initiate a payment or connect to a bank. It uses one manual date for both account entries. Accounts still show recorded activity, not reconciled balances. Distinct manual entries with identical amounts can be legitimate and are not automatically deduplicated; stable-ID retries are protected. Imported duplicate detection, pairing differently dated bank/card rows, matching to an existing manual payment, and statement obligations remain importer/reconciliation work.

Browser UI tests and real core tests are separate. Native WebView end-to-end interaction, installation without WebView2, and a second Windows device remain unverified. This pass used browser visual checks; native Computer Use was not retried after the previously documented approval timeout.

Next: Capital One CSV import. Representative redacted checking and card exports are needed to verify their actual format before creating adapters. Preserve the rule that the bank debit and card payment credit represent one transfer, not extra spending or income.
