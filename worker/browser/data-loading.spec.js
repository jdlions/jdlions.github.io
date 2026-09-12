import {test,expect} from '@playwright/test';
async function setup(page,role='admin',hold={}){
 const calls=[];const article={id:'a',studentId:'s',articleType:'school',titleKo:'Summary title',status:'draft',draftPreview:'Preview without full body',wordCount:42,updatedAt:'2026-09-01T00:00:00Z'};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;calls.push(path);
  if(hold[path])return hold[path](route);
  const data=path==='/api/session'?{authenticated:true,user:{role,studentId:'s',name:'Test'}}:path==='/api/native/articles'?[article]:path==='/api/native/articles/a'?{...article,draftHtml:'<p>Full detail</p>',studentFeedback:'Feedback',revisions:[]}:path==='/api/assignments'?{campaigns:[],assignments:[]}:path==='/api/classroom/students'?{students:[{id:'s',name:'Student'}]}:path==='/api/publications'?{issues:[],nextNumber:35}:[];
  await route.fulfill({json:data});
 });
 await page.goto('/'+role+'/');return calls;
}
test('admin first render needs only session and summary; photos/assignments/roster load on demand once',async({page})=>{
 const calls=await setup(page);await expect(page.locator('[data-open]')).toBeVisible();expect(calls).toEqual(['/api/session','/api/native/articles']);
 await page.locator('[data-admin-view=photos]').click();await expect(page.locator('[data-view=photos] h1')).toHaveText('사진 관리');expect(calls.filter(x=>x==='/api/photos')).toHaveLength(1);
 await page.locator('[data-admin-view=articles]').click();await expect(page.locator('[data-open]')).toBeVisible();expect(calls.filter(x=>x==='/api/native/articles')).toHaveLength(1);
 await page.locator('[data-admin-view=assignments]').click();await page.locator('[data-new-assignment]').click();await expect(page.locator('[name=studentId]')).toHaveCount(1);expect(calls.filter(x=>x==='/api/classroom/students')).toHaveLength(1);
});
test('student article renders while assignment is pending; late response never replaces editor',async({page})=>{
 let release;const calls=await setup(page,'student',{'/api/assignments':route=>{release=()=>route.fulfill({json:{campaigns:[],assignments:[]}});}});
 await expect(page.locator('[data-open]')).toBeVisible();await expect(page.locator('.native-card')).toContainText('42단어');expect(calls).toHaveLength(3);expect(calls).not.toContain('/api/photos');
 await page.locator('[data-open]').click();await expect(page.locator('[data-editor]')).toHaveText('Full detail');await release();await expect(page.locator('[data-editor]')).toHaveText('Full detail');
});
test('failed article API does not block publications and retries only its own dataset',async({page})=>{
 let fail=true;const calls=await setup(page,'admin',{'/api/native/articles':r=>r.fulfill(fail?{status:503,json:{error:{message:'Article unavailable'}}}:{json:[]})});
 await expect(page.locator('[data-retry-startup]')).toBeVisible();await page.locator('[data-admin-view=publications]').click();await expect(page.locator('[data-publication-form]')).toBeVisible();
 fail=false;await page.locator('[data-admin-view=articles]').click();await expect(page.locator('.queue-tools')).toBeVisible();expect(calls.filter(x=>x==='/api/native/articles')).toHaveLength(2);expect(calls).not.toContain('/api/assignments');
});
test('photo API timeout shows retry and navigation remains usable',async({page})=>{
 await page.clock.install();let stalled=true;const calls=await setup(page,'admin',{'/api/photos':r=>stalled?new Promise(()=>{}):r.fulfill({json:[]})});
 await expect(page.locator('[data-open]')).toBeVisible();await page.locator('[data-admin-view=photos]').click();await expect.poll(()=>calls.includes('/api/photos')).toBe(true);
 await page.clock.fastForward(61000);await expect(page.locator('[data-view=photos]')).toContainText('요청 시간이 초과');
 stalled=false;await page.locator('[data-retry-startup]').click();await expect(page.locator('[data-view=photos] h1')).toHaveText('사진 관리');
 await page.locator('[data-admin-view=articles]').click();await expect(page.locator('[data-open]')).toBeVisible();
});
test('session timeout offers retry and permits fresh sign-in',async({page})=>{
 await page.clock.install();let stalled=true,calls=0;
 await page.route('**/api/session',r=>{calls++;return stalled?new Promise(()=>{}):r.fulfill({json:{authenticated:false,user:null}});});
 await page.goto('/login/');await expect.poll(()=>calls).toBe(1);await page.clock.fastForward(31000);
 await expect(page.locator('#login-message')).toContainText('세션을 확인하지 못했습니다');await expect(page.locator('[data-google-login]')).toBeEnabled();
 stalled=false;await page.locator('#login-message button').click();await expect(page.locator('#login-message')).toBeHidden();
});
test('summary list opens full detail and lazy photo upload still has article choices',async({page})=>{
 const calls=await setup(page,'student');await expect(page.locator('[data-open]')).toBeVisible();
 await page.locator('[data-open]').click();await expect(page.locator('[data-editor]')).toHaveText('Full detail');expect(calls.filter(x=>x==='/api/native/articles/a')).toHaveLength(1);
 await page.locator('[data-open-upload]').first().click();await expect(page.locator('[name=articleSubmissionId] option')).toHaveText('Summary title');
});
