ALTER TABLE merchant_rules ADD COLUMN category_scope TEXT NOT NULL DEFAULT 'any' CHECK(category_scope IN ('any','personal','shared','chelsea'));
