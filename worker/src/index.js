import { clearCookie, cookie, randomToken, requireTrustedOrigin, sanitizeHtml, seal, setCookie, STATE_COOKIE, SESSION_COOKIE, unseal } from './security.js';
import { classroom, deleteDriveFile, downloadDriveFile, driveFileMetadata, driveFolderPreflight, exchangeCode, readDoc, resolveMembership, streamDriveImage, uploadToDrive, userInfo } from './google.js';
import { repository } from './repository.js';
import { DOCX_MIME, MAX_DOCX_BYTES, parseDocx } from './docx.js';

const SESSION_SECONDS = 45 * 60;
const MEMBERSHIP_CACHE_MS = 5 * 60 * 1000;
const membershipCache = new Map();
const allowedPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
export function validateStudentPhoto(file, articleSubmissionId, articles) {
  if (!articles.some(article => article.id === articleSubmissionId)) throw Object.assign(new Error('Select one of your own article submissions.'), { status: 403, code: 'article_forbidden' });
  if (!(file instanceof File) || !allowedPhotoTypes.has(file.type) || file.size > 15 * 1024 * 1024) throw Object.assign(new Error('Upload a JPEG, PNG, or WebP file no larger than 15 MB.'), { status: 400, code: 'invalid_photo' });
}
const scopes = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/drive.file'
];

function cors() { return {}; }
function response(data, status, env, headers = {}) { return new Response(data == null ? null : JSON.stringify(data), { status, headers: { ...cors(env), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } }); }
const ok = (data, env, status = 200, headers) => response(data, status, env, headers);
const fail = (error, env) => response({ error: { code: error.code || 'internal_error', message: error.status ? error.message : 'Unexpected server error.' } }, error.status || 500, env);

function requireConfig(env) {
  for (const name of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','SESSION_SECRET','EDITORIAL_ORIGIN','OAUTH_REDIRECT_URI','NEWSPAPER_CLASSROOM_ID']) {
    if (!env[name]) throw Object.assign(new Error(`${name} is not configured.`), { status: 503, code: 'configuration_error' });
  }
}

async function session(request, env, verifyMembership = true) {
  const sealed = cookie(request, SESSION_COOKIE);
  const value = sealed && await unseal(sealed, env.SESSION_SECRET);
  if (!value || value.exp <= Date.now() || value.courseId !== env.NEWSPAPER_CLASSROOM_ID) throw Object.assign(new Error('Authentication required.'), { status: 401, code: 'authentication_required' });
  if (verifyMembership) {
    const key=`${value.courseId}:${value.sub}`,cached=membershipCache.get(key);
    const membership=cached?.expiresAt>Date.now()?cached.value:await resolveMembership(env.NEWSPAPER_CLASSROOM_ID,value.accessToken);
    if(!cached||cached.expiresAt<=Date.now())membershipCache.set(key,{value:membership,expiresAt:Date.now()+MEMBERSHIP_CACHE_MS});
    value.role = membership.role; value.studentId = membership.studentId; value.classroomUserId = membership.classroomUserId;
  }
  return value;
}

