import { authService } from '../auth/auth-service.js';
function loadLiquidGlassTheme() {
  if (document.querySelector('link[data-liquid-glass-theme]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '../assets/css/editorial-liquid-glass.css';
  link.dataset.liquidGlassTheme = '';
  document.head.append(link);
}
export function userGreeting(name, now = new Date()) {
  const hour = now.getHours();
  const greeting = hour >= 5 && hour < 11 ? '좋은 아침이에요' : hour >= 11 && hour < 18 ? '오늘도 반가워요' : hour >= 18 && hour < 22 ? '좋은 저녁이에요' : '늦은 시간이네요';
  const displayName = typeof name === 'string' ? name.trim() : '';
  return displayName ? `${greeting}, ${displayName}님.` : `${greeting}.`;
}
const sidebarCredit='<p>© 2026 The Lion\'s Pride<br>of Joongdong High School</p><p>Website &amp; PrideDesk by<br><strong>35기 Hyunseung Yu</strong></p><a href="mailto:dylanyu@outlook.kr">Developer Contact<br>dylanyu@outlook.kr</a>';
export function initShell(session, area) {
  document.querySelectorAll('[data-sidebar-credit]').forEach(el=>el.innerHTML=sidebarCredit);
  loadLiquidGlassTheme();
  document.querySelectorAll('[data-user-name]').forEach(el=>el.textContent=session?.name || 'Public visitor');
  const greeting = document.querySelector('[data-user-greeting]');
  if (greeting) {
    const update = () => {
      const text = userGreeting(session?.name);
      if (greeting.textContent !== text) greeting.textContent = text;
      greeting.title = text;
    };
    update();
    // One minute is sufficient for time-of-day changes; resume immediately after sleep.
    window.setInterval(update, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  }
  document.querySelectorAll('[data-area]').forEach(el=>el.textContent=area);
  document.querySelector('[data-logout]')?.addEventListener('click',async()=>{await authService.logout(); location.replace('/editorial/login/');});
  document.querySelectorAll('[data-student-view],[data-admin-view]').forEach(button=>button.addEventListener('click',()=>{const sidebar=document.querySelector('.app-sidebar');if(sidebar?.classList.contains('is-open')){sidebar.classList.remove('is-open');document.querySelector('[data-menu]')?.setAttribute('aria-expanded','false');document.querySelector('#main')?.focus();}}));
  document.querySelector('#main')?.setAttribute('tabindex','-1');
  document.querySelector('.app-sidebar')?.addEventListener('keydown',event=>{if(event.key==='Escape'&&event.currentTarget.classList.contains('is-open')){event.currentTarget.classList.remove('is-open');const menu=document.querySelector('[data-menu]');menu?.setAttribute('aria-expanded','false');menu?.focus();}});
  document.querySelector('[data-menu]')?.addEventListener('click',event=>{const open=document.querySelector('.app-sidebar')?.classList.toggle('is-open');event.currentTarget.setAttribute('aria-expanded',String(Boolean(open)));if(open)requestAnimationFrame(()=>{if(document.querySelector('.app-sidebar')?.classList.contains('is-open'))document.querySelector('.app-sidebar .side-nav button, .app-sidebar .side-nav a')?.focus();});});
}
