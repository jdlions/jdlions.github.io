-- Preserve every original file ID, owner, article link and photo metadata.
ALTER TABLE photos ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0,1));
ALTER TABLE photos ADD COLUMN deleted_at TEXT;
ALTER TABLE photos ADD COLUMN deleted_by_member_id TEXT REFERENCES members(id);
ALTER TABLE photos ADD COLUMN restored_at TEXT;
ALTER TABLE photos ADD COLUMN restored_by_member_id TEXT REFERENCES members(id);
