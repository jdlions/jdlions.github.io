import {test,expect} from '@playwright/test';
async function setup(page){
 let members=[{id:'s',name:'학생 <img src=x>',email:'h2611001@joongdong.hs.kr',role:'student',studentNumber:'11001',cohort:36,active:true,linked:true,version:1,createdAt:'2026-10-01',updatedAt:'2026-10-01'}],cohorts=[36,35];const writes=[];
 await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url()),p=url.pathname;let data;
 if(p==='/api/session')data={authenticated:true,user:{role:'admin',name:'Teacher'}};
 else if(p==='/api/admin/dashboard')data={assignment:{campaign:null,progress:[]},editorial:null,errors:{}};
 else if(p==='/api/admin/cohorts'){const body=request.postDataJSON();cohorts=[body.number,...cohorts];writes.push(body);data=body;}
 else if(p.startsWith('/api/admin/members')){if(request.method()==='GET'){const q=url.searchParams.get('q')||'',role=url.searchParams.get('role');data={members:members.filter(m=>(!q||m.name.includes(q)||m.email.includes(q)||m.studentNumber?.includes(q))&&(!role||m.role===role)),cohorts};}else{const body=request.postDataJSON();writes.push(body);const id=p.split('/')[4]||'new';data={...body,id,linked:false,version:2,createdAt:'2026-10-01',updatedAt:'2026-10-02'};members=[...members.filter(m=>m.id!==id),data];}}
 else throw Error('Unexpected '+p);
 await route.fulfill({json:data});});
 await page.goto('/admin/');await expect(page.locator('[data-dashboard-refresh]')).toBeVisible();return {writes};
}
for(const width of [390,820,1440])test('members native admin navigation, registration, editing and responsive modal '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const s=await setup(page);
 if(width<768)await page.getByRole('button',{name:'메뉴 열기'}).click();await page.locator('[data-admin-view=members]').click();
 await expect(page.locator('[data-view=members]')).toBeVisible();await expect(page.locator('[data-view=dashboard]')).toBeHidden();await expect(page.locator('.member-card')).toContainText('학생 <img src=x>');await expect(page.locator('.member-card img')).toHaveCount(0);
 await page.locator('[data-new-member]').click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await dialog.locator('[name=name]').fill('새 학생');await dialog.locator('[name=email]').fill('h2621002@joongdong.hs.kr');await dialog.locator('[name=studentNumber]').fill('21002');await expect(dialog.locator('[name=cohort]')).toHaveValue('35');
 await dialog.locator('[name=cohort]').selectOption('36');await dialog.locator('[name=studentNumber]').fill('21003');await expect(dialog.locator('[name=cohort]')).toHaveValue('36');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('members-dialog.png'),animations:'disabled'});
 await dialog.getByRole('button',{name:'저장',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('.member-card')).toHaveCount(2);expect(s.writes[0].cohort).toBe('36');
 await page.locator('[data-edit-member=new]').click();await page.getByRole('dialog').locator('[name=active]').selectOption('false');await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await expect(page.locator('.member-card').filter({hasText:'새 학생'})).toContainText('비활성');
 await page.locator('[data-member-search]').fill('11001');await expect(page.locator('.member-card')).toHaveCount(1);await page.reload();await expect(page.locator('[data-view=members]')).toBeVisible();
 if(width<768)await page.getByRole('button',{name:'메뉴 열기'}).click();await page.locator('[data-admin-view=dashboard]').click();await expect(page.locator('[data-dashboard-refresh]')).toBeVisible();await page.goBack();await expect(page.locator('[data-view=members]')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('teacher form excludes cohort and supports keyboard dialog focus return',async({page})=>{
 await setup(page);await page.locator('[data-admin-view=members]').click();await expect(page.locator('.member-card')).toBeVisible();await page.locator('[data-new-member]').click();const d=page.getByRole('dialog');await d.locator('[name=role]').selectOption('teacher');await expect(d.locator('[name=cohort]')).toBeHidden();await expect(d.locator('[name=studentNumber]')).toBeDisabled();await page.keyboard.press('Escape');await expect(d).toHaveCount(0);await expect(page.locator('[data-new-member]')).toBeFocused();
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
