import {test,expect} from '@playwright/test';
import {overviewResponse} from './page-fixture.js';
const students=Array.from({length:24},(_,i)=>({studentId:'google-'+i,name:i===23?'Unknown editor':String((i<12?11000:21000)+i)+' 학생'}));
const articles=students.flatMap((s,i)=>i===23?[]:['school','feature'].filter(t=>i<20||t==='feature').map(t=>({id:s.studentId+'-'+t,studentId:s.studentId,authorName:s.name,articleType:t,titleKo:i===0?'<img src=x onerror=alert(1)> '+('긴 제목 '.repeat(30)):t+' title '+i,status:t==='school'?'submitted':'revision_requested',campaignId:'c',assignmentName:'Winter',submittedAt:'2026-01-01T00:00:00Z'})));
async function setup(page){const calls=[];await page.route('**/api/**',async r=>{const p=new URL(r.request().url()).pathname;calls.push(p);const data=p==='/api/session'?{authenticated:true,user:{role:'admin',name:'Teacher'}}:p==='/api/admin/article-overview'?{...overviewResponse(articles,students),campaigns:[{id:'c',name:'Winter'}]}:p.startsWith('/api/native/articles/')?{...articles.find(a=>a.id===p.split('/')[4]),draftHtml:'Full private body',internalNote:'Teacher only',revisions:[]}:p==='/api/admin/dashboard'?{assignment:{campaign:null,progress:[]},editorial:null,errors:{}}:{};await r.fulfill({json:data});});await page.goto('/admin/#view=articles');await expect(page.locator('.compact-student-card')).toHaveCount(24);return calls;}
async function select(page,key,value){await page.locator('[data-'+key+']').locator('..').locator('button').first().click();await page.locator('[role=option][data-value="'+value+'"]:visible').click();}
for(const width of [390,820,1440])test('compact complete student overview and filters '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const calls=await setup(page);
 await expect(page.locator('.article-pagination,[data-page-prev],[data-page-next]')).toHaveCount(0);
 await expect(page.locator('.compact-slot')).toHaveCount(48);await expect(page.locator('.compact-student-card').last()).toContainText('학교기사');await expect(page.locator('.compact-student-card').last()).toContainText('피처기사');await expect(page.locator('.compact-student-card').last().locator('.status')).toHaveText(['미제출','미제출']);
 await expect(page.locator('.compact-student-grid img,.compact-student-grid small')).toHaveCount(0);await expect(page.locator('[data-open]').first()).toContainText('<img src=x');
 const card=await page.locator('.compact-student-card').first().boundingBox();expect(card.height).toBeLessThan(225);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('articles-'+width+'.png'),fullPage:true});
 await select(page,'grade-filter','1');await expect(page.locator('.compact-student-card')).toHaveCount(12);
 await select(page,'type-filter','feature');await select(page,'status-filter','revision_requested');await select(page,'campaign-filter','c');await page.locator('[data-query]').fill('Winter');await expect(page.locator('.compact-student-card')).toHaveCount(12);
 await expect(page.locator('.compact-slot')).toHaveCount(24);await expect(page.locator('.is-filtered')).toHaveCount(12);await expect(page.locator('.compact-slot .status').filter({hasText:'미제출'})).toHaveCount(0);
 expect(calls.filter(p=>p==='/api/admin/article-overview')).toHaveLength(1);expect(calls).not.toContain('/api/native/articles');
 await page.locator('[data-query]').fill('');await select(page,'campaign-filter','');await select(page,'status-filter','');await select(page,'type-filter','');await select(page,'grade-filter','2');await expect(page.locator('.compact-student-card')).toHaveCount(11);
 await select(page,'grade-filter','');await expect(page.locator('.compact-student-card')).toHaveCount(24);
 await page.locator('[data-delete-article]').first().click();await expect(page.getByRole('dialog')).toContainText('정확히');await expect(page.locator('[data-delete-final]')).toBeDisabled();await page.keyboard.press('Escape');
 await page.locator('[data-query]').fill('school title 1');await expect(page.locator('.compact-student-card')).toHaveCount(11);await page.locator('[data-open]').first().click();await expect(page.locator('[data-editor]')).toHaveText('Full private body');await page.locator('[data-back]').click();await expect(page.locator('[data-query]')).toHaveValue('school title 1');
});

test('overview timeout and late retry remain isolated from navigation',async({page})=>{
 await page.clock.install();await setup(page);let stalled=true;
 await page.route('**/api/admin/article-overview',r=>stalled?new Promise(()=>{}):r.fulfill({json:overviewResponse([],students)}));
 await page.locator('[data-page-refresh]').click();await page.clock.fastForward(61000);await expect(page.locator('[data-list-message]')).toContainText('요청 시간이 초과');await expect(page.locator('.loading-spinner')).toHaveCount(0);
 stalled=false;await page.locator('[data-retry-startup]').click();await expect(page.locator('.compact-student-card')).toHaveCount(24);await expect(page.locator('[data-open]')).toHaveCount(0);await expect(page.locator('.compact-slot .status')).toHaveCount(48);
 await page.locator('[data-admin-view=dashboard]').click();await expect(page.locator('[data-dashboard-refresh]')).toBeVisible();
});
