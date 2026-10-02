import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';

// No page.route/context.route: request interception disables the HTTP cache.
// Serve the actual Vercel build with its production cache policy and local APIs.
async function deploymentServer(){
  let authenticated=false,sessionGate,releaseSession;
  const hits=[],root=resolve('../pridedesk/dist');
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;hits.push(path);
    res.setHeader('Cache-Control',path.startsWith('/assets/')?'public, max-age=3600, must-revalidate':'private, no-store');
    if(path==='/warm'){
      res.setHeader('Content-Type','text/html');
      // Cache old entry AND dependencies. Busting only the entry is insufficient.
      res.end('<script type="module" src="/assets/js/admin/admin-app.js"></script>');return;
    }
    if(path.startsWith('/assets/js/')){
      res.setHeader('Content-Type','text/javascript');
      res.end(path.endsWith('/admin-app.js')?"import '../shared/shell.js';import './editorial-files.js';window.legacyAssetLoaded=true;":"export const stale=true;");return;
    }
    if(path==='/auth/login'){
      authenticated=true;res.writeHead(302,{Location:'/admin/'}).end();return;
    }
    if(path.startsWith('/api/')){
      if(path==='/api/session'&&authenticated&&sessionGate)await sessionGate;
      const data=path==='/api/session'?{authenticated,user:authenticated?{role:'admin',name:'검증 편집자'}:null}:
        path==='/api/native/articles'?{items:[],stats:{total:0,byStatus:{}},campaigns:[],nextCursor:null,limit:20}:
        path==='/api/editorial-files/settings'?{editors:[{role:'chief',name:'테스트 편집장'},{role:'deputy',name:'테스트 부편집장'}],channelEnabled:true,channelId:'C_TEST_ONLY'}:{};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
    }
    const file=resolve(root,'.'+(path.endsWith('/')?path+'index.html':path));
    if(!file.startsWith(root)){res.writeHead(403).end();return;}
    try{const body=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.webp':'image/webp'})[extname(file)]||'application/octet-stream');res.end(body);}catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {origin:'http://127.0.0.1:'+server.address().port,hits,
    delaySession(){sessionGate=new Promise(r=>{releaseSession=r;});},
    release(){releaseSession?.();sessionGate=null;},
    async close(){releaseSession?.();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
async function menu(page,view){
  if(await page.locator('[data-menu]').isVisible())await page.locator('[data-menu]').click();
  await page.locator(`[data-admin-view="${view}"]`).click();
}
for(const width of [390,820,1440])test('warm-cache deployment: real admin login/bootstrap, settings history and delayed greeting '+width,async({page},info)=>{
  const server=await deploymentServer(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.setViewportSize({width,height:900});
    await page.goto(server.origin+'/warm');await expect.poll(()=>page.evaluate(()=>window.legacyAssetLoaded)).toBe(true);
    const warmRequests=server.hits.length;
    await page.goto('about:blank');await page.goto(server.origin+'/warm');await expect.poll(()=>page.evaluate(()=>window.legacyAssetLoaded)).toBe(true);
    expect(server.hits.slice(warmRequests).filter(p=>p.startsWith('/assets/'))).toEqual([]);
    await page.goto(server.origin+'/login/');await expect(page.locator('[data-google-login]')).toBeEnabled();
    server.delaySession();await page.locator('[data-google-login]').click();await expect(page).toHaveURL(/\/admin\//);
    await expect(page.locator('[data-user-greeting]')).toHaveText('');server.release();
    const header=page.locator('[data-user-greeting]');await expect(header).toContainText('검증 편집자님.');
    await expect(header).toHaveText(/^(좋은 아침이에요|오늘도 반가워요|좋은 저녁이에요|늦은 시간이네요), 검증 편집자님\.$/);
    await menu(page,'editor-settings');await expect(page.locator('[data-view=editor-settings]')).toBeVisible();
    await expect(page.locator('[data-view=dashboard]')).toBeHidden();
    await expect(page.getByLabel('편집장 이름',{exact:true})).toHaveValue('테스트 편집장');
    await expect(page.getByLabel('부편집장 이름',{exact:true})).toHaveValue('테스트 부편집장');
    expect(server.hits).toContain('/api/editorial-files/settings');
    await menu(page,'dashboard');await expect(page.locator('[data-view=editor-settings]')).toBeHidden();
    await page.goBack();await expect(page.getByLabel('편집장 이름',{exact:true})).toBeVisible();
    await page.goForward();await expect(page.locator('[data-view=dashboard]')).toBeVisible();
    await page.goto(server.origin+'/admin/#view=editor-settings');await page.reload();
    await expect(page.getByLabel('편집장 이름',{exact:true})).toBeVisible();await expect(header).toContainText('검증 편집자님.');
    await expect(page.locator('[data-view=dashboard]')).toBeHidden();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).filter(url=>url.includes('/assets/')));
    expect(resources.every(url=>/\/assets\/build-[a-f0-9]{16}\//.test(url))).toBe(true);
    expect(server.hits.filter(p=>p==='/assets/js/shared/shell.js')).toHaveLength(1);
    expect(errors).toEqual([]);await page.screenshot({path:info.outputPath('warm-cache-settings.png'),fullPage:true});
  }finally{await server.close();}
});
