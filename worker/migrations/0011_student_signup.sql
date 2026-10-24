-- Additive, manual approval required before production application.
-- No existing member/ownership/session data is rewritten.
CREATE TABLE member_signup_code (
  id INTEGER PRIMARY KEY CHECK(id=1),
  code_hash TEXT,
  salt TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  updated_by TEXT REFERENCES members(id),
  CHECK((code_hash IS NULL AND salt IS NULL AND enabled=0) OR
        (length(code_hash)=64 AND length(salt)=32))
);
INSERT INTO member_signup_code(id) VALUES(1);
CREATE TABLE member_signup_attempts (
  bucket TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts>0)
);
