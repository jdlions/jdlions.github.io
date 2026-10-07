import {test,expect} from '@playwright/test';
import {sanitizeHtml} from '../src/security.js';
import {pageResponse,overviewResponse} from './page-fixture.js';

for(const type of ['school','feature'])test('admin counter initial/live/paste/save/reload '+type,async({page})=>{
 const state=await setup(page,{role:'admin',type,status:'reviewing',html:'<p>원문</p>'});await expectCount(page,2);
 await page.clock.install();const before=state.calls.length;await page.locator('[data-editor]').fill('A  한글');await expectCount(page,5);expect(state.calls.length).toBe(before);
 await page.locator('[data-editor]').press('ControlOrMeta+A');await paste(page,'첨삭\nEnglish');await expectCount(page,10);
 await page.clock.fastForward(1100);await expect(page.locator('[data-save-state]')).toContainText('저장됨');await page.locator('[data-checkpoint]').click();await page.reload();await expectCount(page,10);expect(state.article.draftHtml).toBe('<p>원문</p>');
});
test('admin counter changes with another article',async({page})=>{
 const state=await setup(page,{role:'admin',status:'reviewing'});await expectCount(page,5);
 const other={...state.article,id:'other',articleType:'feature',titleKo:'다른 기사',editorDraftHtml:'<p>편집  본문</p><p>123</p>'};
 await page.route('**/api/admin/article-overview',r=>r.fulfill({json:overviewResponse([state.article,other])}));await page.route('**/api/native/articles/other',r=>r.fulfill({json:other}));
 await page.locator('[data-back]').click();await page.locator('[data-open="other"]').click();await expectCount(page,10);await expect(page.locator('[data-count]')).toHaveCount(1);
});
for(const role of ['student','admin'])for(const width of [390,820,1440])test(role+' sidebar credit and counter layout '+width,async({page},info)=>{
 await page.setViewportSize({width,height:500});await setup(page,{role,status:role==='admin'?'reviewing':'draft'});
 if(await page.locator('[data-menu]').isVisible())await page.locator('[data-menu]').click();
 const credit=page.locator('.app-sidebar .sidebar-credit');await expect(credit).toContainText("© 2026 The Lion's Pride");await expect(credit.locator('strong')).toHaveText('35기 Hyunseung Yu');
 await expect(credit.locator('a')).toHaveAttribute('href','mailto:dylanyu@outlook.kr');await expect(credit.locator('a')).toContainText('Developer Contact');await expect(credit.locator('a')).toContainText('dylanyu@outlook.kr');
 await credit.locator('a').scrollIntoViewIfNeeded();const side=await page.locator('.app-sidebar').boundingBox(),foot=await credit.boundingBox(),nav=await page.locator('.side-nav').boundingBox(),logout=await page.locator('[data-logout]').boundingBox();
 expect(foot.y).toBeGreaterThanOrEqual(nav.y+nav.height);expect(foot.y).toBeGreaterThanOrEqual(logout.y+logout.height);expect(foot.y+foot.height).toBeLessThanOrEqual(side.y+side.height);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('sidebar-'+role+'-'+width+'.png')});
 if(width===390)await page.locator('[data-menu]').click();
 const editor=await page.locator('[data-editor]').boundingBox(),counter=await page.locator('[data-count]').boundingBox();expect(counter.y).toBeGreaterThanOrEqual(editor.y+editor.height);
});

