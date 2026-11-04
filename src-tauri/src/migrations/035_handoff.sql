CREATE TABLE handoff_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),lineage TEXT NOT NULL,head TEXT);
CREATE TABLE handoff_nodes(id TEXT PRIMARY KEY,parent TEXT REFERENCES handoff_nodes(id),content_hash TEXT NOT NULL,created_at TEXT NOT NULL,device TEXT NOT NULL);
CREATE TABLE handoff_receipts(id TEXT PRIMARY KEY,archive_hash TEXT NOT NULL,preview_token TEXT NOT NULL,preserved TEXT NOT NULL);
