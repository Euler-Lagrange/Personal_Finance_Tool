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
| Budget | Planned / Actual / Diff tables | Planned against actual per category for person A, person B or Household; Month / Year |
| Bills & Split | Shared bills sheet and the bill-splitting app | Recurring bills with each share, running balance, Settle up, statement export |
| Pay | Payroll calendar and the hours-to-pay table | Hours calendar, paychecks, predicted against actual pay, paycheck plan |
| Savings | Sinking fund rows and the renewals list | Fund balances and targets, yearly renewals, per-paycheck set-aside |

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

- **Calendar:** Monday-to-Sunday month grid. Hours per day; week totals; each pay period shaded and labelled with its payday. Day tags: Worked, Sick, Holiday, Off.
- **Paychecks:** rows with period start, period end and payday, generated from a schedule rule (biweekly: two weeks, paid a set number of days after, moved earlier off weekends and holidays) and editable by hand. A per-paycheck "no benefits deduction" tick.
- **Two predictions side by side:** (1) from history, a straight-line fit of take-home against gross over known paychecks; (2) from tax rules, hours times rate minus the pay profile's deductions and withholding, using one editable rates file per tax year. A setting picks which feeds planned income; each keeps its miss against the real deposit.
- **Paycheck plan:** predicted net, minus bills due before the next payday, minus savings transfers.
- **Year strip:** hours, gross and net to date, and hours needed to reach a gross target.
- A salaried person is a fixed net amount on their paydays, with no calendar.

## Savings, renewals, year view (milestone 6)

- **Funds:** name, owner, optional target, opening balance. Contributions are ordinary entries tagged with the fund; purchases paid from the fund draw it down. A Set balance button trues it up.
- **Renewals:** bill templates with a yearly or multi-year cadence and a next date. The screen totals them and shows the set-aside per paycheck.
- **Year view:** categories by month with totals and averages, plus hours and pay by month. Computed live.

## Approved extras

| Extra | What it does | Milestone |
| --- | --- | --- |
| Undo | Ctrl+Z reverses the last edit, delete or import | 2 (built) |
| Bulk edit | Select several rows, set category or split at once | 2 (built) |
| Split one purchase | Divide one receipt across categories; pieces stay linked | 2 (built) |
| Subscription flag | Points out a repeating charge not in the bills yet | 3 |
| Bill change flag | Marks a bill whose amount moved from last month | 4 (built) |
| Hours what-if | Type hours, see the predicted paycheck | 5 |
| Export | Any month or year to Excel or CSV | 6 |
| Emergency fund runway | Months of Needs spending that savings would cover | 6 |
| Budget rollover | Per-category switch carrying unused or overspent money forward | 6 |
| Spending by merchant | Totals by store in the year view | 6 |
| Phone glance page | Read-only dashboard PDF saved to the backup folder on close | 6 |

Declined: receipt photos. Undecided: tags.

## Data, backup and two PCs

- **Live data** is one SQLite file in the app-data folder. It never sits inside a synced folder, because syncing an open database can damage it.
- **Backup:** on close, and every ten minutes while there are changes, a full copy is written to a chosen folder (meant to be inside OneDrive), named with the PC and time. The last 30 per PC plus one per month are kept. Any copy can be restored from Settings; the data it replaces is kept as a `before-restore` file.
- **Switching PCs (milestone 6):** on launch, if the newest copy in the folder came from the other PC and is newer, load it and keep the local file as a backup. If both PCs changed since the last shared copy, ask once which to keep. Never merge.
- **Per-PC settings** (theme, backup folder, API key) live beside the data file, not in it.

## Stack

Electron, React, TypeScript and SQLite (Node's built-in `node:sqlite`, so there are no native modules to compile). All logic is TypeScript. electron-builder makes a Windows installer and a portable .exe. Only the theme stylesheet is reused from the first build.

## Data model

Thirteen tables. Money is whole cents. Balances, budget actuals, fund totals, the year view and pay predictions are calculated from these each time and never stored.

| Table | Holds |
| --- | --- |
| `entries` | Date, description, full amount, kind, category, who paid, account, split, both shares, fund, source template, import batch, seen-in-bank tick, link to the purchase it was split from |
| `categories` | Name, group, kind (expense or income), order, icon, rollover, archived |
| `budget_lines` | Month, person, category, planned amount |
| `months` | Month, person, starting balance |
| `recurring` | Bill and renewal templates |
| `funds` | Name, owner, target, opening balance |
| `merchants` | Merchant name with the category and split last used |
| `imports` | One row per pasted batch, for undo |
| `balance_checks` | Account, owner, date, balance |
| `paychecks` | Person, period, payday, no-benefits tick, actual gross and net |
| `work_days` | Date, person, hours, tag |
| `pay_profiles` | Rate or salary with effective date, schedule rule, withholding fields, deduction lines |
| `settings` | People, default split, presets, groups, targets, opening balance, revision counter |

## Build order

1. **Shell:** window, six screens, themes, data file, backup. *Built.*
2. **Entries, split and budget:** quick-add, both budgets, balance, dashboard. *Built.*
3. **Screenshot import**, balance snapshots, missing-entries check.
4. **Bills & Split:** recurring templates, statement. *Built.* The bills-went-out check follows milestone 3.
5. **Pay calendar** and predictions, paycheck-landed check.
6. **Savings and year:** funds, renewals, year view, automatic loading on the other PC.

Each milestone is used on real data before the next begins. See [STATUS.md](STATUS.md).
