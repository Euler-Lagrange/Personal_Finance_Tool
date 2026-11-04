CREATE TABLE import_classification_profiles (
    account_id TEXT NOT NULL REFERENCES accounts(id),
    layout_hash TEXT NOT NULL CHECK(length(layout_hash)=64),
    profile TEXT NOT NULL CHECK(length(trim(profile)) BETWEEN 1 AND 100),
    policy_json TEXT NOT NULL,
    automatic INTEGER NOT NULL CHECK(automatic IN (0,1)),
    PRIMARY KEY(account_id,layout_hash,profile)
);
