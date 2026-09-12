// Deadline includes response body consumption, not just receipt of headers.
export async function fetchWithTimeout(url, init={}, timeoutMs=45000, makeError=()=>Object.assign(new Error('Request timed out.'),{name:'TimeoutError'})) {
  const controller=new AbortController();
  const signal=init.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal;
  let rejectDeadline;
  const deadline=new Promise((_,reject)=>rejectDeadline=reject);
  const timer=setTimeout(()=>{const error=makeError();controller.abort(error);rejectDeadline(error);},timeoutMs);
  timer.unref?.();
  const clear=()=>clearTimeout(timer);
  try {
    const response=await Promise.race([fetch(url,{...init,signal}),deadline]);
    if(!response.body){clear();return response;}
    const reader=response.body.getReader();
    const body=new ReadableStream({
      async pull(target){try{const {done,value}=await Promise.race([reader.read(),deadline]);if(done){clear();target.close();}else target.enqueue(value);}catch(error){clear();target.error(signal.aborted?signal.reason:error);await reader.cancel().catch(()=>{});}},
      async cancel(reason){clear();controller.abort(reason);await reader.cancel(reason).catch(()=>{});}
    });
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){clear();throw signal.aborted?signal.reason:error;}
}
