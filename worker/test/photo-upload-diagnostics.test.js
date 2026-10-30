import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../src/index.js';import{memberDatabase,memberToken}from'./member-fixture.js';import{SESSION_COOKIE}from'../src/security.js';import{photoUploadDiagnostics}from'../src/photo-upload-diagnostics.js';
async function fixture(t){const f=memberDatabase();t.after(()=>f.sql.close());const env={DB:f.db,SESSION_SECRET:'photo-test',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',DRIVE_UPLOAD_FOLDER_ID:'private-folder'};
 const cookie=await memberToken(env,{sub:'student',accessToken:'student-token',exp:Date.now()+60000},'student');
 const send=(path,method='GET',body,headers={})=>worker.fetch(new Request('https://local.test'+path,{method,headers:{Cookie:SESSION_COOKIE+'='+cookie,Origin:'https://local.test','X-Editorial-CSRF':'1',...headers},...(body?{body}:{})}),env);
 return{...f,env,send};}
test('retired diagnostics returns no-store 410 without Google calls or data writes',async t=>{
 const f=await fixture(t);const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),method:init.method||'GET'});assert.equal(init.headers.Authorization,'Bearer student-token');assert(!String(url).includes('student-token'));
 if(String(url).endsWith('/tokeninfo'))return Response.json({aud:'client',scope:'openid https://www.googleapis.com/auth/drive.file',email:'PRIVATE',sub:'PRIVATE',access_token:'PRIVATE'});
 assert(new URL(url).searchParams.get('fields').includes('isAppAuthorized'));
 return Response.json({mimeType:'application/vnd.google-apps.folder',isAppAuthorized:false,capabilities:{canAddChildren:true},name:'PRIVATE'});});
 const response=await f.send('/api/photos/upload-diagnostics','POST');assert.equal(response.status,410);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal((await response.json()).error.code,'diagnostic_retired');assert.equal(calls.length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM photos').get().n,0);
 for(const headers of [{Cookie:''},{Origin:'https://evil.test'},{'X-Editorial-CSRF':''}])assert([401,403].includes((await f.send('/api/photos/upload-diagnostics','POST',null,headers)).status));
 const admin=await memberToken(f.env,{sub:'admin',accessToken:'admin-token',exp:Date.now()+60000},'admin');assert.equal((await f.send('/api/photos/upload-diagnostics','POST',null,{Cookie:SESSION_COOKIE+'='+admin})).status,403);assert.equal(calls.length,0);
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
test('diagnostics preserves Google HTTP 401/403/404/500 and identifies response parsing failures',async t=>{
 for(const status of [401,403,404,500]){t.mock.method(globalThis,'fetch',async()=>Response.json({error:{status:status===401?'UNAUTHENTICATED':'PERMISSION_DENIED',message:'PRIVATE'}},{status}));const d=await photoUploadDiagnostics('folder','token','client');for(const r of [d.token,d.folder]){assert.equal(r.httpStatus,status);assert.equal(r.stage,'google_http');assert.equal(r.error,'google_http_error');}assert(!JSON.stringify(d).includes('PRIVATE'));}
 t.mock.method(globalThis,'fetch',async()=>new Response('<html>PRIVATE</html>',{status:200}));const malformed=await photoUploadDiagnostics('folder','token','client');assert.equal(malformed.token.httpStatus,200);assert.equal(malformed.token.stage,'response_body');assert.equal(malformed.token.error,'diagnostic_invalid_json');assert(!JSON.stringify(malformed).includes('PRIVATE'));
 t.mock.method(globalThis,'fetch',async()=>{throw TypeError('PRIVATE token or URL');});const transport=await photoUploadDiagnostics('folder','token','client');assert.equal(transport.token.stage,'request');assert.equal(transport.token.error,'diagnostic_transport_error');assert.equal(transport.token.exceptionType,'TypeError');assert(!JSON.stringify(transport).includes('PRIVATE'));
});
test('404 notFound is retained as a Google reason, without inferring app authorization or ACL',async t=>{
 t.mock.method(globalThis,'fetch',async url=>String(url).endsWith('/tokeninfo')?Response.json({aud:'client',scope:'https://www.googleapis.com/auth/drive.file'}):Response.json({error:{errors:[{reason:'notFound',message:'PRIVATE file identifier'}]}},{status:404}));const d=await photoUploadDiagnostics('folder','token','client');assert.equal(d.token.httpStatus,200);assert.equal(d.folder.httpStatus,404);assert.equal(d.folder.reason,'notFound');assert.equal(d.folder.isAppAuthorized,null);assert.equal(d.folder.canAddChildren,null);assert(!JSON.stringify(d).includes('PRIVATE'));
});
