const GOOGLE_API = 'https://www.googleapis.com';
const CLASSROOM_API = 'https://classroom.googleapis.com';

function googleErrorStatus(status) {
  if ([400, 401, 403, 404, 429].includes(status)) return status;
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

async function classroomFetch(path, accessToken, init = {}) {
  const response = await fetch(`${CLASSROOM_API}${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...init.headers } });
  if (!response.ok) {
    throw Object.assign(new Error(`Google Classroom API request failed (${response.status}).`), { status: googleErrorStatus(response.status), code: 'google_api_error' });
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

async function membership(path, accessToken) {
  try { return await classroomFetch(path, accessToken); }
  catch (error) { if (error.status === 404) return null; throw error; }
}

export async function resolveMembership(courseId, accessToken) {
  const profile = await classroomFetch('/v1/userProfiles/me', accessToken);
  if (!profile?.id) throw Object.assign(new Error('Google Classroom user profile is missing an ID.'), { status: 502, code: 'classroom_profile_invalid' });
  const userId = encodeURIComponent(profile.id);
  const teacher = await membership(`/v1/courses/${encodeURIComponent(courseId)}/teachers/${userId}`, accessToken);
  if (teacher) return { role: 'admin', studentId: null, classroomUserId: teacher.userId };
  const student = await membership(`/v1/courses/${encodeURIComponent(courseId)}/students/${userId}`, accessToken);
  if (student) return { role: 'student', studentId: student.userId, classroomUserId: student.userId };
  throw Object.assign(new Error('This account is not a member of the configured newspaper Classroom.'), { status: 403, code: 'classroom_membership_required' });
}

export const classroom = {
  courses: token => classroomFetch('/v1/courses?courseStates=ACTIVE', token),
  courseWork: (courseId, token) => classroomFetch(`/v1/courses/${encodeURIComponent(courseId)}/courseWork?courseWorkStates=PUBLISHED`, token),
  submissions: (courseId, workId, token) => classroomFetch(`/v1/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(workId)}/studentSubmissions`, token),
  students: async (courseId, token) => {
    const students = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({ pageSize: '100' });
      if (pageToken) query.set('pageToken', pageToken);
      const data = await classroomFetch(`/v1/courses/${encodeURIComponent(courseId)}/students?${query}`, token);
      students.push(...(data.students || []));
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return students;
  }
};

function docsText(document) {
  return (document.body?.content || []).flatMap(x => x.paragraph?.elements || []).map(x => x.textRun?.content || '').join('');
}

export async function readDoc(documentId, token) {
  const response = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Object.assign(new Error(`Google Docs request failed (${response.status}).`), { status: [400,403,404].includes(response.status) ? response.status : 502, code: 'google_docs_error' });
  const document = await response.json();
  return { documentId: document.documentId, title: document.title, text: docsText(document) };
}

export async function driveFileMetadata(fileId, token) {
  return googleFetch(`/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,fileExtension,webViewLink`, token);
}

export async function downloadDriveFile(fileId, token, maxBytes) {
  const response = await fetch(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Object.assign(new Error(`Google Drive download failed (${response.status}).`), { status: googleErrorStatus(response.status), code: 'drive_download_error' });
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > maxBytes) throw Object.assign(new Error('Drive file exceeds the supported size limit.'), { status: 413, code: 'docx_oversize' });
  const data = await response.arrayBuffer();
  if (data.byteLength > maxBytes) throw Object.assign(new Error('Drive file exceeds the supported size limit.'), { status: 413, code: 'docx_oversize' });
  return data;
}

const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SAFE_DRIVE_REASONS = new Set([
  'accessNotConfigured', 'appNotAuthorizedToFile', 'dailyLimitExceeded', 'domainPolicy',
  'fileNotFound', 'insufficientFilePermissions', 'rateLimitExceeded', 'sharingRateLimitExceeded',
  'storageQuotaExceeded', 'teamDriveFileLimitExceeded', 'userRateLimitExceeded'
]);

async function safeDriveError(response) {
  let reason = '';
  try {
    const body = await response.json();
    const candidate = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
    if (SAFE_DRIVE_REASONS.has(candidate)) reason = candidate;
  } catch {}
  return { upstreamStatus: response.status, reason };
}

function driveAppError(kind, upstreamStatus, reason = '') {
  const quota = upstreamStatus === 429 || ['dailyLimitExceeded', 'rateLimitExceeded', 'sharingRateLimitExceeded', 'storageQuotaExceeded', 'teamDriveFileLimitExceeded', 'userRateLimitExceeded'].includes(reason);
  if (quota) return Object.assign(new Error('Google Drive quota or rate limit was exceeded.'), { status: 429, code: 'drive_quota_exceeded', upstreamStatus, reason });
  if (kind === 'folder' && upstreamStatus === 404) return Object.assign(new Error('Drive upload folder is not accessible.'), { status: 403, code: 'drive_folder_not_accessible', upstreamStatus, reason });
  if (upstreamStatus === 401 || upstreamStatus === 403) return Object.assign(new Error('The current account cannot add files to the Drive upload folder.'), { status: 403, code: 'drive_permission_denied', upstreamStatus, reason });
  return Object.assign(new Error('Google Drive upload failed.'), { status: 502, code: 'drive_upload_failed', upstreamStatus, reason });
}

export async function driveFolderPreflight(folderId, token) {
  if (!folderId) throw Object.assign(new Error('Drive upload folder is not configured.'), { status: 503, code: 'drive_folder_unconfigured' });
  const query = new URLSearchParams({ fields: 'id,name,mimeType,driveId,capabilities', supportsAllDrives: 'true' });
  const response = await fetch(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(folderId)}?${query}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) { const safe = await safeDriveError(response); throw driveAppError('folder', safe.upstreamStatus, safe.reason); }
  const folder = await response.json();
  if (folder.mimeType !== DRIVE_FOLDER_MIME_TYPE) throw Object.assign(new Error('Configured Drive target is not a folder.'), { status: 503, code: 'drive_folder_not_accessible' });
  if (folder.capabilities?.canAddChildren !== true) throw Object.assign(new Error('The current account cannot add files to the Drive upload folder.'), { status: 403, code: 'drive_permission_denied' });
  return { id: folder.id, name: folder.name, mimeType: folder.mimeType, driveId: folder.driveId || null, canAddChildren: true };
}

export async function uploadToDrive(file, folderId, token) {
  await driveFolderPreflight(folderId, token);
  const boundary = `lp-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: file.name, parents: [folderId] });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`, file, `\r\n--${boundary}--`]);
  const query = new URLSearchParams({ uploadType: 'multipart', fields: 'id,name,mimeType,size', supportsAllDrives: 'true' });
  const response = await fetch(`${GOOGLE_API}/upload/drive/v3/files?${query}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  if (!response.ok) { const safe = await safeDriveError(response); throw driveAppError('upload', safe.upstreamStatus, safe.reason); }
  return response.json();
}

export async function deleteDriveFile(fileId, token) {
  const response = await fetch(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok && response.status !== 404) { const safe = await safeDriveError(response); throw driveAppError('delete', safe.upstreamStatus, safe.reason); }
}
