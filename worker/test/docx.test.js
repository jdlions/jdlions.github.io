import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { MAX_DOCX_BYTES, parseDocx } from '../src/docx.js';

function docx(xml) {
  return zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) });
}

const document = body => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
const paragraph = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const row = cells => `<w:tr>${cells.map(value => `<w:tc>${paragraph(value)}</w:tc>`).join('')}</w:tr>`;

test('synthetic DOCX extracts table fields and Article Body', () => {
  const bytes = docx(document(`<w:tbl>${row(['학번', '20403'])}${row(['이름', '김재상'])}${row(['기사 제목(한글)', 'AI 과열과 투자 수익의 현실'])}${row(['기사 제목(English)', 'AI Exuberance vs. ROI Reality'])}${row(['Article Body', 'First paragraph.'])}</w:tbl>${paragraph('Second &amp; final paragraph.')}`));
  const parsed = parseDocx(bytes);
  assert.equal(parsed.fields.studentNumber, '20403');
  assert.equal(parsed.fields.studentName, '김재상');
  assert.equal(parsed.fields.koreanTitle, 'AI 과열과 투자 수익의 현실');
  assert.equal(parsed.fields.englishTitle, 'AI Exuberance vs. ROI Reality');
  assert.equal(parsed.fields.articleBody, 'First paragraph.\n\nSecond & final paragraph.');
  assert.match(parsed.text, /Second & final paragraph/);
});

test('unrecognized DOCX layout always provides full-text fallback', () => {
  const parsed = parseDocx(docx(document(`${paragraph('Unusual heading')}${paragraph('A complete article remains readable.')}`)));
  assert.equal(parsed.fields.koreanTitle, '');
  assert.equal(parsed.text, 'Unusual heading\n\nA complete article remains readable.');
});

test('corrupt and oversized DOCX files fail with bounded errors', () => {
  assert.throws(() => parseDocx(new Uint8Array([1, 2, 3])), error => error.code === 'docx_parse_error');
  assert.throws(() => parseDocx(new Uint8Array(MAX_DOCX_BYTES + 1)), error => error.code === 'docx_oversize');
});
