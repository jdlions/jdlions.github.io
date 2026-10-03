import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

for(const count of [1000,10000])test('editorial history reuses the existing partial index at '+count+' versions',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
    db.exec("INSERT INTO editorial_projects VALUES('2026_Winter',2026,'Winter','fixture-folder',0,NULL,'time')");
    const session=db.prepare("INSERT INTO editorial_edit_sessions VALUES(?,'2026_Winter','fixture',0,'time')");
    const version=db.prepare("INSERT INTO editorial_versions(id,project_id,version,base_version,edit_session_id,user_id,editor_name,change_note,original_filename,normalized_filename,extension,file_size,content_hash,drive_file_id,state,created_at) VALUES(?,'2026_Winter',?,0,?,'fixture','Fixture','','x.af','x.af','af',4,'hash',?,'complete','time')");
    db.exec('BEGIN');for(let i=1;i<=count;i++){session.run('s'+i);version.run('v'+i,i,'s'+i,'file'+i);}db.exec('COMMIT');
    const base="SELECT * FROM editorial_versions WHERE project_id=? AND state='complete' AND version<?";
    const before=base+' ORDER BY version DESC LIMIT 51',after=base+" AND state!='cancelled' ORDER BY version DESC LIMIT 51",args=['2026_Winter',count+1];
    const measure=query=>{
      const stmt=db.prepare(query),times=[];let rows;
      for(let i=0;i<25;i++){const start=performance.now();rows=stmt.all(...args);times.push(performance.now()-start);}
      return {medianMs:Number(times.sort((a,b)=>a-b)[12].toFixed(3)),bytes:Buffer.byteLength(JSON.stringify(rows)),plan:db.prepare('EXPLAIN QUERY PLAN '+query).all(...args).map(x=>x.detail),rows};
    };
    const old=measure(before),next=measure(after);assert.deepEqual(next.rows,old.rows);
    assert(next.plan.some(x=>x.includes('editorial_version_number')));assert(!next.plan.some(x=>x.includes('TEMP B-TREE')));
    const plans={
      latest:db.prepare("EXPLAIN QUERY PLAN SELECT * FROM editorial_versions WHERE project_id=? AND version=? AND state='complete' AND state!='cancelled'").all('2026_Winter',count).map(x=>x.detail),
      lock:db.prepare('EXPLAIN QUERY PLAN SELECT id FROM editorial_locks WHERE project_id=? AND ended_at IS NULL').all('2026_Winter').map(x=>x.detail),
      audit:db.prepare('EXPLAIN QUERY PLAN SELECT id FROM editorial_lock_audit WHERE project_id=? ORDER BY created_at DESC LIMIT 30').all('2026_Winter').map(x=>x.detail),
      chunks:db.prepare('EXPLAIN QUERY PLAN SELECT offset,digest FROM editorial_upload_chunks WHERE upload_id=? ORDER BY offset').all('v1').map(x=>x.detail),
      photo:db.prepare('EXPLAIN QUERY PLAN SELECT * FROM photos WHERE article_id IS NOT NULL AND student_google_id=? ORDER BY created_at DESC').all('fixture').map(x=>x.detail)
    };
    delete old.rows;delete next.rows;console.log('editorial synthetic performance',JSON.stringify({count,before:old,after:next,plans}));
  }finally{db.close();}
});
