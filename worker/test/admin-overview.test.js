import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {articleListOptions,listArticlePage} from '../src/article-list.js';
import {articleStudentOverview,dashboardSummary,photoStudentSummary,studentPhotos} from '../src/admin-overview.js';
import {D1EditorialRepository} from '../src/repository.js';
import worker,{validateCampaign} from '../src/index.js';
import {seal,SESSION_COOKIE} from '../src/security.js';
import {schoolNumber,isNewAssignmentEligible} from '../../assets/js/shared/student-identity.js';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const calls=[];const db={prepare(query){let args=[];const stmt={bind(...values){args=values;return stmt;},async first(){calls.push(query);return sql.prepare(query).get(...args)??null;},async all(){calls.push(query);return {results:sql.prepare(query).all(...args)};},async run(){calls.push(query);return sql.prepare(query).run(...args);}};return stmt;},async batch(items){sql.exec('BEGIN');try{const result=await Promise.all(items.map(x=>x.run()));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};return {sql,db,calls,repo:new D1EditorialRepository(db)};
}
const input=()=>validateCampaign({name:'Current fixture',slots:[{articleType:'school',displayName:'학교기사'},{articleType:'feature',displayName:'피처기사'}]});
async function campaign(f,students){let c=await f.repo.createCampaign(input(),'t');await f.repo.distributeCampaign(c,students);return c;}
async function article(f,c,student,type,status='submitted'){
 const row=f.sql.prepare('SELECT i.id FROM assignment_slot_instances i JOIN assignment_slots s ON s.id=i.slot_id WHERE i.campaign_id=? AND i.student_id=? AND s.article_type=?').get(c.id,student,type);
 const a=await f.repo.createArticleForAssignment(await f.repo.getAssignmentInstance(row.id),student);f.sql.prepare('UPDATE articles SET status=?,draft_html=? WHERE id=?').run(status,'PRIVATE BODY',a.id);return a;
}
async function photo(f,a){return f.repo.createPhoto({issueId:'native',articleSubmissionId:a.id,articleId:a.id,studentGoogleId:a.studentId,driveFileId:crypto.randomUUID(),filename:'private.png',mimeType:'image/png',byteSize:15000000,caption:'PRIVATE CAPTION',photographer:'Fixture',sourceType:'self',rightsConfirmed:true});}
test('dashboard empty and independent read failure returns recoverable sections',async()=>{const f=fixture();const d=await dashboardSummary(f.db);assert.equal(d.assignment.campaign,null);assert.equal(d.editorial,null);assert.equal(f.calls.length,2);f.sql.exec('DROP TABLE editorial_versions');const partial=await dashboardSummary(f.db);assert(partial.errors.editorial);assert.equal(partial.assignment.campaign,null);f.sql.close();});
test('dashboard counts slots, not photo files, and reads only the completed latest editorial version',async()=>{
 const f=fixture(),c=await campaign(f,[{id:'s',name:'11001 Student'},{id:'third',name:'31001 Alumni'}]);const a=await article(f,c,'s','school');await photo(f,a);await photo(f,a);
 f.sql.exec("INSERT INTO editorial_projects(id,year,season,folder_id,latest_version,created_at) VALUES('p',2026,'Winter','PRIVATE',14,'2026'); INSERT INTO editorial_edit_sessions VALUES('e','p','u',13,'2026'); INSERT INTO editorial_versions(id,project_id,version,base_version,edit_session_id,user_id,editor_name,change_note,original_filename,normalized_filename,extension,file_size,content_hash,drive_file_id,state,created_at) VALUES('v','p',14,13,'e','u','Last Editor','','x.af','v014.af','af',1,'HASH','PRIVATE','complete','2026');");
 f.calls.length=0;const d=await dashboardSummary(f.db);assert.equal(d.assignment.campaign.id,c.id);assert.deepEqual({...d.assignment.progress.find(x=>x.articleType==='school')},{articleType:'school',total:2,submitted:1,withPhotos:1});assert.equal(d.editorial.version,14);assert.equal(d.editorial.editorName,'Last Editor');assert.equal(f.calls.length,3);assert.doesNotMatch(JSON.stringify(d),/PRIVATE|draftHtml|driveFile/);f.sql.close();
});
test('student photo summary preserves missing sides and historical grade 3; detail is selected-student only',async()=>{
 const f=fixture(),c=await campaign(f,[{id:'s',name:'11001 Student'},{id:'third',name:'31001 Alumni'}]);const a=await article(f,c,'s','school');await photo(f,a);
 f.calls.length=0;const rows=await photoStudentSummary(f.db);assert.equal(f.calls.length,1);assert.equal(rows.length,4);assert.equal(rows.find(x=>x.studentId==='s'&&x.articleType==='school').photoCount,1);assert.equal(rows.find(x=>x.studentId==='s'&&x.articleType==='feature').photoCount,0);assert(rows.some(x=>x.studentId==='third'));assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|filename|thumbnail|drive_file/);
 assert.equal((await studentPhotos(f.db,'s')).length,1);assert.equal((await studentPhotos(f.db,'third')).length,0);assert.equal((await studentPhotos(f.db,"s' OR 1=1 --")).length,0);f.sql.close();
});
test('school number comes from display name, never opaque Google ID',()=>{assert.equal(schoolNumber({name:'31001 졸업생',id:'google'}),'31001');assert.equal(isNewAssignmentEligible({name:'31001 졸업생'}),false);assert.equal(isNewAssignmentEligible({name:'11001 학생',id:'3333333333333333333'}),true);assert.equal(isNewAssignmentEligible({name:'Unknown',id:'31001'}),true);});
async function auth(t,f,role='admin'){
 t.mock.method(globalThis,'fetch',async url=>{url=String(url);if(url.includes('userProfiles'))return Response.json({id:role});if(url.includes('/teachers/'))return role==='admin'?Response.json({userId:role}):new Response('',{status:404});if(url.endsWith('/students?pageSize=100'))return Response.json({students:[{userId:'g1',profile:{name:{fullName:'11001 Student'}}},{userId:'g3',profile:{name:{fullName:'31001 Alumni'}}}]});return Response.json({userId:role});});
 const env={DB:f.db,SESSION_SECRET:'fixture',NEWSPAPER_CLASSROOM_ID:crypto.randomUUID()};const token=await seal({sub:role,accessToken:'fixture',courseId:env.NEWSPAPER_CLASSROOM_ID,exp:Date.now()+60000},env.SESSION_SECRET);
 return (path,method='GET',body)=>worker.fetch(new Request('https://local.test'+path,{method,headers:{Cookie:SESSION_COOKIE+'='+token,Origin:'https://local.test','X-Editorial-CSRF':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
}
test('all new aggregate/detail endpoints reject student role and retain no-store',async t=>{const f=fixture(),send=await auth(t,f,'student');for(const path of ['/api/admin/article-overview','/api/admin/dashboard','/api/admin/photo-students','/api/admin/student-photos?student=other']){const r=await send(path);assert.equal(r.status,403);assert.match(r.headers.get('cache-control'),/no-store/);}f.sql.close();});
test('new recipient validation and all-mode distribution exclude grade 3 without deleting history',async t=>{
 const f=fixture(),old=await campaign(f,[{id:'g3',name:'31001 Alumni'}]),send=await auth(t,f);
 const bad=await send('/api/assignments','POST',{...input(),recipientStudentIds:['g3'],audienceMode:'selected'});assert.equal(bad.status,400);
 const created=await send('/api/assignments','POST',input());assert.equal(created.status,201);const c=await created.json();const distributed=await send('/api/assignments/'+c.id+'/distribute','POST',{audienceMode:'all'});assert.equal(distributed.status,200);
 assert.deepEqual(f.sql.prepare('SELECT student_id FROM assignment_recipients WHERE campaign_id=?').all(c.id).map(x=>x.student_id),['g1']);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM assignment_recipients WHERE campaign_id=?').get(old.id).n,1);f.sql.close();
});
test('overview query count is constant for 100 students and reports payload before/after',async()=>{
 const f=fixture(),students=Array.from({length:100},(_,i)=>({id:'s'+i,name:String(11000+i)+' Fixture'})),c=await campaign(f,students);for(let i=0;i<20;i++)await photo(f,await article(f,c,'s'+i,'school'));
 const bytes=x=>Buffer.byteLength(JSON.stringify(x)),before=await f.repo.listPhotos();f.calls.length=0;const articlePage=await listArticlePage(f.db,articleListOptions(new URLSearchParams(),null),null),articleQueries=f.calls.length;f.calls.length=0;const assignments={campaigns:await f.repo.listCampaigns(),assignments:await f.repo.listAssignments()},assignmentQueries=f.calls.length;f.calls.length=0;const summary=await photoStudentSummary(f.db),photoQueries=f.calls.length;f.calls.length=0;const dashboard=await dashboardSummary(f.db),dashboardQueries=f.calls.length;assert.equal(photoQueries,1);assert.equal(dashboardQueries,3);assert.equal(summary.length,200);console.log('admin overview measurement',JSON.stringify({students:100,photos:20,articleQueries,articlePayload:bytes(articlePage),assignmentQueries,assignmentPayload:bytes(assignments),photoBeforeBytes:bytes(before),photoAfterBytes:bytes(summary),photoQueries,dashboardBytes:bytes(dashboard),dashboardQueries}));f.sql.close();
});

for(const n of [0,20,100])test('complete article overview has constant query count and no body/private fields: '+n,async()=>{
 const f=fixture(),students=Array.from({length:n},(_,i)=>({id:'s'+i,name:(i<10?11000+i:21000+i)+' Student'})),c=await campaign(f,students);
 for(const s of students.slice(0,-1))for(const type of ['school','feature'])await article(f,c,s.id,type);
 f.calls.length=0;let cursor='',beforeBytes=0,pages=0;
 do{const p=await listArticlePage(f.db,articleListOptions(new URLSearchParams({cursor,stats:pages?'0':'1'})),null);beforeBytes+=Buffer.byteLength(JSON.stringify(p));pages++;cursor=p.nextCursor;}while(cursor);
 const beforeQueries=f.calls.length;f.calls.length=0;const d=await articleStudentOverview(f.db,[...students,{id:'opaque-11001',name:'Unknown'}]);
 assert.equal(f.calls.length,1);assert.equal(d.students.length,n+1);assert.equal(d.items.length,Math.max(0,n-1)*2);
 assert.doesNotMatch(JSON.stringify(d),/PRIVATE|draftHtml|draftPreview|editorDraftHtml|internalNote|revisions|wordCount/);
 console.log('complete article overview',JSON.stringify({students:n,beforeRequests:pages,afterRequests:1,beforeQueries,afterQueries:1,beforeBytes,afterBytes:Buffer.byteLength(JSON.stringify(d))}));f.sql.close();
});

test('admin overview includes cached roster-only students and preserves historical recipients',async t=>{
 const f=fixture();await campaign(f,[{id:'legacy',name:'31001 Alumni'}]);const send=await auth(t,f);const r=await send('/api/admin/article-overview');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);const d=await r.json();assert(d.students.some(s=>s.studentId==='g1'));assert(!d.students.some(s=>s.studentId==='g3'));assert(d.students.some(s=>s.studentId==='legacy'));assert.deepEqual(d.items,[]);f.sql.close();
});
