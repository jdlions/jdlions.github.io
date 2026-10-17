/* Download-only service worker. No UI interception, cache storage or tokens. */
const chunkBytes=2*1024*1024;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
const transient=status=>[408,429,500,502,503,504].includes(status);
// Browser service worker (not the Cloudflare runtime): redirects are rejected.
async function request(url,init,consume,signal){
 for(let attempt=0;;attempt++){
  if(signal?.aborted)throw signal.reason;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('download_timeout')),90000);
  try{
   const r=await fetch(url,{...init,credentials:'include',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal});
   if(!r.ok){await r.body?.cancel();const error=new Error('download_http_'+r.status);error.status=r.status;throw error;}
   return await consume(r);
  }catch(error){if(signal?.aborted||attempt>=2||(error.status&&!transient(error.status)))throw error;await new Promise(resolve=>setTimeout(resolve,500*2**attempt));}
  finally{clearTimeout(timer);}
 }
}
async function download(project,version,requestRange){
 const api='/api/editorial-files/projects/'+project+'/versions/'+version;
 const info=await request(api+'/download-info',{},r=>r.json());
 if(!Number.isSafeInteger(info.size)||info.size<1||typeof info.filename!=='string')throw new Error('invalid_download_metadata');
 let offset=0,end=info.size-1;
 if(requestRange){const m=/^bytes=(\d+)-(\d*)$/.exec(requestRange);if(!m)return new Response(null,{status:416});offset=Number(m[1]);end=m[2]?Number(m[2]):end;if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(end)||offset<0||offset>end||end>=info.size)return new Response(null,{status:416});}
 const start=offset;const controller=new AbortController();let stopped=false;
 const stream=new ReadableStream({
  async pull(target){
   if(stopped)return;
   if(offset>end){target.close();return;}
   const last=Math.min(offset+chunkBytes-1,end),expected=last-offset+1;
   try{
    const bytes=await request(api+'/download',{headers:{Range:`bytes=${offset}-${last}`}},async r=>{
     if(r.status!==206||r.headers.get('Content-Range')!==`bytes ${offset}-${last}/${info.size}`){await r.body?.cancel();throw Object.assign(new Error('download_range_failed'),{status:409});}
     const reader=r.body.getReader(),bytes=new Uint8Array(expected);let length=0;
     for(;;){const part=await reader.read();if(part.done)break;if(length+part.value.byteLength>expected){await reader.cancel();throw Object.assign(new Error('download_size_mismatch'),{status:409});}bytes.set(part.value,length);length+=part.value.byteLength;}
     if(length!==expected)throw new Error('download_size_mismatch');return bytes;
    },controller.signal);
    if(!stopped){offset=last+1;target.enqueue(bytes);}
   }catch(error){if(!stopped){target.error(error);for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'editorial-download-error',message:'다운로드가 중단되었습니다. 로그인과 네트워크를 확인한 뒤 다시 시도해 주세요.'});}}
  },
  cancel(){stopped=true;controller.abort();}
 });
 const name=encodeURIComponent(info.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 const headers={'Content-Type':'application/octet-stream','Content-Length':String(end-start+1),'Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${name}`,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(requestRange)headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
 return new Response(stream,{status:requestRange?206:200,headers});
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),match=/^\/editorial-download\/([\w-]+)\/(\d+)$/.exec(url.pathname);
 if(url.origin!==self.location.origin||!match||event.request.method!=='GET')return;
 event.respondWith(download(match[1],match[2],event.request.headers.get('Range')).catch(()=>new Response('다운로드를 시작하지 못했습니다. PrideDesk에서 다시 시도해 주세요.',{status:502,headers:{'Cache-Control':'private, no-store'}})));
});
