ALTER TABLE import_commits ADD COLUMN identity_only INTEGER NOT NULL DEFAULT 0 CHECK(identity_only IN (0,1));
CREATE TABLE import_occurrences (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
 excluded INTEGER NOT NULL CHECK(excluded IN (0,1)), UNIQUE(account_id,event_id)
);
ALTER TABLE import_rows ADD COLUMN occurrence_id TEXT REFERENCES import_occurrences(id);
CREATE TABLE import_stable_ids (
 account_id TEXT NOT NULL REFERENCES accounts(id), stable_id TEXT NOT NULL,
 occurrence_id TEXT NOT NULL REFERENCES import_occurrences(id),
 created_commit_id TEXT NOT NULL REFERENCES import_commits(id), PRIMARY KEY(account_id,stable_id)
);
CREATE TABLE import_coverage (
 source_id TEXT PRIMARY KEY REFERENCES import_sources(id),
 start_date TEXT NOT NULL, end_date TEXT NOT NULL, date_basis TEXT NOT NULL CHECK(date_basis IN ('transaction','posted')),
 completeness TEXT NOT NULL CHECK(completeness IN ('complete','partial','incremental')),
 profile TEXT NOT NULL, layout_hash TEXT NOT NULL, observed_at TEXT NOT NULL, inclusive INTEGER NOT NULL CHECK(inclusive=1)
);
CREATE TABLE import_dependencies (
 consumer_commit_id TEXT NOT NULL REFERENCES import_commits(id), provider_commit_id TEXT NOT NULL REFERENCES import_commits(id),
 PRIMARY KEY(consumer_commit_id,provider_commit_id), CHECK(consumer_commit_id!=provider_commit_id)
);
INSERT INTO import_occurrences(id,account_id,event_id,excluded)
 SELECT DISTINCT s.account_id||':'||r.event_id,s.account_id,e.id,CASE WHEN e.id IS NULL THEN 1 ELSE 0 END
 FROM import_rows r JOIN import_sources s ON s.id=r.source_id LEFT JOIN events e ON e.id=r.event_id
 WHERE r.disposition IN ('imported','linked') AND s.account_id IS NOT NULL;
UPDATE import_rows SET occurrence_id=(SELECT s.account_id||':'||import_rows.event_id FROM import_sources s WHERE s.id=import_rows.source_id) WHERE disposition IN ('imported','linked');
INSERT INTO import_occurrences(id,account_id,event_id,excluded)
 SELECT 'row:'||r.id,s.account_id,NULL,1 FROM import_rows r JOIN import_sources s ON s.id=r.source_id
 WHERE r.disposition='excluded' AND s.account_id IS NOT NULL AND json_extract(r.candidate_json,'$.status')='posted';
UPDATE import_rows SET occurrence_id='row:'||id WHERE disposition='excluded' AND EXISTS(SELECT 1 FROM import_occurrences o WHERE o.id='row:'||import_rows.id);
