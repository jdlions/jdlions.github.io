import test from 'node:test';
import assert from 'node:assert/strict';
import {Members,validateMember} from '../src/members.js';
import {memberDatabase} from './member-fixture.js';
const actor={memberId:'bootstrap-editor'};
const student=(extra={})=>({name:'학생',email:'h2611001@joongdong.hs.kr',studentNumber:'11001',cohort:36,role:'student',active:true,...extra});
function fixture(t){const f=memberDatabase();t.after(()=>f.sql.close());return {...f,members:new Members(f.db)};}

test('only explicitly registered active school accounts can bind; Classroom grants no access',async t=>{
  const {members,sql}=fixture(t);
  await assert.rejects(members.login({sub:'123',email:'h2611001@joongdong.hs.kr'}),e=>e.status===403);
  const row=await members.save(null,student(),actor);
  assert.equal((await members.roster())[0].id,'member:'+row.id);
  const claims=await members.login({sub:'123',email:row.email});
  assert.equal(claims.studentId,'123');assert.equal(claims.role,'student');
  assert.deepEqual(await members.roster(),[{id:'123',memberId:row.id,name:'11001 학생',studentNumber:'11001',cohort:36,linked:true,identityState:'linked'}]);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM member_audit WHERE action='linked'").get().n,1);
  await assert.rejects(members.login({sub:'456',email:row.email}),e=>e.status===403);
  assert.equal(sql.prepare('SELECT google_sub FROM members WHERE id=?').get(row.id).google_sub,'123');
});
test('teacher accounts are school-only and students cannot use domain membership to self-register',()=>{
  for(const email of ['teacher@gmail.com','teacher@evil.joongdong.hs.kr','teacher@joongdong.hs.kr.evil'])assert.throws(()=>validateMember({name:'교사',email,role:'teacher',active:true}),e=>e.status===400);
  assert.equal(validateMember({name:'교사',email:'Teacher@joongdong.hs.kr',role:'teacher',active:true}).email,'teacher@joongdong.hs.kr');
  for(const input of [null,[],{},student({email:'student@joongdong.hs.kr'}),student({studentNumber:'bad'}),student({cohort:0})])assert.throws(()=>validateMember(input),e=>e.status===400);
});
test('deactivation and role edits revoke existing sessions immediately; reactivation does not revive old sessions',async t=>{
  const {members}=fixture(t);let row=await members.save(null,student(),actor);
  const claims={...await members.login({sub:'123',email:row.email}),sub:'123',role:'admin'};
  assert.equal((await members.authenticate(claims)).role,'student');
  row=await members.save(row.id,{...student(),version:row.version,active:false},actor);
  await assert.rejects(members.authenticate(claims),e=>e.status===401);
  await assert.rejects(members.login({sub:'123',email:row.email}),e=>e.status===403);
  row=await members.save(row.id,{...student(),version:row.version},actor);
  await assert.rejects(members.authenticate(claims),e=>e.status===401);
  const fresh={...await members.login({sub:'123',email:row.email}),sub:'123'};
  assert.equal((await members.authenticate(fresh)).studentId,'123');
  await assert.rejects(members.authenticate({...fresh,sub:'other'}),e=>e.status===401);
  await assert.rejects(members.authenticate({sub:'123',role:'admin'}),e=>e.status===401);
});
test('email changes preserve Google ownership and reject a replacement account with the same email',async t=>{
  const {members,sql}=fixture(t);let row=await members.save(null,student(),actor);
  await members.login({sub:'123',email:row.email});
  row=await members.save(row.id,{...student({email:'h2621001@joongdong.hs.kr',studentNumber:'21001',cohort:35}),version:row.version},actor);
  assert.equal((await members.login({sub:'123',email:row.email})).studentId,'123');
  await assert.rejects(members.login({sub:'456',email:row.email}),e=>e.status===403);
  assert.throws(()=>sql.prepare('UPDATE members SET google_sub=? WHERE id=?').run('456',row.id),/member_identity_immutable/);
  assert.throws(()=>sql.prepare('DELETE FROM members WHERE id=?').run(row.id),/member_history_protected/);
});
test('duplicates, stale updates, bootstrap lockout and unknown cohorts fail without partial writes',async t=>{
  const {members}=fixture(t);const row=await members.save(null,student(),actor);
  await assert.rejects(members.save(null,student(),actor),e=>e.code==='member_duplicate');
  await assert.rejects(members.save(row.id,{...student(),version:0},actor),e=>e.code==='member_conflict');
  await assert.rejects(members.save(null,student({cohort:37}),actor),e=>e.code==='unknown_cohort');
  await members.cohort({number:37});
  const editor=await members.get('bootstrap-editor');
  await assert.rejects(members.save(editor.id,{name:editor.name,email:editor.email,role:'teacher',active:false,version:1},{memberId:'other'}),e=>e.code==='teacher_protected');
  await assert.rejects(members.save(editor.id,{name:editor.name,email:editor.email,role:'teacher',active:false,version:1},actor),e=>e.code==='self_lockout_blocked');
  assert.equal((await members.get(row.id)).auth_version,1);
});
test('search escapes wildcard and SQL input; list omits immutable Google identifiers',async t=>{
  const {members}=fixture(t);await members.save(null,student(),actor);
  for(const q of ['%',"' OR 1=1 --",'_'])assert.equal((await members.list(new URLSearchParams({q}))).members.length,0);
  const result=await members.list(new URLSearchParams({q:'11001',role:'student',cohort:'36'}));
  assert.equal(result.members.length,1);assert.equal('google_sub' in result.members[0],false);
});
