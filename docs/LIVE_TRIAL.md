# Final live-data trial

All automated development checks use synthetic records and isolated databases. This guide is for Jacob's first deliberate trial with actual exports, after the final delivery checkpoint. It is not a claim that a real issuer layout or bank balance has already been validated.

## Open the app

Use the [current combined app](../builds/Personal%20Finance.exe). **Imports** is the third finance item in the left sidebar, directly below **Transactions**. In Imports, select **Optional AI providers** below the file intake area. Choose Claude, set **API model ID** to `claude-opus-5-5` if empty, select **Save or replace key**, enter the key in the password field, enable requests and save. Settings/keys are scoped to the selected Sample or Personal workspace. Never put a key in chat or a tracked file. Begin provider validation with bundled synthetic fixtures, before real statements.

Use the current installer or executable linked in the README. Close other Personal Finance windows first. The installer is for Windows x64 and includes Microsoft's offline WebView2 runtime installer; no development server is required. The app and installer are unsigned personal preview builds. Ordinary finance workflows work offline. AI remains disabled unless configured and explicitly used.

Start in Sample workspace to inspect the controls, then switch to Personal workspace for actual records. The workspaces have separate databases and backups. Opening either one does not connect to a bank. No existing Google Sheets or Splitwise history was migrated.

## Establish one starting point

1. Choose a completed end-of-day starting date. In Accounts & categories, enter balances with that date and select the appropriate imported/manual/external tracking modes. A balance checkpoint is not income. Keep actual source documents available for comparison.
2. Confirm Capital One 360 checking and the card accounts you will import. Add the separate savings accounts and attach each goal to its account. Goal-only is the default funding policy.
3. Set monthly category limits. Reset is the default rollover policy. Shared expenses default to 70% Jacob and 30% Chelsea; personal purchases and exceptions need their intended ownership.
4. Reconcile the starting Chelsea balance once, accounting for overlap between the old bills sheet and Splitwise. Record actual repayments and later PayPal/checking reconciliation as linked events; a deposit description alone is not proof of a repayment.
5. Enter recurring bills, paycheck schedules and card closing/due-date conventions as needed. An expected bill, autopay setting, forecast or confirmed statement is not a paid transaction.

## Validate a small first import

- Begin with one short CSV/Excel export from one card. Check the selected account, sign convention, date format, posting status and actual download range. Row dates alone do not establish complete coverage.
- Compare several purchases, a card payment and any refund against the original. A card payment reduces bank cash and card debt without creating new spending. Five purchases totaling $624 plus a $624 payment must still show $624 of gross purchases.
- Review sharing and categories, then confirm a small batch. Inspect both the transaction list and account activity. Rules and verified source profiles can reduce later review after their conventions are confirmed.
- Import the same file again and an overlapping export. Confirm unchanged purchases are not added twice and legitimate identical purchases remain separate. Resolve ambiguous matches explicitly.
- Try one screenshot through Ctrl+V and one through drag-and-drop. Compare every uncertain/cropped row to the original. Screenshots and AI readings do not establish complete account coverage.
- Try a representative bill PDF. Local text templates need source comparison and approval. Scanned or changed layouts remain manual or use optional reviewed AI. Applying bill evidence should update the obligation without recording a second payment.

## Verify the monthly workflow

Check the dashboard's confirmed/provisional amounts, remaining category room, bills and Chelsea balance. On later visits, its recap shows net changes in the selected month since the previous successful read on this computer; offsetting edits can cancel in that summary. A goal-funded purchase stays in actual spending while its approved goal-only amount is excluded from monthly allowance usage. A refund reverses the original treatment; it does not invent a deposit into savings.

Before closing a real completed month, resolve blocking flags and review the remaining warnings. Compare its actual spending and annual total to your source records. Close records a final snapshot. Reopen explicitly for financial corrections; later refunds normally belong to their actual later month.

Create a local recovery point before the trial's significant changes. Recovery replaces the selected workspace, so review the chosen date and preserve later work before using it.

## Test laptop handoff last

Before relying on payroll figures, set the real rate/effective date, usual week, official PSW holidays and sick hours used outside these records. Compare a known 39-work-plus-1-sick week and an overtime week against your own records. Entering hours must leave ledger income unchanged. Native payroll clipboard/browse/drop acceptance belongs to this final trial as the remaining intake sections are delivered.

On the active computer, use Workspace & backups → Export handoff. Keep the passphrase separately. Copy only the encrypted `.pfinance.age` file, then import it on the other computer and compare records, an original document, a goal and a closed month. Local-ahead, diverged and unrelated histories require an extra replacement acknowledgement. The prior local copy remains in Recovery backups.

Use one active computer at a time and export again before returning. Keep live databases out of synchronized folders. API keys/provider settings and appearance stay device-specific. Local recovery files use Windows/device protection, not the transfer passphrase. The handoff database limit is 256 MiB and preserved handoff copies are excluded from automatic backup rotation.

## Checks that require this trial

Actual Capital One/Amex/Discover/Citi export conventions; real bill/PDF layouts; Windows WebView browse/drop/paste interaction; installer behavior on a clean PC; an actual second-device round trip; and provider access/model behavior remain external verification items. No actual credentials or financial data were used during autonomous QA. Investment holdings/performance, platform-specific Robinhood/Strike/Venmo adapters and automatic synchronization remain outside this initial release.

## Pay & hours and backup acceptance

Configure the effective $93 hourly rate, usual hours, annual sick opening use/holiday confirmation, reviewed PSW calendar and actual W-4/KY/local/deduction settings in Pay & hours. Compare a small number of known paystubs to the manual, empirical and offline withholding methods; confirm the method chosen per period and explain variances before relying on predictions. An unsupported tax year or missing YTD context must remain unavailable. Verify unpaid holidays, whole-hour sick entries, the 40-hour weekly restriction and straight-time overtime against your actual payroll policy.

Approve one expected-pay plan, take over any overlapping generic paycheck schedule and match the actual bank deposit explicitly. Check split/partial deposits, worked-versus-paid annual dates, timesheet finalization and the retained month-close explanation. Payroll facts and forecasts must not create additional income.

Before personal data, use Sample to configure a disposable backup destination and independently retain its passphrase. Verify Browse folders, automatic backup after a sample edit, a protected checkpoint, and restore into an isolated Sample workspace on the laptop. Confirm Windows Credential Manager behavior under your sign-in and recovery using only the file/passphrase on a clean profile. Then choose the intended OneDrive root for Personal, confirm the owned namespace and first verified copy, and independently check OneDrive upload/hydration/offline availability. Never restore over personal work merely to test recovery. These real-environment checks were not performed during autonomous development.
