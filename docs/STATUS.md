# Status

Last updated 2026-11-09. Milestones 1, 2 and 4 are built and checked on Linux and on GitHub's Windows runner. Nothing has been run by hand on the owner's PC yet. Milestone 3 waits for sample screenshots.

## Built

**Milestone 1: shell**

- Window with six screens and Settings. Pay and Savings say which milestone they arrive in.
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

## Checked, and how

| Check | Result |
| --- | --- |
| `npm run typecheck` | Clean |
| `npm test` (50 unit tests) | All pass. Covers amount parsing, split rounding and refunds, shares always adding up, balance, both budgets and Household, month copy-forward, undo of add / edit / delete / split, categories and groups, setup import, backup write / restore / prune and their refusals, bill creation and month roll-over, every kind of bill split, the change flag, switching off and deleting bills, and the statement's figures and wording |
| `npm run smoke` (15 steps in the real window) | All pass. Types into quick-add, edits cells in place, Undo button, bulk delete, Ctrl+Z, planned amount, theme, Settle up, adds a bill, ticks Paid and changes its amount, writes the statement PDF, backup folder, Restore, refused folder; the stored data is checked after each step |
| `npm run shots` | Every screen reviewed in Slate and Marshmallow |
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

## Next: milestone 3, screenshot import

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

Then, in the app: Settings, import the private setup file, choose a backup folder inside OneDrive, pick a theme.
