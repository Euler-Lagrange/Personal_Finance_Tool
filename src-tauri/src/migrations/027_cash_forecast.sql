CREATE TABLE cash_forecast_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>0), input_json TEXT NOT NULL
);
CREATE TABLE cash_forecast_receipts (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL);
