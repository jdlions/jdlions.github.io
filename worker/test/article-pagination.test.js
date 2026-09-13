import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {articleListOptions,listArticlePage} from '../src/article-list.js';
import {D1EditorialRepository} from '../src/repository.js';
import worker from '../src/index.js';
import {seal,SESSION_COOKIE} from '../src/security.js';

function fixture(n=0){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const calls=[];const db={prepare(query){let args=[];const stmt={bind(...values){args=values;return stmt;},async all(){calls.push({query,args});return {results:sql.prepare(query).all(...args)};}};return stmt;}};
 const insert=sql.prepare('INSERT INTO articles(id,student_id,article_type,title_ko,title_en,status,draft_html,editor_draft_html,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
 function add(id,student='s',time='2026-01-01T00:00:00.000Z',status='draft',title='Title '+id){insert.run(id,student,'school',title,'English',status,'<p>'+('Synthetic words '.repeat(800))+'</p>','PRIVATE EDITOR','2026-01-01T00:00:00.000Z',time);}
 for(let i=0;i<n;i++)add(String(i).padStart(4,'0'));
 const page=(params={},student='s')=>listArticlePage(db,articleListOptions(new URLSearchParams(params),student),student);
 return {sql,db,calls,add,page};
}
for(const n of [0,1,19,20,21,60])test('cursor covers '+n+' articles exactly, including tied timestamps',async()=>{
 const f=fixture(n);let cursor='',ids=[],last;
 do{last=await f.page({cursor});assert(last.items.length<=20);ids.push(...last.items.map(x=>x.id));cursor=last.nextCursor;}while(cursor);
 assert.equal(ids.length,n);assert.equal(new Set(ids).size,n);assert.deepEqual(ids,[...ids].sort().reverse());assert.equal(last.nextCursor,null);f.sql.close();
});
test('new rows ahead of cursor do not shift next page; update snapshot requires refresh',async()=>{
 const f=fixture(41),first=await f.page();f.add('new','s',new Date(Date.now()+10000).toISOString());
 f.sql.prepare('UPDATE articles SET updated_at=? WHERE id=?').run(new Date(Date.now()+10000).toISOString(),'0000');
 const next=await f.page({cursor:first.nextCursor});assert.equal(next.items.length,20);assert(!next.items.some(x=>first.items.some(y=>y.id===x.id)));assert(!next.items.some(x=>x.id==='new'));f.sql.close();
});
test('literal search, filters, counts and picker are scoped without roster calls or bodies',async()=>{
 const f=fixture(25);f.add('other','outsider');f.add('literal','s',undefined,'approved','100%_literal');
 assert.equal((await f.page({q:' 100%_ '})).items.length,1);assert.equal((await f.page({q:'missing'})).stats.total,0);
 assert.equal((await f.page({q:'Title',status:'draft',type:'school',author:'s'})).stats.total,25);
 assert.equal((await f.page({author:'outsider'})).items.length,0);
 assert.equal((await f.page({campaign:'nonexistent'})).items.length,0);
 assert.equal((await f.page({status:'approved'})).stats.total,1);
 const picked=await f.page({picker:'1'});assert.equal(picked.items.length,20);assert(!picked.stats);assert.doesNotMatch(JSON.stringify(picked),/draftHtml|editorDraftHtml|internalNote|Synthetic/);
 f.sql.close();
});
test('assignment name/author display search and campaign filters span pages',async()=>{
 const f=fixture(25);
 f.sql.exec("INSERT INTO assignment_campaigns(id,name,status,created_by_user_id,created_at,updated_at) VALUES('c','Winter Project','active','t','2026','2026'); INSERT INTO assignment_slots(id,campaign_id,article_type,display_name,created_at,updated_at) VALUES('slot','c','school','School','2026','2026'); INSERT INTO assignment_recipients(campaign_id,student_id,student_name,assigned_at) VALUES('c','s','Test Author','2026');");
 for(let i=0;i<25;i++)f.sql.prepare('INSERT INTO assignment_slot_instances(id,campaign_id,slot_id,student_id,ordinal,article_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('i'+i,'c','slot','s',i+1,String(i).padStart(4,'0'),'2026','2026');
 const first=await f.page({q:'test author',campaign:'c'});assert.equal(first.stats.total,25);assert.equal(first.campaigns[0].name,'Winter Project');assert.equal((await f.page({q:'test author',campaign:'c',cursor:first.nextCursor})).items.length,5);
 assert.equal((await f.page({q:'Winter Project'})).stats.total,25);assert.equal((await f.page({campaign:'free'})).stats.total,0);f.sql.close();
});
test('invalid limits/cursors and cursor scope manipulation fail closed',async()=>{
 const f=fixture(21);
 for(const params of [{limit:'0'},{limit:'51'},{limit:'100000'},{limit:'NaN'},{limit:'1.5'},{cursor:'junk'},{q:'x'.repeat(201)}])assert.throws(()=>articleListOptions(new URLSearchParams(params),'s'),{status:400});
 const page=await f.page();assert.throws(()=>articleListOptions(new URLSearchParams({cursor:page.nextCursor}),'other'),{status:400});assert.throws(()=>articleListOptions(new URLSearchParams({cursor:page.nextCursor,q:'changed'}),'s'),{status:400});
 f.sql.close();
});
test('query and byte comparison plus execution plan on existing indexes',async()=>{
 const f=fixture(100),repo=new D1EditorialRepository(f.db),bytes=x=>Buffer.byteLength(JSON.stringify(x));
 const old=await repo.listNativeArticles('s',true);const before=f.calls.length;f.calls.length=0;
 const first=await f.page(),firstQueries=f.calls.length,plan=f.sql.prepare('EXPLAIN QUERY PLAN '+f.calls[0].query).all(...f.calls[0].args).map(x=>x.detail);
 f.calls.length=0;const next=await f.page({cursor:first.nextCursor,stats:'0'}),nextQueries=f.calls.length;
 f.calls.length=0;await f.page({q:'Title'});const searchQueries=f.calls.length;
 f.calls.length=0;await f.page({status:'draft'});const filterQueries=f.calls.length;
 assert.equal(before,1);assert.equal(firstQueries,3);assert.equal(nextQueries,1);assert.equal(searchQueries,3);assert.equal(filterQueries,3);assert(bytes(first)<bytes(old)/2);
 console.log('4A measurement',JSON.stringify({rows:100,beforeQueries:before,firstQueries,nextQueries,searchQueries,filterQueries,aggregateQueries:2,beforeBytes:bytes(old),firstBytes:bytes(first),nextBytes:bytes(next),plan}));f.sql.close();
});
test('HTTP student queries and forged cursor remain student-scoped and no-store',async t=>{
 const f=fixture(21);f.add('other','outsider');
 t.mock.method(globalThis,'fetch',async url=>Response.json(String(url).includes('userProfiles')?{id:'s'}:String(url).includes('/teachers/')?{}:{userId:'s'},{status:String(url).includes('/teachers/')?404:200}));
 const env={DB:f.db,SESSION_SECRET:'local-test',NEWSPAPER_CLASSROOM_ID:'pagination'};
 const token=await seal({sub:'s',studentId:'s',courseId:'pagination',accessToken:'test',exp:Date.now()+60000},env.SESSION_SECRET);
 const request=params=>worker.fetch(new Request('https://local.test/api/native/articles?'+new URLSearchParams({page:'1',...params}),{headers:{Cookie:SESSION_COOKIE+'='+token}}),env);
 const response=await request({studentId:'outsider'}),body=await response.json();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert(body.items.every(x=>x.studentId==='s'));assert.doesNotMatch(JSON.stringify(body),/internalNote|editorDraftHtml|draftHtml|PRIVATE EDITOR/);
 for(const params of [{q:'Title'},{status:'draft',author:'s'},{picker:'1'},{cursor:body.nextCursor,stats:'0'}]){const r=await request(params);assert.equal(r.status,200);const data=await r.json();assert(data.items.every(x=>x.studentId==='s'));assert.doesNotMatch(JSON.stringify(data),/internalNote|editorDraftHtml|draftHtml|PRIVATE EDITOR/);}
 assert.equal((await request({limit:'1000'})).status,400);assert.equal((await request({page:'2'})).status,400);f.sql.close();
});
