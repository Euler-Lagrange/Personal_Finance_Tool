# PDF bill and statement templates - November 3, 2026

## Scope

Schema 28 adds bounded local text-layer extraction, explicit sample mapping and approval, immutable template versions, page/line evidence, optional component sums, and reviewed application to an existing bill or configured card statement. Original PDFs can be exported unchanged. Application records one evidence association and updates the selected obligation; it creates no expense, payment, transfer or checkpoint.

This is the bill/statement dependency checkpoint. Automatic template/target recognition, PDF transaction-table mappings and reviewed AI assistance remain subsequent work. Scanned, encrypted and unsupported PDFs remain evidence with manual handling. Native folder opening and actual issuer layouts are not verified.

## Findings and regressions

- Reproduced: abbreviated minimum-payment labels such as `Min due` could be mapped as the statement/bill total. Reject both minimum and min tokens, including punctuation and case variants.
- Reproduced: recovery accepted an applied document after its operation receipt had been deleted. Restore now requires that receipt, validates its identifier/hash, and checks the saved extraction against original bytes and the approved template. Saved statement calculation evidence uses the common statement-history validator.
- Inspection fixes: StrictMode effect cleanup could suppress a later sample preview; reset the active guard on setup. Template enable/pause could leave its write control busy after a successful refresh; reset after refresh. Template/application props were corrected after TypeScript reported missing unused parent callbacks.
- Real SQLite tests cover exact cents, selected date ordering, next-line values, signed card credits, malformed/blank/oversized text, duplicate/missing labels, wrong identity/currency, layout drift and inconsistent arithmetic. Existing paid bill amounts and reviewed card obligations reject conflicting PDFs. A later linked bill payment invalidates an earlier preview; a fresh application preserves the paid amount and correct remainder.
- Injected receipt-write failure rolls back the entire bill update, source revision and evidence application. Retrying one completed operation is idempotent; a second observation of the same evidence cannot apply it again. New template versions preserve history, and reviewed samples cannot silently be re-extracted/remapped.
- Schema-27 upgrade retains spending and legacy evidence; local extraction can be requested afterward. Restart, valid restore, workspace isolation, forged cached text/values/calculations and missing receipts are covered. PDF-confirmed statements integrate with actual card-payment allocations without counting spending again.

## Verification

- Final full core suite: **276 passed, 1 explicitly ignored Windows OCR test**. The 13 PDF cases pass, including migration/recovery and cross-feature accounting. The ignored test requires an installed Windows OCR language and is not counted as a new pass.
- Final full mocked browser suite: **151 passed**, including seven PDF review cases, existing imports, accounting workflows and themes.
- TypeScript, Rustfmt, Prettier and Clippy with warnings denied pass. The production Windows build passes. Cargo emitted an environmental hard-link fallback notice; Vite retains a nonblocking 565.57 kB / 157.73 kB gzip chunk advisory for later packaging work.

Synthetic fixtures `src-tauri/fixtures/pdf/{bill,statement,drift}.pdf` were rendered and visually inspected. Final compact PDF application images `.qa/pdf-review-light.png` and `.qa/pdf-review-dark.png` were inspected; dialogs scroll within the window. Browser commands are mocked; core tests use isolated real SQLite databases. No personal financial database, real export or provider credential was used.

## Delivery and limits

Verified artifact: `builds/Personal Finance Preview - PDF Templates.exe`, **20,631,040 bytes**. Release and delivered copy share SHA-256 **8A7973D6F775F2F3470541DC676EAABA9260FA1A71EAD2CF475085022B610505**. Older artifacts remain available; use this build or newer after schema 28.

Limits: 10 MB/file, 100 pages, 1 MB extracted text, bounded decompression and fixed declarative fields. Template recognition requires the chosen exact identity and explicit USD lines; unsupported currency/amount/date layouts require another mapping or manual entry. Text evidence is visible in the app, and original PDF bytes can be exported; there is no in-app PDF canvas renderer. No issuer-wide compatibility claim is made. Native WebView/Explorer/clipboard/drop, real issuer/provider and second-device checks remain explicitly unverified where previously noted.

Next: bounded PDF transaction-table mapping and recognition/reuse, followed by optional Claude/OpenAI hooks, encrypted laptop handoff/packaging and the final synthetic lifecycle. The approved initial scope is unfinished. Live-data testing remains Jacob's final trial.
