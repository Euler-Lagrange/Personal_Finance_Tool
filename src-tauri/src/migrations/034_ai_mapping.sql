CREATE TABLE ai_mapping_reviews(
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES ai_jobs(id),source_id TEXT NOT NULL REFERENCES import_sources(id),
 payload_hash TEXT NOT NULL,input_json TEXT NOT NULL,dataset_json TEXT NOT NULL,proposal_hash TEXT NOT NULL,account_json TEXT NOT NULL
);
