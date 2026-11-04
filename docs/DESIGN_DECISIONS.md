# Design decisions and their rationale

Current as of November 4, 2026, checked against the schema-35 source. This records implementation choices rather than inventing new user requirements. R IDs refer to [requirements traceability](REQUIREMENTS_TRACEABILITY.md), S IDs to [original screenshots](reference/SCREENSHOTS.md), and G IDs to [review limits/findings](CODE_REVIEW_GUIDE.md). The original proposals and Claude responses remain in [review history](reviews/README.md).

## November 4 extension decisions

**D21 — Sheet-based defaults without rewriting history (R34).** Seed the S5 monthly category names and visible planned limits in new workspaces. Schema 36 adds missing definitions to existing workspaces, replaces only untouched starter defaults and preserves saved monthly budgets, customized/archived categories and all recorded transactions. An existing broad category is not relabeled once the workspace has history. Income, refunds and savings transfers retain dedicated accounting semantics. See [preset/migration design](design/SHEETS_CATEGORY_DEFAULTS.md), [native preset](../src-tauri/src/category_defaults.rs) and [QA](qa/QA_2026-11-04_sheet_categories.md). The dashboard remains a clearly labeled five-category summary with a link to the full catalog.

**D17 — Pay and hours domain (R30, S7/S9).** The first section implements actual/planned daily work, restricted sick time, manual official holidays and effective-dated straight-time rates. Schema 38 stores a current policy/hour snapshot plus an append-only change history with request receipts, sequential revisions and hashes; recovery replays that history. This keeps rejected/retried/stale writes atomic and preserves edits without changing financial income. Money is rounded half up once per weekly gross total, from integer four-decimal rates/hours. Invalid sick allocations retain actual work and block the affected gross estimate until reviewed. Year setup explicitly distinguishes unknown prior sick use or incomplete holidays from confirmed zero/complete. See [calculation](../src-tauri/src/payroll.rs), [persistence](../src-tauri/src/db/payroll.rs) and [section tests](../src-tauri/src/tests/payroll.rs). Schema 39 adds reviewed period/week assignments and immutable source evidence; new empty state fields are omitted to preserve older history hashes. Source-bound changes need valid quotes, explicit review and nonoverlapping week ownership. Intake destination is captured at enqueue, so page navigation cannot reroute files. See [calendar design](design/PAY_CALENDAR_DESIGN.md). Schema 40 adds [known observations and retained forecasts](design/PAY_FORECAST_DESIGN.md). Missing net remains null; facts with arithmetic conflicts stay reviewable but cannot train empirical models. Predictions use only compatible earlier paychecks and freeze original inputs/results; later edits mark changed inputs. Whole-period gross rounds once after exact daily products. Fit error is an interior-point holdout measure, not a future confidence bound. Facts/forecasts do not create income. Schema 41 adds [offline withholding/calibration](design/PAY_WITHHOLDING_DESIGN.md): use official annualized payroll schedules, distinct taxable wage bases and confirmed same-employer YTD. Never infer personal W-4 elections or use AI arithmetic. Compatible past residuals may supply a bounded median correction; unsupported/missing context stays unavailable. Schema 42 [cash integration](design/PAY_CASH_INTEGRATION_DESIGN.md) allocates existing ordinary income without creating transactions. Approved estimates remain frozen until reviewed; schedule takeover suppresses persisted and virtual occurrences, including guarded release/date changes. Separate worked/paid dates, explicit timesheet finalization and retained month-close explanations preserve financial history.

**D18 — Managed destination snapshots (R31).** Keep live SQLite local; write complete validated age-encrypted archives under an explicitly chosen root. [Implemented service](design/MANAGED_BACKUPS_DESIGN.md) uses independent archive identity, device-local settings/catalog and optional Windows credential storage. Native automatic writes are debounced while open, with import/close checkpoints and startup catch-up. A locally retained passphrase check prevents accidental key changes; the file and original passphrase suffice for recovery elsewhere. Only owned catalog files are retained/pruned, after a newer snapshot authenticates and validates; keep newest, daily/monthly and protected checkpoints. Windows handles bind deletion to the verified object. Restore authenticates, checks the exact local preview token, preserves a local branch and atomically replaces records with a retry receipt. Routine backups never advance handoff ancestry. OneDrive sync is explicitly unverified.

