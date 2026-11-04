CREATE TABLE ai_row_reviews(
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES ai_jobs(id),
 payload_hash TEXT NOT NULL, input_json TEXT NOT NULL, before_json TEXT NOT NULL,
 proposal_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE ai_row_bindings(source_id TEXT PRIMARY KEY REFERENCES import_sources(id),review_id TEXT NOT NULL REFERENCES ai_row_reviews(id));
