# Reviewed payroll calendar intake

November 4, 2026; extension section 2, schema 39, release 0.4.0. Implements R30 and S7/S9 calendar requirements alongside the weekly-hours foundation. The source documents describe payroll dates; their text is never treated as instructions. Real employer files are reserved for the final acceptance trial.

## User workflow

**Pay & hours → Paychecks** holds explicit periods with a payday, one to eight distinct Monday-start workweeks, employer withholding frequency, a benefits-deduction flag and notes. Three covered weeks do not change a biweekly withholding frequency. A December 31 Thursday payday and a cross-year workweek remain exactly as approved. Period edits keep the stable ID; prior values remain in the change history. Saving a period creates no income or cash-plan occurrence yet.

**Holidays & allowance** adds month/year views for paydays, official holidays, recorded/planned sick time and unpaid absence. Month cells also show workweek assignments. Manual holiday changes and imported changes reopen annual holiday completeness review; the separate annual setup checkbox remains required for reliable sick-pay estimates.

Browse, drop or paste while on Pay & hours to save a payroll source. The existing intake queue captures its destination at enqueue; navigating to a different page cannot reroute a waiting file into transaction imports. Retry retains the original destination. Workspace changes retain existing isolation/cancellation behavior. Encrypted handoffs still use their separate review route.

Sources preserve original bytes, extracted text, location labels and proposed rows. Imports do not approve a holiday, choose between conflicting paydays, record worked hours or create financial activity. Review the source, choose its proposals or enter a draft manually, check full dates and assigned weeks, document a decision, and confirm. Overlap checks show existing/proposed paydays and require replacement/removal; a confirmation checkbox cannot waive one-week/one-paycheck ownership. The native check repeats the invariant.

## Extraction and evidence boundaries

- DOCX is inspected in memory using bounded ZIP and XML readers. No archive is unpacked to disk. Reject unsafe/duplicate part names, symlinks, oversized expanded content, DTD/custom entities, excessive nesting and incomplete XML. Paragraphs and flat tables retain location labels. XML text/entities remain text.
- DOCX embedded media stays in the original. A visible warning requires comparison or a separate screenshot import. Headers, footers and floating layout can contain dates not present in extracted body text. Nested tables require a simpler export. There is no claim of automatic understanding of arbitrary employer calendar layouts.
- PDF text uses the existing bounded local extractor and original offline viewer. Scanned/unreadable PDFs remain evidence with warnings and a manual original-document reference. Images use existing Windows OCR when available, retaining original source lines and an explicit accuracy warning.
- CSV/Excel/flat DOCX tables recognize `kind, week_start, date, pay_date, name, frequency, benefits`. `kind=week` uses a Monday `week_start` and full `pay_date`; `kind=holiday` uses `date`. Only explicit ISO dates produce proposals. Missing years are never filled from the document title. Duplicate repeated table cells/rows do not invent repeated weeks.
- The first worksheet is extracted; multi-sheet workbooks explicitly warn that other sheets need separate export. Unknown layouts remain readable evidence for manual review. Original files can be exported without overwriting a differing existing copy.

These bounds reuse the established 10 MB per-file limit, with 32 MB expanded DOCX, 4 MB main XML, 128 XML levels, 5,000 text locations and 1 MB extracted text. References point to a retained source location/quote. A manual original-file reference is labeled as such, not represented as an extracted date. The reviewer remains responsible for whether the quoted evidence supports the chosen dates.

The XML interface follows [quick-xml's Reader documentation](https://docs.rs/quick-xml/0.42.0/quick_xml/reader/struct.Reader.html); the dependency is pinned in Cargo. No network service or AI model is used by this extraction path.

## Storage, history and recovery

[Schema 39](../../src-tauri/src/migrations/039_payroll_sources.sql) adds immutable `payroll_sources`: unique content fingerprint, original bytes/hash, extracted document/hash, type/name and UTC intake time. Image identity follows decoded pixels; other source identity follows original bytes. Reimport returns the existing source without posting anything.

Periods and holiday evidence extend the [payroll state](../../src-tauri/src/payroll.rs). Empty new fields are omitted from serialization so replaying schema-38 histories retains their original hashes. Calendar application is one change in the existing revision/receipt transaction: source quotes are validated, modifications are applied to a clone, overlap/structure checks run, then state/history/audit commit together. A rejected or stale batch leaves the current state unchanged; an unchanged retry after a lost response returns the original receipt.

Recovery validates original/text hashes and every retained source reference, then replays payroll history. Old source evidence remains after a manual correction. Sources, periods, holiday provenance and prior revisions travel with complete encrypted handoff; API/device settings remain excluded. Financial month-close snapshots remain separate and unchanged. Net forecasts, expected deposits, actual deposit matching and payroll annual summaries are later sections, not implied by calendar approval.

## Review entry points

- [Calendar model](../../src-tauri/src/pay_calendar.rs), [document reader](../../src-tauri/src/pay_document.rs), [source store](../../src-tauri/src/db/pay_calendar.rs), [payroll store](../../src-tauri/src/db/payroll.rs).
- [UI](../../src/PayCalendar.tsx), [shared intake queue](../../src/ImportIntake.tsx), [commands](../../src-tauri/src/pay_commands.rs).
- [Core scenarios](../../src-tauri/src/tests/pay_calendar.rs), [browser workflows](../../tests/ui/payHours.spec.ts).

Native Windows browse/drop/paste, real DOCX layouts, optional OCR language availability and a physical laptop round trip retain their own final-trial checks. Browser mocks and two temporary storage roots do not establish those checks.
