import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { hostname: 'lions-pride-editorial-api.editor-936.workers.dev', pathname: '/editorial/login/', href: '' };
const { ProductionAuthService } = await import('../../assets/js/auth/production-auth-service.js');

test('session API uses a same-origin relative path', async () => {
  let requested;
  globalThis.fetch = async input => { requested = input; return new Response('{"authenticated":false,"user":null}', { headers: { 'Content-Type': 'application/json' } }); };
  const service = await ProductionAuthService.create();
  assert.equal(requested, '/api/session');
  assert.equal(service.getSession(), null);
});

test('401, 403, and network session failures still allow a fresh login', async () => {
  for (const failure of [401, 403, 'network']) {
    globalThis.fetch = failure === 'network'
      ? async () => { throw new Error('offline'); }
      : async () => new Response('{"error":{"message":"expired"}}', { status: failure, headers: { 'Content-Type': 'application/json' } });
    const service = await ProductionAuthService.create();
    assert.equal(service.getSession(), null);
    service.login();
    assert.equal(location.href, '/auth/login?returnTo=%2Feditorial%2Flogin%2F');
  }
});
