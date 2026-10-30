import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../assets/js/student/student-app.js', import.meta.url), 'utf8');

test('student photo upload maps Drive failures to actionable Korean messages', () => {
  assert.match(source, /drive_folder_not_accessible.*drive_permission_denied/);
  assert.match(source, /Google Drive API에서 제출 폴더 접근을 허용하지 않았습니다\. 로그인 상태와 제출 권한을 관리자에게 문의해 주세요\./);
  assert.match(source, /drive_quota_exceeded/);
  assert.match(source, /network_error.*status>=500/);
  assert.doesNotMatch(source, /toast\(err\.message,'error'\)/);
});

test('student photo form resets only after all uploads succeed', () => {
  const submit = source.slice(source.indexOf("document.querySelector('[data-upload-form]').onsubmit"));
  assert.ok(submit.indexOf('await editorialService.submitPhotos') < submit.indexOf('form.reset()'));
  const catchBlock = submit.slice(submit.indexOf('catch(err)'));
  assert.doesNotMatch(catchBlock, /form\.reset\(\)/);
});
