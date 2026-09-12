import {test,expect} from '@playwright/test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {articleListOptions,listArticlePage} from '../src/article-list.js';

async function setup(page,role='admin'){
 const sql=new DatabaseSync(':memory:');
 for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 for(let i=0;i<65;i++)sql.prepare('INSERT INTO articles(id,student_id,article_type,title_ko,status,draft_html,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('a'+String(i).padStart(3,'0'),'s','school','Title '+i,i%2?'hold':'draft','<p>Full body</p>','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
 const calls=[];let delayed,release;
 const db={prepare(q){let args=[];return {bind(...a){args=a;return this;},async all(){return {results:sql.prepare(q).all(...args)};}};}};
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;calls.push(url);
  if(path==='/api/session')return route.fulfill({json:{authenticated:true,user:{role,studentId:'s',name:'Test'}}});
  if(path==='/api/native/articles'){
   const data=await listArticlePage(db,articleListOptions(url.searchParams,role==='student'?'s':null),role==='student'?'s':null);
   if(url.searchParams.get('q')===delayed)await new Promise(r=>release=r);
   return route.fulfill({json:data}).catch(()=>{});
  }
  if(path.startsWith('/api/native/articles/'))return route.fulfill({json:{id:path.split('/').at(-1),studentId:'s',titleKo:'Detail title',status:'hold',articleType:'school',draftHtml:'<p>Full body</p>',revisions:[]}});
  return route.fulfill({json:path==='/api/assignments'?{campaigns:[],assignments:[]}:[]});
 });
 await page.goto('/'+role+'/#view=articles');await expect(page.locator('[data-open]')).toHaveCount(20);
 return {calls,sql,delay:q=>delayed=q,release:()=>release?.()};
}
test('admin pages retain filters and cursor through detail, stats are not repeated',async({page})=>{
 const s=await setup(page);await expect(page.locator('[data-page-range]')).toHaveText('1–20 / 65');
 await page.locator('[data-page-next]').click();await expect(page.locator('[data-page-range]')).toHaveText('21–40 / 65');
 const first=await page.locator('[data-open]').first().getAttribute('data-open');
 await page.locator('[data-open]').first().click();await expect(page.locator('[data-editor]')).toHaveText('Full body');
 await page.locator('[data-back]').click();await expect(page.locator('[data-page-range]')).toHaveText('21–40 / 65');expect(await page.locator('[data-open]').first().getAttribute('data-open')).toBe(first);
 await page.locator('[data-student-filter]').fill('missing');await expect(page.locator('[data-page-range]')).toHaveText('0개');
 expect(s.calls.find(x=>x.searchParams.get('cursor')).searchParams.get('stats')).toBe('0');s.sql.close();
});
test('search debounce, stale response exclusion and filter reset',async({page})=>{
 const s=await setup(page);s.delay('Title');await page.locator('[data-query]').fill('Title');await expect.poll(()=>s.calls.some(x=>x.searchParams.get('q')==='Title')).toBe(true);
 await page.locator('[data-query]').fill('Title 64');await expect(page.locator('[data-open]')).toHaveCount(1);s.release();await expect(page.locator('[data-open]')).toHaveAttribute('data-open','a064');
 await page.locator('[data-query]').fill('');await expect(page.locator('[data-open]')).toHaveCount(20);
 await page.locator('[data-page-next]').click();await expect(page.locator('[data-page-range]')).toContainText('21–40');
 await page.locator('[data-status-filter]').locator('..').locator('button').first().click();await page.locator('[role=option][data-value=draft]').click();await expect(page.locator('[data-page-range]')).toHaveText('1–20 / 33');
 await page.locator('[data-campaign-filter]').locator('..').locator('button').first().click();await page.locator('[role=option][data-value=free]').click();await expect(page.locator('[data-page-range]')).toHaveText('1–20 / 33');
 await page.locator('[data-page-next]').click();await expect(page.locator('[data-open]')).toHaveCount(13);await expect(page.locator('[data-page-next]')).toBeDisabled();s.sql.close();
});
test('student list and photo picker page/search without fetching full list or roster',async({page})=>{
 const s=await setup(page,'student');await page.locator('[data-page-next]').click();await expect(page.locator('[data-page-range]')).toHaveText('21–40 / 65');
 await page.locator('[data-open-upload]').first().click();const modal=page.locator('[data-upload-modal]');await expect(modal.locator('[name=articleSubmissionId] option')).toHaveCount(20);
 await modal.locator('[data-page-next]').click();await expect(modal.locator('[data-page-range]')).toHaveText('21–40');expect(s.calls.some(x=>x.pathname==='/api/photos/upload')).toBe(false);await modal.locator('[data-query]').fill('Title 0');await expect(modal.locator('[name=articleSubmissionId] option')).toHaveCount(1);await expect(modal.locator('[name=articleSubmissionId]')).toHaveValue('a000');
 expect(s.calls.filter(x=>x.pathname==='/api/native/articles').every(x=>x.searchParams.get('page')==='1')).toBe(true);expect(s.calls.some(x=>x.pathname.includes('classroom'))).toBe(false);expect(s.calls.some(x=>x.searchParams.get('picker')==='1')).toBe(true);s.sql.close();
});
test('390px list controls and pagination stay within viewport',async({page})=>{
 await page.setViewportSize({width:390,height:800});const s=await setup(page);
 const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,12)}));expect(overflow.scroll,JSON.stringify(overflow)).toBeLessThanOrEqual(390);s.sql.close();
});
