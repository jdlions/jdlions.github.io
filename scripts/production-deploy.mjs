import {readFile,readdir,writeFile,appendFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deploymentConfig,migrationPlan,deployProduction,deploymentCommit,waitForVercel} from './deployment-policy.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dbId='ad7878f5-4347-441d-835e-37254299dfda',workerName='lions-pride-editorial-api';
const workerOrigin='https://lions-pride-editorial-api.editor-936.workers.dev',frontendOrigin='https://pridesk.vercel.app';
const env=process.env,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const run=promisify(execFile);
async function wrangler(args) {
  // Never echo commands containing credentials or raw provider error bodies.
  try {return (await run(process.execPath,[resolve(root,'worker/node_modules/wrangler/bin/wrangler.js'),...args],{cwd:resolve(root,'worker'),env:{...env,CI:'true'},timeout:300000,maxBuffer:8*1024*1024})).stdout;}
  catch {throw new Error('wrangler_step_failed');}
}
async function api(url,token,body,request=fetch) {
  let response;
  try {response=await request(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','User-Agent':'PrideDesk deployment'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});}
  catch {throw new Error('provider_request_failed');}
  if(!response.ok)throw new Error('provider_http_'+response.status);
  const data=await response.json();if(data.success===false)throw new Error('provider_operation_failed');return data;
}
export function createProductionAdapter(config,{environment=env,request=fetch,command=wrangler,pause=sleep}={}) {
  const cf=path=>`https://api.cloudflare.com/client/v4/accounts/${config.account}${path}`;
  const vc=path=>`https://api.vercel.com${path}${path.includes('?')?'&':'?'}${config.team?'teamId='+encodeURIComponent(config.team):''}`;
  const cloud=(path,body)=>api(cf(path),environment.CLOUDFLARE_API_TOKEN,body,request);
  const vercel=(path,body)=>api(vc(path),environment.VERCEL_TOKEN,body,request);
  const ledger=async()=>{
    const result=await cloud(`/d1/database/${dbId}/query`,{sql:'SELECT name FROM d1_migrations ORDER BY id',params:[]});
    return result.result.flatMap(r=>r.results).map(r=>r.name);
  };
  const files=async()=>Promise.all((await readdir(resolve(root,'worker/migrations'))).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort().map(async name=>({name,sql:await readFile(resolve(root,'worker/migrations',name),'utf8')})));
  const plan=async()=>migrationPlan(await files(),await ledger(),JSON.parse(await readFile(resolve(root,'scripts/approved-migrations.json'),'utf8')));
  const latestWorker=async()=>{
    const result=await cloud(`/workers/scripts/${workerName}/deployments`);
    return [...result.result.deployments].sort((a,b)=>b.created_on.localeCompare(a.created_on))[0];
  };
  const workerRelease=async(commit)=>{
    const deployment=await latestWorker(),versions=deployment?.versions||[];
    if(versions.length!==1||versions[0].percentage!==100)return null;
    const version=await cloud(`/workers/scripts/${workerName}/versions/${versions[0].version_id}`);
    if(version.result.annotations?.['workers/tag']!==`git-${commit}`)return null;
    return {version:versions[0].version_id,deployment:deployment.id,traffic:100};
  };
  const currentMain=async()=>{
    const main=await api('https://api.github.com/repos/jdlions/jdlions.github.io/git/ref/heads/main',environment.GITHUB_TOKEN,undefined,request);
    if(main.object.sha!==config.commit)throw new Error('newer_main_release_required');
  };
  let project;
  return {
    async preflight(){
      await currentMain();
      const toml=await readFile(resolve(root,'worker/wrangler.toml'),'utf8');
      if(!toml.includes(`name = "${workerName}"`)||!toml.includes(`database_id = "${dbId}"`)||!toml.includes('database_name = "editorial-production"'))throw new Error('production_binding_mismatch');
      const settings=JSON.parse(await readFile(resolve(root,'pridedesk/vercel.json'),'utf8'));
      if(settings.git?.deploymentEnabled?.main!==false)throw new Error('parallel_git_deployment_not_disabled');
      project=await vercel(`/v9/projects/${encodeURIComponent(config.project)}`);
      if(project.rootDirectory!=='pridedesk'||project.link?.type!=='github'||project.link?.org!=='jdlions'||project.link?.repo!=='jdlions.github.io'||!project.link?.repoId)throw new Error('vercel_project_mismatch');
    },
    migrationPlan:plan,
    async applyMigrations(pending){
      await currentMain();
      const current=await plan();if(JSON.stringify(current)!==JSON.stringify(pending))throw new Error('migration_plan_changed');
      await command(['d1','migrations','apply','editorial-production','--remote']);
    },
    async verifyMigrations(){if((await plan()).length)throw new Error('migration_not_applied');},
    async deployWorker(commit){
      await currentMain();
      let release=await workerRelease(commit);if(release)return release;
      await command(['deploy','--tag',`git-${commit}`,'--message',`GitHub Actions ${commit}`]);
      for(let i=0;i<6;i++){release=await workerRelease(commit);if(release)return release;await pause(5000);}
      throw new Error('worker_commit_or_traffic_mismatch');
    },
    async deployFrontend(commit){
      await currentMain();
      const list=await vercel(`/v6/deployments?projectId=${encodeURIComponent(config.project)}&target=production&limit=100`);
      // A retry resumes the same live build, and a completed duplicate release
      // performs verification only. Never reuse another commit's deployment.
      let existing=list.deployments.find(d=>deploymentCommit(d)===commit&&!['ERROR','CANCELED'].includes(d.readyState||d.state));
      if(!existing)existing=await vercel('/v13/deployments',{
        name:project.name,project:config.project,target:'production',
        gitSource:{type:'github',repoId:String(project.link.repoId),ref:commit},
        meta:{automationCommit:commit}
      });
      const deployment=await waitForVercel(()=>vercel(`/v13/deployments/${encodeURIComponent(existing.id||existing.uid)}`),commit,{sleep:pause});
      return {deployment:deployment.id||deployment.uid,commit:deploymentCommit(deployment)};
    },
    async verifyRelease(commit,worker,frontend){
      await currentMain();
      const current=await workerRelease(commit);
      if(!current||current.deployment!==worker.deployment||frontend.commit!==commit)throw new Error('release_mismatch');
      const alias=await vercel('/v13/deployments/pridesk.vercel.app');
      if(deploymentCommit(alias)!==commit||alias.id!==frontend.deployment||alias.readyState!=='READY')throw new Error('production_alias_mismatch');
    },
    async smoke(commit){await productionSmoke(commit,request);}
  };
}

export async function productionSmoke(commit,request=fetch) {
  async function get(url,expected,cache){
    const response=await request(url,{headers:{'Cache-Control':'no-cache'},redirect:'manual',signal:AbortSignal.timeout(30000)});
    const policy=response.headers.get('cache-control')||'';
    if(response.status!==expected||!cache.test(policy)||(cache===privateCache&&/\bpublic\b/.test(policy)))throw new Error('smoke_status_or_cache_failed');
    return response;
  }
  const privateCache=/\bno-store\b/;
  for(const origin of [workerOrigin,frontendOrigin]){
    const session=await (await get(origin+'/api/session',200,privateCache)).json();
    if(session.authenticated!==false||session.user!==null)throw new Error('anonymous_session_failed');
    for(const path of ['/api/admin/dashboard','/api/admin/article-overview','/api/native/articles?limit=1','/api/photos','/api/publications']){
      const body=await (await get(origin+path,401,privateCache)).json();
      if(body.error?.code!=='authentication_required')throw new Error('protected_route_failed');
    }
    const archive=await (await get(origin+'/api/public/issues',200,/max-age|no-store/)).json();
    if(!Array.isArray(archive)||archive.length<18||!archive.some(i=>i.number===34))throw new Error('archive_smoke_failed');
  }
  for(const path of ['/login/','/admin/','/student/']){
    const html=await (await get(frontendOrigin+path,200,privateCache)).text();
    if(!/noindex/.test(html)||!html.includes('assets/build-'))throw new Error('html_smoke_failed');
  }
  const build=await (await get(frontendOrigin+'/deployment.json',200,privateCache)).json();
  if(build.commit!==commit||!/^assets\/build-[a-f0-9]{16}\/$/.test(build.assets))throw new Error('frontend_build_mismatch');
  await get(frontendOrigin+'/'+build.assets+'js/admin/admin-app.js',200,/public.*max-age=3600/);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const stages=[],report={status:'failure',stages};
  try {
    const config=deploymentConfig(env);
    const result=await deployProduction(createProductionAdapter(config),config,event=>{stages.push(event);if(event.details)report[event.stage]=event.details;console.log(`${event.stage}: ${event.status}`);});
    Object.assign(report,result,{status:'success'});
  } catch(error) {
    // Only our known diagnostic codes enter logs; raw response/token/error data
    // from providers and subprocesses are deliberately omitted.
    const code=/^[a-z_0-9]+(?:: [A-Z_, ]+)?$/.test(error.message)?error.message:'deployment_failed';
    report.error=code;console.error(code);process.exitCode=1;
  } finally {
    await writeFile(resolve(root,'deployment-result.json'),JSON.stringify(report,null,2));
    if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,`## PrideDesk production: ${report.status}\n\n${stages.map(s=>`- ${s.stage}: ${s.status}`).join('\n')}\n\nCommit: ${report.commit||env.GITHUB_SHA}\n\nWorker: ${report.worker?.version||'not confirmed'}\nDeployment: ${report.worker?.deployment||'not confirmed'}\nVercel: ${report.frontend?.deployment||report.vercel?.deployment||'not confirmed'}\n\nFailure requires investigation; no automatic D1 rollback.\n`);
  }
}
