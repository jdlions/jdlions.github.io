import {test,expect} from '@playwright/test';
import {pageResponse} from './page-fixture.js';
import {validateNativeDraft} from '../src/index.js';

test('student-controlled article type cannot inject markup into the real admin queue',async({page})=>{
  const articleType='"><img src=x onerror="document.body.dataset.auditXss=1">';
  const draft=validateNativeDraft({articleType,titleKo:'Fixture',contentHtml:'<p>Text</p>'});
  await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/session'
    ?{authenticated:true,user:{role:'admin',name:'Fixture'}}
    :pageResponse([{...draft,id:'a1',studentId:'s1',status:'draft',updatedAt:'2026-01-01T00:00:00.000Z'}])}));
  await page.goto('/admin/#view=articles');await expect(page.locator('[data-queue]')).toBeVisible();
  await expect(page.locator('[data-queue] img')).toHaveCount(0);
  await expect(page.locator('[data-open]')).toHaveAttribute('data-type',articleType);
  expect(await page.locator('body').getAttribute('data-audit-xss')).toBeNull();
});

for(const view of ['files','editor-settings'])test('pending '+view+' read never blocks other navigation or paints a stale view',async({page})=>{
  let pending;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/editorial-files/'+(view==='files'?'projects':'settings')){pending=route;return;}
    await route.fulfill({json:path==='/api/session'?{authenticated:true,user:{role:'admin',name:'Fixture'}}:
      path==='/api/editorial-files/editors'?{editors:[],operatorRole:''}:pageResponse([])});
  });
  await page.goto('/admin/#view='+view);await expect.poll(()=>Boolean(pending)).toBe(true);
  await page.locator('[data-admin-view=dashboard]').click();
  await expect(page.locator('[data-view=dashboard]')).toBeVisible();
  await expect(page.locator('[data-view=dashboard] h1')).toHaveText('대시보드');
  await pending.fulfill({status:502,json:{error:{message:'Late error'}}});
  await expect(page.locator('[data-view=dashboard]')).toBeVisible();
  await expect(page.getByText('Late error')).toHaveCount(0);
});

for(const role of ['admin','student'])test(role+' initialization loads only required resources and isolates editorial failure',async({page})=>{
  const calls=[];let fail=true;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;calls.push(path);
    if(path==='/api/editorial-files/projects'&&fail)return route.fulfill({status:502,json:{error:{message:'Classroom unavailable'}}});
    const data=path==='/api/session'?{authenticated:true,user:{role,name:'Fixture',studentId:'s1'}}:
      path==='/api/native/articles'?pageResponse([]):path==='/api/assignments'?{campaigns:[],assignments:[]}:
      path==='/api/editorial-files/editors'?{operatorRole:'',editors:[]}:[];
    await route.fulfill({json:data});
  });
  await page.goto('/'+role+'/');if(role==='admin')await expect(page.locator('[data-view=dashboard] h1')).toHaveText('대시보드');else await expect(page.locator('[data-page-range]')).toHaveText('0개');
  if(role==='student')await expect(page.getByText('배부된 과제가 없습니다')).toBeVisible();
  expect(calls.sort()).toEqual((role==='admin'?['/api/session','/api/admin/dashboard']:['/api/session','/api/native/articles','/api/assignments']).sort());
  if(role==='admin'){
    await page.locator('[data-admin-view=files]').click();await expect(page.locator('[data-file-retry]')).toBeVisible();
    await expect(page.locator('[data-view=files] .loading-state')).toHaveCount(0);
    fail=false;await page.locator('[data-file-retry]').click();await expect(page.locator('[data-file-operator]')).toBeVisible();
    await page.locator('[data-admin-view=dashboard]').click();await expect(page.locator('[data-view=dashboard] h1')).toHaveText('대시보드');
    expect(calls).not.toContain('/api/classroom/students');expect(calls).not.toContain('/api/photos');
  }
});
