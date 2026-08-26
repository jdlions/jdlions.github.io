import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { callbackRedirect, configuredCourses, editForViewer } from '../src/index.js';

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
