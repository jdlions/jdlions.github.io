import {test,expect} from '@playwright/test';
import {pageResponse} from './page-fixture.js';
async function setup(page,{initial=0,name='Shared editor'}={}){
  const calls=[],versions=initial?[{version:initial,normalized_filename:`2026_Winter_v${String(initial).padStart(3,'0')}.af`,editor_role:'chief',editor_name:'유현승',change_note:'이전 작업',file_size:4,uploaded_at:'2026-09-21T12:30:00Z'}]:[];
  let baseVersion=initial,fail=false,role='',lock=null,sequence=0,notificationStatus='sent';const audit=[];
  let settings={editors:[{role:'chief',name:'유현승'},{role:'deputy',name:'김우준'}],channelEnabled:true,channelId:'C11111111'};
  const handler=async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,body=['POST','PUT'].includes(req.method())&&req.postData()&&!path.endsWith('/chunk')?req.postDataJSON():null;calls.push({path,method:req.method(),body});let data=[];
    if(path==='/api/session')data={authenticated:true,user:{role:'admin',name}};
    else if(path==='/api/native/articles')data=pageResponse([]);
    else if(path==='/api/assignments')data={campaigns:[],assignments:[]};
    else if(path.endsWith('/editors'))data={editors:settings.editors,operatorRole:role};
    else if(path.endsWith('/operator')){role=body.role;data={role};}
    else if(path.endsWith('/settings')){if(req.method()==='PUT')settings=body;data=settings;}
    else if(path==='/api/editorial-files/projects')data=[{id:'2026_Winter',year:2026,season:'Winter'}];
    else if(path==='/api/editorial-files/projects/2026_Winter')data={year:2026,season:'Winter',latest:versions[0]||null,versions,nextBefore:null,lock,audit};
    else if(path.endsWith('/checkout')){if(lock)return route.fulfill({status:409,json:{error:{message:'이미 편집 중입니다.'}}});const e=settings.editors.find(x=>x.role===role);lock={id:'lock-'+(++sequence),owner_role:role,owner_name:e.name,base_version:baseVersion,started_at:'2026-09-22T12:00:00Z'};data={lock,filename:versions[0]?.normalized_filename,downloadUrl:baseVersion?`/api/editorial-files/projects/2026_Winter/versions/${baseVersion}/download`:null};}
    else if(path.endsWith('/cancel')||path.endsWith('/force')){audit.push({created_at:'2026-09-22T12:30:00Z',action:path.endsWith('/force')?'forced':'cancelled',actor_role:role,actor_name:settings.editors.find(x=>x.role===role).name,owner_role:lock.owner_role,owner_name:lock.owner_name,base_version:lock.base_version,notification_status:notificationStatus});lock=null;data={closed:true,notificationStatus};}
    else if(path.endsWith('/upload')){if(fail)return route.fulfill({status:409,json:{error:{message:'편집 잠금이 종료되었습니다. 최신본을 다시 확인해 주세요.'}}});data={id:'upload',done:false,chunkBytes:2097152};}
    else if(path.endsWith('/status'))data={offset:0,done:false};
    else if(path.endsWith('/chunk'))data={offset:4,done:true};
    else if(path.endsWith('/finish')){const input=calls.findLast(x=>x.path.endsWith('/upload')).body;baseVersion++;versions.unshift({version:baseVersion,normalized_filename:`2026_Winter_v${String(baseVersion).padStart(3,'0')}.af`,editor_role:lock.owner_role,editor_name:lock.owner_name,change_note:input.changeNote,file_size:4,uploaded_at:'2026-09-22T12:30:00Z'});lock=null;data={...versions[0],notificationStatus};}
    else if(path.endsWith('/download'))return route.fulfill({body:'file',headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${versions[0].normalized_filename}"`}});
    await route.fulfill({json:data});
  };
  await page.context().route('**/api/**',handler);await page.goto('/admin/#view=files');await expect(page.locator('[data-file-begin]')).toBeVisible();
  return {calls,versions,stale(){fail=true;},failSlack(){notificationStatus='failed';},newDevice(){role='';},handler};
}
async function operator(page,role='chief'){await page.locator('[data-file-operator]').selectOption(role);await expect(page.locator('[data-file-operator]')).toBeEnabled();}
async function choose(page){await page.locator('[name=changeNote]').fill('School 수정');await page.locator('[name=file]').setInputFiles({name:'진짜최종.af',mimeType:'application/octet-stream',buffer:Buffer.from([1,2,3,4])});}
for(const width of [390,820,1440])test('editorial checkout/upload/history/focus at '+width,async({page},info)=>{
  await page.setViewportSize({width,height:900});const s=await setup(page);await expect(page.locator('[data-file-begin]')).toBeDisabled();await operator(page);await page.locator('[data-file-begin]').click();await expect(page.locator('[data-file-baseline]')).toContainText('v000');await choose(page);
  await page.locator('[name=changeNote]').focus();expect(await page.locator('[name=changeNote]').evaluate(x=>getComputedStyle(x).outlineStyle)).not.toBe('none');await page.screenshot({path:info.outputPath('editorial-files.png'),fullPage:true});
  await page.locator('[data-version-form] button').click();await expect(page.locator('[data-file-status]')).toContainText('최신본으로 등록');await expect(page.locator('[data-file-detail]')).toContainText('2026_Winter_v001.af');
  const body=s.calls.find(x=>x.path.endsWith('/upload')).body;expect(body.lockId).toBe('lock-1');for(const key of ['editorName','version','baseVersion','role','ticket'])expect(body).not.toHaveProperty(key);
  await page.getByText('버전 기록',{exact:true}).click();await expect(page.getByRole('link',{name:'v001 다운로드'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const dl=page.waitForEvent('download');await page.locator('[data-file-begin]').click();expect((await dl).suggestedFilename()).toBe('2026_Winter_v001.af');await expect(page.locator('[data-file-baseline]')).toContainText('v001');
});
test('upload locks duplicate submission/navigation, retains file on failure and retries',async({page})=>{
  const s=await setup(page);await operator(page);await page.locator('[data-file-begin]').click();await choose(page);let pending;
  await page.route('**/uploads/upload/chunk',route=>{pending=route;});await page.locator('[data-version-form] button').click();await expect.poll(()=>Boolean(pending)).toBe(true);
  await expect(page.locator('[data-version-form] button')).toBeDisabled();await page.locator('[data-admin-view=articles]').click();await expect(page.locator('[data-version-form]')).toBeVisible();
  await pending.fulfill({status:502,json:{error:{message:'Drive 전송 오류. 다시 시도해 주세요.'}}});await expect(page.locator('[data-file-status]')).toContainText('Drive 전송 오류');await expect(page.locator('[data-version-form] button')).toBeEnabled();await expect(page.locator('[name=changeNote]')).toHaveValue('School 수정');
  await page.unroute('**/uploads/upload/chunk');await page.locator('[data-version-form] button').click();await expect(page.locator('[data-file-status]')).toContainText('최신본으로 등록');expect(s.calls.filter(x=>x.path.endsWith('/finish'))).toHaveLength(1);
});
test('v14 checkout survives closed tab/new browser context and creates v15 without local storage',async({page,browser})=>{
  const s=await setup(page,{initial:14});await operator(page);const dl=page.waitForEvent('download');await page.locator('[data-file-begin]').click();expect((await dl).suggestedFilename()).toBe('2026_Winter_v014.af');await expect(page.locator('[data-file-baseline]')).toContainText('v014');await page.close();
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4173'});try{await context.route('**/api/**',s.handler);s.newDevice();const next=await context.newPage();await next.goto('/admin/#view=files');await expect(next.locator('[data-file-baseline]')).toContainText('v014');await operator(next);await expect(next.locator('[data-version-form]')).toBeVisible();expect(await next.evaluate(()=>Object.keys(sessionStorage).filter(x=>x.startsWith('editorial-edit:')))).toHaveLength(0);await choose(next);await next.locator('[data-version-form] button').click();await expect(next.locator('[data-file-detail]')).toContainText('2026_Winter_v015.af');await expect(next.locator('[data-file-baseline]')).toHaveCount(0);expect(s.calls.filter(x=>x.path.endsWith('/checkout'))).toHaveLength(1);}finally{await context.close();}
});
test('stale upload preserves form; deputy sees force warning and notification failure separately',async({page})=>{
  const s=await setup(page);await operator(page);await page.locator('[data-file-begin]').click();s.stale();await choose(page);await page.locator('[data-version-form] button').click();await expect(page.locator('[data-file-status]')).toContainText('최신본');await expect(page.locator('[name=changeNote]')).toHaveValue('School 수정');expect(s.calls.some(x=>x.path.endsWith('/chunk'))).toBe(false);
  await operator(page,'deputy');await expect(page.locator('[data-file-begin]')).toHaveCount(0);await expect(page.locator('[data-version-form]')).toHaveCount(0);s.failSlack();page.once('dialog',async d=>{expect(d.message()).toContain('반영되지 않을 수');await d.dismiss();});await page.locator('[data-file-close]').click();expect(s.calls.some(x=>x.path.endsWith('/force'))).toBe(false);
  page.once('dialog',d=>d.accept());await page.locator('[data-file-close]').click();await expect(page.locator('[data-file-status]')).toContainText('작업은 정상 완료');await expect(page.locator('[data-file-baseline]')).toHaveCount(0);await page.getByText('편집 작업 기록',{exact:true}).click();await expect(page.locator('[data-file-detail]')).toContainText('failed');
});
test('editor settings need names only and preserve the notification channel; upload needs only note/file and Slack failure is a warning',async({page})=>{
  await page.setViewportSize({width:390,height:900});const s=await setup(page);await page.locator('[data-menu]').click();await page.locator('[data-admin-view=editor-settings]').click();await expect(page).toHaveURL(/view=editor-settings/);await page.getByLabel('편집장 이름',{exact:true}).fill('새 편집장');await expect(page.getByLabel(/Slack 사용자/)).toHaveCount(0);await expect(page.locator('[name=channelId]')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.getByRole('button',{name:'설정 저장'}).click();await expect(page.locator('[data-file-status]')).toContainText('설정을 저장');const saved=s.calls.find(x=>x.path.endsWith('/settings')&&x.method==='PUT').body;expect(saved.editors).toEqual([{role:'chief',name:'새 편집장'},{role:'deputy',name:'김우준'}]);expect(saved.channelId).toBe('C11111111');expect(saved).not.toHaveProperty('dmEnabled');await page.locator('[data-menu]').click();await page.locator('[data-admin-view=files]').click();await expect(page.locator('[data-file-begin]')).toBeVisible();await operator(page);await page.locator('[data-file-begin]').click();await expect(page.locator('[data-file-baseline]')).toContainText('새 편집장');await expect(page.locator('[name=editorName]')).toHaveCount(0);await expect(page.locator('input[type=file]')).toHaveCount(1);s.failSlack();await choose(page);await page.locator('[data-version-form] button').click();await expect(page.locator('[data-file-status]')).toContainText('최신본으로 등록');await expect(page.locator('[data-file-status]')).toContainText('작업은 정상 완료');await expect(page.locator('[data-file-baseline]')).toHaveCount(0);
});
async function navigateMenu(page, view){
  if(await page.locator('[data-menu]').isVisible())await page.locator('[data-menu]').click();
  await page.locator(`[data-admin-view="${view}"]`).click();
  await expect(page).toHaveURL(new RegExp('view='+view));
}
for(const width of [390,820,1440])test('native dark options, independent settings, greeting and login layout at '+width,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const s=await setup(page,{name:'매우 긴 이름을 사용하는 공동 편집 담당자 '.repeat(5)});
  const select=page.locator('[data-file-operator]');
  await expect(page.locator('[data-editor-settings]')).toHaveCount(0);
  await expect(select.locator('option')).toHaveText(['작업자 선택','편집장 유현승','부편집장 김우준']);
  await expect.poll(()=>select.evaluate(el=>getComputedStyle(el).colorScheme)).toBe('dark');
  for(const option of await select.locator('option').all()){
    await expect(option).toHaveCSS('background-color','rgb(21, 21, 28)');
    await expect(option).toHaveCSS('color','rgb(244, 241, 233)');
  }
  // Open the browser's native picker and choose both actual operators by keyboard.
  await select.focus();await page.keyboard.press('Alt+ArrowDown');await page.screenshot({path:info.outputPath('native-options.png')});await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(select).toHaveValue('chief');await expect(select).toBeEnabled();
  await select.focus();await page.keyboard.press('Alt+ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(select).toHaveValue('deputy');await expect(select).toBeEnabled();
  await select.focus();await page.keyboard.press('Alt+ArrowDown');
  const box=await select.boundingBox();await page.mouse.move(box.x+40,box.y+box.height+45);
  await page.screenshot({path:info.outputPath('native-hover.png')});await page.keyboard.press('Escape');
  await expect(select).toHaveValue('deputy');
  await select.hover();await select.focus();expect(await select.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');
  await expect(page.locator('[data-user-greeting]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath('admin-files.png'),fullPage:true});
  await navigateMenu(page,'editor-settings');await expect(page.getByRole('heading',{name:'편집자 설정',exact:true})).toBeVisible();
  await expect(page.locator('[data-file-operator]')).toHaveCount(0);
  if(width===390)await expect(page.locator('[data-menu]')).toHaveAttribute('aria-expanded','false');
  await page.getByText('알림 채널 관리 (최초 설정)',{exact:true}).click();
  await expect(page.locator('[name=channelId]')).toHaveValue('C11111111');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath('editor-settings.png'),fullPage:true});
  expect(s.calls.filter(x=>x.path.endsWith('/settings'))).toHaveLength(1);
  await page.goBack();await expect(select).toHaveValue('deputy');
  await page.goForward();await expect(page.getByLabel('편집장 이름',{exact:true})).toHaveValue('유현승');
  await page.reload();await expect(page.getByLabel('부편집장 이름',{exact:true})).toHaveValue('김우준');
  await page.route('**/api/session',r=>r.fulfill({json:{authenticated:false}}));
  await page.goto('/login/');await expect(page.locator('.editorial-footer--login')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath('login.png'),fullPage:true});
});
test('greeting uses local time boundaries, missing names and updates without reload',async({page})=>{
  await page.clock.install({time:new Date(2026,9,2,10,59,30)});await setup(page,{name:'  편집자  '});
  await expect(page.locator('[data-user-greeting]')).toHaveText('좋은 아침이에요, 편집자님.');
  await page.clock.runFor(60000);await expect(page.locator('[data-user-greeting]')).toHaveText('오늘도 반가워요, 편집자님.');
  const values=await page.evaluate(async()=>{const {userGreeting}=await import('/assets/js/shared/shell.js');return {hours:[0,4,5,10,11,17,18,21,22,23].map(h=>userGreeting('홍길동',new Date(2026,9,2,h))),fallback:[undefined,null,'', '  '].map(n=>userGreeting(n,new Date(2026,9,2,12)))};});
  expect(values.hours).toEqual(['늦은 시간이네요','늦은 시간이네요','좋은 아침이에요','좋은 아침이에요','오늘도 반가워요','오늘도 반가워요','좋은 저녁이에요','좋은 저녁이에요','늦은 시간이네요','늦은 시간이네요'].map(x=>x+', 홍길동님.'));
  expect(values.fallback).toEqual(Array(4).fill('오늘도 반가워요.'));
});
test('independent settings retries load/save failures and blocks navigation during save',async({page})=>{
  await setup(page);let fail=true,pending;
  await page.route('**/editorial-files/settings',async r=>{
    if(r.request().method()==='PUT'){pending=r;return;}
    if(fail)return r.fulfill({status:503,json:{error:{message:'설정 조회 실패'}}});
    return r.fallback();
  });
  await navigateMenu(page,'editor-settings');await expect(page.getByText('설정 조회 실패')).toBeVisible();
  fail=false;await page.getByRole('button',{name:'다시 시도'}).click();await page.getByLabel('편집장 이름',{exact:true}).fill('변경 이름');
  await page.getByRole('button',{name:'설정 저장'}).click();await expect.poll(()=>Boolean(pending)).toBe(true);
  await page.locator('[data-admin-view=files]').click();await expect(page).toHaveURL(/view=editor-settings/);
  await pending.fulfill({status:503,json:{error:{message:'설정 저장 실패'}}});
  await expect(page.locator('[data-file-status]')).toHaveText('설정 저장 실패');await expect(page.getByLabel('편집장 이름',{exact:true})).toHaveValue('변경 이름');
  await expect(page.getByRole('button',{name:'설정 저장'})).toBeEnabled();
});
