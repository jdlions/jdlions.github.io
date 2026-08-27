import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../assets/js/student/student-app.js', import.meta.url), 'utf8');

test('student photo upload maps Drive failures to actionable Korean messages', () => {
  assert.match(source, /drive_permission_denied.*drive_folder_not_accessible/);
  assert.match(source, /사진 제출 폴더에 파일을 추가할 권한이 없습니다\. 영자신문부 관리자에게 문의해 주세요\./);
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
