import test from 'node:test';import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions}from'miniflare';import{memberDatabase}from'./member-fixture.js';
import{recordPresence,recordAttempt,recordOutcome,activityOverview,pruneActivity}from'../src/student-activity.js';
test('activity schema, atomic batches, aggregation and retention run on isolated real workerd D1',async t=>{
 const f=memberDatabase();t.after(()=>f.sql.close());
 const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-08-01',script:'export default{fetch(){return new Response("isolated activity preview")}}',d1Databases:['DB']}));t.after(()=>runtime.dispose());const db=await runtime.getD1Database('DB');
 for(const{sql}of f.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all())await db.prepare(sql).run();
 await db.prepare("INSERT INTO member_cohorts VALUES(36,'2026')").run();
 await db.prepare("INSERT INTO members(id,email,name,role,student_number,cohort,active,created_at,updated_at,changed_by)VALUES('activity-preview','h2611001@joongdong.hs.kr','격리 학생','student','11001',36,1,'2026','2026','fixture')").run();
 const now=Date.now(),at=new Date(now).toISOString();await db.prepare('INSERT INTO student_activity_settings VALUES(1,?)').bind(at).run();
 await recordPresence(db,'activity-preview',now);await recordAttempt(db,'activity-preview','photo_submit','runtime-attempt',at);await recordOutcome(db,'activity-preview','photo_submit','runtime-attempt','success',at);
 const result=await activityOverview(db);assert.equal(result.students.length,1);assert.equal(result.students[0].lastSubmitOutcome,'success');assert.equal(result.students[0].observation,'observed');
 await pruneActivity(db,now+100*86400000);assert.equal((await db.prepare('SELECT count(*) n FROM student_activity_events').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM members').first()).n,1);
});
