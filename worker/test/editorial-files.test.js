import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {EditorialFiles,validateEditorialFile,routeEditorialFiles} from '../src/editorial-files.js';
import {editorialDrive,CHUNK_BYTES} from '../src/editorial-drive.js';
import {fileFingerprint} from '../../assets/js/admin/editorial-files.js';
import worker from '../src/index.js';
import {seal,SESSION_COOKIE} from '../src/security.js';
const bytes=new Uint8Array([1,2,3,4]);
const fingerprint=await fileFingerprint(new Blob([bytes]));
const input=(ticket,overrides={})=>({ticket,originalFilename:'진짜최종.afpub',editorName:'유현승',changeNote:'School 수정',fileSize:4,contentHash:fingerprint,...overrides});
function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const db={prepare(query){let args=[];const s={bind(...values){args=values;return s;},first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>sql.prepare(query).run(...args),exec:()=>sql.prepare(query).run(...args)};return s;},async batch(stmts){sql.exec('BEGIN');try{const result=stmts.map(s=>s.exec());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const files=new Map();let ids=0;
  const drive={async id(){return 'file-'+(++ids);},async folder(){return 'private-folder';},async start(v,parent){files.set(v.drive_file_id,{id:v.drive_file_id,name:v.normalized_filename,parents:[parent],data:new Uint8Array(0)});return 'https://www.googleapis.com/upload/drive/test/'+v.drive_file_id;},async send(v,token,body,offset){const f=files.get(v.drive_file_id);if(body){assert.equal(offset,f.data.length);const data=new Uint8Array(offset+body.byteLength);data.set(f.data);data.set(body,offset);f.data=data;}return {offset:f.data.length,done:f.data.length===v.file_size};},async metadata(id){const f=files.get(id);return {...f,size:f.data.length,md5Checksum:'drive-md5'};},async download(id){return new Response(files.get(id).data);}};
  const repo=new EditorialFiles(db,drive);
  return {sql,db,drive,repo,files,async project(){await repo.create({year:2026,season:'Winter'},'token');return '2026_Winter';},async upload(project,overrides={},ticket){ticket||=(await repo.begin(project,'shared-editor')).ticket;const start=await repo.upload(project,'shared-editor',input(ticket,overrides),'token');if(!start.done){await repo.progress(start.id,'shared-editor','token',bytes,0);await repo.finish(start.id,'shared-editor','token');}return start;}};
}
test('v001/v002 append, normalize extensions, retain original metadata and serve every private version',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project();
  await f.upload(p);await f.upload(p,{originalFilename:'asdf.af',editorName:'김우준',changeNote:'Featured 수정'});
  const d=await f.repo.detail(p);assert.equal(d.latest.version,2);assert.equal(d.versions.length,2);
  assert.equal(d.latest.normalized_filename,'2026_Winter_v002.af');assert.equal(d.versions[1].normalized_filename,'2026_Winter_v001.afpub');
  assert.equal(d.latest.editor_name,'김우준');assert.equal(d.latest.change_note,'Featured 수정');assert.equal(d.latest.original_filename,'asdf.af');assert(d.latest.uploaded_at);assert.equal(d.latest.md5,'drive-md5');assert.equal(d.latest.content_hash,fingerprint);assert.equal(d.latest.base_version,1);assert.equal(f.files.size,2);
  assert.doesNotMatch(JSON.stringify(d),/upload_url|accessToken|edit_session_id/);
  for(const n of [1,2]){const response=await f.repo.download(p,n,'token');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.match(response.headers.get('Content-Disposition'),/attachment/);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);}
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('required editor, format, size, filename and fingerprint validation',()=>{
  for(const overrides of [{editorName:''},{editorName:' '},{editorName:'x'.repeat(81)},{originalFilename:'x.pdf'},{originalFilename:'x.af.exe'},{fileSize:0},{fileSize:1024**3+1},{fileSize:1.5},{contentHash:''},{changeNote:'x'.repeat(2001)}])assert.throws(()=>validateEditorialFile(input('ticket',overrides)),{status:400});
  for(const extension of ['af','afpub','afdesign','afphoto','AF'])assert.equal(validateEditorialFile(input('t',{originalFilename:'random.'+extension})).extension,extension.toLowerCase());
});
test('same shared account has independent edit bases; stale upload never reserves or contacts Drive',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project();await f.upload(p);
  const a=await f.repo.begin(p,'shared-editor'),b=await f.repo.begin(p,'shared-editor');assert.notEqual(a.ticket,b.ticket);
  await f.upload(p,{editorName:'B'},b.ticket);
  await assert.rejects(f.repo.upload(p,'shared-editor',input(a.ticket),'token'),{status:409});assert.equal(f.files.size,2);assert.equal((await f.repo.detail(p)).latest.version,2);
});
test('concurrent CAS admits one uploader and retry is idempotent',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),a=await f.repo.begin(p,'shared-editor'),b=await f.repo.begin(p,'shared-editor');
  const results=await Promise.allSettled([a,b].map(x=>f.repo.upload(p,'shared-editor',input(x.ticket),'token')));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
  const chosen=results.find(x=>x.status==='fulfilled').value;await f.repo.progress(chosen.id,'shared-editor','token',bytes,0);const saved=await f.repo.finish(chosen.id,'shared-editor','token');assert.equal(saved.version,1);assert.equal((await f.repo.finish(chosen.id,'shared-editor','token')).id,saved.id);
  const ticket=f.sql.prepare('SELECT edit_session_id FROM editorial_versions WHERE id=?').get(chosen.id).edit_session_id;assert.equal((await f.repo.upload(p,'shared-editor',input(ticket),'token')).done,true);
});
test('interruption preserves latest; cancel never deletes Drive and late finalize cannot publish',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project();await f.upload(p);const ticket=await f.repo.begin(p,'shared-editor'),s=await f.repo.upload(p,'shared-editor',input(ticket.ticket),'token');
  await assert.rejects(f.repo.finish(s.id,'shared-editor','token'),{status:409});assert.equal((await f.repo.detail(p)).latest.version,1);
  await f.repo.progress(s.id,'shared-editor','token',bytes,0);await f.repo.cancel(s.id,'shared-editor');await assert.rejects(f.repo.finish(s.id,'shared-editor','token'),{status:409});assert.equal(f.files.size,2);await f.upload(p);assert.equal((await f.repo.detail(p)).latest.version,2);assert.equal(f.files.size,3);
});
test('retry identity, chunk bounds and server fingerprint prevent mixing local files',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),b=await f.repo.begin(p,'shared-editor'),s=await f.repo.upload(p,'shared-editor',input(b.ticket),'token');
  await assert.rejects(f.repo.upload(p,'shared-editor',input(b.ticket,{contentHash:'a'.repeat(64)}),'token'),{status:409});
  await assert.rejects(f.repo.progress(s.id,'shared-editor','token',bytes,1),{status:400});
  await f.repo.progress(s.id,'shared-editor','token',new Uint8Array([4,3,2,1]),0);await assert.rejects(f.repo.finish(s.id,'shared-editor','token'),{status:409});
  await assert.rejects(f.repo.progress(s.id,'shared-editor','token',bytes,0),{status:409});assert.equal((await f.repo.detail(p)).latest,null);
});
test('multi-chunk upload and lost final status recover; hashes cover all bytes',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),data=new Uint8Array(CHUNK_BYTES+7).fill(42),ticket=await f.repo.begin(p,'shared-editor');
  const hash=await fileFingerprint(new Blob([data]));const s=await f.repo.upload(p,'shared-editor',input(ticket.ticket,{fileSize:data.length,contentHash:hash}),'token');
  assert.equal((await f.repo.progress(s.id,'shared-editor','token',data.slice(0,CHUNK_BYTES),0)).done,false);
  assert.equal((await f.repo.progress(s.id,'shared-editor','token')).offset,CHUNK_BYTES);
  await f.repo.progress(s.id,'shared-editor','token',data.slice(CHUNK_BYTES),CHUNK_BYTES);f.drive.send=async()=>{throw new Error('expired session');};
  assert.equal((await f.repo.progress(s.id,'shared-editor','token')).done,true);assert.equal((await f.repo.finish(s.id,'shared-editor','token')).file_size,data.length);
});
test('another login cannot reuse a ticket/reservation; incomplete files are never downloadable',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),ticket=await f.repo.begin(p,'shared-editor');
  await assert.rejects(f.repo.upload(p,'outsider',input(ticket.ticket),'token'),{status:409});
  const s=await f.repo.upload(p,'shared-editor',input(ticket.ticket),'token');await assert.rejects(f.repo.cancel(s.id,'outsider'),{status:404});await assert.rejects(f.repo.download(p,1,'token'),{status:404});
});
test('Worker routes retain auth/admin/Origin/CSRF checks and private metadata',async t=>{
  const f=fixture();t.after(()=>f.sql.close());await f.project();let student=false;
  t.mock.method(globalThis,'fetch',async url=>String(url).endsWith('/userProfiles/me')?Response.json({id:student?'s':'a'}):String(url).includes('/teachers/')&&student?new Response('',{status:404}):Response.json({userId:student?'s':'a'}));
  const env={DB:f.db,SESSION_SECRET:'editorial-files-test-secret',NEWSPAPER_CLASSROOM_ID:'files-course'};
  const cookie=async sub=>`${SESSION_COOKIE}=${await seal({sub,courseId:env.NEWSPAPER_CLASSROOM_ID,accessToken:'test',exp:Date.now()+60000},env.SESSION_SECRET)}`;
  const headers={Cookie:await cookie('files-admin'),Origin:'https://worker.example','X-Editorial-CSRF':'1'};
  const send=(path,method='GET',extra={})=>worker.fetch(new Request('https://worker.example/api/editorial-files/'+path,{method,headers:{...headers,...extra}}),env);
  assert.equal((await send('projects','GET',{Cookie:''})).status,401);
  for(const extra of [{Origin:'https://evil.example'},{'X-Editorial-CSRF':''}])assert.equal((await send('projects/2026_Winter/begin','POST',extra)).status,403);
  const good=await send('projects/2026_Winter');assert.equal(good.status,200);assert.equal(good.headers.get('Cache-Control'),'private, no-store');
  student=true;const studentCookie=await cookie('files-student');for(const p of ['projects','projects/2026_Winter','projects/2026_Winter/versions/1/download'])assert.equal((await send(p,'GET',{Cookie:studentCookie})).status,403);
});
test('Drive adapter creates private immutable files and proxies bounded resumable chunks',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),init});if(String(url).includes('generateIds'))return Response.json({ids:['id-1']});if(String(url).includes('uploadType'))return new Response(null,{headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=private'}});if(init.method==='PUT')return new Response(null,{status:308,headers:{Range:'bytes=0-3'}});return Response.json({id:'folder'});});
  await editorialDrive.folder('2026_Winter','secret');assert.equal(await editorialDrive.id('secret'),'id-1');const v={drive_file_id:'id-1',normalized_filename:'2026_Winter_v001.af',file_size:8};v.upload_url=await editorialDrive.start(v,'folder','secret');assert.equal((await editorialDrive.send(v,'secret',bytes,0)).offset,4);
  assert.equal(calls[0].init.method,'POST');assert.deepEqual(JSON.parse(calls[2].init.body).parents,['folder']);assert.equal(JSON.parse(calls[2].init.body).id,'id-1');assert(calls.every(x=>!x.url.includes('permissions')&&x.init.method!=='DELETE'&&x.init.method!=='PATCH'));assert.equal(calls.at(-1).init.headers['Content-Range'],'bytes 0-3/8');
});
test('Worker HTTP upload/download routes persist real D1 metadata, bound request sizes and require cancel confirmation',async t=>{
  const f=fixture();t.after(()=>f.sql.close());await f.project();for(const name of Object.keys(f.drive))t.mock.method(editorialDrive,name,f.drive[name]);
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'admin',userId:'admin'}));
  const env={DB:f.db,SESSION_SECRET:'http-files-secret',NEWSPAPER_CLASSROOM_ID:'http-files-course'};
  const headers={Cookie:`${SESSION_COOKIE}=${await seal({sub:'shared-editor',courseId:env.NEWSPAPER_CLASSROOM_ID,accessToken:'test',exp:Date.now()+60000},env.SESSION_SECRET)}`,Origin:'https://worker.example','X-Editorial-CSRF':'1'};
  const send=(path,method='POST',body,extra={})=>worker.fetch(new Request('https://worker.example/api/editorial-files/'+path,{method,headers:{...headers,...extra},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}),env);
  const ticket=await (await send('projects/2026_Winter/begin')).json();
  const start=await (await send('projects/2026_Winter/upload','POST',input(ticket.ticket))).json();assert(start.id);
  assert.equal((await send('uploads/'+start.id+'/cancel','POST',{confirmation:'no'})).status,400);
  assert.equal((await send('uploads/'+start.id+'/chunk','PUT',new Uint8Array(CHUNK_BYTES+1))).status,413);
  assert.equal((await send('uploads/'+start.id+'/chunk','PUT',bytes,{'X-Upload-Offset':'0'})).status,200);
  assert.equal((await send('uploads/'+start.id+'/finish')).status,200);
  const response=await send('projects/2026_Winter/versions/1/download','GET');assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.match(response.headers.get('Content-Disposition'),/2026_Winter_v001.afpub/);
});
test('D1 finalize failure rolls back latest pointer and can be retried without a second Drive file',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),ticket=await f.repo.begin(p,'shared-editor'),s=await f.repo.upload(p,'shared-editor',input(ticket.ticket),'token');await f.repo.progress(s.id,'shared-editor','token',bytes,0);
  const batch=f.db.batch;f.db.batch=async()=>{throw new Error('temporary DB failure');};await assert.rejects(f.repo.finish(s.id,'shared-editor','token'));assert.equal((await f.repo.detail(p)).latest,null);f.db.batch=batch;
  await f.repo.finish(s.id,'shared-editor','token');assert.equal((await f.repo.detail(p)).latest.version,1);assert.equal(f.files.size,1);
});
test('partially acknowledged Drive chunk resumes its suffix without changing its canonical hash',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),ticket=await f.repo.begin(p,'shared-editor'),s=await f.repo.upload(p,'shared-editor',input(ticket.ticket),'token');
  const send=f.drive.send;let partial=true;f.drive.send=async(v,token,body,offset)=>{if(body&&partial){partial=false;await send(v,token,body.slice(0,2),offset);throw new Error('connection lost');}return send(v,token,body,offset);};
  await assert.rejects(f.repo.progress(s.id,'shared-editor','token',bytes,0));assert.equal((await f.repo.progress(s.id,'shared-editor','token')).offset,2);await f.repo.progress(s.id,'shared-editor','token',bytes,0);assert.equal((await f.repo.finish(s.id,'shared-editor','token')).version,1);
});
