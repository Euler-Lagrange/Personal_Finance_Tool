CREATE TABLE import_sources (
  id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  mime TEXT NOT NULL, format TEXT NOT NULL, content BLOB NOT NULL,
  account_id TEXT REFERENCES accounts(id), revision INTEGER NOT NULL DEFAULT 1,
  dataset_json TEXT NOT NULL, mapping_json TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
  configured INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE import_commits (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES import_sources(id),
  payload_hash TEXT NOT NULL, receipt_json TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE import_rows (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES import_sources(id), ordinal INTEGER NOT NULL,
  raw_json TEXT NOT NULL, candidate_json TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'pending' CHECK(disposition IN ('pending','imported','linked','excluded')),
  event_id TEXT, event_revision INTEGER, commit_id TEXT REFERENCES import_commits(id),
  UNIQUE(source_id,ordinal)
);
CREATE INDEX import_rows_event ON import_rows(event_id);
CREATE INDEX events_import_match ON events(amount_cents,date);
CREATE TABLE import_profiles (
  account_id TEXT NOT NULL REFERENCES accounts(id), header_key TEXT NOT NULL,
  mapping_json TEXT NOT NULL, PRIMARY KEY(account_id,header_key)
);
