import { clearCookie, cookie, randomToken, requireTrustedOrigin, sanitizeHtml, seal, setCookie, STATE_COOKIE, SESSION_COOKIE, unseal } from './security.js';
import { classroom, exchangeCode, readDoc, resolveMembership, uploadToDrive, userInfo } from './google.js';
import { repository } from './repository.js';

const SESSION_SECONDS = 45 * 60;
const allowedPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const scopes = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents.readonly'
];

function cors(env) { return { 'Access-Control-Allow-Origin': env.FRONTEND_ORIGIN, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type, X-Editorial-CSRF', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', Vary: 'Origin' }; }
function response(data, status, env, headers = {}) { return new Response(data == null ? null : JSON.stringify(data), { status, headers: { ...cors(env), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } }); }
const ok = (data, env, status = 200, headers) => response(data, status, env, headers);
const fail = (error, env) => response({ error: { code: error.code || 'internal_error', message: error.status ? error.message : 'Unexpected server error.' } }, error.status || 500, env);

function requireConfig(env) {
  for (const name of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','SESSION_SECRET','FRONTEND_ORIGIN','OAUTH_REDIRECT_URI','NEWSPAPER_CLASSROOM_ID']) {
    if (!env[name]) throw Object.assign(new Error(`${name} is not configured.`), { status: 503, code: 'configuration_error' });
  }
}

async function session(request, env, verifyMembership = true) {
  const sealed = cookie(request, SESSION_COOKIE);
  const value = sealed && await unseal(sealed, env.SESSION_SECRET);
  if (!value || value.exp <= Date.now() || value.courseId !== env.NEWSPAPER_CLASSROOM_ID) throw Object.assign(new Error('Authentication required.'), { status: 401, code: 'authentication_required' });
  if (verifyMembership) {
    const membership = await resolveMembership(env.NEWSPAPER_CLASSROOM_ID, value.accessToken);
    value.role = membership.role; value.studentId = membership.studentId; value.classroomUserId = membership.classroomUserId;
  }
  return value;
}

const requireAdmin = value => { if (value.role !== 'admin') throw Object.assign(new Error('Teacher access required.'), { status: 403, code: 'admin_required' }); };
const escapeText = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function editForViewer(edit, role) {
  if (!edit || role !== 'student' || edit.note_visibility === 'student') return edit;
  const { editor_note: _internalNote, ...visible } = edit;
  return visible;
}

export function configuredCourses(data, configuredCourseId) {
  return { ...data, courses: (data.courses || []).filter(course => course.id === configuredCourseId) };
}

