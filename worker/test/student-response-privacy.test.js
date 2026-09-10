import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {D1EditorialRepository} from '../src/repository.js';
import {seal,SESSION_COOKIE} from '../src/security.js';

const article={id:'article',studentId:'student',articleType:'school',titleKo:'Title',titleEn:'',status:'draft',draftHtml:'<p>Draft</p>',editorDraftHtml:'<p>Edited</p>',studentFeedback:'Student feedback',internalNote:'PRIVATE',internal_note:'PRIVATE',futureStaffOnly:{note:'PRIVATE'}};
const cases=[
  ['list','GET','/api/native/articles'],
  ['detail','GET','/api/native/articles/article'],
  ['create','POST','/api/native/articles'],
  ['save','PATCH','/api/native/articles/article'],
  ['submit','POST','/api/native/articles/article/submit'],
  ['import','POST','/api/native/articles/article/import'],
  ['open existing assignment','POST','/api/assignments/instances/slot/article'],
  ['open new assignment','POST','/api/assignments/instances/slot/article']
];
for(const [label,method,path] of cases)test('student privacy: '+label,async t=>{
  t.mock.method(globalThis,'fetch',async url=>Response.json(String(url).includes('userProfiles')?{id:'student'}:String(url).includes('/teachers/')?{}:{userId:'student'},{status:String(url).includes('/teachers/')?404:200}));
  const proto=D1EditorialRepository.prototype;
  for(const name of ['getNativeArticle','createNativeArticle','saveStudentDraft','submitNativeArticle','importStudentDraft','createArticleForAssignment'])t.mock.method(proto,name,async()=>({...article}));
  t.mock.method(proto,'listNativeArticles',async()=>[{...article}]);
  t.mock.method(proto,'listRevisions',async()=>[{id:'revision',contentHtml:'<p>Revision</p>'}]);
  t.mock.method(proto,'getAssignmentInstance',async()=>({id:'slot',student_id:'student',article_id:label==='open new assignment'?null:'article',campaign_status:'active'}));
  const env={DB:{},SESSION_SECRET:'local-test-only',NEWSPAPER_CLASSROOM_ID:label};
  const token=await seal({sub:'student',studentId:'student',role:'student',courseId:label,accessToken:'test',exp:Date.now()+60000},env.SESSION_SECRET);
  const headers={Cookie:SESSION_COOKIE+'='+token,Origin:'https://local.test','X-Editorial-CSRF':'1'};
  let body;
  if(label==='import'){body=new FormData();body.append('file',new File(['Imported text'],'article.txt',{type:'text/plain'}));}
  else if(method!=='GET'){headers['Content-Type']='application/json';body=JSON.stringify({articleType:'school',titleKo:'Title',contentHtml:'<p>New</p>'});}
  const response=await worker.fetch(new Request('https://local.test'+path,{method,headers,body}),env);
  assert.ok([200,201].includes(response.status),await response.clone().text());
  const data=await response.json(),result=Array.isArray(data)?data[0]:data;
  assert.doesNotMatch(JSON.stringify(data),/PRIVATE|internalNote|internal_note|futureStaffOnly/);
  assert.equal(result.studentFeedback,article.studentFeedback);
  assert.equal(result.editorDraftHtml,article.editorDraftHtml);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('admin retains internal notes on detail, editor save and status responses',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'teacher',userId:'teacher'}));
  for(const name of ['getNativeArticle','saveEditorDraft','setNativeStatus'])t.mock.method(D1EditorialRepository.prototype,name,async()=>({...article}));
  t.mock.method(D1EditorialRepository.prototype,'listRevisions',async()=>[]);
  const env={DB:{},SESSION_SECRET:'local-test-only',NEWSPAPER_CLASSROOM_ID:'admin-privacy'};
  const token=await seal({sub:'teacher',role:'admin',courseId:env.NEWSPAPER_CLASSROOM_ID,accessToken:'test',exp:Date.now()+60000},env.SESSION_SECRET);
  for(const [method,suffix] of [['GET',''],['PATCH','/editor'],['PATCH','/status']]){
    const response=await worker.fetch(new Request('https://local.test/api/native/articles/article'+suffix,{method,headers:{Cookie:SESSION_COOKIE+'='+token,Origin:'https://local.test','X-Editorial-CSRF':'1','Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify({status:'approved',internalNote:'PRIVATE'})}),env);
    assert.equal(response.status,200);assert.equal((await response.json()).internalNote,'PRIVATE');
  }
});
