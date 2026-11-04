CREATE TABLE import_evidence (
 fingerprint TEXT PRIMARY KEY, mime TEXT NOT NULL, format TEXT NOT NULL, content BLOB NOT NULL
);
INSERT INTO import_evidence SELECT fingerprint,mime,format,content FROM import_sources;
CREATE TABLE import_sources_v12 (
 id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL REFERENCES import_evidence(fingerprint), name TEXT NOT NULL,
 mime TEXT NOT NULL, format TEXT NOT NULL,
 account_id TEXT REFERENCES accounts(id), revision INTEGER NOT NULL DEFAULT 1,
 dataset_json TEXT NOT NULL, mapping_json TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
 configured INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO import_sources_v12 SELECT id,fingerprint,name,mime,format,account_id,revision,dataset_json,mapping_json,error,configured,dismissed,created_at FROM import_sources;
DROP TABLE import_sources;
ALTER TABLE import_sources_v12 RENAME TO import_sources;
CREATE INDEX import_sources_fingerprint ON import_sources(fingerprint);
CREATE TABLE import_observations (
 source_id TEXT PRIMARY KEY REFERENCES import_sources(id),
 parent_id TEXT NOT NULL REFERENCES import_sources(id),
 parent_revision INTEGER NOT NULL CHECK(parent_revision>0), CHECK(source_id!=parent_id)
);
CREATE TABLE import_download_profiles (
 account_id TEXT NOT NULL REFERENCES accounts(id), layout_hash TEXT NOT NULL,
 profile TEXT NOT NULL, date_basis TEXT NOT NULL CHECK(date_basis IN ('transaction','posted')),
 completeness TEXT NOT NULL CHECK(completeness IN ('complete','partial','incremental')),
 pattern TEXT NOT NULL CHECK(pattern IN ('manual','trailing_days','month_to_date','previous_month')),
 days INTEGER, PRIMARY KEY(account_id,layout_hash),
 CHECK((pattern='trailing_days' AND days BETWEEN 1 AND 366) OR (pattern!='trailing_days' AND days IS NULL))
);
