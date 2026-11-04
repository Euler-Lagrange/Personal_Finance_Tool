# Personal Finance Tool Requirements

Requirements reconciled November 4, 2026 with Jacob's confirmed answers, later UI/import/QA requests and the schema-35 implementation. These remain the product contract, including goals that are broader than current automation. Use [requirements traceability](REQUIREMENTS_TRACEABILITY.md) for code/test evidence and limitations, [design decisions](DESIGN_DECISIONS.md) for rationale, and [implementation status](IMPLEMENTATION_STATUS.md) for delivery history. The [follow-up response](FOLLOWUP_REVIEW_RESPONSE.md) and [first review response](REVIEW_RESPONSE.md) retain the reasoning behind earlier revisions.

Build a beautiful Windows desktop app that reduces manual entry, helps Jacob stay within monthly budgets, tracks bills, and replaces his household use of Splitwise. Ordinary financial work must remain available offline.

## November 4 extension: pay, hours and destination backups

Later UI request: add unobtrusive circled information icons to every page and more complex sections, with explanations of purpose and use. Improve short page descriptions. Implemented help must work with hover, keyboard focus and click, preserve drafts and financial state, and remain readable across all themes. See [context help design](design/CONTEXT_HELP_DESIGN.md).

The [implementation proposal](design/PAY_HOURS_BACKUP_PLAN.md) records source review, design, rollout and acceptance gates. Payroll/calendar/tax calculation and automatic OneDrive-destination backups are planned, not existing delivered capabilities. The dashboard spacing correction is the implemented part of this checkpoint.

- Track actual/planned hours, explicit workweeks per paycheck and annually uploaded official PSW holidays; preserve source conflicts and reviewed exceptions.
- W-2 employee with payroll withholding. Current gross rate $93/hour, editable with effective dates; straight-time overtime. No employer PTO. Five paid eight-hour sick days (40-hour allowance resetting each January 1), whole-hour increments, prohibited on PSW holidays or when worked plus sick hours would exceed 40 in a week. Actual work without sick time can exceed 40. Holidays may be worked at the normal rate. Holidays and all other non-sick unworked time are unpaid.
- Distinguish known and predicted pay. Support tax-based, known-paycheck and calibrated estimates, manual overrides, and a method per pay period. Use W-2 Kentucky/federal withholding rules, paystub deductions and YTD inputs. Forecasts must not duplicate income.
- Choose a backup folder once; manage owned snapshots under it while retaining a local live database. OneDrive upload is separate from local backup success; laptop recovery remains explicit and validated.
- Consistent, subtle card separation and uncluttered dashboard flow; retain existing themes and professional wording. A later November 4 request adds two mid-tone grey choices, one serious and one fun/cutesy, bringing the catalog to fourteen.

## Confirmed requirements

| Area | Requirement |
| --- | --- |
| User and devices | Jacob handles all expenses, primarily on his desktop, with occasional laptop use. Roughly weekly or less frequent sessions. |
| Platform | Windows only; offline viewing, entry, calculations, rules, and supported local imports. |
| Checking | Capital One 360 receives paychecks and pays rent, loans, and credit cards. |
| Credit cards | Capital One, American Express, Discover, and Citi. Jacob pays every card's full statement balance. |
| Savings | Named funds are separate accounts. Goal-funded purchases default to using the goal's budget only; total spending still includes them. Include balances, targets, contributions, withdrawals, and paycheck planning. |
| Other import preferences | File imports for Robinhood, Strike, and Venmo would be useful; add them after primary bank/card adapters. Investment holdings and performance remain excluded. |
| Repayment route | Chelsea repays through PayPal into Capital One 360 checking. |
| Live data protection | Rely on Windows sign-in and configured device protection; no separate app launch passphrase. |
| Financial scope | Personal expenses, income, bills, debt payments, savings, and forecasts. Investment holdings and performance are excluded. |
| Monthly budgets | Editable limits and actual expenses. Configurable rollover, default reset. |
| Annual reporting | Running monthly and annual totals with an explicit Close month action. |
| Shared expenses | Jacob and Chelsea only, managed by Jacob. Default 70 percent Jacob and 30 percent Chelsea, with every split overridable. Finances may become joint later. |
| Imports | Bills, PDF/CSV/Excel exports, and account-transaction screenshots pasted with Ctrl+V or supplied as image files. Automatically accept straightforward validated items; review flagged items. |
| Manual control | Add and edit records, categories, splits, bills, and limits. Saved rules must preserve deliberate corrections. |
| AI | Optional selectable Claude or OpenAI; prefer local processing. Jacob reports $100 plans with both providers. |
| Starting point | Fresh months without historical Google Sheets migration. Existing balances can be entered at cutover. |
| Home screen | Dashboard first, with detailed spending, habits, bills, and bill-change views. |

