import { authService } from './auth-service.js';
const reason=new URLSearchParams(location.search).get('reason');
if(reason){const el=document.querySelector('#login-message');el.hidden=false;el.textContent=reason==='login'?'Please sign in to access the internal workspace.':'Internal access is unavailable for this account.';}
document.querySelectorAll('[data-role]').forEach(button=>button.addEventListener('click',async()=>{const role=button.dataset.role;const session=await authService.login(role);location.href=role==='public'?'../':session.role==='admin'?'../admin/':'../student/';}));
