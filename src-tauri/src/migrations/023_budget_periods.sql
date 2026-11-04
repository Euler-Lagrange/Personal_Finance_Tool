CREATE TABLE budget_period_overrides (
 event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 month TEXT NOT NULL,
 reason TEXT NOT NULL
);
