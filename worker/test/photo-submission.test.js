import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../src/index.js';import{memberDatabase,memberToken}from'./member-fixture.js';import{SESSION_COOKIE}from'../src/security.js';import{photoStudentSummary,studentPhotos}from'../src/admin-overview.js';import{photoDriveToken}from'../src/google.js';
const pixel=new Uint8Array([137,80,78,71]);
async function fixture(t){const f=memberDatabase();t.after(()=>f.sql.close());const env={DB:f.db,SESSION_SECRET:'photo-test',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',PHOTO_DRIVE_REFRESH_TOKEN:'publisher-refresh',DRIVE_UPLOAD_FOLDER_ID:'private-folder'};
 const cookie=await memberToken(env,{sub:'student',accessToken:'student-token',exp:Date.now()+60000},'student');
 const send=(path,method='GET',body,headers={})=>worker.fetch(new Request('https://local.test'+path,{method,headers:{Cookie:SESSION_COOKIE+'='+cookie,Origin:'https://local.test','X-Editorial-CSRF':'1',...headers},...(body?{body}:{})}),env);
 return{...f,env,send};}
function form(type){const f=new FormData();f.set('photoType',type);f.set('copyright','true');f.set('file',new File([pixel],'original.png',{type:'image/png'}));f.set('caption','사진 설명');f.set('sourceType','self');return f;}
test('student uploads school and feature without articles using publisher identity; private reads and old records preserved',async t=>{
 const f=await fixture(t),calls=[];let serial=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));if(String(url)==='https://oauth2.googleapis.com/token'){assert.equal(init.body.get('refresh_token'),'publisher-refresh');return Response.json({access_token:'publisher-token',token_type:'Bearer'});}
 assert.equal(init.headers.Authorization,'Bearer publisher-token');
 if(String(url).includes('/upload/')){assert.match(await init.body.text(),/"parents":\["private-folder"\]/);return Response.json({id:'drive-'+(++serial),name:'original.png',size:'4',mimeType:'image/png'});}
 if(String(url).includes('alt=media'))return new Response(pixel,{headers:{'Content-Type':'image/png'}});
 return Response.json({id:'private-folder',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}});});
 f.sql.exec("INSERT INTO photos(id,issue_id,article_submission_id,student_google_id,drive_file_id,filename,mime_type,byte_size,created_at,updated_at) VALUES('old','old-issue','old-submission','student','old-drive','old.jpg','image/jpeg',1,'2026','2026')");
 for(const type of ['feature','school']){const res=await f.send('/api/photos/upload','POST',form(type));assert.equal(res.status,201);const photo=await res.json();assert.equal(photo.article_id,null);assert.equal(photo.article_submission_id,'');assert.equal(photo.issue_id,'student-photo:'+type);assert.equal(photo.student_google_id,'student');assert.match(res.headers.get('Cache-Control'),/no-store/);
 const original=await f.send('/api/photos/'+photo.id+'/original');assert.equal(original.status,200);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),pixel);
 f.sql.prepare('UPDATE photos SET student_google_id=? WHERE id=?').run('another',photo.id);assert.equal((await f.send('/api/photos/'+photo.id+'/content')).status,404);f.sql.prepare('UPDATE photos SET student_google_id=? WHERE id=?').run('student',photo.id);}
 const list=await(await f.send('/api/photos')).json();assert.equal(list.length,2);assert.equal(f.sql.prepare("SELECT drive_file_id FROM photos WHERE id='old'").get().drive_file_id,'old-drive');
 assert.equal((await studentPhotos(f.db,'student')).length,2);assert.equal((await studentPhotos(f.db,'another')).length,0);const summary=await photoStudentSummary(f.db);assert.equal(summary.length,2);assert(summary.every(r=>r.photoCount===1));assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM articles').get().n,0);
});
test('photo upload rejects invalid category, forged link, CSRF and absent publisher credential without Drive writes',async t=>{
 const f=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected Google call');});
 assert.equal((await f.send('/api/photos/upload','POST',form('other'))).status,400);
 const forged=form('school');forged.set('articleSubmissionId','someone-else');assert.equal((await f.send('/api/photos/upload','POST',forged)).status,400);
 assert.equal((await f.send('/api/photos/upload','POST',form('school'),{'X-Editorial-CSRF':''})).status,403);
 assert.equal((await f.send('/api/photos/upload','POST',form('school'),{Origin:'https://evil.test'})).status,403);
 assert.equal((await f.send('/api/photos/upload','POST',form('school'),{Cookie:''})).status,401);
 delete f.env.PHOTO_DRIVE_REFRESH_TOKEN;const res=await f.send('/api/photos/upload','POST',form('school'));assert.equal(res.status,503);assert.equal((await res.json()).error.code,'photo_storage_unconfigured');assert.equal(calls,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM photos').get().n,0);
});
test('publisher refresh failure is actionable and never leaks Google error or credentials',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'invalid_grant',error_description:'private-token'},{status:400}));
 await assert.rejects(photoDriveToken({PHOTO_DRIVE_REFRESH_TOKEN:'secret',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'}),e=>e.code==='photo_storage_auth_failed'&&e.upstreamStatus===400&&!JSON.stringify(e).includes('private-token'));
});
