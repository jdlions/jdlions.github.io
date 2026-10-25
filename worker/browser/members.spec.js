import {test,expect} from '@playwright/test';
async function setup(page){
 await page.clock.setFixedTime(new Date('2026-10-24T03:00:00Z'));
 let members=[{id:'s',name:'학생 <img src=x>',email:'h2611001@joongdong.hs.kr',role:'student',studentNumber:'11001',cohort:36,active:true,linked:true,version:1,createdAt:'2026-10-01',updatedAt:'2026-10-01'}],cohorts=[36,35];const writes=[];
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url()),p=url.pathname;let data;
 if(p==='/api/session')data={authenticated:true,user:{role:'admin',name:'Teacher'}};
 else if(p==='/api/admin/dashboard')data={assignment:{campaign:null,progress:[]},editorial:null,errors:{}};
 else if(p==='/api/admin/signup-code'){data=request.method()==='GET'?{configured:false,enabled:false,version:0,updatedAt:null}:{configured:true,enabled:request.postDataJSON().enabled,version:1,updatedAt:'2026-10-24',code:request.postDataJSON().code};if(request.method()!=='GET')writes.push(request.postDataJSON());}
 else if(p==='/api/admin/cohorts'){const body=request.postDataJSON();cohorts=[body.number,...cohorts];writes.push(body);data=body;}
 else if(p==='/api/admin/members/s'&&request.method()==='GET')data={member:{...members[0],grade:1,lastLoginAt:'2026-10-24',registration:'코드 가입'},counts:{articles:1,classroom:0,assignments:1,submissions:1,photos:0,editorial:0,published:0},activities:{articles:[{id:'article',title:'가상 기사 <img src=x>',status:'submitted',date:'2026'}],classroom:[],assignments:[],submissions:[],photos:[],editorial:[]},page:0,hasMore:false,legacyComplete:false,deletion:{allowed:false,state:'review',reasons:['Classroom 연결 확인 필요']}};
 else if(p.startsWith('/api/admin/members')){if(request.method()==='GET'){const q=url.searchParams.get('q')||'',role=url.searchParams.get('role');data={members:members.filter(m=>(!q||m.name.includes(q)||m.email.includes(q)||m.studentNumber?.includes(q))&&(!role||m.role===role)),cohorts};}else{const body=request.postDataJSON();writes.push(body);const id=p.split('/')[4]||'new';data={...body,id,linked:false,version:2,createdAt:'2026-10-01',updatedAt:'2026-10-02'};members=[...members.filter(m=>m.id!==id),data];}}
 else throw Error('Unexpected '+p);
 await route.fulfill({json:data});});
 await page.goto('/admin/');await expect(page.locator('[data-dashboard-refresh]')).toBeVisible();return {writes};
}
for(const width of [390,820,1440])test('members native admin navigation, registration, editing and responsive modal '+width,async({page},info)=>{
 await page.addInitScript(()=>{let saved=false,closed=false;document.addEventListener('close',()=>{closed=true;},true);const send=window.fetch.bind(window);window.fetch=(input,init)=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;if(path==='/api/admin/members'){if(init?.method==='POST'){saved=true;closed=false;}else if((!init?.method||init.method==='GET')&&saved){window.__memberReloadAfterClose=closed;saved=false;}}return send(input,init);};});
 await page.setViewportSize({width,height:900});const s=await setup(page);
 if(width<768)await page.getByRole('button',{name:'메뉴 열기'}).click();await page.locator('[data-admin-view=members]').click();
 await expect(page.locator('[data-view=members]')).toBeVisible();await expect(page.locator('[data-view=dashboard]')).toBeHidden();await expect(page.locator('.member-card')).toContainText('학생 <img src=x>');await expect(page.locator('.member-card img')).toHaveCount(0);
 await page.locator('[data-new-member]').click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.locator('[name=active]')).toHaveCount(0);
 await dialog.locator('[name=name]').fill('새 학생');await dialog.locator('[name=email]').fill('h2621002@joongdong.hs.kr');await dialog.locator('[name=studentNumber]').fill('21002');await expect(dialog.locator('[name=cohort]')).toHaveValue('35');
 await dialog.locator('[name=cohort]').selectOption('36');await dialog.locator('[name=studentNumber]').fill('21003');await expect(dialog.locator('[name=cohort]')).toHaveValue('36');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('members-dialog.png'),animations:'disabled'});
 await dialog.getByRole('button',{name:'저장',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('.member-card')).toHaveCount(2);expect(s.writes[0].cohort).toBe('36');expect(s.writes[0].active).toBe(true);expect(await page.evaluate(()=>window.__memberReloadAfterClose)).toBe(true);
 await page.locator('[data-edit-member=new]').click();await page.getByRole('dialog').locator('[name=active]').selectOption('false');await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await expect(page.locator('.member-card').filter({hasText:'새 학생'})).toContainText('비활성');
 await page.locator('[data-member-search]').fill('11001');await expect(page.locator('.member-card')).toHaveCount(1);await page.reload();await expect(page.locator('[data-view=members]')).toBeVisible();
 if(width<768)await page.getByRole('button',{name:'메뉴 열기'}).click();await page.locator('[data-admin-view=dashboard]').click();await expect(page.locator('[data-dashboard-refresh]')).toBeVisible();await page.goBack();await expect(page.locator('[data-view=members]')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('teacher form excludes cohort and supports keyboard dialog focus return',async({page})=>{
 await setup(page);await page.locator('[data-admin-view=members]').click();await expect(page.locator('.member-card')).toBeVisible();await page.locator('[data-new-member]').click();const d=page.getByRole('dialog');await d.locator('[name=role]').selectOption('teacher');await expect(d.locator('[data-teacher-warning]')).toBeVisible();await expect(d.locator('[name=cohort]')).toBeHidden();await expect(d.locator('[name=studentNumber]')).toBeDisabled();await page.keyboard.press('Escape');await expect(d).toHaveCount(0);await expect(page.locator('[data-new-member]')).toBeFocused();
});
test('member list error retry and empty search recover without stale loading',async({page})=>{
 await setup(page);let fail=true;await page.route('**/api/admin/members?**',route=>fail?route.fulfill({status:503,json:{error:{message:'회원 조회 실패'}}}):route.fulfill({json:{members:[],cohorts:[36,35]}}));
 await page.locator('[data-admin-view=members]').click();await expect(page.locator('[data-members-list]')).toContainText('회원 조회 실패');fail=false;await page.locator('[data-member-retry]').click();await expect(page.locator('[data-members-list]')).toContainText('조건에 맞는 회원이 없습니다.');await expect(page.locator('[data-members-list] .loading-spinner')).toHaveCount(0);
});
test('newer member search survives a delayed aborted response',async({page})=>{
 await setup(page);let release,started;const slow=new Promise(r=>release=r),seen=new Promise(r=>started=r);
 await page.route('**/api/admin/members?**',async route=>{const q=new URL(route.request().url()).searchParams.get('q');if(q==='old'){started();await slow;}await route.fulfill({json:{cohorts:[36,35],members:q==='new'?[{id:'latest',name:'최신 결과',email:'latest@joongdong.hs.kr',role:'teacher',active:true,linked:false,createdAt:'2026',updatedAt:'2026',version:1}]:[]}});});
 await page.locator('[data-admin-view=members]').click();await expect(page.locator('[data-member-search]')).toBeVisible();await page.locator('[data-member-search]').fill('old');await seen;await page.locator('[data-member-search]').fill('new');await expect(page.locator('.member-card')).toContainText('최신 결과');release();await expect(page.locator('[data-member-search]')).toHaveValue('new');await expect(page.locator('.member-card')).toContainText('최신 결과');await expect(page.locator('[data-members-list] .loading-spinner')).toHaveCount(0);
});

for(const year of [2027,2028])test('new academic year recommendations without stored future cohorts '+year,async({page})=>{
 await setup(page);await page.clock.setFixedTime(new Date(`${year}-03-01T00:00:00+09:00`));
 await page.locator('[data-admin-view=members]').click();await expect(page.locator('.member-card')).toBeVisible();
 await page.locator('[data-member-activity-filter]').selectOption('all');await expect(page.locator('[data-member-activity-filter]')).toHaveValue('all');
 await page.locator('[data-new-member]').click();const d=page.getByRole('dialog');
 await d.locator('[name=studentNumber]').fill('11001');await expect(d.locator('[name=cohort]')).toHaveValue(String(year-1990));
 await d.locator('[name=studentNumber]').fill('21001');await expect(d.locator('[name=cohort]')).toHaveValue(String(year-1991));
 await d.locator('[name=cohort]').selectOption('35');await d.locator('[name=studentNumber]').fill('11002');await expect(d.locator('[name=cohort]')).toHaveValue('35');
 await expect(d).toContainText('직접 입력');await expect(d.locator('[name=active]')).toHaveCount(0);
});

test('signup code settings are lazy, administrator-only and redisplay encrypted code after save',async({page})=>{
 const state=await setup(page),requests=[];page.on('request',r=>{if(r.url().includes('/api/admin/signup-code'))requests.push(r.method());});
 await page.locator('[data-admin-view=members]').click();await expect(page.locator('.member-card')).toBeVisible();expect(requests).toEqual([]);
 await page.getByText('학생 공통 가입 코드 설정',{exact:true}).click();await expect(page.locator('[data-current-code]')).toContainText('아직 코드가 없습니다');
 await page.getByRole('button',{name:'코드 변경하기'}).click();const form=page.locator('[data-signup-code-form]');await form.locator('[name=code]').fill('isolated-fixture-code');await form.locator('[name=enabled]').check();await form.getByRole('button').click();await expect(page.locator('[data-code-result]')).toHaveText('가입 코드 설정을 저장했습니다.');await expect(form.locator('[name=code]')).toHaveValue('');expect(state.writes[0].enabled).toBe(true);await expect(page.locator('[data-current-code]')).toContainText('isolated-fixture-code');
 await page.locator('[data-new-member]').click();await expect(page.getByRole('dialog').getByRole('button',{name:'Google 검색 연결'})).toHaveCount(0);await expect(page.getByRole('dialog').locator('[name=email]')).toBeEditable();
});
test('recent registrations use existing list sorting without a second membership system',async({page})=>{
 await setup(page);await page.locator('[data-admin-view=members]').click();await expect(page.locator('.member-card')).toBeVisible();const request=page.waitForRequest(r=>r.url().includes('/api/admin/members?')&&new URL(r.url()).searchParams.get('sort')==='recent');await page.locator('[data-member-sort]').selectOption('recent');await request;await expect(page.locator('.member-card')).toContainText('등록');
});

for(const width of [390,820,1440])test('member detail preserves history, blocks uncertain deletion and fits viewport '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});await setup(page);if(width<768)await page.getByRole('button',{name:'메뉴 열기'}).click();await page.locator('[data-admin-view=members]').click();if(width===390)await page.locator('.member-card p').first().click();else if(width===820)await page.locator('[data-detail-member=s]').press('Enter');else await page.locator('[data-detail-member=s]').click();const d=page.getByRole('dialog');await expect(d).toBeVisible();await expect(d.locator('#member-detail-title')).toBeInViewport();await expect(d.locator('#member-detail-title')).toBeFocused();await expect(d).toContainText('가상 기사 <img src=x>');await expect(d.locator('img')).toHaveCount(0);await expect(d.locator('[data-delete-member]')).toBeDisabled();await expect(d).toContainText('기존 학생 계정 연결 확인 필요');expect(await d.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('member-history.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(d).toHaveCount(0);await expect(page.locator('[data-detail-member=s]')).toBeFocused();
});
test('history query failure never shows delete action and retry restores the real detail',async({page})=>{
 await setup(page);let fail=true;await page.route('**/api/admin/members/s?**',async route=>{if(fail)await route.fulfill({status:503,json:{error:{message:'기록 조회 실패'}}});else await route.fallback();});await page.locator('[data-admin-view=members]').click();await page.locator('[data-detail-member=s]').click();await expect(page.getByRole('dialog')).toContainText('삭제할 수 없습니다');await expect(page.locator('[data-delete-member]')).toHaveCount(0);fail=false;await page.locator('[data-history-retry]').click();await expect(page.locator('[data-delete-member]')).toBeDisabled();
});
test('hash-only signup code is preserved and requires explicit change for display',async({page})=>{
 const state=await setup(page);await page.route('**/api/admin/signup-code',async route=>{if(route.request().method()==='GET')await route.fulfill({json:{configured:true,enabled:true,version:3,resetRequired:true}});else await route.fallback();});await page.locator('[data-admin-view=members]').click();await page.getByText('학생 공통 가입 코드 설정',{exact:true}).click();await expect(page.locator('[data-current-code]')).toContainText('기존 코드 검증은 유지됩니다');await expect(page.locator('[name=code]')).toBeHidden();expect(state.writes).toEqual([]);await page.getByRole('button',{name:'코드 변경하기'}).click();await expect(page.locator('[name=code]')).toBeFocused();
});
test('permanent delete confirmation cannot close while the single request is in flight',async({page})=>{
 await setup(page);let release,started,calls=0;const held=new Promise(r=>release=r),seen=new Promise(r=>started=r);
 await page.route('**/api/admin/members/s?**',route=>route.fulfill({json:{member:{id:'s',name:'빈 테스트 학생',email:'h2611001@joongdong.hs.kr',studentNumber:'11001',cohort:36,role:'student',active:true,linked:false,version:1,createdAt:'2026',updatedAt:'2026'},counts:{articles:0,classroom:0,assignments:0,submissions:0,photos:0,editorial:0,published:0},activities:{articles:[],classroom:[],assignments:[],submissions:[],photos:[],editorial:[]},page:0,hasMore:false,legacyComplete:true,deletion:{allowed:true,state:'eligible',reasons:[]}}}));
 await page.route('**/api/admin/members/s',async route=>{if(route.request().method()!=='DELETE')return route.fallback();calls++;started();await held;await route.fulfill({json:{id:'s',deleted:true}});});
 await page.locator('[data-admin-view=members]').click();await page.locator('[data-detail-member=s]').click();await page.locator('[data-delete-member]').click();const confirm=page.getByRole('dialog',{name:'회원 영구 삭제 확인'});await expect(confirm).toContainText('빈 테스트 학생');await expect(confirm).toContainText('h2611001@joongdong.hs.kr');await confirm.locator('input').fill('영구 삭제');await confirm.getByRole('button',{name:'영구 삭제',exact:true}).click();await seen;await page.keyboard.press('Escape');await expect(confirm).toBeVisible();await expect(confirm.getByRole('status')).toContainText('삭제 여부 확인 중');expect(calls).toBe(1);release();await expect(page.getByRole('dialog')).toHaveCount(0);
});
