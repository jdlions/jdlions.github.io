import {fetchWithTimeout} from '../../assets/js/shared/request-timeout.js';
const GOOGLE_API='https://www.googleapis.com';
const DRIVE_FOLDER_MIME_TYPE='application/vnd.google-apps.folder';
const fetchGoogle=(url,init)=>fetchWithTimeout(url,init,20000,()=>Object.assign(new Error('Google diagnostic timeout'),{code:'google_timeout'}));
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
