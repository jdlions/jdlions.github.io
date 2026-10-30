import {memberHistory,deleteEmptyMember} from './member-history.js';
import {Signup,SIGNUP_COOKIE,profileSuggestion} from './signup.js';
import {memberRecipient} from './member-assignments.js';
import {Members} from './members.js';
import {verifyGoogleIdentity} from './google-identity.js';
import {normalizeLengthRules} from '../../assets/js/shared/length-rules.js';
import {validateSubmissionLength,reviewAssignmentLengths} from './assignment-lengths.js';
import {articleStudentOverview,dashboardSummary,photoStudentSummary,studentPhotos} from './admin-overview.js';
import {isNewAssignmentEligible} from '../../assets/js/shared/student-identity.js';
import { clearCookie, cookie, randomToken, requireTrustedOrigin, sanitizeHtml, seal, setCookie, STATE_COOKIE, SESSION_COOKIE, unseal } from './security.js';
import {articleListOptions,listArticlePage} from './article-list.js';
import {routeEditorialFiles} from './editorial-files.js';
import { photoDriveToken, driveThumbnail, driveFolderPreflight, exchangeCode, streamDriveImage, uploadToDrive } from './google.js';
import { repository } from './repository.js';
import { DOCX_MIME, MAX_DOCX_BYTES, parseDocx } from './docx.js';
import { pridedeskRequest } from './pridedesk-proxy.js';
import { IssuePublications, publicArchiveResponse } from './issue-publications.js';

const SESSION_SECONDS = 45 * 60;
const allowedPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
export function validateStudentPhoto(file, photoType) {
  if (!['school','feature'].includes(photoType)) throw Object.assign(new Error('피처 또는 학교 유형을 선택해 주세요.'), {status:400,code:'invalid_photo_type'});
  if (!(file instanceof File) || !allowedPhotoTypes.has(file.type) || !file.size || file.size > 15 * 1024 * 1024 || file.name.length>255 || /[\x00-\x1f\x7f\/\\]/.test(file.name)) throw Object.assign(new Error('Upload a JPEG, PNG, or WebP file no larger than 15 MB.'), { status: 400, code: 'invalid_photo' });
}
const standalonePhoto=photo=>!photo.article_id&&['student-photo:school','student-photo:feature'].includes(photo.issue_id);
const photoToken=(photo,viewer,env)=>standalonePhoto(photo)?photoDriveToken(env):viewer.accessToken;
const scopes = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/drive.file'
];

function cors() { return {}; }
function response(data, status, env, headers = {}) { return new Response(data == null ? null : JSON.stringify(data), { status, headers: { ...cors(env), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } }); }
const ok = (data, env, status = 200, headers) => response(data, status, env, headers);
const fail = (error, env) => response({ error: { code: error.code || 'internal_error', message: error.status ? error.message : 'Unexpected server error.' } }, error.status || 500, env);

function requireConfig(env) {
  for (const name of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','SESSION_SECRET','EDITORIAL_ORIGIN','OAUTH_REDIRECT_URI']) {
    if (!env[name]) throw Object.assign(new Error(`${name} is not configured.`), { status: 503, code: 'configuration_error' });
  }
}

