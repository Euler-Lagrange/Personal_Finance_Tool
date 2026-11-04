CREATE TABLE pdf_templates (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)));
CREATE TABLE pdf_template_versions (
 template_id TEXT NOT NULL REFERENCES pdf_templates(id), version INTEGER NOT NULL CHECK(version>0),
 sample_source_id TEXT NOT NULL REFERENCES import_sources(id), source_hash TEXT NOT NULL,
 definition_json TEXT NOT NULL, layout_json TEXT NOT NULL, approved_on TEXT NOT NULL,
 PRIMARY KEY(template_id,version)
);
CREATE TABLE pdf_applications (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES import_sources(id), fingerprint TEXT NOT NULL UNIQUE,
 template_id TEXT NOT NULL, template_version INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('bill','statement')), target_id TEXT NOT NULL, month TEXT NOT NULL,
 proof_json TEXT NOT NULL, note TEXT NOT NULL,
 FOREIGN KEY(template_id,template_version) REFERENCES pdf_template_versions(template_id,version)
);
CREATE TABLE pdf_receipts (id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL);
