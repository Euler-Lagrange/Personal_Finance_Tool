# Status

Last updated 2026-11-09. Milestones 1, 2, 4 and 5 are built and checked on Linux and on GitHub's Windows runner. Nothing has been run by hand on the owner's PC yet. Milestone 3 waits for sample screenshots; the tax-rule pay prediction waits for two pay stubs.

## Built

**Milestone 1: shell**

- Window with six screens and Settings. Savings says which milestone it arrives in.
- Fourteen themes, remembered per PC.
- One SQLite data file with all thirteen tables.
- Backup to a chosen folder on close and every ten minutes while there are changes; keeps this PC's last 30 copies plus one per month; any copy can be restored from Settings.
- Setup file import (names, split, groups, targets, categories, a first month's plan). See `docs/setup.example.json`.

**Milestone 2: entries, split and budget**

- Quick-add for expenses, income and settlements, with split presets and a custom percentage.
- Transactions list: every cell edits in place, search, show and hide columns.
- Two budgets and a Household view: planned against actual per category, grouped, with each group's share of planned income against its target. A new month starts as a copy of the last plan; a change can apply to later months.
- Categories and groups: add, rename, reorder, move, icon, archive, delete.
- Running balance between the two people, opening balance, Settle up.
- Dashboard: left to spend, income, net, groups, balance, over-plan list, recent entries.
- Approved extras: Undo (button and Ctrl+Z, last 50 changes), bulk edit, split one purchase across categories.

**Milestone 4: bills and the statement**

- Bill templates on the Bills & Split screen: name, due day, category, payer, split and usual amount, all editable in place. A bill can be switched off or deleted; deleting keeps its past entries.
- Each bill creates its entry when a new month starts, on its due day. A bill with no usual amount waits until this month's amount is typed. A bill deleted from a month on purpose is not recreated.
- A split per bill: the household default, a preset, a custom percentage, or a fixed dollar amount. In any split menu, Custom accepts "62.5" or "$110.42".
- A Paid tick per bill, and bills due in the next seven days on the dashboard.
- Approved extra: the bill change flag shows how far this month's amount moved from last time.
- Statement PDF for either person: shared bills, other shared purchases, settlements, the balance at the start and end of the month, and their budget.

**Milestone 5: pay calendar**

- Pay screen with a Monday-to-Sunday hours calendar per person: hours and a tag (Worked, Sick, Holiday, Off) per day, week totals, pay periods shaded, paydays marked, bank holidays named.
- Pay settings: paid by the hour or the same every paycheck; rate with a start date (a later date records a raise); paid every two weeks or on set days of the month; usual hours a paycheck; sick hours a year; yearly gross goal; which income category it is planned under. The next three paydays show as the schedule is typed.
- Paychecks follow the schedule, moved earlier off weekends, United States bank holidays and days tagged Holiday. Each row shows hours, gross, predicted take-home, the real take-home once typed, the miss between them, bills before the next payday and what is left. Dates can be changed by hand.
- Prediction from known paychecks: a straight line of take-home against gross. Known paychecks are a typed list plus any paycheck whose real take-home is filled in. A "no benefits taken out" tick is learned separately.
- A pay period still under way is predicted at the usual hours until more are logged.
- One button sets the month's planned paycheck income from the paychecks landing in it.
- The year by payday: hours, gross, take-home, sick hours used, hours left to the yearly goal.
- Next paycheck on the dashboard.
- Approved extra: hours what-if.
- The setup file can carry each person's pay (rates, schedule, known paychecks).

## Checked, and how

| Check | Result |
| --- | --- |
| `npm run typecheck` | Clean |
| `npm test` (76 unit tests) | All pass. Covers amount parsing, split rounding and refunds, shares always adding up, balance, both budgets and Household, month copy-forward, undo of add / edit / delete / split, categories and groups, setup import, backup write / restore / prune and their refusals, bill creation and month roll-over, every kind of bill split, the change flag, switching off and deleting bills, the statement's figures and wording, pay periods for both schedules, bank holidays, paydays moved off holidays, hours and sick time, rates and raises, predictions and their limits, the no-benefits extra, usual hours, paychecks stored only when typed on, dates changed by hand, a changed schedule, the paycheck plan against bills, planned income, the year totals, a fixed paycheck, and pay in a setup file |
| `npm run smoke` (22 steps in the real window) | All pass. Types into quick-add, edits cells in place, Undo button, bulk delete, Ctrl+Z, planned amount, theme, Settle up, adds a bill, ticks Paid and changes its amount, types hours and a sick tag in the calendar, types a real take-home and undoes it, the what-if, plans income from paychecks, corrects the rate in Pay settings, the fixed-paycheck view, writes the statement PDF, backup folder, Restore, refused folder; the stored data is checked after each step |
| `npm run shots` | Every screen reviewed in Slate and Marshmallow, including Pay with its settings open and the fixed-paycheck view |
| Pay against real numbers | The owner's private setup file loads. On his 21 known paychecks the prediction misses by 0.65% on average, and its 80-hour figure is within 0.2% of the one in his spreadsheet. His real numbers stay out of this repository |
| Statement PDF | Opened and read: two pages, totals add up, the balance sentence matches the app |
| Backup on close | Confirmed: file written, integrity check ok, all rows present |
| `npm run dev` | Starts and renders |
| GitHub Actions, Linux | Type check, unit tests and smoke test pass |
| GitHub Actions, Windows | Unit tests and the smoke test pass in the real window on Windows; installer and portable .exe built and uploaded as the `household-finance-windows` artifact |

**Defects found by these checks and fixed**

1. Deleting a purchase that had been split left its pieces pointing at nothing. Pieces now stand alone; test added.
2. Undoing an edit to a split purchase failed. Undo now restores rows safely; test added.
3. Ctrl+Z did nothing while the cursor rested in an empty box. It now only yields to a box holding unsaved typing.
4. A backup folder that no longer exists could hang the app. It is now refused with a message, and the previous folder is kept; test added.
5. Splitting a fixed-amount purchase would have changed who owes what. It is now refused with a message; test added.
6. Restoring an archived category could create two categories with one name. Now refused; test added.
7. The bills table ran off the side of the window and the change flag overlapped a share. Layout tightened.
8. The statement's "Your budget" heading was stranded at the foot of page one. Headings now stay with their table.
9. Replacing categories from a setup file after a bill existed failed with an unclear message. Now refused with a plain one; test added.
10. Adding a raise through a setup file would have dropped the person's pay schedule and known paychecks. The schedule is now read from a rate that has one; test added.
11. A straight-line prediction could exceed gross for a very short pay period. Predictions now stay between zero and gross, and are marked as rough when well outside the known paychecks; test added.
12. A person on a fixed paycheck was shown paydays from the neighbouring months. Now only the month's own; test added.
13. In light themes the pay-period shading and the real-against-predicted bars could not be told apart. Colours changed and rechecked.
14. A month's expected income ignored paychecks whose hours were not logged yet, so planning from it would have understated income. Those are now predicted at the usual hours; test added.

## Not checked yet

- **The owner's PC.** The Windows checks above ran on GitHub's machines. The app has not been launched by hand on a real Windows PC, so display scaling, fonts and the theme look are unconfirmed there.
- **Native dialogs.** The folder chooser, setup-file picker and the statement's Save dialog are not driven by the smoke test. The logic behind them is.
- **OneDrive.** That backup copies sync to a second PC.
- **The installer.** Install, upgrade and uninstall.

## Small gaps against the design so far

- Transaction columns can be shown and hidden but not reordered.
- The merged-finances switch is not built. Entries already store both shares, so it needs no data change.
- The Paid tick is manual. Ticking it automatically from a checking screenshot ("bills went out") arrives with milestone 3.
- Bill templates are monthly. Yearly renewals use the same table and arrive with milestone 6.
- Pay has one prediction, from known paychecks. The tax-rule prediction needs two real pay stubs (one with no benefits taken out) to check against.
- The paycheck plan subtracts bills only. Savings transfers join in milestone 6.
- The year totals count only hours and paychecks entered in the app, so the first year in use starts part-way.
- Gross is hours times the rate, with no overtime rate. The gross from a stub can be typed on any paycheck.
- The bank holiday list is the United States one and is built in. A company holiday is added by tagging the day Holiday.
- The "paycheck landed" check against a checking screenshot arrives with milestone 3.

## Next

Milestone 6 needs nothing from the owner. Milestone 3 starts when sample screenshots arrive.

**Milestone 6: savings and the year**

1. Funds on the Savings screen: name, owner, optional target, opening balance; contributions and spending are ordinary entries tagged with the fund; Set balance.
2. Yearly renewals: bill templates with a yearly cadence and a next date; the per-paycheck set-aside, which also joins the paycheck plan on Pay.
3. Year view: categories by month with totals and averages, plus hours and pay by month.
4. Approved extras: export to Excel or CSV, emergency fund runway, budget rollover, spending by merchant, phone glance page.
5. Load the newest backup automatically when the other PC opens the app.

**Milestone 3: screenshot import**

1. API key in Settings, stored with Electron `safeStorage` (use the async methods; the sync ones are deprecated).
2. Paste and drop images on Transactions; send each to the Anthropic API with the category list and merchant memory; constrain the reply to rows.
3. One review table beside the screenshot: tick purchases; untick and label payments, transfers, pending and likely duplicates. A split purchase matches on the sum of its pieces (`split_of`).
4. **Add entries** in one `mutate()` so Undo removes the batch. Record the batch in `imports`.
5. Merchant memory in `merchants`: remember category and split on save, pre-fill next time.
6. Balance snapshots in `balance_checks` from checking and card screenshots; the missing-entries check.
7. Subscription flag (approved extra).
8. Tests for duplicate matching and merchant memory; smoke steps using a recorded API reply, never a live call.

Before starting, the owner supplies three or four real screenshots as the test set. Keep them out of git.

## First run on the owner's PC

```
git fetch origin simple-rebuild
git switch simple-rebuild
npm ci
npm run check
npm run smoke
npm start
```

Then, in the app:

1. Settings: import the private setup file, choose a backup folder inside OneDrive, pick a theme.
2. Pay, Pay settings: check the "Next paydays" line against the payroll schedule. Set up the second person's pay.
3. Pay: log the hours for any pay period that has not been paid yet, so its paycheck is predicted.
