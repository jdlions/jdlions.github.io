import { fetchWithTimeout } from '../../assets/js/shared/request-timeout.js';
const fetchGoogle=(url,init={})=>fetchWithTimeout(url,init,/\/upload\/|alt=media/.test(url)?120000:20000,()=>Object.assign(new Error('Google 응답 시간이 초과되었습니다. 결과를 확인한 뒤 다시 시도해 주세요.'),{status:504,code:'google_timeout'}));
const GOOGLE_API = 'https://www.googleapis.com';

function googleErrorStatus(status) {
  if ([400, 401, 403, 404, 429].includes(status)) return status;
  if (status >= 500) return 502;
  return 502;
}

async function googleFetch(path, accessToken, init = {}) {
  const response = await fetchGoogle(`${GOOGLE_API}${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...init.headers } });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(`Google API request failed (${response.status}).`), { status: googleErrorStatus(response.status), code: 'google_api_error' });
  }
  return response.status === 204 ? null : response.json();
}

export async function exchangeCode(code, env, verifier) {
  const body = new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.OAUTH_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: verifier });
  const response = await fetchGoogle('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw Object.assign(new Error('Google OAuth token exchange failed.'), { status: 401, code: 'oauth_exchange_failed' });
  return response.json();
}

export async function downloadDriveFile(fileId, token, maxBytes) {
  const response = await fetchGoogle(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Object.assign(new Error(`Google Drive download failed (${response.status}).`), { status: googleErrorStatus(response.status), code: 'drive_download_error' });
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > maxBytes) throw Object.assign(new Error('Drive file exceeds the supported size limit.'), { status: 413, code: 'docx_oversize' });
  const data = await response.arrayBuffer();
  if (data.byteLength > maxBytes) throw Object.assign(new Error('Drive file exceeds the supported size limit.'), { status: 413, code: 'docx_oversize' });
  return data;
}

const DRIVE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Drive owns thumbnail generation/lifetime. Never persist its credentialed URL.
export async function driveThumbnail(fileId, token) {
  const file=await googleFetch(`/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink,mimeType&supportsAllDrives=true`,token);
  const unavailable=()=>Object.assign(new Error('사진 미리보기를 준비하지 못했습니다. 원본 열기를 이용해 주세요.'),{status:404,code:'photo_thumbnail_unavailable'});
  if(!DRIVE_IMAGE_TYPES.has(file?.mimeType)||!file.thumbnailLink)throw unavailable();
  let url;try{url=new URL(file.thumbnailLink);}catch{throw unavailable();}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='googleusercontent.com'||url.hostname.endsWith('.googleusercontent.com')))throw unavailable();
  const response=await fetchWithTimeout(url.href,{headers:{Authorization:`Bearer ${token}`},redirect:'error'},120000,()=>Object.assign(new Error('사진 미리보기 시간이 초과되었습니다.'),{status:504,code:'google_timeout'}));
  const contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  const maximum=1024*1024;
  if(!response.ok||!DRIVE_IMAGE_TYPES.has(contentType)||Number(response.headers.get('content-length'))>maximum){await response.body?.cancel();throw unavailable();}
  const reader=response.body?.getReader();if(!reader)throw unavailable();
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw unavailable();}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return {body:bytes,contentType,contentLength:String(size)};
}

export async function streamDriveImage(fileId, token) {
  const query = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
  const response = await fetchGoogle(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(fileId)}?${query}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    await response.body?.cancel();
    const status = response.status === 404 ? 404 : response.status === 401 || response.status === 403 ? 403 : 502;
    throw Object.assign(new Error('Google Drive image could not be loaded.'), { status, code: status === 404 ? 'photo_content_not_found' : status === 403 ? 'photo_content_forbidden' : 'photo_content_unavailable' });
  }
  const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!DRIVE_IMAGE_TYPES.has(contentType)) {
    try { await response.body?.cancel(); } catch (error) { if(error.code==='google_timeout')throw error; }
    throw Object.assign(new Error('Drive returned an unsupported image type.'), { status: 415, code: 'photo_content_type_blocked' });
  }
  return { body: response.body, contentType, contentLength: response.headers.get('content-length') };
}

const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SAFE_DRIVE_REASONS = new Set([
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'SERVICE_DISABLED', 'PERMISSION_DENIED', 'UNAUTHENTICATED',
  'accessNotConfigured', 'appNotAuthorizedToFile', 'dailyLimitExceeded', 'domainPolicy',
  'fileNotFound', 'insufficientPermissions', 'insufficientFilePermissions', 'rateLimitExceeded', 'sharingRateLimitExceeded',
  'storageQuotaExceeded', 'teamDriveFileLimitExceeded', 'userRateLimitExceeded'
]);

async function safeDriveError(response) {
  let reason = '';
  try {
    const body = await response.json();
    const candidate = body?.error?.errors?.[0]?.reason || body?.error?.details?.find(d=>SAFE_DRIVE_REASONS.has(d?.reason))?.reason || body?.error?.status || '';
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
  const response = await fetchGoogle(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(folderId)}?${query}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) { const safe = await safeDriveError(response); throw driveAppError('folder', safe.upstreamStatus, safe.reason); }
  const folder = await response.json();
  if (folder.mimeType !== DRIVE_FOLDER_MIME_TYPE) throw Object.assign(new Error('Configured Drive target is not a folder.'), { status: 503, code: 'drive_folder_not_accessible' });
  if (folder.capabilities?.canAddChildren !== true) throw Object.assign(new Error('The current account cannot add files to the Drive upload folder.'), { status: 403, code: 'drive_permission_denied', upstreamStatus:200, reason:'cannotAddChildren' });
  return { id: folder.id, name: folder.name, mimeType: folder.mimeType, driveId: folder.driveId || null, canAddChildren: true };
}

export async function uploadToDrive(file, folderId, token) {
  await driveFolderPreflight(folderId, token);
  const boundary = `lp-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: file.name, parents: [folderId] });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`, file, `\r\n--${boundary}--`]);
  const query = new URLSearchParams({ uploadType: 'multipart', fields: 'id,name,mimeType,size', supportsAllDrives: 'true' });
  const response = await fetchGoogle(`${GOOGLE_API}/upload/drive/v3/files?${query}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  if (!response.ok) { const safe = await safeDriveError(response); throw driveAppError('upload', safe.upstreamStatus, safe.reason); }
  return response.json();
}

