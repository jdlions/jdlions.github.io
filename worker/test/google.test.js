import test from 'node:test';
import assert from 'node:assert/strict';
import { classroom, logClassroomCourseDebug, resolveMembership } from '../src/google.js';

const originalFetch = globalThis.fetch;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('teacher lookup 404 falls back to a successful student lookup', async () => {
  const requested = [];
  globalThis.fetch = async url => {
    requested.push(url);
    if (url.includes('/teachers?')) return jsonResponse({ error: { message: 'not found' } }, 404);
    if (url.includes('/students?')) return jsonResponse({ students: [{ userId: 'student-123' }] });
    throw new Error(`Unexpected URL: ${url}`);
  };

  assert.deepEqual(await resolveMembership('course/id', 'secret-token'), {
    role: 'student',
    studentId: 'student-123',
    classroomUserId: 'student-123'
  });
  assert.equal(requested.length, 2);
  assert.match(requested[0], /course%2Fid\/teachers/);
  assert.match(requested[1], /course%2Fid\/students/);
});

test('successful teacher lookup returns the admin role without a student lookup', async () => {
  let calls = 0;
  globalThis.fetch = async url => {
    calls += 1;
    assert.match(url, /\/teachers\?/);
    return jsonResponse({ teachers: [{ userId: 'teacher-456' }] });
  };

  assert.deepEqual(await resolveMembership('course', 'secret-token'), {
    role: 'admin',
    studentId: null,
    classroomUserId: 'teacher-456'
  });
  assert.equal(calls, 1);
});

test('missing teacher and student memberships return membership_required', async () => {
  globalThis.fetch = async () => jsonResponse({ error: { message: 'not a member' } }, 404);

  await assert.rejects(
    resolveMembership('course', 'secret-token'),
    error => error.status === 403 && error.code === 'classroom_membership_required'
  );
});

test('Classroom debug log contains only configured ID and course ID/name data', async () => {
  const requested = [];
  globalThis.fetch = async (url, init) => {
    requested.push(url);
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://classroom.googleapis.com');
    assert.equal(parsed.pathname, '/v1/courses');
    assert.equal(parsed.searchParams.get('courseStates'), 'ACTIVE');
    assert.equal(parsed.searchParams.get('fields'), 'nextPageToken,courses(id,name)');
    assert.equal(parsed.searchParams.has('courseId'), false);
    assert.equal(url.includes('course-1'), false);
    assert.equal(init.headers.Authorization, 'Bearer secret-token');
    return jsonResponse({
      courses: [
        { id: 'course-1', name: 'Newspaper', ownerId: 'private-owner' },
        { id: 'course-2', name: 'English', email: 'private@example.com' }
      ]
    });
  };
  const entries = [];
  const logger = {
    info: entry => entries.push(entry),
    warn: entry => entries.push(entry)
  };

  await logClassroomCourseDebug('course-1', 'secret-token', logger);

  assert.equal(requested.length, 1);
  assert.equal(entries.length, 1);
  assert.deepEqual(JSON.parse(entries[0]), {
    event: 'classroom_course_debug',
    configuredCourseId: 'course-1',
    configuredCourseVisible: true,
    courses: [
      { id: 'course-1', name: 'Newspaper' },
      { id: 'course-2', name: 'English' }
    ]
  });
  assert.equal(entries[0].includes('secret-token'), false);
  assert.equal(entries[0].includes('private'), false);
});

test('Classroom debug course listing follows pagination without logging page tokens', async () => {
  const requested = [];
  globalThis.fetch = async url => {
    requested.push(url);
    const pageToken = new URL(url).searchParams.get('pageToken');
    if (!pageToken) return jsonResponse({ courses: [{ id: 'course-1', name: 'Newspaper' }], nextPageToken: 'page-secret' });
    assert.equal(pageToken, 'page-secret');
    return jsonResponse({ courses: [{ id: 'course-2', name: 'Photography' }] });
  };
  const entries = [];

  await logClassroomCourseDebug('course-2', 'secret-token', {
    info: entry => entries.push(entry),
    warn: entry => entries.push(entry)
  });

  assert.equal(requested.length, 2);
  assert.deepEqual(JSON.parse(entries[0]), {
    event: 'classroom_course_debug',
    configuredCourseId: 'course-2',
    configuredCourseVisible: true,
    courses: [
      { id: 'course-1', name: 'Newspaper' },
      { id: 'course-2', name: 'Photography' }
    ]
  });
  assert.equal(entries[0].includes('page-secret'), false);
  assert.equal(entries[0].includes('secret-token'), false);
});

test('Google API status mapping preserves actionable client errors and normalizes upstream failures', async t => {
  const cases = [
    [401, 401],
    [403, 403],
    [404, 404],
    [429, 429],
    [500, 502],
    [503, 502],
    [400, 502]
  ];

  for (const [upstreamStatus, expectedStatus] of cases) {
    await t.test(`${upstreamStatus} maps to ${expectedStatus}`, async () => {
      globalThis.fetch = async () => jsonResponse({
        error: { message: 'sensitive upstream detail', token: 'must-not-leak' }
      }, upstreamStatus);

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
