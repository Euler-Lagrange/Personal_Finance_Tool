// User-facing help describes implemented behavior. Keep future features out of this catalog.
export const pageInfo = {
  payroll: {
    title: "Pay & hours",
    description:
      "Track work and sick time, predict take-home pay, and reconcile paydays with bank deposits.",
    help: "Use Weekly hours for work, Paychecks for calendar assignments and predictions, Pay variations for known facts, Pay & deposits for approved cash and bank matching, and Annual payroll for worked-versus-paid dates. Holidays & allowance holds the official PSW calendar. Pay settings contains rates and withholding elections. Browse, drop or paste payroll documents separately from transaction imports. Saving payroll facts or estimates never creates bank income.",
  },
  overview: {
    title: "Monthly overview",
    description:
      "See what you’ve spent, what remains in your budget, and what needs attention.",
    help: "Start here for a monthly check-in. Review your category limits, shared balance, upcoming bills, and recent entries. Budget room is your remaining spending allowance; use Cash timeline to estimate money available in checking.",
  },
  transactions: {
    title: "Transactions",
    description:
      "Find and edit recorded purchases, income, transfers, and repayments.",
    help: "This is your record of money activity. Search or filter the list, then select a description to edit it. Full amount shows the whole transaction; your share shows the part assigned to you. Card payments and transfers move money without counting the original purchase again.",
  },
  imports: {
    title: "Import & review",
    description:
      "Drop files or paste screenshots to bring account activity in for review.",
    help: "Add exports, PDFs, or transaction screenshots here. Saving a source keeps its evidence; it does not mean every row has been added to your finances. Review held rows and matches, and use verified activity to update your records. Unreadable or cropped information stays unresolved.",
  },
  rules: {
    title: "Merchant rules",
    description:
      "Reuse category and sharing choices when the same merchant appears again.",
    help: "Create a rule after you recognize a merchant you use often. It can reuse a category and personal/shared treatment on future eligible imports. Review broad or conflicting matches carefully. Changing a rule does not rewrite transactions you already recorded.",
  },
  budget: {
    title: "Monthly budget",
    description:
      "Plan this month’s category limits and see where spending is over or under.",
    help: "Set limits for the selected month, or copy defaults or a previous month. Compare your allowance usage with those limits and review any unresolved activity. Use the month controls here to choose rollover behavior and close a completed month.",
  },
  annual: {
    title: "Annual reports",
    description:
      "Compare months, review category totals, and revisit closed-month snapshots.",
    help: "Use this view to follow spending and income across the year without copying monthly totals by hand. Open months show current activity; closed months retain their saved snapshot. Review a month’s status before treating its figures as final.",
  },
  bills: {
    title: "Bills & payments",
    description:
      "Track recurring bills, spot amount changes, and match payments.",
    help: "A bill tracks what is due and when. Add a schedule, confirm the amount from an invoice, then link an existing payment or record one that actually happened. An autopay setting or an uploaded bill alone does not prove the bill was paid.",
  },
  goals: {
    title: "Savings goals",
    description:
      "Track savings balances and choose which purchases your funds cover.",
    help: "Attach a goal to a separate savings account to track money set aside for a purpose. Plan contributions and assign eligible purchases to that goal. Goal-funded spending remains in spending reports; its budget treatment determines whether it also uses the monthly category limit.",
  },
  statements: {
    title: "Card statements",
    description:
      "Record each card’s billing cycle, statement balance, and payment progress.",
    help: "Use an issued statement to confirm the card balance and due date for a billing cycle. Then reconcile the payments and credits applied to it. A statement balance is an amount owed, not a new purchase; paying it must not add spending a second time.",
  },
  cash: {
    title: "Cash plans",
    description:
      "Plan upcoming paychecks, savings transfers, and repayments before they happen.",
    help: "Create schedules for expected cash movements, then adjust individual occurrences when dates or amounts change. A plan feeds the cash forecast but does not record income or move money. Link actual activity when it happens so it replaces the corresponding expectation.",
  },
  forecast: {
    title: "Checking cash timeline",
    description:
      "Estimate checking cash after upcoming bills, card payments, and planned income.",
    help: "Choose a checking account and review its expected cash movements in date order. The estimate depends on a known balance, import coverage, and complete plans. Missing or held items can change the result; this is not a live bank balance or a guarantee that money is safe to spend.",
  },
  shared: {
    title: "Shared expenses",
    description:
      "See who paid, how costs are split, and what you and Chelsea owe each other.",
    help: "Track shared purchases and repayments in one running balance. The default split is Jacob 70% and Chelsea 30%, with overrides on individual expenses. Who paid and who owns the expense are separate. A repayment settles the balance without becoming earned income or new spending.",
  },
  setup: {
    title: "Accounts & categories",
    description:
      "Add accounts, organize categories, and set starting budget defaults.",
    help: "Set up the accounts and categories used throughout the app. Add dated balance checkpoints for cash estimates, and category defaults to copy into monthly budgets. Archive items you no longer use to keep their history. Defaults do not replace limits already saved for a month.",
  },
  settings: {
    title: "Workspace settings",
    description:
      "Choose a theme, switch workspaces, back up data, or move it to another PC.",
    help: "Sample and Personal workspaces keep separate records. Folder backups save encrypted copies to a chosen destination, with optional automatic copies while the app is open. Local recovery points preserve earlier states on this PC. Use encrypted handoff for a deliberate move to another computer; device histories do not merge automatically. Your chosen theme is saved on this PC.",
  },
} as const;

