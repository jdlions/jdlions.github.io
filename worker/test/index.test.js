import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { authorizePhotoViewer, callbackRedirect, classroomAttachments, configuredCourses, createPhotoAfterDrive, editForViewer, loadArticleOriginal, photoContentResponse, photoForClient, publicRoster, selectArticleAttachment, selectGoogleDocAttachment, validateStudentPhoto } from '../src/index.js';

test('D1 photo failure deletes the uploaded Drive file before returning a retryable error',async()=>{
  const removed=[];
  await assert.rejects(createPhotoAfterDrive({createPhoto:async()=>{throw new Error('D1 unavailable');}},{driveFileId:'drive-file'},'token',async(id,token)=>removed.push([id,token])),error=>error.code==='photo_metadata_save_failed'&&error.status===503);
  assert.deepEqual(removed,[['drive-file','token']]);
});

test('D1 photo success does not delete the Drive file',async()=>{
  let removed=false;
  const saved=await createPhotoAfterDrive({createPhoto:async photo=>({...photo,id:'photo'})},{driveFileId:'drive-file'},'token',async()=>{removed=true;});
  assert.equal(saved.id,'photo');assert.equal(removed,false);
});

test('student photo validation preserves ownership, file types, and 15 MB limit',()=>{
  const articles=[{id:'owned'}];
  for(const type of ['image/jpeg','image/png','image/webp'])assert.doesNotThrow(()=>validateStudentPhoto(new File(['x'],'photo',{type}),'owned',articles));
  assert.doesNotThrow(()=>validateStudentPhoto(new File([new Uint8Array(15*1024*1024)],'limit.jpg',{type:'image/jpeg'}),'owned',articles));
  assert.throws(()=>validateStudentPhoto(new File(['x'],'bad.gif',{type:'image/gif'}),'owned',articles),error=>error.code==='invalid_photo');
  assert.throws(()=>validateStudentPhoto(new File([new Uint8Array(15*1024*1024+1)],'large.jpg',{type:'image/jpeg'}),'owned',articles),error=>error.code==='invalid_photo');
  assert.throws(()=>validateStudentPhoto(new File(['x'],'photo.jpg',{type:'image/jpeg'}),'someone-elses',articles),error=>error.code==='article_forbidden');
});

test('photo list records expose only authenticated same-origin URLs',()=>{
  const result=photoForClient({id:'photo/id',drive_file_id:'private-drive-id',rights_confirmed:1});
  assert.equal(result.contentUrl,'/api/photos/photo%2Fid/content');assert.equal(result.originalUrl,'/api/photos/photo%2Fid/original');assert.equal(result.rightsConfirmed,true);assert.equal(JSON.stringify(result).includes('accessToken'),false);
});

test('photo authorization permits admin and student owner with matching Classroom submission',async()=>{
  const photo={id:'photo',issue_id:'issue',student_google_id:'student-1',article_submission_id:'article-1'},issue={id:'issue',classroomCourseId:'newspaper',articleTypes:[]};
  const repo={getPhoto:async()=>photo,getIssue:async()=>issue};
  assert.equal(await authorizePhotoViewer(repo,'photo',{role:'admin'},'newspaper'),photo);
  assert.equal(await authorizePhotoViewer(repo,'photo',{role:'student',studentId:'student-1',accessToken:'token'},'newspaper',async()=>[{id:'article-1',studentId:'student-1'}]),photo);
});

test('photo authorization hides another student, missing photos, and stale Classroom links',async t=>{
  const photo={id:'photo',issue_id:'issue',student_google_id:'student-1',article_submission_id:'article-1'},issue={id:'issue',classroomCourseId:'newspaper',articleTypes:[]};
  await t.test('other student',async()=>assert.rejects(authorizePhotoViewer({getPhoto:async()=>photo,getIssue:async()=>issue},'photo',{role:'student',studentId:'student-2'},'newspaper'),error=>error.status===404));
  await t.test('nonexistent',async()=>assert.rejects(authorizePhotoViewer({getPhoto:async()=>null},'missing',{role:'admin'},'newspaper'),error=>error.status===404));
  await t.test('stale article link',async()=>assert.rejects(authorizePhotoViewer({getPhoto:async()=>photo,getIssue:async()=>issue},'photo',{role:'student',studentId:'student-1'},'newspaper',async()=>[]),error=>error.status===404));
});

