import test from 'node:test';
import assert from 'node:assert/strict';
import {searchSchoolPeople,safeSearchFailure} from '../src/member-search.js';

test('Google diagnostics allow only finite error codes, never provider content',()=>{
 const result=safeSearchFailure({error:{status:'PERMISSION_DENIED',message:'PRIVATE',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'SERVICE_DISABLED',metadata:{service:'people.googleapis.com',consumer:'PRIVATE',token:'PRIVATE'}},{'@type':'PRIVATE',reason:'PRIVATE'}],errors:[{reason:'insufficientPermissions',message:'PRIVATE'},{reason:'PRIVATE'}]}});
 assert.deepEqual(result,{googleCode:'PERMISSION_DENIED',reasons:['SERVICE_DISABLED','insufficientPermissions'],detailTypes:['type.googleapis.com/google.rpc.ErrorInfo'],service:'people.googleapis.com'});
 assert(!JSON.stringify(result).includes('PRIVATE'));
 for(const error of [null,{}, {error:{status:'PRIVATE',details:{},errors:'PRIVATE'}}])assert.deepEqual(safeSearchFailure(error),{googleCode:'UNKNOWN',reasons:[],detailTypes:[],service:null});
});

test('Google failures expose safe setup, scope and policy reasons without logging credentials',async t=>{
 const logs=[];t.mock.method(console,'error',value=>logs.push(value));
 for(const reason of ['SERVICE_DISABLED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','ORG_RESTRICTION_VIOLATION','domainPolicy','forbidden']){
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:{status:'PERMISSION_DENIED',message:'PRIVATE',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason,metadata:{service:'people.googleapis.com',consumer:'PRIVATE'}}]}},{status:403}));
  await assert.rejects(searchSchoolPeople('PRIVATE',{searchSource:'directory',accessToken:'PRIVATE'}),e=>{assert(e.message.includes(reason));assert(e.message.includes('directory scope: 교환 시 확인됨'));assert(!e.message.includes('PRIVATE'));return e.status===403;});
 }
 assert(logs.every(s=>!s.includes('PRIVATE')));
 assert(logs.every(s=>JSON.parse(s).scopeVerifiedAtExchange===true));
});
test('search requires explicit administrator consent and bounds queries',async()=>{
 for(const viewer of [{},{searchSource:'toString'}])await assert.rejects(searchSchoolPeople('학생',viewer),e=>e.status===403);
 await assert.rejects(searchSchoolPeople('a',{searchSource:'directory'}),e=>e.status===400);
});
test('directory search filters school domain, deduplicates email and keeps same-name accounts',async t=>{
 const urls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{urls.push(String(url));assert.equal(init.headers.Authorization,'Bearer mock-token');return Response.json({people:[{names:[{displayName:'20624가상학생'}],emailAddresses:[{value:'h2511999@joongdong.hs.kr'},{value:'bad@gmail.com'}]},{names:[{displayName:'20624가상학생'}],emailAddresses:[{value:'h2511999@joongdong.hs.kr'},{value:'other@joongdong.hs.kr'}]}]});});
 const result=await searchSchoolPeople('가상학생',{searchSource:'directory',accessToken:'mock-token'});assert.equal(result.people.length,2);assert.equal(result.people[0].displayName,'20624가상학생');assert(!JSON.stringify(result).includes('mock-token'));assert(urls[0].includes('searchDirectoryPeople'));
});
for(const source of ['contacts','other'])test(source+' searches warm up and errors remain explicit',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async url=>{calls.push(new URL(url).searchParams.get('query'));return Response.json({results:[{person:{names:[{displayName:'교사'}],emailAddresses:[{value:'teacher@joongdong.hs.kr'}]}}]});});
 assert.equal((await searchSchoolPeople('교사',{searchSource:source})).people.length,1);assert.deepEqual(calls,['','교사']);
 t.mock.method(globalThis,'fetch',async()=>new Response('',{status:403}));await assert.rejects(searchSchoolPeople('교사',{searchSource:source}),e=>e.status===403);
});

test('real routes enforce admin/CSRF and create only scoped OAuth state, not membership',async t=>{
 const {memberDatabase,memberToken}=await import('./member-fixture.js');const {default:worker}=await import('../src/index.js');const {SESSION_COOKIE,STATE_COOKIE,unseal}=await import('../src/security.js');
 const f=memberDatabase();t.after(()=>f.sql.close());const env={DB:f.db,SESSION_SECRET:'search-test',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',EDITORIAL_ORIGIN:'https://local.test',OAUTH_REDIRECT_URI:'https://local.test/auth/callback',NEWSPAPER_CLASSROOM_ID:'unused'};
 const admin=await memberToken(env,{sub:'teacher',exp:Date.now()+60000},'admin'),student=await memberToken(env,{sub:'student',exp:Date.now()+60000});
 const send=(token,csrf=true)=>worker.fetch(new Request('https://local.test/api/admin/member-search/connect',{method:'POST',headers:{Cookie:SESSION_COOKIE+'='+token,Origin:'https://local.test',...(csrf?{'X-Editorial-CSRF':'1'}:{}),'Content-Type':'application/json'},body:JSON.stringify({source:'contacts'})}),env);
 assert.equal((await send(student)).status,403);assert.equal((await send(admin,false)).status,403);
 const result=await send(admin);assert.equal(result.status,200);const payload=await result.json();const url=new URL(payload.url);assert(url.searchParams.get('scope').includes('contacts.readonly'));assert(!url.searchParams.get('scope').includes('directory.readonly'));assert(url.searchParams.has('code_challenge'));assert(!JSON.stringify(payload).includes('accessToken'));
 const raw=result.headers.get('set-cookie').split(';')[0].slice(STATE_COOKIE.length+1);const state=await unseal(decodeURIComponent(raw),env.SESSION_SECRET);assert.equal(state.searchSource,'contacts');assert(state.searchMember);assert(state.nonce);
});
