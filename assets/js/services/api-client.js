import { editorialConfig } from '../config.js';
import { fetchWithTimeout } from '../shared/request-timeout.js';
export class ApiError extends Error { constructor(message, code, status) { super(message); this.code=code; this.status=status; } }
export const apiTimeout = path => path==='/api/session'?30000:/\/upload$|\/import$/.test(path)?180000:60000;
export async function api(path, init = {}) {
  const headers=new Headers(init.headers),method=init.method||'GET';
  if(init.body&&!(init.body instanceof FormData))headers.set('Content-Type','application/json');
  if(!['GET','HEAD'].includes(method))headers.set('X-Editorial-CSRF','1');
  try {
    const response=await fetchWithTimeout(editorialConfig.apiBaseUrl+path,{...init,headers,credentials:'include'},apiTimeout(path),()=>new ApiError(['GET','HEAD'].includes(method)?'요청 시간이 초과되었습니다. 다시 시도해 주세요.':'응답 시간이 초과되었습니다. 저장 여부를 확인한 뒤 다시 시도해 주세요.','request_timeout',504));
    let data=null;try{if(response.status!==204)data=await response.json();}catch(error){if(error instanceof ApiError||init.signal?.aborted)throw error;}
    if(!response.ok)throw new ApiError(data?.error?.message||'Editorial request failed.',data?.error?.code||'request_failed',response.status);
    if(response.status!==204&&data===null)throw new ApiError('응답을 읽지 못했습니다. 다시 시도해 주세요.','invalid_response',502);
    return data;
  }catch(error){if(error instanceof ApiError)throw error;if(init.signal?.aborted)throw error;throw new ApiError('Editorial service is unavailable. Please try again.','network_error',0);}
}
