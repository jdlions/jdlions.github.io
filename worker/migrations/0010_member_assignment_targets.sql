-- Additive pre-login assignment intent. Never store member IDs as Google IDs.
-- Keep this cutover migration outside automatic approvals, like 0009.
CREATE TABLE member_assignment_targets (
  campaign_id TEXT NOT NULL REFERENCES assignment_campaigns(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  assigned_at TEXT,
  PRIMARY KEY(campaign_id, member_id)
);
CREATE INDEX member_assignment_targets_by_member ON member_assignment_targets(member_id);
-- Enforce atomically against concurrent member edits and assignment creation.
CREATE TRIGGER member_pending_email_locked BEFORE UPDATE OF email ON members
WHEN OLD.google_sub IS NULL AND NEW.email!=OLD.email
AND EXISTS(SELECT 1 FROM member_assignment_targets WHERE member_id=OLD.id) BEGIN
  SELECT RAISE(ABORT,'member_pending_email_locked');
END;
