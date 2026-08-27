import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { normalizePhoto, ProductionEditorialService, selectConfiguredCourses } = await import('../../assets/js/services/production-editorial-service.js');

test('only the configured newspaper Classroom is selected', () => {
  const courses = [{ id: 'other-active' }, { id: 'newspaper' }];
  assert.deepEqual(selectConfiguredCourses(courses, 'newspaper'), [{ id: 'newspaper' }]);
  assert.deepEqual(selectConfiguredCourses(courses, undefined), []);
});

test('D1 photo rows normalize to the frontend camelCase model', () => {
  const normalized = normalizePhoto({
    id: 'photo-1', issue_id: 'issue-1', article_submission_id: 'article-1',
    student_google_id: 'student-1', drive_file_id: 'drive-1', mime_type: 'image/png',
    byte_size: 1048576, source_type: 'self', created_at: 'created', updated_at: 'updated'
  });
  assert.equal(normalized.issueId, 'issue-1');
  assert.equal(normalized.articleSubmissionId, 'article-1');
  assert.equal(normalized.studentId, 'student-1');
  assert.equal(normalized.driveFileId, 'drive-1');
  assert.equal(normalized.fileId, 'drive-1');
  assert.equal(normalized.mimeType, 'image/png');
  assert.equal(normalized.byteSize, 1048576);
  assert.equal(normalized.fileSize, '1.0 MB');
  assert.equal(normalized.sourceType, 'self');
  assert.equal(normalized.createdAt, 'created');
  assert.equal(normalized.updatedAt, 'updated');
});

test('startup uses only lightweight lists and never fetches article detail', async () => {
  const calls=[];
  const request=async path=>{calls.push(path);if(path==='/api/issues')return [{id:'issue-1',status:'active'}];if(path.startsWith('/api/articles?'))return [{id:'article-1',issueId:'issue-1',studentId:'student-1',attachments:[]}];if(path.startsWith('/api/photos?'))return [];throw new Error(`Unexpected request: ${path}`);};
  const service=await ProductionEditorialService.create({role:'student'},request);
  assert.equal(service.listArticles().length,1);
  assert.equal(calls.filter(path=>/^\/api\/articles\//.test(path)).length,0);
});

test('article detail is fetched once on selection and then cached', async () => {
  const calls=[];
  const request=async path=>{calls.push(path);if(path==='/api/issues')return [{id:'issue-1',status:'active'}];if(path.startsWith('/api/articles?'))return [{id:'article-1',issueId:'issue-1',studentId:'student-1',attachments:[]}];if(path.startsWith('/api/photos?'))return [];if(path.startsWith('/api/articles/article-1?'))return {id:'article-1',issueId:'issue-1',studentId:'student-1',attachments:[],originalContent:'body',originalContentState:{status:'available'}};throw new Error(`Unexpected request: ${path}`);};
  const service=await ProductionEditorialService.create({role:'student'},request);
  await service.getArticleDetail('article-1');await service.getArticleDetail('article-1');
  assert.equal(calls.filter(path=>path.startsWith('/api/articles/article-1?')).length,1);
});

test('admin requests coursework only for the configured active newspaper Classroom', async () => {
  const calls=[];
  const request=async path=>{calls.push(path);if(path==='/api/issues')return [{id:'issue-1',status:'active',classroomCourseId:'newspaper'}];if(path.startsWith('/api/articles?')||path.startsWith('/api/photos?'))return [];if(path==='/api/classroom/courses')return {courses:[{id:'other'},{id:'newspaper'}]};if(path==='/api/classroom/newspaper/coursework')return {courseWork:[]};throw new Error(`Unexpected request: ${path}`);};
  await ProductionEditorialService.create({role:'admin'},request);
  assert.deepEqual(calls.filter(path=>path.includes('/coursework')),['/api/classroom/newspaper/coursework']);
});

test('admin and student apps render loading and retry states without top-level service await', async () => {
  const [container,admin,student]=await Promise.all([
    readFile(new URL('../../assets/js/services/service-container.js',import.meta.url),'utf8'),
    readFile(new URL('../../assets/js/admin/admin-app.js',import.meta.url),'utf8'),
    readFile(new URL('../../assets/js/student/student-app.js',import.meta.url),'utf8')
  ]);
  assert.doesNotMatch(container,/export const editorialService = await/);
  for(const source of [admin,student]){assert.match(source,/loadEditorialService/);assert.match(source,/data-retry-startup/);}
});
