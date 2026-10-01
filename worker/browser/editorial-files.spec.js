import {test,expect} from '@playwright/test';
import {pageResponse} from './page-fixture.js';
async function setup(page,{initial=0}={}){
  const calls=[],versions=initial?[{version:initial,normalized_filename:`2026_Winter_v${String(initial).padStart(3,'0')}.af`,editor_role:'chief',editor_name:'유현승',change_note:'이전 작업',file_size:4,uploaded_at:'2026-09-21T12:30:00Z'}]:[];
  let baseVersion=initial,fail=false,role='',lock=null,sequence=0,notificationStatus='sent';const audit=[];
  let settings={editors:[{role:'chief',name:'유현승'},{role:'deputy',name:'김우준'}],channelEnabled:true,channelId:'C11111111'};
  const handler=async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,body=['POST','PUT'].includes(req.method())&&req.postData()&&!path.endsWith('/chunk')?req.postDataJSON():null;calls.push({path,method:req.method(),body});let data=[];
    if(path==='/api/session')data={authenticated:true,user:{role:'admin',name:'Shared editor'}};
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
  await page.setViewportSize({width:390,height:900});const s=await setup(page);await page.locator('[data-editor-settings]').click();await page.getByLabel('편집장 이름',{exact:true}).fill('새 편집장');await expect(page.getByLabel(/Slack 사용자/)).toHaveCount(0);await expect(page.locator('[name=channelId]')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.getByRole('button',{name:'설정 저장'}).click();await expect(page.locator('[data-file-status]')).toContainText('설정을 저장');const saved=s.calls.find(x=>x.path.endsWith('/settings')&&x.method==='PUT').body;expect(saved.editors).toEqual([{role:'chief',name:'새 편집장'},{role:'deputy',name:'김우준'}]);expect(saved.channelId).toBe('C11111111');expect(saved).not.toHaveProperty('dmEnabled');await operator(page);await page.locator('[data-file-begin]').click();await expect(page.locator('[data-file-baseline]')).toContainText('새 편집장');await expect(page.locator('[name=editorName]')).toHaveCount(0);await expect(page.locator('input[type=file]')).toHaveCount(1);s.failSlack();await choose(page);await page.locator('[data-version-form] button').click();await expect(page.locator('[data-file-status]')).toContainText('최신본으로 등록');await expect(page.locator('[data-file-status]')).toContainText('작업은 정상 완료');await expect(page.locator('[data-file-baseline]')).toHaveCount(0);
});
