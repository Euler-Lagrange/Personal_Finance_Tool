# Initial GitHub push plan

Status: prepared November 4, 2026. Jacob confirmed the repository must be **private** and must contain **no real financial data**. Codex was mid-edit on the Pay & hours section when this plan was written. The remote is wired; the first commit and push wait until Codex pauses.

**Decision, November 4:** Jacob chose *verbatim files only*. Tier 1 is excluded from git; Tier 2 and Tier 3 stay as they are, with the private repository as the control. Step 2 below was applied the same day while Codex was running tests, since it changes only `.gitignore` and the index.

## Setup already in place

- GitHub CLI 2.103.3 is installed at `C:\Program Files\GitHub CLI\gh.exe` and signed in as **Euler-Lagrange** with `repo` scope. A terminal opened before the install needs to be reopened to see `gh`.
- `origin` points at `https://github.com/Euler-Lagrange/Personal_Finance_Tool.git`. Git Credential Manager is the credential helper, and `gh auth login` also configured git to use the GitHub token.
- The repository itself is created by Jacob with the command in step 1, because an agent session is not allowed to create repositories on his account.
- Working tree at planning time: 350 staged new files, 8 staged files with further unstaged Codex edits, 7 untracked Codex payroll files. No commits exist yet.

## Audit of the staged tree

The audit searched every staged file for dollar amounts, income and rent wording, secrets, absolute user paths and known real identifiers, and viewed every staged image. Figures are described, not repeated, so this plan can be committed.

### Tier 1: verbatim real records. Never commit.

| Path | Why |
| --- | --- |
| `docs/reference/screenshots/` (nine PNGs and `manifest.json`) | Unredacted captures of the original Google Sheets, the Splitwise household group, the hourly-variation sheet and the employer payroll schedule. They show both household members' incomes, rent, bills, merchants, amounts and the apartment. |
| `docs/reviews/` (six files) | The two `.txt` reviews quote the October paycheck deposits with hours, real merchant rows, the rent split and the savings-account names. `CLAUDE_REVIEW_2026-11-02.md` and `CLAUDE_REVIEW_CURRENT.md` embed the same review verbatim. The brief and README carry no amounts but belong to the same packet. |

Both folders stay on disk for local reference and for `npm run docs:refresh`; they are simply untracked.

### Tier 2: design and QA prose that quotes real figures

These files are needed by the project and by Codex, so the choice is redact or accept, not exclude.

| Path | Real figures present |
| --- | --- |
| `docs/reference/SCREENSHOTS.md` | Rent group amount with both 70/30 shares; two Splitwise purchase amounts with their shares; hourly rate. |
| `docs/design/PAY_HOURS_BACKUP_PLAN.md` | Hourly rate and weekly gross examples derived from it; sick-time policy; employer transition and payday dates; employer holiday references. |
| `docs/REQUIREMENTS.md` | Hourly rate; rent group amount and shares; the two Splitwise amounts; employer holiday reference. |
| `docs/design/SHEETS_CATEGORY_DEFAULTS.md` | The household's actual monthly planned limit for each of 26 categories and the Needs/Wants totals, copied from the budget screenshot at Jacob's request. |
| `docs/IMPLEMENTATION_STATUS.md`, `docs/qa/QA_2026-11-04_sheet_categories.md` | The preset's Needs/Wants totals. |
| `docs/qa/QA_2026-11-04_payroll_plan_ui.md` | Hourly rate. |
| `docs/qa/QA_2026-11-03_itemized_bills.md` | Rent group amount and shares. |

### Tier 3: real-derived values inside source, tests and sample data

These are product decisions already shipped in the app; the plan flags them and leaves the decision to Jacob.

- The real monthly planned limits are the built-in default category preset: `src-tauri/src/category_defaults.rs`, `src-tauri/src/tests/sheet_defaults.rs`, `tests/ui/app.spec.ts`. Two category names carry personal identifiers (a pet nickname in the gifts category, an institution in the work-expenses category).
- The real rent group amount and its 70/30 shares are the rounding regression fixture in `src-tauri/src/money.rs`, `src-tauri/src/tests/lines.rs` and `src-tauri/src/db.rs`.
- Two Splitwise purchase amounts seed the Sample workspace rows and several tests (`db.rs`, `money.rs`, `tests/movements.rs`, `tests/payment_codes.rs`, `tests/shared_reports.rs`, `tests/ui/app.spec.ts`).
- The hourly rate does not appear in staged code. Codex's untracked payroll files must be re-checked before the first commit.
- Context identifiers, not amounts: the bank name in 31 files, the employer abbreviation in 6 docs, two merchant names in a few docs, and Chelsea's first name in 96 files. A private repository is the control for these.