const requireAdmin = value => { if (value.role !== 'admin') throw Object.assign(new Error('Teacher access required.'), { status: 403, code: 'admin_required' }); };
const requireStudent = value => { if (value.role !== 'student') throw Object.assign(new Error('Student access required.'), { status: 403, code: 'student_required' }); };
const nativeStatuses = new Set(['draft','submitted','reviewing','revision_requested','hold','approved','scheduled']);
const editableByStudent = article => article.status === 'draft' || article.status === 'revision_requested';
const cleanTitle = value => String(value || '').trim().slice(0, 300);
export function validateNativeDraft(input) {
  const articleType=String(input.articleType||'').trim().slice(0,80),titleKo=cleanTitle(input.titleKo),titleEn=cleanTitle(input.titleEn),contentHtml=sanitizeHtml(input.contentHtml||'').slice(0,300000);
  if(!articleType||(!titleKo&&!titleEn))throw Object.assign(new Error('Article type and at least one title are required.'),{status:400,code:'invalid_article'});
  return {articleType,titleKo,titleEn,contentHtml,issueId:String(input.issueId||'').slice(0,100)||null};
}
export function canViewNativeArticle(article,viewer){return viewer.role==='admin'||(viewer.role==='student'&&article.studentId===viewer.studentId);}
const isoOrNull=value=>{if(!value)return null;const date=new Date(value);if(Number.isNaN(date.valueOf()))throw Object.assign(new Error('Invalid assignment date.'),{status:400,code:'invalid_assignment'});return date.toISOString();};
export function validateCampaign(input){
  const name=cleanTitle(input.name),slots=Array.isArray(input.slots)?input.slots:[];
  if(!name||!slots.length)throw Object.assign(new Error('Assignment name and at least one slot are required.'),{status:400,code:'invalid_assignment'});
  const cleanSlots=slots.map((slot,index)=>{const articleType=String(slot.articleType||'').trim().slice(0,80),displayName=cleanTitle(slot.displayName),quantity=Math.max(1,Math.min(10,Number(slot.quantity)||1));if(!articleType||!displayName)throw Object.assign(new Error(`Slot ${index+1} is incomplete.`),{status:400,code:'invalid_assignment'});return {articleType,displayName,quantity,required:slot.required!==false,dueAt:isoOrNull(slot.dueAt),instructions:String(slot.instructions||'').trim().slice(0,5000)};});
  return {name,year:input.year?Number(input.year):null,issueLabel:String(input.issueLabel||'').trim().slice(0,100),issueId:String(input.issueId||'').trim().slice(0,100)||null,instructions:String(input.instructions||'').trim().slice(0,10000),startsAt:isoOrNull(input.startsAt),dueAt:isoOrNull(input.dueAt),audienceMode:input.audienceMode==='selected'?'selected':'all',recipientStudentIds:[...new Set((input.recipientStudentIds||[]).map(String))].slice(0,500),slots:cleanSlots};
}
function ensureAssignmentWritable(instance){if(instance&&instance.campaign_status==='closed')throw Object.assign(new Error('This assignment is closed.'),{status:409,code:'assignment_closed'});}
function nativeForViewer(article,viewer){if(viewer.role==='admin')return article;const {internalNote:_internal,...visible}=article;return visible;}
const escapeText = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const ROSTER_CACHE_MS = 5 * 60 * 1000;
const rosterCache = new Map();

export function classroomAttachments(submission) {
  return (submission.assignmentSubmission?.attachments || []).map(attachment => {
    if (attachment.driveFile) return { ...attachment.driveFile, kind:'driveFile' };
    if (attachment.link) return { ...attachment.link, kind:'link' };
    if (attachment.youTubeVideo) return { ...attachment.youTubeVideo, kind:'youTubeVideo' };
    if (attachment.form) return { ...attachment.form, kind:'form' };
    return { kind:'unsupported' };
  });
}

export async function selectGoogleDocAttachment(attachments, token, metadata=driveFileMetadata) {
  for (const attachment of attachments) {
    if (attachment.kind!=='driveFile' || !attachment.id) continue;
    if (attachment.mimeType===GOOGLE_DOC_MIME) return attachment;
    if (attachment.mimeType && attachment.mimeType!==GOOGLE_DOC_MIME) continue;
    try { const file=await metadata(attachment.id,token); Object.assign(attachment,{mimeType:file.mimeType,name:file.name,webViewLink:file.webViewLink}); if(file.mimeType===GOOGLE_DOC_MIME)return attachment; }
    catch (error) { attachment.metadataError=error.message; }
  }
  return null;
}

function isDocx(attachment) {
  return attachment.mimeType === DOCX_MIME || /\.docx$/i.test(attachment.name || attachment.title || '');
}

function docxScore(attachment) {
  const name = String(attachment.name || attachment.title || '');
  return (attachment.mimeType === DOCX_MIME ? 20 : 0) + (/\.docx$/i.test(name) ? 10 : 0) + (/(article|기사|feature|form|template)/i.test(name) ? 5 : 0);
}

