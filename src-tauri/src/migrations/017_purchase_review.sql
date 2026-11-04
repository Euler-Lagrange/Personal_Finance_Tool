CREATE TABLE purchase_reviews (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES import_sources(id),
    payload_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0 CHECK(undone IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX purchase_reviews_source ON purchase_reviews(source_id,created_at);
