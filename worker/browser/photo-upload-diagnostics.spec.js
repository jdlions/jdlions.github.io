import{test,expect}from'@playwright/test';
for(const width of [390,1440])test('retired diagnostics is absent and category-only submission stays available '+width,async({page})=>{
 await page.setViewportSize({width,height:900});const calls=[];
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;calls.push(p);
 if(p==='/api/session')return route.fulfill({json:{authenticated:true,user:{role:'student',studentId:'s',name:'학생'}}});
 if(p==='/api/assignments')return route.fulfill({json:{campaigns:[],assignments:[]}});
 return route.fulfill({json:p==='/api/photos'?[]:{items:[],campaigns:[],stats:{total:0,byStatus:{}},nextCursor:null}});});
 await page.goto('/student/');await expect(page.locator('[data-view=dashboard] h1')).toBeVisible();
 if(width<768)await page.locator('[data-menu]').click();await page.locator('[data-open-upload]').first().click();const modal=page.locator('[data-upload-modal]');
 await expect(modal).toBeVisible();await expect(modal.locator('[name=photoType] option')).toHaveText(['피처 (Feature)','학교 (School)']);
 await expect(modal.locator('[data-photo-diagnostics],[data-photo-diagnostics-result],[data-article-picker],[name=articleSubmissionId]')).toHaveCount(0);
 expect(calls.some(p=>p.includes('diagnostics')||p==='/api/photos/upload')).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