async function session(request, env) {
  const sealed=cookie(request,SESSION_COOKIE),value=sealed&&await unseal(sealed,env.SESSION_SECRET);
  if(!value||!Number.isFinite(value.exp)||value.exp<=Date.now()||value.membershipVersion!==1)throw Object.assign(new Error('다시 로그인해 주세요.'),{status:401,code:'authentication_required'});
  return new Members(env.DB).authenticate(value);
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
  return {...normalizeLengthRules(input),name,year:input.year?Number(input.year):null,issueLabel:String(input.issueLabel||'').trim().slice(0,100),issueId:String(input.issueId||'').trim().slice(0,100)||null,instructions:String(input.instructions||'').trim().slice(0,10000),startsAt:isoOrNull(input.startsAt),dueAt:isoOrNull(input.dueAt),audienceMode:input.audienceMode==='selected'?'selected':'all',recipientStudentIds:[...new Set((input.recipientStudentIds||[]).map(String))].slice(0,500),slots:cleanSlots};
}
export function validateAssignmentDeletion(input){
  if(input?.confirmation!=='삭제'||input?.mode!=='preserve_articles')throw Object.assign(new Error('확인란에 정확히 삭제를 입력해 주세요.'),{status:400,code:'invalid_deletion_confirmation'});
}
function ensureAssignmentWritable(instance){if(instance&&instance.campaign_status==='closed')throw Object.assign(new Error('This assignment is closed.'),{status:409,code:'assignment_closed'});}
export function assignmentArticleInstanceId(pathname){
  const match=pathname.match(/^\/api\/assignments\/instances\/([^/]+)\/article$/)||pathname.match(/^\/api\/assignment-instances\/([^/]+)\/article$/);
  return match?decodeURIComponent(match[1]):null;
}
// Student responses use an explicit public field list so new staff-only fields fail closed.
function nativeForViewer(article,viewer){
  if(viewer.role==='admin'||!article)return article;
  const fields=['id','issueId','studentId','articleType','titleKo','titleEn','status','draftHtml','editorDraftHtml','currentStudentRevisionId','currentEditorRevisionId','createdAt','updatedAt','submittedAt','studentFeedback','assignmentInstanceId','assignmentSlotId','campaignId','assignmentName','slotName','assignmentDueAt','slotDueAt','minCharacters','maxCharacters','draftPreview','wordCount','authorName'];
  return Object.fromEntries(fields.filter(key=>Object.hasOwn(article,key)).map(key=>[key,article[key]]));
}
const escapeText = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function textToParagraphs(value) {
  return String(value).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(paragraph => `<p>${escapeText(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
}


async function login(request, env) {
  requireConfig(env);
  if (new URL(request.url).origin !== env.EDITORIAL_ORIGIN) throw Object.assign(new Error('Editorial origin is misconfigured.'), { status: 503, code: 'configuration_error' });
  const state = randomToken(), verifier = randomToken(48), nonce = randomToken();
  const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const stateValue = await seal({ state, verifier, nonce, exp:Date.now()+600000, origin: env.EDITORIAL_ORIGIN }, env.SESSION_SECRET);
  const query = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.OAUTH_REDIRECT_URI, response_type: 'code', scope: scopes.join(' '), state, nonce, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'online' });
  return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${query}`, 'Set-Cookie': setCookie(STATE_COOKIE, stateValue, 600), 'Cache-Control': 'no-store' } });
}

async function callback(request, env) {
  requireConfig(env);
  const url = new URL(request.url), saved = await unseal(cookie(request, STATE_COOKIE) || '', env.SESSION_SECRET);
  if (url.origin !== env.EDITORIAL_ORIGIN) throw Object.assign(new Error('Editorial origin is misconfigured.'), { status: 503, code: 'configuration_error' });
  if (saved && (saved.origin ? saved.origin !== url.origin : env.PRIDEDESK_REQUEST)) throw Object.assign(new Error('OAuth state origin validation failed.'), { status: 400, code: 'oauth_state_invalid' });
  if (!saved || !Number.isFinite(saved.exp) || saved.exp<=Date.now() || !url.searchParams.get('state') || saved.state !== url.searchParams.get('state')) throw Object.assign(new Error('OAuth state validation failed.'), { status: 400, code: 'oauth_state_invalid' });
  if (url.searchParams.get('error')) throw Object.assign(new Error('Google sign-in was cancelled or denied.'), { status: 401, code: 'oauth_denied' });
  const code = url.searchParams.get('code'); if (!code) throw Object.assign(new Error('OAuth authorization code is missing.'), { status: 400, code: 'oauth_code_missing' });
  const tokens = await exchangeCode(code, env, saved.verifier);
  const identity=await verifyGoogleIdentity(tokens,env.GOOGLE_CLIENT_ID,saved.nonce);
  if(env.PREVIEW_MODE&&![env.PREVIEW_ADMIN_EMAIL,env.PREVIEW_STUDENT_EMAIL].filter(Boolean).includes(identity.email))throw Object.assign(new Error('사전 지정한 테스트 계정만 접근할 수 있습니다.'),{status:403,code:'preview_admin_only'});
  const membership=await new Members(env.DB).login(identity,{allowUnknown:true});
  const expires = Math.min(Date.now() + SESSION_SECONDS * 1000, Date.now() + Number(tokens.expires_in || SESSION_SECONDS) * 1000);
  if(!membership){
    const pending=await seal({kind:'signup',identity,accessToken:tokens.access_token,tokenExpiresAt:expires,exp:Math.min(expires,Date.now()+600000)},env.SESSION_SECRET);
    return new Response(null,{status:302,headers:[['Location',`${url.origin}${env.PRIDEDESK_REQUEST?'':'/editorial'}/signup/`],['Set-Cookie',setCookie(SIGNUP_COOKIE,pending,600)],['Set-Cookie',clearCookie(SESSION_COOKIE)],['Set-Cookie',clearCookie(STATE_COOKIE)],['Cache-Control','private, no-store']]});
  }
  return memberSession(identity,membership,tokens.access_token,expires,callbackRedirect(url,membership.role,env.PRIDEDESK_REQUEST),env);
}

