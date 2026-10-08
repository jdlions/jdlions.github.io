import {test,expect} from '@playwright/test';
import {pageResponse,overviewResponse} from './page-fixture.js';
const article={id:'a',studentId:'s',authorName:'홍길동',titleKo:'한글 기사 제목',articleType:'school',status:'draft',updatedAt:'2026-01-01T00:00:00Z'};
for(const width of [390,820,1440])for(const role of ['login','admin','student'])test(`Pretendard UI ${role} ${width}`,async({page,browserName},info)=>{
 await page.setViewportSize({width,height:900});const fontResponses=[];
 page.on('response',r=>{if(r.url().endsWith('PretendardVariable.woff2'))fontResponses.push(r);});
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;const data=p==='/api/session'?{authenticated:role!=='login',user:{role,name:'홍길동',studentId:'s'}}:p==='/api/admin/article-overview'?overviewResponse([article]):p==='/api/native/articles'?pageResponse([article]):p==='/api/assignments'?{campaigns:[],assignments:[]}:[];await route.fulfill({json:data});});
 await page.goto('/'+role+'/'+(role==='admin'?'#view=articles':''));
 if(role==='login')await expect(page.locator('[data-google-login]')).toBeVisible();else await expect(page.locator('[data-query]')).toBeVisible();
 await page.evaluate(()=>document.fonts.load('400 16px "Pretendard Variable"','한글 기사 제목'));
 expect(await page.evaluate(()=>document.fonts.check('400 16px "Pretendard Variable"','한글 기사 제목'))).toBe(true);
 expect(fontResponses.length).toBe(1);expect(fontResponses[0].status()).toBe(200);
 const family=locator=>locator.evaluate(e=>getComputedStyle(e).fontFamily.split(',')[0].trim().replaceAll('"',''));
 expect(await family(page.locator('body'))).toBe('Pretendard Variable');
 for(const selector of ['button','input','select','option','textarea','.side-nav a','.header-user']){const elements=page.locator(selector);for(let i=0;i<await elements.count();i++)expect(await family(elements.nth(i))).toBe('Pretendard Variable');}
 // Native dialog/table controls also inherit the app font, including open options.
 await page.evaluate(()=>{const d=document.createElement('dialog');d.id='font-probe';d.innerHTML='<p>한글 안내 문구</p><table><tbody><tr><td>한글 표 내용</td></tr></tbody></table><textarea>한글 입력</textarea><select><option>편집장 이름</option></select><button>닫기</button>';document.body.append(d);d.showModal();});
 for(const selector of ['#font-probe','#font-probe p','#font-probe td','#font-probe textarea','#font-probe select','#font-probe option','#font-probe button'])expect(await family(page.locator(selector))).toBe('Pretendard Variable');
 if(browserName==='chromium'){const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#font-probe p'});const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});expect(fonts.some(f=>f.isCustomFont&&f.familyName.includes('Pretendard')&&f.glyphCount>0)).toBe(true);}
 await page.evaluate(()=>document.querySelector('#font-probe').remove());
 const asset=await page.request.get(fontResponses[0].url());expect((await asset.body()).subarray(0,4).toString()).toBe('wOF2');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:info.outputPath(`font-${role}-${width}.png`),fullPage:true});
});
