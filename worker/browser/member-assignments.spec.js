import {test,expect} from '@playwright/test';
for(const width of [390,820,1440])test('pre-login member can be selected and distributed without Google ID '+width,async({page})=>{
 await page.setViewportSize({width,height:900});let campaign=null;const writes=[];
 await page.route('**/api/**',async route=>{const r=route.request(),path=new URL(r.url()).pathname;let data;
 if(path==='/api/session')data={authenticated:true,user:{role:'admin',name:'교사'}};
 else if(path==='/api/assignments'){if(r.method()==='POST'){writes.push(r.postDataJSON());campaign={...r.postDataJSON(),id:'pending',status:'draft',pendingRecipientCount:0};data=campaign;}else data={campaigns:campaign?[campaign]:[],assignments:[]};}
 else if(path==='/api/members/roster')data={students:[{id:'member:registered-student',memberId:'registered-student',name:'11001 사전등록 학생',studentNumber:'11001',cohort:36}]};
 else if(path==='/api/assignments/pending/distribute'){writes.push(r.postDataJSON());Object.assign(campaign,{status:'active',distributedAt:'2026-10-23',pendingRecipientCount:1});data=campaign;}
 else throw Error('Unexpected '+path);
 await route.fulfill({json:data});});
 await page.goto('/admin/#view=assignments');await page.locator('[data-new-assignment]').click();
 await expect(page.locator('.student-picker')).toContainText('11001 사전등록 학생');
 await page.locator('[name=name]').fill('로그인 전 과제');await page.locator('[name=audienceMode][value=selected]').check();
 await page.locator('[name=studentId]').check();await page.getByRole('button',{name:'과제 저장',exact:true}).click();
 await expect(page.locator('[data-distribute=pending]')).toBeVisible();expect(writes[0].recipientStudentIds).toEqual(['member:registered-student']);
 page.once('dialog',d=>d.accept());await page.locator('[data-distribute=pending]').click();
 await expect(page.locator('[data-view=assignments]')).toContainText('최초 로그인 연결 대기 1명');
 expect(writes[1].studentIds).toEqual(['member:registered-student']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
