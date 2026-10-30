import{createHash}from'node:crypto';
import{studentProfile}from'../assets/js/shared/signup-identity.js';
export const existingStudentSql=`WITH owners AS (
 SELECT student_google_id google_sub,'classroom' source FROM article_edits
 UNION SELECT student_id,'article' FROM articles
 UNION SELECT student_id,'assignment' FROM assignment_recipients
) SELECT google_sub,GROUP_CONCAT(DISTINCT source) sources,
 (SELECT student_name FROM assignment_recipients r WHERE r.student_id=o.google_sub ORDER BY assigned_at DESC,campaign_id DESC LIMIT 1) display_name
 FROM owners o GROUP BY google_sub ORDER BY google_sub`;
export function planLegacyMembers(source,members){
 const existing=[],candidates=[],review=[];
 for(const row of new Map(source.map(r=>[r.google_sub,r])).values()){
  if(!/^\d{10,30}$/.test(row.google_sub)){review.push({identity:row.google_sub,reason:'Google ID로 확정할 수 없는 기존 식별자'});continue;}
  const found=members.filter(m=>m.google_sub===row.google_sub);if(found.length===1){existing.push({id:found[0].id});continue;}if(found.length>1){review.push({identity:row.google_sub,reason:'중복 Google ID'});continue;}
  const p=studentProfile(row.display_name),knownName=row.display_name?p.name:null;
  candidates.push({google_sub:row.google_sub,name:knownName,studentNumber:p.studentNumber||null,sources:row.sources});
 }
 return {owners:source.length,existing,candidates,review,complete:review.length===0};
}
const q=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
export function legacyImportSql(source,plan,now=new Date()){
 if(!plan.complete)throw Error('resolve_identity_review_before_import');
 const stamp=now.toISOString(),fingerprint=createHash('sha256').update(JSON.stringify(source)).digest('hex');
 const out=['-- PRIVATE staging plan. Explicit production approval required.','-- Google IDs come only from current D1 ownership. Never invent school email addresses.',`-- Source fingerprint: ${fingerprint}`];
 for(const c of plan.candidates)out.push(`INSERT INTO member_legacy_students(google_sub,name,student_number,imported_at) SELECT ${q(c.google_sub)},${q(c.name)},${q(c.studentNumber)},${q(stamp)} WHERE NOT EXISTS(SELECT 1 FROM members WHERE google_sub=${q(c.google_sub)}) AND (EXISTS(SELECT 1 FROM articles WHERE student_id=${q(c.google_sub)}) OR EXISTS(SELECT 1 FROM article_edits WHERE student_google_id=${q(c.google_sub)}) OR EXISTS(SELECT 1 FROM assignment_recipients WHERE student_id=${q(c.google_sub)})) ON CONFLICT(google_sub) DO NOTHING;`);
 return out.join('\n')+'\n';
}
