import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Node fetch accepts redirect:error; workerd does not. Execute the actual router,
// Drive adapter and timeout helper on the Workers runtime, with isolated D1 and
// an outbound mock. No Google/production requests or credentials are used.
test('Workers runtime creates editorial project without following Drive redirects',async t=>{
 const {outputFiles}=await build({stdin:{contents:`import {routeEditorialFiles} from './src/editorial-files.js';
 export default {async fetch(request,env){try{return await routeEditorialFiles(request,env,{role:'admin',sub:'fixture-admin',accessToken:'fixture-token'},new URL(request.url).pathname);}catch(e){return Response.json({code:e.code||'internal_error',message:e.message},{status:e.status||500});}}};`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,format:'esm',platform:'browser',write:false});
 const calls=[];let googleStatus=200;
 const options={modules:true,compatibilityDate:'2026-08-01',script:outputFiles[0].text,d1Databases:{DB:'isolated-editorial-projects'},bindings:{SESSION_SECRET:'isolated-runtime-test'},outboundService:async request=>{
  calls.push({url:request.url,method:request.method,authorization:request.headers.get('Authorization'),body:await request.json()});
  if(googleStatus!==200)return new Response(null,{status:googleStatus,headers:{Location:'https://untrusted.example/never-follow'}});
  return Response.json({id:'private-folder-'+calls.length});
 }};
 const runtime=new Miniflare(convertV4MiniflareOptions(options));t.after(()=>runtime.dispose());
 const db=await runtime.getD1Database('DB');
 const schema=readFileSync(new URL('../migrations/0006_editorial_files.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
 for(const sql of schema.split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
 const send=input=>runtime.dispatchFetch('https://fixture.example/api/editorial-files/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const created=await send({year:2027,season:'Summer'});assert.equal(created.status,200,await created.clone().text());
 assert.equal(created.headers.get('Cache-Control'),'private, no-store');const project=await created.json();assert.equal(project.id,'2027_Summer');assert.equal(project.latest_version,0);assert.equal(project.folder_id,'private-folder-1');
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://www.googleapis.com/drive/v3/files?fields=id');assert.equal(calls[0].method,'POST');assert.equal(calls[0].authorization,'Bearer fixture-token');assert.deepEqual(calls[0].body,{name:'PrideDesk Editorial — 2027_Summer',mimeType:'application/vnd.google-apps.folder'});
 assert.equal((await send({year:2027,season:'Summer'})).status,409);assert.equal(calls.length,1);
 for(const input of [{},{year:'2027',season:'Winter'},{year:2027,season:'Spring'},null])assert.equal((await send(input)).status,400);
 assert.equal(calls.length,1);
 for(const status of [302,307,403,500]){googleStatus=status;const r=await send({year:2027,season:'Winter'});assert.equal(r.status,502);assert.equal((await r.json()).code,'editorial_drive_error');}
 assert.equal(calls.length,5);assert(calls.every(x=>x.url.startsWith('https://www.googleapis.com/drive/v3/files?')));
 const rows=await db.prepare('SELECT id FROM editorial_projects').all();assert.deepEqual(rows.results,[{id:'2027_Summer'}]);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM editorial_versions').first()).n,0);
});
