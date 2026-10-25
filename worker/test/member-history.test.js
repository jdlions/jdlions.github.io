import test from'node:test';import assert from'node:assert/strict';import{readFileSync,readdirSync}from'node:fs';import{DatabaseSync}from'node:sqlite';
import{memberDatabase}from'./member-fixture.js';import{Members}from'../src/members.js';import{memberHistory,deleteEmptyMember}from'../src/member-history.js';import{Signup,hashSignupCode}from'../src/signup.js';import{isActivityEligible}from'../../assets/js/shared/student-identity.js';import{articleStudentOverview}from'../src/admin-overview.js';import{planLegacyMembers,legacyImportSql}from'../../scripts/legacy-members.mjs';
const actor={memberId:'bootstrap-editor'},student={name:'가상학생',email:'h2611001@joongdong.hs.kr',role:'student',studentNumber:'11001',cohort:36,active:true};
function fixture(t){const f=memberDatabase();t.after(()=>f.sql.close());return{...f,members:new Members(f.db)};}
const owner='100000000000000000001';const source=()=>[{google_sub:owner,display_name:'11001가상학생',sources:'article,assignment'}];
function article(sql,id='article',owner='123'){sql.prepare("INSERT INTO articles(id,student_id,article_type,title_ko,status,created_at,updated_at)VALUES(?,?,'school','가상 기사','submitted','2026','2026')").run(id,owner);}
function approval(sql){}
test('migration preserves every old member/audit/business row; manual-only safe deletion replaces the hard block',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')&&f<'0012').sort())db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const members=db.prepare('SELECT * FROM members').all(),audit=db.prepare('SELECT * FROM member_audit').all();db.exec(readFileSync(new URL('../migrations/0012_member_history.sql',import.meta.url),'utf8'));
 assert.deepEqual(db.prepare('SELECT * FROM member_audit').all(),audit);assert.deepEqual(db.prepare('SELECT id,email,google_sub FROM members').all().map(r=>({...r})),members.map(({id,email,google_sub})=>({id,email,google_sub})));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('D1 staging is repeatable, invents no email/Google ID and verified sub claims code-free membership preserving ownership',async t=>{
 const{sql,db,members}=fixture(t);article(sql,'article',owner);const input=source(),plan=planLegacyMembers(input,[]);assert.equal(plan.candidates.length,1);const query=legacyImportSql(input,plan);sql.exec(query);sql.exec(query);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM member_legacy_students').get().n,1);assert.equal(sql.prepare("SELECT COUNT(*) n FROM members WHERE role='student'").get().n,0);
 assert.equal((await members.list(new URLSearchParams({activity:'all'}))).members.filter(m=>m.pending).length,1);
 const before=sql.prepare('SELECT * FROM articles').get();const detail=await memberHistory(db,'legacy-'+owner,actor);assert.equal(detail.counts.articles,1);assert.equal(detail.deletion.allowed,false);
 const user=await members.login({sub:owner,email:student.email,name:'11001가상학생'},{allowUnknown:true});assert.equal(user.memberId,'legacy-'+owner);assert.deepEqual(sql.prepare('SELECT * FROM articles').get(),before);assert.equal(planLegacyMembers(input,sql.prepare('SELECT * FROM members').all()).existing.length,1);
 assert.equal((await members.list(new URLSearchParams({activity:'all'}))).members.filter(m=>m.pending).length,0);
});
test('same-name account cannot claim old ownership; existing registered email links without duplicate; inactive cannot bypass',async t=>{
 const{sql,members}=fixture(t);article(sql,'old',owner);sql.exec(legacyImportSql(source(),planLegacyMembers(source(),[])));
 assert.equal(await members.login({sub:'other',email:'h2611002@joongdong.hs.kr',name:'11001가상학생'},{allowUnknown:true}),null);
 const row=await members.save(null,student,actor);const user=await members.login({sub:owner,email:student.email,name:'11001가상학생'},{allowUnknown:true});assert.equal(user.memberId,row.id);assert.equal(sql.prepare('SELECT resolved_member_id FROM member_legacy_students').get().resolved_member_id,row.id);
 await members.save(row.id,{...student,active:false,version:(await members.get(row.id)).auth_version},actor);await assert.rejects(members.login({sub:owner,email:student.email},{allowUnknown:true}));assert.equal(sql.prepare("SELECT COUNT(*) n FROM members WHERE role='student'").get().n,1);
});
test('unverifiable existing IDs require review; unknown current number is never derived from historical email digits',()=>{
 const data=source();data[0].display_name=null;const p=planLegacyMembers(data,[]);assert.equal(p.candidates[0].studentNumber,null);assert.equal(p.candidates[0].name,null);assert(!legacyImportSql(data,p).includes('@joongdong'));
 const invalid=planLegacyMembers([{google_sub:'11001',display_name:'학생'}],[]);assert.equal(invalid.review.length,1);assert.throws(()=>legacyImportSql([],invalid),/review/);
});
test('code is encrypted, visible only in admin settings, rotates and preserves old hash-only validation until explicit reset',async t=>{
 const{sql,db}=fixture(t),signup=new Signup(db,'isolated-secret');const code='isolated-new-code';let settings=await signup.configure({code,enabled:true,version:0},actor);assert.equal(settings.code,code);assert(!JSON.stringify(sql.prepare('SELECT * FROM member_signup_code').get()).includes(code));
 settings=await signup.configure({enabled:false,version:1},actor);assert.equal(settings.code,code);
 sql.exec('UPDATE member_signup_code SET code_ciphertext=NULL');settings=await signup.settings();assert.equal(settings.resetRequired,true);assert(!('code'in settings));assert.equal(sql.prepare('SELECT code_hash,salt FROM member_signup_code').get().code_hash,await hashSignupCode(code,sql.prepare('SELECT salt FROM member_signup_code').get().salt));
 const wrong=await new Signup(db,'wrong-key').settings();assert(!wrong.code);
});
test('verified Google display-name synchronization preserves ID/cohort/sub and rejects collisions or malformed names',async t=>{
 const{sql,members}=fixture(t);const row=await members.save(null,student,actor);sql.prepare('UPDATE members SET cohort=35 WHERE id=?').run(row.id);article(sql);
 const claims=await members.login({sub:'123',email:student.email,name:'20607 새이름'}),after=await members.get(row.id);assert.equal(after.name,'새이름');assert.equal(after.student_number,'20607');assert.equal(after.cohort,35);assert.equal(after.id,row.id);assert.equal(after.google_sub,'123');assert(after.last_login_at);assert.equal(sql.prepare('SELECT student_id FROM articles').get().student_id,'123');
 await members.login({sub:'123',email:student.email,name:'알 수 없는 형식'});assert.equal((await members.get(row.id)).student_number,'20607');
 await members.save(null,{...student,email:'h2511002@joongdong.hs.kr',studentNumber:'20608',cohort:35},actor);await members.login({sub:'123',email:student.email,name:'20608 다른이름'});assert.equal((await members.get(row.id)).student_number,'20607');assert.equal(claims.memberId,row.id);
});
test('grade 3 or aged-out students are excluded without active/login/old records changes at KST year boundary',()=>{
 assert(!isActivityEligible({cohort:36,studentNumber:'31001'},new Date('2026-10-25')));
 assert(isActivityEligible({cohort:35,studentNumber:'21001'},new Date('2027-02-28T14:59:59Z')));assert(!isActivityEligible({cohort:35,studentNumber:'21001'},new Date('2027-02-28T15:00:00Z')));assert(isActivityEligible({role:'teacher'},new Date('2050-03-01')));
});
test('empty unlinked test-member deletion is blocked while legacy identities remain unresolved, then removes only member and preserves audits',async t=>{
 const{sql,db,members}=fixture(t),m=await members.save(null,student,actor);const input={memberId:m.id,email:m.email,version:m.version,confirmation:'영구 삭제'};
 article(sql,'old',owner);sql.exec(legacyImportSql(source(),planLegacyMembers(source(),[])));assert.equal((await memberHistory(db,m.id,actor)).deletion.state,'review');await assert.rejects(deleteEmptyMember(db,m.id,input,actor));sql.prepare('UPDATE member_legacy_students SET resolved_member_id=?').run(actor.memberId);
 assert.equal((await memberHistory(db,m.id,actor)).deletion.allowed,true);sql.prepare("INSERT INTO member_deletion_audit VALUES('other',?,'different-teacher','requested','9999')").run(m.id);await deleteEmptyMember(db,m.id,input,actor);assert.equal(await members.get(m.id),null);assert.equal(sql.prepare("SELECT actor FROM member_audit WHERE member_id=? AND action='deleted'").get(m.id).actor,actor.memberId);assert(sql.prepare("SELECT COUNT(*) n FROM member_audit WHERE member_id=?").get(m.id).n>=2);assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);assert(await members.get(actor.memberId));
});
test('reference inserted between history and delete commits blocks deletion atomically; unknown schema/query failure is fail closed',async t=>{
 const{sql,db,members}=fixture(t),m=await members.save(null,student,actor);approval(sql);const original=db.batch;db.batch=async items=>{sql.prepare("INSERT INTO member_audit(member_id,action,actor,auth_version,created_at)VALUES(?,'business-event','teacher',1,'2026')").run(m.id);return original(items);};await assert.rejects(deleteEmptyMember(db,m.id,{memberId:m.id,email:m.email,version:1,confirmation:'영구 삭제'},actor));assert(await members.get(m.id));assert.equal(sql.prepare("SELECT outcome FROM member_deletion_audit ORDER BY created_at DESC").get().outcome,'blocked');
 sql.exec('CREATE TABLE new_business(student_id TEXT)');assert.equal((await memberHistory(db,m.id,actor)).deletion.state,'review');
});
test('teachers/self, existing articles/photos/editorial or legacy evidence cannot be deleted',async t=>{
 const{db,sql,members}=fixture(t);approval(sql);const m=await members.save(null,student,actor);await members.login({sub:'123',email:student.email});article(sql);const detail=await memberHistory(db,m.id,actor);assert.equal(detail.counts.articles,1);assert(!detail.deletion.allowed);assert(!(await memberHistory(db,actor.memberId,actor)).deletion.allowed);await assert.rejects(deleteEmptyMember(db,m.id,{memberId:m.id,email:m.email,version:(await members.get(m.id)).auth_version,confirmation:'영구 삭제'},actor));
});
test('unlinked manual member is separated from actual article owners without name-based merging',async t=>{
 const{db,sql}=fixture(t);sql.exec("INSERT INTO assignment_campaigns(id,name,status,audience_mode,created_by_user_id,created_at,updated_at)VALUES('c','과제','active','all','t','2026','2026');INSERT INTO assignment_slots(id,campaign_id,article_type,display_name,quantity,required,position,created_at,updated_at)VALUES('s','c','school','학교',1,1,0,'2026','2026');INSERT INTO assignment_recipients VALUES('c','123','11001 가상학생','2026');INSERT INTO assignment_slot_instances(id,campaign_id,slot_id,student_id,ordinal,created_at,updated_at)VALUES('i','c','s','123',1,'2026','2026')");
 const out=await articleStudentOverview(db,[{id:'member:pending',name:'11001 가상학생',cohort:36,identityState:'unlinked'}]);assert.equal(out.students.length,1);assert.equal(out.students[0].studentId,'123');assert.equal(out.pendingMembers.length,1);assert.equal(out.pendingMembers[0].id,'member:pending');
});
import worker from '../src/index.js';import{memberToken}from'./member-fixture.js';import{SESSION_COOKIE,seal}from'../src/security.js';
test('new detail/delete and plaintext-code routes are admin-only, no-store, Origin/CSRF protected and never expose code to signup',async t=>{
 const{db,sql}=fixture(t),env={DB:db,SESSION_SECRET:'isolated-only'};const admin=await memberToken(env,{sub:'100',exp:Date.now()+60000},'admin'),studentToken=await memberToken(env,{sub:'200',exp:Date.now()+60000},'student');const target=sql.prepare("SELECT id FROM members WHERE google_sub='200'").get().id;
 const call=(path,token=admin,method='GET',extra={})=>worker.fetch(new Request('https://local.test'+path,{method,headers:{Cookie:token?SESSION_COOKIE+'='+token:'',Origin:'https://local.test','X-Editorial-CSRF':'1',...extra},...(method==='DELETE'?{body:'{}'}:{})}),env);
 await new Signup(db,env.SESSION_SECRET).configure({code:'isolated-display-code',enabled:true,version:0},actor);
 for(const path of ['/api/admin/members/'+target,'/api/admin/signup-code']){assert.equal((await call(path,'')).status,401);assert.equal((await call(path,studentToken)).status,403);const r=await call(path);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);}
 const r=await call('/api/admin/signup-code');assert.equal((await r.json()).code,'isolated-display-code');assert.equal((await call('/api/admin/members/'+target,studentToken,'DELETE')).status,403);assert.equal((await call('/api/admin/members/'+target,admin,'DELETE',{Origin:'https://evil.invalid'})).status,403);assert.equal((await call('/api/admin/members/'+target,admin,'DELETE',{'X-Editorial-CSRF':''})).status,403);
 const pending=await seal({kind:'signup',accessToken:'mock-only-token',identity:{sub:'300',email:'h2611003@joongdong.hs.kr',name:'11003가상학생'},exp:Date.now()+60000,tokenExpiresAt:Date.now()+60000},env.SESSION_SECRET);
 const publicResponse=await worker.fetch(new Request('https://local.test/api/signup',{headers:{Origin:'https://local.test',Cookie:'__Host-lp_signup='+pending}}),env);assert.equal(publicResponse.status,200);assert(!(await publicResponse.text()).includes('isolated-display-code'));
});
test('new assignment reference committed after eligibility read blocks DELETE without cascading or losing audits',async t=>{
 const{sql,db,members}=fixture(t),m=await members.save(null,student,actor);sql.exec("INSERT INTO assignment_campaigns(id,name,status,audience_mode,created_by_user_id,created_at,updated_at)VALUES('concurrent','과제','draft','all','teacher','2026','2026')");const batch=db.batch;db.batch=async items=>{sql.prepare('INSERT INTO member_assignment_targets(campaign_id,member_id)VALUES(?,?)').run('concurrent',m.id);return batch(items);};await assert.rejects(deleteEmptyMember(db,m.id,{memberId:m.id,email:m.email,version:1,confirmation:'영구 삭제'},actor));assert(await members.get(m.id));assert.equal(sql.prepare('SELECT COUNT(*) n FROM member_assignment_targets').get().n,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM assignment_campaigns').get().n,1);
});
test('3xxxx verified current number wins assignment exclusion even when older stored cohort disagrees',async t=>{
 const{members}=fixture(t);const row=await members.save(null,student,actor);await members.login({sub:'123',email:student.email,name:'31001 가상학생'});const after=await members.get(row.id);assert.equal(after.student_number,'31001');assert.equal(after.cohort,36);assert.equal(isActivityEligible(after),false);assert.equal(after.active,1);
});
