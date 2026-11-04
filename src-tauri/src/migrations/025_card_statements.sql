CREATE TABLE card_statement_configs (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 revision INTEGER NOT NULL CHECK(revision>0), config_json TEXT NOT NULL
);
CREATE TABLE card_statements (
 account_id TEXT NOT NULL REFERENCES card_statement_configs(account_id),
 month TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 input_json TEXT NOT NULL, review_json TEXT NOT NULL,
 evidence_source_id TEXT REFERENCES import_sources(id),
 PRIMARY KEY(account_id,month)
);
CREATE TABLE card_statement_receipts (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL);
