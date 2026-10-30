import {api} from '../services/api-client.js';
// Temporary, explicit read-only diagnostics; never runs on page load or submit.
export function bindPhotoUploadDiagnostics(){
const diagnose=document.querySelector('[data-photo-diagnostics]');
if(diagnose)diagnose.onclick=async()=>{
 const result=document.querySelector('[data-photo-diagnostics-result]');diagnose.disabled=true;result.textContent='Google API 권한 확인 중…';
 try{const d=await api('/api/photos/upload-diagnostics',{method:'POST'}),state=v=>v===true?'허용':v===false?'미허용':'미확인';
 result.textContent=`승인 scope: ${d.token.grantedScopes?.join(', ')||'미확인'} · 토큰 조회 HTTP: ${d.token.httpStatus??'미확인'} · 폴더 조회 HTTP: ${d.folder.httpStatus??'미확인'} · 오류: ${d.folder.reason||d.folder.error||d.token.error||'없음'} · 앱 파일 접근: ${state(d.folder.isAppAuthorized)} · 파일 추가: ${state(d.folder.canAddChildren)} · OAuth client 일치: ${state(d.token.audienceMatches)}`;
 }catch{result.textContent='권한 진단을 완료하지 못했습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요.';}finally{diagnose.disabled=false;}
};
}
