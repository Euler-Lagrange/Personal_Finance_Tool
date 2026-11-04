# Merchant rules and purchase-linked refunds — QA/QC

November 3, 2026. Implements the next section after reviewed import intake. All financial tests use synthetic data and temporary SQLite databases. Jacob's actual finance databases were not opened, migrated, restored, or changed for QA.

## Delivered workflow

- Create/edit/disable merchant rules, or Remember merchant during individual import review. Preview current held matches before saving. Exact/prefix phrase matching preserves digits; account and extra description constraints narrow scope. Category and sharing resolve independently through Set/Leave/Ask. Equally specific conflicts ask for review.
- Review clean rule matches together, then explicitly confirm their category/sharing allocations. The native core re-evaluates rules and rejects stale suggestions. Current manual choices and saved financial records are not rewritten. Credits, pending/unknown statuses, OCR warnings, duplicate matches, and unresolved fields do not qualify.
- Record a manual refund or classify an imported credit as a refund of an existing purchase. Use original stored shares and category; record the actual receiving account. Refunds reduce spending in the received month, never income, and correctly reverse shared balances even after settlement.
- Enforce cumulative cent rounding, total-refund caps, valid dates/accounts, immutable original links, protected original financial fields, revision checks, audit, backup/restore, and atomic writes. Later partial refunds get revised/audited when an earlier edit changes their rounding cents. Import undo refuses to change later refunds outside its batch.
- Upgrade schema 1–4 to schema 5 after backup. Preserve financial history and original import evidence, links, and receipts. Older backups migrate in isolation before restore.

## Findings and corrections

| Finding | Correction and evidence |
| --- | --- |
| A refund-only category with a zero limit disappeared from the overview because the filter required positive spending. | Reproduced with an archived category at -$17.50; include any nonzero spending. Regression checks that its category and negative amount remain visible. |
| Negative net spending could produce a negative bar width, or a full bar when the category limit was zero. | Clamp progress to 0–100 and keep zero-limit refund-only bars empty. Regression verifies the displayed bar is zero pixels wide. |
| Clicking Keep refund in the new removal confirmation could submit the edit form because React reused that button as the submit button during the same click. | Reproduced in browser QA. Distinct keyed action sections plus preventing the keep-button default action stop the accidental save. Regression asserts the editor stays open and no save/delete command runs, then verifies explicit removal. |
| An earlier imported refund could otherwise be undone while silently shifting a later manually recorded refund's rounding cent. | Undo now blocks later refunds outside its batch; same-batch refunds remove in reverse creation order. Core regression verifies rejection leaves all totals unchanged and removal works once the later refund is explicitly removed. |
| A category-only rule could otherwise inherit personal ownership as a bulk default. | Bulk eligibility requires an explicit sharing rule too; category-only suggestions remain available for individual review. Core regression covers missing sharing, disabled rules, and archived categories. |
| Large purchase history could omit an already selected old purchase from the limited selector. | Keep the selected purchase visible independently of the first 500 matches; offer search to narrow the list. Reviewed in code. |

Initial new browser cases used exact label-text selectors on wrapped selects; corrected to accessible combobox-role selectors. One partial-refund test initially expected a revision bump when no cent actually changed; changed its input sequence to cause a real cent reallocation and verify the resulting revisions and totals.

## Verification

- **59 core tests passed; 1 Windows OCR integration case intentionally ignored in the regular run.** All 12 new rule/refund tests passed again after strengthening synthetic OCR and version 4 evidence/receipt coverage. The real Windows OCR integration passed in the preceding import section and was not rerun because extraction did not change.
- **40 browser cases passed across full-suite runs and focused reruns after fixes:** 30 app cases and 10 import/rule cases. These use synthetic IPC in isolated Microsoft Edge, not the native WebView bridge. Existing theme coverage still passes for all twelve palettes.
- Rust formatting and **Clippy with `-D warnings` passed**; only the environment's incremental-cache hard-link fallback warning remained. Prettier passed for `src` and `tests/ui`.
- TypeScript and Vite production checks passed as part of the desktop build. Release artifact verification is recorded below.
- Visually inspected `.qa/rules-light.png` and `.qa/refund-dracula.png` at 1000 × 900. Forms are readable, stay within the window, and scroll to their actions. Browser tests exercise both new forms in Light and Dracula; matching screenshots for both palettes are under `.qa/`.
- Key financial example: $137.76 shared purchase, $41.33 repayment, then full refund leaves October spending $96.43, November spending -$96.43, no refund income, and Jacob owing Chelsea $41.33. Five-cent partial-refund edits also conserve original four-cent/one-cent shares exactly.

## Limits and next section

No identified money, data-loss, or workspace-isolation defect remains in this section's tested workflows. This does not certify the unbuilt product.

- Actual native Explorer drops/clipboard interaction and native rule/refund UI remain unverified. Computer Use app approval timed out in prior sections; this section carries that gap forward without relabeling browser checks as native checks. No production app was launched against real data for QA.
- PDFs remain evidence only; there is no general PDF extraction or PDF evidence viewer. No AI calls, new provider connection, or online financial processing was added.
- Rules are suggestions confirmed individually or in a batch. Silent posting, source-specific adapters, provisional ownership totals, sharing-dependent category conditions, full overlap identity logic, and merchant-grouped keyboard review remain target work.
- Refunds cover current single-category expenses. Multiple category lines, goal funding, closed-month adjustments, rewards, and chargeback/dispute lifecycles remain outside this section.
- Accounts show recorded activity, not reconciled bank balances. Device handoff, installer testing, and laptop synchronization remain unverified/unbuilt.
- Next bounded section: recurring bills and payment matching. PDF parsing can follow separately; representative bank exports will help calibrate institution-specific adapters.

## Artifact

- Production build: `npm run build:desktop` passed after the final UI correction.
- Executable: `C:\Personal_Finance_Tool\builds\Personal Finance Preview - Rules and Refunds.exe`
- Size: **15,205,888 bytes**.
- SHA-256: `F59B324BF812F7D24D2E3EEE9299A103889C553839FF047146AE81A1E4083D3F`.
- The delivered file and `src-tauri/target/release/personal-finance.exe` have identical SHA-256 hashes. Production config remains `com.jacob.personal-finance`; no QA identifier override was used for this build.
- Existing executable copies were retained. No running user app was stopped or overwritten. Close older previews before opening this build; older versions cannot open a schema 5 workspace after its first upgrade.
