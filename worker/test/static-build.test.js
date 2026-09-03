import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const workerRoot = new URL('../', import.meta.url);

test('Wrangler always rebuilds static assets before dev or deploy', async () => {
  const [wrangler, pkg] = await Promise.all([
    readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  assert.match(wrangler, /\[build\]\s+command = "npm run build:static"/);
  assert.equal(pkg.scripts.deploy, 'wrangler deploy');
  assert.equal(pkg.scripts.dev, 'wrangler dev');
});

test('generated Worker assets are native PrideDesk UI and exclude legacy review UI', async () => {
  const result = spawnSync(process.execPath, ['scripts/build-static.mjs'], {
    cwd: workerRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const [adminHtml, adminJs, studentJs] = await Promise.all([
    readFile(new URL('../.static/editorial/admin/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../.static/editorial/assets/js/admin/admin-app.js', import.meta.url), 'utf8'),
    readFile(new URL('../.static/editorial/assets/js/student/student-app.js', import.meta.url), 'utf8')
  ]);
  assert.match(adminHtml, /data-admin-view="assignments"/);
  assert.match(adminJs, /기사 검토 큐/);
  assert.match(adminJs, /과제 관리/);
  assert.match(adminJs, /data-delete-campaign/);
  assert.match(studentJs, /내 과제/);
  assert.match(studentJs, /openAssignmentArticle/);
  assert.doesNotMatch(`${adminHtml}\n${adminJs}`, /createArticleUiState|listCourseWork|Classroom 과제 연결|data-admin-view="issues"/);
});
