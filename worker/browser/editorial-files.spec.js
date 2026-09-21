import {test,expect} from '@playwright/test';
import {pageResponse} from './page-fixture.js';
async function setup(page){
  const calls=[],versions=[];let baseVersion=0,fail=false;
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;calls.push({path,method:req.method(),body:req.method()==='POST'&&req.postData()?req.postDataJSON():null});
    let data=[];
    if(path==='/api/session')data={authenticated:true,user:{role:'admin',name:'Shared editor'}};
    else if(path==='/api/native/articles')data=pageResponse([]);
    else if(path==='/api/assignments')data={campaigns:[],assignments:[]};
    else if(path==='/api/editorial-files/projects')data=[{id:'2026_Winter',year:2026,season:'Winter'}];
    else if(path==='/api/editorial-files/projects/2026_Winter')data={year:2026,season:'Winter',latest:versions[0]||null,versions,nextBefore:null};
    else if(path.endsWith('/begin'))data={ticket:'ticket',baseVersion,filename:'2026_Winter_v001.af',downloadUrl:baseVersion?'/api/editorial-files/projects/2026_Winter/versions/1/download':null};
    else if(path.endsWith('/upload')){
      if(fail)return route.fulfill({status:409,json:{error:{message:'최신 버전이 변경되었습니다. 최신본을 다시 확인해 주세요.'}}});
      data={id:'upload',done:false,chunkBytes:2097152};
    }
    else if(path.endsWith('/status'))data={offset:0,done:false};
    else if(path.endsWith('/chunk'))data={offset:4,done:true};
    else if(path.endsWith('/finish')){const input=calls.findLast(x=>x.path.endsWith('/upload')).body;baseVersion++;versions.unshift({version:baseVersion,normalized_filename:`2026_Winter_v00${baseVersion}.af`,editor_name:input.editorName,change_note:input.changeNote,file_size:4,uploaded_at:'2026-09-21T12:30:00Z'});data=versions[0];}
    else if(path.endsWith('/download'))return route.fulfill({body:'file',headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="2026_Winter_v001.af"'}});
    await route.fulfill({json:data});
  });
  await page.goto('/admin/#view=files');await expect(page.getByRole('heading',{name:'편집 파일',exact:true})).toBeVisible();await expect(page.locator('[data-file-begin]')).toBeVisible();
  return {calls,versions,stale(){fail=true;}};
}
async function choose(page){await page.locator('[name=editorName]').fill('유현승');await page.locator('[name=changeNote]').fill('School 수정');await page.locator('[name=file]').setInputFiles({name:'진짜최종.af',mimeType:'application/octet-stream',buffer:Buffer.from([1,2,3,4])});}
for(const width of [390,820,1440])test('editorial files upload/history/focus at '+width,async({page},info)=>{
  await page.setViewportSize({width,height:900});const s=await setup(page);await page.locator('[data-file-begin]').click();await expect(page.locator('[data-file-baseline]')).toContainText('v000');await choose(page);
  await page.locator('[name=editorName]').focus();expect(await page.locator('[name=editorName]').evaluate(x=>getComputedStyle(x).outlineStyle)).not.toBe('none');
  await page.screenshot({path:info.outputPath('editorial-files.png'),fullPage:true});
  await page.locator('[data-version-form] button').click();await expect(page.locator('[data-file-status]')).toContainText('최신본으로 등록');await expect(page.locator('[data-file-detail]')).toContainText('2026_Winter_v001.af');
  expect(s.calls.find(x=>x.path.endsWith('/upload')).body.editorName).toBe('유현승');expect(s.calls.find(x=>x.path.endsWith('/upload')).body).not.toHaveProperty('version');
  await page.getByText('버전 기록',{exact:true}).click();await expect(page.getByRole('link',{name:'v001 다운로드'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const dl=page.waitForEvent('download');await page.locator('[data-file-begin]').click();expect((await dl).suggestedFilename()).toBe('2026_Winter_v001.af');await expect(page.locator('[data-file-baseline]')).toContainText('v001');
});
test('upload locks duplicate submission/navigation, retains file on failure and retries',async({page})=>{
  const s=await setup(page);await page.locator('[data-file-begin]').click();await choose(page);let pending;
  await page.route('**/uploads/upload/chunk',route=>{pending=route;});await page.locator('[data-version-form] button').click();await expect.poll(()=>Boolean(pending)).toBe(true);
  await expect(page.locator('[data-version-form] button')).toBeDisabled();await page.locator('[data-admin-view=articles]').click();await expect(page.locator('[data-version-form]')).toBeVisible();
  await pending.fulfill({status:502,json:{error:{message:'Drive 전송 오류. 다시 시도해 주세요.'}}});await expect(page.locator('[data-file-status]')).toContainText('Drive 전송 오류');await expect(page.locator('[data-version-form] button')).toBeEnabled();await expect(page.locator('[name=editorName]')).toHaveValue('유현승');
  await page.unroute('**/uploads/upload/chunk');await page.locator('[data-version-form] button').click();await expect(page.locator('[data-file-status]')).toContainText('최신본으로 등록');expect(s.calls.filter(x=>x.path.endsWith('/finish'))).toHaveLength(1);
});
test('no silent new baseline on reload; stale upload preserves form and error status',async({page})=>{
  const s=await setup(page);await page.locator('[data-file-begin]').click();await expect(page.locator('[data-file-baseline]')).toContainText('v000');await page.reload();await expect(page.locator('[data-file-baseline]')).toContainText('v000');expect(s.calls.filter(x=>x.path.endsWith('/begin'))).toHaveLength(1);
  s.stale();await choose(page);await page.locator('[data-version-form] button').click();await expect(page.locator('[data-file-status]')).toContainText('최신');await expect(page.locator('[name=editorName]')).toHaveValue('유현승');await expect(page.locator('[data-version-form] button')).toBeEnabled();expect(s.calls.some(x=>x.path.endsWith('/chunk'))).toBe(false);
});
test('missing editor or editing basis cannot upload; only one Affinity file is requested',async({page})=>{
  const s=await setup(page);await expect(page.locator('input[type=file]')).toHaveCount(1);await choose(page);await page.locator('[data-version-form] button').click();await expect(page.locator('[data-file-status]')).toContainText('먼저 최신본');expect(s.calls.some(x=>x.path.endsWith('/upload'))).toBe(false);
  await page.locator('[data-file-begin]').click();await page.locator('[name=file]').setInputFiles({name:'x.af',mimeType:'application/octet-stream',buffer:Buffer.from([1])});await page.locator('[data-version-form] button').click();expect(await page.locator('[name=editorName]').evaluate(x=>x.validity.valueMissing)).toBe(true);expect(s.calls.some(x=>x.path.endsWith('/upload'))).toBe(false);
});
