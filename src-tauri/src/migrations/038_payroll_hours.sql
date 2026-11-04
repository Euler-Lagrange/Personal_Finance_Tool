CREATE TABLE payroll_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 revision INTEGER NOT NULL CHECK(revision>=0),
 state_json TEXT NOT NULL
);
CREATE TABLE payroll_changes (
 id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL UNIQUE CHECK(revision>0),
 payload_hash TEXT NOT NULL,
 change_json TEXT NOT NULL,
 state_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
