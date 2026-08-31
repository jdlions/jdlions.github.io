CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  issue_id TEXT,
  student_id TEXT NOT NULL,
  article_type TEXT NOT NULL,
  title_ko TEXT NOT NULL DEFAULT '',
  title_en TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','reviewing','revision_requested','hold','approved','scheduled')),
  draft_html TEXT NOT NULL DEFAULT '',
  editor_draft_html TEXT NOT NULL DEFAULT '',
  current_student_revision_id TEXT,
  current_editor_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT
);

CREATE TABLE IF NOT EXISTS article_revisions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('student','admin')),
  revision_kind TEXT NOT NULL CHECK (revision_kind IN ('submission','resubmission','editor_save','status_change','import')),
  title_ko TEXT NOT NULL DEFAULT '',
  title_en TEXT NOT NULL DEFAULT '',
  content_html TEXT NOT NULL DEFAULT '',
  revision_number INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  UNIQUE(article_id, revision_number)
);

CREATE TABLE IF NOT EXISTS article_feedback (
  article_id TEXT PRIMARY KEY,
  student_feedback TEXT NOT NULL DEFAULT '',
  internal_note TEXT NOT NULL DEFAULT '',
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS native_articles_by_student ON articles(student_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS native_articles_by_status ON articles(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS native_articles_by_issue ON articles(issue_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS article_revisions_by_article ON article_revisions(article_id, revision_number DESC);

ALTER TABLE photos ADD COLUMN article_id TEXT;
CREATE INDEX IF NOT EXISTS photos_by_native_article ON photos(article_id);
