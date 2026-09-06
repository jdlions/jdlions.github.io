import {test,expect} from '@playwright/test';
async function setup(page,role='admin'){
  const article={id:'a1',native:true,studentId:'student-'+ 'long-id-'.repeat(12),titleKo:'기사 제목',titleEn:'Article',articleType:'school',draftHtml:'<p>Student original</p>',status:role==='admin'?'submitted':'draft',submittedAt:'2026-09-06T00:00:00Z',updatedAt:'2026-09-06T00:00:00Z',revisions:[]};
  const calls=[];let failSave=false,failUpload=false,uploads=0,releaseUpload;
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;calls.push({path,method:req.method(),headers:req.headers(),body:req.postData()});
    let data={};
    if(path==='/api/session')data={authenticated:true,user:{role,name:'Tester',studentId:article.studentId}};
    else if(path==='/api/native/articles')data=[article];
    else if(path==='/api/assignments')data={campaigns:[],assignments:[]};
    else if(path==='/api/photos')data=[];
    else if(path==='/api/classroom/students')data={students:[]};
    else if(path==='/api/photos/upload'){uploads++;await new Promise(r=>releaseUpload=r);if(failUpload)return route.fulfill({status:500,json:{error:{message:'Upload failed'}}});data={id:'p1',filename:'photo.png'};}
    else if(path.endsWith('/editor')){if(failSave)return route.fulfill({status:500,json:{error:{message:'Save failed'}}});const input=req.postDataJSON();Object.assign(article,{titleKo:input.titleKo,editorDraftHtml:input.contentHtml,studentFeedback:input.studentFeedback});data=article;}
    else if(path.endsWith('/status')){article.status=req.postDataJSON().status;data=article;}
    else if(path==='/api/native/articles/a1'){if(req.method()==='PATCH')Object.assign(article,req.postDataJSON());data=article;}
    else throw new Error('Unexpected API '+path);
    await route.fulfill({json:data});
  });
  await page.goto('/'+role+'/');await expect(page.locator('[data-new], [data-status-filter]').first()).toBeAttached();
  return {article,calls,fail:()=>failSave=true,failUpload:()=>failUpload=true,uploads:()=>uploads,release:()=>releaseUpload()};
}
test('admin detail binds after a dashboard visit; saves and applies status with CSRF',async({page})=>{
  const state=await setup(page);await page.locator('[data-admin-view=articles]').click();await page.locator('[data-view=articles] [data-open]').click();
  await page.locator('[data-title-ko]').fill('Updated title');await page.locator('[data-checkpoint]').click();await expect(page.locator('[data-save-state]')).toContainText('저장됨');
  await page.locator('[data-review-status]').locator('..').locator('button').first().click();await page.locator('[role=option][data-value=approved]').click();await page.locator('[data-apply]').click();await expect(page.locator('[data-review-status]')).toHaveValue('approved');
  const save=state.calls.find(x=>x.path.endsWith('/editor'));expect(save.method).toBe('PATCH');expect(save.headers['x-editorial-csrf']).toBe('1');expect(JSON.parse(save.body).titleKo).toBe('Updated title');expect(state.article.draftHtml).toBe('<p>Student original</p>');
  state.fail();await page.locator('[data-checkpoint]').click();await expect(page.locator('[data-save-state]')).toContainText('저장 실패');
});
test('dropdown overlay does not move toolbar and long IDs do not overlap dates',async({page})=>{
  await setup(page);
  for(const width of [1440,1000,390]){
    await page.setViewportSize({width,height:800});const bar=page.locator('.queue-tools');await page.locator('[data-status-filter]').locator('..').locator('button').first().scrollIntoViewIfNeeded();const before=await bar.boundingBox();
    await page.locator('[data-status-filter]').locator('..').locator('button').first().click();
    const menu=page.locator('[role=listbox]:visible');await expect(menu).toBeVisible();expect(await bar.boundingBox()).toEqual(before);expect(await menu.evaluate(e=>getComputedStyle(e).position)).toBe('fixed');
    const m=await menu.boundingBox();expect(m.y).toBeGreaterThanOrEqual(0);expect(m.y+m.height).toBeLessThanOrEqual(801);await page.keyboard.press('Escape');
    const id=await page.locator('.queue-row>span:nth-child(3)').boundingBox(),date=await page.locator('.queue-row>span:nth-child(4)').boundingBox();expect(id.x+id.width<=date.x||id.y+id.height<=date.y).toBeTruthy();
  }
});
test('student repeated submits issue one upload and recover controls',async({page})=>{
  const state=await setup(page,'student');await page.locator('[data-open-upload]').first().click();
  await page.locator('[name=files]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from('image')});await page.locator('[name=caption]').fill('caption');await page.locator('[name=photographer]').fill('name');await page.locator('[name=copyright]').check();
  await page.locator('[data-upload-form]').evaluate(form=>{for(let i=0;i<5;i++)form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));});
  await expect(page.locator('[data-upload-form]')).toHaveAttribute('aria-busy','true');await expect(page.locator('[name=files]')).toBeDisabled();expect(state.uploads()).toBe(1);state.release();await expect(page.locator('[name=files]')).toBeEnabled();await expect(page.locator('[data-upload-modal]')).not.toHaveClass(/is-open/);
});
for(const role of ['admin','student'])test(role+' browser back/forward restores view and article',async({page})=>{
  await setup(page,role);await page.locator(`[data-${role}-view=articles]`).click();await page.locator('[data-view=articles] [data-open]').click();await expect(page.locator('[data-editor]')).toBeVisible();
  await page.goBack();await expect(page.locator('[data-view=articles] [data-open]')).toBeVisible();await page.goBack();await expect(page.locator('[data-view=dashboard]')).toBeVisible();await page.goForward();await page.goForward();await expect(page.locator('[data-editor]')).toBeVisible();await page.reload();await expect(page.locator('[data-editor]')).toBeVisible();
});
test('failed upload unlocks the form and preserves the selected file for retry',async({page})=>{
  const state=await setup(page,'student');state.failUpload();await page.locator('[data-open-upload]').first().click();
  await page.locator('[name=files]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from('image')});
  await page.locator('[data-upload-form]').evaluate(form=>form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));
  await expect.poll(state.uploads).toBe(1);state.release();await expect(page.locator('[name=files]')).toBeEnabled();
  await expect(page.locator('[data-upload-modal]')).toHaveClass(/is-open/);expect(await page.locator('[name=files]').evaluate(el=>el.files.length)).toBe(1);
  await expect(page.locator('[data-toast]')).toContainText('일시적인 오류');
});
test('login restored from back-forward cache revalidates the session',async({page})=>{
  let authenticated=false;
  await page.route('**/api/session',r=>r.fulfill({json:{authenticated,user:authenticated?{role:'admin',name:'Teacher'}:null}}));
  await page.goto('/login/');await expect(page.locator('[data-google-login]')).toBeEnabled();authenticated=true;
  await page.route('**/admin/',r=>r.fulfill({body:'Authenticated admin landing'}));
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await expect(page).toHaveURL(/\/admin\//);
});

test('login with a valid session returns to the role page',async({page})=>{
  await setup(page,'student');await page.goto('/login/');await expect(page).toHaveURL(/student/);await expect(page.locator('[data-view=dashboard]')).toBeVisible();
});
test('assignment filters escape panel clipping and open upward near viewport edge',async({page})=>{
  await setup(page);await page.locator('[data-admin-view=assignments]').click();
  await page.locator('.assignment-toolbar').evaluate(el=>{el.style.marginTop='450px';});
  const trigger=page.locator('[data-assignment-type]').locator('..').locator('button').first();await trigger.scrollIntoViewIfNeeded();
  await trigger.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().bottom-innerHeight+40));
  await trigger.click();const menu=page.locator('[role=listbox]:visible');await expect(menu).toBeVisible();expect(await menu.evaluate(el=>el.parentElement===document.body)).toBe(true);expect(await menu.evaluate(el=>el.style.bottom)).not.toBe('auto');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(menu).not.toBeVisible();
});
