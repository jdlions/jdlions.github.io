import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';
import {memberToken} from './member-fixture.js';
import {SESSION_COOKIE} from '../src/security.js';
test('member HTTP routes enforce registered roles, CSRF, Origin, no-delete and safe payloads',async t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const db={prepare(q){let a=[];const s={bind(...v){a=v;return s;},async first(){return sql.prepare(q).get(...a)??null;},async all(){return {results:sql.prepare(q).all(...a)};},async run(){return sql.prepare(q).run(...a);}};return s;}};
 const env={DB:db,SESSION_SECRET:'isolated-members'};
 const teacher=await memberToken(env,{sub:'123',exp:Date.now()+60000},'admin'),student=await memberToken(env,{sub:'456',exp:Date.now()+60000},'student');
 t.mock.method(globalThis,'fetch',()=>{throw new Error('No Google or production writes');});
 const headers={Cookie:SESSION_COOKIE+'='+teacher,Origin:'https://local.test','X-Editorial-CSRF':'1','Content-Type':'application/json'};
 const send=(path='/api/admin/members',method='GET',body,extra={})=>worker.fetch(new Request('https://local.test'+path,{method,headers:{...headers,...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
 for(const path of ['/api/admin/members','/api/members/roster','/api/classroom/students']){
 assert.equal((await send(path,'GET',undefined,{Cookie:''})).status,401);
 assert.equal((await send(path,'GET',undefined,{Cookie:SESSION_COOKIE+'='+student})).status,403);
 const r=await send(path);assert.equal(r.status,200);assert.match(r.headers.get('Cache-Control'),/no-store/);}
 const input={name:'New Teacher',email:'new@joongdong.hs.kr',role:'teacher',active:true};
 for(const extra of [{Origin:'https://evil.example'},{'X-Editorial-CSRF':''},{Cookie:SESSION_COOKIE+'='+student}])assert.equal((await send('/api/admin/members','POST',input,extra)).status,403);
 for(const body of [null,[],{}, {...input,email:'new@gmail.com'}])assert.equal((await send('/api/admin/members','POST',body)).status,400);
 const created=await send('/api/admin/members','POST',input);assert.equal(created.status,201);const member=await created.json();assert.equal(member.linked,false);
 assert.equal((await send('/api/admin/members','POST',input)).status,409);
 assert.equal((await send('/api/admin/members/'+member.id,'DELETE',{})).status,409);
 const changed=await send('/api/admin/members/'+member.id,'PATCH',{...input,active:false,version:member.version});assert.equal(changed.status,200);
 assert.equal((await send('/api/admin/members/'+member.id,'PATCH',{...input,version:member.version})).status,409);
 assert.equal((await send('/api/admin/cohorts','POST',{number:37})).status,201);
 assert.equal((await send('/api/admin/cohorts','POST',null)).status,400);
 assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
});