// Read-only, caller-session diagnostics. Follow Google's auth library: bearer
// header POST to tokeninfo; never place credentials in URLs or return raw data.
export async function photoUploadDiagnostics(folderId,token,clientId){
  const tokenInfo=async()=>{
    const r=await fetchGoogle('https://oauth2.googleapis.com/tokeninfo',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},redirect:'error'});
    if(!r.ok){await r.body?.cancel();return {httpStatus:r.status,grantedScopes:null,audienceMatches:null};}
    const data=await r.json(),scopes=typeof data.scope==='string'?data.scope.split(/\s+/).filter(x=>/^(openid|email|profile|https:\/\/www\.googleapis\.com\/auth\/[a-zA-Z0-9._/-]+)$/.test(x)).slice(0,50):null;
    return {httpStatus:r.status,grantedScopes:scopes,audienceMatches:typeof data.aud==='string'?data.aud===clientId:null};
  };
  const folderInfo=async()=>{
    if(!folderId)return {httpStatus:null,reason:'folder_unconfigured',isAppAuthorized:null,canAddChildren:null};
    const q=new URLSearchParams({fields:'mimeType,isAppAuthorized,capabilities(canAddChildren)',supportsAllDrives:'true'});
    const r=await fetchGoogle(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(folderId)}?${q}`,{headers:{Authorization:`Bearer ${token}`},redirect:'error'});
    if(!r.ok){const e=await safeDriveError(r);return {httpStatus:r.status,reason:e.reason||null,isAppAuthorized:null,canAddChildren:null};}
    const data=await r.json();return {httpStatus:r.status,reason:null,isAppAuthorized:typeof data.isAppAuthorized==='boolean'?data.isAppAuthorized:null,canAddChildren:typeof data.capabilities?.canAddChildren==='boolean'?data.capabilities.canAddChildren:null,isFolder:data.mimeType===DRIVE_FOLDER_MIME_TYPE};
  };
  const result=await Promise.allSettled([tokenInfo(),folderInfo()]);
  const safe=(r)=>r.status==='fulfilled'?r.value:{httpStatus:null,error:r.reason?.code==='google_timeout'?'google_timeout':'diagnostic_unavailable'};
  return {token:safe(result[0]),folder:safe(result[1]),includeGrantedScopesRequested:false};
}
