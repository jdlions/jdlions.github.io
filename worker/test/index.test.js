import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { callbackRedirect, classroomAttachments, configuredCourses, editForViewer, loadArticleOriginal, publicRoster, selectArticleAttachment, selectGoogleDocAttachment } from '../src/index.js';

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
