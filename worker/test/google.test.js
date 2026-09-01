import test from 'node:test';
import assert from 'node:assert/strict';
import { classroom, downloadDriveFile, driveFolderPreflight, uploadToDrive, resolveMembership, streamDriveImage } from '../src/google.js';

const originalFetch = globalThis.fetch;
const CLASSROOM_ORIGIN = 'https://classroom.googleapis.com';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test.afterEach(() => { globalThis.fetch = originalFetch; });

test('Drive folder preflight supports shared drives and requires canAddChildren', async () => {
  globalThis.fetch=async(url,init)=>{const parsed=new URL(url);assert.equal(parsed.pathname,'/drive/v3/files/folder%2Fid');assert.equal(parsed.searchParams.get('supportsAllDrives'),'true');assert.equal(parsed.searchParams.get('fields'),'id,name,mimeType,driveId,capabilities');assert.equal(init.headers.Authorization,'Bearer token');return jsonResponse({id:'folder/id',name:'Private',mimeType:'application/vnd.google-apps.folder',driveId:'shared',capabilities:{canAddChildren:true}});};
  assert.deepEqual(await driveFolderPreflight('folder/id','token'),{id:'folder/id',name:'Private',mimeType:'application/vnd.google-apps.folder',driveId:'shared',canAddChildren:true});
});

test('Drive folder preflight maps inaccessible and non-writable folders', async t => {
  for(const status of [403,404])await t.test(String(status),async()=>{globalThis.fetch=async()=>jsonResponse({error:{errors:[{reason:'fileNotFound'}],message:'private body'}},status);await assert.rejects(driveFolderPreflight('folder','token'),error=>error.code===(status===404?'drive_folder_not_accessible':'drive_permission_denied')&&!JSON.stringify(error).includes('private body'));});
  await t.test('canAddChildren false',async()=>{globalThis.fetch=async()=>jsonResponse({id:'folder',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:false}});await assert.rejects(driveFolderPreflight('folder','token'),error=>error.code==='drive_permission_denied');});
});

test('multipart Drive upload preserves binary bytes, CRLF boundaries, and Shared Drive support', async () => {
  const binary=new Uint8Array([0,255,13,10,128]);let calls=0;
  globalThis.fetch=async(url,init)=>{calls++;const parsed=new URL(url);if(calls===1)return jsonResponse({id:'folder',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}});assert.equal(parsed.pathname,'/upload/drive/v3/files');assert.equal(parsed.searchParams.get('uploadType'),'multipart');assert.equal(parsed.searchParams.get('supportsAllDrives'),'true');const boundary=/boundary=(.+)$/.exec(init.headers['Content-Type'])[1],body=new Uint8Array(await init.body.arrayBuffer()),text=new TextDecoder('latin1').decode(body);assert.match(text,new RegExp(`^--${boundary}\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n`));assert.match(text,new RegExp(`\\r\\n--${boundary}\\r\\nContent-Type: image/png\\r\\n\\r\\n`));assert.match(text,new RegExp(`\\r\\n--${boundary}--$`));assert.notEqual(body.findIndex((value,index)=>binary.every((item,offset)=>body[index+offset]===item)), -1);return jsonResponse({id:'photo',name:'사진.png',mimeType:'image/png',size:'5'});};
  assert.equal((await uploadToDrive(new File([binary],'사진.png',{type:'image/png'}),'folder','token')).id,'photo');
});

test('Drive upload maps permission, quota, rate limit, and server failures to stable codes',async t=>{
  const cases=[[403,'insufficientFilePermissions','drive_permission_denied',403],[403,'storageQuotaExceeded','drive_quota_exceeded',429],[429,'userRateLimitExceeded','drive_quota_exceeded',429],[500,'','drive_upload_failed',502]];
  for(const [status,reason,code,appStatus]of cases)await t.test(`${status} ${reason}`,async()=>{let calls=0;globalThis.fetch=async()=>++calls===1?jsonResponse({id:'folder',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}}):jsonResponse({error:{errors:[{reason}],message:'secret detail',token:'never-log'}},status);await assert.rejects(uploadToDrive(new File(['x'],'x.jpg',{type:'image/jpeg'}),'folder','token'),error=>error.code===code&&error.status===appStatus&&!JSON.stringify(error).includes('secret detail')&&!JSON.stringify(error).includes('never-log'));});
});

