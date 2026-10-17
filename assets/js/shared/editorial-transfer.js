import {api,ApiError} from '../services/api-client.js';
import {editorialConfig} from '../config.js';
import {fetchWithTimeout} from './request-timeout.js';
import {EDITORIAL_CHUNK_BYTES,MAX_EDITORIAL_BYTES,editorialFilename} from './editorial-file-policy.js';
const base='/api/editorial-files';
const check=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('전송이 중단되었습니다.','AbortError');};
// Existing SHA-256 tree identity is retained: every canonical chunk is hashed,
// but at most one 2 MiB chunk and a 320 KiB digest vector are held at a time.
export async function fileFingerprint(file,{signal,onProgress=()=>{}}={}){
 const hashes=new Uint8Array(Math.ceil(file.size/EDITORIAL_CHUNK_BYTES)*32);
 for(let i=0;i<file.size;i+=EDITORIAL_CHUNK_BYTES){check(signal);const bytes=await file.slice(i,i+EDITORIAL_CHUNK_BYTES).arrayBuffer();check(signal);hashes.set(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),i/EDITORIAL_CHUNK_BYTES*32);onProgress(Math.min(i+EDITORIAL_CHUNK_BYTES,file.size),file.size);}
 check(signal);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',hashes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const wait=(ms,signal)=>new Promise((resolve,reject)=>{check(signal);const stop=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);signal?.addEventListener('abort',stop,{once:true});});
export const transient=error=>error instanceof TypeError||error.status===0||[408,429,500,502,503,504].includes(error.status);
export async function retryTransfer(fn,{signal,onRetry=()=>{},delay=wait}={}){
 for(let attempt=0;;attempt++){check(signal);try{return await fn();}catch(error){check(signal);if(attempt>=2||!transient(error))throw error;onRetry(attempt+1);await delay(500*2**attempt,signal);}}
}
export async function uploadEditorialFile({project,lockId,file,changeNote,signal,onProgress=()=>{},onRetry=()=>{},request=api,send=fetchWithTimeout}){
 editorialFilename(file?.name);if(!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_EDITORIAL_BYTES)throw new Error('파일은 1 B 이상, 최대 20 GiB까지 선택할 수 있습니다.');
 const contentHash=await fileFingerprint(file,{signal,onProgress:(offset,total)=>onProgress({phase:'hash',offset,total})});
 const options={signal,onRetry};
 const start=await retryTransfer(()=>request(base+'/projects/'+project+'/upload',{method:'POST',signal,body:JSON.stringify({lockId,originalFilename:file.name,fileSize:file.size,contentHash,changeNote})}),options);
 if(start.done)return start.version;
 if(start.chunkBytes!==EDITORIAL_CHUNK_BYTES)throw new Error('지원하지 않는 업로드 조각 크기입니다. 페이지를 새로고침해 주세요.');
 let status=await retryTransfer(()=>request(base+'/uploads/'+start.id+'/status',{method:'POST',signal}),options);
 const valid=value=>{if(typeof value?.done!=='boolean'||!Number.isSafeInteger(value.offset)||value.offset<0||value.offset>file.size||value.done!==(value.offset===file.size))throw new Error('업로드 위치 응답이 올바르지 않습니다. 상태를 확인해 주세요.');return value;};
 status=valid(status);onProgress({phase:'upload',offset:status.offset,total:file.size});
 while(!status.done){
  check(signal);const offset=Math.floor(status.offset/start.chunkBytes)*start.chunkBytes,end=Math.min(offset+start.chunkBytes,file.size);
  const next=await retryTransfer(async()=>{
   const r=await send(editorialConfig.apiBaseUrl+base+'/uploads/'+start.id+'/chunk',{method:'PUT',credentials:'include',signal,headers:{'X-Editorial-CSRF':'1','Content-Type':'application/octet-stream','X-Upload-Offset':String(offset)},body:file.slice(offset,end)},90000,()=>new ApiError('전송 응답 시간이 초과되었습니다. 같은 파일로 재개할 수 있습니다.','request_timeout',504));
   let data;try{data=await r.json();}catch(error){if(signal?.aborted)throw error;throw new ApiError('전송 결과를 읽지 못했습니다.','invalid_response',502);}
   if(!r.ok)throw new ApiError(data.error?.message||'업로드에 실패했습니다. 같은 파일로 재개해 주세요.',data.error?.code,r.status);
   return valid(data);
  },options);
  if(next.offset<=status.offset&&!next.done)throw new Error('전송이 진행되지 않았습니다. 상태를 확인한 뒤 같은 파일로 재개해 주세요.');
  status=next;onProgress({phase:'upload',offset:status.offset,total:file.size});
 }
 onProgress({phase:'verify',offset:file.size,total:file.size});
 return retryTransfer(()=>request(base+'/uploads/'+start.id+'/finish',{method:'POST',signal}),options);
}
