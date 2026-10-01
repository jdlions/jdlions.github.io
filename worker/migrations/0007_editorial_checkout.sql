-- 0006 may already be used by preview/local installations: preserve it verbatim.
CREATE TABLE editorial_editors (
  role TEXT PRIMARY KEY CHECK(role IN ('chief','deputy')),
  name TEXT NOT NULL DEFAULT '', slack_user_id TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
INSERT INTO editorial_editors(role,updated_at) VALUES('chief',strftime('%Y-%m-%dT%H:%M:%fZ','now')),('deputy',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE editorial_editor_settings (id INTEGER PRIMARY KEY CHECK(id=1),dm_enabled INTEGER NOT NULL DEFAULT 0 CHECK(dm_enabled IN (0,1)), channel_enabled INTEGER NOT NULL DEFAULT 0 CHECK(channel_enabled IN (0,1)), channel_id TEXT NOT NULL DEFAULT '');
INSERT INTO editorial_editor_settings VALUES(1,0,0,'');
CREATE TABLE editorial_locks (
  id TEXT PRIMARY KEY REFERENCES editorial_edit_sessions(id),
  project_id TEXT NOT NULL REFERENCES editorial_projects(id), user_id TEXT NOT NULL,
  owner_role TEXT NOT NULL REFERENCES editorial_editors(role), owner_name TEXT NOT NULL, owner_slack_user_id TEXT NOT NULL,
  base_version INTEGER NOT NULL, started_at TEXT NOT NULL,
  ended_at TEXT, end_reason TEXT CHECK(end_reason IN ('completed','cancelled','forced')), end_event_id TEXT
);
CREATE UNIQUE INDEX editorial_one_active_lock ON editorial_locks(project_id) WHERE ended_at IS NULL;
CREATE TABLE editorial_lock_audit (
  id TEXT PRIMARY KEY, lock_id TEXT NOT NULL UNIQUE REFERENCES editorial_locks(id),
  project_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('completed','cancelled','forced')),
  actor_user_id TEXT NOT NULL, actor_role TEXT NOT NULL, actor_name TEXT NOT NULL,
  owner_role TEXT NOT NULL, owner_name TEXT NOT NULL, base_version INTEGER NOT NULL, created_at TEXT NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'not_applicable', notification_id TEXT,
  notification_status_at TEXT
);
CREATE INDEX editorial_notification_rate_window ON editorial_lock_audit(owner_role,created_at);
ALTER TABLE editorial_versions ADD COLUMN editor_role TEXT;
-- Legacy completed history is preserved exactly (role unknown). An in-flight
-- tab-based reservation cannot safely be mapped to a named role: invalidate it,
-- retain metadata and every Drive object, and require a new checkout.
UPDATE editorial_versions SET state='cancelled',upload_url=NULL WHERE state='uploading';
UPDATE editorial_projects SET pending_id=NULL;
