import {assignmentWorkSql,activityStudentsSql,activityObservation} from './assignment-work.js';
const rows=async(db,sql,args=[]) => (await db.prepare(sql).bind(...args).all()).results;
const DAY=86400000;
export async function dashboardSummary(db,now=Date.now()){
 const at=new Date(now).toISOString(),seven=new Date(now-7*DAY).toISOString(),three=new Date(now-3*DAY).toISOString(),month=new Date(now-30*DAY).toISOString(),soon=new Date(now+3*DAY).toISOString();
 const jobs={
 articles:()=>db.prepare("SELECT count(*) total,coalesce(sum(status='submitted'),0) reviewPending FROM articles").first(),
 assignment:async()=>{
  const result=await rows(db,`WITH work AS (${assignmentWorkSql}),latest AS (
   SELECT id,name,year,issue_label issueLabel FROM assignment_campaigns WHERE status='active' AND (starts_at IS NULL OR julianday(starts_at)<=julianday(?)) ORDER BY coalesce(starts_at,created_at) DESC,created_at DESC,id DESC LIMIT 1)
   SELECT c.*,s.article_type articleType,coalesce(sum(w.total),0) total,coalesce(sum(w.submitted),0) submitted,
   (SELECT coalesce(sum(total),0) FROM work) assignedCount,(SELECT coalesce(sum(submitted),0) FROM work) submittedCount
   FROM (SELECT 1) singleton LEFT JOIN latest c ON 1 LEFT JOIN assignment_slots s ON s.campaign_id=c.id LEFT JOIN work w ON w.campaign_id=c.id AND w.slot_id=s.id GROUP BY c.id,s.article_type`,[at]);
  const r=result[0];return {campaign:r.id?{id:r.id,name:r.name,year:r.year,issueLabel:r.issueLabel}:null,progress:result.filter(r=>r.articleType).map(({articleType,total,submitted})=>({articleType,total,submitted})),assignedCount:r.assignedCount,submittedCount:r.submittedCount,missingCount:r.assignedCount-r.submittedCount};
 },
 photos:()=>db.prepare(`SELECT count(*) total,coalesce(sum(coalesce(a.article_type,CASE WHEN p.issue_id LIKE 'student-photo:%' THEN substr(p.issue_id,15) END)='school'),0) school,coalesce(sum(coalesce(a.article_type,CASE WHEN p.issue_id LIKE 'student-photo:%' THEN substr(p.issue_id,15) END)='feature'),0) feature FROM photos p LEFT JOIN articles a ON a.id=p.article_id WHERE p.is_deleted=0`).first(),
 deadlines:()=>rows(db,`WITH work AS (${assignmentWorkSql}) SELECT w.campaign_id campaignId,w.slot_id slotId,c.name campaignName,s.display_name slotName,w.article_type articleType,w.due_at dueAt,sum(w.total-w.submitted) missing,
  julianday(w.due_at)<julianday(?) overdue FROM work w JOIN assignment_campaigns c ON c.id=w.campaign_id JOIN assignment_slots s ON s.id=w.slot_id WHERE w.total>w.submitted AND w.due_at IS NOT NULL AND julianday(w.due_at)<=julianday(?) GROUP BY w.campaign_id,w.slot_id,w.due_at ORDER BY julianday(w.due_at),w.campaign_id,w.slot_id LIMIT 8`,[at,soon]),
 editorial:()=>db.prepare(`SELECT p.id,p.year,p.season,v.version,v.normalized_filename filename,v.editor_name editorName,v.editor_role editorRole,v.uploaded_at uploadedAt,
  l.id lockId,l.owner_name lockOwner,l.owner_role lockRole,l.started_at lockStartedAt,l.base_version baseVersion
  FROM editorial_projects p LEFT JOIN editorial_versions v ON v.project_id=p.id AND v.version=p.latest_version AND v.state='complete' AND v.state!='cancelled'
  LEFT JOIN editorial_locks l ON l.project_id=p.id AND l.ended_at IS NULL ORDER BY p.year DESC,CASE p.season WHEN 'Winter' THEN 1 ELSE 0 END DESC,p.id DESC LIMIT 1`).first(),
 activity:()=>db.prepare(`WITH students AS (${activityStudentsSql}) SELECT (SELECT started_at FROM student_activity_settings WHERE id=1) startedAt,count(*) total,
  coalesce(sum(last_seen_at>=?),0) active7d,coalesce(sum(last_seen_at<=?),0) inactive3d,coalesce(sum(last_seen_at<=?),0) inactive7d,
  coalesce(sum(last_seen_at IS NULL),0) noAccessRecord,coalesce(sum(last_error_at>=?),0) errorStudents30d,coalesce(sum(assigned_count>submitted_count),0) missingStudents
  FROM students`).bind(seven,three,seven,month).first(),
 activityDetails:async()=>{
  const fields='id,name,last_login_at,last_seen_at,last_activity_at,assignment_view_at,last_error_at,last_error_type,assigned_count,submitted_count';
  const result=await rows(db,`WITH students AS (${activityStudentsSql})
   SELECT 'recent' kind,${fields} FROM (SELECT ${fields} FROM students WHERE last_seen_at IS NOT NULL ORDER BY last_seen_at DESC,id LIMIT 5)
   UNION ALL SELECT 'attention',${fields} FROM (SELECT ${fields} FROM students WHERE last_error_at>=? OR last_seen_at<=? OR assigned_count>submitted_count OR (assigned_count>0 AND assignment_view_at IS NULL)
   ORDER BY (last_error_at>=?) DESC,last_error_at DESC,(assigned_count>submitted_count) DESC,last_seen_at IS NULL,last_seen_at,id LIMIT 5)`,[month,three,month]);
  return result.map(r=>({kind:r.kind,id:r.id,name:r.name,lastSeenAt:r.last_seen_at,assignmentViewAt:r.assignment_view_at,lastErrorAt:r.last_error_at>=month?r.last_error_at:null,lastErrorType:r.last_error_at>=month?r.last_error_type:null,assignedCount:r.assigned_count,submittedCount:r.submitted_count,lastLoginAt:r.last_login_at,lastActivityAt:r.last_activity_at}));
 },
 timeline:async()=>{
  // workerd D1 limits compound SELECT terms; two bounded groups avoid that limit.
  const sources=[
   `SELECT * FROM(SELECT 'article:'||r.id id,'article' kind,r.created_at occurredAt,r.title_ko title,coalesce(m.name,'이름 확인 불가') actor,r.article_id articleId,NULL studentId,NULL memberId,NULL projectId,'article_revisions' source,NULL outcome FROM article_revisions r LEFT JOIN members m ON m.google_sub=r.author_user_id WHERE r.author_role='student' AND r.revision_kind IN ('submission','resubmission') AND r.created_at>=? ORDER BY r.created_at DESC,r.id DESC LIMIT 12)`,
   `SELECT * FROM(SELECT 'photo:'||p.id,'photo',p.created_at,p.filename,coalesce(m.name,'이름 확인 불가'),NULL,p.student_google_id,NULL,NULL,'photos',NULL FROM photos p LEFT JOIN members m ON m.google_sub=p.student_google_id WHERE p.is_deleted=0 AND p.created_at>=? ORDER BY p.created_at DESC,p.id DESC LIMIT 12)`,
   `SELECT * FROM(SELECT 'version:'||v.id,'version',v.uploaded_at,v.normalized_filename,v.editor_name,NULL,NULL,NULL,v.project_id,'editorial_versions',NULL FROM editorial_versions v WHERE v.state='complete' AND v.state!='cancelled' AND v.uploaded_at>=? ORDER BY v.uploaded_at DESC,v.id DESC LIMIT 12)`,
   `SELECT * FROM(SELECT 'checkout:'||l.id,'checkout',l.started_at,p.year||' '||p.season,l.owner_name,NULL,NULL,NULL,l.project_id,'editorial_locks',NULL FROM editorial_locks l JOIN editorial_projects p ON p.id=l.project_id WHERE l.started_at>=? ORDER BY l.started_at DESC,l.id DESC LIMIT 12)`,
   `SELECT * FROM(SELECT 'lock:'||l.id,'lock',l.created_at,p.year||' '||p.season,l.actor_name,NULL,NULL,NULL,l.project_id,'editorial_lock_audit',l.action FROM editorial_lock_audit l JOIN editorial_projects p ON p.id=l.project_id WHERE l.created_at>=? ORDER BY l.created_at DESC,l.id DESC LIMIT 12)`,
   `SELECT * FROM(SELECT 'error:'||e.id,'error',e.occurred_at,e.type,m.name,NULL,NULL,e.member_id,NULL,'student_activity_events',e.outcome FROM student_activity_events e JOIN members m ON m.id=e.member_id WHERE e.outcome IN ('server_error','input_error','permission_error','rate_limit') AND e.occurred_at>=? ORDER BY e.occurred_at DESC,e.id DESC LIMIT 12)`
  ];
  const groups=await Promise.all([sources.slice(0,3),sources.slice(3)].map(group=>rows(db,`WITH events(id,kind,occurredAt,title,actor,articleId,studentId,memberId,projectId,source,outcome) AS (${group.join(' UNION ALL ')}) SELECT * FROM events ORDER BY occurredAt DESC,id DESC LIMIT 12`,Array(group.length).fill(month))));
  return groups.flat().sort((a,b)=>a.occurredAt===b.occurredAt?(a.id===b.id?0:a.id>b.id?-1:1):a.occurredAt>b.occurredAt?-1:1).slice(0,12);
 }
 };
 const entries=Object.entries(jobs),settled=await Promise.allSettled(entries.map(([,fn])=>fn())),out={serverNow:at,errors:{}};
 for(let i=0;i<entries.length;i++){const key=entries[i][0],r=settled[i];out[key]=r.status==='fulfilled'?r.value:null;if(r.status==='rejected')out.errors[key]='이 영역의 집계를 불러오지 못했습니다.';}
 if(out.activityDetails)out.activityDetails=out.activityDetails.map(({lastLoginAt,lastActivityAt,...r})=>({...r,observation:activityObservation({last_seen_at:r.lastSeenAt,last_activity_at:lastActivityAt,last_login_at:lastLoginAt},out.activity?.startedAt)}));
 return out;
}
