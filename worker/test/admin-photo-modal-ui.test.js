import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../assets/js/admin/admin-app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../assets/css/editorial.css', import.meta.url), 'utf8');

test('photo modal separates fixed header and actions from its scrollable content', () => {
  assert.match(source, /photo-modal-head[\s\S]*photo-modal-scroll[\s\S]*photo-review-actions/);
  assert.match(source, /class="photo-modal-scroll" tabindex="0" aria-label="사진 상세 내용"/);
  assert.match(css, /\.photo-modal-card\{display:grid;grid-template-rows:auto minmax\(0,1fr\) auto;[^}]*overflow:hidden/);
  assert.match(css, /\.photo-modal-scroll\{min-height:0;[^}]*overflow-y:auto;[^}]*overscroll-behavior:contain;[^}]*-webkit-overflow-scrolling:touch/);
});

test('photo review actions remain in a dedicated footer outside long metadata content', () => {
  const scrollStart = source.indexOf('<div class="photo-modal-scroll"');
  const scrollEnd = source.indexOf('<div class="photo-review-actions"');
  assert.ok(scrollStart >= 0 && scrollEnd > scrollStart);
  assert.match(source.slice(scrollStart, scrollEnd), /photo-modal-details/);
  assert.doesNotMatch(source.slice(scrollStart, scrollEnd), /data-modal-photo-status/);
  assert.match(css, /\.photo-review-actions\{[^}]*border-top:[^}]*background:[^}]*z-index:1/);
});

test('photo preview is contained and modal stays inside tablet and mobile viewports', () => {
  assert.match(css, /\.photo-preview img\{[^}]*height:100%;[^}]*max-height:46vh;object-fit:contain/);
  assert.match(css, /@media\(max-width:900px\)[\s\S]*\.photo-modal-card\{height:calc\(100dvh - 32px\);max-height:calc\(100dvh - 32px\)/);
  assert.match(css, /@media\(max-width:480px\)[\s\S]*\.photo-modal-card\{height:calc\(100dvh - 16px\);max-height:calc\(100dvh - 16px\)/);
  assert.match(css, /@media\(max-width:480px\)[\s\S]*\.photo-preview,\.photo-preview img\{max-height:32vh\}/);
});

test('modal preserves body scroll lock and keyboard focus containment', () => {
  assert.match(css, /body\.modal-open\{overflow:hidden\}/);
  assert.match(source, /if\(e\.key==='Escape'\)/);
  assert.match(source, /querySelectorAll\('button,a\[href\],\[tabindex="0"\]'\)/);
  assert.match(source, /photoModalReturn\?\.focus\(\)/);
});
