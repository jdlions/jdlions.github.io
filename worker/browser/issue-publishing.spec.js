import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const source = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const legacy = JSON.parse(source('data/issues.json'));
const drive = 'https://drive.google.com/file/d/synthetic_browser_pdf_35/view';

async function admin(page, { failFirst = false, listFailure = false } = {}) {
  const calls = []; let release;
  const issues = structuredClone(legacy);
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname; let data;
    if (path === '/api/session') data = { authenticated: true, user: { role: 'admin', name: 'Teacher' } };
    else if (path === '/api/native/articles' || path === '/api/photos') data = [];
    else if (path === '/api/assignments') data = { campaigns: [], assignments: [] };
    else if (path === '/api/classroom/students') data = { students: [] };
    else if (path === '/api/publications' && req.method() === 'GET') {
      if (listFailure) return route.fulfill({ status: 503, json: { error: { message: '발행 목록을 읽을 수 없습니다.' } } });
      data = { issues, nextNumber: Math.max(...issues.map(x => x.number)) + 1 };
    } else if (path === '/api/publications' && req.method() === 'POST') {
      calls.push({ body: req.postDataJSON(), key: req.headers()['idempotency-key'], csrf: req.headers()['x-editorial-csrf'] });
      if (failFirst && calls.length === 1) return route.fulfill({ status: 503, json: { error: { message: '응답을 확인할 수 없습니다. 다시 시도해 주세요.' } } });
      await new Promise(resolve => release = resolve);
      const input = req.postDataJSON();
      const issue = { number: input.number, label: `No.${input.number}`, date: `${input.year} ${input.season}`, year: input.year, season: input.season, title: input.title, url: drive };
      issues.unshift(issue); data = { issue, replayed: false };
    } else throw new Error('Unexpected API: ' + path);
    await route.fulfill({ json: data });
  });
  await page.goto('/admin/#view=publications');
  return { calls, release: () => release() };
}
async function fill(page) {
  await expect(page.getByRole('spinbutton', { name: '호수 번호' })).toHaveValue('35');
  await page.getByRole('textbox', { name: 'Google Drive PDF 링크' }).fill(drive + '?usp=sharing');
  await page.getByRole('checkbox', { name: 'PDF와 공개 공유 설정을 확인했습니다.' }).check();
}
test('preview, next number, repeated clicks, navigation lock, success and history', async ({ page }) => {
  const state = await admin(page); await fill(page);
  await expect(page.locator('[data-issue-preview]')).toContainText('No.35');
  await expect(page.getByRole('link', { name: 'Drive PDF 미리보기' })).toHaveAttribute('href', drive);
  await expect(page.getByRole('link', { name: 'Drive PDF 미리보기' })).toHaveAttribute('target', '_blank');
  await page.locator('[data-publication-form]').evaluate(form => { for (let i = 0; i < 5; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await expect.poll(() => state.calls.length).toBe(1);
  await expect(page.locator('[data-publish]')).toBeDisabled();
  await page.locator('[data-admin-view=articles]').click();
  await expect(page.locator('[data-publication-form]')).toBeVisible();
  expect(state.calls[0].csrf).toBe('1'); expect(state.calls[0].key).toMatch(/^[\w-]{36}$/);
  state.release();
  await expect(page.locator('[data-publication-success]')).toHaveText('No.35이 홈페이지 발행 목록에 추가되었습니다.');
  await expect(page.getByRole('spinbutton', { name: '호수 번호' })).toHaveValue('36');
  await expect(page.locator('.publication-list article')).toHaveCount(19);
  await expect(page.locator('.publication-list article').first()).toContainText('No.35');
  await expect(page.locator('.publication-list article').nth(1)).toContainText('No.34');
});
test('failure keeps input and retry key, layout fits phone, unsafe links never become preview anchors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await admin(page, { failFirst: true }); await fill(page);
  await page.locator('[data-publish]').click();
  await expect(page.locator('[data-publication-error]')).toContainText('다시 시도');
  await expect(page.getByRole('textbox', { name: 'Google Drive PDF 링크' })).toHaveValue(drive + '?usp=sharing');
  await page.locator('[data-publish]').click();
  await expect.poll(() => state.calls.length).toBe(2);
  expect(state.calls[1].key).toBe(state.calls[0].key);
  state.release(); await expect(page.locator('[data-publication-success]')).toBeVisible();
  await page.getByRole('textbox', { name: 'Google Drive PDF 링크' }).fill('javascript:alert(1)');
  await expect(page.locator('[data-issue-preview] a')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/issue-publishing-mobile.png', fullPage: true });
});
test('auto title follows year/season but preserves a custom title; missing values cannot publish', async ({ page }) => {
  const state = await admin(page);
  await page.getByRole('spinbutton', { name: '발행 연도' }).fill('2027');
  await expect(page.getByRole('textbox', { name: '홈페이지에 표시될 제목' })).toHaveValue("The Lion's Pride — 2027 Winter Edition");
  await page.getByRole('button', { name: '계절' }).click();
  await page.getByRole('option', { name: 'Summer', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '홈페이지에 표시될 제목' })).toHaveValue("The Lion's Pride — 2027 Summer Edition");
  await page.getByRole('textbox', { name: '홈페이지에 표시될 제목' }).fill('Custom <img src=x onerror=alert(1)>');
  await page.getByRole('spinbutton', { name: '발행 연도' }).fill('2028');
  await page.getByRole('textbox', { name: 'Google Drive PDF 링크' }).fill(drive);
  await expect(page.locator('[data-issue-preview] h2')).toHaveText('Custom <img src=x onerror=alert(1)>');
  await expect(page.locator('[data-issue-preview] img')).toHaveCount(0);
  await page.locator('[data-publish]').click(); expect(state.calls).toHaveLength(0);
  await page.screenshot({ path: 'test-results/issue-publishing-desktop.png', fullPage: true });
});
test('unavailable archive blocks publishing and offers retry without breaking the article desk', async ({ page }) => {
  await admin(page, { listFailure: true });
  await expect(page.locator('[data-view=publications] [role=alert]')).toContainText('발행 목록을 읽을 수 없습니다.');
  await expect(page.locator('[data-publish]')).toHaveCount(0);
  await page.locator('[data-admin-view=articles]').click();
  await expect(page.getByRole('heading', { name: '기사 검토 큐' })).toBeVisible();
});
for (const failure of ['none', 'api', 'json']) test('public archive preserves all legacy rows with ' + failure + ' failure', async ({ page }) => {
  await page.route('**/archive-test', route => route.fulfill({ contentType: 'text/html', body: source('index.html') }));
  await page.route('**/assets/js/public/archive.js', route => route.fulfill({ contentType: 'text/javascript', body: source('assets/js/public/archive.js') }));
  await page.route('**/data/issues.json', route => route.fulfill({ status: failure === 'json' ? 503 : 200, json: legacy }));
  const issue = { ...legacy[0], number: 35, label: 'No.35', year: 2025, title: 'New issue <script>unsafe()</script>', url: drive };
  await page.route('**/api/public/issues', route => route.fulfill({ status: failure === 'api' ? 503 : 200, headers: { 'Access-Control-Allow-Origin': '*' }, json: [issue, ...legacy] }));
  await page.goto('/archive-test');
  await expect(page.locator('#archive-list .issue-row')).toHaveCount(failure === 'none' ? 19 : 18);
  const rows = await page.locator('#archive-list .issue-row').evaluateAll(nodes => nodes.map(x => ({ label: x.querySelector('.ino').textContent, title: x.querySelector('.ititle').textContent, url: x.getAttribute('href') })));
  expect(rows.slice(failure === 'none' ? 1 : 0)).toEqual(legacy.map(({ label, title, url }) => ({ label, title, url })));
  await expect(page.locator('.archive-count')).toHaveText(failure === 'none' ? 'No.16 — No.35' : 'No.16 — No.34');
  await expect(page.locator('#archive-list script')).toHaveCount(0);
});
