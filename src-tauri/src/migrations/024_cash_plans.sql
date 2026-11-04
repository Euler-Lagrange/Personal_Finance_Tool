CREATE TABLE cash_schedules (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
 anchor TEXT NOT NULL, cadence TEXT NOT NULL, second_day INTEGER,
 end_date TEXT, archived INTEGER NOT NULL CHECK(archived IN(0,1)), plan_json TEXT NOT NULL
);
CREATE TABLE cash_occurrences (
 id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES cash_schedules(id),
 slot TEXT NOT NULL, scheduled_date TEXT NOT NULL, due_date TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), plan_json TEXT NOT NULL,
 cancelled INTEGER NOT NULL CHECK(cancelled IN(0,1)), note TEXT NOT NULL,
 UNIQUE(schedule_id,slot)
);
CREATE TABLE cash_matches (
 occurrence_id TEXT PRIMARY KEY REFERENCES cash_occurrences(id),
 event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE RESTRICT
);
CREATE TABLE cash_receipts (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL);
