import {test,expect} from '@playwright/test';
async function selectFilter(page,key,value){const input=page.locator('[data-activity-filter="'+key+'"]');await expect(input.locator('option[value="'+value+'"]')).toHaveCount(1);await input.selectOption(value);await expect(input).toHaveValue(value);}
const now='2026-11-08T00:00:00.000Z';
const data={startedAt:'2026-11-01T00:00:00.000Z',serverNow:now,students:[
 {id:'r',name:'최근 학생',active:true,lastSeenAt:'2026-11-07T00:00:00.000Z',lastActivityType:'article_submit',lastActivityAt:'2026-11-07T00:00:00.000Z',lastSubmitAt:'2026-11-07T00:00:00.000Z',lastSubmitOutcome:'success',assignedCount:1,submittedCount:1,observation:'observed'},
 {id:'o',name:'긴 이름의 학생 활동 검증 테스트 학생',active:true,lastSeenAt:'2026-11-01T00:00:00.000Z',lastErrorAt:'2026-11-07T00:00:00.000Z',lastErrorType:'server_error',assignedCount:2,submittedCount:1,observation:'observed'},
 {id:'u',name:'미확인 학생',active:true,assignedCount:1,submittedCount:0,observation:'no_login_record'}]};
for(const width of [390,820,1440])test('admin student activity route, KST, unknown history and combined filters '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/api/**',route=>{const p=new URL(route.request().url()).pathname;return route.fulfill({json:p==='/api/session'?{authenticated:true,user:{role:'admin',name:'관리자'}}:p==='/api/admin/student-activity'?data:{assignment:{campaign:null,progress:[]},editorial:null,errors:{}}});});
 await page.goto('/admin/');await expect(page.locator('[data-dashboard-refresh]')).toBeVisible();if(width<768)await page.locator('[data-menu]').click();await page.locator('[data-admin-view=student-activity]').click();await expect(page.locator('[data-view=dashboard]')).toBeHidden();await expect(page.getByRole('heading',{name:'학생 활동 현황',exact:true})).toBeVisible();
 await expect(page.locator('[data-activity-list] article')).toHaveCount(3);await expect(page.locator('[data-activity-list]')).toContainText('접속 기록 없음 · 과거 접속 여부 미확인');await expect(page.locator('[data-activity-list]')).toContainText('09:00');
 await selectFilter(page,'days','7');await expect(page.locator('[data-activity-list] article')).toHaveCount(1);
 await selectFilter(page,'error','server_error');await selectFilter(page,'missing','yes');await expect(page.locator('[data-activity-list]')).toContainText('긴 이름의 학생');
 await page.reload();await expect(page.getByRole('heading',{name:'학생 활동 현황',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:info.outputPath('student-activity.png'),fullPage:true});
});
test('activity error retry works and late response cannot overwrite another view',async({page})=>{
 let fail=true,release;const gate=new Promise(r=>release=r);let delayed=false;
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;
 if(p==='/api/session')return route.fulfill({json:{authenticated:true,user:{role:'admin',name:'관리자'}}});
 if(p==='/api/admin/student-activity'){if(delayed)await gate;return route.fulfill(fail?{status:500,json:{error:{message:'fixture'}}}:{json:data});}
 return route.fulfill({json:{members:[],cohorts:[]}});});
 await page.goto('/admin/#view=student-activity');await expect(page.locator('[data-retry-activity]')).toBeVisible();fail=false;await page.locator('[data-retry-activity]').click();await expect(page.locator('[data-activity-list] article')).toHaveCount(3);
 delayed=true;await page.locator('[data-refresh-activity]').click();await expect(page.locator('[data-activity-list]')).toHaveCount(0);await page.locator('[data-admin-view=members]').click();release();await expect(page.locator('[data-view=members]')).toBeVisible();await expect(page.locator('[data-view=student-activity]')).toBeHidden();
});
for(const hidden of [false,true])test('visible-only minimal assignment report and nonblocking failure hidden='+hidden,async({page})=>{
 if(hidden)await page.addInitScript(()=>Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true}));
 const reports=[];await page.route('**/api/**',route=>{const req=route.request(),p=new URL(req.url()).pathname;
 if(p==='/api/session')return route.fulfill({json:{authenticated:true,user:{role:'student',name:'학생',studentId:'s'}}});
 if(p==='/api/assignments')return route.fulfill({json:{campaigns:[{id:'c',name:'테스트 과제',status:'active'}],assignments:[{id:'slot',campaignId:'c',articleType:'school',slotName:'학교 기사',articleStatus:'unwritten'}]}});
 if(p==='/api/activity/assignment-view'){reports.push({method:req.method(),csrf:req.headers()['x-editorial-csrf'],body:req.postData()});return route.fulfill({status:500,json:{error:{code:'fixture'}}});}
 return route.fulfill({json:{items:[],campaigns:[],stats:{total:0,byStatus:{}},nextCursor:null}});});
 await page.goto('/student/');await expect(page.getByRole('heading',{name:'테스트 과제',exact:true})).toBeVisible();if(hidden){expect(reports).toHaveLength(0);await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true}));await page.locator('[data-student-view=articles]').click();await page.locator('[data-student-view=dashboard]').click();}await expect.poll(()=>reports.length).toBe(1);expect(reports[0]).toEqual({method:'POST',csrf:'1',body:null});await expect(page.locator('[data-assignment-open]')).toBeEnabled();await expect(page.locator('[data-admin-view=student-activity]')).toHaveCount(0);
});
