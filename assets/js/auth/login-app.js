import { authService } from './auth-service.js';
import { editorialUrl } from '../config.js';
const params=new URLSearchParams(location.search),reason=params.get('reason');
if(reason){const el=document.querySelector('#login-message');el.hidden=false;el.classList.toggle('notice--error',reason!=='login');el.textContent=reason==='login'?'PrideDesk를 이용하려면 로그인해 주세요.':'이 계정에는 PrideDesk 접근 권한이 없습니다. 영자신문부 Classroom 등록 상태를 확인해 주세요.';}
const session=authService.getSession();
if(session)location.replace(editorialUrl(session.role==='admin'?'/editorial/admin/':'/editorial/student/'));
const loginButton=document.querySelector('[data-google-login]');
loginButton.addEventListener('click',()=>{loginButton.disabled=true;loginButton.setAttribute('aria-busy','true');loginButton.querySelector('b').textContent='Google 로그인으로 이동 중…';authService.login(params.get('returnTo'));});
