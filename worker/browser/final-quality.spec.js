import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';
import {pageResponse} from './page-fixture.js';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=','base64');
async function student(page){
 const calls=[];let release;
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;calls.push(path);
  const article={id:'a',studentId:'s',titleKo:'Synthetic article',status:'draft',articleType:'school',draftHtml:'<p>Text</p>',updatedAt:'2026-01-01T00:00:00Z'};
  if(path.endsWith('/thumbnail'))return route.fulfill({body:pixel,contentType:'image/png'});
  if(path==='/api/photos/upload'){await new Promise(r=>release=r);return route.fulfill({json:{id:'new',createdAt:'2026-01-01T00:00:00Z'}});}
  const data=path==='/api/session'?{authenticated:true,user:{role:'student',studentId:'s',name:'Tester'}}:path==='/api/native/articles'?pageResponse([article]):path==='/api/native/articles/a'?article:path==='/api/assignments'?{campaigns:[],assignments:[]}:path==='/api/photos'?[{id:'p',caption:'Test photo',created_at:'2026-01-01T00:00:00Z'}]:[];
  return route.fulfill({json:data});
 });
 await page.goto('/student/');await expect(page.locator('[data-open]')).toBeVisible();return {calls,release:()=>release()};
}
test('upload dialog traps focus, restores trigger, locks scroll and prevents Escape while uploading',async({page})=>{
 const state=await student(page),trigger=page.locator('[data-open-upload]').first();await trigger.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'사진 제출'});
 await expect(dialog).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.style.overflow)).toBe('hidden');
 await dialog.locator('[data-close-modal]').last().focus();await page.keyboard.press('Tab');await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement.closest('dialog')?.open)).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();await expect.poll(()=>page.evaluate(()=>document.documentElement.style.overflow)).not.toBe('hidden');
 await trigger.press('Enter');await dialog.locator('[name=files]').setInputFiles({name:'source.png',mimeType:'image/png',buffer:pixel});await dialog.locator('[name=caption]').fill('caption');await dialog.locator('[name=photographer]').fill('photographer');await dialog.locator('[name=copyright]').check();await dialog.getByRole('button',{name:'제출하기'}).click();
 await expect(dialog.locator('[data-upload-progress]')).toContainText('1/1');await page.keyboard.press('Escape');await expect(dialog).toBeVisible();state.release();await expect(dialog).not.toBeVisible();
});
test('photo gallery requests private thumbnails only and offers explicit original action',async({page})=>{
 const state=await student(page);await page.locator('[data-student-view=photos]').click();await expect(page.locator('[data-photo-thumbnail]')).toBeVisible();await expect.poll(()=>state.calls).toContain('/api/photos/p/thumbnail');expect(state.calls.some(x=>x.endsWith('/content'))).toBe(false);await expect(page.getByRole('link',{name:'Drive 원본 열기'})).toHaveAttribute('href','/api/photos/p/original');
});
test('unavailable thumbnail keeps original explicit and never fetches full image automatically',async({page})=>{
 const state=await student(page);await page.route('**/api/photos/p/thumbnail',r=>r.fulfill({status:404}));await page.locator('[data-student-view=photos]').click();await expect(page.locator('.photo-preview-unavailable')).toBeVisible();await expect(page.getByRole('link',{name:'Drive 원본 열기'})).toBeVisible();expect(state.calls.some(x=>x.endsWith('/content')||x.endsWith('/original'))).toBe(false);
});
for(const width of [390,820,1440])test('student editor, photo picker and modal fit '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});await student(page);await page.locator('[data-open]').click();await expect(page.getByRole('textbox',{name:'기사 본문'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 if(width<768){const menu=page.getByRole('button',{name:'메뉴 열기'}),upload=page.locator('[data-open-upload]').first();await expect(page.locator('.app-sidebar')).not.toBeVisible();await menu.click();await expect(upload).toBeVisible();await upload.focus();await expect(upload).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toHaveAttribute('aria-expanded','false');await expect(menu).toBeFocused();await menu.press('Enter');}await page.locator('[data-open-upload]').first().click();const box=await page.locator('[data-upload-modal] .modal-card').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);await page.screenshot({path:info.outputPath('modal.png')});
});
test('public SEO, resolved images and internal noindex are consistent',async({page})=>{
 await page.route('**/public-test',r=>r.fulfill({contentType:'text/html',body:readFileSync('../index.html','utf8')}));await page.goto('/public-test');await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://jdlions.github.io/');
 for(const property of ['og:title','og:description','og:image','og:url'])await expect(page.locator('meta[property="'+property+'"]')).toHaveAttribute('content',/.+/);
 await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content','summary');expect(await page.locator('img[src^="data:"]').count()).toBe(0);
 expect(await page.locator('img:not([width]),img:not([height])').count()).toBe(0);
 await page.route('**/api/session',r=>r.fulfill({json:{authenticated:false,user:null}}));await page.goto('/login/');await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex, nofollow');await page.locator('[data-google-login]').focus();await expect(page.locator('[data-google-login]')).toBeFocused();
});