async function setup(page,{role='student',type='school',html='<p>기존 원고</p>',status='draft'}={}){
  const article={id:'text-test',studentId:'student-test',authorName:'테스트 학생',native:true,articleType:type,titleKo:'테스트 기사',titleEn:'',draftHtml:html,editorDraftHtml:'',status,updatedAt:'2026-10-07T00:00:00Z',revisions:[]};
  const calls=[];
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;calls.push({path,method:req.method()});let data;
    if(path==='/api/session')data={authenticated:true,user:{role,name:'테스트 사용자',studentId:article.studentId}};
    else if(path==='/api/assignments')data={campaigns:[],assignments:[]};
    else if(path==='/api/native/articles'){
      if(req.method()==='POST'){const input=req.postDataJSON();Object.assign(article,input,{draftHtml:sanitizeHtml(input.contentHtml),status:'draft'});data=article;}else data=pageResponse([article]);
    }else if(path==='/api/admin/dashboard')data={assignment:{campaign:null,progress:[]},editorial:null,errors:{}};
    else if(path==='/api/admin/article-overview')data=overviewResponse([article]);
    else if(path.endsWith('/submit')){article.status='submitted';data=article;}
    else if(path.endsWith('/editor')){article.editorDraftHtml=sanitizeHtml(req.postDataJSON().contentHtml);data=article;}
    else if(path.endsWith('/status')){article.status=req.postDataJSON().status;data=article;}
    else if(path==='/api/native/articles/text-test'){
      if(req.method()==='PATCH'){const input=req.postDataJSON();Object.assign(article,input,{draftHtml:sanitizeHtml(input.contentHtml)});}data=article;
    }else throw new Error('Unexpected API '+path);
    await route.fulfill({json:data});
  });
  await page.goto('/'+role+'/#view=articles&article=text-test');
  await expect(page.locator('[data-editor]')).toBeVisible();
  return {article,calls};
}
async function paste(page,text,html='<span style="color:black;background:white" class="docs">ignored HTML</span>'){
  await page.locator('[data-editor]').evaluate((editor,{text,html})=>{
    editor.focus();const data=new DataTransfer();data.setData('text/plain',text);data.setData('text/html',html);
    editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  },{text,html});
}
async function expectCount(page,count){await expect(page.locator('[data-count]')).toHaveText('현재 '+count.toLocaleString('ko-KR')+'자');}

test('live character count includes spaces/newlines and Unicode graphemes without API calls',async({page})=>{
  const state=await setup(page);await page.clock.install();const requests=state.calls.length;
  for(const [text,count] of [['',0],['한글',2],['English',7],['123',3],[' ',1],['A  B',4],['A\nB',3],['한글 English 123!',15],['e\u0301 👩‍💻',3]]){
    await page.locator('[data-editor]').fill(text);await expectCount(page,count);
  }
  expect(state.calls.length).toBe(requests);
});

test('saved HTML is readable, safe, counted immediately and never updated merely by opening',async({page})=>{
  const state=await setup(page,{html:'<p><span style="color:#000;background:white" class="docs">한글  English</span><br>123</p><img src=x onerror="window.pasteXss=1"><script>window.pasteXss=1</script>'});
  await expectCount(page,15);
  await expect(page.locator('[data-editor] [style], [data-editor] [class], [data-editor] script, [data-editor] img')).toHaveCount(0);
  expect(await page.evaluate(()=>window.pasteXss)).toBeUndefined();
  expect(state.calls.some(x=>x.method==='PATCH')).toBe(false);expect(state.article.draftHtml).toContain('style=');
});

test('Docs/Word/web styled HTML paste always uses plain text, preserves paragraphs and undo',async({page})=>{
  await setup(page);const editor=page.locator('[data-editor]');
  for(const html of ['<span style="font-family:Arial;font-size:80px;color:black;background-color:white">x</span>','<b id="docs-internal-guid" class="docs" style="background:yellow">x</b>','<p class="MsoNormal"><span style="mso-highlight:yellow">x</span></p>','<script>window.pasteXss=1</script><img onerror="window.pasteXss=1" src=x>']){
    await editor.fill('old');await editor.press('ControlOrMeta+A');await paste(page,'한글  English\r\n123!',html);
    await expectCount(page,16);await expect(editor).toHaveText('한글  English123!');
    await expect(editor.locator('[style],[class],script,img')).toHaveCount(0);
    expect(await page.evaluate(()=>window.pasteXss)).toBeUndefined();
    expect(await editor.innerText()).toBe('한글  English\n123!');
  }
  await editor.press('ControlOrMeta+Z');await expect(editor).toHaveText('old');await expectCount(page,3);
});