test('photo response streams inline with private anti-sniff headers',async()=>{
  const response=await photoContentResponse({drive_file_id:'drive',filename:'교내 사진.webp'},'token',async(id,token)=>{assert.equal(id,'drive');assert.equal(token,'token');return{body:new Blob(['image']).stream(),contentType:'image/webp',contentLength:'5'};});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-disposition'),/^inline;/);assert.equal(await response.text(),'image');
});

test('unauthenticated photo content request returns 401',async()=>{
  const response=await worker.fetch(new Request('https://example.test/api/photos/photo/content',{headers:{Origin:'https://example.test'}}),{SESSION_SECRET:'secret',NEWSPAPER_CLASSROOM_ID:'newspaper'});
  assert.equal(response.status,401);assert.equal((await response.json()).error.code,'authentication_required');
});

test('student article list and detail views omit internal editor notes', () => {
  const internal = { submission_id: 'article-1', editor_note: 'staff only', note_visibility: 'internal', status: 'reviewing' };
  assert.deepEqual(editForViewer(internal, 'student'), { submission_id: 'article-1', note_visibility: 'internal', status: 'reviewing' });
  assert.equal('editor_note' in editForViewer(internal, 'student'), false);
});

test('student-visible notes remain visible and admins receive all notes', () => {
  const visible = { editor_note: 'please revise', note_visibility: 'student' };
  const internal = { editor_note: 'staff only', note_visibility: 'internal' };
  assert.equal(editForViewer(visible, 'student').editor_note, 'please revise');
  assert.equal(editForViewer(internal, 'admin').editor_note, 'staff only');
});

test('Classroom course response contains only the configured newspaper course', () => {
  const result = configuredCourses({ courses: [{ id: 'other' }, { id: 'newspaper' }], nextPageToken: 'ignored' }, 'newspaper');
  assert.deepEqual(result.courses, [{ id: 'newspaper' }]);
});

test('OAuth callback targets the role page on the same Worker origin', () => {
  const callback = new URL('https://lions-pride-editorial-api.editor-936.workers.dev/auth/callback');
  assert.equal(callbackRedirect(callback, 'admin'), 'https://lions-pride-editorial-api.editor-936.workers.dev/editorial/admin/');
  assert.equal(callbackRedirect(callback, 'student'), 'https://lions-pride-editorial-api.editor-936.workers.dev/editorial/student/');
});

test('editorial assets are routed separately from API paths', async () => {
  let assetPath = null;
  const env = { ASSETS: { fetch(request) { assetPath = new URL(request.url).pathname; return new Response('editorial'); } } };
  const asset = await worker.fetch(new Request('https://example.test/editorial/login/'), env);
  assert.equal(await asset.text(), 'editorial');
  assert.equal(assetPath, '/editorial/login/');

  assetPath = null;
  const session = await worker.fetch(new Request('https://example.test/api/session'), env);
  assert.deepEqual(await session.json(), { authenticated: false, user: null });
  assert.equal(assetPath, null);
});

test('a non-Docs first attachment is skipped without treating it as a document', async () => {
  const attachments=[{id:'pdf',kind:'driveFile',mimeType:'application/pdf'},{url:'https://example.test',kind:'link'}];
  let metadataCalls=0;
  assert.equal(await selectGoogleDocAttachment(attachments,'token',async()=>{metadataCalls++;}),null);
  assert.equal(metadataCalls,0);
});

test('a Google Docs attachment is selected from multiple attachments', async () => {
  const attachments=[{id:'docx',kind:'driveFile',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},{id:'doc',kind:'driveFile'}];
  const selected=await selectGoogleDocAttachment(attachments,'token',async id=>({id,mimeType:'application/vnd.google-apps.document',name:'Story'}));
  assert.equal(selected.id,'doc');
  assert.equal(selected.mimeType,'application/vnd.google-apps.document');
});

test('article-form DOCX is selected from multiple attachments instead of the first file', async () => {
  const attachments=[{id:'pdf',kind:'driveFile',name:'notes.pdf',mimeType:'application/pdf'},{id:'generic',kind:'driveFile',name:'draft.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},{id:'article',kind:'driveFile',name:'20403김재상 - 피처기사article form.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}];
  const selected=await selectArticleAttachment(attachments,'token');
  assert.equal(selected.type,'docx');
  assert.equal(selected.attachment.id,'article');
});

