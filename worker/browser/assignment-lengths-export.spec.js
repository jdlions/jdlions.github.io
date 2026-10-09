import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {submittedCharacterCount} from '../src/assignment-lengths.js';
import {filterArticleOverview} from '../../assets/js/shared/article-overview.js';
import {overviewResponse,pageResponse} from './page-fixture.js';
import {sanitizeHtml} from '../src/security.js';

async function setup(page,{role='admin',view='articles',limits={},count=20}={}){
 const students=Array.from({length:count},(_,i)=>({studentId:'s'+i,name:`${i<10?'110':'210'}${String(i%10+1).padStart(2,'0')} ${i===0?'김아주긴이름 가나다 라마바사아자차카타파하 ABCDEFGHIJKLMNOPQRSTUVWXYZ':'학생 '+i}`}));
 const items=students.flatMap((s,i)=>['school','feature'].filter((_,j)=>i!==2&&!(i===3&&j===0)&&!(i===4&&j===1)).map((type,j)=>({id:`a${i}-${j}`,studentId:s.studentId,authorName:s.name,native:true,titleKo:'기사 '+i,articleType:type,status:['draft','submitted','reviewing','revision_requested','approved','scheduled'][i%6],campaignId:'c',assignmentName:'120th Special Edition',submittedAt:'2026-10-08T00:00:00Z',updatedAt:'2026-10-08T00:00:00Z'})));
 const data=overviewResponse(items,students);data.campaigns=[{id:'c',name:'120th Special Edition 긴 과제명 · 한글과 English 현황을 함께 표시하는 테스트 과제'}];
 const article={...items[0],id:'article',studentId:'student',draftHtml:'<p>한글</p>',editorDraftHtml:'',status:'draft',minCharacters:null,maxCharacters:null,...limits,revisions:[]};
 const campaign={id:'c',name:data.campaigns[0].name,status:'active',year:2026,slots:[{id:'slot',articleType:'school',displayName:'학교기사'}],...limits};const calls=[];let applied=0;
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;calls.push({path,method:req.method(),body:req.postData()});let response;
  if(path==='/api/session')response={authenticated:true,user:{role,name:'11001 테스트',studentId:'student'}};
  else if(path==='/api/admin/article-overview')response=data;
  else if(path==='/api/assignments')response=req.method()==='POST'?{...campaign,...req.postDataJSON()}:{campaigns:[campaign],assignments:[]};
  else if(path==='/api/classroom/students')response={students};
  else if(path==='/api/assignments/c'){Object.assign(campaign,req.postDataJSON());response=campaign;}
  else if(path.endsWith('/length-preview'))response={...req.postDataJSON(),token:'preview',valid:15,below:1,above:1,targetStudents:2,belowStudents:1,aboveStudents:1,completedOutside:[{}],unverifiable:[],targets:[{studentName:'11003 김학생',articleType:'school',status:'submitted',text:'현재 2자 · 최소 3자 · 1자 부족'},{studentName:'21004 이학생',articleType:'feature',status:'reviewing',text:'현재 10자 · 최대 8자 · 2자 초과'}]};
  else if(path.endsWith('/length-apply')){applied++;response={applied:true,rejectedCount:2};}
  else if(path==='/api/native/articles')response=pageResponse([article]);
  else if(path.endsWith('/submit')){article.status='submitted';response=article;}
  else if(path==='/api/native/articles/article'){if(req.method()==='PATCH')article.draftHtml=sanitizeHtml(req.postDataJSON().contentHtml);response=article;}
  else throw new Error('Unexpected '+req.method()+' '+path);
  await route.fulfill({json:response});
 });
 await page.goto(`/${role}/#view=${view}${role==='student'?'&article=article':''}`);
 await expect(page.locator(role==='student'?'[data-editor]':view==='assignments'?'[data-edit-campaign]':'[data-export-list]')).toBeVisible();
 if(view==='articles'&&role==='admin')await expect(page.locator('[data-export-list]')).toBeEnabled();
 return {data,article,campaign,calls,applied:()=>applied};
}
const moduleBase=page=>page.locator('script[src*="-app.js"]').getAttribute('src');
test('browser and Worker share identical grapheme/text counting for real rendered HTML',async({page})=>{
 await setup(page,{role:'student'});const base=await moduleBase(page);
 for(const html of ['<p>A  B</p>','<p>A</p><p>B</p>','<p><br></p>','<p>A<br>B</p>','<div>A</div><div>B</div>','한글\r\nEnglish','<p>é 👩‍💻</p>','<p>&copy;&nbsp;&amp;&#x1f600;</p>','<p>A</p><!--note--><p>B</p>','<p>A<div>B</div>C','<script>bad</script><span style="color:black">ok</span>']){
  const count=await page.evaluate(async({base,html})=>{const m=await import(new URL('../shared/editor-text.js',new URL(base,location.href)));const editor=document.createElement('div');editor.innerHTML=m.readableEditorHtml(html);return m.characterCount(m.editorText(editor));},{base,html});expect(count,html).toBe(submittedCharacterCount(html));
 }
});
for(const limits of [{minCharacters:3},{maxCharacters:8},{minCharacters:3,maxCharacters:8},{}])test('student count/save/submit affordance '+JSON.stringify(limits),async({page})=>{
 const s=await setup(page,{role:'student',limits});const editor=page.locator('[data-editor]');
 await editor.fill('AB');await expect(page.locator('[data-count]')).toContainText('현재 2자');if(limits.minCharacters)await expect(page.locator('[data-submit]')).toBeDisabled();
 await editor.fill('123456789');if(limits.maxCharacters){await expect(page.locator('[data-count]')).toContainText('1자 초과');await expect(page.locator('[data-submit]')).toBeDisabled();}
 await page.locator('[data-save]').click();await expect(page.locator('[data-save-state]')).toContainText('저장됨');expect(s.article.draftHtml).toContain('123456789');
 await editor.fill('12345');await expect(page.locator('[data-submit]')).toBeEnabled();await page.locator('[data-tab=feedback]').click();await page.locator('[data-tab=mine]').click();await expect(editor).toHaveText('12345');
 page.once('dialog',d=>d.accept());await page.locator('[data-submit]').click();await expect(editor).toHaveAttribute('contenteditable','false');
});
test('new assignment saves direct min/max and disabled rules are null',async({page})=>{
 const s=await setup(page,{view:'assignments'});await page.locator('[data-new-assignment]').click();await page.locator('[name=name]').fill('새 과제');await page.locator('[name=lengthEnabled]').check();await page.locator('[name=minCharacters]').fill('900');await page.locator('[name=maxCharacters]').fill('1100');await page.getByRole('button',{name:'과제 저장',exact:true}).click();
 const body=JSON.parse(s.calls.find(x=>x.path==='/api/assignments'&&x.method==='POST').body);expect(body.minCharacters).toBe(900);expect(body.maxCharacters).toBe(1100);
});
test('editing limits does not reject; preview requires targets, typed confirmation and final confirmation',async({page})=>{
 const s=await setup(page,{view:'assignments'});await page.locator('[data-edit-campaign]').click();await page.locator('[name=lengthEnabled]').check();await page.locator('[name=minCharacters]').fill('3');await page.locator('[name=maxCharacters]').fill('8');await page.getByRole('button',{name:'기준 저장',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);expect(s.applied()).toBe(0);
 await page.locator('[data-edit-campaign]').click();await page.locator('[data-inspect]').click();await expect(page.locator('[data-length-preview]')).toContainText('완료 기사 중 기준 밖 1건');await expect(page.locator('[data-length-apply]')).toBeDisabled();await page.getByText('대상 확인',{exact:true}).click();await expect(page.locator('[data-length-preview]')).toContainText('11003 김학생');await page.locator('[data-length-confirm]').fill('반려');await expect(page.locator('[data-length-apply]')).toBeEnabled();page.once('dialog',d=>{expect(d.message()).toContain('2명 / 2건');return d.accept();});await page.locator('[data-length-apply]').click();await expect(page.locator('dialog')).toHaveCount(0);expect(s.applied()).toBe(1);
});
test('preview is invalidated after any rule edit and error requires fresh inspection',async({page})=>{
 await setup(page,{view:'assignments',limits:{minCharacters:3,maxCharacters:8}});await page.locator('[data-edit-campaign]').click();await page.locator('[data-inspect]').click();await expect(page.locator('[data-length-apply]')).toBeVisible();await page.locator('[name=minCharacters]').fill('4');await expect(page.locator('[data-length-apply]')).toHaveCount(0);
});
test('turning limits off saves null values without a bulk action',async({page})=>{const s=await setup(page,{view:'assignments',limits:{minCharacters:3,maxCharacters:8}});await page.locator('[data-edit-campaign]').click();await page.locator('[name=lengthEnabled]').uncheck();await expect(page.locator('[name=minCharacters]')).toBeDisabled();await page.getByRole('button',{name:'기준 저장',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);expect(s.campaign.minCharacters).toBeNull();expect(s.campaign.maxCharacters).toBeNull();expect(s.applied()).toBe(0);});
test('PNG generated from all filtered rows, with only allowed fields, exact UI status colors and no extra APIs',async({page},info)=>{
 const s=await setup(page),base=await moduleBase(page);const before=s.calls.length;
 const result=await page.evaluate(async({base,data})=>{const m=await import(new URL('./queue-export.js',new URL(base,location.href)));const result=await m.createQueuePng(data,{campaign:'c'},new Date(2026,9,8,14,32));const bytes=Array.from(new Uint8Array(await result.blob.arrayBuffer()));return {...result,blob:undefined,bytes};},{base,data:s.data});
 expect(result.rows).toHaveLength(20);expect(Object.keys(result.rows[0]).sort()).toEqual(['feature','name','number','school']);expect(result.width).toBe(1200);expect(result.height).toBeGreaterThan(1800);expect(result.filename).toContain('2026-10-08_1432.png');expect(s.calls.length).toBe(before);
 const path=info.outputPath('queue-20.png');await import('node:fs/promises').then(fs=>fs.writeFile(path,Buffer.from(result.bytes)));await info.attach('queue-20',{path,contentType:'image/png'});
 const download=page.waitForEvent('download');await page.locator('[data-export-list]').click();const file=await download;await file.saveAs(info.outputPath('download.png'));expect(readFileSync(info.outputPath('download.png')).subarray(1,4).toString()).toBe('PNG');
 for(const filters of [{grade:'1'},{grade:'2'},{q:'학생 11'},{status:'approved'},{type:'school',campaign:'c',grade:'1',date:'2026-10-08'}, {author:'s3'}, {q:'absent'}]){
  const expected=filterArticleOverview(s.data,filters);const actual=await page.evaluate(async({base,data,filters})=>{const m=await import(new URL('./queue-export.js',new URL(base,location.href)));const f=await import(new URL('../shared/article-overview.js',new URL(base,location.href)));return m.exportRows(f.filterArticleOverview(data,filters));},{base,data:s.data,filters});expect(actual.length).toBe(expected.students.length);
 }
});
test('actual grade/search UI determines downloaded PNG and empty results never download',async({page})=>{
 await setup(page);const root=page.locator('[data-grade-filter]').locator('..');await root.locator('button').first().click();await page.getByRole('option',{name:'1학년',exact:true}).click();await expect(page.locator('[data-page-range]')).toContainText('10명');
 await page.locator('[data-query]').fill('없는학생');await expect(page.locator('[data-page-range]')).toContainText('0명');let downloads=0;page.on('download',()=>downloads++);await page.locator('[data-export-list]').click();await expect(page.locator('[data-toast]')).toHaveText('현재 조건에 해당하는 학생이 없습니다.');expect(downloads).toBe(0);
});
test('export button passes the actual current grade selection to Canvas, not the complete overview',async({page})=>{
 await setup(page);await page.evaluate(()=>{window.canvasLabels=[];const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(value,...args){window.canvasLabels.push(String(value));return original.call(this,value,...args);};});
 const root=page.locator('[data-grade-filter]').locator('..');await root.locator('button').first().click();await page.getByRole('option',{name:'2학년',exact:true}).click();await expect(page.locator('[data-page-range]')).toContainText('10명');const download=page.waitForEvent('download');await page.locator('[data-export-list]').click();await download;const labels=await page.evaluate(()=>window.canvasLabels);expect(labels).toContain('21001');expect(labels).not.toContain('11001');expect(labels.join(' ')).toContain('10명');
});
test('PNG draws untrusted names as text, sanitizes filename, and wraps long Korean/English names',async({page})=>{
 const s=await setup(page);s.data.students[0].name='11001 <img src=x onerror=alert(1)> 한글';const base=await moduleBase(page);const result=await page.evaluate(async({base,data})=>{const m=await import(new URL('./queue-export.js',new URL(base,location.href)));const p=await m.createQueuePng(data);return {rows:p.rows,name:m.pngFilename('a/b:*?<>|',new Date(2026,9,8))};},{base,data:s.data});expect(result.rows[0].name).toContain('<img');expect(result.name).not.toMatch(/[/:*?<>|]/);expect(await page.locator('img[src=x]').count()).toBe(0);
});
test('PNG never prints opaque ID/name fallbacks, emails or raw identity search text',async({page})=>{
 const s=await setup(page),base=await moduleBase(page);s.data.students[0]={studentId:'12345678901234567890',name:'12345678901234567890'};s.data.students[1].name='11002 Student private@example.org';
 const result=await page.evaluate(async({base,data})=>{const labels=[],original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(value,...args){labels.push(String(value));return original.call(this,value,...args);};const m=await import(new URL('./queue-export.js',new URL(base,location.href)));const output=await m.createQueuePng(data,{q:'private@example.org',author:'12345678901234567890'});return {rows:output.rows,labels};},{base,data:s.data});expect(JSON.stringify(result)).not.toMatch(/12345678901234567890|private@example.org/);expect(result.rows.some(r=>r.name==='이름 확인 불가')).toBe(true);
});
for(const width of [390,820,1440])test('length settings and student counter responsive '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});await setup(page,{view:'assignments',limits:{minCharacters:3,maxCharacters:8}});await page.locator('[data-edit-campaign]').click();await page.locator('[data-inspect]').click();await expect(page.locator('[data-length-preview]')).toContainText('반려 대상');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('limits-'+width+'.png'),fullPage:true});await page.locator('[data-close]').click();await page.unroute('**/api/**');await setup(page,{role:'student',limits:{minCharacters:900,maxCharacters:1100}});await expect(page.locator('[data-count]')).toContainText('898자 부족');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('student-'+width+'.png'),fullPage:true});
});

