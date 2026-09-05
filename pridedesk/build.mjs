import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editorialFiles } from '../scripts/editorial-files.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, '..');
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
for (const file of editorialFiles) {
  const target = resolve(output, file);
  await mkdir(dirname(target), { recursive: true });
  if (file.endsWith('.js')) {
    // Keep the shared Worker/Pages sources unchanged; only this build uses root routes.
    const source = await readFile(resolve(repository, file), 'utf8');
    await writeFile(target, source.replaceAll('/editorial/', '/'));
  } else await cp(resolve(repository, file), target);
}
// Vercel never navigates or fetches directly to the Worker origin.
await writeFile(resolve(output, 'assets/js/config.js'), `export const editorialConfig = Object.freeze({ mode: 'production', apiBaseUrl: '' });
export function editorialUrl(path) { return path; }
`);
for (const page of ['login', 'admin', 'student']) {
  const source = await readFile(resolve(repository, page, 'index.html'), 'utf8');
  const html = source.replaceAll('href="../"', 'href="https://jdlions.github.io/"');
  const target = resolve(output, page, 'index.html');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html);
}
await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
