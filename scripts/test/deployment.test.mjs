import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {deploymentConfig,migrationPlan,sha256,deployProduction,waitForVercel,deploymentCommit,isAdditiveMigration} from '../deployment-policy.mjs';
import {createProductionAdapter,productionSmoke} from '../production-deploy.mjs';
const commit='a'.repeat(40);
const env={CLOUDFLARE_API_TOKEN:'mock-cloud',CLOUDFLARE_ACCOUNT_ID:'mock-account',VERCEL_TOKEN:'mock-vercel',VERCEL_PROJECT_ID:'mock-project',GITHUB_TOKEN:'mock-github',GITHUB_SHA:commit,GITHUB_REPOSITORY:'jdlions/jdlions.github.io',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push'};

test('production context and missing secrets fail closed before any writes',()=>{
  assert.equal(deploymentConfig(env).commit,commit);
  for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','VERCEL_TOKEN','VERCEL_PROJECT_ID','GITHUB_TOKEN'])assert.throws(()=>deploymentConfig({...env,[key]:''}),new RegExp(key));
  for(const extra of [{GITHUB_REF:'refs/heads/feature'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REPOSITORY:'fork/repo'},{GITHUB_SHA:'main'}])assert.throws(()=>deploymentConfig({...env,...extra}));
});
test('only unapplied, exact reviewed migration hashes are eligible',()=>{
  const file={name:'0008_test.sql',sql:'ALTER TABLE x ADD COLUMN optional TEXT;'},approved={[file.name]:{mode:'additive',sha256:sha256(file.sql)}};
  assert.deepEqual(migrationPlan([file],[],approved),[file.name]);
  assert.deepEqual(migrationPlan([file],[file.name],{}),[]);
  assert.throws(()=>migrationPlan([file],['unknown.sql'],approved),/history/);
  for(const sql of ['DELETE FROM articles;','DROP TABLE articles;',file.sql+' UPDATE articles SET status=\'draft\';'])assert.throws(()=>migrationPlan([{...file,sql}],[],approved),/manual_review/);
  assert.throws(()=>migrationPlan([file],[],{[file.name]:{mode:'manual',sha256:sha256(file.sql)}}),/manual_review/);
});
test('reviewed 0008 matches actual SQL; older pending migrations require manual review',async()=>{
  const directory=new URL('../../worker/migrations/',import.meta.url),files=await Promise.all((await readdir(directory)).sort().map(async name=>({name,sql:await readFile(new URL(name,directory),'utf8')})));
  const approved=JSON.parse(await readFile(new URL('../approved-migrations.json',import.meta.url),'utf8'));
  assert.deepEqual(migrationPlan(files,files.slice(0,-1).map(f=>f.name),approved),['0008_assignment_lengths.sql']);
  assert.throws(()=>migrationPlan(files,[],approved),/manual_review/);
});
test('destructive/backfill/constraint migrations stop even with a matching approved digest',()=>{
  for(const sql of ['DELETE FROM articles;','DROP TABLE articles;','UPDATE articles SET status=\'draft\';','ALTER TABLE articles ADD COLUMN x TEXT NOT NULL;','ALTER TABLE articles ADD COLUMN x TEXT DEFAULT \'new\';','CREATE TRIGGER cleanup AFTER INSERT ON x BEGIN DELETE FROM articles; END;','CREATE TABLE copy AS SELECT * FROM articles;']){
    assert.equal(isAdditiveMigration(sql),false,sql);const file={name:'0009_test.sql',sql};assert.throws(()=>migrationPlan([file],[],{[file.name]:{mode:'additive',sha256:sha256(sql)}}),/manual_review/);
  }
});
function adapter({pending=[],fail}={}){const calls=[];const result={calls};for(const name of ['preflight','migrationPlan','applyMigrations','verifyMigrations','deployWorker','deployFrontend','verifyRelease','smoke'])result[name]=async()=>{calls.push(name);if(name===fail)throw new Error('mock-failure');if(name==='migrationPlan')return pending;if(name==='deployWorker')return {version:'version',deployment:'worker',traffic:100};if(name==='deployFrontend')return {deployment:'frontend',commit};};return result;}
test('no migration skips apply; migration release uses exact safe ordering',async()=>{
  for(const pending of [[],['0008.sql']]){const a=adapter({pending}),events=[];await deployProduction(a,{commit},e=>events.push(e));assert.deepEqual(a.calls,['preflight','migrationPlan',...(pending.length?['applyMigrations']:[]),'verifyMigrations','deployWorker','deployFrontend','verifyRelease','smoke']);assert.equal(events.at(-1).status,'success');}
});
for(const failure of ['preflight','migrationPlan','applyMigrations','verifyMigrations','deployWorker','deployFrontend','verifyRelease','smoke'])test(failure+' prevents every later release step and records failure',async()=>{
  const a=adapter({pending:['0008.sql'],fail:failure}),events=[];await assert.rejects(deployProduction(a,{commit},e=>events.push(e)));assert.equal(a.calls.at(-1),failure);assert.equal(events.at(-1).status,'failure');assert(!a.calls.some(name=>/rollback/.test(name)));
});
test('Vercel delay, failure, timeout and commit mismatch are distinguished',async()=>{
  let calls=0;const ready={gitSource:{sha:commit},readyState:'READY',aliasAssigned:true,target:'production'};
  assert.deepEqual(await waitForVercel(async()=>++calls===3?ready:{readyState:'BUILDING',gitSource:{sha:commit}},commit,{sleep:async()=>{},attempts:4}),ready);assert.equal(calls,3);
  await assert.rejects(waitForVercel(async()=>({...ready,gitSource:{sha:'b'.repeat(40)}}),commit,{sleep:async()=>{}}),/mismatch/);
  await assert.rejects(waitForVercel(async()=>({readyState:'ERROR'}),commit,{sleep:async()=>{}}),/failed/);
  await assert.rejects(waitForVercel(async()=>({readyState:'BUILDING'}),commit,{sleep:async()=>{},attempts:2}),/timeout/);
  assert.equal(deploymentCommit({meta:{automationCommit:commit}}),null);
});
function smokeResponse(url){
  const u=new URL(url),path=u.pathname;
  if(path==='/api/session')return Response.json({authenticated:false,user:null},{headers:{'Cache-Control':'private, no-store'}});
  if(path==='/api/public/issues')return Response.json(Array.from({length:18},(_,i)=>({number:i===0?34:i+16})),{headers:{'Cache-Control':'no-store'}});
  if(path.startsWith('/api/'))return Response.json({error:{code:'authentication_required'}},{status:401,headers:{'Cache-Control':'private, no-store'}});
  if(path==='/deployment.json')return Response.json({commit,assets:'assets/build-1234567890abcdef/'},{headers:{'Cache-Control':'private, no-store'}});
  if(path.startsWith('/assets/'))return new Response('asset',{headers:{'Cache-Control':'public, max-age=3600, must-revalidate'}});
  return new Response('<meta name="robots" content="noindex"><script src="../assets/build-1234567890abcdef/js/admin/admin-app.js"></script>',{headers:{'Cache-Control':'private, no-store'}});
}
test('production smoke is read-only and does not create users, submissions or Slack messages',async()=>{
  const calls=[];await productionSmoke(commit,async(url,options)=>{calls.push({url,options});return smokeResponse(url);});
  assert(calls.length>10);assert(calls.every(c=>!c.options.method||c.options.method==='GET'));assert(calls.every(c=>!c.options.body&&!c.options.headers.Authorization));
  for(const failure of ['cache','public-private','commit','archive'])await assert.rejects(productionSmoke(commit,async url=>{
    if(failure==='cache'&&url.endsWith('/api/session'))return Response.json({authenticated:false,user:null},{headers:{'Cache-Control':'public'}});
    if(failure==='public-private'&&url.endsWith('/api/session'))return Response.json({authenticated:false,user:null},{headers:{'Cache-Control':'public, no-store'}});
    if(failure==='commit'&&url.endsWith('/deployment.json'))return Response.json({commit:'b'.repeat(40)},{headers:{'Cache-Control':'no-store'}});
    if(failure==='archive'&&url.endsWith('/api/public/issues'))return Response.json([],{headers:{'Cache-Control':'no-store'}});
    return smokeResponse(url);
  }));
});
test('real provider adapter resumes duplicate workflow without a second deploy and validates alias',async()=>{
  const files=(await readdir(new URL('../../worker/migrations/',import.meta.url))).sort(),requests=[],commands=[];
  const request=async(url,options={})=>{requests.push({url,options});const path=new URL(url).pathname;
    if(path.includes('/git/ref/'))return Response.json({object:{sha:commit}});
    if(path.includes('/d1/database/'))return Response.json({success:true,result:[{results:files.map(name=>({name}))}]});
    if(path.endsWith('/workers/scripts/lions-pride-editorial-api/deployments'))return Response.json({success:true,result:{deployments:[{id:'worker',created_on:'2026-10-08',versions:[{version_id:'version',percentage:100}]}]}});
    if(path.endsWith('/versions/version'))return Response.json({success:true,result:{annotations:{'workers/tag':`git-${commit}`}}});
    if(path.includes('/v9/projects/'))return Response.json({name:'pridesk',rootDirectory:'pridedesk',link:{type:'github',org:'jdlions',repo:'jdlions.github.io',repoId:123}});
    if(path==='/v6/deployments')return Response.json({deployments:[{uid:'frontend',readyState:'READY',meta:{githubCommitSha:commit}}]});
    if(path.startsWith('/v13/deployments/'))return Response.json({id:'frontend',gitSource:{sha:commit},readyState:'READY',aliasAssigned:true,target:'production'});
    return smokeResponse(url);
  };
  const a=createProductionAdapter(deploymentConfig(env),{environment:env,request,command:async args=>commands.push(args),pause:async()=>{}});
  for(let i=0;i<2;i++)await deployProduction(a,{commit});
  assert.equal(commands.length,0);assert(!requests.some(r=>new URL(r.url).pathname==='/v13/deployments'&&r.options.method==='POST'));
  assert(requests.filter(r=>r.url.includes('/d1/database/')).every(r=>JSON.parse(r.options.body).sql==='SELECT name FROM d1_migrations ORDER BY id'));
});
test('workflow serializes production, never deploys a PR, and retains preview builds',async()=>{
  const workflow=await readFile(new URL('../../.github/workflows/production-deploy.yml',import.meta.url),'utf8');assert.match(workflow,/branches: \[main\]/);assert.match(workflow,/cancel-in-progress: false/);assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);assert.doesNotMatch(workflow,/pull_request_target|secrets: inherit|--force/);
  const config=JSON.parse(await readFile(new URL('../../pridedesk/vercel.json',import.meta.url),'utf8'));assert.deepEqual(config.git.deploymentEnabled,{main:false});
});
test('real adapter applies pending 0008 then deploys Worker and creates exact-SHA Vercel production once',async()=>{
  const names=(await readdir(new URL('../../worker/migrations/',import.meta.url))).sort(),calls=[];let applied=false,workerReady=false,frontendReady=false,buildReads=0;
  const request=async(url,options={})=>{const path=new URL(url).pathname;calls.push({path,method:options.method,body:options.body&&JSON.parse(options.body)});
    if(path.includes('/git/ref/'))return Response.json({object:{sha:commit}});
    if(path.includes('/d1/database/'))return Response.json({success:true,result:[{results:(applied?names:names.slice(0,-1)).map(name=>({name}))}]});
    if(path.endsWith('/workers/scripts/lions-pride-editorial-api/deployments'))return Response.json({success:true,result:{deployments:[{id:'worker',created_on:'2026-10-08',versions:[{version_id:'version',percentage:100}]}]}});
    if(path.endsWith('/versions/version'))return Response.json({success:true,result:{annotations:{'workers/tag':workerReady?`git-${commit}`:'old-version'}}});
    if(path.includes('/v9/projects/'))return Response.json({name:'pridesk',rootDirectory:'pridedesk',link:{type:'github',org:'jdlions',repo:'jdlions.github.io',repoId:123}});
    if(path==='/v6/deployments')return Response.json({deployments:frontendReady?[{uid:'frontend',readyState:'READY',meta:{githubCommitSha:commit}}]:[]});
    if(path==='/v13/deployments'){assert(workerReady);const body=JSON.parse(options.body);assert.equal(body.gitSource.ref,commit);assert.equal(body.gitSource.repoId,'123');assert.equal(body.target,'production');return Response.json({id:'frontend'});}
    if(path.startsWith('/v13/deployments/')){frontendReady=++buildReads>1;return Response.json({id:'frontend',gitSource:{sha:commit},readyState:frontendReady?'READY':'BUILDING',aliasAssigned:frontendReady,target:'production'});}
    return smokeResponse(url);
  };
  const commands=[],a=createProductionAdapter(deploymentConfig(env),{environment:env,request,pause:async()=>{},command:async args=>{commands.push(args);if(args[0]==='d1')applied=true;else {assert(applied);workerReady=true;}}});
  await deployProduction(a,{commit});await deployProduction(a,{commit});
  assert.deepEqual(commands[0],['d1','migrations','apply','editorial-production','--remote']);assert.equal(commands[1][0],'deploy');assert.equal(commands.length,2);assert.equal(calls.filter(c=>c.path==='/v13/deployments'&&c.method==='POST').length,1);
});
test('obsolete main release aborts before ledger/migration/Worker/Vercel operations',async()=>{
  const calls=[],a=createProductionAdapter(deploymentConfig(env),{environment:env,command:async()=>assert.fail('no commands'),request:async url=>{calls.push(url);return Response.json({object:{sha:'b'.repeat(40)}});}});
  await assert.rejects(deployProduction(a,{commit}),/newer_main_release_required/);assert.equal(calls.length,1);
});
