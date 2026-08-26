import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { normalizePhoto, selectConfiguredCourses } = await import('../../assets/js/services/production-editorial-service.js');

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
