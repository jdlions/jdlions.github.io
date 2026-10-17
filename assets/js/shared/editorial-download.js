import {api} from '../services/api-client.js';
const largeBytes=64*1024*1024;
export async function downloadEditorial(url,filename,size=0){
 if(size>=largeBytes){
  if(!('serviceWorker' in navigator))throw new Error('이 브라우저는 대용량 다운로드를 지원하지 않습니다. 최신 Chrome·Edge·Safari에서 다시 시도해 주세요.');
  const match=/^\/api\/editorial-files\/projects\/([\w-]+)\/versions\/(\d+)\/download$/.exec(url);if(!match)throw new Error('다운로드 주소가 올바르지 않습니다.');
  await api(url.replace(/\/download$/,'/download-info'));
  let timer;try{await Promise.race([(async()=>{
   const registration=await navigator.serviceWorker.register('/editorial-download-worker.js',{scope:'/editorial-download/',updateViaCache:'none'});
   if(!registration.active){const worker=registration.installing||registration.waiting;if(!worker)throw new Error('다운로드 준비를 다시 시도해 주세요.');await new Promise((resolve,reject)=>{worker.addEventListener('statechange',()=>{if(worker.state==='activated')resolve();if(worker.state==='redundant')reject(new Error('다운로드 준비에 실패했습니다.'));});if(worker.state==='activated')resolve();});}
  })(),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('다운로드 준비 시간이 초과되었습니다. 브라우저 설정을 확인한 뒤 다시 시도해 주세요.')),30000))]);}finally{clearTimeout(timer);}
  url='/editorial-download/'+match[1]+'/'+match[2];
 }
 // A download attribute bypasses service-worker navigation in Chromium.
 // The scoped worker supplies attachment headers for large-file navigation.
 const a=document.createElement('a');a.href=url;if(size<largeBytes)a.download=filename||'';document.body.append(a);a.click();a.remove();
}
