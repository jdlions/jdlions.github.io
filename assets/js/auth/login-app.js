import { authService } from './auth-service.js';
import { editorialUrl } from '../config.js';
const params=new URLSearchParams(location.search),reason=params.get('reason');
if(reason){const el=document.querySelector('#login-message');el.hidden=false;el.classList.toggle('notice--error',reason!=='login');el.textContent=reason==='login'?'PrideDesk를 이용하려면 로그인해 주세요.':'이 계정에는 PrideDesk 접근 권한이 없습니다. 영자신문부 Classroom 등록 상태를 확인해 주세요.';}
const session=authService.getSession();
if(session)location.replace(editorialUrl(session.role==='admin'?'/editorial/admin/':'/editorial/student/'));
const loginButton=document.querySelector('[data-google-login]');
loginButton.addEventListener('click',()=>{loginButton.disabled=true;loginButton.setAttribute('aria-busy','true');loginButton.querySelector('b').textContent='Google 로그인으로 이동 중…';authService.login(params.get('returnTo'));});

window.addEventListener('pageshow',async event=>{if(!event.persisted)return;try{const user=await authService.validateSession();if(user)location.replace(editorialUrl(user.role==='admin'?'/editorial/admin/':'/editorial/student/'));}catch{}finally{loginButton.disabled=false;loginButton.removeAttribute('aria-busy');}});

if(authService.error||reason==='session_error'){
  const el=document.querySelector('#login-message');el.hidden=false;el.classList.add('notice--error');el.textContent='세션을 확인하지 못했습니다. 다시 확인하거나 Google 로그인으로 계속해 주세요. ';
  const retry=document.createElement('button');retry.type='button';retry.textContent='다시 확인';el.append(retry);
  retry.onclick=async()=>{retry.disabled=true;try{const user=await authService.validateSession();if(user)location.replace(editorialUrl(user.role==='admin'?'/editorial/admin/':'/editorial/student/'));else el.hidden=true;}catch{el.firstChild.textContent='세션 확인에 실패했습니다. 다시 시도해 주세요. ';}finally{retry.disabled=false;}};
}
