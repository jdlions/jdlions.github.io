import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {Signup,SIGNUP_COOKIE,profileSuggestion} from '../src/signup.js';
import {signupIdentity} from '../../assets/js/shared/signup-identity.js';
import {Members} from '../src/members.js';
import {memberDatabase,memberToken} from './member-fixture.js';
import worker from '../src/index.js';
import {seal,unseal,SESSION_COOKIE,STATE_COOKIE} from '../src/security.js';
const time=new Date('2026-10-24T03:00:00Z'),code='isolated-fixture-code-only',actor={memberId:'bootstrap-editor'};
const identity=(n=1)=>({sub:String(900000+n),email:`h26110${String(n).padStart(2,'0')}@joongdong.hs.kr`,name:`110${String(n).padStart(2,'0')}가상학생`});
const input=(n=1)=>({code,name:'가상학생',studentNumber:`110${String(n).padStart(2,'0')}`,confirmed:true});
function fixture(t){
 const f=memberDatabase();t.after(()=>f.sql.close());let queue=Promise.resolve();const batch=f.db.batch.bind(f.db);f.db.batch=items=>{const next=queue.then(()=>batch(items));queue=next.catch(()=>{});return next;};
 return {...f,signup:new Signup(f.db,'fixture-secret',()=>time),members:new Members(f.db)};
}
async function enabled(signup){await signup.configure({code,enabled:true,version:0},actor);}

