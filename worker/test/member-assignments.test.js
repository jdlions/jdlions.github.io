import test from 'node:test';
import assert from 'node:assert/strict';
import {memberDatabase,memberToken} from './member-fixture.js';
import {Members} from '../src/members.js';
import {D1EditorialRepository} from '../src/repository.js';
import worker from '../src/index.js';
import {SESSION_COOKIE} from '../src/security.js';
const actor={memberId:'bootstrap-editor'};
const input={name:'등록 학생',email:'h2611001@joongdong.hs.kr',studentNumber:'11001',cohort:36,role:'student',active:true};
async function fixture(t){const f=memberDatabase();t.after(()=>f.sql.close());const members=new Members(f.db),repo=new D1EditorialRepository(f.db),member=await members.save(null,input,actor);return {...f,members,repo,member};}
async function campaign(repo,ids=[]){return repo.createCampaign({name:'로그인 전 배정',year:2026,issueLabel:'',issueId:null,instructions:'',startsAt:null,dueAt:null,audienceMode:'selected',recipientStudentIds:ids,slots:[{articleType:'school',displayName:'학교',required:true,quantity:1,dueAt:null,instructions:''},{articleType:'feature',displayName:'피처',required:true,quantity:2,dueAt:null,instructions:''}]},'teacher');}
const identity={sub:'123456789',email:input.email};

test('pre-login selection/distribution resolves only verified owner; repeat login and distribution preserve submissions',async t=>{
 const {members,repo,member,sql}=await fixture(t),roster=await members.roster(),c=await campaign(repo,[roster[0].id]);
 assert.equal(roster[0].id,'member:'+member.id);
 await repo.distributeCampaign(c,roster);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM assignment_recipients').get().n,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM assignment_slot_instances').get().n,0);
 assert.equal((await repo.listCampaigns())[0].recipientStudentIds[0],roster[0].id);
 assert.equal((await repo.getCampaign(c.id)).pendingRecipientCount,1);
 await assert.rejects(members.login({...identity,email:'h2611002@joongdong.hs.kr'}));
 await members.login(identity);
 const rows=await repo.listAssignments(identity.sub);assert.equal(rows.length,3);
 assert.equal((await repo.getCampaign(c.id)).pendingRecipientCount,0);
 assert.equal((await repo.listAssignments('other')).length,0);
 const instance=await repo.getAssignmentInstance(rows[0].id),article=await repo.createArticleForAssignment(instance,identity.sub);
 await repo.saveStudentDraft(article.id,{articleType:article.articleType,titleKo:'보존',titleEn:'',contentHtml:'<p>기존 원고</p>'});
 const current=await repo.getNativeArticle(article.id);await repo.submitNativeArticle(current,identity.sub);
 const snapshot=sql.prepare('SELECT * FROM assignment_slot_instances ORDER BY id').all();
 const submissions=sql.prepare('SELECT * FROM article_revisions ORDER BY id').all();
 await members.login(identity);await repo.distributeCampaign(c,await members.roster());
 assert.deepEqual(sql.prepare('SELECT * FROM assignment_slot_instances ORDER BY id').all(),snapshot);
 assert.deepEqual(sql.prepare('SELECT * FROM article_revisions ORDER BY id').all(),submissions);
 assert.equal((await repo.getCampaign(c.id)).recipientStudentIds[0],identity.sub);
 assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('legacy Google recipients and submitted instances win over pending registration for the same account',async t=>{
 const {members,repo,sql}=await fixture(t),c=await campaign(repo,[identity.sub]);
 await repo.distributeCampaign(c,[{id:identity.sub,name:'기존 학생'}]);
 const old=await repo.listAssignments(identity.sub),article=await repo.createArticleForAssignment(await repo.getAssignmentInstance(old[0].id),identity.sub);
 await repo.submitNativeArticle(article,identity.sub);
 const before=sql.prepare('SELECT * FROM assignment_slot_instances ORDER BY id').all();
 const recipient=sql.prepare('SELECT * FROM assignment_recipients').all();
 await repo.distributeCampaign(c,await members.roster());await members.login(identity);
 assert.deepEqual(sql.prepare('SELECT * FROM assignment_slot_instances ORDER BY id').all(),before);
 assert.deepEqual(sql.prepare('SELECT * FROM assignment_recipients').all(),recipient);
 assert.equal((await repo.listAssignments(identity.sub)).length,3);
 assert.equal((await repo.getCampaign(c.id)).recipientStudentIds.length,1);
});

