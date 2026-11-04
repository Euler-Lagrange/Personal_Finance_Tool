CREATE TABLE rollover_policies (
 category_id TEXT NOT NULL REFERENCES categories(id),
 effective_month TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('reset','carry')),
 PRIMARY KEY(category_id,effective_month)
);
CREATE TABLE budget_receipts (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL);
CREATE TABLE budget_carry_entries (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL REFERENCES close_receipts(id),
 source_month TEXT NOT NULL REFERENCES month_closes(month),
 target_month TEXT NOT NULL,
 category_id TEXT NOT NULL REFERENCES categories(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents!=0),
 previous_cents INTEGER NOT NULL,
 output_cents INTEGER NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL,
 CHECK(source_month<target_month),
 CHECK(previous_cents+amount_cents=output_cents),
 UNIQUE(operation_id,category_id)
);
CREATE INDEX carry_target ON budget_carry_entries(target_month,category_id);
