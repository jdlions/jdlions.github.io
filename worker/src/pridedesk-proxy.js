// Only this explicit namespace uses the configured browser origin. Never trust
// Host, Forwarded or X-Forwarded-Host to select an OAuth/CSRF origin.
export function pridedeskRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/pridedesk/')) return { request, env };
  let origin;
  try {
    origin = new URL(env.PRIDEDESK_ORIGIN);
  } catch { /* Fail closed until configured. */ }
  if (!origin || origin.protocol !== 'https:' || origin.origin !== env.PRIDEDESK_ORIGIN) {
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
