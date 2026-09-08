import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {D1EditorialRepository} from '../src/repository.js';
import worker from '../src/index.js';
import {seal,SESSION_COOKIE} from '../src/security.js';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const db={prepare(query){return {bind(...args){const stmt=sql.prepare(query);return {first:async()=>stmt.get(...args),all:async()=>({results:stmt.all(...args)}),run:async()=>stmt.run(...args)};}};},async batch(items){sql.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,db,repo:new D1EditorialRepository(db)};
}
async function seeded(){
 const f=fixture(),campaign=await f.repo.createCampaign({name:'과제',year:2026,issueLabel:'',issueId:null,instructions:'',startsAt:null,dueAt:null,audienceMode:'all',recipientStudentIds:[],slots:[{articleType:'school',displayName:'학교',required:true,quantity:2,dueAt:null,instructions:''}]},'teacher');
 await f.repo.distributeCampaign(campaign,[{id:'student',name:'Student'}]);
 const instance=await f.repo.getAssignmentInstance(f.sql.prepare('SELECT id FROM assignment_slot_instances LIMIT 1').get().id);
 const article=await f.repo.createArticleForAssignment(instance,'student');
 await f.repo.submitNativeArticle(article,'student');
 await f.repo.saveEditorDraft(article,{contentHtml:'editor',studentFeedback:'feedback'},'teacher');
 await f.repo.createPhoto({issueId:'legacy',articleSubmissionId:article.id,articleId:article.id,studentGoogleId:'student',driveFileId:'keep-drive',filename:'photo.jpg',mimeType:'image/jpeg',byteSize:1,caption:'',photographer:'',sourceType:'',rightsConfirmed:true});
 return {...f,campaign,article,instance};
}
const snapshot=sql=>Object.fromEntries(['articles','article_revisions','article_feedback','photos','assignment_campaigns','assignment_slots','assignment_recipients','assignment_targets','assignment_slot_instances','article_edits','issues'].map(t=>[t,sql.prepare('SELECT * FROM '+t).all()]));
for(const status of ['draft','submitted','reviewing','revision_requested','hold','approved','scheduled'])test('delete only selected '+status+' article and dependents, preserving assignment',async()=>{
 const f=await seeded(),other=await f.repo.createNativeArticle({articleType:'school',titleKo:'other',titleEn:'',contentHtml:'other'},'student');
 await f.repo.submitNativeArticle(other,'student');
 await f.repo.saveEditorDraft(other,{contentHtml:'keep',studentFeedback:'keep'},'teacher');
 await f.repo.createPhoto({issueId:'native',articleSubmissionId:other.id,articleId:other.id,studentGoogleId:'student',driveFileId:'same-drive',filename:'keep',mimeType:'image/jpeg',byteSize:1,caption:'',photographer:'',sourceType:'',rightsConfirmed:true});
 f.sql.prepare('UPDATE articles SET status=? WHERE id=?').run(status,f.article.id);
 f.sql.prepare("INSERT INTO article_edits(submission_id,issue_id,course_id,course_work_id,student_google_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(f.article.id,'legacy','course','work','student','now','now');
 const before=snapshot(f.sql);
 await f.repo.deleteNativeArticle(f.article.id);
 const after=snapshot(f.sql);
 for(const table of ['articles','article_revisions','article_feedback','photos'])assert.deepEqual(after[table],before[table].filter(x=>(table==='articles'?x.id:x.article_id)!==f.article.id));
 for(const table of ['assignment_campaigns','assignment_slots','assignment_recipients','assignment_targets','article_edits','issues'])assert.deepEqual(after[table],before[table]);
 assert.deepEqual(after.assignment_slot_instances,before.assignment_slot_instances.map(x=>Object.assign(Object.create(null),x,{article_id:x.article_id===f.article.id?null:x.article_id})));
 assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
 const instance=await f.repo.getAssignmentInstance(f.instance.id);
 assert.ok(await f.repo.createArticleForAssignment(instance,'student'));
 f.sql.close();
});
test('orphan draft after assignment deletion, standalone draft, repeat and missing deletion',async()=>{
 const f=await seeded();await f.repo.deleteCampaign(f.campaign.id);
 f.sql.prepare("UPDATE articles SET status='draft' WHERE id=?").run(f.article.id);
 await f.repo.deleteNativeArticle(f.article.id);
 const standalone=await f.repo.createNativeArticle({articleType:'school',titleKo:'standalone',titleEn:'',contentHtml:''},'other-student');
 await f.repo.deleteNativeArticle(standalone.id);
 for(const id of [f.article.id,'missing'])await assert.rejects(f.repo.deleteNativeArticle(id),e=>e.status===404);
 for(const table of ['articles','article_revisions','article_feedback','photos'])assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 f.sql.close();
});
test('failure rolls back all dependency deletion and assignment detachment',async()=>{
 const f=await seeded(),before=snapshot(f.sql);
 f.sql.exec("CREATE TRIGGER reject_article_delete BEFORE DELETE ON articles BEGIN SELECT RAISE(ABORT,'test failure'); END");
 await assert.rejects(f.repo.deleteNativeArticle(f.article.id));
 assert.deepEqual(snapshot(f.sql),before);f.sql.close();
});
test('HTTP admin/confirmation/CSRF/origin enforcement and Drive preservation',async()=>{
 const f=await seeded(),original=globalThis.fetch,env={DB:f.db,SESSION_SECRET:'test-secret',NEWSPAPER_CLASSROOM_ID:'test'};
 const calls=[];let student=false;
 globalThis.fetch=async url=>{calls.push(String(url));return student&&String(url).includes('/teachers/')?new Response('{}',{status:404}):new Response(JSON.stringify({id:'person',userId:'person'}));};
 try{
  const cookie=async sub=>SESSION_COOKIE+'='+await seal({sub,courseId:'test',exp:Date.now()+60000,accessToken:'test'},env.SESSION_SECRET);
  const headers={Origin:'https://worker.example','X-Editorial-CSRF':'1',Cookie:await cookie('article-delete-admin'),'Content-Type':'application/json'};
  const send=(confirmation='삭제',h=headers,id=f.article.id)=>worker.fetch(new Request('https://worker.example/api/native/articles/'+id,{method:'DELETE',headers:h,body:JSON.stringify({confirmation})}),env);
  assert.equal((await send('삭제',{...headers,Cookie:''})).status,401);
  assert.equal((await send('삭제',{...headers,'X-Editorial-CSRF':''})).status,403);
  assert.equal((await send('삭제',{...headers,Origin:'https://evil.example'})).status,403);
  student=true;assert.equal((await send('삭제',{...headers,Cookie:await cookie('article-delete-student')})).status,403);student=false;
  const before=snapshot(f.sql);
  for(const confirmation of [null,'',' ',' 삭제','삭제 ','delete','삭제\n','삭제\u200b'])assert.equal((await send(confirmation)).status,400);
  assert.deepEqual(snapshot(f.sql),before);
  assert.equal((await send()).status,200);
  assert.equal((await send()).status,404);
  assert.equal(calls.some(x=>x.includes('/drive/')),false);
 }finally{globalThis.fetch=original;f.sql.close();}
});
