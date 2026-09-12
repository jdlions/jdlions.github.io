import {pageResponse} from './page-fixture.js';
import {test,expect} from '@playwright/test';
async function setup(page,{articles=2,failSummary=false,failDelete=false}={}){
 const calls=[];let release;
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  let data={};
  if(path==='/api/session')data={authenticated:true,user:{role:'admin',name:'Teacher'}};
  else if(path==='/api/native/articles'||path==='/api/photos')data=[];
  else if(path==='/api/classroom/students')data={students:[]};
  else if(path==='/api/assignments')data={campaigns:[{id:'c1',name:'삭제 테스트',slots:[],status:'active'}],assignments:[]};
  else if(path.endsWith('/deletion-summary')){
   if(failSummary)return route.fulfill({status:500,json:{error:{message:'조회 실패'}}});
   data={name:'삭제 테스트',instanceCount:3,articleCount:articles,submissionCount:articles?1:0};
  }else if(path==='/api/assignments/c1'&&request.method()==='DELETE'){
   calls.push({body:request.postDataJSON(),csrf:request.headers()['x-editorial-csrf']});
   if(failDelete)return route.fulfill({status:500,json:{error:{message:'삭제 실패'}}});
   await new Promise(resolve=>release=resolve);data={id:'c1',deleted:true,mode:'preserve_articles'};
  }else throw new Error('Unexpected route '+path);
  await route.fulfill({json:path==='/api/native/articles'&&Array.isArray(data)?pageResponse(data):data});
 });
 await page.goto('/admin/');if(page.viewportSize().width<768)await page.getByRole('button',{name:'메뉴 열기'}).click();await page.locator('[data-admin-view=assignments]').click();
 await page.locator('[data-delete-campaign]').click();
 return {calls,release:()=>release()};
}
for(const articles of [0,2])test('exact confirmation, cancel and one deletion with '+articles+' linked articles',async({page})=>{
 const state=await setup(page,{articles}),dialog=page.getByRole('dialog'),input=page.getByRole('textbox',{name:'삭제 확인'}),button=page.locator('[data-delete-final]');
 await expect(dialog).toContainText('연결 기사 '+articles+'건');
 await expect(dialog).toContainText('Drive 원본은 모두 보존');
 for(const value of ['',' ',' 삭제','삭제 ','delete','삭제\u200b']){
  await input.fill(value);await expect(button).toBeDisabled();
 }
 await input.fill('삭제');await expect(button).toBeEnabled();
 await page.getByRole('button',{name:'취소',exact:true}).click();await expect(dialog).toHaveCount(0);expect(state.calls).toHaveLength(0);
 await page.locator('[data-delete-campaign]').click();await expect(input).toHaveValue('');await page.keyboard.press('Escape');expect(state.calls).toHaveLength(0);
 await page.locator('[data-delete-campaign]').click();await input.fill('삭제');
 await expect(button).toBeEnabled();
 await dialog.locator('form').evaluate(form=>{for(let i=0;i<4;i++)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 await expect.poll(()=>state.calls.length).toBe(1);await expect(button).toBeDisabled();
 expect(state.calls[0]).toEqual({body:{confirmation:'삭제',mode:'preserve_articles'},csrf:'1'});
 state.release();await expect(dialog).toHaveCount(0);await expect(page.locator('[data-delete-campaign]')).toHaveCount(0);
});
test('failed preview cannot enable deletion and can be cancelled',async({page})=>{
 const state=await setup(page,{failSummary:true});await expect(page.getByRole('alert')).toContainText('조회 실패');
 await page.getByRole('textbox',{name:'삭제 확인'}).fill('삭제');await expect(page.locator('[data-delete-final]')).toBeDisabled();
 await page.getByRole('button',{name:'취소',exact:true}).click();expect(state.calls).toHaveLength(0);
});
test('failed delete resets confirmation, keeps campaign and fits mobile viewport',async({page})=>{
 await page.setViewportSize({width:390,height:720});await setup(page,{failDelete:true});
 await page.getByRole('textbox',{name:'삭제 확인'}).fill('삭제');await page.locator('[data-delete-final]').click();
 await expect(page.getByRole('alert')).toContainText('삭제 실패');
 await expect(page.getByRole('textbox',{name:'삭제 확인'})).toHaveValue('');
 await expect(page.locator('[data-delete-final]')).toBeDisabled();
 const box=await page.getByRole('dialog').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await page.getByRole('button',{name:'취소',exact:true}).click();await expect(page.locator('[data-delete-campaign]')).toBeVisible();
});
