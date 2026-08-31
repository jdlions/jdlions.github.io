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
  document.querySelector('[data-menu]')?.addEventListener('click',event=>{const open=document.querySelector('.app-sidebar')?.classList.toggle('is-open');event.currentTarget.setAttribute('aria-expanded',String(Boolean(open)));});
}