export async function selectArticleAttachment(attachments, token, metadata=driveFileMetadata) {
  const driveFiles = attachments.filter(attachment => attachment.kind === 'driveFile' && attachment.id);
  await Promise.all(driveFiles.map(async attachment => {
    if (attachment.mimeType) return;
    try { Object.assign(attachment, await metadata(attachment.id, token)); }
    catch (error) { attachment.metadataError = error.message; }
  }));
  const docx = driveFiles.filter(isDocx).sort((left, right) => docxScore(right) - docxScore(left) || String(left.name || '').localeCompare(String(right.name || '')))[0];
  if (docx) return { type:'docx', attachment:docx };
  const googleDoc = driveFiles.find(attachment => attachment.mimeType === GOOGLE_DOC_MIME);
  return googleDoc ? { type:'google_doc', attachment:googleDoc } : null;
}

function textToParagraphs(value) {
  return String(value).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(paragraph => `<p>${escapeText(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
}

export function classroomResponseText(submission) {
  const answer = submission?.shortAnswerSubmission?.answer;
  return typeof answer === 'string' && answer.trim() ? answer : '';
}

function unsupportedAttachmentSummary(attachments) {
  return attachments.map(attachment => ({ kind:attachment.kind, name:attachment.name || attachment.title || '', mimeType:attachment.mimeType || '', url:attachment.webViewLink || attachment.url || attachment.alternateLink || '' }));
}

export async function loadArticleOriginal(submission, token, dependencies={}) {
  const responseText = classroomResponseText(submission);
  if (responseText) return {selectedAttachment:null,originalContent:textToParagraphs(responseText),originalContentSource:'classroom_response',originalContentState:{status:'available',source:'classroom_response'}};
  const attachments = classroomAttachments(submission);
  const selection=await selectArticleAttachment(attachments,token,dependencies.metadata||driveFileMetadata);
  if(!selection)return {selectedAttachment:null,originalContent:'',originalContentSource:'unsupported_attachment',unsupportedAttachments:unsupportedAttachmentSummary(attachments),originalContentState:{status:'unsupported',source:'unsupported_attachment',message:attachments.length?'첨부된 파일 형식은 원문 미리보기를 지원하지 않습니다. DOCX, Google Docs 또는 Classroom 짧은 답변을 사용해 주세요.':'제출된 텍스트 답변이나 첨부 원문이 없습니다.'}};
  const selectedAttachment=selection.attachment;
  if(selection.type==='docx') {
    const sourceUrl=selectedAttachment.webViewLink||`https://drive.google.com/open?id=${encodeURIComponent(selectedAttachment.id)}`;
    try {
      if(Number(selectedAttachment.size||0)>MAX_DOCX_BYTES)throw Object.assign(new Error('DOCX file exceeds the supported size limit.'),{status:413,code:'docx_oversize'});
      const data=await (dependencies.download||downloadDriveFile)(selectedAttachment.id,token,MAX_DOCX_BYTES);
      const parsed=(dependencies.parseDocx||parseDocx)(data);
      return {selectedAttachment,sourceUrl,originalContent:textToParagraphs(parsed.text),originalContentText:parsed.text,originalContentSource:'docx',...parsed.fields,originalContentState:{status:'available',source:'docx'}};
    } catch(error) {
      return {selectedAttachment,sourceUrl,originalContent:'',originalContentSource:'docx',originalContentState:{status:'error',source:'docx',code:error.code||'docx_parse_error',message:error.code==='docx_oversize'?'DOCX 파일이 8 MB 제한을 초과했습니다. Drive에서 원본을 확인해 주세요.':'DOCX 원문을 읽지 못했습니다. Drive에서 원본을 확인해 주세요.'}};
    }
  }
  try { const doc=await (dependencies.read||readDoc)(selectedAttachment.id,token); return {selectedAttachment,sourceUrl:selectedAttachment.webViewLink||'',originalContent:textToParagraphs(doc.text),originalContentSource:'google_doc',originalContentState:{status:'available',source:'google_doc'}}; }
  catch(error){return {selectedAttachment,sourceUrl:selectedAttachment.webViewLink||'',originalContent:'',originalContentSource:'google_doc',originalContentState:{status:'error',source:'google_doc',code:error.code||'google_docs_error',message:`Google Docs 원문을 불러오지 못했습니다 (${error.status||'unknown'}).`}};}
}

