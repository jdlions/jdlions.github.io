import{identityReferences}from'./member-references.js';
import{Members}from'./members.js';
import{academicYear}from'../../assets/js/shared/student-identity.js';
const failure=(message,status=409,code='member_history_protected')=>Object.assign(new Error(message),{status,code});
const rows=async(db,q,args=[]) => (await db.prepare(q).bind(...args).all()).results;
export async function memberHistory(db,id,actor,page=0){
 db=typeof db.withSession==='function'?db.withSession('first-primary'):db;
 let m=await new Members(db).get(id);if(!m&&id.startsWith('legacy-')){const c=await db.prepare('SELECT * FROM member_legacy_students WHERE google_sub=? AND resolved_member_id IS NULL').bind(id.slice(7)).first();if(c)m={id,name:c.name||'이름 확인 필요',email:null,google_sub:c.google_sub,student_number:c.student_number,cohort:null,role:'student',active:1,auth_version:0,created_at:c.imported_at,updated_at:c.imported_at,pending:true};}if(!m)throw failure('회원을 찾을 수 없습니다.',404,'member_not_found');
 if(!Number.isInteger(page)||page<0||page>100000)throw failure('잘못된 기록 페이지입니다.',400,'invalid_history_page');
 const keys=[...new Set([m.id,m.email,'member:'+m.id,...(m.google_sub?[m.google_sub,'oauth:'+m.google_sub,'signup:'+m.google_sub]:[])].filter(Boolean))];
 const keySql=keys.map(()=>'(?)').join(',');
 const checks=Object.entries(identityReferences).map(([table,columns])=>`SELECT '${table}' tableName,COUNT(*) n FROM ${table} WHERE ${columns.map(c=>`${c} IN (SELECT value FROM identity_keys)`).join(' OR ')}`).join(' UNION ALL ');
 const references=Object.fromEntries((await rows(db,`WITH identity_keys(value) AS (VALUES ${keySql}) ${checks}`,keys)).map(r=>[r.tableName,Number(r.n)]));
 // Check unknown identity columns in one schema query; schema changes fail closed.
 const columns=await rows(db,"SELECT m.name tableName,p.name columnName FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%'");
 const special=new Set(['members','member_audit','member_deletion_audit','member_legacy_students']);
 let uncertain=columns.some(c=>!special.has(c.tableName)&&!['slack_user_id','owner_slack_user_id'].includes(c.columnName)&&/(?:^|_)(student_id|google_id|google_sub|user_id|member_id|actor_id|owner_id|updated_by|created_by|uploaded_by)$/.test(c.columnName)&&!identityReferences[c.tableName]?.includes(c.columnName));
 const unresolved=Number((await db.prepare('SELECT COUNT(*) n FROM member_legacy_students WHERE resolved_member_id IS NULL').first()).n);
 const audit=Number((await db.prepare("SELECT COUNT(*) n FROM member_audit WHERE (member_id=? AND action!='registered') OR actor IN (?,?,?,?)").bind(m.id,m.id,m.google_sub,'oauth:'+m.google_sub,'signup:'+m.google_sub).first()).n);
 const external=Number((await db.prepare('SELECT COUNT(*) n FROM member_legacy_students WHERE resolved_member_id=? OR google_sub=?').bind(m.id,m.google_sub).first()).n);
 uncertain ||= unresolved>0||!!m.pending;
 const groups={
  articles:{sql:'SELECT id,title_ko title,title_en titleEn,status,created_at date,article_type articleType FROM articles WHERE student_id=?',args:[m.google_sub]},
  classroom:{sql:"SELECT submission_id id,'Classroom 제출물' title,status,created_at date FROM article_edits WHERE student_google_id=?",args:[m.google_sub]},
  assignments:{sql:"SELECT i.id,c.name title,COALESCE(a.status,'미제출') status,i.created_at date,i.article_id articleId,c.id campaignId FROM assignment_slot_instances i JOIN assignment_campaigns c ON c.id=i.campaign_id LEFT JOIN articles a ON a.id=i.article_id WHERE i.student_id=? UNION SELECT c.id,c.name,'로그인 전 배정',t.assigned_at,NULL,c.id FROM member_assignment_targets t JOIN assignment_campaigns c ON c.id=t.campaign_id WHERE t.member_id=? AND NOT EXISTS(SELECT 1 FROM assignment_recipients r WHERE r.campaign_id=t.campaign_id AND r.student_id=?)",args:[m.google_sub,m.id,m.google_sub]},
  submissions:{sql:"SELECT r.id,r.title_ko title,r.revision_kind status,r.created_at date,r.article_id articleId FROM article_revisions r JOIN articles a ON a.id=r.article_id WHERE a.student_id=? AND r.author_role='student' AND r.revision_kind IN ('submission','resubmission')",args:[m.google_sub]},
  photos:{sql:'SELECT id,filename title,status,created_at date,article_id articleId FROM photos WHERE student_google_id=?',args:[m.google_sub]},
  editorial:{sql:'SELECT id,normalized_filename title,state status,created_at date FROM editorial_versions WHERE user_id=?',args:[m.google_sub]}
 };
 const activities={},counts={};
 for(const[k,g]of Object.entries(groups)){
  counts[k]=Number((await db.prepare(`SELECT COUNT(*) n FROM (${g.sql})`).bind(...g.args).first()).n);
  activities[k]=await rows(db,`SELECT * FROM (${g.sql}) ORDER BY date DESC,id DESC LIMIT 50 OFFSET ?`,[...g.args,page*50]);
 }
 counts.published=Number((await db.prepare("SELECT COUNT(*) n FROM articles WHERE student_id=? AND status='scheduled'").bind(m.google_sub).first()).n);
 const reasons=[];
 if(m.role!=='student'||m.id===actor.memberId)reasons.push('교사 또는 현재 로그인한 본인 계정');
 if(Object.values(references).some(Boolean)||audit||external)reasons.push('연결된 업무 또는 보존 대상 감사 기록');
 if(uncertain)reasons.push('기존 학생 이메일 연결 대기 또는 알 수 없는 참조 관계');
 const registration=await db.prepare("SELECT actor FROM member_audit WHERE member_id=? AND action='registered' ORDER BY id LIMIT 1").bind(m.id).first();
 const grade=m.cohort?academicYear()-1990-m.cohort+1:null;
 return {member:{pending:!!m.pending,id:m.id,name:m.name,email:m.email,role:m.role,studentNumber:m.student_number,cohort:m.cohort,active:!!m.active,linked:!!m.google_sub,createdAt:m.created_at,updatedAt:m.updated_at,lastLoginAt:m.last_login_at,registration:registration?.actor.startsWith('signup:')?'코드 가입':registration?.actor.startsWith('legacy:')?'기존 학생 사전 등록':registration?.actor.startsWith('migration:')?'초기 관리자 이전':registration?'관리자 등록':'등록 방식 확인 필요',version:m.auth_version,grade},counts,activities,page,hasMore:Object.values(counts).some(n=>n>(page+1)*50),references,deletion:{allowed:!reasons.length,state:reasons.length?(uncertain?'review':'blocked'):'eligible',reasons},legacyComplete:unresolved===0};
}
export async function deleteEmptyMember(db,id,input,actor){
 const m=await new Members(db).get(id);if(!m)throw failure('회원을 찾을 수 없습니다.',404,'member_not_found');
 const auditId=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO member_deletion_audit VALUES(?,?,?,'requested',?)").bind(auditId,id,actor.memberId,now).run();
 try{
  if(input?.confirmation!=='영구 삭제'||input.memberId!==id||input.email!==m.email||input.version!==m.auth_version||id===actor.memberId||m.role!=='student')throw failure('대상 이메일, 회원 ID와 영구 삭제 확인을 확인해 주세요.');
  if(!(await memberHistory(db,id,actor)).deletion.allowed)throw failure('연결 기록이 있거나 확인이 끝나지 않아 삭제할 수 없습니다.');
  // D1 batch is atomic; BEFORE DELETE rechecks every business reference at commit.
  const out=await db.batch([db.prepare("UPDATE member_deletion_audit SET outcome='deleted' WHERE id=?").bind(auditId),db.prepare("DELETE FROM members WHERE id=? AND role='student' AND auth_version=? AND email=?").bind(id,input.version,input.email)]);
  if((out[1].meta?.changes??out[1].changes)!==1)throw failure('회원이 변경되었습니다. 다시 확인해 주세요.');
  return {id,deleted:true};
 }catch(e){await db.prepare("UPDATE member_deletion_audit SET outcome='blocked' WHERE id=?").bind(auditId).run();if(e.status)throw e;throw failure('참조 기록을 안전하게 확인할 수 없어 삭제하지 않았습니다.');}
}
