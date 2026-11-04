PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('checking','credit','savings')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, group_name TEXT NOT NULL, color TEXT NOT NULL,
  default_limit_cents INTEGER NOT NULL CHECK(default_limit_cents >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  icon TEXT NOT NULL DEFAULT 'auto'
);
CREATE TABLE IF NOT EXISTS budgets (
  month TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id),
  limit_cents INTEGER NOT NULL CHECK(limit_cents >= 0), PRIMARY KEY(month, category_id)
);
CREATE TABLE IF NOT EXISTS budget_months (month TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK(kind IN ('expense','income','settlement','transfer','card_payment')),
  date TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  payer TEXT NOT NULL CHECK(payer IN ('jacob','chelsea')),
  category_id TEXT REFERENCES categories(id), account_id TEXT REFERENCES accounts(id),
  split_mode TEXT NOT NULL, split_value TEXT NOT NULL,
  jacob_cents INTEGER NOT NULL CHECK(jacob_cents >= 0), chelsea_cents INTEGER NOT NULL CHECK(chelsea_cents >= 0),
  household_delta_cents INTEGER NOT NULL, note TEXT NOT NULL,
  destination_account_id TEXT REFERENCES accounts(id),
  CHECK((kind IN ('transfer','card_payment') AND account_id IS NOT NULL AND destination_account_id IS NOT NULL
         AND account_id != destination_account_id AND payer='jacob' AND household_delta_cents=0 AND split_mode='none' AND split_value='')
     OR (kind NOT IN ('transfer','card_payment') AND destination_account_id IS NULL)),
  CHECK((kind = 'expense' AND jacob_cents + chelsea_cents = amount_cents AND category_id IS NOT NULL)
     OR (kind != 'expense' AND jacob_cents = 0 AND chelsea_cents = 0 AND category_id IS NULL))
);
CREATE INDEX IF NOT EXISTS events_by_date ON events(date);
CREATE TABLE IF NOT EXISTS account_activity (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id), change_cents INTEGER NOT NULL,
  PRIMARY KEY(event_id,account_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, event_id TEXT, action TEXT NOT NULL, payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
