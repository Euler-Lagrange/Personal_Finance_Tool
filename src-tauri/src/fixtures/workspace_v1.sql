PRAGMA foreign_keys=ON;
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO metadata VALUES ('workspace','personal');
CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('checking','credit')));
CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, group_name TEXT NOT NULL, color TEXT NOT NULL, default_limit_cents INTEGER NOT NULL CHECK(default_limit_cents >= 0));
CREATE TABLE budgets (month TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id), limit_cents INTEGER NOT NULL CHECK(limit_cents >= 0), PRIMARY KEY(month,category_id));
CREATE TABLE events (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK(kind IN ('expense','income','settlement')),
  date TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  payer TEXT NOT NULL CHECK(payer IN ('jacob','chelsea')),
  category_id TEXT REFERENCES categories(id), account_id TEXT REFERENCES accounts(id),
  split_mode TEXT NOT NULL, split_value TEXT NOT NULL,
  jacob_cents INTEGER NOT NULL CHECK(jacob_cents >= 0), chelsea_cents INTEGER NOT NULL CHECK(chelsea_cents >= 0),
  household_delta_cents INTEGER NOT NULL, note TEXT NOT NULL,
  CHECK((kind='expense' AND jacob_cents+chelsea_cents=amount_cents AND category_id IS NOT NULL) OR (kind!='expense' AND jacob_cents=0 AND chelsea_cents=0 AND category_id IS NULL))
);
CREATE INDEX events_by_date ON events(date);
CREATE TABLE account_activity (event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES accounts(id), change_cents INTEGER NOT NULL);
CREATE TABLE audit (id INTEGER PRIMARY KEY, event_id TEXT, action TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
INSERT INTO accounts VALUES ('checking','Capital One 360','checking'),('amex','American Express','credit');
INSERT INTO categories VALUES ('groceries','Groceries','Needs','#5b9985',70000),('uncategorized','Uncategorized','Other','#9b9fa9',0);
INSERT INTO events VALUES ('86838cf9-0f3c-4c33-b3f6-49b3e4b4e891',1,'expense','2025-01-02','January groceries',10000,'jacob','groceries','amex','shared','',7000,3000,3000,'Original note');
INSERT INTO events VALUES ('724047ef-9183-4d24-a51e-dde107cc2737',1,'expense','2025-02-02','February groceries',10000,'jacob','groceries','amex','shared','',7000,3000,3000,'');
INSERT INTO account_activity SELECT id,account_id,amount_cents FROM events;
INSERT INTO budgets VALUES ('2025-01','groceries',0);
PRAGMA user_version=1;