test('signup starts disabled; code hashing, safe settings, rotation and existing logins are independent',async t=>{
 const {signup,sql,members}=fixture(t);assert.deepEqual(await signup.settings(),{configured:false,enabled:false,version:0,updatedAt:null});
 await assert.rejects(signup.register(identity(),input()),e=>e.code==='signup_code_invalid');
 await enabled(signup);const stored=sql.prepare('SELECT * FROM member_signup_code').get();assert(!JSON.stringify(stored).includes(code));assert.equal(stored.code_hash.length,64);assert.equal(stored.salt.length,32);
 const first=await signup.register(identity(),input());assert.equal(first.role,'student');assert.equal(sql.prepare('SELECT count(*) n FROM member_audit WHERE member_id=?').get(first.memberId).n,1);
 await signup.configure({code:'replacement-fixture-code',enabled:true,version:1},actor);
 await assert.rejects(signup.register(identity(2),input(2)),e=>e.code==='signup_code_invalid');
 await signup.configure({enabled:false,version:2},actor);
 assert.equal((await members.login(identity())).memberId,first.memberId);
 assert(!JSON.stringify(await signup.settings()).includes('hash'));
 await assert.rejects(signup.configure({enabled:true,version:0},actor),e=>e.code==='signup_code_conflict');
});
test('one common code registers distinct students and preserves stable subject/email uniqueness',async t=>{
 const {signup,sql}=fixture(t);await enabled(signup);
 const a=await signup.register(identity(),input()),b=await signup.register(identity(2),input(2));assert.notEqual(a.memberId,b.memberId);
 const r=sql.prepare('SELECT * FROM members WHERE id=?').get(a.memberId);assert.equal(r.google_sub,identity().sub);assert.equal(r.student_number,'11001');assert.equal(r.cohort,36);assert.equal(r.active,1);assert.equal(r.role,'student');
 await assert.rejects(signup.register(identity(),input()),e=>e.code==='signup_existing');
 await assert.rejects(signup.register({...identity(3),email:identity().email},input(3)),e=>e.status===403);
});
test('concurrent same-account signup commits exactly one member without overwriting any record',async t=>{
 const {signup,sql}=fixture(t);await enabled(signup);
 const results=await Promise.allSettled([signup.register(identity(),input()),signup.register(identity(),input())]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(sql.prepare("SELECT count(*) n FROM members WHERE role='student'").get().n,1);
});
test('code rotation during hashing/commit cannot register with the old code',async t=>{
 const {signup,sql,db}=fixture(t);await enabled(signup);const batch=db.batch.bind(db);let calls=0;
 db.batch=items=>{if(++calls===2)sql.prepare('UPDATE member_signup_code SET enabled=0,version=version+1 WHERE id=1').run();return batch(items);};
 await assert.rejects(signup.register(identity(),input()),e=>e.code==='signup_code_invalid');assert.equal(sql.prepare("SELECT count(*) n FROM members WHERE role='student'").get().n,0);
});
test('disabled and manually registered members cannot enter new-registration path or change their identity',async t=>{
 const {signup,members,sql}=fixture(t);await enabled(signup);
 const row=await members.save(null,{name:'기존학생',email:identity().email,role:'student',studentNumber:'11001',cohort:36,active:false},actor);
 await assert.rejects(signup.register(identity(),input()),e=>e.status===403);assert.equal((await members.get(row.id)).google_sub,null);
 const restored=await members.save(row.id,{name:'기존학생',email:identity().email,role:'student',studentNumber:'11001',cohort:36,active:true,version:row.version},actor);
 const login=await members.login(identity(),{allowUnknown:true});assert.equal(login.memberId,restored.id);assert.equal(login.name,'기존학생');
 assert.equal(sql.prepare('SELECT count(*) n FROM members').get().n,2);
});
test('code attempts are durably limited per verified account, regardless of new pending cookies',async t=>{
 const {signup,sql}=fixture(t);await enabled(signup);
 for(let i=0;i<5;i++)await assert.rejects(signup.register(identity(),{...input(),code:'wrong-code-fixture'}),e=>e.code==='signup_code_invalid');
 await assert.rejects(signup.register(identity(),input()),e=>e.status===429);
 assert.equal(sql.prepare("SELECT attempts FROM member_signup_attempts WHERE bucket='global'").get().attempts,5);
 assert(!JSON.stringify(sql.prepare('SELECT * FROM member_signup_attempts').all()).includes(identity().sub));
 const later=new Signup(signup.db,'fixture-secret',()=>new Date(time.getTime()+900000));assert.equal((await later.register(identity(),input())).role,'student');
});
test('server derives cohort from admission year; display-name current number never comes from email',()=>{
 assert.deepEqual(signupIdentity({email:'h2511999@joongdong.hs.kr',name:'20624가상학생'},time),{email:'h2511999@joongdong.hs.kr',name:'가상학생',studentNumber:'20624',cohort:35,grade:2,eligible:true,numberMatches:true});
 for(const [year,cohort] of [[2026,36],[2027,37],[2028,38]])assert.equal(signupIdentity({email:`h${String(year).slice(2)}11001@joongdong.hs.kr`,name:'11001학생'},new Date(`${year}-03-01T00:00:00+09:00`)).cohort,cohort);
 assert.equal(signupIdentity({email:'h2611001@joongdong.hs.kr',name:'11001학생'},new Date('2027-02-28T14:59:59Z')).grade,1);
 assert.equal(signupIdentity({email:'h2611001@joongdong.hs.kr',name:'21001학생'},new Date('2027-02-28T15:00:00Z')).grade,2);
 assert.equal(signupIdentity({email:'teacher@joongdong.hs.kr',name:'교사'},time).eligible,false);
 assert.equal(signupIdentity({...identity(),name:'예외적 표시 이름'},time).studentNumber,'');
});
test('grade conflict and teacher/role/identity injection fail; exceptional display name can be confirmed manually',async t=>{
 const {signup}=fixture(t);await enabled(signup);
 for(const [i,patch] of [{studentNumber:'21001'},{role:'teacher'},{email:'editor@joongdong.hs.kr'},{cohort:35},{confirmed:false}].entries())await assert.rejects(signup.register(identity(i+1),{...input(i+1),...patch}),e=>e.status===400);
 await assert.rejects(signup.register({sub:'2',email:'teacher@joongdong.hs.kr',name:'교사'},input()),e=>e.code==='signup_review_required');
 assert.equal((await signup.register({...identity(10),name:'확인필요'},input(10))).role,'student');
});
test('promotion suggests explicit confirmation, preserves cohort/name and flags ambiguous profiles',()=>{
 const base={role:'student',studentNumber:'11016',cohort:35,name:'가상학생',googleName:'20624가상학생'};
 assert.deepEqual(profileSuggestion(base,time),{studentNumber:'20624'});
 assert.deepEqual(profileSuggestion({...base,googleName:'20624다른이름'},time),{conflict:true});
 assert.equal(profileSuggestion({...base,googleName:'가상학생'},time),null);
 assert.equal(profileSuggestion({...base,studentNumber:'20624'},time),null);
});
test('new signup routes require authenticated pending state and Origin/CSRF; no pending access to business APIs',async t=>{
 const f=fixture(t),env={DB:f.db,SESSION_SECRET:'fixture-secret'},pending=await seal({kind:'signup',identity:identity(),accessToken:'PRIVATE_TOKEN',tokenExpiresAt:Date.now()+60000,exp:Date.now()+60000},env.SESSION_SECRET);
 const send=(path,method='GET',body,headers={})=>worker.fetch(new Request('https://local.test'+path,{method,headers:{Cookie:SIGNUP_COOKIE+'='+pending,Origin:'https://local.test','X-Editorial-CSRF':'1',...headers},...(body?{body:JSON.stringify(body)}:{})}),env);
 const p=await send('/api/signup');assert.equal(p.status,200);assert(!JSON.stringify(await p.json()).includes('PRIVATE_TOKEN'));
 assert.equal((await send('/api/native/articles?limit=5')).status,401);
 assert.equal((await send('/api/signup','POST',input(),{Origin:'https://evil.invalid'})).status,403);
 assert.equal((await send('/api/signup','POST',input(),{'X-Editorial-CSRF':''})).status,403);
 assert.equal((await send('/api/signup','POST',input(),{Cookie:''})).status,401);
 await enabled(f.signup);const r=await send('/api/signup','POST',input());assert.equal(r.status,201,await r.clone().text());assert.match(r.headers.get('content-type'),/application\/json/);assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.equal(r.headers.getSetCookie().length,3);
 const sessionCookie=r.headers.getSetCookie().find(v=>v.startsWith(SESSION_COOKIE+'=')).split(';')[0];
 const who=await send('/api/session','GET',null,{Cookie:sessionCookie});assert.equal((await who.json()).user.role,'student');
 assert.equal((await send('/api/signup','POST',input())).status,409);
});
test('only teachers can configure code; disabling a student revokes signup-issued session without deleting history',async t=>{
 const f=fixture(t),env={DB:f.db,SESSION_SECRET:'fixture-secret'};await enabled(f.signup);const membership=await f.signup.register(identity(),input());
 const user={...membership,sub:identity().sub,exp:Date.now()+60000},token=await seal(user,env.SESSION_SECRET);
 const request=(cookie,method='GET',body)=>worker.fetch(new Request('https://local.test/api/admin/signup-code',{method,headers:{Cookie:cookie,Origin:'https://local.test','X-Editorial-CSRF':'1'},...(body?{body:JSON.stringify(body)}:{})}),env);
 assert.equal((await request(SESSION_COOKIE+'='+token)).status,403);
 const admin=await memberToken(env,{sub:'teacher',exp:Date.now()+60000},'admin');const s=await request(SESSION_COOKIE+'='+admin);assert.equal(s.status,200);assert.equal('code_hash' in await s.json(),false);
 const row=await f.members.get(membership.memberId);await f.members.save(row.id,{name:row.name,email:row.email,role:'student',studentNumber:row.student_number,cohort:row.cohort,active:false,version:row.auth_version},actor);
 await assert.rejects(f.members.authenticate(user),e=>e.status===401);await assert.rejects(f.signup.register(identity(),input()),e=>e.status===403);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM members WHERE id=?').get(row.id).n,1);
});
test('confirmed profile-number update preserves subject/cohort and revokes stale sessions',async t=>{
 t.mock.timers.enable({apis:['Date'],now:time});
 const f=fixture(t),env={DB:f.db,SESSION_SECRET:'fixture-secret'};
 const saved=await f.members.save(null,{name:'가상학생',email:'h2511999@joongdong.hs.kr',role:'student',studentNumber:'11016',cohort:35,active:true},actor);
 const claims={...await f.members.login({sub:'999',email:saved.email}),sub:'999',googleName:'20624가상학생',exp:Date.now()+60000};
 const token=await seal(claims,env.SESSION_SECRET);
 const confirm=number=>worker.fetch(new Request('https://local.test/api/member-profile/confirm',{method:'POST',headers:{Cookie:SESSION_COOKIE+'='+token,Origin:'https://local.test','X-Editorial-CSRF':'1'},body:JSON.stringify({studentNumber:number,confirmed:true})}),env);
 assert.equal((await confirm('21000')).status,400);assert.equal((await f.members.get(saved.id)).student_number,'11016');
 const response=await confirm('20624');assert.equal(response.status,200,await response.clone().text());const row=await f.members.get(saved.id);assert.equal(row.google_sub,'999');assert.equal(row.cohort,35);assert.equal(row.name,'가상학생');assert.equal(row.student_number,'20624');
 await assert.rejects(f.members.authenticate(claims),e=>e.status===401);
 const raw=response.headers.getSetCookie()[0].split(';')[0].slice(SESSION_COOKIE.length+1);assert.equal((await f.members.authenticate(await unseal(decodeURIComponent(raw),env.SESSION_SECRET))).studentId,'999');
});
test('real OAuth callback separates existing members from verified newcomers without People scopes',async t=>{
 const f=fixture(t),env={DB:f.db,SESSION_SECRET:'fixture-secret',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'PRIVATE',EDITORIAL_ORIGIN:'https://local.test',OAUTH_REDIRECT_URI:'https://local.test/auth/callback'};
 const keys=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'signup-key',alg:'RS256'};let person,nonce;
 t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).includes('/certs'))return Response.json({keys:[jwk]});
  assert.equal(String(url),'https://oauth2.googleapis.com/token');
  const jwt=await new SignJWT({email:person.email,email_verified:true,hd:'joongdong.hs.kr',nonce,name:person.name}).setSubject(person.sub).setIssuer('https://accounts.google.com').setAudience('client').setIssuedAt().setExpirationTime('5m').setProtectedHeader({alg:'RS256',kid:'signup-key'}).sign(keys.privateKey);
  return Response.json({id_token:jwt,access_token:'PRIVATE',token_type:'Bearer',expires_in:3600});
 });
 async function login(who){person=who;const start=await worker.fetch(new Request('https://local.test/auth/login'),env),url=new URL(start.headers.get('location'));assert(!url.searchParams.get('scope').includes('readonly'));const stateCookie=start.headers.getSetCookie()[0].split(';')[0],saved=await unseal(decodeURIComponent(stateCookie.slice(STATE_COOKIE.length+1)),env.SESSION_SECRET);nonce=saved.nonce;
  return worker.fetch(new Request('https://local.test/auth/callback?code=fixture&state='+saved.state,{headers:{Cookie:stateCookie}}),env);
 }
 const fresh=await login(identity());assert.equal(fresh.status,302);assert.equal(fresh.headers.get('location'),'https://local.test/editorial/signup/');assert(fresh.headers.getSetCookie().some(c=>c.startsWith(SIGNUP_COOKIE+'=')&&!c.includes('Max-Age=0')));
 const saved=await f.members.save(null,{name:'기존',email:identity().email,role:'student',studentNumber:'11001',cohort:36,active:true},actor);
 const existing=await login(identity());assert.equal(existing.status,302);assert.equal(existing.headers.get('location'),'https://local.test/editorial/student/');assert.equal((await f.members.get(saved.id)).google_sub,identity().sub);
 const editor=await login({sub:'111',email:'editor@joongdong.hs.kr',name:'교사'});assert.match(editor.headers.get('location'),/admin\/$/);
 const row=await f.members.get(saved.id);await f.members.save(row.id,{name:'기존',email:row.email,role:'student',studentNumber:'11001',cohort:36,active:false,version:row.auth_version},actor);
 assert.equal((await login(identity())).status,403);
});
