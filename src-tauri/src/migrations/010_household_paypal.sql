CREATE TABLE events_v10 (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK(kind IN ('expense','income','settlement','transfer','card_payment','refund','reward','debt_payment','paypal_cashout')),
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
  CHECK((kind IN ('expense','debt_payment','refund') AND jacob_cents + chelsea_cents = amount_cents AND category_id IS NOT NULL)
     OR (kind NOT IN ('expense','debt_payment','refund','paypal_cashout') AND jacob_cents = 0 AND chelsea_cents = 0 AND category_id IS NULL)
     OR (kind='paypal_cashout' AND chelsea_cents=0 AND ((jacob_cents=0 AND category_id IS NULL) OR (jacob_cents>0 AND category_id IS NOT NULL))))
);
INSERT INTO events_v10 SELECT * FROM events;
DROP TABLE events;
ALTER TABLE events_v10 RENAME TO events;
CREATE INDEX events_by_date ON events(date);
CREATE INDEX events_import_match ON events(amount_cents,date);
CREATE INDEX events_original ON events(original_event_id);

CREATE TABLE household_opening (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>0),
 date TEXT NOT NULL, amount_cents INTEGER NOT NULL, note TEXT NOT NULL
);
CREATE TABLE paypal_cashouts (
 event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 fee_cents INTEGER NOT NULL CHECK(fee_cents>=0), other_cents INTEGER NOT NULL CHECK(other_cents>=0), other_note TEXT NOT NULL
);
CREATE TABLE paypal_allocations (
 cashout_id TEXT NOT NULL REFERENCES paypal_cashouts(event_id) ON DELETE CASCADE,
 receipt_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), PRIMARY KEY(cashout_id,receipt_id)
);
CREATE INDEX paypal_by_receipt ON paypal_allocations(receipt_id);
