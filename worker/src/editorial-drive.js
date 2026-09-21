import {fetchWithTimeout} from '../../assets/js/shared/request-timeout.js';
const root='https://www.googleapis.com';
export const CHUNK_BYTES=2*1024*1024;
const error=()=>Object.assign(new Error('Drive 연결을 확인한 뒤 다시 시도해 주세요. 파일은 삭제되지 않습니다.'),{status:502,code:'editorial_drive_error'});
async function call(url,token,init={},timeout=120000){
  return fetchWithTimeout(url,{...init,redirect:'error',headers:{Authorization:`Bearer ${token}`,...init.headers}},timeout,error);
}
async function json(path,token,init={}){const r=await call(root+path,token,init);if(!r.ok){await r.body?.cancel();throw error();}return r.json();}
export const editorialDrive={
  async id(token){return (await json('/drive/v3/files/generateIds?count=1&space=drive&type=files',token)).ids[0];},
  async folder(name,token){return (await json('/drive/v3/files?fields=id',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'PrideDesk Editorial — '+name,mimeType:'application/vnd.google-apps.folder'})})).id;},
  async start(v,folder,token){
    const r=await call(root+'/upload/drive/v3/files?uploadType=resumable&fields=id',token,{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(v.file_size)},body:JSON.stringify({id:v.drive_file_id,name:v.normalized_filename,parents:[folder],mimeType:'application/octet-stream'})});
    const location=r.headers.get('Location');
    await r.body?.cancel();
    if(!r.ok||!location||new URL(location).origin!==root||!new URL(location).pathname.startsWith('/upload/drive/'))throw error();
    return location;
  },
  async send(v,token,body,offset){
    const range=body?`bytes ${offset}-${offset+body.byteLength-1}/${v.file_size}`:`bytes */${v.file_size}`;
    const r=await call(v.upload_url,token,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Range':range},body:body||new Uint8Array(0)});
    if(r.status===308){const range=r.headers.get('Range');await r.body?.cancel();const received=range?Number(range.match(/^bytes=0-(\d+)$/)?.[1])+1:0;if(!Number.isSafeInteger(received)||received<0||received>v.file_size)throw error();return {offset:received,done:received===v.file_size};}
    if(!r.ok){await r.body?.cancel();throw error();}await r.body?.cancel();return {offset:v.file_size,done:true};
  },
  metadata(id,token){return json(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,size,md5Checksum,parents,trashed`,token);},
  async download(id,token){const r=await call(root+`/drive/v3/files/${encodeURIComponent(id)}?alt=media`,token,{},30*60*1000);if(!r.ok){await r.body?.cancel();throw error();}return r;}
};