**D19 — Implemented dashboard spacing ownership (R32, S8).** The overview parent owns a 24px wide/20px compact gap. Bills and Goals share a responsive row, Recent activity remains separate, headings and empty states align, and theme-derived borders/shadows clarify surfaces. This fixes the reproduced zero-gap defect without financial schema changes or adding clutter. See [checkpoint QA](qa/QA_2026-11-04_payroll_plan_ui.md).

**D20 — Shared context help with visible page descriptions (R33).** Keep explanatory copy in one typed catalog and use one accessible hover/focus/click component throughout the app. Preserve actual heading semantics, show only one explanation at a time, keep essential warnings outside tooltips, and dismiss help before Escape reaches a dialog. Native popovers/fallback portals prevent clipping without a new library; all calculations and records stay untouched. See [design](design/CONTEXT_HELP_DESIGN.md) and [QA](qa/QA_2026-11-04_context_help.md).

## D01 — Local Windows application with one native financial core

**Need:** R01/R03/R19: offline use, polished desktop UI, Windows clipboard/OCR and easy file intake.

**Decision:** Tauri 2 hosts bundled React/TypeScript in WebView2. Rust owns file parsing, validation, monetary writes, SQLite, recovery and provider requests. The UI calls native commands through [api.ts](../src/api.ts); it has no fallback browser ledger. See [lib.rs](../src-tauri/src/lib.rs), [Cargo.toml](../src-tauri/Cargo.toml) and [Tauri configuration](../src-tauri/tauri.conf.json).

**Why and cost:** This permits one modern themeable interface with native Windows capabilities and offline data. It adds a Rust/web boundary, WebView2 packaging and manually maintained DTO/command contracts (G08). Native behavior still needs its own acceptance evidence (G01).

## D02 — SQLite workspaces, embedded evidence and explicit personal scope

**Need:** R02/R05/R22/R23: one operator, fresh months, easy recovery, original evidence and Windows protection.

**Decision:** `Store::open` accepts only `demo` or `personal`. Each has its own SQLite file/backups under per-user app data, outside the source checkout. Foreign keys, WAL, migrations and revisioned writes protect consistency. Original imported bytes live in `import_evidence` inside the same database; repeated observations reference those bytes. Participants are fixed Jacob/Chelsea roles, not a generic person/login service. See [Store](../src-tauri/src/db.rs), [models](../src-tauri/src/models.rs), [migrations](../src-tauri/src/migrations.rs).

**Why and cost:** A complete snapshot carries records, documents and provenance together; Sample cannot become Personal by changing a visible filter. Full database snapshots cost disk and hit handoff limits sooner as evidence grows (G06). Generic participants/joint-finance ownership and separate attachment storage would need schema changes. Local SQLite/backups use Windows/device protection without additional app encryption, as Jacob chose.

## D03 — Separate full payment, personal spending and household debt

**Need:** R06/R07/R09/R13; S1/S3/S6. The bank charges the full amount, the budget usually uses Jacob's share, and either person may owe the other.

**Decision:** Canonical `events`, `event_lines`, `account_activity` and stored Jacob/Chelsea allocations represent distinct effects. Positive household delta means Chelsea owes Jacob more; negative means Jacob owes Chelsea more. Card debt increases positively on a purchase and decreases on a payment/credit. Checking spending decreases cash. A card payment changes both account legs and creates no new purchase spending. See [core write path](../src-tauri/src/db.rs), [money](../src-tauri/src/money.rs), [transfer validation](../src-tauri/src/db/transfer.rs).

**Why and cost:** This preserves the full-paid/you-lent distinctions visible in Splitwise and prevents the $624 payment from duplicating $624 of purchases. Transaction kind, category, ownership and bill association remain independent. Consumers must select the right measure; a single generic Amount total is inadequate. The 70/30 `shared` preset is hardcoded, with per-record overrides; there is no salary calculator or global ratio editor (G04).

## D04 — Exact cents, group rounding, and obligations separate from payments

**Need:** R08/R13; S1's grouped rent, exceptions and inconsistent math checks.

