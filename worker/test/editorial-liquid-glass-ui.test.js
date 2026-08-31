import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../../assets/css/editorial-liquid-glass.css', import.meta.url), 'utf8');
const login = await readFile(new URL('../../login/index.html', import.meta.url), 'utf8');
const shell = await readFile(new URL('../../assets/js/shared/shell.js', import.meta.url), 'utf8');

test('editorial shell and login use the real club logo instead of a PD placeholder', () => {
  assert.match(css, /cleanlogo\.png/);
  assert.match(login, /cleanlogo\.png/);
  assert.doesNotMatch(login, />PD<\/span>/);
  assert.match(login, /editorial-liquid-glass\.css/);
  assert.match(shell, /editorial-liquid-glass\.css/);
});

test('shared Liquid Glass material includes optical depth and ambient colour pickup', () => {
  assert.match(css, /--glass-strong:/);
  assert.match(css, /backdrop-filter:blur\(28px\) saturate\(175%\)/);
  assert.match(css, /mix-blend-mode:screen/);
  assert.match(css, /inset 0 1px 0 rgba\(255,255,255,.3\)/);
  assert.match(css, /radial-gradient\(ellipse 70% 55%/);
});

test('responsive, reduced-motion, forced-colour and focus-visible states remain explicit', () => {
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /@media\(forced-colors:active\)/);
  assert.match(css, /button:focus-visible[^}]*outline:3px solid var\(--gold-bright\)/);
});
