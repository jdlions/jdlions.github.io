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
  assert.equal(normalized.contentUrl, '/api/photos/photo-1/content');
  assert.equal(normalized.originalUrl, '/api/photos/photo-1/original');
  assert.equal(normalized.createdAt, 'created');
  assert.equal(normalized.updatedAt, 'updated');
});

test('successful upload adds the new photo to the in-memory list immediately',async()=>{
  const calls=[];const service=ProductionEditorialService.empty({role:'student'},async(path,init)=>{calls.push({path,body:init.body});return{id:'new-photo',issue_id:'issue-1',article_submission_id:'article-1',student_google_id:'student-1',caption:'새 사진'};});
  await service.submitPhotos({issueId:'issue-1',articleSubmissionId:'article-1',caption:'새 사진'},[new File(['x'],'photo.jpg',{type:'image/jpeg'})]);
  assert.equal(service.listPhotos()[0].id,'new-photo');assert.equal(calls.length,1);assert.equal(calls[0].body.get('copyright'),'true');
});

test('photo gallery uses authenticated lazy-loaded image URLs',async()=>{
  const [admin,student]=await Promise.all([readFile(new URL('../../assets/js/admin/admin-app.js',import.meta.url),'utf8'),readFile(new URL('../../assets/js/student/student-app.js',import.meta.url),'utf8')]);
  for(const source of [admin,student]){assert.match(source,/loading="lazy"/);assert.match(source,/contentUrl/);assert.doesNotMatch(source,/thumbnailLink/);}
  assert.match(admin,/data-photo-filter="studentId"/);assert.match(admin,/data-photo-filter="articleSubmissionId"/);assert.match(admin,/data-photo-filter="status"/);
});

test('startup uses only lightweight lists and never fetches article detail', async () => {
  const calls=[];
  const request=async path=>{calls.push(path);if(path==='/api/native/articles')return [{id:'article-1',studentId:'student-1'}];if(path==='/api/assignments')return {campaigns:[],assignments:[]};if(path==='/api/photos')return [];throw new Error(`Unexpected request: ${path}`);};
  const service=await ProductionEditorialService.create({role:'student'},request);
  assert.equal(service.listArticles().length,1);
  assert.equal(calls.filter(path=>/^\/api\/native\/articles\/.+/.test(path)).length,0);
  assert.deepEqual(calls.filter(path=>/issues|coursework|studentSubmissions|docs/i.test(path)),[]);
});

test('article detail is fetched once on selection and then cached', async () => {
  const calls=[];
  const request=async path=>{calls.push(path);if(path==='/api/native/articles')return [{id:'article-1',studentId:'student-1',native:true}];if(path==='/api/assignments')return {campaigns:[],assignments:[]};if(path==='/api/photos')return [];if(path==='/api/native/articles/article-1')return {id:'article-1',studentId:'student-1',draftHtml:'body'};throw new Error(`Unexpected request: ${path}`);};
  const service=await ProductionEditorialService.create({role:'student'},request);
  await service.getArticleDetail('article-1');await service.getArticleDetail('article-1');
  assert.equal(calls.filter(path=>path==='/api/native/articles/article-1').length,1);
});

test('admin loads roster for targeting but never requests Classroom coursework', async () => {
  const calls=[];
  const request=async path=>{calls.push(path);if(path==='/api/native/articles'||path==='/api/photos')return [];if(path==='/api/assignments')return {campaigns:[],assignments:[]};if(path==='/api/classroom/students')return {students:[{id:'student-1',name:'Kim Mina'}]};throw new Error(`Unexpected request: ${path}`);};
  await ProductionEditorialService.create({role:'admin'},request);
  assert.equal(calls.includes('/api/classroom/students'),true);
  assert.deepEqual(calls.filter(path=>/issues|coursework|studentSubmissions|docs/i.test(path)),[]);
});

test('student startup uses only the signed-in student name and never requests roster', async () => {
  const calls=[];
  const request=async path=>{calls.push(path);if(path==='/api/native/articles'||path==='/api/photos')return [];if(path==='/api/assignments')return {campaigns:[],assignments:[]};throw new Error(`Unexpected request: ${path}`);};
  const service=await ProductionEditorialService.create({role:'student',studentId:'student-1',name:'Kim Mina'},request);
  assert.deepEqual(service.getState().students,[{id:'student-1',name:'Kim Mina'}]);
  assert.equal(calls.includes('/api/classroom/students'),false);
  assert.deepEqual(calls.filter(path=>/issues|coursework|studentSubmissions|docs/i.test(path)),[]);
});

test('OAuth login scopes exclude coursework, broad Drive read, and Google Docs',async()=>{
  const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
  const scopeBlock=source.match(/const scopes = \[([\s\S]*?)\];/)[1];
  assert.doesNotMatch(scopeBlock,/coursework|drive\.readonly|documents\.readonly/);
  assert.match(scopeBlock,/classroom\.rosters\.readonly/);
  assert.match(scopeBlock,/drive\.file/);
});

test('login copy consistently identifies the English newspaper club', async () => {
  const html=await readFile(new URL('../../login/index.html',import.meta.url),'utf8');
  assert.match(html,/영자신문부 Classroom 구성원/);
  assert.doesNotMatch(html,/(^|[^영자])신문부 Classroom 구성원/);
});

test('public and internal surfaces use the PrideDesk brand and shared credit', async () => {
  const [home,login,admin,student]=await Promise.all([
    readFile(new URL('../../index.html',import.meta.url),'utf8'),
    readFile(new URL('../../login/index.html',import.meta.url),'utf8'),
    readFile(new URL('../../admin/index.html',import.meta.url),'utf8'),
    readFile(new URL('../../student/index.html',import.meta.url),'utf8')
  ]);
  assert.match(home,/class="nav-social"/);
  assert.match(home,/class="nav-workspace" href="https:\/\/lions-pride-editorial-api\.editor-936\.workers\.dev\/editorial\/login\/"/);
  for(const html of [login,admin,student]){
    assert.match(html,/PrideDesk/);
    assert.match(html,/Website &amp; PrideDesk by/);
    assert.match(html,/35기 Hyunseung Yu/);
  }
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
