const GOOGLE_API = 'https://www.googleapis.com';

function googleErrorStatus(status) {
  if ([401, 403, 404, 429].includes(status)) return status;
  if (status >= 500) return 502;
  return 502;
}

async function googleFetch(path, accessToken, init = {}) {
  const response = await fetch(`${GOOGLE_API}${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...init.headers } });
  if (!response.ok) {
    throw Object.assign(new Error(`Google API request failed (${response.status}).`), { status: googleErrorStatus(response.status), code: 'google_api_error' });
  }
  return response.status === 204 ? null : response.json();
}

export async function exchangeCode(code, env, verifier) {
  const body = new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.OAUTH_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: verifier });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw Object.assign(new Error('Google OAuth token exchange failed.'), { status: 401, code: 'oauth_exchange_failed' });
  return response.json();
}

export async function userInfo(accessToken) { return googleFetch('/oauth2/v3/userinfo', accessToken); }

// TEMPORARY CLASSROOM DEBUG: remove this helper and its callback call after the
// configured course ID has been verified. Never add account or token fields here.
export async function logClassroomCourseDebug(configuredCourseId, accessToken, logger = console) {
  try {
    const result = await googleFetch('/classroom/v1/courses?courseStates=ACTIVE&fields=courses(id,name)', accessToken);
    const courses = (result.courses || []).map(({ id, name }) => ({ id, name }));
    logger.info(JSON.stringify({
      event: 'classroom_course_debug',
      configuredCourseId,
      configuredCourseVisible: courses.some(course => course.id === configuredCourseId),
      courses
    }));
  } catch (error) {
    logger.warn(JSON.stringify({
      event: 'classroom_course_debug_failed',
      configuredCourseId,
      status: error.status || 500,
      code: error.code || 'internal_error'
    }));
  }
}

async function membership(path, accessToken) {
  try { const result = await googleFetch(path, accessToken); return result.students?.[0] || result.teachers?.[0] || null; }
  catch (error) { if (error.status === 403 || error.status === 404) return null; throw error; }
}

export async function resolveMembership(courseId, accessToken) {
  const teacher = await membership(`/classroom/v1/courses/${encodeURIComponent(courseId)}/teachers?userId=me`, accessToken);
  if (teacher) return { role: 'admin', studentId: null, classroomUserId: teacher.userId };
  const student = await membership(`/classroom/v1/courses/${encodeURIComponent(courseId)}/students?userId=me`, accessToken);
  if (student) return { role: 'student', studentId: student.userId, classroomUserId: student.userId };
  throw Object.assign(new Error('This account is not a member of the configured newspaper Classroom.'), { status: 403, code: 'classroom_membership_required' });
}

export const classroom = {
  courses: token => googleFetch('/classroom/v1/courses?courseStates=ACTIVE', token),
  courseWork: (courseId, token) => googleFetch(`/classroom/v1/courses/${encodeURIComponent(courseId)}/courseWork?courseWorkStates=PUBLISHED`, token),
  submissions: (courseId, workId, token) => googleFetch(`/classroom/v1/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(workId)}/studentSubmissions`, token)
};

function docsText(document) {
  return (document.body?.content || []).flatMap(x => x.paragraph?.elements || []).map(x => x.textRun?.content || '').join('');
}

export async function readDoc(documentId, token) {
  const response = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Object.assign(new Error(`Google Docs request failed (${response.status}).`), { status: response.status === 403 ? 403 : 502, code: 'google_docs_error' });
  const document = await response.json();
  return { documentId: document.documentId, title: document.title, text: docsText(document) };
}

export async function uploadToDrive(file, folderId, token) {
  if (!folderId) throw Object.assign(new Error('Drive upload folder is not configured.'), { status: 503, code: 'drive_folder_unconfigured' });
  const boundary = `lp-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: file.name, parents: [folderId] });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`, file, `\r\n--${boundary}--`]);
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  if (!response.ok) throw Object.assign(new Error('Google Drive upload failed.'), { status: 502, code: 'drive_upload_failed' });
  return response.json();
}