export const helpTopics = {
  payCash: {
    title: "Expected paycheck cash",
    help: "Select a saved prediction, then approve its net across checking or savings destinations. This creates one payroll expectation per period without recording income. Take over an existing generic paycheck schedule to suppress its future slots. A newer prediction, changed hours or payday needs another review; approved amounts stay fixed until you edit them.",
  },
  payDeposits: {
    title: "Payroll deposit matching",
    help: "Allocate existing ordinary income to a pay period. Several deposits may fulfill one paycheck, and a combined deposit may be split across periods up to its recorded amount. Match the employer/source and dates yourself; amount alone is not proof. Unlink before changing a matched transaction's money, date or accounts. Mark reconciliation complete when a smaller final deposit should leave no expected remainder.",
  },
  payFinalization: {
    title: "Timesheet finalization",
    help: "Review actual worked hours, sick time, unpaid days and dated rates. Usual workdays need recorded actual hours, including zero when unworked. Finalization retains a timesheet snapshot; later input changes flag it for review. It neither creates bank income nor closes the financial month.",
  },
  payAnnual: {
    title: "Worked dates and paid dates",
    help: "Recorded hours and earned gross belong to the dates worked. Known paychecks and expected pay use their payment dates; allocated bank pay uses the deposit date. These describe different stages of the same pay and must not be added together. Month close retains the payroll explanation available then, independently of later payroll edits.",
  },
  payTax: {
    title: "Withholding profiles",
    help: "Set your payroll elections and tax treatment explicitly. The offline 2026 method uses IRS payroll withholding schedules and Kentucky's formula; it estimates withholding rather than annual tax liability. Local taxes use your configured rules. Benefits can reduce different taxable wage bases, skip deduction holidays, use percentage amounts and annual caps. Saving a profile does not rewrite retained predictions.",
  },
  payYtd: {
    title: "YTD and per-paycheck inputs",
    help: "Social Security and Additional Medicare depend on wages this employer has already paid in the same calendar year. Enter taxable wages immediately before this paycheck, including expected intervening pay for a future prediction. Blank is unknown, not zero. Capped deductions and local taxes need their own YTD values. Other pay, reimbursements and noncash benefits have separate cash and tax treatment.",
  },
  payCalibration: {
    title: "Calibrated predictions",
    help: "Compare a reviewed ordinary known paycheck with the tax model using that paycheck's historical YTD context. Calibrated forecasts use a bounded median residual from at least two compatible earlier comparisons. Changed facts or profiles, target/future paychecks and different FICA threshold phases are excluded. The unadjusted tax calculation and applied correction remain visible.",
  },
  payKnown: {
    title: "Known pay and model cohorts",
    help: "Record actual paycheck values and optionally attach their original source. Blank take-home is unknown, not zero. Reviewed observations with matching paid year, hourly rate, frequency, benefits pattern and payroll regime support empirical estimates. Arithmetic conflicts and special adjustments stay visible but do not train the ordinary hourly model. These facts never create bank income.",
  },
  payPredictions: {
    title: "Predictions and hourly variations",
    help: "Manual predictions use the take-home amount and explanation you supply. Known-pay predictions interpolate compatible earlier observations; they exclude the target paycheck and any facts on or after its pay date. At least two distinct gross points are needed. Extrapolation is optional and less reliable. Save a version to retain its hours, rates, support and result. Later edits show that inputs changed without rewriting that version.",
  },
  ...pageInfo,
  payrollHours: {
    title: "Planned and recorded hours",
    help: "Planned hours estimate work you expect to do. Enter actual worked hours when known, including 0 for a confirmed day off; those actuals replace the plan in the forecast. Sick time is paid only when eligible, and other unworked time is unpaid. A week with sick time may not exceed 40 paid hours. Without sick time, overtime uses your regular rate.",
  },
  payCalendar: {
    title: "Pay periods and calendar evidence",
    help: "Assign each Monday–Sunday workweek to one paycheck and keep its actual payday, including three-week transitions and unusual weekday exceptions. Withholding frequency is the employer's payroll frequency, not the number of weeks in a check. Benefits holidays affect specified deductions, not taxes or sick eligibility. Imported tables propose dates only; review original evidence and resolve conflicts before applying. A calendar never records income.",
  },
  payrollSick: {
    title: "Annual sick allowance",
    help: "You receive 40 sick hours each January 1, with no rollover. Sick time uses whole hours and cannot fall on an official PSW holiday. Record earlier use only when it is absent from saved daily entries. Planned sick hours reserve allowance until actual hours replace them. Review warnings before relying on a paycheck estimate.",
  },
  payrollRates: {
    title: "Effective-dated rates",
    help: "Add the date a rate starts. Earlier dates keep their earlier rate; ordinary, overtime and worked holiday hours use the same applicable rate. Correcting a rate recalculates estimates but never rewrites imported bank income. Gross pay is calculated with exact decimal hours and rates, then rounded once for the week.",
  },
  budgetRoom: {
    title: "Budget room",
    help: "This compares your monthly category allowance with your share of spending and budgetable debt payments. Eligible goal-only funding is excluded from allowance usage, but remains in actual spending. This number is not your checking balance. Unresolved activity can make it provisional.",
  },
  householdBalance: {
    title: "Household balance",
    help: "The running balance combines who paid each expense, how its cost was split, and repayments already recorded. It spans all months. A positive amount owed to you means you covered more than your share; individual expenses can use a different split from 70/30.",
  },
  goalFunding: {
    title: "Funding a purchase from a goal",
    help: "Assign money from a savings goal to an existing purchase and review the supporting account activity. Goal-only funding keeps that amount out of the monthly category allowance while retaining it in total spending. A contribution or assignment is not a second purchase.",
  },
  balanceEvidence: {
    title: "Balance checkpoints",
    help: "A checkpoint records an account’s known end-of-day balance on a specific date. The app combines it with later recorded activity and coverage evidence to estimate cash. Activity totals alone cannot establish a current balance; missing imports still need review.",
  },
  categoryDefaults: {
    title: "Category defaults",
    help: "The starting categories and planned limits follow your monthly Sheets budget, including separate utilities, insurance, loans, and Needs/Wants flex categories. Edit any default here, then copy it into a month from Monthly budget. Saved monthly limits are independent. Savings contributions are transfers, and goal-funded purchases keep their spending category. Older categories are retained for history; archive any you no longer use.",
  },
  expectedCash: {
    title: "Expected cash movements",
    help: "These are scheduled expectations, not recorded transactions. Adjust one occurrence for an exception, or change its schedule for future occurrences. Link the actual transaction when it arrives so the cash timeline does not include both the plan and its completed movement.",
  },
  cardCycles: {
    title: "Card billing cycles",
    help: "Cycle settings help estimate when purchases reach a statement and when payment is due. Confirm the actual dates and amount against each issued statement. A cutoff estimate can differ from the issuer’s statement, especially around posting dates.",
  },
  cardPayments: {
    title: "Statement payments and credits",
    help: "Allocate existing card payments or credits to the statement they reduce. This tracks what remains due; it does not record another expense or send a payment to the bank. A transfer between checking and the card is the actual payment activity.",
  },
  billPayments: {
    title: "Bill payment matching",
    help: "Link a transaction already in your records when it paid this bill. Use Record payment only when the payment happened and has not been entered. Partial payments can leave an amount outstanding. Autopay describes how you expect to pay, not confirmation that it happened.",
  },
  billEvidence: {
    title: "Invoice evidence",
    help: "Attach the bill or invoice to keep the amount, due date, and charge breakdown available for review. Evidence can help confirm an obligation or changed amount. It does not itself create a purchase or mark a payment complete.",
  },
  sourceLibrary: {
    title: "Import sources",
    help: "Keep each original export or screenshot with its extracted rows and review history. Repeated or overlapping sources can match existing activity instead of adding duplicates. Resolve held items in the source’s review area before relying on complete totals.",
  },
  verifiedActivity: {
    title: "Processing verified activity",
    help: "Review extracted dates and amounts before processing a source. Matching can connect the row to existing activity; classification determines whether it is a purchase, income, transfer, payment, or another event. Uncertain rows stay held rather than silently becoming spending.",
  },
  importCoverage: {
    title: "Import coverage",
    help: "Coverage means you have confirmed a complete date range for an account. A few visible screenshot rows are not proof that the whole period is present. Coverage helps the app explain gaps in cash estimates; it does not manufacture missing transactions.",
  },
  closeMonth: {
    title: "Closing a month",
    help: "Close a month after reviewing unresolved activity and confirming its totals. Closing saves a final snapshot for annual reporting. Reopen the month explicitly if it needs correction. Closing does not pay bills, reconcile missing bank activity, or erase the underlying records.",
  },
  rollover: {
    title: "Budget rollover",
    help: "Choose how unused allowance or overspending affects the next month. Reset is the default. Review the proposed carry amounts before closing; rollover changes the next month’s allowance, not bank balances or the dates of purchases.",
  },
  recovery: {
    title: "Local recovery backups",
    help: "Recovery points keep earlier copies of this workspace on this PC. Restoring replaces its active records with the selected copy and preserves the current state first. Ordinary local copies rotate; branches preserved before handoff or folder-backup restore are kept separately. Use Folder backups for encrypted copies to a chosen destination.",
  },
  managedBackups: {
    title: "Encrypted folder backups",
    help: "Choose an existing folder, including OneDrive, and retain a recovery passphrase independently. Remembering it in Windows Credential Manager allows automatic copies while this app is open. The app verifies each complete archive and rotates only this device’s cataloged copies. Protect checkpoints to keep them. Cloud sync is not verified. Restore any intact file with the passphrase after previewing replacement; the current local branch is preserved. This is backup, not automatic two-computer merging.",
  },
  handoff: {
    title: "Encrypted laptop handoff",
    help: "Export a complete workspace to a passphrase-protected file, then review and import it on the other computer. Keep the passphrase available for recovery. Work on one computer at a time: this replaces a workspace after review rather than merging two devices. API keys and device preferences stay local.",
  },
  workspace: {
    title: "Separate workspaces",
    help: "Use Sample to explore with illustrative records and Personal for your own finances. Switching workspaces does not copy or combine their accounts, transactions, or backups. Check the active workspace before importing or restoring data.",
  },
  appearance: {
    title: "Appearance",
    help: "Choose the colors and visual style you find easiest to read. The theme changes immediately and is remembered on this PC. All themes use the same financial records and controls; changing appearance does not change your data.",
  },
  chargeLines: {
    title: "Charge lines",
    help: "Split one purchase or bill into components with different categories or sharing rules. The lines must add up to the full amount. They describe parts of one transaction, so adding lines must not create extra spending.",
  },
  optionalAi: {
    title: "Optional AI assistance",
    help: "Use this when local extraction needs help with a difficult source. Review the exact material and provider before sending a request. Suggestions still need review before they change records. Ordinary manual entry and local imports do not require a provider connection.",
  },
  spendingTrends: {
    title: "Spending trends",
    help: "Compare categories and merchants to see where your recorded spending changed. These reports depend on the activity and classifications you have entered. Drill into the transactions behind a total before interpreting an unusual month.",
  },
} as const;

export type HelpTopic = keyof typeof helpTopics;
