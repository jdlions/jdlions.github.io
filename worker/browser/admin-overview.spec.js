import {test,expect} from '@playwright/test';
import {overviewResponse,pageResponse} from './page-fixture.js';
async function setup(page,{n=1,empty=false,partial=false}={}){
 const calls=[];const students=Array.from({length:n},(_,i)=>({id:'s'+i,name:(11001+i)+' 학생 이름 '+(i===0?'아주 긴 이름 '.repeat(4):'')}));
 const slots=[{id:'school',articleType:'school',displayName:'학교기사'},{id:'feature',articleType:'feature',displayName:'피처기사'}];
 const campaign={id:'c',name:'Current <img src=x onerror=alert(1)> Edition',status:'active',slots,recipientStudentIds:[],instructions:'실제 과제',distributedAt:'2026-01-01'};
 const assignments=empty?[]:students.flatMap((s,i)=>slots.map(slot=>({id:s.id+slot.id,campaignId:'c',studentId:s.id,studentName:s.name,slotId:slot.id,slotName:slot.displayName,articleType:slot.id,ordinal:1,articleId:slot.id==='school'?s.id+'a':null,articleStatus:slot.id==='school'?'submitted':null})));
 const articles=empty?[]:students.flatMap(s=>slots.map(slot=>({id:s.id+slot.id,studentId:s.id,authorName:s.name,titleKo:slot.displayName,articleType:slot.id,status:slot.id==='school'?'submitted':'revision_requested',draftHtml:'Body',updatedAt:'2026-01-01',assignmentName:campaign.name})));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),p=url.pathname;calls.push(p);
  let data;if(p==='/api/session')data={authenticated:true,user:{role:'admin',name:'Teacher'}};
  else if(p==='/api/admin/dashboard')data={assignment:empty?{campaign:null,progress:[]}:partial?null:{campaign,progress:slots.map(s=>({articleType:s.id,total:n,submitted:s.id==='school'?n:0,withPhotos:s.id==='school'?1:0}))},editorial:empty?null:{year:2026,season:'Winter',version:14,editorName:'Last Editor'},errors:partial?{assignment:'과제 요약 실패'}:{}};
  else if(p==='/api/assignments')data={campaigns:empty?[]:[campaign],assignments};
  else if(p==='/api/admin/article-overview')data=overviewResponse(articles,students.map(s=>({studentId:s.id,name:s.name})));
  else if(p==='/api/native/articles')data=pageResponse(articles);
  else if(p.startsWith('/api/native/articles/'))data={id:p.split('/')[4],studentId:'s0',titleKo:'Review',articleType:'school',draftHtml:'Body',status:'reviewing',internalNote:'Teacher note',revisions:[]};
  else if(p==='/api/admin/photo-students')data=empty?[]:students.flatMap(s=>slots.map(slot=>({studentId:s.id,studentName:s.name,articleType:slot.id,photoCount:slot.id==='school'?1:0,unreviewed:slot.id==='school'?1:0})));
  else if(p==='/api/admin/student-photos')data=[{id:'p',articleType:'school',filename:'Photo',caption:'Private photo',status:'unreviewed'}];
  else if(p==='/api/photos/p/thumbnail')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nAAAAABJRU5ErkJggg==','base64')});
  else if(p==='/api/classroom/students')data={students:[...students,{id:'alumni',name:'31001 졸업생'}]};
  else throw Error(p);
  return route.fulfill({json:data});
 });
 await page.goto('/admin/');await expect(page.locator('[data-dashboard-refresh]')).toBeVisible();return {calls,students};
}
for(const [width,n] of [[390,1],[820,24],[1440,100]])test('student overview workflows, credits and responsive cards '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const s=await setup(page,{n});expect(s.calls).toEqual(['/api/session','/api/admin/dashboard']);
 await expect(page.locator('.dashboard-current')).toContainText('Current <img');await expect(page.locator('.dashboard-grid img')).toHaveCount(0);await expect(page.locator('.dashboard-version')).toHaveText('v014');await expect(page.locator('.dashboard-grid')).toContainText('Last Editor');await expect(page.locator('[data-queue]')).toHaveCount(0);
 await expect(page.locator('footer.editorial-footer')).toHaveCount(0);await expect(page.locator('.sidebar-credit a')).toHaveAttribute('href','mailto:dylanyu@outlook.kr');
 await page.screenshot({path:info.outputPath('dashboard.png'),fullPage:false,animations:'disabled'});
 const nav=async name=>{if(width<768)await page.getByRole('button',{name:'메뉴 열기'}).click();await page.locator('[data-admin-view='+name+']').click();};
 await nav('assignments');await expect(page.locator('[data-assignment-card]')).toHaveCount(n);await expect(page.locator('[data-assignment-card]').first()).toContainText('학교기사');await expect(page.locator('[data-assignment-card]').first()).toContainText('피처기사');await expect(page.locator('.status-tone--pending').first()).toBeVisible();
 expect(await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>e.tagName+'.'+e.className))).toEqual([]);await page.screenshot({path:info.outputPath('student-assignments.png'),fullPage:false,animations:'disabled'});
 await page.locator('[data-assignment-card]').first().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('student-cards.png'),fullPage:false,animations:'disabled'});
 await page.locator('[data-new-assignment]').click();await expect(page.locator('[name=studentId]')).toHaveCount(n);await expect(page.getByText('31001 졸업생')).toHaveCount(0);await page.locator('[data-cancel-assignment]').click();
 await nav('articles');await expect(page.locator('[data-queue]>.student-card')).toHaveCount(n);await page.locator('[data-open]').first().press('Enter');await expect(page.locator('[data-editor]')).toBeVisible();await expect(page.locator('[data-internal]')).toHaveValue('Teacher note');await page.locator('[data-back]').click();
 await nav('photos');await expect(page.locator('[data-photo-student]')).toHaveCount(n);await expect(page.locator('[data-view=photos] img')).toHaveCount(0);expect(s.calls.some(p=>p.endsWith('/thumbnail'))).toBe(false);
 await page.locator('[data-photo-student]').first().press('Enter');await expect(page.locator('[data-photo-thumbnail]')).toBeVisible();await expect(page.locator('[data-view=photos]')).toContainText('피처기사');await expect.poll(()=>s.calls.includes('/api/photos/p/thumbnail')).toBe(true);expect(s.calls.some(p=>p.endsWith('/content'))).toBe(false);
 expect(await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>e.tagName+'.'+e.className))).toEqual([]);await page.locator('[data-photo-back]').click();await expect(page.locator('[data-photo-student]')).toHaveCount(n);
});
test('dashboard empty and partial errors preserve independent editorial summary',async({page})=>{await setup(page,{empty:true});await expect(page.locator('.dashboard-current')).toContainText('진행 중 과제 없음');await expect(page.locator('.dashboard-grid')).toContainText('편집 파일이 없습니다');await page.locator('[data-admin-view=photos]').click();await expect(page.locator('[data-view=photos]')).toContainText('학생이 없습니다');});
test('partial dashboard failure shows retry without hiding successful section',async({page})=>{await setup(page,{partial:true});await expect(page.locator('.dashboard-current')).toContainText('과제 요약 실패');await expect(page.locator('.dashboard-version')).toHaveText('v014');await expect(page.locator('[data-dashboard-refresh]')).toBeEnabled();});
test('late photo summary never overwrites dashboard and error retry clears loading',async({page})=>{await setup(page);let pending;await page.route('**/api/admin/photo-students',r=>pending=r);await page.locator('[data-admin-view=photos]').click();await expect.poll(()=>!!pending).toBe(true);await page.locator('[data-admin-view=dashboard]').click();await pending.fulfill({status:503,json:{error:{message:'Late failure'}}});await expect(page.locator('[data-dashboard-refresh]')).toBeVisible();await expect(page.getByText('Late failure')).toHaveCount(0);await page.unroute('**/api/admin/photo-students');});
