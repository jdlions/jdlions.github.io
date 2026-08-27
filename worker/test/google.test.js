import test from 'node:test';
import assert from 'node:assert/strict';
import { classroom, resolveMembership } from '../src/google.js';

const originalFetch = globalThis.fetch;
const CLASSROOM_ORIGIN = 'https://classroom.googleapis.com';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test.afterEach(() => { globalThis.fetch = originalFetch; });

test('teacher membership uses the stable Classroom user ID and returns admin', async () => {
  const requested = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    requested.push(parsed);
    assert.equal(parsed.origin, CLASSROOM_ORIGIN);
    if (parsed.pathname === '/v1/userProfiles/me') return jsonResponse({ id: 'stable/user-id' });
    if (parsed.pathname === '/v1/courses/course/teachers/stable%2Fuser-id') return jsonResponse({ userId: 'stable/user-id' });
    throw new Error(`Unexpected URL: ${url}`);
  };

  assert.deepEqual(await resolveMembership('course', 'secret-token'), {
    role: 'admin', studentId: null, classroomUserId: 'stable/user-id'
  });
  assert.equal(requested.length, 2);
});

test('teacher 404 falls back to student get and returns student', async () => {
  const requested = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    requested.push(parsed.pathname);
    assert.equal(parsed.origin, CLASSROOM_ORIGIN);
    if (parsed.pathname === '/v1/userProfiles/me') return jsonResponse({ id: 'student-123' });
    if (parsed.pathname.endsWith('/teachers/student-123')) return jsonResponse({ error: { message: 'not a teacher' } }, 404);
    if (parsed.pathname.endsWith('/students/student-123')) return jsonResponse({ userId: 'student-123' });
    throw new Error(`Unexpected URL: ${url}`);
  };

  assert.deepEqual(await resolveMembership('course/id', 'secret-token'), {
    role: 'student', studentId: 'student-123', classroomUserId: 'student-123'
  });
  assert.deepEqual(requested, [
    '/v1/userProfiles/me',
    '/v1/courses/course%2Fid/teachers/student-123',
    '/v1/courses/course%2Fid/students/student-123'
  ]);
});

test('teacher and student 404 responses return membership_required', async () => {
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/userProfiles/me') return jsonResponse({ id: 'outsider-789' });
    return jsonResponse({ error: { message: 'not a member' } }, 404);
  };

  await assert.rejects(resolveMembership('course', 'secret-token'), error =>
    error.status === 403 && error.code === 'classroom_membership_required'
  );
});

test('membership lookup preserves 400 and does not treat it as a role miss', async () => {
  let calls = 0;
  globalThis.fetch = async url => {
    calls += 1;
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/userProfiles/me') return jsonResponse({ id: 'user-400' });
    return jsonResponse({ error: { message: 'bad request' } }, 400);
  };

  await assert.rejects(resolveMembership('course', 'secret-token'), error => error.status === 400 && error.code === 'google_api_error');
  assert.equal(calls, 2);
});

test('membership lookup preserves 403 and does not treat it as a role miss', async () => {
  let calls = 0;
  globalThis.fetch = async url => {
    calls += 1;
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/userProfiles/me') return jsonResponse({ id: 'user-403' });
    return jsonResponse({ error: { message: 'forbidden' } }, 403);
  };

  await assert.rejects(resolveMembership('course', 'secret-token'), error => error.status === 403 && error.code === 'google_api_error');
  assert.equal(calls, 2);
});

test('all Classroom collection methods use the Classroom host and v1 paths', async () => {
  const requested = [];
  globalThis.fetch = async (url, init) => {
    requested.push({ url: new URL(url), authorization: init.headers.Authorization });
    return jsonResponse({ courses: [], courseWork: [], studentSubmissions: [] });
  };
  await classroom.courses('secret-token');
  await classroom.courseWork('course/id', 'secret-token');
  await classroom.submissions('course/id', 'work/id', 'secret-token');
  await classroom.students('course/id', 'secret-token');
  assert.deepEqual(requested.map(item => item.url.origin), Array(4).fill(CLASSROOM_ORIGIN));
  assert.deepEqual(requested.map(item => item.url.pathname), [
    '/v1/courses',
    '/v1/courses/course%2Fid/courseWork',
    '/v1/courses/course%2Fid/courseWork/work%2Fid/studentSubmissions',
    '/v1/courses/course%2Fid/students'
  ]);
  assert.deepEqual(requested.map(item => item.authorization), Array(4).fill('Bearer secret-token'));
});

test('student roster pagination is deduplicated into one collection result', async () => {
  const requested=[];
  globalThis.fetch=async url=>{const parsed=new URL(url);requested.push(parsed.searchParams.get('pageToken'));return requested.length===1?jsonResponse({students:[{userId:'one'}],nextPageToken:'next'}):jsonResponse({students:[{userId:'two'}]});};
  assert.deepEqual((await classroom.students('course','token')).map(x=>x.userId),['one','two']);
  assert.deepEqual(requested,[null,'next']);
});

test('Classroom API status mapping is explicit and does not retain response details', async t => {
  const cases = [[400, 400], [401, 401], [403, 403], [404, 404], [429, 429], [500, 502], [503, 502]];
  for (const [upstreamStatus, expectedStatus] of cases) {
    await t.test(`${upstreamStatus} maps to ${expectedStatus}`, async () => {
      globalThis.fetch = async () => jsonResponse({ error: { message: 'sensitive detail', token: 'must-not-leak' } }, upstreamStatus);
      await assert.rejects(classroom.courses('secret-token'), error => {
        assert.equal(error.status, expectedStatus);
        assert.equal(error.code, 'google_api_error');
        assert.equal('detail' in error, false);
        assert.equal(JSON.stringify(error).includes('must-not-leak'), false);
        return true;
      });
    });
  }
});
