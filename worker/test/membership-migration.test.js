import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {Members} from '../src/members.js';
test('0009/0010 preserve every existing table and original Google-owned article when linking a registered account',async t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).sort().filter(n=>n.endsWith('.sql')&&n<'0009'))sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 sql.prepare('INSERT INTO articles(id,student_id,article_type,title_ko,title_en,status,draft_html,editor_draft_html,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('old-article','123','school','Existing title','','revision_requested','<p>Original manuscript</p>','<p>Teacher edits</p>','2026','2026');
 sql.prepare('INSERT INTO editorial_projects(id,year,season,folder_id,latest_version,created_at) VALUES(?,?,?,?,?,?)').run('old-project',2026,'Winter','private-folder',0,'2026');
 const tables=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const snapshot=()=>Object.fromEntries(tables.map(n=>[n,sql.prepare('SELECT * FROM "'+n+'"').all()]));const before=snapshot();
 sql.exec(readFileSync(new URL('../migrations/0009_members.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../migrations/0010_member_assignment_targets.sql',import.meta.url),'utf8'));assert.deepEqual(snapshot(),before);
 const db={prepare(q){let a=[];const s={bind(...v){a=v;return s;},async first(){return sql.prepare(q).get(...a)??null;},async all(){return {results:sql.prepare(q).all(...a)};},async run(){return sql.prepare(q).run(...a);}};return s;},async batch(items){sql.exec('BEGIN');try{const results=[];for(const item of items)results.push(await item.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const members=new Members(db);await members.save(null,{name:'Registered student',email:'h2611001@joongdong.hs.kr',role:'student',studentNumber:'11001',cohort:36,active:true},{memberId:'bootstrap-editor'});
 const session=await members.login({sub:'123',email:'h2611001@joongdong.hs.kr'});assert.equal(session.studentId,'123');
 assert.equal(sql.prepare('SELECT id FROM articles WHERE student_id=?').get(session.studentId).id,'old-article');assert.deepEqual(snapshot(),before);assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
