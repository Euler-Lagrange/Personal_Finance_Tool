ALTER TABLE pending_activity ADD COLUMN kind_hint TEXT CHECK(kind_hint IS NULL OR (kind_hint IN ('card_payment','transfer') AND verified_expense=0));
CREATE TABLE import_account_dates (
    row_id TEXT PRIMARY KEY REFERENCES import_rows(id) ON DELETE CASCADE,
    date TEXT NOT NULL CHECK(length(date)=10)
);
CREATE VIEW effective_activity_dates AS
SELECT a.event_id,a.account_id,
    COALESCE(d.date, (
        SELECT min(p.date) FROM import_account_dates p
        JOIN import_rows r ON r.id=p.row_id JOIN import_sources s ON s.id=r.source_id
        WHERE r.event_id=a.event_id AND s.account_id=a.account_id AND r.disposition='linked'
        HAVING count(DISTINCT p.date)=1
    ), e.date) AS date
FROM account_activity a JOIN events e ON e.id=a.event_id
LEFT JOIN activity_dates d ON d.event_id=a.event_id AND d.account_id=a.account_id;
