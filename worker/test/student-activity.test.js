import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../src/index.js';import{memberDatabase,memberToken,registerFixture}from'./member-fixture.js';import{SESSION_COOKIE}from'../src/security.js';
import{recordPresence,recordAttempt,recordOutcome,pruneActivity,activityOverview,errorOutcome,submissionType,scheduleActivity}from'../src/student-activity.js';
async function fixture(t){const f=memberDatabase();t.after(()=>f.sql.close());const env={DB:f.db,SESSION_SECRET:'activity-test'},tasks=[];const token=await memberToken(env,{sub:'activity-student',accessToken:'DO_NOT_STORE',exp:Date.now()+60000});const m=f.sql.prepare("SELECT * FROM members WHERE google_sub='activity-student'").get();return {...f,env,tasks,m,async send(path,method='GET',body,headers={}){const r=await worker.fetch(new Request('https://local.test'+path,{method,headers:{Cookie:SESSION_COOKIE+'='+token,Origin:'https://local.test','X-Editorial-CSRF':'1',...headers},...(body?{body}:{})}),env,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);return r;}};}
test('presence is written at most once per five minutes including a fresh isolate',async t=>{
 const f=await fixture(t),now=Date.now();await recordPresence(f.db,f.m.id,now);
 const changes=()=>f.sql.prepare('SELECT total_changes() n').get().n;const before=changes();
 for(let n=1;n<10;n++)assert.equal(await recordPresence(f.db,f.m.id,now+n),false);assert.equal(changes(),before);
 const fresh=await import('../src/student-activity.js?new-isolate='+crypto.randomUUID());assert.equal(await fresh.recordPresence(f.db,f.m.id,now+100),false);assert.equal(changes(),before);
 assert.equal(await recordPresence(f.db,f.m.id,now+300000),true);
});
test('attempt and result are exact, bounded categories and older completion cannot replace latest attempt',async t=>{
 const f=await fixture(t),at=new Date().toISOString();
 await recordAttempt(f.db,f.m.id,'article_submit','old',at);await recordAttempt(f.db,f.m.id,'photo_submit','new',at);
 await recordOutcome(f.db,f.m.id,'photo_submit','new','success',at);await recordOutcome(f.db,f.m.id,'article_submit','old','input_error',at);
 const row=f.sql.prepare('SELECT * FROM student_activity_summary').get();assert.equal(row.last_submit_id,'new');assert.equal(row.last_submit_outcome,'success');assert.equal(row.last_error_type,'input_error');
 const events=f.sql.prepare('SELECT * FROM student_activity_events').all();assert.equal(events.length,4);assert(!JSON.stringify(events).includes('DO_NOT_STORE'));assert.deepEqual([400,403,429,500].map(errorOutcome),['input_error','permission_error','rate_limit','server_error']);
 assert.equal(submissionType('/api/native/articles/a/submit','POST'),'article_submit');assert.equal(submissionType('/api/photos/upload','POST'),'photo_submit');assert.equal(submissionType('/api/photos/upload','GET'),null);
});
test('normal authenticated requests are not falsely recorded as Google logins',async t=>{
 const f=await fixture(t);assert.equal((await f.send('/api/session')).status,200);
 const row=f.sql.prepare('SELECT * FROM student_activity_summary').get();assert.equal(row.last_activity_type,'authenticated_request');assert(row.last_seen_at);
 assert.equal(f.sql.prepare('SELECT last_login_at FROM members WHERE id=?').get(f.m.id).last_login_at,null);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM student_activity_events').get().n,0);
});
test('student validation failures and actual server failures produce different outcomes',async t=>{
 const f=await fixture(t);const bad=new FormData();bad.set('photoType','feature');
 assert.equal((await f.send('/api/photos/upload','POST',bad)).status,400);
 assert.equal(f.sql.prepare("SELECT outcome FROM student_activity_events WHERE outcome!='attempt'").get().outcome,'input_error');
 const original=f.db.prepare.bind(f.db);f.db.prepare=q=>{if(q.includes('FROM articles a'))throw Error('PRIVATE DATABASE ERROR');return original(q);};
 const response=await f.send('/api/native/articles/missing/submit','POST');assert.equal(response.status,500);
 assert(f.sql.prepare("SELECT 1 FROM student_activity_events WHERE outcome='server_error'").get());
 assert(!JSON.stringify(f.sql.prepare('SELECT * FROM student_activity_events').all()).includes('PRIVATE'));
});
test('telemetry failure never changes a business response; no unauthenticated or CSRF attribution',async t=>{
 const f=await fixture(t);assert.equal((await f.send('/api/photos/upload','POST',null,{Cookie:''})).status,401);assert.equal((await f.send('/api/photos/upload','POST',null,{'X-Editorial-CSRF':''})).status,403);assert.equal(f.sql.prepare('SELECT count(*) n FROM student_activity_events').get().n,0);
 const original=f.db.prepare.bind(f.db);f.db.prepare=q=>{if(q.includes('student_activity'))throw Error('PRIVATE');return original(q);};
 assert.equal((await f.send('/api/session')).status,200);assert.equal((await f.send('/api/photos/upload','POST',new FormData())).status,400);
 await scheduleActivity({},()=>{throw Error('PRIVATE');});
});
test('admin-only overview distinguishes unknown history from no observed activity since launch',async t=>{
 const f=await fixture(t);assert.equal((await f.send('/api/admin/student-activity')).status,403);
 f.sql.prepare("UPDATE members SET last_login_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(f.m.id);
 f.sql.prepare('DELETE FROM student_activity_summary').run();
 const result=await activityOverview(f.db);assert.equal(result.students.find(s=>s.id===f.m.id).observation,'not_observed_since_launch');assert(!JSON.stringify(result).includes('@'));
 const admin=await memberToken(f.env,{sub:'activity-admin',exp:Date.now()+60000},'admin');const r=await f.send('/api/admin/student-activity','GET',null,{Cookie:SESSION_COOKIE+'='+admin});assert.equal(r.status,200);assert.match(r.headers.get('Cache-Control'),/no-store/);
});
test('retention deletes only expired observation data, preserving all member/business records',async t=>{
 const f=await fixture(t),now=Date.now(),old=new Date(now-100*86400000).toISOString();await recordAttempt(f.db,f.m.id,'photo_submit','expired',old);await recordOutcome(f.db,f.m.id,'photo_submit','expired','server_error',old);
 const before=f.sql.prepare('SELECT count(*) n FROM members').get().n;await pruneActivity(f.db,now);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM members').get().n,before);assert.equal(f.sql.prepare('SELECT count(*) n FROM student_activity_summary').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM student_activity_events').get().n,0);
});
test('real article submission and category photo handler both record successful outcomes',async t=>{
 const f=await fixture(t);
 const created=await f.send('/api/native/articles','POST',JSON.stringify({articleType:'school',titleKo:'격리 기사',titleEn:'',contentHtml:'<p>격리 원고</p>'}));assert.equal(created.status,201);const article=await created.json();
 assert.equal((await f.send('/api/native/articles/'+article.id+'/submit','POST')).status,200);
 f.env.DRIVE_UPLOAD_FOLDER_ID='fixture-folder';t.mock.method(globalThis,'fetch',async()=>Response.json({id:'fixture-drive-file',name:'fixture.png',mimeType:'image/png',size:'4'}));
 const form=new FormData();form.set('photoType','school');form.set('copyright','true');form.set('file',new File(['test'],'fixture.png',{type:'image/png'}));assert.equal((await f.send('/api/photos/upload','POST',form)).status,201);
 const events=f.sql.prepare("SELECT type,outcome FROM student_activity_events ORDER BY occurred_at").all();assert.equal(events.length,4);assert.equal(events.filter(r=>r.outcome==='success').length,2);
});
test('pre-login assignment recipients are counted without inventing a Google identity',async t=>{
 const f=await fixture(t);f.sql.exec(`INSERT INTO members(id,email,name,role,student_number,cohort,active,created_at,updated_at,changed_by) VALUES('pending-activity','h2612345@joongdong.hs.kr','미연결 학생','student','12345',36,1,'2026','2026','fixture');
 INSERT INTO assignment_campaigns(id,name,status,audience_mode,created_by_user_id,created_at,updated_at) VALUES('activity-campaign','격리 과제','active','selected','fixture','2026','2026');
 INSERT INTO assignment_slots(id,campaign_id,article_type,display_name,quantity,position,created_at,updated_at) VALUES('activity-slot','activity-campaign','school','학교',2,0,'2026','2026');
 INSERT INTO member_assignment_targets(campaign_id,member_id,assigned_at) VALUES('activity-campaign','pending-activity','2026');`);
 const result=await activityOverview(f.db),student=result.students.find(s=>s.id==='pending-activity');assert.equal(student.assignedCount,2);assert.equal(student.submittedCount,0);assert.equal(student.observation,'no_login_record');assert.equal(f.sql.prepare("SELECT google_sub FROM members WHERE id='pending-activity'").get().google_sub,null);
 assert.equal((await f.send('/api/activity/assignment-view','POST')).status,204);assert.equal(f.sql.prepare('SELECT assignment_view_at FROM student_activity_summary WHERE member_id=?').get(f.m.id).assignment_view_at,null);
 f.sql.prepare("INSERT INTO assignment_recipients(campaign_id,student_id,student_name,assigned_at) VALUES('activity-campaign','activity-student','격리 학생','2026')").run();
 f.sql.prepare("INSERT INTO assignment_slot_instances(id,campaign_id,slot_id,student_id,ordinal,created_at,updated_at) VALUES('activity-instance','activity-campaign','activity-slot','activity-student',1,'2026','2026')").run();
 assert.equal((await f.send('/api/activity/assignment-view','POST')).status,204);assert(f.sql.prepare('SELECT assignment_view_at FROM student_activity_summary WHERE member_id=?').get(f.m.id).assignment_view_at);
});
