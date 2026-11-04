CREATE TABLE ai_document_applications(
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES ai_jobs(id),source_id TEXT NOT NULL REFERENCES import_sources(id),fingerprint TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN('bill','statement')),target_id TEXT NOT NULL,month TEXT NOT NULL,
 input_json TEXT NOT NULL,review_json TEXT NOT NULL,payload_hash TEXT NOT NULL,proposal_hash TEXT NOT NULL
);