export function publicRoster(students) {
  return (students || []).map(student => ({id:String(student.userId || ''),name:String(student.profile?.name?.fullName || '').trim() || '이름 확인 불가'})).filter(student => student.id);
}

async function configuredRoster(courseId, token) {
  const now=Date.now(),cached=rosterCache.get(courseId);
  if(cached&&cached.expiresAt>now)return cached.students;
  const students=publicRoster(await classroom.students(courseId,token));
  rosterCache.set(courseId,{students,expiresAt:now+ROSTER_CACHE_MS});
  return students;
}

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
  if (new URL(request.url).origin !== env.EDITORIAL_ORIGIN) throw Object.assign(new Error('Editorial origin is misconfigured.'), { status: 503, code: 'configuration_error' });
  const state = randomToken(), verifier = randomToken(48);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const stateValue = await seal({ state, verifier }, env.SESSION_SECRET);
  const query = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.OAUTH_REDIRECT_URI, response_type: 'code', scope: scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'online', include_granted_scopes: 'true' });
  return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${query}`, 'Set-Cookie': setCookie(STATE_COOKIE, stateValue, 600), 'Cache-Control': 'no-store' } });
}

async function callback(request, env) {
  requireConfig(env);
  const url = new URL(request.url), saved = await unseal(cookie(request, STATE_COOKIE) || '', env.SESSION_SECRET);
  if (url.origin !== env.EDITORIAL_ORIGIN) throw Object.assign(new Error('Editorial origin is misconfigured.'), { status: 503, code: 'configuration_error' });
  if (!saved || !url.searchParams.get('state') || saved.state !== url.searchParams.get('state')) throw Object.assign(new Error('OAuth state validation failed.'), { status: 400, code: 'oauth_state_invalid' });
  if (url.searchParams.get('error')) throw Object.assign(new Error('Google sign-in was cancelled or denied.'), { status: 401, code: 'oauth_denied' });
  const code = url.searchParams.get('code'); if (!code) throw Object.assign(new Error('OAuth authorization code is missing.'), { status: 400, code: 'oauth_code_missing' });
  const tokens = await exchangeCode(code, env, saved.verifier);
  const [identity, membership] = await Promise.all([userInfo(tokens.access_token), resolveMembership(env.NEWSPAPER_CLASSROOM_ID, tokens.access_token)]);
  membershipCache.set(`${env.NEWSPAPER_CLASSROOM_ID}:${identity.sub}`,{value:membership,expiresAt:Date.now()+MEMBERSHIP_CACHE_MS});
  const expires = Math.min(Date.now() + SESSION_SECONDS * 1000, Date.now() + Number(tokens.expires_in || SESSION_SECONDS) * 1000);
  const value = await seal({ sub: identity.sub, name: identity.name, email: identity.email, role: membership.role, studentId: membership.studentId, classroomUserId: membership.classroomUserId, courseId: env.NEWSPAPER_CLASSROOM_ID, accessToken: tokens.access_token, exp: expires }, env.SESSION_SECRET);
  return new Response(null, { status: 302, headers: [['Location', callbackRedirect(url, membership.role)], ['Set-Cookie', setCookie(SESSION_COOKIE, value, SESSION_SECONDS)], ['Set-Cookie', clearCookie(STATE_COOKIE)], ['Cache-Control','no-store']] });
}

export function callbackRedirect(url, role) {
  return `${url.origin}${role === 'admin' ? '/editorial/admin/' : '/editorial/student/'}`;
}

async function routeEditorial(request, env, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) return response({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405, env, { Allow: 'GET, HEAD' });
  if (pathname === '/editorial' || pathname === '/editorial/') return new Response(null, { status: 302, headers: { Location: '/editorial/login/', 'Cache-Control': 'no-store' } });
  return env.ASSETS.fetch(request);
}

async function collectArticles(issue, token, viewer, includeSubmission = false) {
  const rows = [];
  for (const type of issue.articleTypes) {
    const data = await classroom.submissions(issue.classroomCourseId, type.courseWorkId, token);
    for (const submission of data.studentSubmissions || []) {
      if (viewer.role === 'student' && submission.userId !== viewer.studentId) continue;
      const attachments = classroomAttachments(submission);
      rows.push({ id: submission.id, issueId: issue.id, courseId: issue.classroomCourseId, courseWorkId: type.courseWorkId, articleTypeId: type.id, studentId: submission.userId, state: submission.state, submittedAt: submission.updateTime || submission.creationTime, attachments, ...(includeSubmission?{submission}:{}) });
    }
  }
  return rows;
}

export async function createPhotoAfterDrive(repo, photo, token, remove = deleteDriveFile) {
  try { return await repo.createPhoto(photo); }
  catch (error) {
    try { await remove(photo.driveFileId, token); }
    catch (cleanupError) { console.error(JSON.stringify({ code: 'drive_orphan_cleanup_failed', status: cleanupError.status || 502 })); }
    throw Object.assign(new Error('Photo metadata could not be saved. Please try again.'), { status: 503, code: 'photo_metadata_save_failed' });
  }
}

export function photoForClient(row) {
  if (!row) return row;
  const id = encodeURIComponent(row.id);
  return { ...row, rightsConfirmed: Boolean(row.rights_confirmed ?? row.rightsConfirmed ?? true), contentUrl: `/api/photos/${id}/content`, originalUrl: `/api/photos/${id}/original` };
}

export async function authorizePhotoViewer(repo, photoId, viewer, configuredCourseId, loadArticles = collectArticles) {
  const photo = await repo.getPhoto(photoId);
  if (!photo) throw Object.assign(new Error('Photo not found.'), { status: 404, code: 'photo_not_found' });
  if (viewer.role === 'admin') return photo;
  if (viewer.role !== 'student' || photo.student_google_id !== viewer.studentId) throw Object.assign(new Error('Photo not found.'), { status: 404, code: 'photo_not_found' });
  if(photo.article_id){const native=await repo.getNativeArticle(photo.article_id);if(native?.studentId===viewer.studentId)return photo;throw Object.assign(new Error('Photo not found.'),{status:404,code:'photo_not_found'});}
  const issue = await repo.getIssue(photo.issue_id);
  if (!issue || issue.classroomCourseId !== configuredCourseId) throw Object.assign(new Error('Photo not found.'), { status: 404, code:'photo_not_found' });
  const owned = await loadArticles(issue, viewer.accessToken, viewer);
  if (!owned.some(article => article.id === photo.article_submission_id && article.studentId === viewer.studentId)) throw Object.assign(new Error('Photo not found.'), { status: 404, code: 'photo_not_found' });
  return photo;
}

function safeInlineFilename(value) {
  const ascii = String(value || 'photo').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'photo';
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(String(value || 'photo'))}`;
}

