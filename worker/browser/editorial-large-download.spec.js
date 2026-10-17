import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
const total=Number(process.env.EDITORIAL_LARGE_DOWNLOAD_BYTES||64*1024*1024),chunk=Buffer.alloc(2*1024*1024,42);
test('large private download streams bounded ranges to disk with original filename',async({page,context})=>{
 const ranges=[];
 await context.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/download-info'))return route.fulfill({json:{filename:'패키지 원본.zip',size:total}});
  if(p.endsWith('/download')){
   const range=route.request().headers().range,m=/^bytes=(\d+)-(\d+)$/.exec(range);expect(m).not.toBeNull();const start=Number(m[1]),end=Number(m[2]);ranges.push([start,end]);if(ranges.length===1)return route.fulfill({status:503,body:'temporary failure'});expect(end-start+1).toBeLessThanOrEqual(chunk.length);
   return route.fulfill({status:206,headers:{'Content-Type':'application/octet-stream','Content-Range':`bytes ${start}-${end}/${total}`},body:chunk.subarray(0,end-start+1)});
  }
  return route.fulfill({json:{authenticated:false}});
 });
 await page.goto('/login/');await page.evaluate(()=>{window.downloadErrors=[];navigator.serviceWorker.addEventListener('message',e=>window.downloadErrors.push(e.data));});
 const waiting=page.waitForEvent('download');
 await page.evaluate(async size=>{const css=document.querySelector('link[href*="editorial.css"]').href;const {downloadEditorial}=await import(css.replace('css/editorial.css','js/shared/editorial-download.js'));await downloadEditorial('/api/editorial-files/projects/2026_Winter/versions/1/download','패키지 원본.zip',size);},total);
 const download=await waiting;expect(download.suggestedFilename()).toBe('패키지 원본.zip');const failure=await download.failure();if(failure)console.log('DOWNLOAD_DIAGNOSTIC',failure,ranges,await page.evaluate(()=>window.downloadErrors));const path=await download.path();expect(await download.failure()).toBeNull();expect((await stat(path)).size).toBe(total);
 const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);
 const expected=createHash('sha256');for(let i=0;i<total;i+=chunk.length)expected.update(chunk.subarray(0,Math.min(chunk.length,total-i)));expect(hash.digest('hex')).toBe(expected.digest('hex'));
 await expect(page).toHaveURL(/\/login\//);
 for(const [i,range] of ranges.slice(1).entries())expect(range).toEqual([i*chunk.length,Math.min((i+1)*chunk.length,total)-1]);
 expect(ranges).toHaveLength(Math.ceil(total/chunk.length)+1);expect(ranges[1][0]).toBe(0);expect(ranges[0][0]).toBe(0);expect(ranges.at(-1)[1]).toBe(total-1);
 expect(await page.evaluate(()=>caches.keys())).toEqual([]);
 const registrations=await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).map(r=>r.scope));expect(registrations).toEqual([new URL('/editorial-download/',page.url()).href]);
});


test('unauthorized large download remains on the UI and never registers a worker or exposes a file',async({page,context})=>{
 await context.route('**/api/**',r=>r.fulfill({status:401,json:{error:{message:'로그인이 필요합니다.',code:'authentication_required'}}}));await page.goto('/login/');const downloads=[];page.on('download',d=>downloads.push(d));
 const error=await page.evaluate(async()=>{const css=document.querySelector('link[href*="editorial.css"]').href;const {downloadEditorial}=await import(css.replace('css/editorial.css','js/shared/editorial-download.js'));try{await downloadEditorial('/api/editorial-files/projects/2026_Winter/versions/1/download','private.zip',64*1024*1024);}catch(e){return e.message;}});
 expect(error).toContain('로그인');expect(downloads).toHaveLength(0);expect(await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);await expect(page).toHaveURL(/\/login\//);
});
