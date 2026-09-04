import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { normalizePhoto, ProductionEditorialService } = await import('../../assets/js/services/production-editorial-service.js');

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
  assert.match(admin,/customSelect\('photo-status'/);assert.match(admin,/data-photo-select/);assert.match(admin,/updatePhotoStatus/);assert.match(admin,/Drive 원본 열기/);assert.match(student,/사진 제출 내역/);
});

test('native student submit and admin status changes refresh detail and revision history',async()=>{
  const calls=[];let detail={id:'article-1',studentId:'student-1',native:true,status:'draft',draftHtml:'<p>Body</p>',revisions:[]};
  const request=async(path,init={})=>{calls.push(`${init.method||'GET'} ${path}`);if(path==='/api/native/articles')return [detail];if(path==='/api/assignments')return {campaigns:[],assignments:[]};if(path==='/api/photos')return [];if(path==='/api/native/articles/article-1/submit'){detail={...detail,status:'submitted',revisions:[{revisionNumber:1,revisionKind:'submission'}]};return detail;}if(path==='/api/native/articles/article-1/status'){detail={...detail,status:JSON.parse(init.body).status,revisions:[...detail.revisions,{revisionNumber:2,revisionKind:'status_change'}]};return detail;}if(path==='/api/native/articles/article-1')return detail;throw new Error(path);};
  const service=await ProductionEditorialService.create({role:'student',studentId:'student-1'},request);
  const submitted=await service.submitNativeArticle('article-1');assert.equal(submitted.status,'submitted');assert.equal(submitted.revisions.length,1);
  const reviewed=await service.setNativeStatus('article-1','revision_requested');assert.equal(reviewed.status,'revision_requested');assert.equal(reviewed.revisions.length,2);
  assert.deepEqual(calls.filter(x=>x==='GET /api/native/articles/article-1').length,2);
});

test('assignment slot creates, opens, saves, and submits through native Worker routes',async()=>{
  const calls=[];let detail={id:'assignment-slot-1',studentId:'student-1',articleType:'school',titleKo:'학교기사',status:'draft',draftHtml:'',revisions:[]};
  const service=ProductionEditorialService.empty({role:'student'},async(path,init={})=>{calls.push(`${init.method||'GET'} ${path}`);if(path==='/api/assignments/instances/slot%201/article')return detail;if(path==='/api/native/articles/assignment-slot-1'&&init.method==='PATCH'){detail={...detail,...JSON.parse(init.body)};return detail;}if(path==='/api/native/articles/assignment-slot-1/submit'){detail={...detail,status:'submitted'};return detail;}if(path==='/api/native/articles/assignment-slot-1')return detail;throw new Error(`Unexpected request: ${path}`);});
  const created=await service.openAssignmentArticle('slot 1');
  const opened=await service.getArticleDetail(created.id);
  await service.saveNativeDraft(opened.id,{articleType:'school',titleKo:'학교기사',titleEn:'School News',contentHtml:'<p>기사 본문</p>'});
  const submitted=await service.submitNativeArticle(opened.id);
  assert.equal(created.native,true);assert.equal(submitted.status,'submitted');
  assert.deepEqual(calls,['POST /api/assignments/instances/slot%201/article','GET /api/native/articles/assignment-slot-1','PATCH /api/native/articles/assignment-slot-1','POST /api/native/articles/assignment-slot-1/submit','GET /api/native/articles/assignment-slot-1']);
  assert.deepEqual(calls.filter(call=>/\/api\/articles\//.test(call)),[]);
});

test('assignment deletion uses DELETE and removes the campaign and its slots from local state',async()=>{
  const calls=[];
  const service=ProductionEditorialService.empty({role:'admin'},async(path,init={})=>{calls.push(`${init.method||'GET'} ${path}`);return {id:'campaign-1',deleted:true};});
  service.state.campaigns=[{id:'campaign-1'},{id:'campaign-2'}];
  service.state.assignments=[{id:'instance-1',campaignId:'campaign-1'},{id:'instance-2',campaignId:'campaign-2'}];
  await service.deleteAssignment('campaign-1');
  assert.deepEqual(calls,['DELETE /api/assignments/campaign-1']);
  assert.deepEqual(service.listCampaigns().map(x=>x.id),['campaign-2']);
  assert.deepEqual(service.listAssignments().map(x=>x.id),['instance-2']);
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