async function login(request, env) {
  requireConfig(env);
  const state = randomToken(), verifier = randomToken(48);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const returnTo = new URL(request.url).searchParams.get('returnTo') || '/';
  const stateValue = await seal({ state, verifier, returnTo: returnTo.startsWith('/') ? returnTo : '/' }, env.SESSION_SECRET);
  const query = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.OAUTH_REDIRECT_URI, response_type: 'code', scope: scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'online', include_granted_scopes: 'true' });
  return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${query}`, 'Set-Cookie': setCookie(STATE_COOKIE, stateValue, 600), 'Cache-Control': 'no-store' } });
}

async function callback(request, env) {
  requireConfig(env);
  const url = new URL(request.url), saved = await unseal(cookie(request, STATE_COOKIE) || '', env.SESSION_SECRET);
  if (!saved || !url.searchParams.get('state') || saved.state !== url.searchParams.get('state')) throw Object.assign(new Error('OAuth state validation failed.'), { status: 400, code: 'oauth_state_invalid' });
  if (url.searchParams.get('error')) throw Object.assign(new Error('Google sign-in was cancelled or denied.'), { status: 401, code: 'oauth_denied' });
  const code = url.searchParams.get('code'); if (!code) throw Object.assign(new Error('OAuth authorization code is missing.'), { status: 400, code: 'oauth_code_missing' });
  const tokens = await exchangeCode(code, env, saved.verifier);
  const [identity, membership] = await Promise.all([userInfo(tokens.access_token), resolveMembership(env.NEWSPAPER_CLASSROOM_ID, tokens.access_token)]);
  const expires = Math.min(Date.now() + SESSION_SECONDS * 1000, Date.now() + Number(tokens.expires_in || SESSION_SECONDS) * 1000);
  const value = await seal({ sub: identity.sub, name: identity.name, email: identity.email, role: membership.role, studentId: membership.studentId, classroomUserId: membership.classroomUserId, courseId: env.NEWSPAPER_CLASSROOM_ID, accessToken: tokens.access_token, exp: expires }, env.SESSION_SECRET);
  const target = membership.role === 'admin' ? '/admin/' : '/student/';
  return new Response(null, { status: 302, headers: [['Location', `${env.FRONTEND_ORIGIN}${saved.returnTo === '/' ? target : saved.returnTo}`], ['Set-Cookie', setCookie(SESSION_COOKIE, value, SESSION_SECONDS)], ['Set-Cookie', clearCookie(STATE_COOKIE)], ['Cache-Control','no-store']] });
}

async function collectArticles(issue, token, viewer) {
  const rows = [];
  for (const type of issue.articleTypes) {
    const data = await classroom.submissions(issue.classroomCourseId, type.courseWorkId, token);
    for (const submission of data.studentSubmissions || []) {
      if (viewer.role === 'student' && submission.userId !== viewer.studentId) continue;
      const attachments = (submission.assignmentSubmission?.attachments || []).map(x => x.driveFile).filter(Boolean);
      rows.push({ id: submission.id, issueId: issue.id, courseId: issue.classroomCourseId, courseWorkId: type.courseWorkId, articleTypeId: type.id, studentId: submission.userId, state: submission.state, submittedAt: submission.updateTime || submission.creationTime, attachments });
    }
  }
  return rows;
}

async function routeApi(request, env, pathname) {
  const viewer = await session(request, env);
  if (pathname === '/api/session' && request.method === 'GET') return ok({ authenticated: true, user: { id: viewer.sub, name: viewer.name, email: viewer.email, role: viewer.role, studentId: viewer.studentId } }, env);
  if (pathname === '/api/classroom/courses' && request.method === 'GET') { requireAdmin(viewer); return ok(configuredCourses(await classroom.courses(viewer.accessToken),env.NEWSPAPER_CLASSROOM_ID), env); }
  const work = pathname.match(/^\/api\/classroom\/([^/]+)\/coursework$/);
  if (work && request.method === 'GET') { requireAdmin(viewer); if (work[1] !== env.NEWSPAPER_CLASSROOM_ID) throw Object.assign(new Error('Course is outside the configured newspaper Classroom.'), { status: 403, code: 'course_forbidden' }); return ok(await classroom.courseWork(work[1], viewer.accessToken), env); }
  const repo = repository(env);
  if (pathname === '/api/issues' && request.method === 'GET') return ok(await repo.listIssues(), env);
  if (pathname === '/api/issues' && request.method === 'POST') { requireAdmin(viewer); const input=await request.json(); if(input.classroomCourseId!==env.NEWSPAPER_CLASSROOM_ID || !Array.isArray(input.articleTypes) || input.articleTypes.some(x=>!x.courseWorkId)) throw Object.assign(new Error('Explicit configured courseId and courseWorkId values are required.'),{status:400,code:'invalid_issue_mapping'}); return ok(await repo.createIssue(input),env,201); }
  const issueActivation=pathname.match(/^\/api\/issues\/([^/]+)\/activate$/);
  if(issueActivation&&request.method==='PATCH'){requireAdmin(viewer);return ok(await repo.setActiveIssue(issueActivation[1]),env);}
  if (pathname === '/api/articles' && request.method === 'GET') { const issueId=new URL(request.url).searchParams.get('issueId'); const issue=issueId&&await repo.getIssue(issueId); if(!issue) throw Object.assign(new Error('A valid issueId is required.'),{status:400,code:'issue_required'}); const articles=await collectArticles(issue,viewer.accessToken,viewer); const edits=await repo.listEdits(issue.id,viewer.role==='student'?viewer.studentId:null); return ok(articles.map(a=>({...a,edit:editForViewer(edits.find(e=>e.submission_id===a.id)||null,viewer.role)})),env); }
  const article = pathname.match(/^\/api\/articles\/([^/]+)$/);
  if(article && request.method==='GET'){const issueId=new URL(request.url).searchParams.get('issueId'),issue=issueId&&await repo.getIssue(issueId);if(!issue)throw Object.assign(new Error('A valid issueId is required.'),{status:400,code:'issue_required'});const found=(await collectArticles(issue,viewer.accessToken,viewer)).find(x=>x.id===article[1]);if(!found)throw Object.assign(new Error('Article submission not found.'),{status:404,code:'article_not_found'});const doc=found.attachments[0]?.id?await readDoc(found.attachments[0].id,viewer.accessToken):null;return ok({...found,originalContent:doc?`<p>${escapeText(doc.text).replace(/\n/g,'</p><p>')}</p>`:'',edit:editForViewer(await repo.getEdit(found.id),viewer.role)},env);}
  const edit = pathname.match(/^\/api\/articles\/([^/]+)\/edit$/);
  if(edit && request.method==='PATCH'){requireAdmin(viewer);const input=await request.json(),issue=await repo.getIssue(input.issueId);if(!issue)throw Object.assign(new Error('Issue not found.'),{status:404,code:'issue_not_found'});const found=(await collectArticles(issue,viewer.accessToken,viewer)).find(x=>x.id===edit[1]);if(!found)throw Object.assign(new Error('Article submission not found.'),{status:404,code:'article_not_found'});return ok(await repo.saveEdit(found.id,{...found,studentGoogleId:found.studentId,editedHtml:sanitizeHtml(input.editedHtml),editorNote:String(input.editorNote||'').slice(0,5000),noteVisibility:input.noteVisibility==='student'?'student':'internal',status:input.status},viewer.sub),env);}
  if(pathname==='/api/photos'&&request.method==='GET'){const issueId=new URL(request.url).searchParams.get('issueId');if(!issueId)throw Object.assign(new Error('issueId is required.'),{status:400,code:'issue_required'});return ok(await repo.listPhotos(issueId,viewer.role==='student'?viewer.studentId:null),env);}
  const photoStatus=pathname.match(/^\/api\/photos\/([^/]+)\/status$/);
  if(photoStatus&&request.method==='PATCH'){requireAdmin(viewer);const input=await request.json();if(!['unreviewed','approved','hold','rejected'].includes(input.status))throw Object.assign(new Error('Invalid photo status.'),{status:400,code:'invalid_status'});return ok(await repo.updatePhotoStatus(photoStatus[1],input.status),env);}
  if(pathname==='/api/photos/upload'&&request.method==='POST'){if(viewer.role!=='student')throw Object.assign(new Error('Student access required.'),{status:403,code:'student_required'});const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||!allowedPhotoTypes.has(file.type)||file.size>15*1024*1024)throw Object.assign(new Error('Upload a JPEG, PNG, or WebP file no larger than 15 MB.'),{status:400,code:'invalid_photo'});const drive=await uploadToDrive(file,env.DRIVE_UPLOAD_FOLDER_ID,viewer.accessToken);return ok(await repo.createPhoto({issueId:form.get('issueId'),articleSubmissionId:form.get('articleSubmissionId'),studentGoogleId:viewer.studentId,driveFileId:drive.id,filename:drive.name,mimeType:drive.mimeType,byteSize:Number(drive.size||file.size),caption:String(form.get('caption')||'').slice(0,1000),photographer:String(form.get('photographer')||'').slice(0,200),sourceType:String(form.get('sourceType')||'').slice(0,100)}),env,201);}
  throw Object.assign(new Error('API route not found.'), { status: 404, code: 'not_found' });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
      if (url.pathname === '/auth/login' && request.method === 'GET') return login(request, env);
      if (url.pathname === '/auth/callback' && request.method === 'GET') return callback(request, env);
      if (url.pathname === '/auth/logout' && request.method === 'POST') { requireTrustedOrigin(request, env); return ok({ authenticated: false }, env, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE) }); }
      if (url.pathname === '/api/session' && request.method === 'GET' && !cookie(request, SESSION_COOKIE)) return ok({ authenticated: false, user: null }, env);
      if (url.pathname.startsWith('/api/')) { requireTrustedOrigin(request, env); return await routeApi(request, env, url.pathname); }
      return ok({ service: 'The Lions Pride Editorial API', status: 'ok' }, env);
    } catch (error) { console.error(JSON.stringify({ code:error.code||'internal_error', status:error.status||500 })); return fail(error, env); }
  }
};
