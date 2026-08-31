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
  assert.match(css, /inset 0 1px 0 rgba\(255,\s*251,\s*240,\s*\.24\)/);
  assert.match(css, /radial-gradient\(ellipse 70% 55%/);
});

test('Liquid Glass palette stays charcoal and warm gold without decorative blue casts', () => {
  assert.match(css, /--bg:\s*#07080f/);
  assert.match(css, /--bg2:\s*#0c0d18/);
  assert.match(css, /--gold:\s*#c9a84c/);
  assert.doesNotMatch(css, /#06101f|#0a1a2f|#071321|rgba\(40,112,185|rgba\(61,131,199/);
  assert.match(css, /--blue:\s*#91c8ff/); // Functional status colour remains available.
});

test('responsive, reduced-motion, forced-colour and focus-visible states remain explicit', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
  assert.match(css, /button:focus-visible[^}]*outline:3px solid var\(--gold-bright\)/);
});
