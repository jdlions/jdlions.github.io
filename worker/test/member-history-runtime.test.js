import test from'node:test';import assert from'node:assert/strict';
import{Miniflare,convertV4MiniflareOptions}from'miniflare';
import{memberDatabase}from'./member-fixture.js';import{memberHistory,deleteEmptyMember}from'../src/member-history.js';
test('member history schema inspection, reference SQL and guarded deletion run on real workerd D1',async t=>{
 const fixture=memberDatabase();t.after(()=>fixture.sql.close());
 const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-08-01',script:'export default {fetch(){return new Response("isolated D1 fixture")}}',d1Databases:['DB']}));t.after(()=>runtime.dispose());const db=await runtime.getD1Database('DB');
 for(const{sql}of fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all())await db.prepare(sql).run();
 for(const{sql}of fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' ORDER BY rowid").all())await db.prepare(sql).run();
 await db.prepare("INSERT INTO members(id,email,name,role,created_at,updated_at,changed_by)VALUES('bootstrap-editor','editor@joongdong.hs.kr','가상 관리자','teacher','2026','2026','fixture')").run();
 await db.prepare("INSERT INTO member_cohorts VALUES(36,'2026')").run();
 await db.prepare("INSERT INTO members(id,email,name,role,student_number,cohort,active,created_at,updated_at,changed_by)VALUES('empty','h2611001@joongdong.hs.kr','가상 학생','student','11001',36,1,'2026','2026','bootstrap-editor')").run();
 const actor={memberId:'bootstrap-editor'},detail=await memberHistory(db,'empty',actor);assert.equal(detail.deletion.allowed,true,JSON.stringify({deletion:detail.deletion,tables:(await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results}));assert.equal(detail.counts.articles,0);
 await deleteEmptyMember(db,'empty',{memberId:'empty',email:'h2611001@joongdong.hs.kr',version:1,confirmation:'영구 삭제'},actor);assert.equal(await db.prepare("SELECT id FROM members WHERE id='empty'").first(),null);assert.equal((await db.prepare("SELECT COUNT(*) n FROM member_audit WHERE member_id='empty'").first()).n,2);
});
