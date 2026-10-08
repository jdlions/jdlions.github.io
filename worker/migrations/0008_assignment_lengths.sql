-- Nullable limits preserve unlimited behavior for every existing assignment.
ALTER TABLE assignment_campaigns ADD COLUMN min_characters INTEGER CHECK (min_characters IS NULL OR (typeof(min_characters)='integer' AND min_characters>=0));
ALTER TABLE assignment_campaigns ADD COLUMN max_characters INTEGER CHECK (max_characters IS NULL OR (typeof(max_characters)='integer' AND max_characters>=0 AND (min_characters IS NULL OR min_characters<max_characters)));
-- Immutable successful bulk-action audit + transactional stale-snapshot guard.
CREATE TABLE assignment_length_reviews (
 id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 min_characters INTEGER,
 max_characters INTEGER,
 rejected_count INTEGER NOT NULL,
 checked_at TEXT NOT NULL,
 valid INTEGER NOT NULL CHECK(valid=1)
);
