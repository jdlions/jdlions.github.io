// An explicit UI recipient reference, never a Google account ID or article owner.
export const memberRecipient = id => `member:${id}`;
export const isMemberRecipient = id => id.startsWith('member:');
export const assignmentTargetsSql = `SELECT campaign_id,student_id FROM assignment_targets
  UNION SELECT t.campaign_id,COALESCE(m.google_sub,'member:'||m.id) student_id
  FROM member_assignment_targets t JOIN members m ON m.id=t.member_id`;

// Run inside the login/distribution D1 batch. Resolve from verified membership at
// SQL execution time (not a roster snapshot), so either ordering is safe.
// Existing recipient dates, instance IDs, article links and submissions win.
export function resolveMemberAssignments(db,memberId){
  const scope=`FROM member_assignment_targets t JOIN members m ON m.id=t.member_id
    WHERE m.id=? AND m.active=1 AND m.role='student' AND m.google_sub IS NOT NULL AND t.assigned_at IS NOT NULL`;
  return [
    db.prepare(`INSERT INTO assignment_recipients(campaign_id,student_id,student_name,assigned_at)
      SELECT t.campaign_id,m.google_sub,m.student_number||' '||m.name,t.assigned_at ${scope}
      ON CONFLICT(campaign_id,student_id) DO NOTHING`).bind(memberId),
    db.prepare(`INSERT INTO assignment_slot_instances(id,campaign_id,slot_id,student_id,ordinal,created_at,updated_at)
      WITH RECURSIVE ord(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ord WHERE n<10)
      SELECT lower(hex(randomblob(16))),t.campaign_id,s.id,m.google_sub,ord.n,t.assigned_at,t.assigned_at
      FROM member_assignment_targets t JOIN members m ON m.id=t.member_id
      JOIN assignment_slots s ON s.campaign_id=t.campaign_id JOIN ord ON ord.n<=s.quantity
      WHERE m.id=? AND m.active=1 AND m.role='student' AND m.google_sub IS NOT NULL AND t.assigned_at IS NOT NULL
      ON CONFLICT(student_id,slot_id,ordinal) DO NOTHING`).bind(memberId)
  ];
}
