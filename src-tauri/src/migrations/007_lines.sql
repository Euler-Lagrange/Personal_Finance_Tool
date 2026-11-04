CREATE TABLE event_lines (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  id TEXT NOT NULL, label TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  split_mode TEXT NOT NULL, split_value TEXT NOT NULL,
  jacob_cents INTEGER NOT NULL CHECK(jacob_cents >= 0),
  chelsea_cents INTEGER NOT NULL CHECK(chelsea_cents >= 0),
  original_line_id TEXT,
  PRIMARY KEY(event_id,id), CHECK(jacob_cents + chelsea_cents = amount_cents)
);
INSERT INTO event_lines
SELECT id,'main','',category_id,amount_cents,'inherit','',jacob_cents,chelsea_cents,
  CASE WHEN kind='refund' THEN 'main' ELSE NULL END
FROM events WHERE kind IN ('expense','refund');
CREATE INDEX lines_category ON event_lines(category_id);
