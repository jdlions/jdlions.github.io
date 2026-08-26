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
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=None`;
}

export const clearCookie = name => `${name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None`;

export function sanitizeHtml(input = '') {
  // Deliberately small allow-list for imported Docs/editor HTML. This is not a DOM parser.
  // The API only returns this normalized subset; the frontend must still render in a safe context.
  return String(input)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|svg|math)[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|svg|math)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])\s*(javascript:|data:)[\s\S]*?\2/gi, '')
    .replace(/<(?!\/?(?:p|br|strong|b|em|i|u|h2|h3|ul|ol|li|blockquote|a)(?:\s|>|\/))[^>]+>/gi, '');
}

export function requireTrustedOrigin(request, env) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
  if (request.headers.get('Origin') !== env.FRONTEND_ORIGIN || request.headers.get('X-Editorial-CSRF') !== '1') {
    throw Object.assign(new Error('Request origin or CSRF header rejected.'), { status: 403, code: 'csrf_rejected' });
  }
}

