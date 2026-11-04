# Autonomous build queue

## Authorized November 4 extension

Jacob explicitly authorized continuous implementation: reliability pass, then all six sections of the [pay/hours and backup plan](design/PAY_HOURS_BACKUP_PLAN.md), with QA/QC and synthetic data throughout. Accurate personal tax/leave setup remains an in-app configuration step; it does not block building the features. No live financial-data testing is authorized before the final user trial. The initial autonomous queue below is historical completed scope.

| Extension section | Current state |
| --- | --- |
| Reliability: cross-timezone recovery, release discipline, native checks where available | Completed: 343 core/196 browser passes; v0.2.0 delivery; native display inspected, input limitations retained. [QA](qa/QA_2026-11-04_reliability.md) |
| Pay policy, weekly planned/actual hours, sick allowance and holidays | Completed: 349 distinct core/201 browser passes; v0.3.0, schema 38. [QA](qa/QA_2026-11-04_pay_hours.md) |
| Reviewed calendar/document intake | Completed: 355 core/205 browser passes; v0.4.0, schema 39. [QA](qa/QA_2026-11-04_pay_calendar.md) |
| Known pay observations, manual/empirical predictions and variations | Completed: 361 core/210 browser baselines plus final focused passes; v0.5.0, schema 40. [QA](qa/QA_2026-11-04_pay_forecast.md) |
| Offline federal/KY/local withholding and calibration | Completed: 369 core/213 browser passes; v0.6.0, schema 41. [QA](qa/QA_2026-11-04_pay_tax.md) |
| Cash plans, deposit links, annual/close/recovery integration | Completed: 376 core/216 browser cases across full baselines/fixes; v0.7.0, schema 42. [QA](qa/QA_2026-11-04_pay_cash.md) |
| Managed encrypted OneDrive-folder backups, retention and restore | Completed: 384 core/221 browser cases across baselines/final focused checks; v0.8.0, schema 43. [QA](qa/QA_2026-11-04_managed_backups.md) |

Advance after each section's evidence is recorded. Preserve the working database, current verified artifacts and user changes; do not claim external checks from browser mocks. No routine permission request is required for these authorized sections.

## Delivered initial queue

Jacob authorized chaining the remaining sections on November 3, 2026, with integrated QA/QC and integration tests, without routine monitoring. **Use synthetic data until his final live-data trial.** Representative live exports, real provider credentials, and actual balances are not prerequisites for continuing independent development. Do not open his real databases for QA or claim issuer/native/device checks that have not occurred.

The goal is to deliver the approved initial scope ready for that final trial, not to declare the live-data trial passed. The initial queue is delivered as of November 4, 2026. Requirements and architecture remain authoritative; the following sequence records dependencies rather than dropping requirements.

| Section | State | Acceptance focus |
| --- | --- | --- |
| Existing manual/setup/transfers/imports/rules/refunds | Delivered, schema 5 | Preserve 59 core / 40 browser cases and recorded native gaps |
| Recurring bills and payment matching | Delivered, schema 6; 69 core / 45 UI | Due occurrences, actual vs expected changes, autopay not proof, partial/combined links, no duplicate spending, corrections/history |
| Category lines and bill groups | Delivered, schema 7; 78 core / 49 UI | Exact group rounding, per-line overrides, multi-category expenses/refunds, grouped payment integration |
| Account checkpoints, tracking modes, rewards/debt and PayPal reconciliation | Delivered, schema 10; 100 core / 62 UI | Opening balances not income; known vs estimated; partial/combined cash-outs; owned endpoints |
| Import completion and review | Core workflows delivered, schema 18; 175 core / 91 UI | Identity/coverage/observations, verified processing, reconciliation, reusable defaults, payment conventions, conditional categories and held/recorded merchant review. Actual issuer conventions remain final-trial verification; statement/PDF integration follows in its queued sections. |
| Savings goals and funding | Delivered, schema 19; 188 core / 97 UI | Real account goals, goal-only default, partial/shared funding, refunds preserve policy, no invented deposits |
| Shared reporting and statements | Delivered, schema 20; 197 core / 102 UI | Bills/everyday filters, opening and repayment context, exportable statement without duplicate balances |
| Month close, rollover, annual and trends | Delivered, schema 23; close/reopen, annual totals, signed carry corrections, explicit budget periods and basic category/merchant trends; 230 core / 122 UI | Locks, checklist, explicit reopen, idempotent corrections, completed zero months, actual vs allowance totals |
| Pay schedules, card statements and cash forecasts | Delivered through schema 27; 263 core / 144 UI in final full suites. Dated cash plans, statement cutoff review, payment/credit allocations, carried debt and qualified checking timeline. See CASH_FORECAST_DESIGN.md and QA_2026-11-03_cash_forecast.md | Real cadences, known checkpoints/coverage, estimated vs confirmed statements, partial payment allocations, no double-counted cash outflows |
| PDF evidence and declarative templates | Templates, tables, destination reuse and original viewer delivered, schema 30; 293 core / 164 UI | Document fields, bounded table mappings, unique automatic table recognition/staging and existing-import integration pass. Opt-in destination reuse holds conflicts and preserves manual dates. Original-PDF display is bundled offline; reviewed AI follows. See PDF_REUSE_DESIGN.md and QA_2026-11-03_pdf_reuse.md |
| Optional Claude/OpenAI hooks | Requests, transactions, document obligations and configuration suggestions delivered, schema 34; 324 core / 179 UI, with preceding isolated native credential roundtrip. See ASSISTANCE_DESIGN.md and QA_2026-11-03_ai_suggestions.md | Off by default, protected keys, reviewed extraction only, errors/cancellation, mocked contract tests; real credentials tested only when supplied |
| Encrypted laptop handoff and packaging | Handoff and installer delivered, schema 35; 333 core / 186 UI. See QA_2026-11-04_handoff.md and QA_2026-11-04_packaging.md | Vetted encryption, complete snapshots, ancestry/divergence, secrets excluded, corrupt restore isolation, installer/Windows smoke checks where possible |
| Final integration and live-trial handoff | Delivered, schema 35; 334 distinct core / 188 full-suite UI passed. See QA_2026-11-04_final.md and LIVE_TRIAL.md | Synthetic multi-month lifecycle, import→bill→refund→goal→close→restore→handoff, weekly dashboard recap, documentation, verified final executable/installer; external acceptance remains explicit |

Run the [section workflow](DEVELOPMENT_WORKFLOW.md) at every checkpoint. Record scope, regressions, actual results, artifact hash, and remaining limits in a section QA report. Advance this queue automatically after a successful checkpoint; do not ask Jacob to approve routine next sections. Request input only for a genuine dependency that cannot be resolved from the agreed plan, and continue unaffected work.

Follow-on investment-platform activity adapters, automatic synchronization, broader OCR, and advanced trends remain follow-on work as stated in the requirements; they do not block completion of the approved initial scope. No holdings/performance tracking is authorized by this queue.

Execution note: Jacob explicitly renewed continuation after resetting usage and asked to clear the stale flag. The authorized queue is now delivered. Live financial data, actual providers, native UI/installer acceptance and a physical laptop transfer remain Jacob's final trial; they are not marked passed by this queue.
