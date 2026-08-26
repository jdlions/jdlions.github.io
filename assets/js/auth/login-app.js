import { authService } from './auth-service.js';
const reason=new URLSearchParams(location.search).get('reason');
if(reason){const el=document.querySelector('#login-message');el.hidden=false;el.textContent=reason==='login'?'내부 시스템을 이용하려면 로그인해 주세요.':'이 계정은 내부 시스템에 접근할 수 없습니다.';}
document.querySelectorAll('[data-role]').forEach(button=>button.addEventListener('click',async()=>{const role=button.dataset.role;const session=await authService.login(role);location.href=role==='public'?'../':session.role==='admin'?'../admin/':'../student/';}));
