CREATE TABLE month_closes (
 month TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
 closed INTEGER NOT NULL CHECK(closed IN (0,1)), closed_at TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL, fingerprint TEXT NOT NULL
);
CREATE TABLE close_receipts (
 id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, month TEXT NOT NULL
);