**Decision:** Authoritative money uses bounded integer cents. Simple percentage splits round Jacob's share half up and assign Chelsea the remainder. For inherited bill lines, calculate the inherited subtotal's split once, distribute Jacob's target proportionally by largest remainder, and use stable line IDs to break ties. Explicit line overrides remain separate. Refunds reverse stored original shares cumulatively. See [money](../src-tauri/src/money.rs), [lines](../src-tauri/src/db/lines.rs), [refunds](../src-tauri/src/db/refunds.rs).

Bills are schedules and occurrences linked to actual transactions. Partial and combined links consume payment capacity; evidence and an autopay flag do not create money. See [bills](../src-tauri/src/db/bills.rs).

**Why and cost:** Group and line totals reconcile exactly, and invoice-plus-payment cannot count twice. Capacity/dependency guards make some corrections require explicitly unlinking funding or payment relationships first. This adds review steps but preserves traceable accounting.

## D05 — Preserve source observations and occurrence identity

**Need:** R09/R16/R17/R22: overlapping exports, screenshot-then-CSV, real identical purchases, safe retries and fewer repeated reviews.

**Decision:** Separate immutable evidence, download observations, raw/normalized rows, canonical occurrences, event links and operation receipts. Use confirmed account-scoped stable IDs when available; otherwise require compatible confirmed ranges and multiplicity-aware reconciliation. Exact file/image fingerprints identify repeated evidence, not a universal transaction ID. Smaller or partial exports do not delete existing events. See [identity](../src-tauri/src/db/identity.rs), [observations](../src-tauri/src/db/observations.rs), [import writer](../src-tauri/src/db/imports.rs).

**Why and cost:** A fresh download and an old file replay are different facts. Complete overlap can avoid re-review while preserving twins and exclusions. Coverage setup, profile conventions and targeted ambiguity review are necessary; fuzzy amount/date matching cannot prove identity. Narrow undo protects later dependencies. Source-calendar portability remains a review issue (G07).

## D06 — Explicit automation boundaries and independent rules

**Need:** R16/R18/R19: low data entry, manual control, minimal repeated tagging, and browse/drop/paste equivalence.

**Decision:** One intake queue feeds native parsing. After account/date/sign/status/range confirmation, enabled verified profiles can process reliable rows. Unknown expense categories count as Uncategorized; positive verified expenses awaiting sharing are provisional rather than falsely reassuring. Category/ownership rules are independent, with explicit Ask and previewed Remember actions. Merchant-group editing uses the same financial guards. See [intake](../src/ImportIntake.tsx), [classification](../src-tauri/src/db/classification.rs), [rules](../src-tauri/src/db/rules.rs), [purchase review](../src-tauri/src/db/purchase_review.rs).

**Why and cost:** Useful imports need not wait for a complete rule library. Manual corrections remain deliberate. Every OCR/AI row currently requires individual confirmation; this is a conservative implementation limit relative to Jacob's low-review goal (G03), not a claim that all simple screenshots auto-post. Running balances, cropped rows, uncertain signs and unknown years cannot be inferred into certainty.

## D07 — Local declarative PDF templates with original evidence

**Need:** R20/R22: bills and credit-card PDFs should reduce entry, match records and work offline where possible.

**Decision:** `lopdf` extracts bounded text. Approved declarative document/table definitions match identity, USD markers, layout, dates and amounts; arithmetic and unique template/destination checks gate reuse. Table extraction stages pending rows. Bill/statement application updates an obligation and links evidence without creating a payment. PDF.js renders stored original bytes with local worker/fonts/decoders. See [PDF parsing](../src-tauri/src/imports/pdf.rs), [document application](../src-tauri/src/db/pdf_documents.rs), [table application](../src-tauri/src/db/pdf_tables.rs), [destination reuse](../src-tauri/src/db/pdf_routes.rs), [viewer](../src/PdfRenderer.tsx).

**Why and cost:** Approved formats can be reused without sending every bill to a model. Layout drift is reviewable and evidence remains inspectable. Arbitrary spatial/wrapped tables and scanned PDFs are not universally supported; manual correction or optional assistance is still needed. A template is interpreted data, never generated code.

## D08 — PayPal receipt and checking cash-out are separate linked facts

**Need:** R07; explicit confirmation that Chelsea pays through PayPal into checking.