async function memberSession(identity,membership,token,expires,location,env){
  const value=await seal({sub:identity.sub,...membership,googleName:identity.name||'',accessToken:token,exp:expires},env.SESSION_SECRET);
  return new Response(null,{status:302,headers:[['Location',location],['Set-Cookie',setCookie(SESSION_COOKIE,value,Math.max(1,Math.floor((expires-Date.now())/1000)))],['Set-Cookie',clearCookie(SIGNUP_COOKIE)],['Set-Cookie',clearCookie(STATE_COOKIE)],['Cache-Control','private, no-store']]});
}
async function pendingSignup(request,env){
  const pending=await unseal(cookie(request,SIGNUP_COOKIE)||'',env.SESSION_SECRET);
  if(pending?.kind!=='signup'||!Number.isFinite(pending.exp)||pending.exp<=Date.now()||!pending.identity?.sub||!pending.identity.email?.endsWith('@joongdong.hs.kr')||!Number.isFinite(pending.tokenExpiresAt)||pending.tokenExpiresAt<=Date.now()||typeof pending.accessToken!=='string')throw Object.assign(new Error('가입 인증이 만료되었습니다. Google 로그인부터 다시 진행해 주세요.'),{status:401,code:'signup_auth_required'});
  return pending;
}
async function readSmallJson(request){
  const raw=await request.text();try{if(raw.length>4096)throw Error();const v=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}catch{throw Object.assign(new Error('요청 형식을 확인해 주세요.'),{status:400,code:'invalid_request'});}
}

export function callbackRedirect(url, role, pridedesk = false) {
  return `${url.origin}${pridedesk ? '' : '/editorial'}/${role === 'admin' ? 'admin' : 'student'}/`;
}

async function routeEditorial(request, env, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) return response({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405, env, { Allow: 'GET, HEAD' });
  if (pathname === '/editorial' || pathname === '/editorial/') return new Response(null, { status: 302, headers: { Location: '/editorial/login/', 'Cache-Control': 'no-store' } });
  return env.ASSETS.fetch(request);
}

export async function createPhotoAfterDrive(repo, photo) {
  try { return await repo.createPhoto(photo); }
  catch (error) {
    // INSERT may have committed before a read/network failure. Deleting the
    // original here could leave a durable photo record pointing at a lost file.
    throw Object.assign(new Error('사진 저장 결과를 확인할 수 없습니다. Drive 원본은 보존했습니다. 제출 목록을 새로고침해 확인한 뒤 다시 시도해 주세요.'), { status: 503, code: 'photo_metadata_save_failed' });
  }
}

export function photoForClient(row) {
  if (!row) return row;
  const id = encodeURIComponent(row.id);
  return { ...row, ...(standalonePhoto(row)?{articleType:row.issue_id.slice(14)}:{}), rightsConfirmed: Boolean(row.rights_confirmed ?? row.rightsConfirmed ?? true), thumbnailUrl: `/api/photos/${id}/thumbnail`, contentUrl: `/api/photos/${id}/content`, originalUrl: `/api/photos/${id}/original` };
}

