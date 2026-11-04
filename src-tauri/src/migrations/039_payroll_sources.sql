CREATE TABLE payroll_sources (
 id TEXT PRIMARY KEY,
 fingerprint TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 format TEXT NOT NULL CHECK(format IN ('docx','csv','excel','pdf','image')),
 mime TEXT NOT NULL,
 bytes BLOB NOT NULL,
 bytes_hash TEXT NOT NULL,
 document_json TEXT NOT NULL,
 document_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