**Decision:** Record a received settlement once against the household balance, optionally held in PayPal. A later bank deposit allocates one or more receipts, can use part of a receipt, and reconciles other funds/fees explicitly. It creates bank activity without resettling the household or inventing income. See [household](../src-tauri/src/db/household.rs) and [tests](../src-tauri/src/tests/household.rs).

**Why and cost:** Receipt dates, bank dates and amounts need not match one-to-one. Descriptions containing PayPal are insufficient proof of Chelsea repayment. This is a receipt reconciliation mechanism, not a full PayPal wallet balance or direct payment integration.

## D09 — Close snapshots and an allowance ledger

**Need:** R10/R11; S4/S5: reliable monthly limits and annual reporting without manual copying.

**Decision:** Close saves the latest final totals and a canonical financial fingerprint. Native transaction commit guards reject changes to closed financial state, including indirect funding dependencies; nonfinancial notes and later refunds remain possible. Reopen is explicit. Signed carry entries record source, target, previous output and correction delta so reclose does not replay money. Budget-period overrides preserve actual dates and require a reason. See [periods](../src-tauri/src/db/periods.rs), [rollover](../src-tauri/src/db/rollover.rs), [overrides](../src-tauri/src/db/budget_periods.rs).

**Why and cost:** Annual results can mix final closed snapshots and visibly provisional open months. True closed zero months count in averages; missing/future periods do not. A single latest close plus audit/backups keeps the UI manageable, while historical corrections sometimes require explicit reopen/unlink actions.

## D10 — Goals attach to actual savings accounts; funding changes allowance

**Need:** R12; explicit separate-account and goal-only answers; S2/S4.

**Decision:** Goals reference real savings accounts. Supported funding assigns cents only to Jacob's purchase-line share, with a saved `goal_only` or `count_monthly` policy. Actual spending remains intact; only valid goal-only funding reduces allowance usage. Physical evidence is a supported withdrawal, goal-account card payment or direct purchase. Refunds reverse the original eligible fraction without creating a savings deposit. See [goals](../src-tauri/src/db/goals.rs) and [goal tests](../src-tauri/src/tests/goals.rs).

**Why and cost:** This matches Jacob's separate accounts and avoids a second virtual bucket ledger. Unknown/insufficient funding must remain flagged. Financial edits may require releasing dependent funding, and received refunds do not automatically make the original withdrawal available for reuse.

## D11 — Dated cash plans and qualified statement obligations

**Need:** R14/R15; S2: paycheck cadence, planned savings and full statement payment without conflating cash with spending.

**Decision:** Cadences produce dated expected events; matching uses one actual event. Card cutoff calculations start from a known end-of-day balance plus effective account activity with explicit coverage/date assumptions. Issuer confirmation is distinct. Incremental obligations allocate actual payments and reviewed credits without summing carried debt twice. Forecasts use full remaining checking outflows and exclude unreceived receivables from current checking. See [cash plans](../src-tauri/src/db/cash_plans.rs), [statements](../src-tauri/src/db/card_statements.rs), [payment review](../src-tauri/src/db/card_payments.rs), [forecast](../src-tauri/src/db/cash_forecast.rs).

**Why and cost:** Every-14-day pay can produce three paydays; a current card balance is not automatically the next statement amount. Confidence depends on checkpoints, coverage and issuer rules. The forecast is a qualified known-plan projection, not live bank reconciliation or a spending guarantee.

## D12 — Optional AI proposes; native review adopts

**Need:** R21/R22/R23: provider choice, offline preference, parsing help and error checking.

**Decision:** Disabled-by-default Claude/OpenAI settings take an explicit API key and model ID; Claude defaults to `claude-opus-5-5`, and every Claude request runs at high effort with a 32,000-token output budget and a 600-second timeout (November 4, 2026, see [the Claude API fix plan](design/CLAUDE_API_FIX_PLAN.md)). Keys use Windows Credential Manager; settings stay device-local. Each request binds reviewed material, source/settings revisions and a persistent ID. Fixed native endpoints, bounded responses and no automatic retry limit unintended behavior. Edited proposals pass through native import/document/template guards; models get no tools or write authority. See [client](../src-tauri/src/assistance/client.rs), [vault](../src-tauri/src/assistance/vault.rs), [jobs](../src-tauri/src/db/ai_jobs.rs), [row](../src-tauri/src/db/ai_rows.rs), [document](../src-tauri/src/db/ai_documents.rs) and [configuration adoption](../src-tauri/src/db/ai_configuration.rs).

