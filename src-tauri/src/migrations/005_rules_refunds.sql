CREATE TABLE events_v5 (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK(kind IN ('expense','income','settlement','transfer','card_payment','refund')),
  date TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  payer TEXT NOT NULL CHECK(payer IN ('jacob','chelsea')),
  category_id TEXT REFERENCES categories(id), account_id TEXT REFERENCES accounts(id),
  split_mode TEXT NOT NULL, split_value TEXT NOT NULL,
  jacob_cents INTEGER NOT NULL CHECK(jacob_cents >= 0), chelsea_cents INTEGER NOT NULL CHECK(chelsea_cents >= 0),
  household_delta_cents INTEGER NOT NULL, note TEXT NOT NULL,
  destination_account_id TEXT REFERENCES accounts(id),
  original_event_id TEXT REFERENCES events(id) ON DELETE RESTRICT,
  CHECK((kind='refund' AND original_event_id IS NOT NULL AND original_event_id!=id) OR (kind!='refund' AND original_event_id IS NULL)),
  CHECK((kind IN ('transfer','card_payment') AND account_id IS NOT NULL AND destination_account_id IS NOT NULL
         AND account_id != destination_account_id AND payer='jacob' AND household_delta_cents=0 AND split_mode='none' AND split_value='')
     OR (kind NOT IN ('transfer','card_payment') AND destination_account_id IS NULL)),
  CHECK((kind IN ('expense','refund') AND jacob_cents + chelsea_cents = amount_cents AND category_id IS NOT NULL)
     OR (kind NOT IN ('expense','refund') AND jacob_cents = 0 AND chelsea_cents = 0 AND category_id IS NULL))
);
INSERT INTO events_v5 SELECT events.*,NULL FROM events;
DROP TABLE events;
ALTER TABLE events_v5 RENAME TO events;
CREATE INDEX events_by_date ON events(date);
CREATE INDEX events_import_match ON events(amount_cents,date);
CREATE INDEX events_original ON events(original_event_id);
CREATE TABLE merchant_rules (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL, name TEXT NOT NULL,
 merchant TEXT NOT NULL, match_mode TEXT NOT NULL, account_id TEXT REFERENCES accounts(id),
 description_contains TEXT NOT NULL, category_action TEXT NOT NULL, category_id TEXT REFERENCES categories(id),
 ownership_action TEXT NOT NULL, split_mode TEXT NOT NULL, split_value TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);
