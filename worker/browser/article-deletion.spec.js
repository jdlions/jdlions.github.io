import {test,expect} from '@playwright/test';
async function setup(page,{status='draft',fail=false}={}){
 const calls=[];let release;
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path==='/api/session')data={authenticated:true,user:{role:'admin',name:'Teacher'}};
  else if(path==='/api/native/articles')data=[{id:'a',studentId:'student',titleKo:'고아 기사',status,draftHtml:'초안'},{id:'b',studentId:'other',titleKo:'보존 기사',status:'submitted',draftHtml:'보존'}];
  else if(path==='/api/photos')data=[];
  else if(path==='/api/classroom/students')data={students:[]};
  else if(path==='/api/assignments')data={campaigns:[],assignments:[]};
  else if(path==='/api/native/articles/a'&&req.method()==='DELETE'){
   calls.push({body:req.postDataJSON(),csrf:req.headers()['x-editorial-csrf']});
   if(fail)return route.fulfill({status:500,json:{error:{message:'삭제 실패'}}});
   await new Promise(resolve=>release=resolve);data={id:'a',deleted:true};
  }else throw new Error('Unexpected request '+req.method()+' '+path);
  await route.fulfill({json:data});
 });
 await page.goto('/admin/#view=articles');
 await page.locator('[data-delete-article=a]').click();
 return {calls,release:()=>release()};
}
for(const status of ['draft','submitted'])test(status+' exact confirmation, cancel, Escape and single request',async({page})=>{
 const state=await setup(page,{status}),dialog=page.getByRole('dialog'),input=page.getByRole('textbox',{name:'삭제 확인'}),button=page.locator('[data-delete-final]');
 await expect(dialog).toContainText('고아 기사');await expect(dialog).toContainText('Google Drive 사진 원본');await expect(dialog).toContainText('기사 ID: a');
 for(const value of ['',' ',' 삭제','삭제 ','delete','삭제\u200b']){
  await input.fill(value);await expect(button).toBeDisabled();
  await dialog.locator('form').evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 }
 expect(state.calls).toHaveLength(0);
 await input.fill('삭제');await expect(button).toBeEnabled();
 await page.getByRole('button',{name:'취소',exact:true}).click();expect(state.calls).toHaveLength(0);
 await page.locator('[data-delete-article=a]').click();await expect(input).toHaveValue('');await page.keyboard.press('Escape');expect(state.calls).toHaveLength(0);
 await page.locator('[data-delete-article=a]').click();await input.fill('삭제');
 await dialog.locator('form').evaluate(f=>{for(let i=0;i<4;i++)f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 await expect.poll(()=>state.calls.length).toBe(1);await expect(button).toBeDisabled();
 await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
 expect(state.calls[0]).toEqual({body:{confirmation:'삭제'},csrf:'1'});
 state.release();await expect(dialog).toHaveCount(0);await expect(page.locator('[data-delete-article=a]')).toHaveCount(0);await expect(page.locator('[data-delete-article=b]')).toBeVisible();
});
test('failure preserves article, resets confirmation and fits mobile',async({page})=>{
 await page.setViewportSize({width:390,height:720});const state=await setup(page,{fail:true});
 await page.getByRole('textbox',{name:'삭제 확인'}).fill('삭제');await page.locator('[data-delete-final]').click();
 await expect(page.getByRole('alert')).toContainText('삭제 실패');await expect(page.getByRole('textbox',{name:'삭제 확인'})).toHaveValue('');await expect(page.locator('[data-delete-final]')).toBeDisabled();
 const box=await page.getByRole('dialog').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await page.getByRole('button',{name:'취소',exact:true}).click();await expect(page.locator('[data-delete-article=a]')).toBeVisible();expect(state.calls).toHaveLength(1);
});

test('feature article keeps delete button after open, editor save, status change and return',async({page})=>{
 // Native Worker responses do not include the frontend-only native flag.
 const feature={id:'feature-1',studentId:'student',titleKo:'피처기사',titleEn:'Feature',articleType:'feature',status:'submitted',draftHtml:'<p>Feature body</p>',submittedAt:'2026-09-08T00:00:00Z',revisions:[]};
 const other={...feature,id:'school-1',titleKo:'보존 기사',articleType:'school'};
 const calls=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;calls.push({path,method:req.method(),body:req.postData()});let data;
  if(path==='/api/session')data={authenticated:true,user:{role:'admin',name:'Teacher'}};
  else if(path==='/api/native/articles')data=[feature,other];
  else if(path==='/api/photos')data=[];
  else if(path==='/api/assignments')data={campaigns:[],assignments:[]};
  else if(path==='/api/classroom/students')data={students:[]};
  else if(path==='/api/native/articles/feature-1/editor'){Object.assign(feature,{editorDraftHtml:req.postDataJSON().contentHtml});data=feature;}
  else if(path==='/api/native/articles/feature-1/status'){feature.status=req.postDataJSON().status;data=feature;}
  else if(path==='/api/native/articles/feature-1')data=req.method()==='DELETE'?{id:feature.id,deleted:true}:feature;
  else throw new Error('Unexpected API '+path);
  await route.fulfill({json:data});
 });
 await page.goto('/admin/#view=articles');
 await expect(page.locator('[data-delete-article=feature-1]')).toBeVisible();
 await page.locator('[data-open=feature-1]').click();
 await expect(page.locator('[data-editor]')).toBeVisible();
 await page.locator('[data-editor]').fill('Updated feature');
 await page.locator('[data-checkpoint]').click();await expect(page.locator('[data-save-state]')).toContainText('저장됨');
 await page.locator('[data-review-status]').locator('..').locator('button').first().click();
 await page.locator('[role=option][data-value=approved]').click();await page.locator('[data-apply]').click();
 await expect.poll(()=>feature.status).toBe('approved');
 await page.locator('[data-back]').click();
 await expect(page.locator('[data-delete-article=feature-1]')).toBeVisible();
 await page.locator('[data-delete-article=feature-1]').click();
 await expect(page.getByRole('dialog')).toContainText('피처기사');
 await page.getByRole('textbox',{name:'삭제 확인'}).fill('삭제 ');await expect(page.locator('[data-delete-final]')).toBeDisabled();
 expect(calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
 await page.getByRole('textbox',{name:'삭제 확인'}).fill('삭제');await page.locator('[data-delete-final]').click();
 await expect(page.locator('[data-delete-article=feature-1]')).toHaveCount(0);
 await expect(page.locator('[data-delete-article=school-1]')).toBeVisible();
 expect(calls.filter(x=>x.method==='DELETE')).toEqual([{path:'/api/native/articles/feature-1',method:'DELETE',body:JSON.stringify({confirmation:'삭제'})}]);
});
