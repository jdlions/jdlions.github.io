-- New observational data only. Existing membership and business rows are untouched.
CREATE TABLE student_activity_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), started_at TEXT NOT NULL
);
INSERT INTO student_activity_settings VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE student_activity_summary (
 member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
 last_seen_at TEXT, last_activity_type TEXT, last_activity_at TEXT,
 assignment_view_at TEXT, last_submit_id TEXT, last_submit_at TEXT,
 last_submit_type TEXT, last_submit_outcome TEXT,
 last_error_at TEXT, last_error_type TEXT
);
CREATE TABLE student_activity_events (
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK(type IN ('article_submit','photo_submit')),
 outcome TEXT NOT NULL CHECK(outcome IN ('attempt','success','input_error','permission_error','rate_limit','server_error')),
 occurred_at TEXT NOT NULL
);
CREATE INDEX student_activity_events_retention ON student_activity_events(occurred_at);
