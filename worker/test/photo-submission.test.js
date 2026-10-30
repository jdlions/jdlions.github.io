import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../src/index.js';import{memberDatabase,memberToken}from'./member-fixture.js';import{SESSION_COOKIE}from'../src/security.js';import{photoStudentSummary,studentPhotos}from'../src/admin-overview.js';import{photoUploadDiagnostics}from'../src/photo-upload-diagnostics.js';
const pixel=new Uint8Array([137,80,78,71]);
async function fixture(t){const f=memberDatabase();t.after(()=>f.sql.close());const env={DB:f.db,SESSION_SECRET:'photo-test',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',DRIVE_UPLOAD_FOLDER_ID:'private-folder'};
 const cookie=await memberToken(env,{sub:'student',accessToken:'student-token',exp:Date.now()+60000},'student');
 const send=(path,method='GET',body,headers={})=>worker.fetch(new Request('https://local.test'+path,{method,headers:{Cookie:SESSION_COOKIE+'='+cookie,Origin:'https://local.test','X-Editorial-CSRF':'1',...headers},...(body?{body}:{})}),env);
 return{...f,env,send};}
function form(type){const f=new FormData();f.set('photoType',type);f.set('copyright','true');f.set('file',new File([pixel],'original.png',{type:'image/png'}));f.set('caption','사진 설명');f.set('sourceType','self');return f;}
test('student uploads school and feature without articles using student OAuth identity; private reads and old records preserved',async t=>{
 const f=await fixture(t),calls=[];let serial=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));assert(!String(url).includes('/token'));
 assert.equal(init.headers.Authorization,'Bearer student-token');
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
test('photo upload rejects invalid category, forged link, CSRF and inaccessible folder without Drive writes',async t=>{
 const f=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected Google call');});
 assert.equal((await f.send('/api/photos/upload','POST',form('other'))).status,400);
 const forged=form('school');forged.set('articleSubmissionId','someone-else');assert.equal((await f.send('/api/photos/upload','POST',forged)).status,400);
 assert.equal((await f.send('/api/photos/upload','POST',form('school'),{'X-Editorial-CSRF':''})).status,403);
 assert.equal((await f.send('/api/photos/upload','POST',form('school'),{Origin:'https://evil.test'})).status,403);
 assert.equal((await f.send('/api/photos/upload','POST',form('school'),{Cookie:''})).status,401);
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{errors:[{reason:'appNotAuthorizedToFile'}],message:'PRIVATE'}},{status:403});});
 const res=await f.send('/api/photos/upload','POST',form('school'));assert.equal(res.status,403);assert.equal((await res.json()).error.code,'drive_permission_denied');assert.equal(calls,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM photos').get().n,0);
});
test('diagnostics returns actual scope and folder flags, never tokens or identity; no URL credentials or writes',async t=>{
 const f=await fixture(t);const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),method:init.method||'GET'});assert.equal(init.headers.Authorization,'Bearer student-token');assert(!String(url).includes('student-token'));
 if(String(url).endsWith('/tokeninfo'))return Response.json({aud:'client',scope:'openid https://www.googleapis.com/auth/drive.file',email:'PRIVATE',sub:'PRIVATE',access_token:'PRIVATE'});
 assert(new URL(url).searchParams.get('fields').includes('isAppAuthorized'));
 return Response.json({mimeType:'application/vnd.google-apps.folder',isAppAuthorized:false,capabilities:{canAddChildren:true},name:'PRIVATE'});});
 const response=await f.send('/api/photos/upload-diagnostics','POST');assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);const d=await response.json();assert.deepEqual(d.token.grantedScopes,['openid','https://www.googleapis.com/auth/drive.file']);assert.equal(d.token.audienceMatches,true);assert.equal(d.folder.httpStatus,200);assert.equal(d.folder.isAppAuthorized,false);assert.equal(d.folder.canAddChildren,true);assert.equal(d.includeGrantedScopesRequested,false);assert(!JSON.stringify(d).includes('PRIVATE'));assert.deepEqual(calls.map(c=>c.method).sort(),['GET','POST']);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM photos').get().n,0);
 for(const headers of [{Cookie:''},{Origin:'https://evil.test'},{'X-Editorial-CSRF':''}])assert([401,403].includes((await f.send('/api/photos/upload-diagnostics','POST',null,headers)).status));
 const admin=await memberToken(f.env,{sub:'admin',accessToken:'admin-token',exp:Date.now()+60000},'admin');assert.equal((await f.send('/api/photos/upload-diagnostics','POST',null,{Cookie:SESSION_COOKIE+'='+admin})).status,403);assert.equal(calls.length,2);
});
test('diagnostics distinguishes scope failure, folder status/reason and unknown fields without inferring ACL',async t=>{
 for(const status of [403,404]){t.mock.method(globalThis,'fetch',async url=>String(url).endsWith('/tokeninfo')?Response.json({error:'PRIVATE'},{status:400}):Response.json({error:{errors:[{reason:'appNotAuthorizedToFile'}],message:'PRIVATE'}},{status}));const d=await photoUploadDiagnostics('folder','token','client');assert.equal(d.token.httpStatus,400);assert.equal(d.token.grantedScopes,null);assert.equal(d.folder.httpStatus,status);assert.equal(d.folder.reason,'appNotAuthorizedToFile');assert.equal(d.folder.canAddChildren,null);assert.equal(d.folder.isAppAuthorized,null);assert(!JSON.stringify(d).includes('PRIVATE'));}
 t.mock.method(globalThis,'fetch',async url=>String(url).endsWith('/tokeninfo')?Response.json({aud:'other-client',scope:'https://www.googleapis.com/auth/drive.file'}):Response.json({mimeType:'application/vnd.google-apps.folder'}));const d=await photoUploadDiagnostics('folder','token','client');assert.equal(d.token.audienceMatches,false);assert.equal(d.folder.canAddChildren,null);assert.equal(d.folder.isAppAuthorized,null);
});
test('diagnostic transport failure preserves other result and never echoes exception/token',async t=>{
 t.mock.method(globalThis,'fetch',async url=>{if(String(url).endsWith('/tokeninfo'))throw Object.assign(Error('PRIVATE token'),{code:'google_timeout'});return Response.json({mimeType:'application/vnd.google-apps.folder',isAppAuthorized:true,capabilities:{canAddChildren:false}});});const d=await photoUploadDiagnostics('folder','token','client');assert.equal(d.token.error,'google_timeout');assert.equal(d.folder.canAddChildren,false);assert(!JSON.stringify(d).includes('PRIVATE'));
});

test('scope-insufficient Google details are reported without private metadata',async t=>{
 t.mock.method(globalThis,'fetch',async url=>String(url).endsWith('/tokeninfo')?Response.json({aud:'client',scope:'openid'}):Response.json({error:{status:'PERMISSION_DENIED',message:'PRIVATE',details:[{reason:'ACCESS_TOKEN_SCOPE_INSUFFICIENT',metadata:{consumer:'PRIVATE'}}]}},{status:403}));const d=await photoUploadDiagnostics('folder','token','client');assert.deepEqual(d.token.grantedScopes,['openid']);assert.equal(d.folder.reason,'ACCESS_TOKEN_SCOPE_INSUFFICIENT');assert(!JSON.stringify(d).includes('PRIVATE'));
});
