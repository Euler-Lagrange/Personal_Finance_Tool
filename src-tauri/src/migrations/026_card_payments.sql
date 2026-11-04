CREATE TABLE card_obligations (
 account_id TEXT NOT NULL, month TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 base_cents INTEGER NOT NULL, carry_json TEXT NOT NULL, source_hash TEXT NOT NULL, note TEXT NOT NULL,
 PRIMARY KEY(account_id,month),
 FOREIGN KEY(account_id,month) REFERENCES card_statements(account_id,month)
);
CREATE TABLE card_payment_reviews (
 event_id TEXT PRIMARY KEY REFERENCES events(id), revision INTEGER NOT NULL CHECK(revision>0),
 stamp_json TEXT NOT NULL, note TEXT NOT NULL
);
CREATE TABLE card_payment_allocations (
 event_id TEXT NOT NULL REFERENCES card_payment_reviews(event_id) ON DELETE CASCADE,
 account_id TEXT NOT NULL, month TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 PRIMARY KEY(event_id,account_id,month),
 FOREIGN KEY(account_id,month) REFERENCES card_obligations(account_id,month)
);
CREATE TABLE card_payment_receipts (id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL);
