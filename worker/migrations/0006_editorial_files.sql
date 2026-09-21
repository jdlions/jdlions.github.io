-- Independent, append-only Affinity archive. Existing article/photo tables are untouched.
CREATE TABLE editorial_projects (
  id TEXT PRIMARY KEY, year INTEGER NOT NULL, season TEXT NOT NULL CHECK(season IN ('Summer','Winter')),
  folder_id TEXT NOT NULL, latest_version INTEGER NOT NULL DEFAULT 0,
  pending_id TEXT, created_at TEXT NOT NULL, UNIQUE(year,season)
);
CREATE TABLE editorial_edit_sessions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES editorial_projects(id),
  user_id TEXT NOT NULL, base_version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE editorial_versions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES editorial_projects(id),
  version INTEGER NOT NULL, base_version INTEGER NOT NULL,
  edit_session_id TEXT NOT NULL UNIQUE REFERENCES editorial_edit_sessions(id),
  user_id TEXT NOT NULL, editor_name TEXT NOT NULL, change_note TEXT NOT NULL,
  original_filename TEXT NOT NULL, normalized_filename TEXT NOT NULL, extension TEXT NOT NULL,
  file_size INTEGER NOT NULL, content_hash TEXT NOT NULL, drive_file_id TEXT NOT NULL UNIQUE,
  upload_url TEXT, state TEXT NOT NULL CHECK(state IN ('uploading','complete','cancelled')),
  created_at TEXT NOT NULL, uploaded_at TEXT, md5 TEXT
);
CREATE UNIQUE INDEX editorial_version_number ON editorial_versions(project_id,version) WHERE state != 'cancelled';
CREATE TABLE editorial_upload_chunks (
  upload_id TEXT NOT NULL REFERENCES editorial_versions(id), offset INTEGER NOT NULL,
  digest TEXT NOT NULL, PRIMARY KEY(upload_id,offset)
);
