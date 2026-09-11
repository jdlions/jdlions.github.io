import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
test('output contains only PrideDesk and all HTML/module dependencies resolve', async () => {
  const files = await readdir(output, { recursive: true });
  assert(!files.some(file => /mock|worker|migrations|^data|^index.html|\.env/.test(file)));
  for (const file of files.filter(file => /\.(html|js|css)$/.test(file))) {
    const path = resolve(output, file);
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /workers\.dev|\/editorial\//);
    const references = file.endsWith('.html')
      ? [...source.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1])
      : file.endsWith('.js') ? [...source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1]) : [...source.matchAll(/url\(['"]?([^)'"]+)['"]?\)/g)].map(match=>match[1]);
    for (const reference of references.filter(value => value.startsWith('.'))) await access(resolve(dirname(path), reference));
  }
  for (const page of ['login', 'admin', 'student']) {
    assert.match(await readFile(resolve(output, page, 'index.html'), 'utf8'), /https:\/\/jdlions.github.io\//);
  }
});

test('routes proxy API/auth only, preserve path and avoid global slash redirects on POST', async () => {
  const config = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
  assert.equal(config.trailingSlash, undefined);
  assert.deepEqual(config.rewrites.map(rule => rule.source), ['/api/:path*', '/auth/:path*']);
  for (const rule of config.rewrites) assert.equal(new URL(rule.destination).pathname, `/pridedesk${rule.source}`);
  assert(config.headers[0].headers.some(header => header.key === 'Vercel-CDN-Cache-Control' && header.value === 'no-store'));
});


test('cache policy grants freshness only to the public static asset namespace',async()=>{
  const config=JSON.parse(await readFile(resolve(root,'vercel.json'),'utf8'));
  const cacheFor=path=>Object.fromEntries(config.headers.filter(rule=>rule.source==='/(.*)'||(rule.source==='/assets/:path*'&&path.startsWith('/assets/'))).flatMap(rule=>rule.headers.map(h=>[h.key,h.value])));
  for(const path of ['/api/session','/api/native/articles','/api/photos/photo/content','/api/publications','/api/public/issues','/auth/login','/auth/callback','/auth/logout','/login/','/admin/','/student/']){
    assert.equal(cacheFor(path)['Cache-Control'],'private, no-store');
    assert.equal(cacheFor(path)['Vercel-CDN-Cache-Control'],'no-store');
  }
  for(const path of ['/assets/js/config.js','/assets/css/editorial.css','/assets/images/pridedesk-logo.webp'])assert.equal(cacheFor(path)['Cache-Control'],'public, max-age=3600, must-revalidate');
});
