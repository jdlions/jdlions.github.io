import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {studentSubmissions,diffText,wordTokens} from '../../assets/js/shared/submission-diff.js';
import {characterCount} from '../../assets/js/shared/character-count.js';
import {D1EditorialRepository} from '../src/repository.js';

function check(previous,current,options){const r=diffText(previous,current,options);assert.equal(r.parts.filter(p=>p.kind!=='add').map(p=>p.text).join(''),previous);assert.equal(r.parts.filter(p=>p.kind!=='remove').map(p=>p.text).join(''),current);assert.equal(r.previousCount,characterCount(previous));assert.equal(r.currentCount,characterCount(current));return r;}
test('initial submission unavailable; multiple resubmissions use latest and immediately previous student submission',()=>{
  const revisions=[{id:'1',authorRole:'student',revisionKind:'submission',revisionNumber:1,contentHtml:'one'},{id:'2',authorRole:'admin',revisionKind:'editor_save',revisionNumber:2,contentHtml:'TEACHER'},{id:'3',authorRole:'student',revisionKind:'resubmission',revisionNumber:3,contentHtml:'two'},{id:'4',authorRole:'student',revisionKind:'import',revisionNumber:4,contentHtml:'IMPORT'},{id:'5',authorRole:'student',revisionKind:'resubmission',revisionNumber:5,contentHtml:'three'},{id:'6',authorRole:'admin',revisionKind:'status_change',revisionNumber:6,contentHtml:'ADMIN'}];
  assert.equal(studentSubmissions(revisions.slice(0,2)).length,1);assert.deepEqual(studentSubmissions(revisions).map(r=>r.id),['5','3','1']);assert.equal(revisions[0].id,'1');
});
test('Korean/English word tokens preserve every whitespace and grapheme',()=>{const text='한국어 문장과 English, é 👩‍💻!\n  다음 문단';assert.equal(wordTokens(text).join(''),text);const r=check('오늘 학교에서 news를 읽었습니다.','오늘 학교에서 새로운 news를 읽었습니다.');assert.equal(r.parts.filter(p=>p.kind==='add').map(p=>p.text).join(''),'새로운 ');assert.equal(r.removedCount,0);});
for(const [name,a,b] of [['unchanged','같은 원고','같은 원고'],['insert','','한글 English'],['remove','삭제할 문단',''],['paragraph insert','첫 문단\n마지막 문단','첫 문단\n새 문단\n마지막 문단'],['paragraph delete','첫 문단\n이전 문단\n마지막','첫 문단\n마지막'],['spaces','A B','A  B'],['linebreak','A B','A\nB'],['Unicode','é 👩‍💻','é 👨‍💻'],['punctuation','학교, 신문!','학교 신문?']])test('lossless diff '+name,()=>check(a,b));
test('generated token edits always reconstruct both immutable submissions',()=>{
  let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;},tokens=['한글','English',' ','\n','!','학교','A'];
  for(let i=0;i<300;i++){const before=Array.from({length:random()%25},()=>tokens[random()%tokens.length]),after=[...before];after.splice(random()%(after.length+1),random()%4,...Array.from({length:random()%4},()=>tokens[random()%tokens.length]));check(before.join(''),after.join(''));}
});
test('long 300K-character manuscript keeps localized word diff bounded and all-change fallback is lossless',()=>{
  const prefix='학교 English news 원고.\n'.repeat(10000).slice(0,149997),suffix='한글 문단.\n'.repeat(22000).slice(0,149997),start=performance.now();
  const r=check(prefix+'이전 문장'+suffix,prefix+'최신 문장'+suffix);assert.equal(r.coarse,false);assert(performance.now()-start<5000);
  const big=check('old word '.repeat(15000),'새로운 문장 '.repeat(15000),{maxDistance:50,maxWork:10000});assert.equal(big.coarse,true);assert(big.parts.length<=4);
});
test('oversized legacy manuscripts are rejected before tokenization, never truncated or rewritten',()=>{assert.throws(()=>diffText('a'.repeat(300001),'b'.repeat(300001)),/comparison_too_large/);});
test('real D1 revision records exclude teacher checkpoints/status/import without changing existing history',async()=>{
  const sql=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const db={prepare(query){let args=[];const statement={bind(...values){args=values;return statement;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};return statement;},async batch(items){sql.exec('BEGIN');try{const r=[];for(const s of items)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const repo=new D1EditorialRepository(db);let a=await repo.createNativeArticle({articleType:'school',titleKo:'기사',titleEn:'',contentHtml:'<p>처음 원고</p>'},'student');
  a=await repo.submitNativeArticle(a,'student');await repo.saveEditorDraft(a,{contentHtml:'<p>TEACHER</p>',checkpoint:true},'admin');a=await repo.setNativeStatus(a,'revision_requested','admin');
  a=await repo.importStudentDraft(a,'<p>import only</p>','student');a=await repo.saveStudentDraft(a.id,{articleType:'school',titleKo:'기사',titleEn:'',contentHtml:'<p>수정 원고</p>'});await repo.submitNativeArticle(a,'student');
  const history=await repo.listRevisions(a.id),before=JSON.stringify(history),submissions=studentSubmissions(history);
  assert.equal(submissions.length,2);assert.equal(submissions[0].revisionKind,'resubmission');assert.equal(submissions[0].contentHtml,'<p>수정 원고</p>');assert.equal(submissions[1].contentHtml,'<p>처음 원고</p>');assert.equal(JSON.stringify(await repo.listRevisions(a.id)),before);sql.close();
});
