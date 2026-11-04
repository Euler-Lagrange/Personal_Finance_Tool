# Payroll calendar intake — November 4, 2026

Scope: extension section 2, schema 39, release 0.4.0. Reviewed payroll sources, explicit workweek/payday assignments, manual corrections, source-conflict review and month/year calendar views. Net forecasts, tax estimation, cash/deposit integration and managed backups follow in later sections. [Design and boundaries](../design/PAY_CALENDAR_DESIGN.md).

## Findings and behavior

- DOCX/CSV/Excel/PDF/image intake routes to payroll when added from Pay & hours. Destination is retained when a queued file outlives page navigation. Sources remain separate from transaction imports and no intake/application creates financial activity.
- Original bytes, extraction and supporting locations are retained. Full ISO dates in recognized tables produce proposals; ambiguous years and repeated column names remain manual review. DOCX embedded images, additional worksheets and unsupported layouts have explicit limitations. No general automatic interpretation of the real employer schedule is claimed.
- Synthetic three-week transition, August-style contradictory paydays, December 31 Thursday exception and cross-year workweeks retain their approved dates. Duplicate workweek assignments reject atomically. The UI shows both conflicting dates and requires explicit replacement/removal; backend checks cannot be waived by ticking confirmation.
- Repeated source files and repeated table rows do not create repeated weeks. Changed payload/stale revision/bad quote/unsupported dates reject without partial state. Lost-save-response retry retains the request ID. Prior source evidence survives manual calendar corrections.
- ZIP traversal/symlink/duplicate-name guards, expanded-size limits, DTD/custom-entity rejection, XML depth and incomplete-XML checks prevent unsafe extraction. Parsing occurs in memory; document text never executes actions. Original export refuses to overwrite different existing bytes.
- Schema-38 history replay remains valid because empty added state fields do not change its canonical serialized hash. Local restore and encrypted handoff preserve original payroll evidence, approved calendar and a preexisting $70 personal expense share. A corrupt source rejects restore without changing the working state. Sample remains isolated.
- Two initial browser failures were ambiguous test selectors (multiple status messages and a select label containing options); selectors now target the intended status/combobox. Visual captures initially caught a theme transition; reduced-motion captures showed stable colors. Checkbox alignment was then tightened within payroll forms and rechecked.

## Actual checks

- Full core suite: **355 passed, 0 failed, 3 ignored**. Six calendar cases cover real temporary SQLite/ZIP/XML/PDF/XLSX paths. After the final repeated-column safety guard, all **6 focused calendar cases** passed again.
- Full mocked browser suite: **205 passed**. Nine payroll cases now include reviewed proposal application, failed-save retention, manual exception/calendar views, intake destination binding and overlap replacement. Final layout/conflict recheck: **2 passed**.
- TypeScript, Prettier, Cargo formatting, Clippy with warnings denied and release manifest parity: passed.
- Inspected Light/Dracula calendar and period-editor captures at 1100×820. Table/calendar content remains contained; no horizontal viewport overflow. The edited form preserves accessible labels and a distinct review step.
- Production Windows app/NSIS build: exit 0; release 0.4.0. Delivered copies match the completed bundle output after lock/reparse-path checks. No user process was stopped. Normal Vite chunk-size advice remains nonblocking.

| Delivered artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| [Application](../../builds/Personal%20Finance.exe) | 27,042,816 | `D7794DCE461A3B24D22B555170E72E73AEE2CFAE4E06166FB2E3296BAC791CFB` |
| [Installer](../../builds/Personal%20Finance%20Setup.exe) | 226,651,948 | `FDDA9BA67A42D117ADB5B07A4D46CE1FE4E46260600F99FC72BD4496595920D7` |

## Explicit remaining acceptance

Real employer DOCX layouts, scanned PDFs, actual Windows clipboard/drop/file-picker behavior, a clean-PC installation and physical second-device use remain final-trial checks. The existing local OCR language requirement remains environment-dependent. Browser mocks are not native end-to-end proof. No personal documents, bank activity or OneDrive folder were used here.

Next: known/manual pay observations, empirical/manual net forecasts and retained prediction versions; then offline withholding, financial integration and managed destination backups.
