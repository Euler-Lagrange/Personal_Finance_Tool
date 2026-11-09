# Working on this app

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/STATUS.md](docs/STATUS.md) first. The first build of this app (branch `main`) became too complicated to use; these rules exist to stop that happening again.

## The complexity budget

- **Thirteen tables and six screens.** Adding either needs the owner's say-so.
- **A feature is built only if it replaces something the owner does by hand, or the owner approved it by name** (see "Approved extras" in the architecture).
- **No confirm or acknowledge dialogs** except on delete-like actions (restoring a backup counts) and on saving an import. Prefer Undo.
- **No locks.** Every entry is always editable. Nothing is ever "closed".
- **No account ledgers.** The app never calculates a running bank or card balance and never asks anyone to reconcile. Balances are snapshots.
- **No controls that do nothing.** A screen that is not built yet says which milestone it arrives in.

## How the code is arranged

- `src/core/` holds all money maths as plain functions with unit tests. Money is whole cents. Shares are computed once and stored on the entry.
- `src/main/api.ts` is the only place that reads or writes the database. Every change goes through `mutate()`, which runs in one transaction and records what Undo needs.
- `src/renderer/` holds screens. They call the main process through `call` / `change` / `useQuery` in `src/renderer/api.ts` and never do money maths beyond display.
- Errors meant for the person using the app are `UserError`s with a plain sentence. They show next to the control or as a toast.
- The two people are `a` and `b` in code and data. Their names are a setting. Never hard-code a real name.

## Working through a milestone

1. Build one milestone at a time, in the order in `docs/STATUS.md`.
2. Write unit tests for new maths and API methods. Test behaviour a person would notice and money invariants (shares add up, undo restores exactly), not implementation details.
3. Extend the smoke test (`src/main/devtools.ts`) with the milestone's main path.
4. Run `npm run check`, `npm run smoke` and `npm run shots`, and look at the screenshots.
5. Update `docs/STATUS.md`: what was built, what was checked and how, what was not checked.
6. The owner uses the milestone on real data before the next one starts.

## Data safety

- Tests, the smoke test and screenshots use made-up data in a scratch folder (`FINANCE_DATA_DIR`). Never point them at the real data file.
- Never commit real financial data, real names, pay rates or balances. This repository is public.
- A schema change is a new entry in `MIGRATIONS` in `src/main/db.ts`. Never edit an existing migration.
