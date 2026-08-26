import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, seal, unseal } from '../src/security.js';

test('sealed session round trips and rejects another key', async () => {
  const value={sub:'fictional-subject',role:'student',exp:123};
  const token=await seal(value,'a sufficiently long test-only secret');
  assert.deepEqual(await unseal(token,'a sufficiently long test-only secret'),value);
  assert.equal(await unseal(token,'different test-only secret'),null);
});

test('HTML sanitizer removes active content and handlers', () => {
  const clean=sanitizeHtml('<p onclick="bad()">Safe <strong>text</strong><script>alert(1)</script><a href="javascript:bad()">link</a></p>');
  assert.equal(clean.includes('script'),false);
  assert.equal(clean.includes('onclick'),false);
  assert.equal(clean.includes('javascript:'),false);
  assert.match(clean,/<strong>text<\/strong>/);
});

test('HTML sanitizer rebuilds tags and rejects obfuscated or unquoted active URLs', () => {
  const attacks = [
    '<a href=javascript:alert(1)>one</a>',
    '<a href="java&#x73;cript:alert(1)">two</a>',
    '<a href="javascript&colon;alert(1)">three</a>',
    '<a href="data:text/html,<script>alert(1)</script>">four</a>',
    '<a href="vbscript:msgbox(1)" onmouseover=alert(1)>five</a>'
  ];
  for (const attack of attacks) {
    const clean = sanitizeHtml(attack);
    assert.doesNotMatch(clean, /href\s*=|onmouseover|javascript|vbscript|data:/i);
  }
});

test('HTML sanitizer retains only allowed anchor protocols and allowed formatting tags', () => {
  const clean = sanitizeHtml('<p class="drop"><a href="https://example.com/a?b=1&c=2" target="_blank">Web</a> <a href=mailto:desk@example.com>Email</a><img src=x onerror=bad()><strong style=color:red>Bold</strong></p>');
  assert.match(clean, /^<p><a href="https:\/\/example\.com\/a\?b=1&amp;c=2">Web<\/a> <a href="mailto:desk@example\.com">Email<\/a><strong>Bold<\/strong><\/p>$/);
  assert.doesNotMatch(clean, /class=|target=|style=|img|onerror/);
});