The six [original screenshots and interpretation](reference/SCREENSHOTS.md) are preserved in the repository. They describe the existing workflow, not a requirement to reproduce spreadsheet layouts or every accounting convention. Later explicit answers supersede ambiguous formulas, colors and amounts. No go-live date, move date, employer, business account, or checking bank other than Capital One 360 is established by this conversation.

## Delivery scope and status

The original milestones below explain the sequence; the first usable and complete initial feature sections are now implemented with the documented limits and external acceptance gaps. This is not certification of full real-data workflow parity. The requirement to reduce review effort remains relevant where screenshots and assisted rows currently need individual review.

| Milestone | Usable result |
| --- | --- |
| First usable build | Attractive desktop shell; accounts and opening balances; manual and Chelsea-paid entry; sharing/settlements; posted CSV/Excel imports and clipboard/image transaction imports for supported layouts; rules/review; monthly budgets; recurring bills and bill groups; annual totals; month close; local recovery backups. PDFs attach as evidence. |
| Complete initial release | Account-backed savings goals; paycheck schedules and forecasts; encrypted laptop transfer; supported PDF extraction and reviewed assistance for difficult documents; selectable Claude/OpenAI adapters. |
| Follow-on imports and optional additions | Activity imports for Robinhood, Strike, Venmo, and optionally PayPal; broader offline OCR, pending-to-posted reconciliation, automatic synchronization, and advanced trends. |