test('Drive media download requests alt=media and returns binary data', async () => {
  globalThis.fetch=async (url,init)=>{
    const parsed=new URL(url);
    assert.equal(parsed.pathname,'/drive/v3/files/file%2Fid');
    assert.equal(parsed.searchParams.get('alt'),'media');
    assert.equal(init.headers.Authorization,'Bearer secret-token');
    return new Response(new Uint8Array([80,75,3,4]),{headers:{'Content-Length':'4'}});
  };
  assert.deepEqual(new Uint8Array(await downloadDriveFile('file/id','secret-token',100)),new Uint8Array([80,75,3,4]));
});

test('Drive media download rejects declared and actual oversized files', async t => {
  await t.test('declared size',async()=>{
    globalThis.fetch=async()=>new Response(new Uint8Array([1]),{headers:{'Content-Length':'101'}});
    await assert.rejects(downloadDriveFile('file','token',100),error=>error.status===413&&error.code==='docx_oversize');
  });
  await t.test('actual size',async()=>{
    globalThis.fetch=async()=>new Response(new Uint8Array(101));
    await assert.rejects(downloadDriveFile('file','token',100),error=>error.status===413&&error.code==='docx_oversize');
  });
});

test('authenticated Drive image stream includes Shared Drive support and accepts safe MIME types', async () => {
  globalThis.fetch=async(url,init)=>{const parsed=new URL(url);assert.equal(parsed.pathname,'/drive/v3/files/photo%2Fid');assert.equal(parsed.searchParams.get('alt'),'media');assert.equal(parsed.searchParams.get('supportsAllDrives'),'true');assert.equal(init.headers.Authorization,'Bearer private-token');return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/webp','Content-Length':'3'}});};
  const media=await streamDriveImage('photo/id','private-token');
  assert.equal(media.contentType,'image/webp');assert.equal(media.contentLength,'3');
});

test('Drive image stream blocks SVG and HTML active content', async t => {
  for(const type of ['image/svg+xml','text/html'])await t.test(type,async()=>{globalThis.fetch=async()=>new Response('<active>',{headers:{'Content-Type':type}});await assert.rejects(streamDriveImage('photo','token'),error=>error.status===415&&error.code==='photo_content_type_blocked');});
});

test('Drive image stream maps 403, 404, and 5xx without leaking upstream bodies', async t => {
  for(const [status,code]of [[403,'photo_content_forbidden'],[404,'photo_content_not_found'],[500,'photo_content_unavailable']])await t.test(String(status),async()=>{globalThis.fetch=async()=>new Response('secret upstream body',{status});await assert.rejects(streamDriveImage('photo','token'),error=>error.code===code&&!JSON.stringify(error).includes('secret upstream body'));});
});

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

test('the only Classroom collection is the configured roster', async () => {
  const requested = [];
  globalThis.fetch = async (url, init) => {
    requested.push({ url: new URL(url), authorization: init.headers.Authorization });
    return jsonResponse({ students: [] });
  };
  await classroom.students('course/id', 'secret-token');
  assert.deepEqual(requested.map(item => item.url.origin), [CLASSROOM_ORIGIN]);
  assert.deepEqual(requested.map(item => item.url.pathname), ['/v1/courses/course%2Fid/students']);
  assert.deepEqual(requested.map(item => item.authorization), ['Bearer secret-token']);
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
      await assert.rejects(classroom.students('course','secret-token'), error => {
        assert.equal(error.status, expectedStatus);
        assert.equal(error.code, 'google_api_error');
        assert.equal('detail' in error, false);
        assert.equal(JSON.stringify(error).includes('must-not-leak'), false);
        return true;
      });
    });
  }
});
