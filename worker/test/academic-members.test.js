import test from 'node:test';
import assert from 'node:assert/strict';
import {academicYear,currentCohorts,suggestedCohort,isActivityEligible} from '../../assets/js/shared/student-identity.js';
import {Members} from '../src/members.js';
import {memberDatabase,memberToken} from './member-fixture.js';
import worker,{validateCampaign} from '../src/index.js';
import {SESSION_COOKIE} from '../src/security.js';
import {D1EditorialRepository} from '../src/repository.js';

test('KST academic boundary and recommendations remain correct through 2028',()=>{
 for(const year of [2026,2027,2028]){
  const before=`${year}-02-28T14:59:59.999Z`,after=`${year}-02-28T15:00:00.000Z`;
  // 2028 is a leap year: February 29 is still in the preceding academic year.
  const boundary=year===2028?'2028-02-29T15:00:00Z':after;
  assert.equal(academicYear(before),year-1);
  assert.equal(academicYear(boundary),year);
  assert.deepEqual(currentCohorts(boundary),[year-1990,year-1991]);
  assert.equal(suggestedCohort('11001',boundary),year-1990);
  assert.equal(suggestedCohort('21001',boundary),year-1991);
  assert.equal(suggestedCohort('31001',boundary),null);
  assert.equal(isActivityEligible({role:'student',cohort:year-1992},boundary),false);
  assert.equal(isActivityEligible({role:'teacher'},boundary),true);
 }
 assert.equal(academicYear('2028-02-29T14:59:59.999Z'),2027);
 assert.equal(isActivityEligible({cohort:36},'2027-03-01T00:00:00+09:00'),true);
 assert.equal(isActivityEligible({cohort:35},'2027-03-01T00:00:00+09:00'),false);
});

test('activity filtering never changes registration, login or existing article ownership',async t=>{
 const f=memberDatabase();t.after(()=>f.sql.close());const members=new Members(f.db);
 await members.cohort({number:34});
 const row=await members.save(null,{name:'졸업 기수',email:'h2411001@joongdong.hs.kr',studentNumber:'21001',cohort:34,role:'student',active:true},{memberId:'bootstrap-editor'});
 const claims=await members.login({sub:'old-owner',email:row.email});
 const repo=new D1EditorialRepository(f.db);
 const campaign=await repo.createCampaign(validateCampaign({name:'기존 배정',audienceMode:'selected',recipientStudentIds:['old-owner'],slots:[{articleType:'school',displayName:'학교',required:true,quantity:1}]}),'teacher');
 await repo.distributeCampaign(campaign,await members.roster());
 const instances=await repo.listAssignments('old-owner');
 const article=await repo.createArticleForAssignment(await repo.getAssignmentInstance(instances[0].id),'old-owner');
 await repo.saveStudentDraft(article.id,{articleType:'school',titleKo:'과거 원고',titleEn:'',contentHtml:'<p>보존할 원고</p>'});
 const preserved=f.sql.prepare('SELECT * FROM articles').all();
 const assignments=f.sql.prepare('SELECT * FROM assignment_slot_instances').all();
 const before=f.sql.prepare('SELECT * FROM members WHERE id=?').get(row.id);
 assert.equal((await members.list(new URLSearchParams())).members.some(m=>m.id===row.id),false);
 assert.equal((await members.list(new URLSearchParams({activity:'all'}))).members.some(m=>m.id===row.id),true);
 assert.equal((await members.roster({forAssignment:true})).length,0);
 assert.equal((await members.roster()).length,1);
 assert.equal((await members.authenticate({...claims,sub:'old-owner'})).studentId,'old-owner');
 assert.deepEqual(f.sql.prepare('SELECT * FROM members WHERE id=?').get(row.id),before);
 assert.deepEqual(f.sql.prepare('SELECT * FROM articles').all(),preserved);
 assert.deepEqual(f.sql.prepare('SELECT * FROM assignment_slot_instances').all(),assignments);
 assert.equal((await repo.listAssignments('old-owner')).length,1);
 await assert.rejects(members.list(new URLSearchParams({activity:'bad'})),e=>e.status===400);
});

test('future academic cohorts appear virtually and are persisted only on actual registration',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2028-03-01T00:00:00+09:00')});
 const f=memberDatabase();t.after(()=>f.sql.close());const members=new Members(f.db);
 const before=f.sql.prepare('SELECT * FROM member_cohorts').all();
 const listing=await members.list(new URLSearchParams());
 assert(listing.cohorts.includes(38));assert(listing.cohorts.includes(37));
 assert.deepEqual(f.sql.prepare('SELECT * FROM member_cohorts').all(),before);
 const row=await members.save(null,{name:'신입생',email:'h2811001@joongdong.hs.kr',studentNumber:'11002',cohort:38,role:'student',active:true},{memberId:'bootstrap-editor'});
 assert.equal(row.cohort,38);assert.equal(row.studentNumber,'11002');
 assert.equal((await members.roster({forAssignment:true})).length,1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM member_cohorts WHERE number=38').get().n,1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM member_cohorts WHERE number=37').get().n,0);
});

test('new assignment APIs reject retired cohorts even with misleading current school numbers',async t=>{
 const f=memberDatabase();t.after(()=>f.sql.close());const members=new Members(f.db);
 await members.cohort({number:34});
 const retired=await members.save(null,{name:'기존 회원',email:'h2411001@joongdong.hs.kr',studentNumber:'11001',cohort:34,role:'student',active:true},{memberId:'bootstrap-editor'});
 const current=await members.save(null,{name:'활동 회원',email:'h2611002@joongdong.hs.kr',studentNumber:'11002',cohort:36,role:'student',active:true},{memberId:'bootstrap-editor'});
 const env={DB:f.db,SESSION_SECRET:'academic-test'};
 const token=await memberToken(env,{sub:'teacher',exp:Date.now()+60000},'admin');
 const request=(path,method='GET',body)=>worker.fetch(new Request('https://local.test'+path,{method,headers:{Cookie:`${SESSION_COOKIE}=${token}`,Origin:'https://local.test','X-Editorial-CSRF':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
 const payload={name:'새 과제',audienceMode:'selected',recipientStudentIds:['member:'+retired.id],slots:[{articleType:'school',displayName:'학교',quantity:1}]};
 assert.equal((await request('/api/assignments','POST',payload)).status,400);
 const created=await request('/api/assignments','POST',{...payload,recipientStudentIds:[]});assert.equal(created.status,201);
 const campaign=await created.json();
 for(const ids of [['member:'+retired.id],['member:'+current.id,'member:'+retired.id]])assert.equal((await request(`/api/assignments/${campaign.id}/distribute`,'POST',{audienceMode:'selected',studentIds:ids})).status,400);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM assignment_recipients').get().n,0);
 assert.equal((await request('/api/members/roster')).status,200);
 assert.deepEqual((await (await request('/api/members/roster')).json()).students.map(s=>s.memberId),[current.id]);
});
