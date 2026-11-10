# Household Finance

A simple household budget tracker for Windows: one list of entries, two budgets, one balance between two people.

This branch (`simple-rebuild`) is a from-scratch rebuild. The earlier build on `main` is kept for reference only.

- **Design:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **What is built and what is next:** [docs/STATUS.md](docs/STATUS.md)
- **Rules for anyone (or any agent) changing the code:** [CLAUDE.md](CLAUDE.md)

## Run it

Needs Node.js 22 or newer. Nothing else: there are no native modules to compile.

```
npm ci
npm start            # build and open the app with your real data
npm run dev          # same, with hot reload
npm run dev -- --demo   # scratch folder with made-up data
```

## Check it

```
npm run check        # type check + unit tests
npm run smoke        # opens the real window, types and clicks like a person, checks the stored data
npm run closecheck   # runs the app as two PCs sharing a backup folder, closing each like a person
npm run shots        # saves a picture of every screen into shots/
```

## Build the Windows app

```
npm run dist         # writes the installer and a portable .exe into release/
```

Every push to this branch also builds both on GitHub (Actions tab, "Check and build", artifact `household-finance-windows`).

## Where things live

| Path | What it is |
| --- | --- |
| `src/core/` | Money, split, balance, budget, dates and pay maths. Plain functions, fully unit tested. |
| `src/main/` | The Electron main process: SQLite data file, every read and write, backup. |
| `src/renderer/` | The screens (React). They only call the main process; they hold no money logic. |
| `src/shared/` | Types shared by both sides. |
| `docs/setup.example.json` | A sample setup file. Import one from Settings to fill in names, categories and a first plan. |

Your data file and per-PC settings live in the Windows app-data folder, never in this repository. Do not commit real financial data, and keep personal setup files out of git (`setup.personal.json` and `*.local.json` are ignored).
