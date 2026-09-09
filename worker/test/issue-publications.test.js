import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { normalizeDriveFileUrl, validatePublication, mergeArchive } from '../../assets/js/shared/issue-publication.js';
import { IssuePublications } from '../src/issue-publications.js';
import worker from '../src/index.js';
import { seal, SESSION_COOKIE } from '../src/security.js';

const legacy = JSON.parse(readFileSync(new URL('../../data/issues.json', import.meta.url)));
const fileId = 'synthetic_pdf_file_35';
const input = (overrides = {}) => ({ number: 35, year: 2026, season: 'Winter', title: "The Lion's Pride — 2026 Winter Edition", url: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`, publicPdfConfirmed: true, ...overrides });
const key = 'publication-request-35';
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(x => x.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  const db = { prepare(query) { return { bind(...args) { const stmt = sql.prepare(query); return { first: async () => stmt.get(...args), all: async () => ({ results: stmt.all(...args) }), run: async () => stmt.run(...args) }; } }; } };
  return { sql, db, repo: new IssuePublications(db) };
}
const count = f => f.sql.prepare('SELECT count(*) AS n FROM issue_publications').get().n;

test('Drive sharing variants normalize, retaining resource keys', () => {
  for (const value of [`https://drive.google.com/file/d/${fileId}/view`, `https://drive.google.com/file/d/${fileId}/view?usp=sharing`, `https://drive.google.com/open?id=${fileId}`, `https://drive.google.com/uc?export=download&id=${fileId}`, `https://docs.google.com/file/d/${fileId}/preview`]) {
    assert.deepEqual(normalizeDriveFileUrl(value), { fileId, url: `https://drive.google.com/file/d/${fileId}/view` });
  }
  assert.equal(normalizeDriveFileUrl(`https://drive.google.com/open?id=${fileId}&resourcekey=0-abc_X`).url, `https://drive.google.com/file/d/${fileId}/view?resourcekey=0-abc_X`);
});
test('unsafe, malformed, folder, document and ambiguous Drive links are rejected', () => {
  for (const value of ['', null, 'javascript:alert(1)', 'http://drive.google.com/open?id=' + fileId, 'https://drive.google.com.evil.example/open?id=' + fileId, 'https://drive.google.com@evil.example/open?id=' + fileId, 'https://user@drive.google.com/open?id=' + fileId, 'https://drive.google.com:444/open?id=' + fileId, 'https://drive.google.com/drive/folders/' + fileId, 'https://docs.google.com/document/d/' + fileId + '/edit', 'https://drive.google.com/open?id=x', 'https://drive.google.com/open?id=' + fileId + '&id=other_file_id', 'https://drive.google.com/file/d/' + fileId + '/view?id=other_file_id', 'https://drive.google.com/open?id=' + fileId + '&resourcekey=', 'https://drive.google.com/\\evil.example', 'https://dri\nve.google.com/open?id=' + fileId]) assert.throws(() => normalizeDriveFileUrl(value), { code: 'invalid_publication' }, String(value));
});
test('required values, strict integers, seasons and title bounds are enforced', () => {
  for (const changes of [{ number: '35' }, { number: 35.5 }, { number: 0 }, { number: 1000000 }, { year: 0 }, { year: 2101 }, { year: '2026' }, { season: 'winter' }, { season: null }, { title: '' }, { title: ' ' }, { title: 'a'.repeat(301) }, { title: 'a\nb' }, { url: '' }]) assert.throws(() => validatePublication(input(changes)), { code: 'invalid_publication' });
  for (const field of ['number', 'year', 'season', 'title', 'url']) { const value = input(); delete value[field]; assert.throws(() => validatePublication(value)); }
  assert.throws(() => validatePublication(null));
});
test('publish prepends new issue and leaves all baseline fields and other D1 tables unchanged', async () => {
  const f = fixture();
  try {
    const tables = f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'issue_publications'").all().map(x => x.name);
    const snapshot = () => tables.map(name => f.sql.prepare(`SELECT * FROM ${name}`).all());
    const before = snapshot();
    assert.deepEqual(await f.repo.list(), legacy);
    const saved = await f.repo.publish(input(), key, 'teacher');
    assert.equal(saved.replayed, false);
    assert.equal(saved.issue.label, 'No.35');
    const after = await f.repo.list();
    assert.deepEqual(after.slice(1), legacy);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(Object.keys(after[0]).sort(), Object.keys(legacy[0]).sort());
    assert.equal(legacy[0].number, 34);
    assert.deepEqual(legacy.slice(1).map(x => x.number), Array.from({ length: 17 }, (_, i) => 32 - i));
    assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.sql.close(); }
});
test('legacy and new numbers/files conflict; old gaps cannot be backfilled', async () => {
  const f = fixture();
  try {
    for (const changes of [{ number: 34 }, { number: 33 }, { url: legacy[0].url }, { url: legacy.at(-1).url }]) await assert.rejects(f.repo.publish(input(changes), key, 'teacher'), { status: 409 });
    assert.equal(count(f), 0);
    await f.repo.publish(input(), key, 'teacher');
    await assert.rejects(f.repo.publish(input({ number: 36, url: `https://drive.google.com/open?id=${fileId}` }), 'another-request-key', 'teacher'), { status: 409 });
    await assert.rejects(f.repo.publish(input({ url: 'https://drive.google.com/open?id=another_file_id' }), 'another-request-key', 'teacher'), { status: 409 });
    assert.equal(count(f), 1);
  } finally { f.sql.close(); }
});
test('durable idempotency survives retry, races and new repository instances', async () => {
  const f = fixture();
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => new IssuePublications(f.db).publish(input(), key, 'teacher')));
    assert.equal(count(f), 1);
    assert.ok(results.every(x => x.issue.number === 35));
    assert.equal((await new IssuePublications(f.db).publish(input({ url: `https://drive.google.com/open?id=${fileId}` }), key, 'teacher')).replayed, true);
    await assert.rejects(f.repo.publish(input({ title: 'Different payload' }), key, 'teacher'), { code: 'idempotency_conflict' });
    await assert.rejects(f.repo.publish(input(), key, 'another-teacher'), { code: 'idempotency_conflict' });
    const conflicts = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => f.repo.publish(input({ number: 36, url: 'https://drive.google.com/open?id=another_file_id' }), 'new-publication-key-' + i, 'teacher')));
    assert.equal(conflicts.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(count(f), 2);
  } finally { f.sql.close(); }
});
test('atomic latest-number check rejects a smaller number inserted after a concurrent higher one', async () => {
  const f = fixture();
  try {
    await f.repo.publish(input({ number: 37 }), key, 'teacher');
    await assert.rejects(f.repo.publish(input({ number: 36, url: 'https://drive.google.com/open?id=another_file_id' }), 'lower-publication-key', 'teacher'), { status: 409 });
    assert.equal(count(f), 1);
  } finally { f.sql.close(); }
});
test('public merge never overwrites, renumbers or sorts committed rows', () => {
  const original = structuredClone(legacy);
  const changed = { ...legacy[0], title: 'Changed remotely', url: 'https://drive.google.com/open?id=different_file_id' };
  const merged = mergeArchive(legacy, [input(), changed, ...legacy, input({ number: 36, url: legacy[0].url })]);
  assert.equal(merged[0].number, 35);
  assert.deepEqual(merged.slice(1), original);
  assert.deepEqual(legacy, original);
  assert.throws(() => mergeArchive(legacy, [{ ...input(), url: 'javascript:alert(1)' }]));
});
test('API enforces sessions, membership, CSRF, origin, key and confirmation; public read is metadata only', async () => {
  const f = fixture(), original = globalThis.fetch;
  const env = { DB: f.db, SESSION_SECRET: 'publication-tests-secret', NEWSPAPER_CLASSROOM_ID: 'publication-course', PRIDEDESK_ORIGIN: 'https://pridesk.example' };
  let student = false, externalCalls = 0;
  globalThis.fetch = async url => {
    externalCalls++;
    assert.match(String(url), /^https:\/\/classroom.googleapis.com\//);
    if (String(url).endsWith('/userProfiles/me')) return Response.json({ id: student ? 'student' : 'teacher' });
    if (String(url).includes('/teachers/') && student) return new Response('', { status: 404 });
    return Response.json({ userId: student ? 'student' : 'teacher' });
  };
  const cookie = async sub => `${SESSION_COOKIE}=${await seal({ sub, courseId: env.NEWSPAPER_CLASSROOM_ID, accessToken: 'test', exp: Date.now() + 60000 }, env.SESSION_SECRET)}`;
  try {
    const headers = { Cookie: await cookie('publication-admin'), Origin: 'https://worker.example', 'X-Editorial-CSRF': '1', 'Content-Type': 'application/json', 'Idempotency-Key': key };
    const send = (body = input(), changes = {}, path = '/api/publications') => worker.fetch(new Request('https://worker.example' + path, { method: 'POST', headers: { ...headers, ...changes }, body: JSON.stringify(body) }), env);
    assert.equal((await send(input(), { Cookie: '' })).status, 401);
    for (const change of [{ Origin: '' }, { Origin: 'https://evil.example' }, { 'X-Editorial-CSRF': '' }, { 'Idempotency-Key': '' }]) assert.ok([400, 403].includes((await send(input(), change)).status));
    assert.equal((await send(input({ publicPdfConfirmed: false }))).status, 400);
    assert.equal((await send(null)).status, 400);
    student = true;
    assert.equal((await send(input(), { Cookie: await cookie('publication-student') })).status, 403);
    student = false;
    assert.equal(count(f), 0);
    assert.equal((await send()).status, 201);
    assert.equal((await send()).status, 200);
    assert.equal((await send(input(), { Origin: 'https://evil.example' }, '/pridedesk/api/publications')).status, 403);
    assert.equal((await send(input(), { Origin: 'https://pridesk.example' }, '/pridedesk/api/publications')).status, 200);
    const before = externalCalls;
    const publicResponse = await worker.fetch(new Request('https://worker.example/api/public/issues'), env);
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers.get('Access-Control-Allow-Origin'), 'https://jdlions.github.io');
    assert.equal(publicResponse.headers.get('Access-Control-Allow-Credentials'), null);
    assert.equal(publicResponse.headers.get('Cache-Control'), 'no-store');
    const data = await publicResponse.json();
    assert.deepEqual(data.slice(1), legacy);
    assert.doesNotMatch(JSON.stringify(data), /published_by|idempotency|request_json|teacher|accessToken/);
    assert.equal(externalCalls, before);
    assert.equal((await send(input(), {}, '/api/public/issues')).status, 405);
    const unavailable = await worker.fetch(new Request('https://worker.example/api/public/issues'), { DB: {} });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('Access-Control-Allow-Origin'), 'https://jdlions.github.io');
    const listing = await worker.fetch(new Request('https://worker.example/api/publications', { headers }), env);
    assert.equal((await listing.json()).nextNumber, 36);
  } finally { globalThis.fetch = original; f.sql.close(); }
});