export async function authorizePhotoViewer(repo, photoId, viewer) {
  const photo = await repo.getPhoto(photoId);
  if (!photo) throw Object.assign(new Error('Photo not found.'), { status: 404, code: 'photo_not_found' });
  if (viewer.role === 'admin') return photo;
  if (viewer.role !== 'student' || photo.student_google_id !== viewer.studentId) throw Object.assign(new Error('Photo not found.'), { status: 404, code: 'photo_not_found' });
  if(standalonePhoto(photo))return photo;
  if(!photo.article_id)throw Object.assign(new Error('Photo not found.'),{status:404,code:'photo_not_found'});
  const native=await repo.getNativeArticle(photo.article_id);
  if(native?.studentId===viewer.studentId)return photo;
  throw Object.assign(new Error('Photo not found.'),{status:404,code:'photo_not_found'});
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
  if(pathname.startsWith('/api/editorial-files/'))return routeEditorialFiles(request,env,viewer,pathname);
  if (pathname === '/api/session' && request.method === 'GET') return ok({ authenticated: true, user: { id: viewer.sub, name: viewer.name, email: viewer.email, role: viewer.role, studentId: viewer.studentId,profileUpdate:profileSuggestion(viewer) } }, env);
  if (['/api/members/roster','/api/classroom/students'].includes(pathname) && request.method === 'GET') { requireAdmin(viewer); return ok({students:await new Members(env.DB).roster({forAssignment:true})},env); }
  if(pathname==='/api/admin/signup-code'){
    requireAdmin(viewer);const signup=new Signup(env.DB,env.SESSION_SECRET);
    if(request.method==='GET')return ok(await signup.settings(),env);
    if(request.method==='PUT')return ok(await signup.configure(await readSmallJson(request),viewer),env);
  }
  if(pathname==='/api/member-profile/confirm'&&request.method==='POST'){
    requireStudent(viewer);const suggestion=profileSuggestion(viewer),input=await readSmallJson(request);
    if(!suggestion?.studentNumber||input.studentNumber!==suggestion.studentNumber||input.confirmed!==true)throw Object.assign(new Error('현재 Google 학번을 확인해 주세요.'),{status:400,code:'profile_conflict'});
    const now=new Date().toISOString();let result;
    try{result=await env.DB.prepare('UPDATE members SET student_number=?,auth_version=auth_version+1,updated_at=?,changed_by=? WHERE id=? AND auth_version=? AND active=1 AND google_sub=? AND student_number=? RETURNING id').bind(suggestion.studentNumber,now,'profile:'+viewer.sub,viewer.memberId,viewer.authVersion,viewer.sub,viewer.studentNumber).first();}catch{throw Object.assign(new Error('학번을 갱신할 수 없습니다. 관리자에게 문의해 주세요.'),{status:409,code:'profile_conflict'});}
    if(!result)throw Object.assign(new Error('회원 정보가 변경되었습니다. 다시 로그인해 주세요.'),{status:409,code:'profile_conflict'});
    const value=await seal({...viewer,studentNumber:suggestion.studentNumber,authVersion:viewer.authVersion+1},env.SESSION_SECRET);
    return ok({updated:true},env,200,{'Set-Cookie':setCookie(SESSION_COOKIE,value,Math.max(1,Math.floor((viewer.exp-Date.now())/1000)))});
  }
  const repo = repository(env);
  if(pathname==='/api/admin/members'||pathname.startsWith('/api/admin/members/')||pathname==='/api/admin/cohorts'){
    requireAdmin(viewer);const members=new Members(env.DB);
    if(pathname==='/api/admin/members'&&request.method==='GET')return ok(await members.list(new URL(request.url).searchParams),env);
    const target=pathname.match(/^\/api\/admin\/members\/([\w-]+)$/);
    if(target&&request.method==='GET')return ok(await memberHistory(env.DB,target[1],viewer,Number(new URL(request.url).searchParams.get('page')||0)),env);
    if(target&&request.method==='DELETE')return ok(await deleteEmptyMember(env.DB,target[1],await readSmallJson(request),viewer),env);
    if((pathname==='/api/admin/members'&&request.method==='POST')||(target&&request.method==='PATCH')||(pathname==='/api/admin/cohorts'&&request.method==='POST')){
      const raw=await request.text();let input;try{if(raw.length>4096)throw new Error();input=JSON.parse(raw);}catch{throw Object.assign(new Error('회원 요청 형식을 확인해 주세요.'),{status:400,code:'invalid_member'});}
      return ok(pathname==='/api/admin/cohorts'?await members.cohort(input):await members.save(target?.[1]||null,input,viewer),env,request.method==='POST'?201:200);
    }
    return response({error:{code:'method_not_allowed',message:'Method not allowed.'}},405,env);
  }
  if(pathname==='/api/admin/dashboard'&&request.method==='GET'){requireAdmin(viewer);return ok(await dashboardSummary(env.DB),env);}
  if(pathname==='/api/admin/article-overview'&&request.method==='GET'){requireAdmin(viewer);const roster=await new Members(env.DB).roster();return ok(await articleStudentOverview(env.DB,roster),env);}
  if(pathname==='/api/admin/photo-students'&&request.method==='GET'){requireAdmin(viewer);return ok(await photoStudentSummary(env.DB),env);}
  if(pathname==='/api/admin/student-photos'&&request.method==='GET'){requireAdmin(viewer);return ok((await studentPhotos(env.DB,new URL(request.url).searchParams.get('student'))).map(photoForClient),env);}
  if (pathname === '/api/publications') {
    requireAdmin(viewer);
    const publications = new IssuePublications(env.DB);
    if (request.method === 'GET') {
      const issues = await publications.list();
      return ok({ issues, nextNumber: Math.max(0, ...issues.map(x => x.number)) + 1 }, env);
    }
    if (request.method === 'POST') {
      let input;
      try { const body = await request.text(); if (body.length > 8192) throw new Error(); input = JSON.parse(body); }
      catch { throw Object.assign(new Error('발행 요청 형식이 올바르지 않습니다.'), { status: 400, code: 'invalid_publication' }); }
      const result = await publications.publish(input, request.headers.get('Idempotency-Key'), viewer.sub);
      return ok(result, env, result.replayed ? 200 : 201);
    }
  }
  if(pathname==='/api/assignments'&&request.method==='GET'){
    const studentId=viewer.role==='student'?viewer.studentId:null;
    const [campaigns,assignments]=await Promise.all([repo.listCampaigns(studentId),repo.listAssignments(studentId)]);
    return ok({campaigns,assignments},env);
  }
  if(pathname==='/api/assignments'&&request.method==='POST'){requireAdmin(viewer);const input=validateCampaign(await request.json());if(input.recipientStudentIds.length){const roster=await new Members(env.DB).roster(),allowed=new Set(roster.filter(isNewAssignmentEligible).flatMap(s=>[s.id,memberRecipient(s.memberId)]));if(input.recipientStudentIds.some(id=>!allowed.has(id)))throw Object.assign(new Error('신규 과제는 1·2학년 대상 학생만 선택해 주세요.'),{status:400,code:'invalid_assignment_recipients'});}return ok(await repo.createCampaign(input,viewer.sub),env,201);}
  const lengthReview=pathname.match(/^\/api\/assignments\/([^/]+)\/length-(preview|apply)$/);
  if(lengthReview&&request.method==='POST'){requireAdmin(viewer);return ok(await reviewAssignmentLengths(env.DB,repo,decodeURIComponent(lengthReview[1]),await request.json(),viewer,env.SESSION_SECRET,lengthReview[2]==='apply'),env);}
  const assignmentUpdate=pathname.match(/^\/api\/assignments\/([^/]+)$/);
  if(assignmentUpdate&&request.method==='PATCH'){requireAdmin(viewer);const current=await repo.getCampaign(assignmentUpdate[1]);if(!current)throw Object.assign(new Error('Assignment not found.'),{status:404,code:'assignment_not_found'});const input=await request.json(),validated=validateCampaign({...current,...input,slots:current.slots});if(!['draft','active','closed'].includes(input.status||current.status))throw Object.assign(new Error('Invalid assignment status.'),{status:400,code:'invalid_assignment'});return ok(await repo.updateCampaign(current.id,{...validated,status:input.status||current.status}),env);}
  const deletionSummary=pathname.match(/^\/api\/assignments\/([^/]+)\/deletion-summary$/);
  if(deletionSummary&&request.method==='GET'){requireAdmin(viewer);return ok(await repo.assignmentDeletionSummary(decodeURIComponent(deletionSummary[1])),env);}
  if(assignmentUpdate&&request.method==='DELETE'){requireAdmin(viewer);validateAssignmentDeletion(await request.json());return ok(await repo.deleteCampaign(decodeURIComponent(assignmentUpdate[1])),env);}
  const distribute=pathname.match(/^\/api\/assignments\/([^/]+)\/distribute$/);
  if(distribute&&request.method==='POST'){requireAdmin(viewer);const campaign=await repo.getCampaign(distribute[1]);if(!campaign)throw Object.assign(new Error('Assignment not found.'),{status:404,code:'assignment_not_found'});if(campaign.status==='closed')throw Object.assign(new Error('Closed assignments cannot be distributed.'),{status:409,code:'assignment_closed'});const input=await request.json(),roster=await new Members(env.DB).roster(),selected=new Set((input.studentIds?.length?input.studentIds:campaign.recipientStudentIds||[]).map(String)),students=roster.filter(isNewAssignmentEligible).filter(student=>(input.audienceMode||campaign.audienceMode)==='all'||(selected.has(student.id)||selected.has(memberRecipient(student.memberId))));if((input.audienceMode||campaign.audienceMode)!=='all'){const allowed=new Set(roster.filter(isNewAssignmentEligible).flatMap(s=>[s.id,memberRecipient(s.memberId)]));if([...selected].some(id=>!allowed.has(id)))throw Object.assign(new Error('활동 중인 학생만 신규 배부 대상으로 선택해 주세요.'),{status:400,code:'invalid_assignment_recipients'});}if(!students.length)throw Object.assign(new Error('Select at least one student.'),{status:400,code:'assignment_recipients_required'});return ok(await repo.distributeCampaign(campaign,students),env);}
  const assignmentInstanceId=assignmentArticleInstanceId(pathname);
  if(assignmentInstanceId&&request.method==='POST'){requireStudent(viewer);const instance=await repo.getAssignmentInstance(assignmentInstanceId);if(!instance||instance.student_id!==viewer.studentId)throw Object.assign(new Error('Assignment slot not found.'),{status:404,code:'assignment_not_found'});if(instance.article_id)return ok(nativeForViewer(await repo.getNativeArticle(instance.article_id),viewer),env);ensureAssignmentWritable(instance);return ok(nativeForViewer(await repo.createArticleForAssignment(instance,viewer.studentId),viewer),env,201);}
  if(pathname==='/api/native/articles'&&request.method==='GET'){
    const params=new URL(request.url).searchParams,studentId=viewer.role==='student'?viewer.studentId:null;
    if(['page','limit','cursor','q','author','status','type','campaign','date','picker','stats'].some(key=>params.has(key))){
      if(params.has('page')&&params.get('page')!=='1')throw Object.assign(new Error('Use the next cursor for pagination.'),{status:400,code:'invalid_article_query'});
      const result=await listArticlePage(repo.db,articleListOptions(params,studentId),studentId);
      return ok({...result,items:result.items.map(x=>nativeForViewer(x,viewer))},env);
    }
    return ok((await repo.listNativeArticles(studentId,params.get('summary')==='1')).map(x=>nativeForViewer(x,viewer)),env);
  }
  if(pathname==='/api/native/articles'&&request.method==='POST'){requireStudent(viewer);const input=validateNativeDraft(await request.json());return ok(nativeForViewer(await repo.createNativeArticle(input,viewer.studentId),viewer),env,201);}
  const nativeArticle=pathname.match(/^\/api\/native\/articles\/([^/]+)$/);
  if(nativeArticle&&request.method==='DELETE'){
    requireAdmin(viewer);
    const input=await request.json();
    if(input?.confirmation!=='삭제')throw Object.assign(new Error('Type 삭제 exactly to delete this article.'),{status:400,code:'invalid_confirmation'});
    return ok(await repo.deleteNativeArticle(nativeArticle[1]),env);
  }
  if(nativeArticle&&request.method==='GET'){const found=await repo.getNativeArticle(nativeArticle[1]);if(!found||!canViewNativeArticle(found,viewer))throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});return ok({...nativeForViewer(found,viewer),revisions:await repo.listRevisions(found.id)},env);}
  if(nativeArticle&&request.method==='PATCH'){requireStudent(viewer);const found=await repo.getNativeArticle(nativeArticle[1]);if(!found||found.studentId!==viewer.studentId)throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});ensureAssignmentWritable(found.assignmentInstanceId&&await repo.getAssignmentInstance(found.assignmentInstanceId));if(!editableByStudent(found))throw Object.assign(new Error('Submitted articles are locked until revision is requested.'),{status:409,code:'article_locked'});const draft=validateNativeDraft(await request.json());if(found.assignmentSlotId)draft.articleType=found.articleType;return ok(nativeForViewer(await repo.saveStudentDraft(found.id,draft),viewer),env);}
  const nativeSubmit=pathname.match(/^\/api\/native\/articles\/([^/]+)\/submit$/);
  if(nativeSubmit&&request.method==='POST'){requireStudent(viewer);const found=await repo.getNativeArticle(nativeSubmit[1]);if(!found||found.studentId!==viewer.studentId)throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});ensureAssignmentWritable(found.assignmentInstanceId&&await repo.getAssignmentInstance(found.assignmentInstanceId));if(!editableByStudent(found))throw Object.assign(new Error('Article is already submitted.'),{status:409,code:'article_locked'});if(!String(found.draftHtml).replace(/<[^>]*>/g,'').trim())throw Object.assign(new Error('Write the article before submitting.'),{status:400,code:'empty_article'});validateSubmissionLength(found);return ok(nativeForViewer(await repo.submitNativeArticle(found,viewer.sub),viewer),env);}
  const nativeImport=pathname.match(/^\/api\/native\/articles\/([^/]+)\/import$/);
  if(nativeImport&&request.method==='POST'){requireStudent(viewer);const found=await repo.getNativeArticle(nativeImport[1]);if(!found||found.studentId!==viewer.studentId)throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});ensureAssignmentWritable(found.assignmentInstanceId&&await repo.getAssignmentInstance(found.assignmentInstanceId));if(!editableByStudent(found))throw Object.assign(new Error('Article is locked.'),{status:409,code:'article_locked'});const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||file.size>MAX_DOCX_BYTES)throw Object.assign(new Error('Upload a DOCX or TXT file no larger than 8 MB.'),{status:400,code:'invalid_import'});let text='';if(file.type===DOCX_MIME||/\.docx$/i.test(file.name))text=parseDocx(await file.arrayBuffer()).text;else if(file.type==='text/plain'||/\.txt$/i.test(file.name))text=await file.text();else throw Object.assign(new Error('Only DOCX and TXT files are supported.'),{status:400,code:'invalid_import'});return ok(nativeForViewer(await repo.importStudentDraft(found,textToParagraphs(text),viewer.sub),viewer),env);}
  const nativeEditor=pathname.match(/^\/api\/native\/articles\/([^/]+)\/editor$/);
  if(nativeEditor&&request.method==='PATCH'){requireAdmin(viewer);const found=await repo.getNativeArticle(nativeEditor[1]);if(!found)throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});const input=await request.json();return ok(nativeForViewer(await repo.saveEditorDraft(found,{titleKo:cleanTitle(input.titleKo),titleEn:cleanTitle(input.titleEn),contentHtml:sanitizeHtml(input.contentHtml||'').slice(0,300000),studentFeedback:String(input.studentFeedback||'').slice(0,10000),internalNote:String(input.internalNote||'').slice(0,10000),checkpoint:Boolean(input.checkpoint)},viewer.sub),viewer),env);}
  const nativeStatus=pathname.match(/^\/api\/native\/articles\/([^/]+)\/status$/);
  if(nativeStatus&&request.method==='PATCH'){requireAdmin(viewer);const found=await repo.getNativeArticle(nativeStatus[1]),input=await request.json();if(!found)throw Object.assign(new Error('Article not found.'),{status:404,code:'article_not_found'});if(!nativeStatuses.has(input.status)||input.status==='draft')throw Object.assign(new Error('Invalid article status.'),{status:400,code:'invalid_status'});return ok(nativeForViewer(await repo.setNativeStatus(found,input.status,viewer.sub),viewer),env);}
  if(pathname==='/api/photos'&&request.method==='GET')return ok((await repo.listPhotos(viewer.role==='student'?viewer.studentId:null)).map(photoForClient),env);
  if(pathname==='/api/photos/folder-status'&&request.method==='GET'){requireAdmin(viewer);const folder=await driveFolderPreflight(env.DRIVE_UPLOAD_FOLDER_ID,await photoDriveToken(env));return ok({accessible:true,canAddChildren:folder.canAddChildren,storage:folder.driveId?'shared_drive':'my_drive'},env);}
  const photoStatus=pathname.match(/^\/api\/photos\/([^/]+)\/status$/);
  if(photoStatus&&request.method==='PATCH'){requireAdmin(viewer);const input=await request.json();if(!['unreviewed','approved','hold','rejected'].includes(input.status))throw Object.assign(new Error('Invalid photo status.'),{status:400,code:'invalid_status'});return ok(await repo.updatePhotoStatus(photoStatus[1],input.status),env);}
  const thumbnail=pathname.match(/^\/api\/photos\/([^/]+)\/thumbnail$/);
  if(thumbnail&&request.method==='GET'){const photo=await authorizePhotoViewer(repo,thumbnail[1],viewer);return photoContentResponse(photo,await photoToken(photo,viewer,env),driveThumbnail);}
  const photoContent=pathname.match(/^\/api\/photos\/([^/]+)\/content$/);
  if(photoContent&&request.method==='GET'){const photo=await authorizePhotoViewer(repo,photoContent[1],viewer);return photoContentResponse(photo,await photoToken(photo,viewer,env));}
  const photoOriginal=pathname.match(/^\/api\/photos\/([^/]+)\/original$/);
  if(photoOriginal&&request.method==='GET'){const photo=await authorizePhotoViewer(repo,photoOriginal[1],viewer);if(standalonePhoto(photo))return photoContentResponse(photo,await photoDriveToken(env));return new Response(null,{status:302,headers:{Location:`https://drive.google.com/open?id=${encodeURIComponent(photo.drive_file_id)}`,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});}
  if(pathname==='/api/photos/upload'&&request.method==='POST'){
    requireStudent(viewer);const form=await request.formData(),file=form.get('file'),photoType=String(form.get('photoType')||'');
    if(form.get('copyright')!=='true')throw Object.assign(new Error('Rights confirmation is required.'),{status:400,code:'rights_confirmation_required'});
    validateStudentPhoto(file,photoType);
    if(form.get('articleSubmissionId')||form.get('articleId'))throw Object.assign(new Error('사진 유형만 선택해 주세요.'),{status:400,code:'article_link_not_supported'});
    const drive=await uploadToDrive(file,env.DRIVE_UPLOAD_FOLDER_ID,await photoDriveToken(env));
    const photo={issueId:'student-photo:'+photoType,articleSubmissionId:'',articleId:null,studentGoogleId:viewer.studentId,driveFileId:drive.id,filename:drive.name,mimeType:drive.mimeType,byteSize:Number(drive.size||file.size),caption:String(form.get('caption')||'').slice(0,1000),photographer:String(form.get('photographer')||'').slice(0,200),sourceType:String(form.get('sourceType')||'').slice(0,100),rightsConfirmed:true};
    return ok(photoForClient(await createPhotoAfterDrive(repo,photo)),env,201);
  }
  throw Object.assign(new Error('API route not found.'), { status: 404, code: 'not_found' });
}

