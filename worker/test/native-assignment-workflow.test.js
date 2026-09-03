import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateCampaign } from '../src/index.js';

test('campaign validation supports the school plus feature default and clamps quantities',()=>{
  const campaign=validateCampaign({name:'2027 기사 작성',year:2027,audienceMode:'all',slots:[
    {articleType:'school',displayName:'학교기사',required:true,quantity:1},
    {articleType:'feature',displayName:'피처기사',required:true,quantity:99}
  ]});
  assert.equal(campaign.slots[0].articleType,'school');
  assert.equal(campaign.slots[1].articleType,'feature');
  assert.equal(campaign.slots[1].quantity,10);
  assert.throws(()=>validateCampaign({name:'',slots:[]}),error=>error.code==='invalid_assignment');
});

test('assignment migration is additive, idempotent, and enforces one article per student slot',async()=>{
  const sql=await readFile(new URL('../migrations/0004_assignments.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS assignment_campaigns/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS assignment_slots/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS assignment_recipients/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS assignment_slot_instances/);
  assert.match(sql,/UNIQUE\(student_id, slot_id, ordinal\)/);
  assert.match(sql,/article_id TEXT UNIQUE/);
  assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM articles|ON DELETE CASCADE[\s\S]*assignment_slot_instances/i);
});

test('API keeps assignment creation admin-only and slot article creation student-owned',async()=>{
  const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
  assert.match(source,/assignments'&&request\.method==='POST'\)\{requireAdmin/);
  assert.match(source,/assignmentArticle&&request\.method==='POST'\)\{requireStudent/);
  assert.match(source,/instance\.student_id!==viewer\.studentId/);
  assert.match(source,/ensureAssignmentWritable/);
});

test('student and admin surfaces expose native assignments without Classroom coursework',async()=>{
  const [student,admin,service]=await Promise.all([
    readFile(new URL('../../assets/js/student/student-app.js',import.meta.url),'utf8'),
    readFile(new URL('../../assets/js/admin/admin-app.js',import.meta.url),'utf8'),
    readFile(new URL('../../assets/js/services/production-editorial-service.js',import.meta.url),'utf8')
  ]);
  assert.match(student,/내 과제/);assert.match(student,/openAssignmentArticle/);assert.match(student,/typeLocked/);assert.match(student,/\.docx,\.txt/);
  assert.match(admin,/과제 관리/);assert.match(admin,/학교기사/);assert.match(admin,/피처기사/);assert.match(admin,/data-assignment-student/);
  assert.doesNotMatch(service,/\/coursework/);assert.doesNotMatch(service,/api\/classroom\/courses/);
});
