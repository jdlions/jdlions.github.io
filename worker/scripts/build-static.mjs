import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(workerRoot, '..');
const outputRoot = resolve(workerRoot, '.static', 'editorial');

const requiredMarkers = new Map([
  ['admin/index.html', ['data-admin-view="assignments"']],
  ['student/index.html', ['data-student-view="articles"']],
  ['assets/js/admin/admin-app.js', ['기사 검토 큐', '과제 관리', 'data-delete-campaign']],
  ['assets/js/student/student-app.js', ['내 과제', 'openAssignmentArticle']]
]);
const forbiddenMarkers = new Map([
  ['admin/index.html', ['data-admin-view="issues"']],
  ['assets/js/admin/admin-app.js', ['createArticleUiState', 'listCourseWork', 'Classroom 과제 연결']]
]);

const files = [
  'cleanlogo.png',
  'assets/css/editorial.css',
  'assets/css/editorial-liquid-glass.css',
  'assets/js/config.js',
  'assets/js/admin/admin-app.js',
  'assets/js/student/student-app.js',
  'assets/js/auth/auth-service.js',
  'assets/js/auth/login-app.js',
  'assets/js/auth/production-auth-service.js',
  'assets/js/auth/route-guard.js',
  'assets/js/services/api-client.js',
  'assets/js/services/production-editorial-service.js',
  'assets/js/services/service-container.js',
  'assets/js/shared/shell.js',
  'assets/js/shared/ui.js'
];

function verify(file, content, stage) {
  for (const marker of requiredMarkers.get(file) || []) {
    if (!content.includes(marker)) throw new Error(`${stage} ${file} is missing native PrideDesk marker: ${marker}`);
  }
  for (const marker of forbiddenMarkers.get(file) || []) {
    if (content.includes(marker)) throw new Error(`${stage} ${file} contains legacy editorial marker: ${marker}`);
  }
}

await rm(resolve(workerRoot, '.static'), { recursive: true, force: true });
for (const file of files) {
  const sourcePath = resolve(repositoryRoot, file);
  if (requiredMarkers.has(file) || forbiddenMarkers.has(file)) verify(file, await readFile(sourcePath, 'utf8'), 'Source');
  const destination = resolve(outputRoot, file);
  await mkdir(dirname(destination), { recursive: true });
  await cp(sourcePath, destination);
  if (requiredMarkers.has(file) || forbiddenMarkers.has(file)) verify(file, await readFile(destination, 'utf8'), 'Generated asset');
}

for (const page of ['login', 'admin', 'student']) {
  const source = await readFile(resolve(repositoryRoot, page, 'index.html'), 'utf8');
  verify(`${page}/index.html`, source, 'Source');
  const html = source.replaceAll('href="../"', 'href="https://jdlions.github.io/"');
  const destination = resolve(outputRoot, page, 'index.html');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, html);
  verify(`${page}/index.html`, await readFile(destination, 'utf8'), 'Generated asset');
}
