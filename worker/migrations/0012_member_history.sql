-- Manual approval required. Preserve all existing business ownership and audit rows.
ALTER TABLE member_signup_code ADD COLUMN code_ciphertext TEXT;
ALTER TABLE members ADD COLUMN last_login_at TEXT;
-- One-time staging of identities already present in existing D1 article/assignment records.
-- No invented emails, no Google API, no runtime Classroom dependency.
CREATE TABLE member_legacy_students (
 google_sub TEXT PRIMARY KEY, name TEXT, student_number TEXT,
 imported_at TEXT NOT NULL, resolved_member_id TEXT REFERENCES members(id)
);
CREATE TABLE member_audit_preserved (
 id INTEGER PRIMARY KEY AUTOINCREMENT, member_id TEXT NOT NULL, action TEXT NOT NULL,
 actor TEXT NOT NULL, auth_version INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO member_audit_preserved SELECT * FROM member_audit;
DROP TRIGGER member_created;
DROP TRIGGER member_changed;
DROP TABLE member_audit;
ALTER TABLE member_audit_preserved RENAME TO member_audit;
CREATE TRIGGER member_created AFTER INSERT ON members BEGIN
 INSERT INTO member_audit(member_id,action,actor,auth_version,created_at)
 VALUES(NEW.id,'registered',NEW.changed_by,NEW.auth_version,NEW.created_at);
END;
CREATE TRIGGER member_changed AFTER UPDATE ON members BEGIN
 INSERT INTO member_audit(member_id,action,actor,auth_version,created_at)
 VALUES(NEW.id,CASE WHEN OLD.google_sub IS NULL AND NEW.google_sub IS NOT NULL THEN 'linked' ELSE 'updated' END,NEW.changed_by,NEW.auth_version,NEW.updated_at);
END;
CREATE TABLE member_deletion_audit (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL, actor TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('requested','blocked','deleted')), created_at TEXT NOT NULL
);
DROP TRIGGER member_no_delete;
CREATE TRIGGER member_safe_delete BEFORE DELETE ON members BEGIN
 SELECT CASE WHEN OLD.role!='student' OR OLD.id='bootstrap-editor'
 OR EXISTS(SELECT 1 FROM member_legacy_students WHERE resolved_member_id IS NULL)
 OR EXISTS(SELECT 1 FROM member_audit WHERE member_id=OLD.id AND action!='registered')
 OR EXISTS(SELECT 1 FROM member_audit WHERE actor IN (OLD.id,OLD.google_sub,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub))
 OR EXISTS(SELECT 1 FROM member_legacy_students WHERE resolved_member_id=OLD.id OR google_sub=OLD.google_sub)
 OR EXISTS(SELECT 1 FROM issue_publications WHERE published_by IN (OLD.id,OLD.google_sub,OLD.email))
 OR EXISTS(SELECT 1 FROM article_edits WHERE student_google_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub) OR updated_by_google_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM articles WHERE student_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM article_revisions WHERE author_user_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM article_feedback WHERE updated_by_user_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM photos WHERE student_google_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM assignment_campaigns WHERE created_by_user_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM assignment_recipients WHERE student_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM assignment_targets WHERE student_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM assignment_slot_instances WHERE student_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM editorial_edit_sessions WHERE user_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM editorial_versions WHERE user_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM editorial_locks WHERE user_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM editorial_lock_audit WHERE actor_user_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM assignment_length_reviews WHERE actor_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM member_assignment_targets WHERE member_id IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub)) OR
 EXISTS(SELECT 1 FROM member_signup_code WHERE updated_by IN (OLD.id,OLD.google_sub,OLD.email,'member:'||OLD.id,'oauth:'||OLD.google_sub,'signup:'||OLD.google_sub))
 THEN RAISE(ABORT,'member_history_protected') END;
END;
CREATE TRIGGER member_deleted AFTER DELETE ON members BEGIN
 INSERT INTO member_audit(member_id,action,actor,auth_version,created_at)
 VALUES(OLD.id,'deleted',(SELECT actor FROM member_deletion_audit WHERE member_id=OLD.id AND outcome='deleted' ORDER BY created_at DESC,id DESC LIMIT 1),OLD.auth_version,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
