// The same read-only workload definition powers dashboard and activity totals.
// A pre-login target remains a member identity; no Google ID is manufactured.
export const assignmentWorkSql=`
 SELECT i.id,i.campaign_id,i.slot_id,i.student_id,i.article_id,s.article_type,
 coalesce(s.due_at,c.due_at) due_at,1 total,
 CASE WHEN a.status IN ('submitted','reviewing','hold','approved','scheduled') THEN 1 ELSE 0 END submitted
 FROM assignment_slot_instances i JOIN assignment_campaigns c ON c.id=i.campaign_id
 JOIN assignment_slots s ON s.id=i.slot_id LEFT JOIN articles a ON a.id=i.article_id WHERE c.status='active'
 UNION ALL
 SELECT NULL,c.id,s.id,'member:'||m.id,NULL,s.article_type,coalesce(s.due_at,c.due_at),s.quantity,0
 FROM member_assignment_targets t JOIN members m ON m.id=t.member_id JOIN assignment_campaigns c ON c.id=t.campaign_id
 JOIN assignment_slots s ON s.campaign_id=c.id WHERE m.google_sub IS NULL AND t.assigned_at IS NOT NULL AND c.status='active'
 AND NOT EXISTS(SELECT 1 FROM assignment_slot_instances i WHERE i.campaign_id=c.id AND i.slot_id=s.id AND i.student_id='member:'||m.id)`;
export const activityStudentsSql=`WITH work AS (${assignmentWorkSql}),tasks AS (
 SELECT student_id,sum(total) total,sum(submitted) submitted FROM work GROUP BY student_id)
 SELECT m.id,m.name,m.active,m.last_login_at,s.*,
 coalesce(t.total,0)+coalesce(p.total,0) assigned_count,coalesce(t.submitted,0)+coalesce(p.submitted,0) submitted_count
 FROM members m LEFT JOIN student_activity_summary s ON s.member_id=m.id
 LEFT JOIN tasks t ON t.student_id=m.google_sub LEFT JOIN tasks p ON p.student_id='member:'||m.id WHERE m.role='student'`;
export const activityObservation=(row,startedAt)=>row.last_seen_at?'observed':row.last_activity_at?'observed_without_access_time':!row.last_login_at?'no_login_record':row.last_login_at<startedAt?'not_observed_since_launch':'no_retained_observation';
