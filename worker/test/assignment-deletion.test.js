import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {D1EditorialRepository} from '../src/repository.js';
import worker,{validateAssignmentDeletion} from '../src/index.js';
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
test('exact deletion confirmation and preservation mode are mandatory',()=>{
 for(const confirmation of [undefined,null,'',' ',' 삭제','삭제 ','delete','삭제\n','삭제\u200b'])assert.throws(()=>validateAssignmentDeletion({confirmation,mode:'preserve_articles'}));
 assert.throws(()=>validateAssignmentDeletion({confirmation:'삭제',mode:'all'}));
 assert.doesNotThrow(()=>validateAssignmentDeletion({confirmation:'삭제',mode:'preserve_articles'}));
});
test('real FK schema: deleting linked submitted assignment preserves articles, revisions, feedback and photo rows',async()=>{
 const f=await seeded();
 assert.deepEqual(await f.repo.assignmentDeletionSummary(f.campaign.id),{id:f.campaign.id,name:'과제',instanceCount:2,articleCount:1,submissionCount:1,mode:'preserve_articles'});
 const tables=['articles','article_revisions','article_feedback','photos'];
 const before=tables.map(t=>f.sql.prepare('SELECT * FROM '+t).all());
 await f.repo.deleteCampaign(f.campaign.id);
 assert.deepEqual(tables.map(t=>f.sql.prepare('SELECT * FROM '+t).all()),before);
 assert.equal((await f.repo.getNativeArticle(f.article.id)).campaignId,null);
 assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
 for(const table of ['assignment_campaigns','assignment_slots','assignment_slot_instances','assignment_recipients','assignment_targets'])assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 await assert.rejects(f.repo.deleteCampaign(f.campaign.id),e=>e.status===404);
 // A student holding a stale instance cannot create an orphan draft.
 await assert.rejects(f.repo.createArticleForAssignment({...f.instance,article_id:null},'student'),e=>e.status===404);
 assert.deepEqual(tables.map(t=>f.sql.prepare('SELECT * FROM '+t).all()),before);f.sql.close();
});
test('empty assignment deletion and transactional rollback',async()=>{
 const f=await seeded();
 f.sql.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON assignment_campaigns BEGIN SELECT RAISE(ABORT,'test failure'); END");
 await assert.rejects(f.repo.deleteCampaign(f.campaign.id));
 assert.equal((await f.repo.assignmentDeletionSummary(f.campaign.id)).instanceCount,2);
 f.sql.exec('DROP TRIGGER reject_delete');
 const empty=await f.repo.createCampaign({name:'empty',year:null,issueLabel:'',issueId:null,instructions:'',startsAt:null,dueAt:null,audienceMode:'all',recipientStudentIds:[],slots:[]},'teacher');
 assert.equal((await f.repo.assignmentDeletionSummary(empty.id)).articleCount,0);
 await f.repo.deleteCampaign(empty.id);assert.ok(await f.repo.getCampaign(f.campaign.id));f.sql.close();
});
test('Worker deletion and preview enforce authentication, admin role and CSRF',async()=>{
 const f=await seeded(),original=globalThis.fetch;
 const env={DB:f.db,SESSION_SECRET:'test-only-secret',NEWSPAPER_CLASSROOM_ID:'test'};
 globalThis.fetch=async url=>String(url).includes('/teachers/')?new Response('{}',{status:404}):new Response(JSON.stringify({id:'student',userId:'student'}),{headers:{'Content-Type':'application/json'}});
 try{
  const cookie=SESSION_COOKIE+'='+await seal({sub:'delete-test-student',courseId:'test',exp:Date.now()+60000,accessToken:'test'},env.SESSION_SECRET);
  for(const suffix of ['', '/deletion-summary']){
   const method=suffix?'GET':'DELETE',url='https://worker.example/api/assignments/'+f.campaign.id+suffix;
   const headers={Origin:'https://worker.example','X-Editorial-CSRF':'1',Cookie:cookie};
   assert.equal((await worker.fetch(new Request(url,{method,headers}),env)).status,403);
   delete headers.Cookie;assert.equal((await worker.fetch(new Request(url,{method,headers}),env)).status,401);
  }
  assert.equal((await worker.fetch(new Request('https://worker.example/api/assignments/'+f.campaign.id,{method:'DELETE'}),env)).status,403);
  assert.ok(await f.repo.getCampaign(f.campaign.id));
 }finally{globalThis.fetch=original;f.sql.close();}
});
test('admin HTTP route rejects invalid confirmation without changes and accepts exact confirmation',async()=>{
 const f=await seeded(),original=globalThis.fetch;
 const env={DB:f.db,SESSION_SECRET:'test-only-secret',NEWSPAPER_CLASSROOM_ID:'test'};
 globalThis.fetch=async()=>new Response(JSON.stringify({id:'teacher',userId:'teacher'}));
 try{
  const Cookie=SESSION_COOKIE+'='+await seal({sub:'delete-test-teacher',courseId:'test',exp:Date.now()+60000,accessToken:'test'},env.SESSION_SECRET);
  const headers={Origin:'https://worker.example','X-Editorial-CSRF':'1',Cookie,'Content-Type':'application/json'},url='https://worker.example/api/assignments/'+f.campaign.id;
  assert.equal((await worker.fetch(new Request(url+'/deletion-summary',{headers}),env)).status,200);
  for(const confirmation of ['', '삭제 ', ' 삭제']){
   assert.equal((await worker.fetch(new Request(url,{method:'DELETE',headers,body:JSON.stringify({confirmation,mode:'preserve_articles'})}),env)).status,400);
   assert.ok(await f.repo.getCampaign(f.campaign.id));
  }
  assert.equal((await worker.fetch(new Request(url,{method:'DELETE',headers,body:JSON.stringify({confirmation:'삭제',mode:'preserve_articles'})}),env)).status,200);
  assert.ok(await f.repo.getNativeArticle(f.article.id));
 }finally{globalThis.fetch=original;f.sql.close();}
});
