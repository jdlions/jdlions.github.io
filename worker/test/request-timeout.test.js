import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchWithTimeout} from '../../assets/js/shared/request-timeout.js';
import {api,apiTimeout} from '../../assets/js/services/api-client.js';
import {userInfo,downloadDriveFile} from '../src/google.js';
test('deadline terminates stalled headers and stalled response body',async t=>{
 const keep=setTimeout(()=>{},1000);
 try{for(const bodyStall of [false,true]){
  t.mock.method(globalThis,'fetch',async()=>bodyStall?new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}})):new Promise(()=>{}));
  await assert.rejects(async()=>{const r=await fetchWithTimeout('https://local.test',{},10);await r.json();},e=>e.name==='TimeoutError');t.mock.restoreAll();
 }}finally{clearTimeout(keep);}
});
test('API policies distinguish session, ordinary calls and transfers; preserve CSRF credentials',async t=>{
 assert.equal(apiTimeout('/api/session'),30000);assert.equal(apiTimeout('/api/native/articles'),60000);assert.equal(apiTimeout('/api/photos/upload'),180000);assert.equal(apiTimeout('/api/native/articles/a/import'),180000);
 let init;t.mock.method(globalThis,'fetch',async(url,options)=>{init=options;return Response.json({ok:true});});
 assert.deepEqual(await api('/api/native/articles/a',{method:'PATCH',body:'{}'}),{ok:true});assert.equal(init.credentials,'include');assert.equal(init.headers.get('X-Editorial-CSRF'),'1');assert(init.signal);
});
test('Google JSON and Drive binary requests use abort signals and preserve bodies',async t=>{
 t.mock.method(globalThis,'fetch',async(url,init)=>{assert(init.signal);return String(url).includes('alt=media')?new Response('binary'):Response.json({id:'user'});});
 assert.deepEqual(await userInfo('token'),{id:'user'});assert.equal(new TextDecoder().decode(await downloadDriveFile('file','token',100)),'binary');
});

test('Google timeout produces a safe 504 for both metadata and transfer requests',async t=>{
 const original=setTimeout,keep=original(()=>{},1000),limits=[];
 t.mock.method(globalThis,'setTimeout',(fn,ms)=>{limits.push(ms);return original(fn,5);});
 t.mock.method(globalThis,'fetch',async()=>new Promise(()=>{}));
 try{await assert.rejects(userInfo('private-token'),e=>e.status===504&&e.code==='google_timeout'&&!e.message.includes('private-token'));await assert.rejects(downloadDriveFile('file','private-token',100),e=>e.status===504&&e.code==='google_timeout');assert.deepEqual(limits,[20000,120000]);}finally{clearTimeout(keep);}
});
