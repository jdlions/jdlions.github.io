import { customSelect, escapeHtml, initCustomSelect, toast } from '../shared/ui.js';
import { validatePublication } from '../shared/issue-publication.js';

export function createIssuePublishing(service) {
  let pending = false;
  let draft = null;
  let attempt = null;
  let savedMessage = '';
  const defaultTitle = (year, season) => `The Lion's Pride — ${year} ${season} Edition`;
  async function render(root) {
    root.innerHTML = '<div class="panel" role="status">발행 목록을 불러오는 중…</div>';
    let archive;
    try { archive = await service().listPublications(); }
    catch (error) {
      root.innerHTML = `${savedMessage ? `<p class="notice" role="status">${escapeHtml(savedMessage)}</p>` : ''}<div class="notice notice--error" role="alert">${escapeHtml(error.message)} <button data-publication-retry>다시 시도</button></div>`;
      root.querySelector('button').onclick = () => render(root);
      return;
    }
    if (root.hidden) return;
    const year = new Date().getFullYear();
    draft ||= { number: archive.nextNumber, year, season: 'Winter', title: defaultTitle(year, 'Winter'), url: '', publicPdfConfirmed: false };
    root.innerHTML = `<header class="page-head"><div><p class="eyebrow">PrideDesk · Publication Desk</p><h1>신문 발행</h1><p>새 호수를 공개 홈페이지 아카이브에 추가합니다.</p></div></header>
      <p class="notice" data-publication-success role="status" ${savedMessage ? '' : 'hidden'}>${escapeHtml(savedMessage)}</p>
      <div class="publication-layout"><form class="panel publication-form" data-publication-form>
        <h2>새 호수 정보</h2><p>최신 호수: No.${archive.nextNumber - 1} · 다음 번호는 직접 조정할 수 있습니다.</p>
        <div class="grid form-grid"><label class="field"><span>호수 번호</span><input name="number" type="number" min="1" max="999999" step="1" required value="${draft.number}"></label>
        <label class="field"><span>발행 연도</span><input name="year" type="number" min="1900" max="2100" step="1" required value="${draft.year}"></label>
        <div class="field"><span>계절</span>${customSelect('publication-season', '계절', [['Summer', 'Summer'], ['Winter', 'Winter']], { value: draft.season, inputName: 'season' })}</div></div>
        <label class="field"><span>홈페이지에 표시될 제목</span><input name="title" maxlength="300" required value="${escapeHtml(draft.title)}"></label>
        <label class="field"><span>Google Drive PDF 링크</span><input name="url" type="url" maxlength="2048" required placeholder="https://drive.google.com/file/d/…/view" value="${escapeHtml(draft.url)}"></label>
        <p class="publication-help">링크 형식을 검사합니다. PDF 내용과 접근 권한은 자동 확인되지 않습니다. 미리보기 링크를 로그아웃 상태에서도 열어 공개할 PDF인지 확인해 주세요.</p>
        <label class="checkbox"><input name="publicPdfConfirmed" type="checkbox" required ${draft.publicPdfConfirmed ? 'checked' : ''}>PDF와 공개 공유 설정을 확인했습니다.</label>
        <p data-publication-error role="alert"></p><div class="form-actions"><button class="btn-primary" data-publish>발행</button></div>
      </form><aside class="panel publication-preview"><p class="eyebrow">발행 전 미리보기</p><div data-issue-preview aria-live="polite"></div></aside></div>
      <section class="panel publication-history"><h2>기존 발행 호수</h2><div class="publication-list">${archive.issues.map(issue => `<article><div><strong>${escapeHtml(issue.label)}</strong><span>${escapeHtml(issue.date)} · 발행됨</span><p>${escapeHtml(issue.title)}</p></div><a href="${escapeHtml(issue.url)}" target="_blank" rel="noopener noreferrer">Drive PDF 열기 ↗</a></article>`).join('')}</div></section>`;
    const form = root.querySelector('form');
    const read = () => ({ number: Number(form.elements.number.value), year: Number(form.elements.year.value), season: form.elements.season.value, title: form.elements.title.value, url: form.elements.url.value, publicPdfConfirmed: form.elements.publicPdfConfirmed.checked });
    const preview = () => {
      const next = read();
      if ((next.year !== draft.year || next.season !== draft.season) && draft.title === defaultTitle(draft.year, draft.season)) {
        next.title = defaultTitle(next.year, next.season); form.elements.title.value = next.title;
      }
      if (next.url !== draft.url) { next.publicPdfConfirmed = false; form.elements.publicPdfConfirmed.checked = false; }
      draft = next;
      const target = root.querySelector('[data-issue-preview]');
      try {
        const issue = validatePublication(next);
        target.innerHTML = `<strong class="issue-label">${escapeHtml(issue.label)}</strong><h2>${escapeHtml(issue.title)}</h2><p>${escapeHtml(issue.date)}</p><a href="${escapeHtml(issue.url)}" target="_blank" rel="noopener noreferrer">Drive PDF 미리보기 ↗</a><p class="publication-url">${escapeHtml(issue.url)}</p>`;
      } catch (error) { target.innerHTML = `<p>${escapeHtml(error.message)}</p>`; }
    };
    const seasonSelect = initCustomSelect(root.querySelector('[data-custom-select]'), preview);
    root.querySelector('.custom-select__trigger').setAttribute('aria-label', '계절');
    form.oninput = preview; preview();
    form.onsubmit = async event => {
      event.preventDefault();
      if (pending || !form.reportValidity()) return;
      const input = read();
      const errorBox = root.querySelector('[data-publication-error]');
      try { validatePublication(input); } catch (error) { errorBox.textContent = error.message; return; }
      const fingerprint = JSON.stringify(input);
      if (!attempt || attempt.fingerprint !== fingerprint) attempt = { fingerprint, key: crypto.randomUUID() };
      pending = true; errorBox.textContent = '';
      seasonSelect.close(false);
      const controls = [...form.querySelectorAll('input, button')];
      controls.forEach(x => x.disabled = true);
      root.querySelector('[data-publish]').textContent = '발행 중…';
      try {
        const result = await service().publishIssue(input, attempt.key);
        savedMessage = `${result.issue.label}이 홈페이지 발행 목록에 추가되었습니다.`;
        draft = null; attempt = null;
        toast(savedMessage);
        await render(root);
      } catch (error) {
        errorBox.textContent = error.message;
        controls.forEach(x => x.disabled = false);
        root.querySelector('[data-publish]').textContent = '발행';
      } finally { pending = false; }
    };
  }
  return { render, isPending: () => pending };
}
