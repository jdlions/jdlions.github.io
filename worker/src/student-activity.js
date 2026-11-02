import {activityStudentsSql,activityObservation} from './assignment-work.js';
const WINDOW=5*60*1000,DAY=86400000;
const gates=new Map();
export function scheduleActivity(env,operation){
 const task=Promise.resolve().then(operation).catch(()=>{console.warn(JSON.stringify({code:'activity_record_failed'}));});
 try{env.ACTIVITY_WAIT_UNTIL?.(task);}catch{/* Observation must never affect business responses. */}
 return task;
}
const iso=now=>new Date(now).toISOString();
export function submissionType(path,method){
 if(method!=='POST')return null;
 if(/^\/api\/native\/articles\/[^/]+\/submit$/.test(path))return 'article_submit';
 if(path==='/api/photos/upload')return 'photo_submit';
 return null;
}
export function errorOutcome(status){return status>=500?'server_error':status===429?'rate_limit':[401,403,404].includes(status)?'permission_error':'input_error';}
export async function recordPresence(db,memberId,now=Date.now(),kind='authenticated_request'){
 const key=memberId+':'+kind;
 if((gates.get(key)||0)>now)return false;
 if(gates.size>=5000)gates.delete(gates.keys().next().value);
 gates.set(key,now+WINDOW);
 try{
  const row=await db.prepare('SELECT last_seen_at,assignment_view_at FROM student_activity_summary WHERE member_id=?').bind(memberId).first();
  const previous=kind==='assignment_view'?row?.assignment_view_at:row?.last_seen_at;
  if(previous&&Date.parse(previous)>now-WINDOW)return false;
  const at=iso(now),cutoff=iso(now-WINDOW);
  if(kind==='assignment_view')await db.prepare(`INSERT INTO student_activity_summary(member_id,assignment_view_at,last_activity_type,last_activity_at) VALUES(?,?,'assignment_view',?) ON CONFLICT(member_id) DO UPDATE SET assignment_view_at=excluded.assignment_view_at,last_activity_type=CASE WHEN last_activity_at IS NULL OR last_activity_at<=excluded.last_activity_at THEN excluded.last_activity_type ELSE last_activity_type END,last_activity_at=max(coalesce(last_activity_at,''),excluded.last_activity_at) WHERE assignment_view_at IS NULL OR assignment_view_at<=?`).bind(memberId,at,at,cutoff).run();
  else await db.prepare(`INSERT INTO student_activity_summary(member_id,last_seen_at,last_activity_type,last_activity_at) VALUES(?,?,'authenticated_request',?) ON CONFLICT(member_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,last_activity_type=CASE WHEN last_activity_at IS NULL OR last_activity_at<=excluded.last_activity_at THEN excluded.last_activity_type ELSE last_activity_type END,last_activity_at=max(coalesce(last_activity_at,''),excluded.last_activity_at) WHERE last_seen_at IS NULL OR last_seen_at<=?`).bind(memberId,at,at,cutoff).run();
  return true;
 }catch(error){gates.set(key,now+60000);throw error;}
}
export async function recordAttempt(db,memberId,type,id,at){
 await db.batch([
  db.prepare('INSERT INTO student_activity_events(id,attempt_id,member_id,type,outcome,occurred_at) VALUES(?,?,?,?,?,?)').bind(id+':attempt',id,memberId,type,'attempt',at),
  db.prepare(`INSERT INTO student_activity_summary(member_id,last_submit_id,last_submit_at,last_submit_type,last_submit_outcome,last_activity_type,last_activity_at) VALUES(?,?,?,?,'pending',?,?) ON CONFLICT(member_id) DO UPDATE SET last_submit_id=excluded.last_submit_id,last_submit_at=excluded.last_submit_at,last_submit_type=excluded.last_submit_type,last_submit_outcome='pending',last_activity_type=CASE WHEN last_activity_at IS NULL OR last_activity_at<=excluded.last_activity_at THEN excluded.last_activity_type ELSE last_activity_type END,last_activity_at=max(coalesce(last_activity_at,''),excluded.last_activity_at) WHERE last_submit_at IS NULL OR last_submit_at<=excluded.last_submit_at`).bind(memberId,id,at,type,type,at)
 ]);
}
export async function recordOutcome(db,memberId,type,id,outcome,at){
 await db.batch([
  db.prepare('INSERT INTO student_activity_events(id,attempt_id,member_id,type,outcome,occurred_at) VALUES(?,?,?,?,?,?)').bind(id+':result',id,memberId,type,outcome,at),
  db.prepare('UPDATE student_activity_summary SET last_submit_outcome=?,last_activity_type=CASE WHEN last_activity_at IS NULL OR last_activity_at<=? THEN ? ELSE last_activity_type END,last_activity_at=max(coalesce(last_activity_at,\'\'),?) WHERE member_id=? AND last_submit_id=?').bind(outcome,at,type,at,memberId,id),
  ...(outcome==='success'?[]:[db.prepare("UPDATE student_activity_summary SET last_error_at=?,last_error_type=? WHERE member_id=? AND (last_error_at IS NULL OR last_error_at<=?)").bind(at,outcome,memberId,at)])
 ]);
}
export async function pruneActivity(db,now=Date.now()){
 await db.batch([
  db.prepare('DELETE FROM student_activity_events WHERE occurred_at<?').bind(iso(now-30*DAY)),
  db.prepare('UPDATE student_activity_summary SET last_error_at=NULL,last_error_type=NULL WHERE last_error_at<?').bind(iso(now-30*DAY)),
  db.prepare("DELETE FROM student_activity_summary WHERE coalesce(last_activity_at,last_seen_at,'')<?").bind(iso(now-90*DAY))
 ]);
}
export async function activityOverview(db){
 const started=await db.prepare('SELECT started_at FROM student_activity_settings WHERE id=1').first();
 // Assignment owners may still use the pre-login member recipient identity.
 const rows=await db.prepare(activityStudentsSql+' ORDER BY s.last_seen_at IS NULL,s.last_seen_at DESC,m.name,m.id').all();
 return {startedAt:started.started_at,serverNow:iso(Date.now()),eventRetentionDays:30,summaryRetentionDays:90,students:rows.results.map(r=>({id:r.id,name:r.name,active:!!r.active,lastSeenAt:r.last_seen_at,lastActivityType:r.last_activity_type,lastActivityAt:r.last_activity_at,assignmentViewAt:r.assignment_view_at,lastSubmitAt:r.last_submit_at,lastSubmitType:r.last_submit_type,lastSubmitOutcome:r.last_submit_outcome,lastErrorAt:r.last_error_at,lastErrorType:r.last_error_type,assignedCount:r.assigned_count,submittedCount:r.submitted_count,observation:activityObservation(r,started.started_at)}))};
}
