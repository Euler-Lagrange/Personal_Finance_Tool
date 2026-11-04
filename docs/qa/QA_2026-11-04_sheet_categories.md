# Sheets category setup QA — November 4, 2026

## Scope

Implement Jacob's request to start categories from his screenshots and match his monthly Sheets workflow. S5 provides 19 Needs + 6 Wants categories and planned limits; Uncategorized remains available. New workspaces receive explicit icons and editable defaults. Schema 36 upgrades existing setup conservatively, retaining custom definitions, historical records and saved monthly budgets. Overview explains its five-category summary and links to the full catalog. The copy dialog previews the default count/total and explains overlap with older broad categories.

See [design and complete preset](../design/SHEETS_CATEGORY_DEFAULTS.md), [native implementation](../../src-tauri/src/category_defaults.rs), [core cases](../../src-tauri/src/tests/sheet_defaults.rs) and [browser flow](../../tests/ui/app.spec.ts).

## Findings and corrections

- The app had ten broad starter categories, while Overview intentionally showed at most five. The precise sheet categories were missing. The new preset includes separate utilities/insurance, loans, CSU/Work Expenses, shared/solo dining, gifts, Needs/Wants flex and zero-limit placeholders; the dashboard now discloses its summary count.
- The screenshot's visible Needs lines sum to $4,520, although its displayed subtotal is $4,519. Initial test expectations copied that subtotal and failed by $1. Rechecked the source image and retained each displayed line limit; corrected expectations to $4,520 Needs + $1,312 Wants = **$5,832**. No arbitrary category adjustment or hidden spreadsheet precision was invented.
- The first new browser flow tried to use Add expense from the setup page, where that action is not exposed. Corrected navigation to Overview and reran the complete new flow successfully. This was a test-navigation defect, not a missing category action.
- Existing broad categories may overlap with new detailed categories. Only untouched factory broad defaults are retired to zero; saved month limits and customized defaults stay intact. The copy preview tells the user to review both sets before copying and clarifies that archiving preserves saved month limits.
- The prior standalone executable was locked despite the process-path scan showing no matching process. Exclusive access correctly prevented replacement. Delivered a separately named current executable; no application was stopped and the locked older file is temporarily retained.

## Checks actually performed

- Full Rust baseline: **334 passed, 2 failed, 2 ignored**. Both failures were the $1 subtotal expectation described above. After correction, all **3 new preset cases** and the existing budget-copy/archive case passed. This establishes **337 distinct passing core tests** across the baseline and focused corrections/addition, not a claim of a second full run.
- Core coverage: fresh/empty legacy setup; Needs/Wants counts and totals; no fabricated activity; month-copy/restart behavior; independent monthly budgets; custom icons/limits; archived and case-insensitively matching categories; original broad category identity; closed snapshots and locks; recovery; untouched Sample default retirement; rollback on an injected audit failure; repeated upgrade with no duplication. Existing migration/import/refund/goal/handoff suites ran in the full baseline.
- Full mocked browser baseline: **195 passed, 1 failed** (the initial new flow). Final focused run: **2 passed**, covering the complete new category journey and existing replacement/preserve-copy behavior. **196 distinct browser cases** pass in total, including the baseline's fourteen-theme checks.
- New browser flow: five-row Overview disclosure → 26-category Monthly budget → Heating Gas versus vehicle Gas limits → zero-dollar flex edit → default total preview with replacement unchecked → case-insensitive category search → edit → manual entry using CSU/Work Expenses. Inspected the synthetic full-category budget layout; all rows and amounts remain available through normal scrolling.
- `npm run check`, `npx prettier --check src tests/ui`, `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`: passed. Production TypeScript/Vite and Rust release/NSIS packaging passed. Vite's existing main-bundle size advisory remains nonblocking (640.16 kB / 177.69 kB gzip).
- Documentation packet refreshed/checked, local links checked, and staged diff whitespace reviewed before completion.

All core data came from temporary synthetic stores. Browser tests mock the native boundary; they do not prove native Windows interaction. No actual user database was opened for QA, and no real issuer/provider/live-data acceptance was performed. Native launch, installation and second-device acceptance remain the existing external checks.

## Delivery

`npm run build:installer` exited successfully before copies were made. Checked resolved project-contained paths, reparse points, running-process paths and exclusive access. Both final SHA-256 hashes match the completed generated sources.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `builds/Personal Finance - Sheets Setup.exe` | 26,541,056 | `54DC060BCE1BD6810FD94B26B69E421202EE38231C106408D8371525A29D020F` |
| `builds/Personal Finance 0.1.0 - Initial Trial Setup.exe` | 226,474,625 | `17BAE34B1E91572FA303A68E154349119232AC267F04C20895BF576812925099` |

Version 0.1.0, schema **36**. `builds/Personal Finance - UI Review.exe` remains solely because it is locked; it is superseded and is not the current launch link. No files outside the checkout were removed. Close the old app and open the Sheets Setup executable; the normal startup upgrade backs up older workspaces before applying the new category defaults. Use **Monthly budget → Copy budget limits** to adopt defaults into the selected month after reviewing overlap with any saved limits.

Payroll, tax prediction and automatic destination backups remain separate proposed work. The category task does not implement or re-scope them.
