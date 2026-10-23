import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {seal,SESSION_COOKIE} from '../src/security.js';
import {memberDatabase,memberToken} from './member-fixture.js';
test('concurrent sessions read current D1 membership without Google or cached permissions',async t=>{
 const f=memberDatabase();t.after(()=>f.sql.close());const env={DB:f.db,SESSION_SECRET:'audit-local'};
 t.mock.method(globalThis,'fetch',()=>{throw new Error('must not reach Google');});
 const token=await memberToken(env,{sub:'same',exp:Date.now()+60000},'admin');
 const send=()=>worker.fetch(new Request('https://local.test/api/session',{headers:{Cookie:SESSION_COOKIE+'='+token}}),env);
 const responses=await Promise.all(Array.from({length:6},()=>send()));for(const r of responses)assert.equal((await r.json()).user.role,'admin');
 f.sql.prepare("UPDATE members SET active=0,auth_version=auth_version+1 WHERE google_sub='same'").run();
 assert.equal((await send()).status,401);
});
test('expired and old Classroom session cookies fail closed without Google calls',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('must not reach Google');});const env={SESSION_SECRET:'audit-local'};
 for(const claims of [{exp:1},{sub:'old-teacher',role:'admin',courseId:'old',exp:Date.now()+60000}]){
 const value=await seal(claims,env.SESSION_SECRET);const r=await worker.fetch(new Request('https://local.test/api/native/articles?page=1',{headers:{Cookie:SESSION_COOKIE+'='+value}}),env);
 assert.equal(r.status,401);assert.match(r.headers.get('Cache-Control'),/no-store/);}
});
test('D1 failure never serves stale authorization and a later healthy read recovers',async t=>{
 const f=memberDatabase();t.after(()=>f.sql.close());const env={DB:f.db,SESSION_SECRET:'audit-local'};
 const token=await memberToken(env,{sub:'reader',exp:Date.now()+60000},'admin');
 const original=f.db.prepare;f.db.prepare=()=>{throw new Error('isolated D1 unavailable');};
 assert.equal((await worker.fetch(new Request('https://local.test/api/native/articles?page=1',{headers:{Cookie:SESSION_COOKIE+'='+token}}),env)).status,500);
 f.db.prepare=original;const session=await worker.fetch(new Request('https://local.test/api/session',{headers:{Cookie:SESSION_COOKIE+'='+token}}),env);
 assert.equal((await session.json()).user.role,'admin');
});
