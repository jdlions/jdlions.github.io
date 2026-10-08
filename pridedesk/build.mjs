import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { editorialFiles } from '../scripts/editorial-files.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, '..');
const output = resolve(root, 'dist');
// Version the entire module graph, not just the entry script: relative imports,
// dynamically loaded theme CSS and its images must all belong to this build.
const digest = createHash('sha256');
for (const file of [...editorialFiles, ...['login','admin','student'].map(page=>`${page}/index.html`), 'pridedesk/build.mjs'].sort()) {
  digest.update(file).update('\0').update(await readFile(resolve(repository, file))).update('\0');
}
const assetPrefix = `assets/build-${digest.digest('hex').slice(0,16)}/`;
const assetPath = file => file.replace(/^assets\//, assetPrefix);
const versionReferences = source => source.replaceAll('https://pridesk.vercel.app/assets/', `https://pridesk.vercel.app/${assetPrefix}`).replaceAll('../assets/', `../${assetPrefix}`);
await rm(output, { recursive: true, force: true });
for (const file of editorialFiles) {
  const target = resolve(output, assetPath(file));
  await mkdir(dirname(target), { recursive: true });
  if (file.endsWith('.js')) {
    // Keep the shared Worker/Pages sources unchanged; only this build uses root routes.
    const source = await readFile(resolve(repository, file), 'utf8');
    await writeFile(target, versionReferences(source.replaceAll('/editorial/', '/')));
  } else await cp(resolve(repository, file), target);
}
// Vercel never navigates or fetches directly to the Worker origin.
await writeFile(resolve(output, assetPath('assets/js/config.js')), `export const editorialConfig = Object.freeze({ mode: 'production', apiBaseUrl: '' });
export function editorialUrl(path) { return path; }
`);
for (const page of ['login', 'admin', 'student']) {
  const source = await readFile(resolve(repository, page, 'index.html'), 'utf8');
  const html = versionReferences(source.replaceAll('href="../"', 'href="https://jdlions.github.io/"'));
  const target = resolve(output, page, 'index.html');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html);
}
await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
// Public release metadata contains only immutable commit/asset identifiers.
// The global HTML/API no-store policy also covers this verification file.
const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
await writeFile(resolve(output, 'deployment.json'), JSON.stringify({commit:/^[a-f0-9]{40}$/.test(commit)?commit:null, assets:assetPrefix}));