test('login before distribution using an old roster snapshot resolves current verified Google ID',async t=>{
 const {members,repo}=await fixture(t),roster=await members.roster(),c=await campaign(repo,[roster[0].id]);
 await members.login(identity);assert.equal((await repo.listAssignments(identity.sub)).length,0);
 await repo.distributeCampaign(c,roster);assert.equal((await repo.listAssignments(identity.sub)).length,3);
});

test('deactivation, email reassignment and failed binding cannot transfer pending assignments',async t=>{
 const {members,repo,member,sql}=await fixture(t),c=await campaign(repo,['member:'+member.id]);
 await repo.distributeCampaign(c,await members.roster());
 await assert.rejects(members.save(member.id,{...input,email:'h2611002@joongdong.hs.kr',version:1},actor),e=>e.code==='assigned_member_email_locked');
 assert.throws(()=>sql.prepare('UPDATE members SET email=? WHERE id=?').run('h2611002@joongdong.hs.kr',member.id),/member_pending_email_locked/);
 let row=await members.save(member.id,{...input,active:false,version:1},actor);
 assert.equal((await members.roster()).length,0);await assert.rejects(members.login(identity));
 row=await members.save(member.id,{...input,version:row.version},actor);
 sql.exec("CREATE TRIGGER fail_resolution BEFORE INSERT ON assignment_slot_instances BEGIN SELECT RAISE(ABORT,'isolated failure'); END;");
 await assert.rejects(members.login(identity),e=>e.code==='member_link_conflict');
 assert.equal((await members.get(member.id)).google_sub,null);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM assignment_recipients').get().n,0);
 sql.exec('DROP TRIGGER fail_resolution');await members.login(identity);
 await assert.rejects(members.login({...identity,sub:'999'}));
 assert.equal((await repo.listAssignments('999')).length,0);
 assert.equal((await repo.listAssignments(identity.sub)).length,3);
});

test('deleting a pending campaign removes intent; first login cannot resurrect deleted assignments',async t=>{
 const {members,repo,sql}=await fixture(t),c=await campaign(repo);
 await repo.distributeCampaign(c,await members.roster());await repo.deleteCampaign(c.id);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM member_assignment_targets').get().n,0);
 await members.login(identity);assert.equal((await repo.listAssignments(identity.sub)).length,0);
});

test('real Worker routes accept registered pre-login recipients, deny forged/teacher recipients and enforce student ownership',async t=>{
 const {members,repo,db,member}=await fixture(t),env={DB:db,SESSION_SECRET:'test-only-member-assignments'};
 const teacher=await memberToken(env,{sub:'555',exp:Date.now()+60000},'admin');
 const headers={Cookie:SESSION_COOKIE+'='+teacher,Origin:'https://local.test','X-Editorial-CSRF':'1','Content-Type':'application/json'};
 const send=(path,method='GET',body,token=teacher)=>worker.fetch(new Request('https://local.test'+path,{method,headers:{...headers,Cookie:SESSION_COOKIE+'='+token},...(body?{body:JSON.stringify(body)}:{})}),env);
 const base={name:'과제',audienceMode:'selected',slots:[{articleType:'school',displayName:'학교',quantity:1}]};
 for(const id of ['member:missing','member:bootstrap-editor','forged-google-id'])assert.equal((await send('/api/assignments','POST',{...base,recipientStudentIds:[id]})).status,400);
 const created=await send('/api/assignments','POST',{...base,recipientStudentIds:['member:'+member.id]});assert.equal(created.status,201);const c=await created.json();
 await members.login(identity); // The UI still holds the pre-login recipient reference.
 assert.equal((await send(`/api/assignments/${c.id}/distribute`,'POST',{audienceMode:'selected',studentIds:['member:'+member.id]})).status,200);
 const mine=await memberToken(env,{sub:identity.sub,exp:Date.now()+60000}),other=await memberToken(env,{sub:'777',exp:Date.now()+60000});
 const assignments=await repo.listAssignments(identity.sub);assert.equal(assignments.length,1);
 const path=`/api/assignments/instances/${assignments[0].id}/article`;
 assert.equal((await send(path,'POST',{},other)).status,404);
 const opened=await send(path,'POST',{},mine);assert.equal(opened.status,201);const article=await opened.json();assert.equal(article.studentId,identity.sub);assert.equal('internalNote' in article,false);
});
