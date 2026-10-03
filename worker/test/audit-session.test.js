import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {seal,SESSION_COOKIE} from '../src/security.js';

test('concurrent cold sessions share one membership lookup, retain TTL, and retry failed checks',async t=>{
  const env={SESSION_SECRET:'audit-local',NEWSPAPER_CLASSROOM_ID:'audit-single-flight'};
  let calls=0,fail=false;
  t.mock.method(globalThis,'fetch',async url=>{
    calls++;await new Promise(resolve=>setTimeout(resolve,10));
    if(fail)return new Response('',{status:503});
    return Response.json(String(url).includes('userProfiles')?{id:'admin'}:{userId:'admin'});
  });
  const request=async sub=>{
    const token=await seal({sub,courseId:env.NEWSPAPER_CLASSROOM_ID,accessToken:'fixture-'+sub,exp:Date.now()+60000},env.SESSION_SECRET);
    return ()=>worker.fetch(new Request('https://local.test/api/session',{headers:{Cookie:SESSION_COOKIE+'='+token}}),env);
  };
  const send=await request('same');
  const responses=await Promise.all(Array.from({length:6},()=>send()));
  assert(responses.every(r=>r.status===200));assert.equal(calls,2); // profile + teacher, not 6 * 2
  await send();assert.equal(calls,2);
  const retry=await request('retry');fail=true;
  assert.equal((await retry()).status,502);
  fail=false;assert.equal((await retry()).status,200);assert.equal(calls,5);
});

test('malformed and expired session cookies fail closed without Google calls or server errors',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw new Error('must not reach Google');});
  const env={SESSION_SECRET:'audit-local',NEWSPAPER_CLASSROOM_ID:'audit-invalid'};
  for(const value of ['%E0%A4%A',await seal({exp:1,courseId:env.NEWSPAPER_CLASSROOM_ID},env.SESSION_SECRET)]){
    const r=await worker.fetch(new Request('https://local.test/api/native/articles?page=1',{headers:{Cookie:SESSION_COOKIE+'='+value}}),env);
    assert.equal(r.status,401);assert.match(r.headers.get('Cache-Control'),/no-store/);
  }
});

test('membership cache expiry rechecks permissions and never serves stale authorization on failure',async t=>{
  const env={SESSION_SECRET:'audit-local',NEWSPAPER_CLASSROOM_ID:'audit-expiry'},start=Date.now();
  let fail=false,calls=0;
  t.mock.method(globalThis,'fetch',async url=>{calls++;return fail?new Response('',{status:503}):Response.json(String(url).includes('userProfiles')?{id:'admin'}:{userId:'admin'});});
  const token=await seal({sub:'expiry',courseId:env.NEWSPAPER_CLASSROOM_ID,accessToken:'fixture',exp:start+45*60000},env.SESSION_SECRET);
  const send=()=>worker.fetch(new Request('https://local.test/api/session',{headers:{Cookie:SESSION_COOKIE+'='+token}}),env);
  assert.equal((await send()).status,200);assert.equal(calls,2);
  t.mock.method(Date,'now',()=>start+5*60000+1000);fail=true;
  assert.equal((await send()).status,502);assert.equal(calls,3);
  fail=false;assert.equal((await send()).status,200);assert.equal(calls,5);
});