**Why and cost:** Difficult documents can get help while ordinary workflows remain local. This does not log into Jacob's chat accounts or establish that his reported subscriptions provide usable API access/credits. Actual provider/model contracts remain G01. Saved request history can include sent material; cancellation cannot retract a request already received by a provider.

The [combined integration checkpoint](qa/QA_2026-11-04_api_integration.md) preserves D21's screenshot defaults and D09's closed-month locks through the schema-37 usage migration. Network smoke checks remain explicit, use only bundled synthetic fixtures, and can read the selected native credential without revealing it. Missing credentials are reported as an outstanding live verification requirement, never treated as a passing connection test.

## D13 — Modern task-focused UI with restrained themes

**Need:** R03/R25; S3/S5 and later explicit feedback on icons, professional copy, dark/light and expressive themes.

**Decision:** Dashboard-first navigation, aligned currency, semantic status text, category icons and shared theme variables cover fourteen themes, including the serious mid-grey Pewter and soft mid-grey Pebble. Bills, imports, goals, shared records, annual reports and trends have dedicated views. See [App](../src/App.tsx), [themes](../src/themes.ts), [theme CSS](../src/themes.css), [icons](../src/CategoryIcon.tsx).

**Why and cost:** Replaces spreadsheet chores while retaining the information hierarchy. Expressive palettes do not change accounting or replace labels with color. Dense review dialogs and the 1000×700 minimum window deserve independent usability/accessibility review; synthetic screenshots are limited evidence.

## D14 — Deliberate encrypted handoff with recoverable replacement

**Need:** R04/R23/R24: occasional laptop switching, offline use and no extra app-launch passphrase.

**Decision:** Export a complete database snapshot inside authenticated `age` passphrase encryption. Compare actual content and transfer ancestry, not counts or counters. Import validates a bound candidate and fresh preview, requires extra acknowledgement for unrelated/older/diverged history, preserves the local branch and performs an atomic SQLite replacement. Device settings/keys and UI preferences do not travel. OS-held application/workspace leases prevent competing local access. See [handoff](../src-tauri/src/db/handoff.rs), [crypto](../src-tauri/src/handoff_crypto.rs), [leases](../src-tauri/src/workspace_lease.rs).

**Why and cost:** Matches infrequent deliberate switching without a sync server or merge algorithm. Local recovery copies remain protected by Windows, not by the portable passphrase. Preserved branches are excluded from normal 20-backup rotation and consume disk. Wrong-password/tamper/ancestry cases have synthetic tests; physical devices and source-date timezone behavior remain G01/G07. No independent cryptographic audit is claimed.

## D15 — A small weekly recap that cannot affect money

**Need:** R04: understand what changed since a weekly visit.

**Decision:** Capture personal spending, income, entry count and unresolved-source count per workspace/month in local preference storage. Hold the comparison baseline fixed for the current window session; successful snapshots update the next visit's baseline. Malformed/unavailable storage does not block the app. See [VisitRecap](../src/VisitRecap.tsx).

**Why and cost:** Gives quick context without a new financial ledger or schema migration. It reports net totals, so offsetting changes cancel; no itemized audit feed, cross-device recap or cash-balance inference is implied (G05).

## D16 — Synthetic sectional QA, explicit external acceptance and small source repo

**Need:** R27/R28/R29: autonomous development with integrated QA, live data only at the end, organized code for independent review.

**Decision:** Core tests use temporary SQLite stores; UI tests mock IPC; meaningful multi-feature lifecycles cover imports through close/restore/handoff. Production copies are hash-verified, only current deliveries are retained, and generated/private data is ignored. Windows packaging embeds the offline WebView2 installer. See [workflow](DEVELOPMENT_WORKFLOW.md), [final lifecycle](../src-tauri/src/tests/final_lifecycle.rs), [final QA](qa/QA_2026-11-04_final.md), [ignore rules](../.gitignore).

**Why and cost:** Independent work can proceed without touching real finances, but neither mock UI nor core tests establish actual issuer/native/provider/device acceptance. Documentation must distinguish implemented paths, verified scenarios and remaining risks. All historical previews share version 0.1.0, so release-version discipline remains a review item (G10).
