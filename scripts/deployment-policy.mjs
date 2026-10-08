import {createHash} from 'node:crypto';

export const sha256 = text => createHash('sha256').update(text).digest('hex');
export function isAdditiveMigration(sql) {
  // Conservative SQL tokenizer: ignore quoted literal contents and comments,
  // reject everything except nullable ADD COLUMN and an empty new TABLE.
  const tokens=sql.replace(/'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//g,match=>match.startsWith("'")?"''":' ');
  const statements=tokens.split(';').map(s=>s.trim()).filter(Boolean);
  return statements.length>0 && statements.every(statement=>{
    if(/\b(DROP|DELETE|UPDATE|INSERT|REPLACE|RENAME|TRIGGER|VACUUM|PRAGMA|ATTACH|DETACH|REFERENCES)\b/i.test(statement))return false;
    if(/^ALTER\s+TABLE\s+[a-z_]\w*\s+ADD\s+COLUMN\s+[a-z_]\w*\s+(INTEGER|TEXT|REAL|BLOB|NUMERIC)\b/i.test(statement))return !/\b(NOT\s+NULL|DEFAULT|UNIQUE|PRIMARY\s+KEY)\b/i.test(statement);
    return /^CREATE\s+TABLE\s+[a-z_]\w*\s*\(/i.test(statement)&&! /\bAS\s+SELECT\b/i.test(statement);
  });
}
// An exact, reviewed digest is required. A filename/comment alone cannot grant
// permission to run SQL against production. Unreviewed SQL stops the release.
export function migrationPlan(files, applied, approved) {
  const names = new Set(files.map(file => file.name));
  for (const name of applied) if (!names.has(name)) throw new Error('migration_history_mismatch');
  const pending = files.filter(file => !applied.includes(file.name)).sort((a,b)=>a.name.localeCompare(b.name));
  for (const file of pending) {
    const rule = approved[file.name];
    if (rule?.mode !== 'additive' || rule.sha256 !== sha256(file.sql) || !isAdditiveMigration(file.sql)) throw new Error('migration_manual_review_required');
  }
  return pending.map(file => file.name);
}

export function deploymentConfig(env) {
  const required = ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','VERCEL_TOKEN','VERCEL_PROJECT_ID','GITHUB_TOKEN','GITHUB_SHA'];
  const missing = required.filter(key=>!env[key]);
  if (missing.length) throw new Error('missing_configuration: '+missing.join(', '));
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA)) throw new Error('invalid_commit');
  if (env.GITHUB_REPOSITORY !== 'jdlions/jdlions.github.io' || env.GITHUB_REF !== 'refs/heads/main' || !['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) throw new Error('production_context_required');
  return {commit:env.GITHUB_SHA,account:env.CLOUDFLARE_ACCOUNT_ID,project:env.VERCEL_PROJECT_ID,team:env.VERCEL_TEAM_ID||null};
}

export function deploymentCommit(deployment) {
  // automationCommit is our request label, not proof of what Vercel built.
  return deployment?.gitSource?.sha || deployment?.meta?.githubCommitSha || null;
}

export async function waitForVercel(read, commit, {sleep,attempts=80}={}) {
  for(let attempt=0;attempt<attempts;attempt++) {
    const deployment=await read();
    const sha=deploymentCommit(deployment);
    if(sha && sha!==commit) throw new Error('vercel_commit_mismatch');
    if(['ERROR','CANCELED'].includes(deployment.readyState)) throw new Error('vercel_deployment_failed');
    if(deployment.readyState==='READY' && deployment.aliasAssigned) {
      if(sha!==commit || deployment.target!=='production') throw new Error('vercel_commit_mismatch');
      return deployment;
    }
    await sleep(15000);
  }
  throw new Error('vercel_timeout');
}

export async function deployProduction(adapter, config, record=()=>{}) {
  async function stage(name, fn) {
    record({stage:name,status:'running'});
    try {const value=await fn(); record({stage:name,status:'success',...(['worker','vercel'].includes(name)?{details:value}:{})});return value;}
    catch(error){record({stage:name,status:'failure'});throw error;}
  }
  await stage('preflight',()=>adapter.preflight(config));
  const pending=await stage('migration-plan',()=>adapter.migrationPlan());
  if(pending.length) await stage('migration-apply',()=>adapter.applyMigrations(pending));
  else record({stage:'migration-apply',status:'skipped'});
  // Re-read the remote ledger even when there were no migrations to apply.
  await stage('migration-verify',()=>adapter.verifyMigrations());
  const worker=await stage('worker',()=>adapter.deployWorker(config.commit));
  const frontend=await stage('vercel',()=>adapter.deployFrontend(config.commit));
  await stage('commit-and-traffic',()=>adapter.verifyRelease(config.commit,worker,frontend));
  await stage('production-smoke',()=>adapter.smoke(config.commit));
  return {commit:config.commit,worker,frontend,migrations:pending};
}
