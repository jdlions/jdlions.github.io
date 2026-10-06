import {test,expect} from '@playwright/test';
import {pageResponse} from './page-fixture.js';

for(const width of [390,820,1440])for(const role of ['login','admin','student'])test('official branding '+role+' '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const images=[];
 page.on('response',r=>{if(/pridedesk-(?:logo|symbol|icon)/.test(r.url()))images.push({url:r.url(),status:r.status()});});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const data=path==='/api/session'?{authenticated:role!=='login',user:{role,studentId:'fixture',name:'Fixture'}}:path==='/api/admin/dashboard'?{assignment:{campaign:null,progress:[]},editorial:null,errors:{}}:path==='/api/assignments'?{campaigns:[],assignments:[]}:path==='/api/native/articles'?pageResponse([]):[];
  await route.fulfill({json:data});
 });
 await page.goto('/'+role+'/');
 if(role==='login')await expect(page.locator('[data-google-login]')).toBeVisible();
 else if(role==='admin')await expect(page.locator('[data-dashboard-refresh]')).toBeVisible();
 else await expect(page.locator('[data-new]')).toBeVisible();
 const logo=page.locator(role==='login'?'.login-official-logo':'.official-brand img');
 await expect(logo).toBeVisible();await expect.poll(()=>logo.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
 expect(await logo.evaluate(e=>e.currentSrc)).toContain(width<=760&&role!=='login'?'pridedesk-symbol-white.webp':'pridedesk-logo-white.webp');
 expect(await logo.evaluate(e=>getComputedStyle(e).filter)).toBe('none');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.evaluate(()=>[...document.querySelectorAll('.app-header *, .login-header *, .login-hero *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).length)).toBe(0);
 if(role!=='login')await expect(page.getByRole('link',{name:'PrideDesk 홈',exact:true})).toBeVisible();
 if(role==='admin')await expect(page.locator('.sidebar-credit a')).toHaveAttribute('href','mailto:dylanyu@outlook.kr');
 for(const size of [16,32]){const href=await page.locator('link[rel=icon][sizes="'+size+'x'+size+'"]').getAttribute('href');const r=await page.request.get(new URL(href,page.url()).href);expect(r.status()).toBe(200);expect((await r.body()).subarray(1,4).toString()).toBe('PNG');}
 expect(images.every(x=>x.status===200)).toBe(true);expect(images.some(x=>x.url.includes('pridedesk-logo.webp'))).toBe(false);
 if(role==='login'){expect(images.filter(x=>x.url.includes('pridedesk-logo-white.webp'))).toHaveLength(1);const url=await page.locator('meta[property="og:image"]').getAttribute('content');const r=await page.request.get(new URL(url).pathname);expect(r.status()).toBe(200);}
 await page.screenshot({path:info.outputPath(role+'-'+width+'.png'),fullPage:true,animations:'disabled'});
});
