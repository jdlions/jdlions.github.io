import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {seal} from '../src/security.js';

export function memberDatabase(){
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const db={prepare(query){let args=[];const statement={bind(...values){args=values;return statement;},async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};return statement;},async batch(items){sql.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  return {sql,db};
}

// Legacy repository tests sometimes stub the article repository entirely. Supply
// real membership SQL separately in those fixtures, never bypass authentication.
export async function registerFixture(env,sub,role='student',options={}){
  if(!env.DB?.prepare){const f=memberDatabase();env.DB=f.db;}
  let row=await env.DB.prepare('SELECT * FROM members WHERE google_sub=?').bind(sub).first();
  if(!row){
    const n=Number((await env.DB.prepare('SELECT COUNT(*) n FROM members').bind().first()).n)+10000;
    const number=options.number||String(n),email=options.email||(role==='admin'?`teacher${n}@joongdong.hs.kr`:`h26${number}@joongdong.hs.kr`);
    await env.DB.prepare('INSERT INTO members(id,google_sub,email,name,role,student_number,cohort,active,created_at,updated_at,changed_by) VALUES(?,?,?,?,?,?,?,1,?,?,?)').bind(crypto.randomUUID(),sub,email,options.name||'Fixture',role==='admin'?'teacher':'student',role==='admin'?null:number,role==='admin'?null:36,'2026','2026','fixture').run();
    row=await env.DB.prepare('SELECT * FROM members WHERE google_sub=?').bind(sub).first();
  }
  return row;
}
export async function memberToken(env,claims,role='student'){
  const row=await registerFixture(env,claims.sub,role);
  return seal({...claims,membershipVersion:1,memberId:row.id,authVersion:row.auth_version},env.SESSION_SECRET);
}
