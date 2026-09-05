// Only this explicit namespace uses the configured browser origin. Never trust
// Host, Forwarded or X-Forwarded-Host to select an OAuth/CSRF origin.
export function pridedeskRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/pridedesk/')) return { request, env };
  // Trim only surrounding copy/paste whitespace. Comparing against the parsed
  // origin still rejects paths, credentials and URL parser repairs (including
  // embedded tabs/newlines, backslashes and empty query/fragment delimiters).
  const configuredOrigin = typeof env.PRIDEDESK_ORIGIN === 'string' ? env.PRIDEDESK_ORIGIN.trim() : '';
  let origin;
  try {
    origin = new URL(configuredOrigin);
  } catch { /* Fail closed until configured. */ }
  if (!origin || origin.protocol !== 'https:' || origin.hostname.includes('*') || origin.origin !== configuredOrigin) {
    throw Object.assign(new Error('PRIDEDESK_ORIGIN must be an exact HTTPS origin.'), { status: 503, code: 'configuration_error' });
  }
  const pathname = url.pathname.slice('/pridedesk'.length);
  if (!pathname.startsWith('/api/') && !['/auth/login', '/auth/callback', '/auth/logout'].includes(pathname)) {
    throw Object.assign(new Error('Proxy route not found.'), { status: 404, code: 'not_found' });
  }
  return {
    request: new Request(`${origin.origin}${pathname}${url.search}`, request),
    env: { ...env, EDITORIAL_ORIGIN: origin.origin, OAUTH_REDIRECT_URI: `${origin.origin}/auth/callback`, PRIDEDESK_REQUEST: true }
  };
}