for(const type of ['school','feature'])test(type+' paste survives autosave, tab transition, reload, manual save and submission',async({page})=>{
  const state=await setup(page,{type,status:type==='feature'?'revision_requested':'draft'});const text='학교  Feature\n두 번째 문단';
  await page.locator('[data-editor]').fill('');await paste(page,text);await expectCount(page,19);
  await page.locator('[data-tab=feedback]').click();await page.locator('[data-tab=mine]').click();
  expect(await page.locator('[data-editor]').innerText()).toBe(text);await expectCount(page,19);
  await page.locator('[data-editor]').press('End');await page.locator('[data-editor]').pressSequentially('!');await expectCount(page,20);
  await expect(page.locator('[data-save-state]')).toContainText('저장됨');
  expect(state.article.draftHtml).toContain('<br>');await page.reload();await expectCount(page,20);
  await page.locator('[data-save]').click();await expect(page.locator('[data-save-state]')).toContainText('저장됨');
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-submit]').click();
  await expect(page.locator('[data-editor]')).toHaveAttribute('contenteditable','false');await expectCount(page,20);expect(state.article.status).toBe('submitted');
});

test('long paste and partial selection preserve text and update count immediately',async({page})=>{
  await setup(page);const editor=page.locator('[data-editor]');await editor.fill('ABC');await editor.press('Home');await editor.press('Shift+ArrowRight');
  await paste(page,'한글');await expect(editor).toHaveText('한글BC');await expectCount(page,4);
  await editor.press('ControlOrMeta+A');await paste(page,'긴 원고 123! '.repeat(1000));await expectCount(page,10000);
});

test('typing Enter in a new blank article retains its paragraph and count after server sanitization',async({page})=>{
  const state=await setup(page,{html:''});await expectCount(page,0);
  const editor=page.locator('[data-editor]');await editor.pressSequentially('한글');await editor.press('Enter');await editor.pressSequentially('English');
  await expectCount(page,10);await page.locator('[data-save]').click();await expect(page.locator('[data-save-state]')).toContainText('저장됨');
  expect(state.article.draftHtml).toContain('<p>');await page.reload();await expectCount(page,10);await expect(editor).toContainText('English');
});

test('new article creation and pasted text use the existing create/save workflow',async({page})=>{
  const state=await setup(page);await page.locator('[data-back]').click();await page.locator('[data-new]').click();
  await expectCount(page,0);expect(state.calls.some(x=>x.path==='/api/native/articles'&&x.method==='POST')).toBe(true);
  await page.locator('[data-field=articleType]').selectOption('feature');await paste(page,'새 기사\nFeature');await expectCount(page,12);
  await page.locator('[data-save]').click();await expect(page.locator('[data-save-state]')).toContainText('저장됨');
  expect(state.article.articleType).toBe('feature');await page.reload();await expectCount(page,12);
});

test('admin source/editor safely render legacy styles and plain paste preserves student original',async({page})=>{
  const state=await setup(page,{role:'admin',status:'reviewing',html:'<p style="color:black;background:white">학생 원본</p>'});
  await expect(page.locator('.article-content [style],[data-editor] [style]')).toHaveCount(0);
  await page.locator('[data-editor]').fill('');await paste(page,'교사 편집\n피드백');await page.locator('[data-checkpoint]').click();
  await expect(page.locator('[data-save-state]')).toContainText('저장됨');expect(state.article.editorDraftHtml).toContain('<br>');expect(state.article.draftHtml).toContain('학생 원본');
});

for(const width of [390,820,1440])test('counter remains below editor with no overlap or overflow '+width,async({page},info)=>{
  await page.setViewportSize({width,height:900});await setup(page);await page.locator('[data-editor]').fill('한글  English');await expectCount(page,11);
  const editor=await page.locator('[data-editor]').boundingBox(),counter=await page.locator('[data-count]').boundingBox();
  expect(counter.y).toBeGreaterThanOrEqual(editor.y+editor.height);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('editor-counter-'+width+'.png'),fullPage:true});
});
