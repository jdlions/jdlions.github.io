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
