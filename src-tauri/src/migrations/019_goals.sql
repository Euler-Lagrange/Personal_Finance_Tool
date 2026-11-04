CREATE TABLE savings_goals (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
  name TEXT NOT NULL, account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  target_cents INTEGER NOT NULL CHECK(target_cents>0), target_date TEXT,
  monthly_cents INTEGER NOT NULL CHECK(monthly_cents>=0),
  policy TEXT NOT NULL CHECK(policy IN ('goal_only','count_monthly')),
  archived INTEGER NOT NULL CHECK(archived IN (0,1))
);
CREATE TABLE goal_funding (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
  line_id TEXT NOT NULL, goal_id TEXT NOT NULL REFERENCES savings_goals(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  policy TEXT NOT NULL CHECK(policy IN ('goal_only','count_monthly')),
  withdrawal_id TEXT REFERENCES events(id), reviewed INTEGER NOT NULL CHECK(reviewed IN (0,1))
);
CREATE INDEX funding_purchase ON goal_funding(event_id,line_id);
CREATE INDEX funding_withdrawal ON goal_funding(withdrawal_id);
CREATE TABLE goal_funding_receipts (id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,event_id TEXT NOT NULL);
CREATE TABLE goal_interest (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES savings_goals(id)
);
