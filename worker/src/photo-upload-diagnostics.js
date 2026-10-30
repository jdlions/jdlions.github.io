import {fetchWithTimeout} from '../../assets/js/shared/request-timeout.js';
const GOOGLE_API='https://www.googleapis.com';
const DRIVE_FOLDER_MIME_TYPE='application/vnd.google-apps.folder';
const fetchGoogle=(url,init)=>fetchWithTimeout(url,init,20000,()=>Object.assign(new Error('Google diagnostic timeout'),{code:'google_timeout'}));
const SAFE_DRIVE_REASONS = new Set([
  'invalid_token', 'invalid_request', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'SERVICE_DISABLED', 'PERMISSION_DENIED', 'UNAUTHENTICATED',
  'accessNotConfigured', 'appNotAuthorizedToFile', 'dailyLimitExceeded', 'domainPolicy',
  'fileNotFound', 'insufficientPermissions', 'insufficientFilePermissions', 'rateLimitExceeded', 'sharingRateLimitExceeded',
  'storageQuotaExceeded', 'teamDriveFileLimitExceeded', 'userRateLimitExceeded'
]);

const safeType=e=>['TypeError','SyntaxError','RangeError','Error'].includes(e?.name)?e.name:'UnknownError';
async function reasonFrom(response){
 try{const body=await response.json(),reason=body?.error?.errors?.[0]?.reason||body?.error?.details?.find(d=>SAFE_DRIVE_REASONS.has(d?.reason))?.reason||body?.error?.status||(typeof body?.error==='string'?body.error:'');return SAFE_DRIVE_REASONS.has(reason)?reason:null;}catch{return null;}
}
// Workerd supports only follow/manual. Never follow a redirect with the bearer token.
async function inspectGoogle(url,init,project){
 let r;
 try{r=await fetchGoogle(url,{...init,redirect:'manual'});}catch(e){return {httpStatus:null,stage:'request',error:e?.code==='google_timeout'?'google_timeout':'diagnostic_transport_error',exceptionType:safeType(e)};}
 if(!r.ok)return {httpStatus:r.status,stage:'google_http',error:r.status>=300&&r.status<400?'google_redirect_blocked':'google_http_error',reason:await reasonFrom(r)};
 let data;
 try{data=await r.json();}catch(e){return {httpStatus:r.status,stage:'response_body',error:e?.code==='google_timeout'?'google_timeout':e?.name==='SyntaxError'?'diagnostic_invalid_json':'diagnostic_body_error',exceptionType:safeType(e)};}
 if(!data||typeof data!=='object'||Array.isArray(data))return {httpStatus:r.status,stage:'response_body',error:'diagnostic_invalid_response'};
 return {httpStatus:r.status,...project(data)};
}
// Temporary read-only diagnostics. No raw token, URL credentials, identity or exception message.
export async function photoUploadDiagnostics(folderId,token,clientId){
 const tokenInfo=()=>inspectGoogle('https://oauth2.googleapis.com/tokeninfo',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}},data=>({grantedScopes:typeof data.scope==='string'?data.scope.split(/\s+/).filter(x=>/^(openid|email|profile|https:\/\/www\.googleapis\.com\/auth\/[a-zA-Z0-9._/-]+)$/.test(x)).slice(0,50):null,audienceMatches:typeof data.aud==='string'?data.aud===clientId:null}));
 const folderInfo=()=>{
  if(!folderId)return {httpStatus:null,stage:'configuration',reason:'folder_unconfigured',isAppAuthorized:null,canAddChildren:null};
  const q=new URLSearchParams({fields:'mimeType,isAppAuthorized,capabilities(canAddChildren)',supportsAllDrives:'true'});
  return inspectGoogle(`${GOOGLE_API}/drive/v3/files/${encodeURIComponent(folderId)}?${q}`,{headers:{Authorization:`Bearer ${token}`}},data=>({reason:null,isAppAuthorized:typeof data.isAppAuthorized==='boolean'?data.isAppAuthorized:null,canAddChildren:typeof data.capabilities?.canAddChildren==='boolean'?data.capabilities.canAddChildren:null,isFolder:data.mimeType===DRIVE_FOLDER_MIME_TYPE}));
 };
 const result=await Promise.allSettled([tokenInfo(),folderInfo()]);
 const safe=r=>r.status==='fulfilled'?r.value:{httpStatus:null,stage:'diagnostic_internal',error:'diagnostic_internal_error',exceptionType:safeType(r.reason)};
 return {token:{grantedScopes:null,audienceMatches:null,...safe(result[0])},folder:{reason:null,isAppAuthorized:null,canAddChildren:null,...safe(result[1])},includeGrantedScopesRequested:false};
}
