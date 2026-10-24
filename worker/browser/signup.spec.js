import {test,expect} from '@playwright/test';
const profile={name:'가상학생',studentNumber:'20624',email:'h2511999@joongdong.hs.kr',cohort:35,grade:2,eligible:true,numberMatches:true};
async function setup(page,options={}){
 const writes=[];await page.clock.setFixedTime(new Date('2026-10-24T03:00:00Z'));
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;let data;
  if(path==='/api/signup'){
   if(request.method()==='GET'){if(options.expired)return route.fulfill({status:401,json:{error:{message:'가입 인증이 만료되었습니다.'}}});data={profile:{...profile,...options.profile}};}
   else{writes.push(request.postDataJSON());if(options.fail)return route.fulfill({status:400,json:{error:{message:'가입할 수 없습니다. 코드를 확인해 주세요.'}}});data={redirect:'/student/'};}
  }else if(path==='/api/session')data={authenticated:true,user:{role:'student',name:'가상학생',studentId:'fixture',profileUpdate:options.profileUpdate}};
  else if(path==='/api/member-profile/confirm'){writes.push(request.postDataJSON());data={updated:true};}
  else if(path==='/api/assignments')data={campaigns:[],assignments:[]};
  else if(path==='/api/native/articles')data={items:[],nextCursor:null,stats:{total:0,statuses:{}}};
  else throw Error('Unexpected '+path);
  await route.fulfill({json:data});
 });return {writes};
}
for(const width of [360,390,430,820,1440])test('student signup confirmation and existing student dashboard navigation '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const state=await setup(page);await page.goto('/signup/');
 const form=page.locator('[data-signup-form]');await expect(form).toBeVisible();await expect(form.locator('[name=name]')).toHaveValue('가상학생');await expect(form.locator('[name=studentNumber]')).toHaveValue('20624');await expect(form.locator('[name=cohort]')).toHaveValue('35기');await expect(form.locator('[name=cohort]')).toHaveAttribute('readonly','');
 expect(state.writes).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 for(const el of await form.locator('input:not([type=checkbox]),button').all())expect((await el.boundingBox()).height).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:info.outputPath('signup.png'),animations:'disabled'});
 await form.locator('[name=code]').fill('isolated-fixture-code');await form.locator('[name=confirmed]').check();await form.getByRole('button').click();await expect(page).toHaveURL(/\/student\/$/);await expect(page.locator('[data-view=dashboard]')).toBeVisible();expect(state.writes[0]).toEqual({code:'isolated-fixture-code',name:'가상학생',studentNumber:'20624',confirmed:true});
});
test('exceptional Google name is editable; failed code leaves confirmation workflow usable',async({page})=>{
 const state=await setup(page,{profile:{name:'예외 표시 이름',studentNumber:'',numberMatches:false},fail:true});await page.goto('/signup/');const form=page.locator('form');await expect(form).toBeVisible();await expect(form.locator('[name=studentNumber]')).toHaveValue('');
 await form.locator('[name=name]').fill('직접 확인한 이름');await form.locator('[name=studentNumber]').fill('20624');await form.locator('[name=code]').fill('wrong-fixture-code');await form.locator('[name=confirmed]').check();await form.getByRole('button').click();await expect(page.locator('[data-signup-status]')).toContainText('코드를 확인');await expect(form.getByRole('button')).toBeEnabled();await expect(form.locator('[name=code]')).toHaveValue('');expect(state.writes).toHaveLength(1);
});
test('unsupported student email and expired pending authentication do not enable signup',async({page})=>{
 await setup(page,{profile:{eligible:false,cohort:null,grade:null}});await page.goto('/signup/');await expect(page.locator('form')).toBeVisible();await expect(page.locator('form button')).toBeDisabled();await expect(page.locator('[data-signup-guidance]')).toContainText('수동 등록');
 await page.route('**/api/signup',route=>route.fulfill({status:401,json:{error:{message:'가입 인증이 만료되었습니다.'}}}));await page.reload();await expect(page.locator('[data-signup-status]')).toContainText('만료');await expect(page.locator('form')).toBeHidden();await expect(page.getByRole('link',{name:'Google 로그인으로 돌아가기'})).toHaveAttribute('href','../login/');
});
test('Google profile rendering uses text/value and number updates require explicit student confirmation',async({page})=>{
 const state=await setup(page,{profile:{name:'<img src=x onerror=alert(1)>',email:'fixture@joongdong.hs.kr'},profileUpdate:{studentNumber:'20624'}});await page.goto('/signup/');await expect(page.locator('form')).toBeVisible();await expect(page.locator('input[name=name]')).toHaveValue('<img src=x onerror=alert(1)>');await expect(page.locator('[data-signup-account] img')).toHaveCount(0);expect(state.writes).toHaveLength(0);
 await page.goto('/student/');await expect(page.locator('[data-profile-update]')).toContainText('20624');expect(state.writes).toHaveLength(0);await page.getByRole('button',{name:'현재 학번 확인·갱신'}).click();await expect(page.locator('[data-profile-update]')).toContainText('갱신했습니다');expect(state.writes).toEqual([{studentNumber:'20624',confirmed:true}]);
});
