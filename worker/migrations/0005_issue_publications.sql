-- Additive: existing issues, articles, assignments, photos and Drive files are untouched.
CREATE TABLE issue_publications (
  number INTEGER PRIMARY KEY CHECK (number BETWEEN 1 AND 999999),
  year INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  season TEXT NOT NULL CHECK (season IN ('Summer', 'Winter')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  url TEXT NOT NULL,
  drive_file_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL
);
