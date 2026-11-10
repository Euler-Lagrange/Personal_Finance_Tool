# Architecture

A budget tracker, not an accounting system. The app stores one list of entries (date, full amount, category, who paid, account, each person's share in cents) and works everything else out from that list. Six screens replace three spreadsheets, a bill-splitting app and a payroll calendar document.

The core loop is two steps: paste a bank or card screenshot, then confirm one table of what was read from it.

**The rule that keeps it simple:** a feature is built only if it replaces something the owner does by hand, or the owner approved it by name. That rules out reconciling accounts, statement cycles, month close and review queues. A wrong entry is fixed by editing it.

The first build (branch `main`) modelled bank accounts and money movement. That one choice forced transfers, card payments, statement cycles, import coverage and duplicate identity, each with its own confirm step: 14 sidebar sections and more than 80 tables. This design has six screens and thirteen tables.

Personal details (names, pay rate, real bills and amounts) are deliberately absent from this repository. They are loaded from a private setup file.

## Screens

| Screen | Replaces | What is on it |
| --- | --- | --- |
| Dashboard | Summary tab | Left to spend, groups against targets, next paycheck, balance between the two people, bills due, fund balances, account balances with what is left, paste a screenshot |
| Transactions | Transactions tab and the bill-splitting app | One searchable list, paste-to-import, a quick-add row |
| Budget | Planned / Actual / Diff tables | Planned against actual per category for person A, person B or Household; Month / Year, the whole year by month, export |
| Bills & Split | Shared bills sheet and the bill-splitting app | Recurring bills with each share, running balance, Settle up, statement export |
| Pay | Payroll calendar and the hours-to-pay table | Hours calendar, paychecks, predicted against real pay, paycheck plan, hours what-if, the year by payday |
| Savings | Sinking fund rows and the renewals list | Fund balances and targets, emergency runway, renewals, per-paycheck set-aside |

Settings sits behind a gear: people, split, groups, categories, pay profile, API key, theme, backup.

## Everything is editable

Nothing is fixed in code. Transaction cells edit in place; columns can be shown and hidden. Categories can be added, renamed, reordered, moved between groups, given an icon and archived. Groups can be renamed and added, with a target percentage per person. Planned amounts are per category, per person, per month. Split presets, bill templates, renewals, funds, the account list, merchant memory, pay settings and the tax rates file are all editable. A rename applies to past months; archiving keeps history.

## How one entry works

A purchase is entered once at its full amount. The entry stores the amount, the category, who paid and each person's share in cents.

- Each person's budget uses their own share. Household uses the full amount.
- The balance moves by the other person's share.
- **Split:** a percentage for person A (presets plus custom) or a fixed amount. A's share is rounded to the cent, halves away from zero, and B gets the remainder, so shares always add up and a refund mirrors its purchase. Shares are stored, so changing the default later never rewrites history.
- **Kinds:** expense, income, settlement (money between the two people; moves the balance, touches no budget). A refund is a negative expense in the same category.
- **Paid from a fund:** lowers that sinking fund and stays out of the month's budget.
- **Merged finances:** a Settings switch. One Household budget; split controls and balance hidden. Entries keep both shares, so it needs no conversion and can be turned off.

## Screenshot import (milestone 3)

1. Ctrl+V on Transactions, or drop image files. Several at once is fine.
2. Each image goes to the Anthropic API with the category list and merchant memory. The reply is constrained to rows: date, merchant, amount, type, suggested category, suggested split.
3. One review table opens beside the screenshot. Purchases are ticked. Card payments, transfers and pending charges are unticked and labelled. A row matching an existing entry (same amount, date within three days, similar merchant) is unticked and labelled "Already in". A purchase that was split across categories matches on the sum of its pieces.
4. Fix anything in place, then **Add entries**. **Undo import** removes the batch.

Merchant memory replaces a rules screen: saving a merchant with a category and split pre-fills it next time. The default model is Claude Sonnet 5.5. The API key is stored with the OS's encrypted storage on each PC, never in the data file. The screenshot is discarded after saving. With no key or no internet, the quick-add row is the fallback.

## Checking and card check (milestones 3 to 5)

A checking screenshot also checks the app against the bank:

| Check | Result |
| --- | --- |
| Missing entries | Charges and deposits the app does not have, ready to add |
| Bills went out | A "seen in bank" tick on each bill, loan payment and savings transfer that appears; a list of any that were due and did not |
| Paycheck landed | The deposit matched to the predicted paycheck, with the real amount recorded |
| Balance and what is left | The balance shown, saved with its date |

**What is left** = checking balance, minus card balances, minus bills and savings still due before the next payday, plus or minus the balance between the two people. Card screenshots save each card's balance the same way.

A balance is a snapshot: one number and one date, read from a screenshot or typed. A newer one replaces the older. The app never calculates a running account balance.

## Bills and the balance (milestone 4)

Recurring bills are templates (name, category, due day, expected amount, payer, split) that become ordinary entries each month; amounts that vary are corrected on the entry. Each template carries its own split rule: default percentage, fixed amounts each, custom percentage, or one person. Templates can be switched off without deleting them.

The balance is one running number: what B owes on entries A paid, minus what A owes on entries B paid, minus settlements, plus an opening balance typed once. **Settle up** records a settlement. The **statement** is a PDF of the month for the second person: shared bills with their share, shared purchases, settlements, closing balance and their own budget.

## Pay calendar (milestone 5)

- **Calendar:** Monday-to-Sunday month grid. Hours per day; week totals; each pay period shaded and its payday marked. Day tags: Worked, Sick, Holiday, Off. Sick hours count as paid.
- **Schedule:** every two weeks from any Monday that began a real pay period, paid a set number of days after it ends; or on set days of the month. A payday moves to the business day before a weekend, a United States bank holiday, or a day the person tagged Holiday.
- **Paychecks** follow the schedule and are worked out each time. A paycheck is stored only once something is typed on it: the real take-home, the gross from the stub, changed dates, or the "no benefits taken out" tick. Emptying what was typed hands it back to the schedule. Stored paychecks keep their dates if the schedule later changes, and the schedule fills in around them.
- **Prediction from history:** a straight line of take-home against gross through known paychecks (a typed list, plus every paycheck whose real take-home is filled in). At least three are needed. A paycheck with no benefits taken out is kept off the line and teaches how much extra such a paycheck brings. A prediction is never below zero or above gross, and is marked as rough when the gross is well outside the known ones.
- **Usual hours:** a pay period that is not over yet is predicted at the usual hours per paycheck until more are logged.
- **Prediction from tax rules:** not built. Hours times rate minus the pay profile's deductions and withholding, from one editable rates file per tax year. It needs two real pay stubs to check against.
- **Paycheck plan:** each paycheck shows the person's share of bills dated from that payday up to the next, and what is left. Savings transfers join in milestone 6.
- **Planned income:** one button sets the month's planned paycheck income to what the paychecks landing in that month are expected to bring home.
- **The year, by payday:** hours, gross, take-home, sick hours used, and hours still needed to reach a yearly gross goal.
- **What if:** type a number of hours and see the gross, the take-home, and what one more hour adds.
- A person on a fixed paycheck has a take-home amount on their paydays and no calendar.
- A raise is a new rate with a start date. Paychecks for earlier pay periods keep the old rate.

## Savings, renewals, year view (milestone 6)

- **Funds:** a pot of savings with a name, an owner (one person or the household), an optional target and a balance. A fund is fed by one budget category: every expense in that category is money set aside into it. A purchase marked **Paid from** a fund draws the fund down and is in neither the month's budget nor the balance between the two people, because it was shared out when the money was set aside. Typing a balance trues the fund up; no entry is created.
- **Emergency runway:** funds ticked Emergency, measured in months of spending in the first group (Needs). The monthly figure is the average of up to three earlier months, or this month's plan until there is spending to go on.
- **Renewals:** things that come round every so many months (12 for yearly). Each becomes an ordinary entry on its date and its next date moves on. A renewal can be paid from a fund. The screen shows each person's yearly share and what to set aside per month and per paycheck.
- **Paycheck plan:** a renewal due before the next payday counts with the bills unless a fund pays for it. The month's planned amounts in the last group (Savings) are spread over the paychecks landing in that month and shown as Set aside.
- **Year view:** on the Budget screen, a switch between the month and the whole year. Categories by month with a total and an average over the months that have entries; hours and pay by the month of the payday; and the largest totals by description ("Where it went"). Computed live, for either person or the household.
- **Export:** a month (transactions and both budgets) or a year (transactions and a year table per view) as an Excel workbook, or the transactions as CSV. The workbook is written by a small built-in writer, with real dates and amounts.

## Approved extras

| Extra | What it does | Milestone |
| --- | --- | --- |
| Undo | Ctrl+Z reverses the last edit, delete or import | 2 (built) |
| Bulk edit | Select several rows, set category or split at once | 2 (built) |
| Split one purchase | Divide one receipt across categories; pieces stay linked | 2 (built) |
| Subscription flag | Points out a repeating charge not in the bills yet | 3 |
| Bill change flag | Marks a bill whose amount moved from last month | 4 (built) |
| Hours what-if | Type hours, see the predicted paycheck | 5 (built) |
| Export | Any month or year to Excel or CSV | 6 (built) |
| Emergency fund runway | Months of Needs spending that savings would cover | 6 (built) |
| Budget rollover | Per-category switch carrying unused or overspent money forward, starting with the month it is switched on | 6 (built) |
| Spending by merchant | Totals by store in the year view | 6 (built) |
| Phone glance page | Read-only dashboard PDF, `finance-glance.pdf`, saved to the backup folder whenever a backup is written | 6 (built) |

Declined: receipt photos. Undecided: tags.

## Data, backup and two PCs

- **Live data** is one SQLite file in the app-data folder. It never sits inside a synced folder, because syncing an open database can damage it.
- **Backup:** on close, and every ten minutes while there are changes, a full copy is written to a chosen folder (meant to be inside OneDrive), named with the PC and time. The last 30 per PC plus one per month are kept. Any copy can be restored from Settings; the data it replaces is kept as a `before-restore` file.
- **Switching PCs:** when the app opens, and when its window is returned to after a while, it looks for a newer copy from the other PC. It loads that copy by itself only when nothing can be lost: this PC has no changes of its own, and the copy was built on this PC's data (each data file records which backups it has taken in). When both PCs have changes the other lacks, it asks once which to keep. A fresh install pointed at the folder takes the newest copy there. The data replaced is always kept as a `before-restore` file. Never merge.
- **Phone glance page:** a read-only PDF of the current month (left to spend for the household and each person, group bars, the balance between the two, bills due this week, next paychecks, fund balances, latest entries), shaped for a phone screen and saved beside the backups.
- **Per-PC settings** (theme, backup folder, API key) live beside the data file, not in it.

## Stack

Electron, React, TypeScript and SQLite (Node's built-in `node:sqlite`, so there are no native modules to compile). All logic is TypeScript. electron-builder makes a Windows installer and a portable .exe. Only the theme stylesheet is reused from the first build.

## Data model

Thirteen tables. Money is whole cents. Balances, budget actuals, fund totals, the year view and pay predictions are calculated from these each time and never stored.

| Table | Holds |
| --- | --- |
| `entries` | Date, description, full amount, kind, category, who paid, account, split, both shares, fund, source template, import batch, seen-in-bank tick, link to the purchase it was split from |
| `categories` | Name, group, kind (expense or income), order, icon, the month rollover starts from, archived |
| `budget_lines` | Month, person, category, planned amount |
| `months` | Month, person, starting balance |
| `recurring` | Bill templates (monthly, with a due day) and renewals (every so many months, with a next date and an optional fund that pays) |
| `funds` | Name, owner, target, starting amount, the category that feeds it, emergency tick, archived |
| `merchants` | Merchant name with the category and split last used |
| `imports` | One row per pasted batch, for undo |
| `balance_checks` | Account, owner, date, balance |
| `paychecks` | Only paychecks with something typed on them: person, period, payday, no-benefits tick, real gross and take-home. The rest are worked out from the schedule |
| `work_days` | Date, person, hours, tag |
| `pay_profiles` | One row per rate: hourly rate or fixed take-home with its start date. Each row also carries the person's schedule, usual hours, yearly goal and known paychecks. Withholding fields and deduction lines are unused until the tax-rule prediction |
| `settings` | People, default split, presets, groups, targets, opening balance, revision counter |

## Build order

1. **Shell:** window, six screens, themes, data file, backup. *Built.*
2. **Entries, split and budget:** quick-add, both budgets, balance, dashboard. *Built.*
3. **Screenshot import**, balance snapshots, missing-entries check.
4. **Bills & Split:** recurring templates, statement. *Built.* The bills-went-out check follows milestone 3.
5. **Pay calendar** and predictions. *Built, except the tax-rule prediction, which waits for pay stubs.* The paycheck-landed check follows milestone 3.
6. **Savings and year:** funds, renewals, year view, automatic loading on the other PC. *Built.*

Each milestone is used on real data before the next begins. See [STATUS.md](STATUS.md).
