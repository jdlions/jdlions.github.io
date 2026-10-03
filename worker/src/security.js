const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE = '__Host-lp_session';
export const STATE_COOKIE = '__Host-lp_oauth_state';

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), c => c.charCodeAt(0));
const keyBytes = async secret => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret)));

export function randomToken(bytes = 24) { const value = new Uint8Array(bytes); crypto.getRandomValues(value); return b64url(value); }

export async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', await keyBytes(secret), 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value))));
  return `${b64url(iv)}.${b64url(encrypted)}`;
}

export async function unseal(value, secret) {
  try {
    const [iv, encrypted] = value.split('.').map(fromB64url);
    const key = await crypto.subtle.importKey('raw', await keyBytes(secret), 'AES-GCM', false, ['decrypt']);
    return JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)));
  } catch { return null; }
}

export function cookie(request, name) {
  const match = request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function setCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}

export const clearCookie = name => `${name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;

const allowedTags = new Set(['p','br','strong','b','em','i','u','h2','h3','ul','ol','li','blockquote','a']);
const voidTags = new Set(['br']);
const namedEntities = { amp:'&', colon:':', newline:'\n', tab:'\t' };

function decodeEntities(value) {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));?/gi, (match, decimal, hex, named) => {
    const point = decimal ? Number(decimal) : hex ? Number.parseInt(hex, 16) : null;
    if (point !== null) return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    return namedEntities[named?.toLowerCase()] ?? match;
  });
}

function safeHref(value) {
  const decoded = decodeEntities(value).replace(/[\u0000-\u0020\u007f]+/g, '');
  try {
    const url = new URL(decoded);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

const escapeAttribute = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function parseTag(source) {
  let i = 0;
  while (/\s/.test(source[i] || '')) i += 1;
  const closing = source[i] === '/'; if (closing) i += 1;
  while (/\s/.test(source[i] || '')) i += 1;
  const start = i; while (/[a-z0-9]/i.test(source[i] || '')) i += 1;
  const name = source.slice(start, i).toLowerCase();
  if (!allowedTags.has(name)) return '';
  if (closing) return `</${name}>`;
  let href = null;
  while (i < source.length) {
    while (/\s/.test(source[i] || '') || source[i] === '/') i += 1;
    const attrStart = i; while (/[^\s=/>]/.test(source[i] || '')) i += 1;
    const attr = source.slice(attrStart, i).toLowerCase();
    if (!attr) break;
    while (/\s/.test(source[i] || '')) i += 1;
    let value = '';
    if (source[i] === '=') {
      i += 1; while (/\s/.test(source[i] || '')) i += 1;
      const quote = source[i] === '"' || source[i] === "'" ? source[i++] : null;
      const valueStart = i;
      if (quote) { while (i < source.length && source[i] !== quote) i += 1; value = source.slice(valueStart, i); if (source[i] === quote) i += 1; }
      else { while (/[^\s>]/.test(source[i] || '')) i += 1; value = source.slice(valueStart, i); }
    }
    if (name === 'a' && attr === 'href') href = safeHref(value);
  }
  const hrefAttribute = name === 'a' && href ? ` href="${escapeAttribute(href)}"` : '';
  return `<${name}${hrefAttribute}${voidTags.has(name) ? '>' : '>'}`;
}

export function sanitizeHtml(input = '') {
  const html = String(input); let output = '', cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf('<', cursor);
    if (open < 0) { output += html.slice(cursor); break; }
    output += html.slice(cursor, open);
    if (html.startsWith('<!--', open)) { const end = html.indexOf('-->', open + 4); cursor = end < 0 ? html.length : end + 3; continue; }
    let end = open + 1, quote = null;
    while (end < html.length) {
      const char = html[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      end += 1;
    }
    if (end >= html.length) { output += '&lt;' + html.slice(open + 1); break; }
    output += parseTag(html.slice(open + 1, end)); cursor = end + 1;
  }
  return output;
}

export function requireTrustedOrigin(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('X-Editorial-CSRF') !== '1') {
    throw Object.assign(new Error('Request origin or CSRF header rejected.'), { status: 403, code: 'csrf_rejected' });
  }
}