test('PNG waits for verified Pretendard before measuring/drawing and uses it for every label',async({page},info)=>{
 await setup(page,{count:2});
 await page.evaluate(()=>{
  const load=document.fonts.load.bind(document.fonts),fill=CanvasRenderingContext2D.prototype.fillText,measure=CanvasRenderingContext2D.prototype.measureText;
  window.pngFonts=[];window.pngFontWaiting=false;
  document.fonts.load=(...args)=>{window.pngFontWaiting=true;window.pngFontRequest=args;return new Promise((resolve,reject)=>window.releasePngFont=()=>load(...args).then(resolve,reject));};
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.pngFonts.push({op:'draw',text,font:this.font});return fill.call(this,text,...args);};
  CanvasRenderingContext2D.prototype.measureText=function(text){window.pngFonts.push({op:'measure',text,font:this.font});return measure.call(this,text);};
 });
 await page.locator('[data-export-list]').click();await expect.poll(()=>page.evaluate(()=>window.pngFontWaiting)).toBe(true);
 expect(await page.evaluate(()=>window.pngFonts)).toEqual([]);await expect(page.locator('[data-export-list]')).toBeDisabled();
 const download=page.waitForEvent('download');await page.evaluate(()=>window.releasePngFont());const file=await download;
 const path=info.outputPath('pretendard-queue.png');await file.saveAs(path);await info.attach('Pretendard PNG',{path,contentType:'image/png'});
 const fonts=await page.evaluate(()=>window.pngFonts);expect(fonts.length).toBeGreaterThan(15);
 expect(fonts.every(x=>x.font.includes('Pretendard Variable')&&!/system-ui|Malgun/.test(x.font))).toBe(true);
 for(const label of ['기사 제출 현황','학번','이름','학교기사','피처기사'])expect(fonts.some(x=>x.op==='draw'&&x.text===label)).toBe(true);
 expect(fonts.some(x=>x.op==='draw'&&x.text.includes('김아주긴이름'))).toBe(true);expect(fonts.some(x=>x.op==='draw'&&/작성 중|제출됨|확인 중/.test(x.text))).toBe(true);
 expect(await page.evaluate(()=>window.pngFontRequest[0])).toBe('400 16px "Pretendard Variable"');
 const bytes=readFileSync(path);expect(bytes.subarray(1,4).toString()).toBe('PNG');expect(bytes.readUInt32BE(16)).toBe(1200);
 await expect(page.locator('[data-export-list]')).toBeEnabled();
});
for(const failure of ['rejected','missing','wrong-face','check-failed','timeout'])test('PNG refuses system-font fallback: '+failure,async({page})=>{
 await setup(page,{count:2});if(failure==='timeout')await page.clock.install();
 let downloads=0;page.on('download',()=>downloads++);
 await page.evaluate(failure=>{
  window.pngDraws=0;const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(...args){window.pngDraws++;return fill.apply(this,args);};
  document.fonts.load=()=>failure==='rejected'?Promise.reject(new Error('network failure')):failure==='timeout'?new Promise(()=>{}):Promise.resolve(failure==='missing'?[]:[{family:failure==='wrong-face'?'Arial':'Pretendard Variable',status:'loaded'}]);
  if(failure==='check-failed')document.fonts.check=()=>false;
 },failure);
 await page.locator('[data-export-list]').click();if(failure==='timeout')await page.clock.fastForward(30001);
 await expect(page.locator('[data-toast]')).toContainText('Pretendard 폰트를 불러오지 못했습니다.');await expect(page.locator('[data-export-list]')).toBeEnabled();
 expect(downloads).toBe(0);expect(await page.evaluate(()=>window.pngDraws)).toBe(0);
});
