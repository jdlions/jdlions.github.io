import test from 'node:test';
import assert from 'node:assert/strict';
import {driveThumbnail} from '../src/google.js';
import {photoContentResponse,authorizePhotoViewer} from '../src/index.js';

test('private thumbnail stays credentialed, bounded, no-store; full original remains separate',async t=>{
 const calls=[];const bytes=new Uint8Array(24000);
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),init});return calls.length===1?Response.json({mimeType:'image/jpeg',thumbnailLink:'https://lh3.googleusercontent.com/private-thumbnail'}):new Response(bytes,{headers:{'content-type':'image/jpeg'}});});
 const response=await photoContentResponse({drive_file_id:'private',filename:'photo.jpg'},'test-token',driveThumbnail);
 assert.equal((await response.arrayBuffer()).byteLength,24000);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert(calls.every(x=>x.init.headers.Authorization==='Bearer test-token'));assert.equal(calls[1].init.redirect,'error');assert(!calls.some(x=>x.url.includes('alt=media')));
 console.log('thumbnail fixture bytes',JSON.stringify({originalMaximum:15*1024*1024,thumbnail:24000,thumbnailMaximum:1024*1024,upstreamRequests:2}));
});
for(const scenario of ['missing','external','redirect','wrong-type','declared-large','stream-large'])test('thumbnail rejects '+scenario+' without original fallback',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{
  calls++;
  if(calls===1)return Response.json({mimeType:'image/jpeg',thumbnailLink:scenario==='missing'?null:scenario==='external'?'https://attacker.test/steal':'https://lh3.googleusercontent.com/thumb'});
  if(scenario==='redirect')throw new TypeError('redirect blocked');
  return new Response(new Uint8Array(scenario==='stream-large'?1024*1024+1:5),{headers:{'content-type':scenario==='wrong-type'?'text/html':'image/jpeg',...(scenario==='declared-large'?{'content-length':String(2*1024*1024)}:{})}});
 });
 await assert.rejects(driveThumbnail('file','private'));assert(calls<=2);
});
test('thumbnail authorization rejects other student before fetching any Drive content',async()=>{
 let nativeReads=0;
 const repo={getPhoto:async()=>({student_google_id:'owner',article_id:'a'}),getNativeArticle:async()=>{nativeReads++;return {studentId:'owner'};}};
 await assert.rejects(authorizePhotoViewer(repo,'p',{role:'student',studentId:'other'}),{status:404});assert.equal(nativeReads,0);
 assert(await authorizePhotoViewer(repo,'p',{role:'student',studentId:'owner'}));assert(await authorizePhotoViewer(repo,'p',{role:'admin'}));
});
