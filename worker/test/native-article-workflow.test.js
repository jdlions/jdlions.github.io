import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canViewNativeArticle, validateNativeDraft } from '../src/index.js';

test('native draft validation sanitizes content and requires type and title',()=>{
  const draft=validateNativeDraft({articleType:'feature',titleKo:'  학교 축제  ',titleEn:'Festival',contentHtml:'<p>Hello</p><script>alert(1)</script>'});
  assert.equal(draft.titleKo,'학교 축제');
  assert.equal(draft.articleType,'feature');
  assert.doesNotMatch(draft.contentHtml,/<script>/);
  assert.throws(()=>validateNativeDraft({articleType:'',titleKo:'',contentHtml:''}),error=>error.code==='invalid_article');
});

test('students can only view their own native articles while admins can view all',()=>{
  const article={studentId:'student-a'};
  assert.equal(canViewNativeArticle(article,{role:'student',studentId:'student-a'}),true);
  assert.equal(canViewNativeArticle(article,{role:'student',studentId:'student-b'}),false);
  assert.equal(canViewNativeArticle(article,{role:'admin'}),true);
});

test('migration is additive and preserves immutable revisions plus native photo links',async()=>{
  const sql=await readFile(new URL('../migrations/0003_native_articles.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS articles/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS article_revisions/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS article_feedback/);
  assert.match(sql,/ALTER TABLE photos ADD COLUMN article_id/);
  assert.doesNotMatch(sql,/DROP TABLE|DELETE FROM/);
});

test('native UI includes autosave, submit lock, editor copy, feedback and revision history',async()=>{
  const [student,admin]=await Promise.all([readFile(new URL('../../assets/js/student/student-app.js',import.meta.url),'utf8'),readFile(new URL('../../assets/js/admin/admin-app.js',import.meta.url),'utf8')]);
  assert.match(student,/queueSave/);assert.match(student,/선생님께 제출/);assert.match(student,/article_locked|수정 요청/);assert.match(student,/선생님 편집본/);assert.match(student,/변경 이력/);assert.match(student,/\.docx,\.txt/);
  assert.match(admin,/기사 검토 큐/);assert.match(admin,/학생 원본 · 변경 불가/);assert.match(admin,/교사용 내부 메모/);assert.match(admin,/revision_requested/);
});