test('Classroom attachment metadata retains non-Drive types', () => {
  const values=classroomAttachments({assignmentSubmission:{attachments:[{link:{url:'https://example.test'}},{driveFile:{id:'file',mimeType:'application/pdf'}}]}});
  assert.deepEqual(values.map(value=>value.kind),['link','driveFile']);
});

test('a Docs 400 is isolated as article-level state instead of rejecting the response', async () => {
  const result=await loadArticleOriginal({assignmentSubmission:{attachments:[{driveFile:{id:'doc',mimeType:'application/vnd.google-apps.document'}}]}},'token',{read:async()=>{throw Object.assign(new Error('bad doc'),{status:400,code:'google_docs_error'});}});
  assert.equal(result.originalContent,'');
  assert.equal(result.originalContentState.status,'error');
  assert.match(result.originalContentState.message,/400/);
});

test('Classroom short answer is escaped and preferred over a Google Doc', async () => {
  let reads=0;
  const result=await loadArticleOriginal({shortAnswerSubmission:{answer:'First <script>\nline\n\nSecond & final'},assignmentSubmission:{attachments:[{driveFile:{id:'doc',mimeType:'application/vnd.google-apps.document'}}]}},'token',{read:async()=>{reads++;}});
  assert.equal(result.originalContentSource,'classroom_response');
  assert.equal(result.originalContent,'<p>First &lt;script&gt;<br>line</p><p>Second &amp; final</p>');
  assert.equal(reads,0);
});

test('Google Docs attachment is the fallback original source', async () => {
  const result=await loadArticleOriginal({assignmentSubmission:{attachments:[{driveFile:{id:'doc',mimeType:'application/vnd.google-apps.document'}}]}},'token',{read:async()=>({text:'Doc body'})});
  assert.equal(result.originalContentSource,'google_doc');
  assert.equal(result.originalContent,'<p>Doc body</p>');
});

test('DOCX detail returns structured fields, escaped fallback text, and Drive link', async () => {
  const parsed={text:'Body <unsafe>',fields:{studentNumber:'20403',studentName:'김재상',koreanTitle:'한글 제목',englishTitle:'English title',articleBody:'Body <unsafe>'}};
  const result=await loadArticleOriginal({assignmentSubmission:{attachments:[{driveFile:{id:'docx',name:'article form.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}}]}},'token',{download:async()=>new Uint8Array([1]),parseDocx:()=>parsed});
  assert.equal(result.originalContentSource,'docx');
  assert.equal(result.studentNumber,'20403');
  assert.equal(result.koreanTitle,'한글 제목');
  assert.equal(result.originalContent,'<p>Body &lt;unsafe&gt;</p>');
  assert.match(result.sourceUrl,/drive\.google\.com/);
});

test('corrupt and oversized DOCX failures stay isolated to their article', async t => {
  for (const code of ['docx_parse_error','docx_oversize']) await t.test(code,async()=>{
    const result=await loadArticleOriginal({assignmentSubmission:{attachments:[{driveFile:{id:'docx',name:'article.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}}]}},'token',{download:async()=>new Uint8Array([1]),parseDocx:()=>{throw Object.assign(new Error('bad'),{code});}});
    assert.equal(result.originalContentSource,'docx');
    assert.equal(result.originalContentState.status,'error');
    assert.equal(result.originalContentState.code,code);
    assert.match(result.sourceUrl,/drive\.google\.com/);
  });
});

test('unsupported attachment returns a normal explicit state', async () => {
  const result=await loadArticleOriginal({assignmentSubmission:{attachments:[{driveFile:{id:'pdf',name:'story.pdf',mimeType:'application/pdf'}}]}},'token');
  assert.equal(result.originalContentSource,'unsupported_attachment');
  assert.equal(result.originalContentState.status,'unsupported');
  assert.equal(result.unsupportedAttachments[0].name,'story.pdf');
});

test('roster exposes only id and actual name with a non-identifying fallback', () => {
  assert.deepEqual(publicRoster([{userId:'123456',profile:{name:{fullName:'Kim Mina'},emailAddress:'private@example.test'}},{userId:'sensitive-id',profile:{}}]),[{id:'123456',name:'Kim Mina'},{id:'sensitive-id',name:'이름 확인 불가'}]);
  assert.equal(JSON.stringify(publicRoster([{userId:'sensitive-id',profile:{}}])).includes('private@example.test'),false);
  assert.equal(publicRoster([{userId:'sensitive-id',profile:{}}])[0].name.includes('sensitive-id'),false);
});
