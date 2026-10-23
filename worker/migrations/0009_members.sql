-- Manual cutover only: do not add this migration to automatic approvals.
-- Existing article/assignment/photo/editorial ownership is not rewritten.
CREATE TABLE member_cohorts (
  number INTEGER PRIMARY KEY CHECK(number BETWEEN 1 AND 999),
  created_at TEXT NOT NULL
);
INSERT INTO member_cohorts VALUES (35,strftime('%Y-%m-%dT%H:%M:%fZ','now')),(36,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('teacher','student')),
  student_number TEXT,
  cohort INTEGER REFERENCES member_cohorts(number),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  auth_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  linked_at TEXT,
  changed_by TEXT NOT NULL,
  CHECK(email=lower(trim(email)) AND email LIKE '%@joongdong.hs.kr'),
  CHECK((role='teacher' AND student_number IS NULL AND cohort IS NULL) OR
    (role='student' AND length(student_number)=5 AND student_number NOT GLOB '*[^0-9]*' AND cohort IS NOT NULL)),
  UNIQUE(cohort,student_number)
);
CREATE TABLE member_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  auth_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER member_created AFTER INSERT ON members BEGIN
  INSERT INTO member_audit(member_id,action,actor,auth_version,created_at)
  VALUES(NEW.id,'registered',NEW.changed_by,NEW.auth_version,NEW.created_at);
END;
CREATE TRIGGER member_changed AFTER UPDATE ON members BEGIN
  INSERT INTO member_audit(member_id,action,actor,auth_version,created_at)
  VALUES(NEW.id,CASE WHEN OLD.google_sub IS NULL AND NEW.google_sub IS NOT NULL THEN 'linked' ELSE 'updated' END,NEW.changed_by,NEW.auth_version,NEW.updated_at);
END;
CREATE TRIGGER member_identity_immutable BEFORE UPDATE OF google_sub ON members
WHEN OLD.google_sub IS NOT NULL AND NEW.google_sub IS NOT OLD.google_sub BEGIN
  SELECT RAISE(ABORT,'member_identity_immutable');
END;
CREATE TRIGGER member_no_delete BEFORE DELETE ON members BEGIN
  SELECT RAISE(ABORT,'member_deletion_disabled');
END;
CREATE TRIGGER member_last_teacher BEFORE UPDATE ON members
WHEN OLD.role='teacher' AND OLD.active=1 AND (NEW.role!='teacher' OR NEW.active!=1)
AND NOT EXISTS(SELECT 1 FROM members WHERE id!=OLD.id AND role='teacher' AND active=1) BEGIN
  SELECT RAISE(ABORT,'last_teacher_required');
END;
CREATE TRIGGER member_bootstrap_protected BEFORE UPDATE ON members
WHEN OLD.id='bootstrap-editor' AND (NEW.email!='editor@joongdong.hs.kr' OR NEW.role!='teacher' OR NEW.active!=1) BEGIN
  SELECT RAISE(ABORT,'bootstrap_teacher_protected');
END;
-- The only explicitly approved initial account; no Classroom roster import.
INSERT INTO members(id,email,name,role,created_at,updated_at,changed_by)
VALUES('bootstrap-editor','editor@joongdong.hs.kr','편집부 관리자','teacher',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'migration:0009');
