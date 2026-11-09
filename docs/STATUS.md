# Status

Last updated 2026-11-09. Milestones 1 and 2 are built and checked on Linux. Nothing has been run by hand on Windows yet.

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

## Checked, and how

| Check | Result |
| --- | --- |
| `npm run typecheck` | Clean |
| `npm test` (38 unit tests) | All pass. Covers amount parsing, split rounding and refunds, shares always adding up, balance, both budgets and Household, month copy-forward, undo of add / edit / delete / split, categories and groups, setup import, backup write / restore / prune and their refusals |
| `npm run smoke` (12 steps in the real window, Linux) | All pass. Types into quick-add, edits cells in place, Undo button, bulk delete, Ctrl+Z, planned amount, theme, Settle up, backup folder, Restore, refused folder; the stored data is checked after each step |
| `npm run shots` | Every screen reviewed in Slate and Marshmallow |
| Backup on close | Confirmed: file written, integrity check ok, all rows present |
| `npm run dev` | Starts and renders |

**Defects found by these checks and fixed**

1. Deleting a purchase that had been split left its pieces pointing at nothing. Pieces now stand alone; test added.
2. Undoing an edit to a split purchase failed. Undo now restores rows safely; test added.
3. Ctrl+Z did nothing while the cursor rested in an empty box. It now only yields to a box holding unsaved typing.
4. A backup folder that no longer exists could hang the app. It is now refused with a message, and the previous folder is kept; test added.
5. Splitting a fixed-amount purchase would have changed who owes what. It is now refused with a message; test added.
6. Restoring an archived category could create two categories with one name. Now refused; test added.

## Not checked yet

- **Windows.** GitHub Actions runs the unit tests and the smoke test on Windows and builds the installer and portable .exe on every push. The app has not been launched by hand on a Windows PC.
- **Native dialogs.** The folder chooser and setup-file picker are not driven by the smoke test. The logic behind them is.
- **OneDrive.** That backup copies sync to a second PC.
- **The installer.** Install, upgrade and uninstall.

## Small gaps against the design for milestones 1 and 2

- Transaction columns can be shown and hidden but not reordered.
- A fixed-dollar split can be stored and calculated but not typed in the app yet. It arrives with bill templates in milestone 4.
- The merged-finances switch is not built. Entries already store both shares, so it needs no data change.

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
