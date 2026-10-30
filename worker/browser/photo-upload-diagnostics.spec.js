import{test,expect}from'@playwright/test';import{pageResponse}from'./page-fixture.js';
for(const width of [390,1440])test('temporary read-only diagnostics keeps article selection and never uploads '+width,async({page})=>{
 await page.setViewportSize({width,height:900});const calls=[];let fail=false;
 await page.route('**/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname;calls.push({path:p,method:req.method(),csrf:req.headers()['x-editorial-csrf']});
 if(p==='/api/session')return route.fulfill({json:{authenticated:true,user:{role:'student',studentId:'s',name:'학생'}}});
 if(p==='/api/assignments')return route.fulfill({json:{campaigns:[],assignments:[]}});
 if(p==='/api/native/articles')return route.fulfill({json:pageResponse([{id:'a',titleKo:'기존 기사',status:'draft',studentId:'s',updatedAt:'2026'}])});
 if(p==='/api/photos/upload-diagnostics')return fail?route.fulfill({status:503,json:{error:{code:'unavailable'}}}):route.fulfill({json:{token:{httpStatus:200,grantedScopes:['https://www.googleapis.com/auth/drive.file'],audienceMatches:true},folder:{httpStatus:200,isAppAuthorized:false,canAddChildren:true}}});
 if(p==='/api/photos/upload')throw Error('Diagnostics must not submit a file');return route.fulfill({json:[]});});
 await page.goto('/student/');await expect(page.locator('[data-open]')).toBeVisible();expect(calls.some(c=>c.path.includes('diagnostics'))).toBe(false);
 if(width<768)await page.locator('[data-menu]').click();await page.locator('[data-open-upload]').first().click();const modal=page.locator('[data-upload-modal]');
 await expect(modal.locator('[name=articleSubmissionId] option')).toHaveText('기존 기사');await expect(modal.locator('[data-article-picker]')).toBeVisible();await expect(modal.locator('[name=photoType]')).toHaveCount(0);
 await modal.locator('[data-photo-diagnostics]').click();await expect(modal.locator('[data-photo-diagnostics-result]')).toContainText('앱 파일 접근: 미허용');await expect(modal.locator('[data-photo-diagnostics-result]')).toContainText('파일 추가: 허용');await expect(modal.locator('[name=articleSubmissionId]')).toHaveValue('a');
 const c=calls.find(c=>c.path.includes('diagnostics'));expect(c.method).toBe('POST');expect(c.csrf).toBe('1');expect(calls.some(c=>c.path.includes('/upload')&&!c.path.includes('diagnostics'))).toBe(false);
 fail=true;await modal.locator('[data-photo-diagnostics]').click();await expect(modal.locator('[data-photo-diagnostics-result]')).toContainText('진단을 완료하지 못했습니다');await expect(modal.locator('[data-photo-diagnostics]')).toBeEnabled();await expect(modal).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