export default {
  async fetch(request, env) {
    try {
      ({ request, env } = pridedeskRequest(request, env));
      const url = new URL(request.url);
      if(env.PREVIEW_MODE){
        const readOnly=request.method==='GET'&&['/api/session','/api/admin/dashboard','/api/admin/members','/api/admin/signup-code','/api/signup','/auth/login','/auth/callback'].includes(url.pathname)||request.method==='GET'&&/^\/api\/admin\/members\/[\w-]+$/.test(url.pathname);
        const allowed=(request.method==='POST'&&['/api/signup','/auth/logout'].includes(url.pathname))||(request.method==='PUT'&&url.pathname==='/api/admin/signup-code');
        if(!readOnly&&!allowed)throw Object.assign(new Error('이 테스트 환경은 지정 계정의 가입 흐름과 가입 코드 설정만 허용합니다. 업무 데이터 쓰기는 차단됩니다.'),{status:403,code:'preview_read_only'});
      }
      if (url.pathname === '/api/public/issues') return await publicArchiveResponse(request, env);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
      if (url.pathname === '/auth/login' && request.method === 'GET') return await login(request, env);
      if (url.pathname === '/auth/callback' && request.method === 'GET') return await callback(request, env);
      if (url.pathname === '/auth/logout' && request.method === 'POST') { requireTrustedOrigin(request); return new Response(JSON.stringify({authenticated:false}),{headers:[['Content-Type','application/json'],['Cache-Control','private, no-store'],['Set-Cookie',clearCookie(SESSION_COOKIE)],['Set-Cookie',clearCookie(SIGNUP_COOKIE)]]}); }
      if(url.pathname==='/api/signup'){
        requireTrustedOrigin(request);const pending=await pendingSignup(request,env),signup=new Signup(env.DB,env.SESSION_SECRET);
        if(request.method==='GET')return ok({profile:await signup.available(pending.identity)},env,200,{'Cache-Control':'private, no-store'});
        if(request.method==='POST'){
          const membership=await signup.register(pending.identity,await readSmallJson(request));
          const issued=await memberSession(pending.identity,membership,pending.accessToken,pending.tokenExpiresAt,callbackRedirect(url,'student',env.PRIDEDESK_REQUEST),env);
          const headers=[...issued.headers].filter(([name])=>!['location','set-cookie'].includes(name));
          headers.push(['Content-Type','application/json; charset=utf-8']);
          for(const value of issued.headers.getSetCookie())headers.push(['Set-Cookie',value]);
          return new Response(JSON.stringify({redirect:callbackRedirect(url,'student',env.PRIDEDESK_REQUEST)}),{status:201,headers});
        }
        return response({error:{code:'method_not_allowed',message:'Method not allowed.'}},405,env);
      }
      if (url.pathname === '/api/session' && request.method === 'GET' && !cookie(request, SESSION_COOKIE)) return ok({ authenticated: false, user: null }, env);
      if (url.pathname.startsWith('/api/')) { requireTrustedOrigin(request); return await routeApi(request, env, url.pathname); }
      if (url.pathname === '/editorial' || url.pathname.startsWith('/editorial/')) return routeEditorial(request, env, url.pathname);
      return ok({ service: 'The Lions Pride Editorial API', status: 'ok' }, env);
    } catch (error) { console.error(JSON.stringify({ code:error.code||'internal_error', status:error.status||500,...(error.upstreamStatus?{upstreamStatus:error.upstreamStatus}:{}),...(error.reason?{reason:error.reason}:{}) })); return fail(error, env); }
  }
};