export async function photoContentResponse(photo, token, stream = streamDriveImage) {
  const media = await stream(photo.drive_file_id, token);
  const headers = { 'Content-Type': media.contentType, 'Content-Disposition': safeInlineFilename(photo.filename), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (media.contentLength) headers['Content-Length'] = media.contentLength;
  return new Response(media.body, { status: 200, headers });
}

async function routeApi(request, env, pathname) {
  const viewer = await session(request, env);
  if (pathname === '/api/session' && request.method === 'GET') return ok({ authenticated: true, user: { id: viewer.sub, name: viewer.name, email: viewer.email, role: viewer.role, studentId: viewer.studentId } }, env);
  if (pathname === '/api/classroom/students' && request.method === 'GET') { requireAdmin(viewer); return ok({students:await configuredRoster(env.NEWSPAPER_CLASSROOM_ID,viewer.accessToken)},env); }
  const repo = repository(env);
  if(pathname==='/api/assignments'&&request.method==='GET')return ok({campaigns:await repo.listCampaigns(viewer.role==='student'?viewer.studentId:null),assignments:await repo.listAssignments(viewer.role==='student'?viewer.studentId:null)},env);
  if(pathname==='/api/assignments'&&request.method==='POST'){requireAdmin(viewer);return ok(await repo.createCampaign(validateCampaign(await request.json()),viewer.sub),env,201);}
  const assignmentUpdate=pathname.match(/^\/api\/assignments\/([^/]+)$/);
  if(assignmentUpdate&&request.method==='PATCH'){requireAdmin(viewer);const current=await repo.getCampaign(assignmentUpdate[1]);if(!current)throw Object.assign(new Error('Assignment not found.'),{status:404,code:'assignment_not_found'});const input=await request.json(),validated=validateCampaign({...current,...input,slots:current.slots});if(!['draft','active','closed'].includes(input.status||current.status))throw Object.assign(new Error('Invalid assignment status.'),{status:400,code:'invalid_assignment'});return ok(await repo.updateCampaign(current.id,{...validated,status:input.status||current.status}),env);}
  const distribute=pathname.match(/^\/api\/assignments\/([^/]+)\/distribute$/);
  if(distribute&&request.method==='POST'){requireAdmin(viewer);const campaign=await repo.getCampaign(distribute[1]);if(!campaign)throw Object.assign(new Error('Assignment not found.'),{status:404,code:'assignment_not_found'});if(campaign.status==='closed')throw Object.assign(new Error('Closed assignments cannot be distributed.'),{status:409,code:'assignment_closed'});const input=await request.json(),roster=await configuredRoster(env.NEWSPAPER_CLASSROOM_ID,viewer.accessToken),selected=new Set((input.studentIds?.length?input.studentIds:campaign.recipientStudentIds||[]).map(String)),students=(input.audienceMode||campaign.audienceMode)==='all'?roster:roster.filter(student=>selected.has(student.id));if(!students.length)throw Object.assign(new Error('Select at least one student.'),{status:400,code:'assignment_recipients_required'});return ok(await repo.distributeCampaign(campaign,students),env);}
  const assignmentArticle=pathname.match(/^\/api\/assignment-instances\/([^/]+)\/article$/);
  if(assignmentArticle&&request.method==='POST'){requireStudent(viewer);const instance=await repo.getAssignmentInstance(assignmentArticle[1]);if(!instance||instance.student_id!==viewer.studentId)throw Object.assign(new Error('Assignment slot not found.'),{status:404,code:'assignment_not_found'});if(instance.article_id)return ok(await repo.getNativeArticle(instance.article_id),env);ensureAssignmentWritable(instance);return ok(await repo.createArticleForAssignment(instance,viewer.studentId),env,201);}
  if(pathname==='/api/native/articles'&&request.method==='GET')return ok((await repo.listNativeArticles(viewer.role==='student'?viewer.studentId:null)).map(x=>nativeForViewer(x,viewer)),env);
  if(pathname==='/api/native/articles'&&request.method==='POST'){requireStudent(viewer);const input=validateNativeDraft(await request.json());return ok(await repo.createNativeArticle(input,viewer.studentId),env,201);}
  const nativeArticle=pathname.match(/^\/api\/native\/articles\/([^/]+)$/);
  if(nativeArticle&&request.method==='GET'){const found=await repo.getNativeArticle(nativeArticle[1]);if(!found||!canViewNativeArticle(found,viewer))throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});return ok({...nativeForViewer(found,viewer),revisions:await repo.listRevisions(found.id)},env);}
  if(nativeArticle&&request.method==='PATCH'){requireStudent(viewer);const found=await repo.getNativeArticle(nativeArticle[1]);if(!found||found.studentId!==viewer.studentId)throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});ensureAssignmentWritable(found.assignmentInstanceId&&await repo.getAssignmentInstance(found.assignmentInstanceId));if(!editableByStudent(found))throw Object.assign(new Error('Submitted articles are locked until revision is requested.'),{status:409,code:'article_locked'});const draft=validateNativeDraft(await request.json());if(found.assignmentSlotId)draft.articleType=found.articleType;return ok(await repo.saveStudentDraft(found.id,draft),env);}
  const nativeSubmit=pathname.match(/^\/api\/native\/articles\/([^/]+)\/submit$/);
  if(nativeSubmit&&request.method==='POST'){requireStudent(viewer);const found=await repo.getNativeArticle(nativeSubmit[1]);if(!found||found.studentId!==viewer.studentId)throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});ensureAssignmentWritable(found.assignmentInstanceId&&await repo.getAssignmentInstance(found.assignmentInstanceId));if(!editableByStudent(found))throw Object.assign(new Error('Article is already submitted.'),{status:409,code:'article_locked'});if(!String(found.draftHtml).replace(/<[^>]*>/g,'').trim())throw Object.assign(new Error('Write the article before submitting.'),{status:400,code:'empty_article'});return ok(await repo.submitNativeArticle(found,viewer.sub),env);}
  const nativeImport=pathname.match(/^\/api\/native\/articles\/([^/]+)\/import$/);
  if(nativeImport&&request.method==='POST'){requireStudent(viewer);const found=await repo.getNativeArticle(nativeImport[1]);if(!found||found.studentId!==viewer.studentId)throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});ensureAssignmentWritable(found.assignmentInstanceId&&await repo.getAssignmentInstance(found.assignmentInstanceId));if(!editableByStudent(found))throw Object.assign(new Error('Article is locked.'),{status:409,code:'article_locked'});const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||file.size>MAX_DOCX_BYTES)throw Object.assign(new Error('Upload a DOCX or TXT file no larger than 8 MB.'),{status:400,code:'invalid_import'});let text='';if(file.type===DOCX_MIME||/\.docx$/i.test(file.name))text=parseDocx(await file.arrayBuffer()).text;else if(file.type==='text/plain'||/\.txt$/i.test(file.name))text=await file.text();else throw Object.assign(new Error('Only DOCX and TXT files are supported.'),{status:400,code:'invalid_import'});return ok(await repo.saveStudentDraft(found.id,{...found,contentHtml:textToParagraphs(text)}),env);}
  const nativeEditor=pathname.match(/^\/api\/native\/articles\/([^/]+)\/editor$/);
  if(nativeEditor&&request.method==='PATCH'){requireAdmin(viewer);const found=await repo.getNativeArticle(nativeEditor[1]);if(!found)throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});const input=await request.json();return ok(await repo.saveEditorDraft(found,{titleKo:cleanTitle(input.titleKo),titleEn:cleanTitle(input.titleEn),contentHtml:sanitizeHtml(input.contentHtml||'').slice(0,300000),studentFeedback:String(input.studentFeedback||'').slice(0,10000),internalNote:String(input.internalNote||'').slice(0,10000),checkpoint:Boolean(input.checkpoint)},viewer.sub),env);}
  const nativeStatus=pathname.match(/^\/api\/native\/articles\/([^/]+)\/status$/);
  if(nativeStatus&&request.method==='PATCH'){requireAdmin(viewer);const found=await repo.getNativeArticle(nativeStatus[1]),input=await request.json();if(!found)throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});if(!nativeStatuses.has(input.status)||input.status==='draft')throw Object.assign(new Error('Invalid article status.'),{status:400,code:'invalid_status'});return ok(await repo.setNativeStatus(found,input.status,viewer.sub),env);}
  if(pathname==='/api/photos'&&request.method==='GET')return ok((await repo.listPhotos(viewer.role==='student'?viewer.studentId:null)).map(photoForClient),env);
  if(pathname==='/api/photos/folder-status'&&request.method==='GET'){requireAdmin(viewer);const folder=await driveFolderPreflight(env.DRIVE_UPLOAD_FOLDER_ID,viewer.accessToken);return ok({accessible:true,canAddChildren:folder.canAddChildren,storage:folder.driveId?'shared_drive':'my_drive'},env);}
  const photoStatus=pathname.match(/^\/api\/photos\/([^/]+)\/status$/);
  if(photoStatus&&request.method==='PATCH'){requireAdmin(viewer);const input=await request.json();if(!['unreviewed','approved','hold','rejected'].includes(input.status))throw Object.assign(new Error('Invalid photo status.'),{status:400,code:'invalid_status'});return ok(await repo.updatePhotoStatus(photoStatus[1],input.status),env);}
  const photoContent=pathname.match(/^\/api\/photos\/([^/]+)\/content$/);
  if(photoContent&&request.method==='GET'){const photo=await authorizePhotoViewer(repo,photoContent[1],viewer,env.NEWSPAPER_CLASSROOM_ID);return photoContentResponse(photo,viewer.accessToken);}
  const photoOriginal=pathname.match(/^\/api\/photos\/([^/]+)\/original$/);
  if(photoOriginal&&request.method==='GET'){const photo=await authorizePhotoViewer(repo,photoOriginal[1],viewer,env.NEWSPAPER_CLASSROOM_ID);return new Response(null,{status:302,headers:{Location:`https://drive.google.com/open?id=${encodeURIComponent(photo.drive_file_id)}`,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});}
  if(pathname==='/api/photos/upload'&&request.method==='POST'){requireStudent(viewer);const form=await request.formData(),file=form.get('file'),articleSubmissionId=String(form.get('articleSubmissionId')||''),native=await repo.getNativeArticle(articleSubmissionId);if(form.get('copyright')!=='true')throw Object.assign(new Error('Rights confirmation is required.'),{status:400,code:'rights_confirmation_required'});validateStudentPhoto(file,articleSubmissionId,native?.studentId===viewer.studentId?[native]:[]);const drive=await uploadToDrive(file,env.DRIVE_UPLOAD_FOLDER_ID,viewer.accessToken);const photo={issueId:native.issueId||'native',articleSubmissionId,articleId:articleSubmissionId,studentGoogleId:viewer.studentId,driveFileId:drive.id,filename:drive.name,mimeType:drive.mimeType,byteSize:Number(drive.size||file.size),caption:String(form.get('caption')||'').slice(0,1000),photographer:String(form.get('photographer')||'').slice(0,200),sourceType:String(form.get('sourceType')||'').slice(0,100),rightsConfirmed:true};return ok(photoForClient(await createPhotoAfterDrive(repo,photo,viewer.accessToken)),env,201);}
  throw Object.assign(new Error('API route not found.'), { status: 404, code: 'not_found' });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
      if (url.pathname === '/auth/login' && request.method === 'GET') return login(request, env);
      if (url.pathname === '/auth/callback' && request.method === 'GET') return callback(request, env);
      if (url.pathname === '/auth/logout' && request.method === 'POST') { requireTrustedOrigin(request); return ok({ authenticated: false }, env, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE) }); }
      if (url.pathname === '/api/session' && request.method === 'GET' && !cookie(request, SESSION_COOKIE)) return ok({ authenticated: false, user: null }, env);
      if (url.pathname.startsWith('/api/')) { requireTrustedOrigin(request); return await routeApi(request, env, url.pathname); }
      if (url.pathname === '/editorial' || url.pathname.startsWith('/editorial/')) return routeEditorial(request, env, url.pathname);
      return ok({ service: 'The Lions Pride Editorial API', status: 'ok' }, env);
    } catch (error) { console.error(JSON.stringify({ code:error.code||'internal_error', status:error.status||500 })); return fail(error, env); }
  }
};
