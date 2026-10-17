import {fetchWithTimeout} from '../../assets/js/shared/request-timeout.js';
const root='https://www.googleapis.com';
export {EDITORIAL_CHUNK_BYTES as CHUNK_BYTES} from '../../assets/js/shared/editorial-file-policy.js';
const error=()=>Object.assign(new Error('Drive 연결을 확인한 뒤 다시 시도해 주세요. 파일은 삭제되지 않습니다.'),{status:502,code:'editorial_drive_error'});
async function call(url,token,init={},timeout=80000){
  // Workers supports manual/follow only. Callers reject non-success responses;
  // manual also prevents forwarding the bearer token to a redirect target.
  return fetchWithTimeout(url,{...init,redirect:'manual',headers:{Authorization:`Bearer ${token}`,...init.headers}},timeout,error);
}
async function failure(r,upload=false){
 let reason='';try{reason=(await r.json()).error?.errors?.[0]?.reason||'';}catch{await r.body?.cancel().catch(()=>{});}
 if(upload&&[404,410].includes(r.status))return Object.assign(new Error('Drive 업로드 세션이 만료되었습니다. 편집 취소 후 최신본에서 다시 시작해 주세요. 기존 파일은 보존됩니다.'),{status:409,code:'editorial_upload_expired'});
 if(r.status===401)return Object.assign(new Error('Google 로그인이 만료되었습니다. 다시 로그인한 뒤 같은 파일로 재개해 주세요.'),{status:401,code:'drive_authentication_required'});
 if(r.status===429||['rateLimitExceeded','userRateLimitExceeded'].includes(reason))return Object.assign(new Error('Google Drive 요청이 많습니다. 잠시 후 전송을 재개해 주세요.'),{status:429,code:'editorial_drive_rate_limit'});
 if(r.status===403)return Object.assign(new Error(reason==='storageQuotaExceeded'?'Google Drive 저장 공간이 부족합니다. 공간을 확인해 주세요.':'Google Drive 권한 또는 업로드 할당량을 확인한 뒤 다시 시도해 주세요.'),{status:403,code:'editorial_drive_permission_or_quota'});
 return error();
}
async function json(path,token,init={}){const r=await call(root+path,token,init);if(!r.ok)throw await failure(r);return r.json();}
export const editorialDrive={
  async id(token){return (await json('/drive/v3/files/generateIds?count=1&space=drive&type=files',token)).ids[0];},
  async folder(name,token){return (await json('/drive/v3/files?fields=id',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'PrideDesk Editorial — '+name,mimeType:'application/vnd.google-apps.folder'})})).id;},
  async start(v,folder,token){
    const r=await call(root+'/upload/drive/v3/files?uploadType=resumable&fields=id',token,{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(v.file_size)},body:JSON.stringify({id:v.drive_file_id,name:v.normalized_filename,parents:[folder],mimeType:'application/octet-stream'})});
    const location=r.headers.get('Location');
    if(!r.ok)throw await failure(r);
    await r.body?.cancel();
    if(!location||new URL(location).origin!==root||!new URL(location).pathname.startsWith('/upload/drive/'))throw error();
    return location;
  },
  async send(v,token,body,offset){
    const range=body?`bytes ${offset}-${offset+body.byteLength-1}/${v.file_size}`:`bytes */${v.file_size}`;
    const r=await call(v.upload_url,token,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Range':range},body:body||new Uint8Array(0)});
    if(r.status===308){const range=r.headers.get('Range');await r.body?.cancel();const received=range?Number(range.match(/^bytes=0-(\d+)$/)?.[1])+1:0;if(!Number.isSafeInteger(received)||received<0||received>v.file_size)throw error();return {offset:received,done:received===v.file_size};}
    if(!r.ok)throw await failure(r,true);await r.body?.cancel();return {offset:v.file_size,done:true};
  },
  metadata(id,token){return json(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,size,md5Checksum,parents,trashed`,token);},
  async download(id,token,range=null){const r=await call(root+`/drive/v3/files/${encodeURIComponent(id)}?alt=media`,token,{headers:range?{Range:range}:{}},range?90000:30*60*1000);if(!r.ok)throw await failure(r);return r;}
};
