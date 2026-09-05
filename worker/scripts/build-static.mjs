import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editorialFiles as files } from '../../scripts/editorial-files.mjs';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(workerRoot, '..');
const outputRoot = resolve(workerRoot, '.static', 'editorial');

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
