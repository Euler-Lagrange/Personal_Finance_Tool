CREATE TABLE activity_dates (
 event_id TEXT NOT NULL, account_id TEXT NOT NULL, date TEXT NOT NULL,
 PRIMARY KEY(event_id,account_id),
 FOREIGN KEY(event_id,account_id) REFERENCES account_activity(event_id,account_id) ON DELETE CASCADE
);
CREATE TABLE movement_reconciliations (
 id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), payload_hash TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0 CHECK(undone IN (0,1))
);
CREATE UNIQUE INDEX movement_active ON movement_reconciliations(canonical_id) WHERE undone=0;
CREATE TABLE movement_dependencies (
 operation_id TEXT NOT NULL REFERENCES movement_reconciliations(id),
 commit_id TEXT NOT NULL REFERENCES import_commits(id),
 PRIMARY KEY(operation_id,commit_id)
);
