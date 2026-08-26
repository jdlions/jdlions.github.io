import { authService } from './auth-service.js';
const params=new URLSearchParams(location.search),reason=params.get('reason');
if(reason){const el=document.querySelector('#login-message');el.hidden=false;el.textContent=reason==='login'?'내부 시스템을 이용하려면 로그인해 주세요.':'이 계정은 내부 시스템에 접근할 수 없습니다.';}
const session=authService.getSession();
if(session)location.replace(session.role==='admin'?'../admin/':'../student/');
document.querySelector('[data-google-login]').addEventListener('click',()=>authService.login(params.get('returnTo')));
