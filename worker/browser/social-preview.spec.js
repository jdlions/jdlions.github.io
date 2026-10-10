import {test,expect} from '@playwright/test';
for(const ua of ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)','facebookexternalhit/1.1; kakaotalk-scrap/1.0'])test('built social preview is readable without login: '+ua,async({page,request})=>{
 const response=await request.get('/login/',{headers:{'User-Agent':ua}});expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('text/html');
 const html=await response.text(),meta=key=>html.match(new RegExp('(?:name|property)="'+key+'" content="([^"]+)"'))?.[1];
 expect(meta('og:title')).toBe("PrideDesk · The Lion's Pride");expect(meta('og:description')).toBe('중동고등학교 영자신문부 공식 기사 작성·편집 워크스페이스');expect(meta('og:url')).toBe('https://pridesk.vercel.app/');expect(meta('og:image')).toBe(meta('twitter:image'));expect(meta('robots')).toBe('noindex, nofollow');
 const url=new URL(meta('og:image'));expect(url.origin).toBe('https://pridesk.vercel.app');const image=await request.get(url.pathname,{headers:{'User-Agent':ua}});expect(image.status()).toBe(200);expect(image.headers()['content-type']).toBe('image/webp');expect((await image.body()).subarray(8,12).toString()).toBe('WEBP');
 await page.goto(url.pathname);expect(await page.locator('img').evaluate(async image=>{await image.decode();return [image.naturalWidth,image.naturalHeight];})).toEqual([1200,630]);
});
