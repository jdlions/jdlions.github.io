CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  season TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','published')),
  classroom_course_id TEXT NOT NULL,
  article_types_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_issue ON issues(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS article_edits (
  submission_id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_work_id TEXT NOT NULL,
  student_google_id TEXT NOT NULL,
  edited_html TEXT NOT NULL DEFAULT '',
  editor_note TEXT NOT NULL DEFAULT '',
  note_visibility TEXT NOT NULL DEFAULT 'internal' CHECK (note_visibility IN ('internal','student')),
  status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed','reviewing','accepted','hold','rejected')),
  updated_by_google_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  article_submission_id TEXT NOT NULL,
  student_google_id TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  photographer TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed','approved','hold','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS articles_by_issue ON article_edits(issue_id);
CREATE INDEX IF NOT EXISTS articles_by_student ON article_edits(student_google_id);
CREATE INDEX IF NOT EXISTS photos_by_issue ON photos(issue_id);
CREATE INDEX IF NOT EXISTS photos_by_student ON photos(student_google_id);

