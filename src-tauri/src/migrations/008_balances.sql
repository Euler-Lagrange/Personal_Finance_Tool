ALTER TABLE accounts ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'imported' CHECK(tracking_mode IN ('imported','manual','untracked'));
CREATE TABLE balance_checkpoints (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0),
 account_id TEXT NOT NULL REFERENCES accounts(id), date TEXT NOT NULL,
 balance_cents INTEGER NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('opening','confirmed')),
 note TEXT NOT NULL, UNIQUE(account_id,date)
);
