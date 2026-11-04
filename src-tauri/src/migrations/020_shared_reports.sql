CREATE TABLE household_groups (
 event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 group_name TEXT NOT NULL CHECK(group_name IN ('bills','everyday','unassigned'))
);
