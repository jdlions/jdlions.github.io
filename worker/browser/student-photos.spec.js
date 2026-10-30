import{test,expect}from'@playwright/test';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=','base64');
for(const width of [390,1440])test('category-only photo upload, retry and gallery '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});let fail=true;const uploads=[],calls=[];
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;calls.push(route.request().url());
 if(p==='/api/session')return route.fulfill({json:{authenticated:true,user:{role:'student',studentId:'student',name:'학생'}}});
 if(p==='/api/photos/upload-diagnostics')return route.fulfill({json:{token:{httpStatus:200,grantedScopes:['https://www.googleapis.com/auth/drive.file'],audienceMatches:true},folder:{httpStatus:200,isAppAuthorized:false,canAddChildren:true}}});
 if(p==='/api/assignments')return route.fulfill({json:{campaigns:[],assignments:[]}});
 if(p==='/api/photos/upload'){uploads.push(route.request().postDataBuffer().toString());return fail?route.fulfill({status:503,json:{error:{code:'drive_permission_denied',message:'storage'}}}):route.fulfill({json:{id:'new-photo',filename:'source.png',caption:'설명',createdAt:'2026-01-01'}});}
 if(p.endsWith('/thumbnail'))return route.fulfill({body:png,contentType:'image/png'});
 return route.fulfill({json:p==='/api/photos'?[]:{items:[],campaigns:[],stats:{total:0,byStatus:{}},nextCursor:null}});});
 await page.goto('/student/');await expect(page.locator('[data-view=dashboard] h1')).toBeVisible();
 if(width<768)await page.locator('[data-menu]').click();await page.locator('[data-open-upload]').first().click();const modal=page.locator('[data-upload-modal]');
 await expect(modal.locator('[name=photoType] option')).toHaveText(['피처 (Feature)','학교 (School)']);await expect(modal.locator('[data-article-picker],[name=articleSubmissionId],[data-query]')).toHaveCount(0);
 await modal.locator('[name=files]').setInputFiles({name:'source.png',mimeType:'image/png',buffer:png});await modal.locator('[name=caption]').fill('설명');await modal.locator('[name=photographer]').fill('촬영자');await modal.locator('[name=copyright]').check();
 await modal.getByRole('button',{name:'제출하기'}).click();await expect(modal.locator('[data-dialog-status]')).toContainText('Google Drive API');await expect(modal).toBeVisible();await expect(modal.locator('[name=files]')).toHaveValue(/source.png/);await expect(modal.getByRole('button',{name:'제출하기'})).toBeEnabled();
 await expect(modal.locator('[data-photo-diagnostics],[data-photo-diagnostics-result]')).toHaveCount(0);
 fail=false;await modal.locator('[name=photoType]').selectOption('school');await modal.getByRole('button',{name:'제출하기'}).click();await expect(modal).not.toBeVisible();expect(uploads.at(-1)).toContain('school');expect(uploads.at(-1)).not.toContain('articleSubmissionId');
 if(width<768&&!await page.locator('.app-sidebar').isVisible())await page.locator('[data-menu]').click();await page.locator('[data-open-upload]').first().click();await modal.locator('[name=files]').setInputFiles({name:'feature.png',mimeType:'image/png',buffer:png});await modal.locator('[name=caption]').fill('설명');await modal.locator('[name=photographer]').fill('촬영자');await modal.locator('[name=copyright]').check();await modal.getByRole('button',{name:'제출하기'}).click();await expect(modal).not.toBeVisible();expect(uploads.at(-1)).toContain('feature');
 expect(calls.some(x=>x.includes('picker=1'))).toBe(false);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:info.outputPath('photo-submit.png')});
});
