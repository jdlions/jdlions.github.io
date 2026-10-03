import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { authorizePhotoViewer, callbackRedirect, createPhotoAfterDrive, photoContentResponse, photoForClient, publicRoster, validateStudentPhoto } from '../src/index.js';

test('uncertain D1 photo commit never deletes a Drive original',async t=>{
  let committed=false,calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('No Drive request expected');});
  for(const afterCommit of [false,true]){
    const repo={createPhoto:async()=>{committed=afterCommit;throw new Error('D1 read/connection failure');}};
    await assert.rejects(createPhotoAfterDrive(repo,{driveFileId:'drive-1'}),e=>e.code==='photo_metadata_save_failed'&&e.message.includes('Drive 원본은 보존'));
    assert.equal(committed,afterCommit);
  }
  assert.equal(calls,0);
});
test('student photo validation requires an owned native article and safe image',()=>{const file=new File(['x'],'photo.jpg',{type:'image/jpeg'});assert.doesNotThrow(()=>validateStudentPhoto(file,'article-1',[{id:'article-1'}]));assert.throws(()=>validateStudentPhoto(file,'other',[{id:'article-1'}]),e=>e.code==='article_forbidden');});
test('photo records expose authenticated same-origin endpoints only',()=>{const row=photoForClient({id:'photo one',drive_file_id:'secret'});assert.equal(row.contentUrl,'/api/photos/photo%20one/content');assert.equal(row.originalUrl,'/api/photos/photo%20one/original');assert.doesNotMatch(JSON.stringify(row),/thumbnailLink/);});
test('native photo authorization permits admin and article owner only',async()=>{const photo={id:'p',article_id:'native-1',student_google_id:'student-1'};const repo={getPhoto:async()=>photo,getNativeArticle:async()=>({id:'native-1',studentId:'student-1'})};assert.equal(await authorizePhotoViewer(repo,'p',{role:'admin'}),photo);assert.equal(await authorizePhotoViewer(repo,'p',{role:'student',studentId:'student-1'}),photo);await assert.rejects(authorizePhotoViewer(repo,'p',{role:'student',studentId:'student-2'}),e=>e.code==='photo_not_found');});
test('legacy issue photos are not authorized through Classroom submissions',async()=>{const repo={getPhoto:async()=>({id:'old',article_id:null,student_google_id:'student-1'}),getNativeArticle:async()=>null};await assert.rejects(authorizePhotoViewer(repo,'old',{role:'student',studentId:'student-1'}),e=>e.code==='photo_not_found');});
test('photo response streams inline with private anti-sniff headers',async()=>{const response=await photoContentResponse({drive_file_id:'drive',filename:'x.jpg'},'token',async()=>({body:new Blob(['x']).stream(),contentType:'image/jpeg',contentLength:'1'}));assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');});
test('OAuth callback stays on the Worker native role page',()=>{assert.equal(callbackRedirect(new URL('https://worker.example/auth/callback'),'admin'),'https://worker.example/editorial/admin/');assert.equal(callbackRedirect(new URL('https://worker.example/auth/callback'),'student'),'https://worker.example/editorial/student/');});
test('editorial assets are separate from API routes',async()=>{let assets=0;const env={ASSETS:{fetch:async()=>{assets++;return new Response('asset');}}};assert.equal((await worker.fetch(new Request('https://worker.example/editorial/student/'),env)).status,200);assert.equal(assets,1);});
test('roster exposes only stable id and display name',()=>{assert.deepEqual(publicRoster([{userId:'1',profile:{name:{fullName:'Kim'}}}]),[{id:'1',name:'Kim'}]);});
