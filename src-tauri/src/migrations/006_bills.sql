CREATE TABLE bill_templates (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
 first_due TEXT NOT NULL, every_months INTEGER NOT NULL CHECK(every_months BETWEEN 1 AND 60),
 end_date TEXT, archived INTEGER NOT NULL CHECK(archived IN (0,1)), plan_json TEXT NOT NULL
);
CREATE TABLE bill_occurrences (
 id TEXT PRIMARY KEY, bill_id TEXT NOT NULL REFERENCES bill_templates(id),
 period TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), due_date TEXT NOT NULL,
 plan_json TEXT NOT NULL, actual_cents INTEGER CHECK(actual_cents>=0),
 cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1)), note TEXT NOT NULL DEFAULT '',
 UNIQUE(bill_id,period)
);
CREATE TABLE bill_payments (
 id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL REFERENCES bill_occurrences(id),
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), UNIQUE(occurrence_id,event_id)
);
CREATE INDEX bill_payments_event ON bill_payments(event_id);
CREATE TABLE bill_receipts (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE bill_evidence (
 occurrence_id TEXT NOT NULL REFERENCES bill_occurrences(id),
 source_id TEXT NOT NULL REFERENCES import_sources(id), PRIMARY KEY(occurrence_id,source_id)
);
