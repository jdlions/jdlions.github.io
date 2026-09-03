import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(workerRoot, '..');
const outputRoot = resolve(workerRoot, '.static', 'editorial');

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

await rm(resolve(workerRoot, '.static'), { recursive: true, force: true });
for (const file of files) {
  const destination = resolve(outputRoot, file);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(repositoryRoot, file), destination);
}

for (const page of ['login', 'admin', 'student']) {
  const source = await readFile(resolve(repositoryRoot, page, 'index.html'), 'utf8');
  const html = source.replaceAll('href="../"', 'href="https://jdlions.github.io/"');
  const destination = resolve(outputRoot, page, 'index.html');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, html);
}