Visual design, keyboard usability and recovery began in the first milestone. PDF/AI, savings, forecasting and laptop implementation subsequently followed. See [the review guide's gaps](CODE_REVIEW_GUIDE.md#explicit-limits-and-review-findings), particularly G01–G04 and G07, before claiming complete acceptance.

## Baseline defaults

- November 4 category setup request: use the current monthly screenshot's 25 Needs/Wants categories plus Uncategorized, with visible planned limits and recognizable icons. Keep personal/shared choice independent. Preserve existing customization and saved history during upgrades; see the [preset and migration design](design/SHEETS_CATEGORY_DEFAULTS.md). Visible limits total $5,832; the screenshot's rounded line items differ by $1 from its Needs subtotal. Savings/income/refund/rollover rows keep their dedicated accounting treatment rather than becoming expense categories.

- USD initially, using integer cents and retaining currency fields to detect incompatible imports.
- Personal budgets count Jacob's allocated share; account matching retains full payments. Household totals are separately available.
- Fixed dollar category limits with Needs, Wants, and Savings summaries. Income changes do not silently resize limits.
- One rollover setting per category: reset, or carry the signed remainder including overspending. Default reset. Savings, account, unpaid-bill, and household balances always persist.
- Purchase date determines spending month; posted date supports reconciliation. Refunds normally reduce the original category in the month received.
- Imported expenses default to personal unless a saved rule specifies ownership or asks for a decision. Category and sharing are independent fields.
- Goal-funded amounts default to using the goal's budget only. Each goal can instead count them against the monthly category allowance; record the policy used on each purchase.
- AI initially off; configured permissions determine which documents and tasks may use a selected provider.
- One active working copy and deliberate encrypted backup/restore for occasional computer switching.

## Main views and weekly workflow

| View | Purpose |
| --- | --- |
| Dashboard | Budget remaining, bills, overspent categories, household balance, goals, review count, and data freshness. Forecast availability is explicit. |
| Transactions and review | Editable searchable records, full amounts and personal shares, account/dates, categories, ownership, evidence, and review reasons. Group by merchant; support keyboard and bulk edits. |
| Budget and month | Limits, actual spending, goal-funded exclusions, provisional amounts awaiting splits, unresolved data, commitments, rollover, and close/reopen. |
| Bills | Schedules, expected/actual amounts, due dates, charge groups, matching, paid status, and changes. |
| Shared expenses | Full cost, payer, shares, net household balance, bills/everyday breakdown, settlements, and an exportable statement. |
| Savings | Each goal attached to its separate account, target, balance, contribution/withdrawal history, and planned transfers. |
| Annual and trends | Finalized/provisional monthly totals, year to date results, defined averages, category/merchant trends, and bill changes. |
| Imports and settings | Uploads, receipts/history/undo, accounts, rules, categories, providers, and backups. |

Use calm colors, clear typography, aligned currency, accessible status labels, restrained charts, and efficient tables. Provide fourteen selectable modern themes: Light, Dark, Slate, Neon, Synthwave, Robotic Terminal, Catppuccin Mocha, Catppuccin Latte, Gruvbox, Tokyo Night, Dracula, Marshmallow, Pewter and Pebble. Marshmallow is a cutesy light option; Pewter is a serious cool-grey midpoint, and Pebble is a softer grey midpoint with dusty pastels and rounded edges. The two grey themes should avoid bright white and deep dark main surfaces. Apply themes consistently to navigation, reports, forms, dialogs and status messages; preserve readable contrast and save the selection locally. Keep expressive accents restrained. Show the next action rather than fill the dashboard with summaries.

Jacob's November 2 preview feedback: use recognizable icons for common categories such as groceries, electricity, and housing. Keep the overall layout, but use professional, direct headings and helper text. Avoid motivational slogans and lifestyle-oriented notes; use factual status information instead.

A normal session imports exports, reviews exceptions and shared purchases, adds Chelsea-paid expenses, checks bills/budgets, and records settlements. Show changes since the last visit. Import receipts report each row's disposition and a separate count of outstanding flags.

## Shared expenses and money allocation

One purchase has distinct effects: full account payment, each person's spending, and who owes whom. Store those effects without creating duplicate purchases.

A $126.69 shared purchase paid by Jacob gives him $88.68 of spending and a $38.01 receivable from Chelsea; match the full amount to his card. A $48 shared purchase paid by Chelsea gives Jacob $33.60 of spending and an amount owed to her, with no movement in his accounts.

Provide a prominent Chelsea paid quick-add: amount, merchant, date, category, and split preset. No Chelsea account import, login, or phone workflow is required.

Support percentage, equal, exact-dollar, and all-one-person allocations, plus multiple categories within one purchase. Compute a percentage share once and assign the remainder to the other person. For a uniformly split bill group, allocate the group's shares first, then distribute cents across its lines consistently. Honor explicit per-line overrides and preserve historical splits.

Use one net household balance with bills/everyday breakdowns and optional tagged settlements. Do not blindly add the existing bills-sheet and Splitwise balances; reconcile overlap when entering the opening balance. Settlements reduce amounts owed without creating income or spending.

Support the confirmed PayPal-to-checking route. A received settlement entered manually and its later checking deposit are two pieces of evidence for one repayment, not two settlements. Permit one deposit to reconcile several receipts, or a receipt to be reconciled in parts. PayPal in a description alone is not proof of a Chelsea repayment. An expected repayment does not settle the balance until marked received.

Refunds link to the original purchase and stored shares. Partial refunds cannot reverse more than the original allocations; a refund after settlement can create an amount owed in the opposite direction. Settling does not lock expenses.

## Spending, savings, and account activity

Transaction type and category are distinct. Expenses, income, rewards/credits, refunds, transfers, card payments, settlements, and debt payments cannot be classified solely by category labels. A bill is an obligation with payments, not automatically another expense.

Separate account type, ownership, and tracking mode:

| Tracking mode or endpoint | Behavior |
| --- | --- |
| Imported account | A bank, card, or wallet whose activity is imported. Match internal transfers across both sides when both are in scope. |
| Manual-balance account | An owned account with a typed balance and as-of date. Show later known changes as estimates until reconciled; no holdings or performance tracking is required. |
| External endpoint | An untracked owned destination or an outside party. No running balance. Ownership and event purpose determine whether movement is a transfer, payment, income, or settlement. |

A transfer to a configured manual-balance or untracked owned endpoint can be complete with one imported side. Do not leave it pending forever waiting for a feed the user has not chosen. Conversely, money paid to an external merchant is still spending; External does not automatically mean Transfer. Transfers between two imported accounts retain matching/coverage checks.

Primary imports cover Capital One 360 checking, the named cards, and savings accounts. Add activity import adapters for Robinhood, Strike, and Venmo as follow-on work, without securities positions or performance analysis. Manual-balance/external modes remain available until a suitable export is configured. PayPal receipt matching works from checking activity and manual settlement records; a PayPal adapter is optional.

Checking debits and card-side payment credits link as transfers. A card-side payment alone is not income or a refund. Rewards/redemptions use an explicit reward/credit type: verified rewards default to Bonus/Cashback reporting and are labeled noncash when applied to a card. They do not create a checking deposit. An adjustment explicitly linked to a purchase reduces that category instead of also counting as rewards income. Unexplained credits require review.

Show consumption spending, debt payments, planned savings, and cash flow separately. A full loan payment can consume its monthly allowance without labeling principal repayment as a retail purchase. Detailed principal/interest accounting can follow later.

Savings goals attach to the user's separate accounts. No virtual earmark ledger is needed initially. Savings transfers are planned outflows and contributions, not consumption. Distinguish contributions, withdrawals, transfers between goals, and interest.

At setup, each goal has a policy: Use goal budget only (Jacob's default), or Also count against monthly category limit. A funded purchase always appears in full spending history and annual actual-spending reports. Show goal-funded exclusions separately when calculating monthly allowance usage.

Apply exclusions only to the amount of Jacob's personal share explicitly funded by a goal configured as goal-only. A $300 personal gift funded $200 by such a goal remains $300 of spending and uses $100 of monthly allowance. Multiple goals, shared purchases, and split categories must conserve amounts and never exclude more than Jacob's share. Goal balance and funding evidence must support the assignment; flag insufficient or unknown funding rather than claiming money is available.

Snapshot the funding and policy on the purchase so later goal-setting changes do not silently rewrite budgets. Link any preceding withdrawal and the purchase to prevent double counting. Refunds reverse the original spending and allowance effects proportionately; cash actually returned to a savings account is a separate movement, not an invented goal deposit.

## Imports and incomplete data

Prioritize Capital One 360 checking and the four named card issuers; configure separate savings institutions during setup. Support reusable CSV/Excel mappings and evaluate stable IDs in OFX/QFX without replacing the requested formats.

The first usable build imports posted activity. Identify pending rows, report their exclusion, and require later imports for posted activity. Establish source sign/date/status conventions before applying type defaults.

| Account and row | Initial classification after source validation |
| --- | --- |
| Card purchase/ordinary charge | Expense immediately; Uncategorized if no category rule. A first import needs no merchant rules to count these charges. |
| Card debit with an explicit cash-advance, balance-transfer, correction, or other non-purchase code | Apply the verified source type or ask if ambiguous; do not force it into purchase spending. Verified fees/interest are expenses. |
| Card credit identified by a supported payment code/descriptor or a checking-payment match | Card payment/transfer, even when only one side has been imported. |
| Card credit identified as a reward redemption or statement reward | Reward/credit under Bonus/Cashback, unless explicitly linked to a purchase adjustment. No assumed bank-cash receipt. |
| Other card credit | Ask for refund/purchase link, reward/credit, or another supported adjustment. Do not assume income, payment, or refund solely from the sign. |
| Checking/savings debit or credit | Use validated source types and saved transfer/bill/paycheck/settlement rules; otherwise classification pending. Review similar rows in bulk and optionally remember the decision. |

Specific verified types, confirmed links, and manual overrides outrank account/direction defaults. Payment descriptors must be issuer-specific enough to avoid treating merchant names containing Payment as card repayments.

| Uncertainty | Treatment |
| --- | --- |
| Verified expense; category unknown | Commit as Uncategorized and include in actual spending. Keep a categorization flag. |
| Ownership explicitly Ask on a positive verified expense | Count the gross amount provisionally toward allowance and label Includes $X awaiting split. Keep confirmed shares and household balances separate. |
| Refund/credit with unknown ownership or purchase link | Do not use a gross negative amount to grant provisional budget room. Record verified account activity and wait for an allocation/link before reducing personal spending. |
| Verified account/date/amount; type unknown | Record account activity once with classification pending. Expose it separately from confirmed spending/income. |
| Unreliable amount/date/account/currency or duplicate identity | Hold the candidate and show counts/known amounts beside incomplete totals; never invent a value or count a suspected duplicate twice. |
| AI-extracted values | Require source-backed review before commitment. Approved templates/mappings can drive later validated local imports. |

Gross positive expenses are an upper bound on Jacob's eventual share, not proof of a final allocation. Resolve them out of the provisional amount when the split is known. Unknown amounts, identity, or transaction type still prevent reassuring complete/on-budget indicators.

Preserve files, raw descriptions, rows/pages, normalized values, parser/mapping identity, and available source totals/counts. Every row has a disposition. Documents are data, not instructions; no workbook macros are executed.

Warn on dates far outside the selected period or source coverage, including unexpected years. Confirm or correct explicitly.

When source coverage is absent, show a one-time range confirmation for that file/account: actual download start/end, filter date basis, and full-range versus incremental export. Prefill from source metadata or the saved download pattern; earliest/latest row dates are only hints. They cannot prove full coverage or identify transaction-free boundary days. Save the confirmed range/profile so routine last-90-days downloads need a quick confirmation, not row-by-row classification.

Show last import time, newest activity date, and confirmed coverage end as distinct facts. Never promote a hint into confirmed coverage without source evidence or the user's confirmation.

## Import intake and usability

Jacob confirmed on November 3 that drag-and-drop must work alongside screenshot paste and file selection, with ease of use as a priority.

- Offer three equivalent entry points: **drag and drop**, **Ctrl+V / Paste screenshot**, and **Choose files**. Accept one or multiple supported images, PDFs, CSVs, or Excel files into the same import queue.
- Dropping files from Windows File Explorer onto the main app window shows a clear drop target and opens the import queue. Preserve unsaved form edits: queue the files or defer opening the queue instead of replacing the form.
- Show image thumbnails or filenames, per-file progress, and clear outcomes such as Imported, Needs review, Already added, Attached only, or Could not read. Accepting a file must never imply its transactions have been imported.
- Let Jacob remove queued items, cancel work, or retry failed extraction. One unreadable/unsupported file must not discard the other files or replay already committed transactions.
- Reuse the selected account and known source layout where appropriate, with visible overrides and confirmation for ambiguous/mixed accounts. Do not require repeated account/category entry for every image or row.
- Use the same duplicate checks across paste, drop, and browse, including repeated drops and the same evidence added through another method. Keep ordinary text paste and editing behavior intact.

QA must cover multi-file drops, paste-then-drop repeats, mixed valid/invalid files, cancellation/retry, missing account context, unsaved edits, and keyboard file selection. Verify real Windows File Explorer drops into the packaged native app using isolated data; browser event mocks alone do not establish that native drag-and-drop works.

## Screenshot transaction imports

Jacob confirmed on November 3 that pasting account-transaction screenshots must be designed into the importer from the beginning.

- Support **Ctrl+V** and a **Paste screenshot** action in the import area, plus image files and drag-and-drop. Multiple screenshots can belong to one import batch. Read the clipboard only for an explicit paste; preserve normal text-field pasting.
- Show the source image beside extracted rows. Extract visible transaction dates, descriptions, amounts, direction, and posted/pending status where present. Use the same category/ownership rules as CSV imports.
- Select or confirm the account once per batch. Missing years, hidden signs, unreadable digits, currency ambiguity, truncated rows, and running-balance columns require resolution; do not invent values or treat the displayed balance as a transaction amount.
- Prefer local OCR and deterministic validation for supported layouts. Straightforward locally validated rows follow the normal auto-accept policy; uncertain rows are flagged. Optional Claude/OpenAI extraction uses the configured opt-in provider path and retains the existing source-backed review requirement for AI-extracted values. Offline manual correction remains available.
- Screenshots are partial evidence by default, not proof of a complete statement or date range. Do not infer coverage from the first and last visible row or use missing screenshot rows to delete records.
- Repeated pastes, overlapping screenshots, and a later CSV/PDF describing the same transactions must link evidence to existing records rather than add spending or payments twice. Similar-looking legitimate transactions must remain distinct; uncertain matches require review. Cropped/resized versions are duplicate candidates, not automatic proof of identity.
- Preserve original images and row locations with import history, under the same local protection, attachment backup/restore, and narrow-undo rules as other evidence. Text inside images is source data, never instructions.

Acceptance checks include repeated paste, overlapping captures, screenshot-then-CSV matching, legitimate same-amount twins, card-payment/refund credits, missing year, pending rows, cropped rows, unreadable signs/decimals, running balances, offline correction, cancellation, and attachment recovery. Basic screenshot intake and supported local extraction belong in the initial import work; broader layout/OCR coverage can expand later.

Implementation distinction, November 4: native image and AI-assisted rows currently require individual confirmation and cannot claim complete coverage. The desired low-review workflow above is not fully achieved for screenshots. See R19/G03 and the relevant parser/import guards; do not change the requirement to conceal this limitation.

## Matching and duplicates

Prefer account-scoped stable source IDs and exact-file fingerprints. Preserve multiplicity: two identical real purchases remain two records. Retain exclusion/match decisions so reimport cannot resurrect an intentionally excluded occurrence.

For ID-free full-range exports with a confirmed range and stable source profile:

1. Compare only like date bases and descriptions. Use account, currency, source date, signed amount, and minimally normalized raw description as the occurrence key. Merchant normalization used for category rules does not erase matching evidence.
2. For each covered date, compare with the latest accepted complete source snapshot covering that date, rather than summing counts across previous files or reading edited display values.
3. Equal counts match existing occurrences without new records. Reduced counts warn about changed/partial source data; never delete old transactions automatically.
4. Extra occurrences within previously covered stable interior dates are anomalies for review. Extra occurrences in an adapter's settling window may be added as late-appearing activity, provided source completeness is confirmed and no conflicting identity/correction evidence exists.
5. Initial settling-window proposals are the prior range's final day for posted-date filtering, or its final five calendar days for transaction-date-only filtering. These are source-profile heuristics to validate, not universal bank guarantees. Store the import observation time and boundary inclusivity.
6. Previously uncovered dates add unmatched occurrences after normal ID/file/manual-entry checks. Identical-file retries and later overlapping exports reuse stored occurrence identities.
7. Partial/incremental sources or incompatible date bases do not use complete-range count matching. Retain evidence and request targeted review instead.

The happy-path goal is that three ordinary confirmed overlapping 90-day exports add only genuinely new occurrences, preserve identical twins, and hold no unchanged rows. Legitimate extra activity outside a settling window can still be approved; the window never authorizes silently discarding it.

Late-appearing status records when an occurrence was discovered, not a replacement purchase/budget date. If it affects a closed month, use the explicit reopen/adjustment workflow.

Same amount and nearby date only suggest matches. Manual-to-import matching needs consistent merchant/payment evidence or review, not merely one same-amount candidate within four days. Confirmed matches retain manual category/sharing decisions.

Narrow initial batch undo: allow it only while every record/link in the batch's complete write set remains untouched, no later dependencies exist, and affected periods are open. Record minimal before-values to reverse earlier links as well as inserted rows. Otherwise offer explicit corrections or restoration of the pre-import snapshot, previewing all later work that restoration would discard and requiring an affirmative choice.

## Rules and tagging effort

Use local rules and bulk edits before model complexity. Category and ownership independently support Ask. Personal remains the default unless configured otherwise; offer an Ask rule for mixed-purpose merchants rather than automatically declaring their purchases shared.

Separate Apply once from Remember for next time. Match normalized merchant with optional account/description constraints, and preview matches when saving. Use a small documented specificity order; equally specific conflicting rules require review. Defer arbitrary priority editors and elaborate rule-version interfaces.

Show previous merchant choices as editable suggestions. A user may configure a sharing-dependent category suggestion, such as shared restaurant spending to Dates/Restaurants and personal dining to Solo Dining. Do not assume this for all restaurants.

Provide merchant-grouped keyboard review and multi-select. Retain a lightweight explanation of applied rules and preserve manual overrides across imports. No precise tagging-time estimate is established before testing representative data.

## Bills and document processing

Recurring obligations store expected amount, due schedule, active dates, split, and match criteria. Make billers easy to end or replace. Autopay does not prove payment. Matched activity establishes actual amounts; compare with expectations and the previous comparable bill.

Bill groups support one payment covering several charge lines and differing splits. Partial/combined payments can be linked manually initially. Uploading an invoice and its payment must not create two expenses.

Attach PDFs in the first build. The complete initial release supports local text-layer PDFs through approved per-biller/document templates: recognizable labels, expected layout, dates, amounts, and validation checks. Templates may be configured manually or proposed by AI from a sample; the user approves the mapping, and later matching documents extract offline.

Validate the biller/document identity, template version, required labels, currency, date plausibility, and arithmetic on each document. A layout change, ambiguous Amount Due versus Minimum Due, or failed check sends the fields to review. Store source page/text references. The same approach can read card statement dates and balances. Templates are declarative data, not generated executable code. Difficult PDFs/photos can use optional reviewed AI; broad offline OCR remains later work.

## Paychecks and available money

Use dated pay events, an anchor/cadence such as every 14 days, and holiday/amount overrides. A 14-day cadence is not two fixed dates per month. Exact cadence and expected net pay remain setup choices. Match expected and received deposits once; savings-transfer schedules may differ.

For each card, configure its usual closing day, due day and cycle relationship. Allow cycle-specific closing-date, due-date, and amount overrides. A recurring day is a prediction, not proof that the issuer closed on that date.

Calculate an estimated statement balance from a known opening/reconciled liability balance plus all posted balance-affecting activity through the actual or estimated cycle cutoff: purchases, fees/interest, payments, refunds, and other credits. Complete cycle activity alone cannot establish a balance if its starting balance is unknown. Keep source date basis, coverage, and cutoff assumptions visible.

With a known balance checkpoint, complete compatible activity and configured cycle dates, forecasts can show calculated upcoming statement obligations without typing four balances every month. Label them Calculated/estimated until confirmed against an issuer statement, a source containing the actual balance, or a deliberate user confirmation. Statement PDF templates can confirm or correct the result.

Do not substitute current card balance for statement balance. Allocate payments to the relevant statement(s), support partial payments, and reduce remaining due only once. A matching payment does not mark a statement fully paid unless it covers the remaining obligation. Credits after closing may affect current balance and the required payment differently; use supported issuer rules or review rather than assuming every credit fulfills the payment requirement.

Separate cash remaining until payday from discretionary budget remaining. Forecast from an as-of checking balance, full scheduled outflows, remaining statement payments, planned savings, and expected settlement payments. Avoid subtracting a card purchase again as a checking bill. PayPal receipts still awaiting a checking cash-out are not already in checking; reconcile the receipt and deposit without creating new income.

Missing balances, coverage, actual-versus-estimated cycle information, or unresolved statement adjustments produce a qualified/incomplete forecast rather than an exact safe-to-spend number. Weekly imports do not provide live-bank accuracy.

## Month close and annual reporting

Close presents a checklist for flags, coverage, unmatched bills, and optional balance reconciliation, then stores one latest-close totals snapshot and locks financial edits. Use audit records and backups instead of a browsable archive of every close version.

Uncertain monetary identity/amounts and unresolved type/sharing/funding that would change final personal totals block a final close. Resolve a provisional ownership estimate into an explicit allocation before finalizing it. Uncategorized verified spending already counts; the user may acknowledge its unresolved category and close. Record explicitly accepted coverage gaps.

Reopen explicitly and show Changed since close when live totals differ. Late imports keep their real dates. Do not silently move an October purchase into November because October is closed. Offer reopen-and-add, or an explicit adjustment with a visible budget-period override chosen by the user.

If a historical change alters rollover, preview its effect. Offer Apply this change to the current open month as the suggested one-click action, with amount/category/source period shown before confirmation. The alternative is deliberately reopening affected periods. Keep closed successors unchanged.

Link adjustments to the original remainder and prior applied corrections so reopening/reclosing again cannot apply the same delta twice. If a later recalculation revisits the chain, reconcile existing adjustments rather than also recarrying the same change. This changes allowance, not actual spending.

Annual reports derive from records and latest close snapshots. Closed months are final, open months provisional, future/missing months blank. Averages use explicitly tracked completed months including genuine zeros, excluding missing/future periods. Later refunds normally leave the original purchase month closed and unchanged.

Close snapshots keep actual spending, goal-funded exclusions, and monthly allowance usage as separate values. A goal-only purchase remains in annual spending even when excluded from its monthly allowance.

## Backups and laptop use

Automatic rotating local recovery snapshots start before real data entry. Back up before imports, destructive edits, restore, close, and migrations, and after meaningful sessions. Include attachments and verify restore, not just file creation.

The complete initial release includes encrypted portable backup/restore with workspace, device, revision, and history identity. Keep one active copy. Detect divergence through ancestry, not merely a larger counter; preserve both copies instead of choosing silently. Never operate a live database in a synchronized folder.

Jacob chose Windows sign-in and device protection for live data, without an app launch passphrase. Use per-user storage and OS-protected credentials. Do not claim BitLocker/device encryption is enabled without checking, or change Windows settings automatically. A separate live-database encryption layer is not required for the initial release.

Credentials stay device-specific and outside exports. Portable backups remain encrypted for transfer; their passphrase is separate from launching the app. Protect database, attachments, temporary extraction material, and recovery copies consistently with the chosen local Windows storage boundary.

## Acceptance examples

| Scenario | Expected result |
| --- | --- |
| Jacob pays $126.69 shared | Full account effect, $88.68 personal spending, $38.01 Chelsea owes. |
| Chelsea pays $48 shared | No Jacob account movement; $33.60 spending and owed to Chelsea. |
| Uniform 70/30 group of $1,954.79 | $1,368.35/$586.44 shares with exact line/group reconciliation. |
| First card import without merchant rules | Ordinary purchases count immediately as Uncategorized expenses; non-purchase source types are respected. |
| Verified rewards statement credit | Bonus/Cashback or explicitly linked purchase adjustment, never an assumed payment or checking deposit. |
| Three confirmed complete overlapping 90-day exports | No unchanged rows held, no repeated records, and genuine twins retain their multiplicity. |
| Extra occurrence in a supported settling window | Added once as late-appearing; real date retained; closed-period policy still applies. |
| Source count shrinks or export is incremental | Existing records are preserved; source discrepancy receives targeted review. |
| Transfer to a configured untracked owned endpoint | Complete on one imported side; no consumption expense or missing-feed close blocker. |
| Manual PayPal settlement then checking deposit | One household settlement and one bank movement, linked without new income. |
| Known starting card balance, complete imports and cycle schedule | Calculated obligations appear without monthly typed balances; estimates remain labeled. |
| A partial payment toward a statement | Remaining due decreases once; the statement stays partially paid. |
| Ambiguous same-amount manual/import rows | No merge based only on amount/date proximity. |
| Unknown expense category | Included under Uncategorized with a visible review flag. |
| Positive expense awaiting ownership | Gross amount counts provisionally; confirmed shares remain separate. Unknown refunds do not grant gross budget room. |
| Untouched batch versus later edits | Safe untouched batch undo; otherwise reviewed correction or snapshot restore with later-work preview. |
| Unknown amount or possible duplicate | Held for review with visibly incomplete totals. |
| Card payment, either side first | Transfer, never extra spending, income, or refund. |
| Shared refund after settlement | Negative original-category spending and matching household adjustment. |
| $300 gift fully funded by a goal-only goal | Spending shows $300; goal funding is consumed; monthly allowance usage is $0. |
| $300 gift funded $200 by a goal-only goal | Spending shows $300; monthly allowance usage is $100. A refund reverses the original allowance treatment. |
| Late transaction after close | Explicit historical-edit/adjustment choice; no hidden date reassignment. |
| Unexpected year in a date | Warning and explicit confirmation/correction before saving. |
| Reopen with rollover | One-click open-period adjustment preview; closed successors unchanged; repeated close/reopen cannot double the delta. |
| Saved PDF template encounters changed labels | Review fallback; never silently substitute Minimum Due for statement balance. |
| Future versus tracked empty month | Future blank; a real completed zero-spend month is included as zero. |
| Internet/provider unavailable | Offline finance work continues; online extraction remains recoverable. |
| Restore or laptop transfer | Data and attachments match; divergence preserved; secrets excluded. |

Representative exports/bills are needed to validate layouts, dates/signs, IDs, coverage, and reconciliation. Opening balances, pay schedule, statement dates, and limits are onboarding data. No production start date is committed.
