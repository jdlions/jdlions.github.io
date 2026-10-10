import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {pageResponse,overviewResponse} from './page-fixture.js';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=','base64');
const widths=[360,390,430,768,1440];
async function setup(page,role,width){
 await page.setViewportSize({width,height:900});
 const article={id:'a1',studentId:'s',authorName:'20624 유현승',titleKo:'학교 생활과 학생들의 이야기 '.repeat(5),articleType:'school',draftHtml:'<p>처음 작성한 원고</p>',editorDraftHtml:'<p>관리자 편집본</p>',status:role==='admin'?'submitted':'draft',updatedAt:'2026-01-01',revisions:[]};
 const campaign={id:'c',name:'120th Special Edition · 학생들의 학교 생활 이야기',year:2026,status:'active',instructions:'학교의 소식과 학생들의 이야기를 기사로 작성해 주세요.',slots:[{id:'school',articleType:'school',displayName:'학교기사'},{id:'feature',articleType:'feature',displayName:'피처기사'}],recipientStudentIds:[]};
 const assignments=['school','feature'].map((t,i)=>({id:t,campaignId:'c',studentId:'s',slotName:i?'피처기사 · 학교의 소식과 학생들의 이야기':'학교기사',slotInstructions:'PrideDesk 편집기에서 바로 작성해 제출하세요.',articleType:t,ordinal:1,articleId:'a1',articleStatus:i?'submitted':'draft',slotDueAt:i?'2026-12-31T12:00:00Z':null}));
 const students=Array.from({length:30},(_,i)=>({studentId:'s'+i,name:`${11001+i} 학생 이름 ${i===0?'아주 긴 이름':''}`}));
 await page.route('**/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname;let data=[];if(p.endsWith('/thumbnail'))return route.fulfill({body:pixel,contentType:'image/png'});
 if(p==='/api/session')data={authenticated:true,user:{role,studentId:'s',name:'20624유현승'}};
 else if(p==='/api/assignments')data={campaigns:[campaign],assignments};
 else if(p==='/api/admin/dashboard')data={assignment:{campaign,progress:[{articleType:'school',total:30,submitted:20,withPhotos:10},{articleType:'feature',total:30,submitted:10,withPhotos:4}]},editorial:{year:2026,season:'Winter',version:14,editorName:'편집장'},errors:{}};
 else if(p==='/api/admin/article-overview')data=overviewResponse(students.map((s,i)=>({...article,id:'a'+i,studentId:s.studentId,authorName:s.name})),students);
 else if(p==='/api/native/articles')data=pageResponse([article]);
 else if(p==='/api/native/articles/a1'){if(req.method()==='PATCH')article.draftHtml=req.postDataJSON().contentHtml;data=article;}
 else if(p.startsWith('/api/assignments/instances/'))data=article;
 else if(p.endsWith('/submit')){article.status='submitted';data=article;}
 else if(p.endsWith('/editor')){article.editorDraftHtml=req.postDataJSON().contentHtml;data=article;}
 else if(p==='/api/classroom/students')data={students:students.map(s=>({id:s.studentId,name:s.name}))};
 else if(p==='/api/editorial-files/projects')data=[{id:'2026_Winter',year:2026,season:'Winter'}];
 else if(p.endsWith('/editors'))data={editors:[{role:'chief',name:'편집장'},{role:'deputy',name:'부편집장'}],operatorRole:''};
 else if(p.endsWith('/settings'))data={editors:[{role:'chief',name:'편집장'},{role:'deputy',name:'부편집장'}],channelEnabled:true,channelId:'C12345678'};
 else if(p==='/api/editorial-files/projects/2026_Winter')data={year:2026,season:'Winter',latest:null,versions:[],nextBefore:null,lock:null,audit:[]};
 else if(p==='/api/photos')data=Array.from({length:6},(_,i)=>({id:'photo'+i,caption:'학교 소식을 담은 긴 사진 설명 '.repeat(5),created_at:'2026-01-01T00:00:00Z',status:'unreviewed'}));
 else if(p==='/api/publications')data=[];
 await route.fulfill({json:data});});
 await page.goto('/'+role+'/');await expect(page.locator(role==='student'?'.assignment-group':'[data-dashboard-refresh]')).toBeVisible();await page.evaluate(()=>document.fonts.ready);return article;
}
async function capture(page,info,name){await page.screenshot({path:info.outputPath(name+'.png'),fullPage:true});return page.evaluate(()=>({header:document.querySelector('.app-header').getBoundingClientRect().height,title:document.querySelector('.page-head h1')?parseFloat(getComputedStyle(document.querySelector('.page-head h1')).fontSize):null,card:document.querySelector('.assignment-group')?.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth}));}
for(const width of widths)for(const role of ['student','admin'])test(`mobile workspace ${role} ${width}`,async({page},info)=>{
 const article=await setup(page,role,width);const metrics=await capture(page,info,'home');await writeFile(info.outputPath('metrics.json'),JSON.stringify(metrics));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 if(width<=768){expect(metrics.header).toBe(56);expect(metrics.title).toBeLessThanOrEqual(27);for(const el of await page.locator('.assignment-slot-action button, [data-menu]').all()){const b=await el.boundingBox();expect(b.height).toBeGreaterThanOrEqual(44);expect(b.width).toBeGreaterThanOrEqual(44);}}
 if(width<=768){await page.locator('[data-menu]').click();await expect(page.locator('.app-sidebar')).toHaveClass(/is-open/);await expect(page.locator('.side-nav button').first()).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('[data-menu]')).toHaveAttribute('aria-expanded','false');}
 if(role==='student'){
  await page.locator('[data-assignment-open]').first().click();await expect(page.locator('[data-editor]')).toBeVisible();await page.locator('[data-editor]').fill('모바일에서 작성한 기사 원고');await page.locator('[data-tab=feedback]').click();await page.locator('[data-tab=mine]').click();await expect(page.locator('[data-editor]')).toHaveText('모바일에서 작성한 기사 원고');await page.locator('[data-save]').click();await expect(page.locator('[data-save-state]')).toContainText('저장됨');await capture(page,info,'editor');
  page.on('dialog',d=>d.accept());await page.locator('[data-submit]').click();await expect.poll(()=>article.status).toBe('submitted');
  await page.goto('/student/');if(width<=768)await page.locator('[data-menu]').click();await page.locator('[data-student-view=photos]').click();await expect(page.locator('[data-photo-thumbnail]')).toHaveCount(6);await capture(page,info,'photo-grid');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);if(width<=768)await page.locator('[data-menu]').click();await page.locator('[data-open-upload]').first().click();await expect(page.locator('[data-upload-modal]')).toBeVisible();await capture(page,info,'photo-modal');await withinViewport(page.locator('[data-upload-modal] .modal-card'),page);if(width<=768){await page.setViewportSize({width,height:500});await withinViewport(page.locator('[data-upload-modal] .modal-card'),page);const submit=page.locator('[data-upload-form]').getByRole('button',{name:'제출하기'});await submit.scrollIntoViewIfNeeded();await withinViewport(submit,page);await page.setViewportSize({width,height:900});}await page.keyboard.press('Escape');await expect(page.locator('[data-upload-modal]')).not.toBeVisible();
 }else{
  for(const view of ['articles','assignments','photos','files','editor-settings','publications']){await page.goto('/admin/#view='+view);await expect(page.locator('[data-view='+view+']')).toBeVisible();await expect(page.locator('.loading-spinner')).toHaveCount(0);await capture(page,info,view);for(const input of await page.locator('[data-view='+view+'] input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), [data-view='+view+'] select').all()){if(width<=768)expect(await input.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);}const trigger=page.locator('[data-view='+view+'] .custom-select__trigger').first();if(await trigger.count()){await trigger.click();await withinViewport(page.locator('[role=listbox]:visible'),page);await page.keyboard.press('Escape');await expect(trigger).toBeFocused();}expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);}
  await page.goto('/admin/#view=articles&article=a1');await expect(page.locator('[data-editor]')).toBeVisible();await page.locator('[data-editor]').fill('모바일 관리자 첨삭 원고');await page.locator('[data-checkpoint]').click();await expect(page.locator('[data-save-state]')).toContainText('저장됨');await capture(page,info,'review');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});

async function withinViewport(locator,page){const b=await locator.boundingBox(),v=page.viewportSize();expect(b).not.toBeNull();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(v.width+1);expect(b.y+b.height).toBeLessThanOrEqual(v.height+1);}
