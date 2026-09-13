import { authService } from '../auth/auth-service.js';
function loadLiquidGlassTheme() {
  if (document.querySelector('link[data-liquid-glass-theme]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '../assets/css/editorial-liquid-glass.css';
  link.dataset.liquidGlassTheme = '';
  document.head.append(link);
}
export function initShell(session, area) {
  loadLiquidGlassTheme();
  document.querySelectorAll('[data-user-name]').forEach(el=>el.textContent=session?.name || 'Public visitor');
  document.querySelectorAll('[data-area]').forEach(el=>el.textContent=area);
  document.querySelector('[data-logout]')?.addEventListener('click',async()=>{await authService.logout(); location.replace('/editorial/login/');});
  document.querySelectorAll('[data-student-view],[data-admin-view]').forEach(button=>button.addEventListener('click',()=>{const sidebar=document.querySelector('.app-sidebar');if(sidebar?.classList.contains('is-open')){sidebar.classList.remove('is-open');document.querySelector('[data-menu]')?.setAttribute('aria-expanded','false');document.querySelector('#main')?.focus();}}));
  document.querySelector('#main')?.setAttribute('tabindex','-1');
  document.querySelector('.app-sidebar')?.addEventListener('keydown',event=>{if(event.key==='Escape'&&event.currentTarget.classList.contains('is-open')){event.currentTarget.classList.remove('is-open');const menu=document.querySelector('[data-menu]');menu?.setAttribute('aria-expanded','false');menu?.focus();}});
  document.querySelector('[data-menu]')?.addEventListener('click',event=>{const open=document.querySelector('.app-sidebar')?.classList.toggle('is-open');event.currentTarget.setAttribute('aria-expanded',String(Boolean(open)));});
}