### Confirmed clean

- `docs/qa/images/*.png` show the Sample workspace with illustrative data only.
- `src-tauri/src/fixtures/` and `src-tauri/fixtures/pdf/` are labelled synthetic; the OCR image reads "Synthetic account".
- No API keys, tokens, `.env` files or local user-profile paths are staged. `*.db`, `/data/`, `/backups/`, `/imports/`, `/exports/`, `*.exe` and `/builds/` are already ignored.

## Steps to execute once Codex pauses

Run these in order from `C:\Personal_Finance_Tool`. Do not start while Codex is editing; a half-written file would land in the first commit.

1. **Create the private repository** (Jacob, once):

   ```powershell
   gh repo create Personal_Finance_Tool --private --description "Local-first Windows personal finance app (Tauri + React + Rust)"
   ```

   Then confirm `gh repo view Euler-Lagrange/Personal_Finance_Tool --json visibility` reports `PRIVATE`.

2. **Exclude Tier 1.** *Done November 4.* Appended to `.gitignore`:

   ```gitignore
   # Real financial reference material (local only, never committed)
   /docs/reference/screenshots/
   /docs/reviews/
   ```

   Then untracked without deleting from disk:

   ```powershell
   git rm -r --cached docs/reference/screenshots docs/reviews
   ```

   Verified: `git ls-files` on both folders is empty, both folders remain on disk, and `git check-ignore` matches the new rules.

3. **Handle Tier 2 and Tier 3 per Jacob's decision.** *Decided: Accept.* The options were, from least to most change:
   - *Accept:* private repository only. No edits.
   - *Redact prose:* replace the hourly rate, rent amounts and Splitwise amounts in the Tier 2 docs with placeholder values or descriptive wording; keep the category preset.
   - *Scrub fixtures too:* additionally change the rent and Splitwise fixture amounts in the Tier 3 tests and sample seed to synthetic values, and replace the two personal category names. This touches files Codex is likely to be working in, so schedule it as its own section with the normal QA pass.

4. **Stage Codex's finished work and run the guard.**

   ```powershell
   git add -A
   git ls-files docs/reference/screenshots docs/reviews
   git diff --cached --name-only | Select-String -Pattern '\.(db|sqlite|age|exe|msi|key|pem)$'
   git diff --cached --name-only | Select-String -Pattern '^(data|backups|imports|exports|builds)/'
   ```

   All three listings must be empty. Re-run the dollar-amount scan on Codex's payroll files with `git grep --cached -n -E '\$[0-9]' -- src-tauri/src/payroll.rs src-tauri/src/db/payroll.rs src-tauri/src/tests/payroll.rs src/PayHours.tsx` and confirm every figure is synthetic.

5. **First commit and push.**

   ```powershell
   git commit -m "Initial commit: Personal Finance Tool v0.2.0"
   git push -u origin main
   ```

6. **Verify on GitHub.**

   ```powershell
   gh repo view Euler-Lagrange/Personal_Finance_Tool --json visibility,defaultBranchRef
   gh api repos/Euler-Lagrange/Personal_Finance_Tool/contents/docs --jq '.[].name'
   gh api repos/Euler-Lagrange/Personal_Finance_Tool/contents/docs/reference --jq '.[].name'
   ```

   `docs` must not list `reviews`, and `docs/reference` must list only `SCREENSHOTS.md`.

## Pre-push scan, November 4

Run after Codex finished the Pay & hours, withholding, calendar and managed-backup sections (390 staged files). Guard listings were empty: no tracked files under the two excluded folders, no database, key, handoff or executable files, nothing under local-only folders, no secrets. Findings, all accepted under the verbatim-only decision:

- The hourly rate is now the editor default in `src/PayHours.tsx`, `src/PayVariations.tsx`, the payroll tests and the user guide, and `src-tauri/src/payroll.rs` seeds the employer name. These join the Tier 3 list.
- `docs/reference/SCREENSHOTS.md` now records the two employer payroll Word documents with their full local OneDrive paths and hashes, which expose the Windows username and the employer's full name. Identifier, not an amount.
- Amounts in `tests/ui/payHours.spec.ts`, `src-tauri/src/tests/pay_tax.rs` and the pay QA reports are synthetic worked examples.

## Known consequences

- On GitHub, image links in `docs/reference/SCREENSHOTS.md` and the links in `docs/reviews/README.md` will be broken, and the README's links into `builds/` already are. That is expected; the files are local-only.
- `npm run docs:refresh` and `npm run docs:check` keep working locally because the packet stays on disk.
- GitHub secret-scanning push protection is not available on a private personal repository without Advanced Security, so the guard in step 4 is the control.
