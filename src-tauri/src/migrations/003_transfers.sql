CREATE TABLE events_v3 (
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
INSERT INTO events_v3 SELECT events.*,NULL FROM events;
DROP TABLE events;
ALTER TABLE events_v3 RENAME TO events;
CREATE INDEX events_by_date ON events(date);
CREATE TABLE account_activity_v3 (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id), change_cents INTEGER NOT NULL,
  PRIMARY KEY(event_id,account_id)
);
INSERT INTO account_activity_v3 SELECT * FROM account_activity;
DROP TABLE account_activity;
ALTER TABLE account_activity_v3 RENAME TO account_activity;
