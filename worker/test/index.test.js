import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredCourses, editForViewer } from '../src/index.js';

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
