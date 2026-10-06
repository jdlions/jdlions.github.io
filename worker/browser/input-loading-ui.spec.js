import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {pageResponse} from './page-fixture.js';
const article={id:'a',studentId:'s',titleKo:'Test article',status:'draft',articleType:'school',updatedAt:'2026-01-01T00:00:00Z'};
async function setup(page,role='admin'){
 const pending=[],holds=new Set(['/api/native/articles']);
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),p=url.pathname;
  if(holds.has(p)){pending.push({route,url});return;}
  const data=p==='/api/session'?{authenticated:true,user:{role,studentId:'s',name:'Tester'}}:p==='/api/assignments'?{campaigns:[],assignments:[]}:p==='/api/classroom/students'?{students:[]}:[];
  await route.fulfill({json:data});
 });
 await page.goto('/'+role+'/'+(role==='admin'?'#view=articles':''));await expect(page.locator('[data-list-message] .loading-spinner')).toBeVisible();
 return {pending,holds,async reply(data=pageResponse([article]),status=200,index=0){await expect.poll(()=>pending.length).toBeGreaterThan(index);await pending.splice(index,1)[0].route.fulfill({status,json:data}).catch(()=>{});}};
}
for(const width of [390,820,1440])test('filter surfaces, date and keyboard focus match at '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const s=await setup(page);await s.reply();await expect(page.locator('[data-open]')).toBeVisible();
 const input=page.locator('[data-query]'),select=page.locator('.custom-select__trigger').first();
 const style=e=>{const s=getComputedStyle(e);return {background:s.backgroundImage,border:s.borderColor,radius:s.borderRadius,height:s.height,font:s.fontSize};};
 expect(await input.evaluate(style)).toEqual(await select.evaluate(style));expect(await page.locator('[data-date-filter]').evaluate(style)).toEqual(await select.evaluate(style));
 await input.focus();expect(await input.evaluate(e=>getComputedStyle(e).outlineStyle)).not.toBe('none');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.locator('[data-date-filter]').fill('2026-01-01');await expect(page.locator('.loading-spinner')).toBeVisible();await expect.poll(()=>s.pending.at(-1)?.url.searchParams.get('date')).toBe('2026-01-01');await s.reply();await expect(page.locator('.loading-spinner')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('filters.png')});
});
test('loading removes spinner for empty/error and retry success',async({page})=>{
 const s=await setup(page);await s.reply(pageResponse([]));await expect(page.locator('[data-page-range]')).toHaveText('0개');await expect(page.locator('.loading-spinner')).toHaveCount(0);
 await page.locator('[data-page-refresh]').click();await expect(page.locator('.loading-spinner')).toBeVisible();await s.reply({error:{message:'Temporary error'}},503);await expect(page.locator('[data-retry-startup]')).toBeVisible();await expect(page.locator('.loading-spinner')).toHaveCount(0);
 await page.locator('[data-retry-startup]').click();await expect(page.locator('.loading-spinner')).toBeVisible();await s.reply();await expect(page.locator('[data-open]')).toBeVisible();await expect(page.locator('.loading-spinner')).toHaveCount(0);
});
test('pagination/search keep loading until latest request completes and respect reduced motion',async({page})=>{
 await page.clock.install();await page.emulateMedia({reducedMotion:'reduce'});const s=await setup(page);
 expect(await page.locator('.loading-spinner').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
 await s.reply({...pageResponse([article]),nextCursor:'next'});await expect(page.locator('[data-page-next]')).toBeEnabled();await page.locator('[data-page-next]').click();await expect(page.locator('.loading-spinner')).toBeVisible();await s.reply();await expect(page.locator('.loading-spinner')).toHaveCount(0);
 await page.locator('[data-query]').fill('old');await page.clock.fastForward(350);await expect.poll(()=>s.pending.length).toBe(1);
 await page.locator('[data-query]').fill('new');await expect(page.locator('.loading-spinner')).toBeVisible();await page.clock.fastForward(350);await expect.poll(()=>s.pending.length).toBe(2);
 await s.reply(pageResponse([{...article,titleKo:'Old'}]));await expect(page.locator('.loading-spinner')).toBeVisible();await s.reply(pageResponse([{...article,titleKo:'Newest'}]));await expect(page.locator('[data-open]')).toContainText('Newest');await expect(page.locator('.loading-spinner')).toHaveCount(0);
});
test('assignment/photo/roster loading stays local and student filters share the surface',async({page})=>{
 const s=await setup(page);await s.reply();await expect(page.locator('[data-open]')).toBeVisible();s.holds.add('/api/assignments');
 await page.locator('[data-admin-view=assignments]').click();await expect(page.locator('[data-view=assignments] .loading-spinner')).toBeVisible();await s.reply({campaigns:[],assignments:[]});await expect(page.locator('.loading-spinner')).toHaveCount(0);
 const input=page.locator('[data-assignment-student]');await expect(input).toHaveAttribute('aria-label','학생 이름 또는 ID');expect(await input.evaluate(e=>getComputedStyle(e).backgroundImage)).toBe(await page.locator('.assignment-toolbar .custom-select__trigger').first().evaluate(e=>getComputedStyle(e).backgroundImage));
 s.holds.add('/api/classroom/students');await page.locator('[data-new-assignment]').click();await expect(page.locator('.loading-state')).toContainText('학생 명단');await s.reply({students:[]});await expect(page.locator('.loading-spinner')).toHaveCount(0);
 s.holds.add('/api/admin/photo-students');await page.locator('[data-admin-view=photos]').click();await expect(page.locator('[data-view=photos] .loading-spinner')).toBeVisible();await page.locator('[data-admin-view=articles]').click();await expect(page.locator('[data-open]')).toBeVisible();await s.reply([]);await expect(page.locator('[data-open]')).toBeVisible();await expect(page.locator('.loading-spinner')).toHaveCount(0);
});
test('student article and assignment loading are independent',async({page})=>{
 const s=await setup(page,'student');await s.reply();await expect(page.locator('[data-open]')).toBeVisible();await expect(page.locator('.loading-spinner')).toHaveCount(0);await page.locator('[data-query]').fill('empty');await expect(page.locator('.loading-spinner')).toBeVisible();await s.reply(pageResponse([]));await expect(page.locator('.loading-spinner')).toHaveCount(0);
});
test('homepage PrideDesk links use the confirmed production application',async({page})=>{
 const html=readFileSync('../index.html','utf8');await page.route('**/homepage-test',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('/homepage-test');
 await expect(page.locator('a.nav-workspace')).toHaveAttribute('href','https://pridesk.vercel.app');await expect(page.locator('a[href*="workers.dev"][href*="editorial"]')).toHaveCount(0);await expect(page.locator('a[href^="https://pridedesk.vercel.app"]')).toHaveCount(0);
});
