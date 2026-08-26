export const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export const formatDate = value => new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'short', day:'numeric' }).format(new Date(value));
export const textCount = html => { const node=document.createElement('div'); node.innerHTML=html || ''; return (node.textContent || '').trim().length; };
const statusLabels={unreviewed:'미검토',reviewing:'검토 중',accepted:'승인',approved:'승인',hold:'보류',rejected:'반려',active:'진행 중'};
export const statusBadge = status => `<span class="status status--${escapeHtml(status)}">${escapeHtml(statusLabels[status]||status)}</span>`;
export function toast(message, tone='ok') { const el=document.querySelector('[data-toast]'); if(!el)return; el.textContent=message; el.dataset.tone=tone; el.classList.add('is-visible'); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>el.classList.remove('is-visible'),2600); }
export function emptyState(title, detail) { return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`; }
