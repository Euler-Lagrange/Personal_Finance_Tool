CREATE TABLE events_v13 (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK(kind IN ('expense','income','settlement','transfer','card_payment','refund','reward','debt_payment','paypal_cashout','unclassified')),
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
INSERT INTO events_v13 SELECT * FROM events;
DROP TABLE events;
ALTER TABLE events_v13 RENAME TO events;
CREATE INDEX events_by_date ON events(date);
CREATE INDEX events_import_match ON events(amount_cents,date);
CREATE INDEX events_original ON events(original_event_id);


CREATE TABLE pending_activity (
 event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 direction TEXT NOT NULL CHECK(direction IN ('in','out')),
 verified_expense INTEGER NOT NULL CHECK(verified_expense IN (0,1)),
 category_id TEXT REFERENCES categories(id),
 CHECK((verified_expense=1 AND direction='out' AND category_id IS NOT NULL) OR (verified_expense=0 AND category_id IS NULL))
);
CREATE TABLE activity_resolutions (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 prior_revision INTEGER NOT NULL CHECK(prior_revision>0),
 payload_hash TEXT NOT NULL,
 PRIMARY KEY(event_id,prior_revision)
);
CREATE TABLE import_classification (
 source_id TEXT PRIMARY KEY REFERENCES import_sources(id) ON DELETE CASCADE,
 policy_json TEXT NOT NULL
);
