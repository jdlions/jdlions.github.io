CREATE TABLE IF NOT EXISTS assignment_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER,
  issue_label TEXT NOT NULL DEFAULT '',
  issue_id TEXT,
  instructions TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
  audience_mode TEXT NOT NULL DEFAULT 'all' CHECK (audience_mode IN ('all','selected')),
  created_by_user_id TEXT NOT NULL,
  distributed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(issue_id) REFERENCES issues(id)
);

CREATE TABLE IF NOT EXISTS assignment_slots (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  article_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10),
  due_at TEXT,
  instructions TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(campaign_id) REFERENCES assignment_campaigns(id)
);

CREATE TABLE IF NOT EXISTS assignment_recipients (
  campaign_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL DEFAULT '',
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(campaign_id, student_id),
  FOREIGN KEY(campaign_id) REFERENCES assignment_campaigns(id)
);

CREATE TABLE IF NOT EXISTS assignment_targets (
  campaign_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  PRIMARY KEY(campaign_id, student_id),
  FOREIGN KEY(campaign_id) REFERENCES assignment_campaigns(id)
);

CREATE TABLE IF NOT EXISTS assignment_slot_instances (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 1,
  article_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(campaign_id, student_id) REFERENCES assignment_recipients(campaign_id, student_id),
  FOREIGN KEY(slot_id) REFERENCES assignment_slots(id),
  FOREIGN KEY(article_id) REFERENCES articles(id),
  UNIQUE(student_id, slot_id, ordinal)
);

CREATE INDEX IF NOT EXISTS assignment_campaigns_by_status ON assignment_campaigns(status, due_at);
CREATE INDEX IF NOT EXISTS assignment_slots_by_campaign ON assignment_slots(campaign_id, position);
CREATE INDEX IF NOT EXISTS assignment_recipients_by_student ON assignment_recipients(student_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS assignment_instances_by_campaign ON assignment_slot_instances(campaign_id, student_id);
CREATE INDEX IF NOT EXISTS assignment_instances_by_slot ON assignment_slot_instances(slot_id, student_id);
