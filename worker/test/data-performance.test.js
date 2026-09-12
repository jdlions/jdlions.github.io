import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/index.js';
import {seal,SESSION_COOKIE} from '../src/security.js';
import {D1EditorialRepository} from '../src/repository.js';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const queries=[];
 const db={prepare(query){let args=[];const exec=fn=>{queries.push(query);return sql.prepare(query)[fn](...args);};const stmt={bind(...values){args=values;return stmt;},first:async()=>exec('get'),all:async()=>({results:exec('all')}),run:async()=>exec('run')};return stmt;},async batch(items){return Promise.all(items.map(x=>x.run()));}};
 return {sql,db,queries,repo:new D1EditorialRepository(db)};
}
async function legacyCampaigns(repo,studentId){
 let q='SELECT DISTINCT c.* FROM assignment_campaigns c',args=[];
 if(studentId){q+=' JOIN assignment_recipients r ON r.campaign_id=c.id WHERE r.student_id=?';args.push(studentId);}
 q+=' ORDER BY c.created_at DESC';const rows=(await repo.db.prepare(q).bind(...args).all()).results;
 return Promise.all(rows.map(row=>repo.getCampaign(row.id)));
}
for(const n of [0,1,10])test('assignment query count and identical response with '+n+' campaigns',async()=>{
 const f=fixture();
 for(let i=0;i<n;i++){
  const c=await f.repo.createCampaign({name:'Campaign '+i,year:2026,issueLabel:'Winter',issueId:null,instructions:'Text',startsAt:null,dueAt:null,audienceMode:'selected',recipientStudentIds:['a','b'],slots:[{articleType:'school',displayName:'School',required:true,quantity:1,dueAt:null,instructions:''},{articleType:'feature',displayName:'Feature',required:false,quantity:2,dueAt:null,instructions:''}]},'teacher');
  await f.repo.distributeCampaign(c,[{id:i%2?'other':'student',name:'Test'}]);
 }
 for(const studentId of [undefined,'student','outsider']){
  f.queries.length=0;const before={campaigns:await legacyCampaigns(f.repo,studentId),assignments:await f.repo.listAssignments(studentId)},beforeCount=f.queries.length;
  f.queries.length=0;const after={campaigns:await f.repo.listCampaigns(studentId),assignments:await f.repo.listAssignments(studentId)},afterCount=f.queries.length;
  assert.deepEqual(after,before);assert.equal(beforeCount,3*before.campaigns.length+2);assert.equal(afterCount,before.campaigns.length?4:2);
  console.log('queries',JSON.stringify({campaigns:n,viewer:studentId||'admin',before:beforeCount,after:afterCount}));
 }f.sql.close();
});
test('summary preserves metadata/preview but excludes bodies and private fields; detail unchanged',async t=>{
 const f=fixture(),draft='<p>'+('Sample words &amp; text '.repeat(1500))+'</p>';
 for(let i=0;i<20;i++){const a=await f.repo.createNativeArticle({articleType:'school',titleKo:'Title '+i,titleEn:'Title',contentHtml:draft},'student');await f.repo.saveEditorDraft(a,{contentHtml:draft,studentFeedback:'Student feedback',internalNote:'PRIVATE'},'teacher');}
 const before=await f.repo.listNativeArticles('student'),after=await f.repo.listNativeArticles('student',true);
 assert.equal(after.length,20);assert.deepEqual(after.map(x=>x.id),before.map(x=>x.id));
 for(const row of after){for(const key of ['draftHtml','editorDraftHtml','studentFeedback','internalNote'])assert(!Object.hasOwn(row,key));assert.equal(row.draftPreview.length,130);assert.equal(row.wordCount,6000);}
 assert.deepEqual(await f.repo.getNativeArticle(before[0].id),before[0]);
 const bytes=x=>Buffer.byteLength(JSON.stringify(x));assert(bytes(after)<bytes(before)*0.1);
 t.mock.method(globalThis,'fetch',async url=>Response.json(String(url).includes('userProfiles')?{id:'student'}:String(url).includes('/teachers/')?{}:{userId:'student'},{status:String(url).includes('/teachers/')?404:200}));
 const env={DB:f.db,SESSION_SECRET:'local-test',NEWSPAPER_CLASSROOM_ID:'performance'};
 const token=await seal({sub:'student',studentId:'student',courseId:'performance',accessToken:'test',exp:Date.now()+60000},env.SESSION_SECRET);
 const request=path=>worker.fetch(new Request('https://local.test'+path,{headers:{Cookie:SESSION_COOKIE+'='+token}}),env);
 const oldResponse=await(await request('/api/native/articles')).json(),newResponse=await(await request('/api/native/articles?summary=1')).json(),detail=await(await request('/api/native/articles/'+before[0].id)).json();
 assert.doesNotMatch(JSON.stringify(newResponse),/PRIVATE|draftHtml|editorDraftHtml|internalNote/);assert.equal(detail.studentFeedback,'Student feedback');assert.equal(detail.draftHtml,draft);
 console.log('HTTP student payload bytes',JSON.stringify({articles:20,listBefore:bytes(oldResponse),listAfter:bytes(newResponse),detailBefore:bytes({...oldResponse[0],revisions:[]}),detailAfter:bytes(detail)}));f.sql.close();
});
