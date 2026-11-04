CREATE TABLE ai_jobs (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES import_sources(id),
 request_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','interrupted')),
 session_id TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT,
 proposal_json TEXT, failure_json TEXT, retry_not_before INTEGER,
 CHECK((status='completed')=(proposal_json IS NOT NULL)),
 CHECK((status='failed')=(failure_json IS NOT NULL)),
 CHECK((status='running')=(finished_at IS NULL))
);
CREATE INDEX ai_jobs_source ON ai_jobs(source_id,created_at);
