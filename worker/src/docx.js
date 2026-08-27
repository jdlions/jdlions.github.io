import { unzipSync } from 'fflate';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_DOCX_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 12 * 1024 * 1024;

function docxError(message, code = 'docx_parse_error') {
  return Object.assign(new Error(message), { status: 422, code });
}

function decodeXml(value) {
  return String(value || '').replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (match, numeric, named) => {
    if (numeric) {
      const point = Number.parseInt(numeric[0].toLowerCase() === 'x' ? numeric.slice(1) : numeric, numeric[0].toLowerCase() === 'x' ? 16 : 10);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[named.toLowerCase()];
  });
}

function textFromXml(fragment) {
  const parts = [];
  const token = /<w:(t|tab|br|cr)\b[^>]*>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/?\s*>/gi;
  let match;
  while ((match = token.exec(fragment))) {
    const kind = match[1] || match[3];
    parts.push(kind === 't' ? decodeXml(match[2].replace(/<[^>]+>/g, '')) : kind === 'tab' ? '\t' : '\n');
  }
  return parts.join('').replace(/[ \t]+\n/g, '\n').trim();
}

function documentBlocks(xml) {
  const blocks = [];
  const blockPattern = /<w:(tbl|p)\b[^>]*>[\s\S]*?<\/w:\1>/gi;
  let block;
  while ((block = blockPattern.exec(xml))) {
    if (block[1].toLowerCase() === 'p') {
      const value = textFromXml(block[0]);
      if (value) blocks.push(value);
      continue;
    }
    const rows = block[0].match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/gi) || [];
    for (const row of rows) {
      const cells = (row.match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/gi) || []).map(textFromXml).map(value => value.replace(/\s*\n\s*/g, ' ').trim());
      if (cells.some(Boolean)) blocks.push(cells.join('\t'));
    }
  }
  return blocks;
}

function assertSafeDocumentEntry(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 65557);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw docxError('DOCX ZIP directory is missing.');
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw docxError('DOCX ZIP directory is corrupt.');
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > bytes.length) throw docxError('DOCX ZIP entry name is corrupt.');
    const name = decoder.decode(bytes.subarray(offset + 46, nameEnd));
    if (name === 'word/document.xml') {
      if (size > MAX_DOCUMENT_XML_BYTES) throw docxError('DOCX document content exceeds the supported size limit.', 'docx_oversize');
      return;
    }
    offset = nameEnd + extraLength + commentLength;
  }
  throw docxError('DOCX does not contain word/document.xml.');
}

const labels = {
  studentNumber: /^(?:학번|student\s*(?:number|no\.?|id))\s*[:：]?\s*/i,
  studentName: /^(?:이름|성명|name)\s*[:：]?\s*/i,
  koreanTitle: /^(?:기사\s*제목\s*\(?한글\)?|한글\s*(?:기사\s*)?제목|korean\s*title)\s*[:：]?\s*/i,
  englishTitle: /^(?:기사\s*제목\s*\(?(?:english|영문|영어)\)?|영문\s*(?:기사\s*)?제목|english\s*title)\s*[:：]?\s*/i,
  articleBody: /^(?:기사\s*본문|article\s*body|body)\s*[:：]?\s*/i
};

export function extractArticleFields(blocks) {
  const fields = { studentNumber: '', studentName: '', koreanTitle: '', englishTitle: '', articleBody: '' };
  let bodyStart = -1;
  for (let index = 0; index < blocks.length; index += 1) {
    const cells = blocks[index].split('\t').map(value => value.trim()).filter(Boolean);
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const cell = cells[cellIndex];
      for (const [field, pattern] of Object.entries(labels)) {
        const match = cell.match(pattern);
        if (!match) continue;
        const inline = cell.slice(match[0].length).trim();
        const value = inline || cells[cellIndex + 1] || '';
        if (field === 'articleBody') {
          fields.articleBody = value;
          bodyStart = index;
        } else if (!fields[field]) fields[field] = value;
      }
    }
  }
  if (bodyStart >= 0) {
    const following = blocks.slice(bodyStart + 1).filter(value => !Object.values(labels).some(pattern => pattern.test(value.trim())));
    fields.articleBody = [fields.articleBody, ...following].filter(Boolean).join('\n\n').trim();
  }
  return fields;
}

export function parseDocx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!bytes.length || bytes.length > MAX_DOCX_BYTES) throw docxError('DOCX file exceeds the supported size limit.', 'docx_oversize');
  assertSafeDocumentEntry(bytes);
  let archive;
  try { archive = unzipSync(bytes, { filter: file => file.name === 'word/document.xml' }); }
  catch { throw docxError('DOCX archive is corrupt or cannot be opened.'); }
  const documentXml = archive['word/document.xml'];
  if (!documentXml) throw docxError('DOCX does not contain word/document.xml.');
  if (documentXml.length > MAX_DOCUMENT_XML_BYTES) throw docxError('DOCX document content exceeds the supported size limit.', 'docx_oversize');
  let xml;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(documentXml); }
  catch { throw docxError('DOCX document XML is not valid UTF-8.'); }
  const blocks = documentBlocks(xml);
  const text = blocks.join('\n\n').trim();
  if (!text) throw docxError('DOCX contains no readable article text.');
  return { text, blocks, fields: extractArticleFields(blocks) };
}
