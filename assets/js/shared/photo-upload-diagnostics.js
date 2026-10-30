import {api} from '../services/api-client.js';
// Temporary, explicit read-only diagnostics; never runs on page load or submit.
export function bindPhotoUploadDiagnostics(){
const diagnose=document.querySelector('[data-photo-diagnostics]');
if(diagnose)diagnose.onclick=async()=>{
 const result=document.querySelector('[data-photo-diagnostics-result]');diagnose.disabled=true;result.textContent='Google API 권한 확인 중…';
 try{const d=await api('/api/photos/upload-diagnostics',{method:'POST'}),state=v=>v===true?'허용':v===false?'미허용':'미확인';
 if(!d?.token||!d?.folder)throw Object.assign(new Error('Invalid diagnostic response'),{status:502,code:'diagnostic_invalid_response'});
 const detail=x=>`${x.stage||'완료'} / ${x.error||'없음'} / reason: ${x.reason||'미확인'}${x.exceptionType?' / '+x.exceptionType:''}`;
 result.textContent=`승인 scope: ${d.token.grantedScopes?.join(', ')||'미확인'} · 토큰 조회 HTTP: ${d.token.httpStatus??'미확인'} · 폴더 조회 HTTP: ${d.folder.httpStatus??'미확인'} · 토큰 진단: ${detail(d.token)} · 폴더 진단: ${detail(d.folder)} · 앱 파일 접근: ${state(d.folder.isAppAuthorized)} · 파일 추가: ${state(d.folder.canAddChildren)} · OAuth client 일치: ${state(d.token.audienceMatches)}`;
 }catch(e){const codes=new Set(['authentication_required','student_required','csrf_rejected','not_found','request_timeout','network_error','internal_error','diagnostic_invalid_response']);const hint=e.status===401?'로그인 세션을 확인해 주세요.':e.status===403?'사용자 권한 또는 Origin/CSRF 차단입니다.':e.status===404?'진단 API 경로를 찾지 못했습니다.':e.status>=500?'PrideDesk 진단 API 서버 또는 응답 오류입니다.':'진단 API 연결을 확인해 주세요.';result.textContent=`권한 진단을 완료하지 못했습니다. PrideDesk API HTTP: ${e.status||'미수신'} · ${codes.has(e.code)?e.code:'request_failed'} · ${hint}`;}finally{diagnose.disabled=false;}
};
}
