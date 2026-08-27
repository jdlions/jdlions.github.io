ALTER TABLE photos ADD COLUMN rights_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (rights_confirmed IN (0, 1));
