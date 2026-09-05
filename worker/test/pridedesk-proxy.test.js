import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { pridedeskRequest } from '../src/pridedesk-proxy.js';
import { STATE_COOKIE, SESSION_COOKIE, seal, unseal } from '../src/security.js';

const backend = 'https://worker.example';
const frontend = 'https://desk.example';
const env = { PRIDEDESK_ORIGIN: frontend, EDITORIAL_ORIGIN: backend,
  OAUTH_REDIRECT_URI: `${backend}/auth/callback`, GOOGLE_CLIENT_ID: 'test-id',
  GOOGLE_CLIENT_SECRET: 'test-secret', SESSION_SECRET: 'test-only-session-secret', NEWSPAPER_CLASSROOM_ID: 'course' };
const send = (path, init = {}, config = env) => worker.fetch(new Request(`${backend}${path}`, init), config);

test('proxy is opt-in, validates exact HTTPS origin, and ignores forwarded headers', async () => {
  for (const value of [undefined, '', 'http://desk.example', `${frontend}/`, `${frontend}/path`, 'https://user:pass@desk.example', '*']) {
    const response = await send('/pridedesk/auth/login', {}, { ...env, PRIDEDESK_ORIGIN: value });
    assert.equal(response.status, 503);
  }
  const response = await send('/pridedesk/auth/login', { headers: { 'X-Forwarded-Host': 'evil.example', Forwarded: 'host=evil.example' } });
  assert.equal(new URL(response.headers.get('location')).searchParams.get('redirect_uri'), `${frontend}/auth/callback`);
  assert.equal((await send('/pridedesk/editorial/admin/')).status, 404);
});

test('proxy preserves multipart bytes, query, method, cookie and CSRF header', async () => {
  const form = new FormData(); form.append('file', new File(['photo bytes'], 'photo.jpg', { type: 'image/jpeg' }));
  const input = new Request(`${backend}/pridedesk/api/photos?key=a%2Fb`, { method: 'POST', body: form,
    headers: { Origin: frontend, Cookie: `${SESSION_COOKIE}=test`, 'X-Editorial-CSRF': '1' } });
  const { request } = pridedeskRequest(input, env);
  assert.equal(request.url, `${frontend}/api/photos?key=a%2Fb`);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.get('cookie'), `${SESSION_COOKIE}=test`);
  assert.equal(request.headers.get('x-editorial-csrf'), '1');
  assert.equal(await (await request.formData()).get('file').text(), 'photo bytes');
});

test('proxy mutations require exact browser origin AND CSRF; legacy remains unchanged', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const origin of [null, 'null', backend, 'https://evil.example', 'https://preview.example']) {
      const response = await send('/pridedesk/api/articles', { method, headers: { ...(origin && { Origin: origin }), 'X-Editorial-CSRF': '1' } });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
  }
  assert.equal((await send('/pridedesk/auth/logout', { method: 'POST', headers: { Origin: frontend } })).status, 403);
  const logout = await send('/pridedesk/auth/logout', { method: 'POST', headers: { Origin: frontend, 'X-Editorial-CSRF': '1' } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0; Secure; HttpOnly; SameSite=Lax/);
  assert.equal((await send('/auth/logout', { method: 'POST', headers: { Origin: frontend, 'X-Editorial-CSRF': '1' } })).status, 403);
  assert.equal((await send('/auth/logout', { method: 'POST', headers: { Origin: backend, 'X-Editorial-CSRF': '1' } })).status, 200);
  const legacy = await send('/auth/login');
  assert.equal(new URL(legacy.headers.get('location')).searchParams.get('redirect_uri'), `${backend}/auth/callback`);
});

test('OAuth state failures return no-store JSON and never exchange a code', async () => {
  for (const value of ['', await seal({ state: 'good', verifier: 'v', origin: backend }, env.SESSION_SECRET)]) {
    const response = await send('/pridedesk/auth/callback?state=good&code=test', { headers: { Cookie: `${STATE_COOKIE}=${value}` } });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error.code, 'oauth_state_invalid');
  }
});

test('OAuth login → callback → session works for both roles without leaking browser redirects to Worker', async t => {
  for (const role of ['admin', 'student']) {
    const login = await send('/pridedesk/auth/login?returnTo=https://evil.example');
    assert.equal(login.status, 302);
    const oauth = new URL(login.headers.get('location'));
    assert.equal(oauth.searchParams.get('code_challenge_method'), 'S256');
    const stateCookie = login.headers.get('set-cookie').split(';')[0];
    const saved = await unseal(decodeURIComponent(stateCookie.split('=')[1]), env.SESSION_SECRET);
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        assert.equal(init.body.get('redirect_uri'), `${frontend}/auth/callback`);
        assert.equal(init.body.get('code_verifier'), saved.verifier);
        return Response.json({ access_token: 'test-token', expires_in: 3600 });
      }
      if (url.endsWith('/userinfo')) return Response.json({ sub: `user-${role}`, name: role, email: 'test@example.com' });
      if (url.endsWith('/userProfiles/me')) return Response.json({ id: `user-${role}` });
      if (url.includes('/teachers/')) return role === 'admin' ? Response.json({ userId: `user-${role}` }) : new Response(null, { status: 404 });
      if (url.includes('/students/')) return Response.json({ userId: `user-${role}` });
      throw new Error(`Unexpected upstream ${url}`);
    });
    const callback = await send(`/pridedesk/auth/callback?state=${oauth.searchParams.get('state')}&code=test`, { headers: { Cookie: stateCookie } });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), `${frontend}/${role}/`);
    const cookies = callback.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    for (const value of cookies) {
      assert.match(value, /Path=\/;.*Secure; HttpOnly; SameSite=Lax/);
      assert.doesNotMatch(value, /Domain=|SameSite=None/);
    }
    const sessionCookie = cookies.find(value => value.startsWith(SESSION_COOKIE)).split(';')[0];
    const response = await send('/pridedesk/api/session', { headers: { Cookie: sessionCookie } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.user.role, role);
    assert.doesNotMatch(JSON.stringify(body), /test-token/);
    t.mock.restoreAll();
  }
});
