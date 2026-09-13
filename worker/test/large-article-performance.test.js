import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {articleListOptions,listArticlePage} from '../src/article-list.js';
for(const count of [1000,10000])test('large synthetic article dataset '+count,async()=>{
 const sql=new DatabaseSync(':memory:');
 for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const insert=sql.prepare('INSERT INTO articles(id,student_id,article_type,title_ko,status,draft_html,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
 sql.exec('BEGIN');for(let i=0;i<count;i++)insert.run(String(i).padStart(6,'0'),'student'+i%10,'school','Synthetic title '+i,i%2?'submitted':'draft','<p>'+('Synthetic text '.repeat(80))+'</p>','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');sql.exec('COMMIT');
 let queries=[];const db={prepare(query){let args=[];return {bind(...a){args=a;return this;},async all(){queries.push({query,args});return {results:sql.prepare(query).all(...args)};}};}};
 const request=(params,student)=>listArticlePage(db,articleListOptions(new URLSearchParams(params),student),student);
 const initial=await request({},null);let cursor=initial.nextCursor;
 // Reach the back with real cursors, without an offset shortcut.
 for(let i=0;i<count/20-2;i++)cursor=(await request({cursor,stats:'0'},null)).nextCursor;
 const result=[];
 for(const [name,params,student] of [['first',{},null],['back',{cursor,stats:'0'},null],['search',{q:'Synthetic title 99'},null],['status',{status:'draft'},null],['combined',{q:'Synthetic',type:'school',status:'draft',author:'student0'},null],['picker',{picker:'1'},'student0']]){
  queries=[];const start=performance.now(),page=await request(params,student),ms=performance.now()-start;
  const plans=queries.map(x=>sql.prepare('EXPLAIN QUERY PLAN '+x.query).all(...x.args).map(y=>y.detail));
  assert(page.items.length<=20);assert(!JSON.stringify(page).includes('draftHtml'));
  result.push({name,ms:Number(ms.toFixed(2)),queries:queries.length,bytes:Buffer.byteLength(JSON.stringify(page)),rows:page.items.length,plans});
 }
 console.log('large DB',JSON.stringify({count,results:result}));sql.close();
});
