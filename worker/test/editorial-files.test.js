import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {EditorialFiles,validateEditorialFile,routeEditorialFiles} from '../src/editorial-files.js';
import {editorialDrive,CHUNK_BYTES} from '../src/editorial-drive.js';
import {fileFingerprint} from '../../assets/js/admin/editorial-files.js';
import worker from '../src/index.js';
import {sendEditorialSlack} from '../src/editorial-slack.js';
import {seal,SESSION_COOKIE} from '../src/security.js';
const bytes=new Uint8Array([1,2,3,4]);
const fingerprint=await fileFingerprint(new Blob([bytes]));
const input=(ticket,overrides={})=>({lockId:ticket,originalFilename:'진짜최종.afpub',editorName:'유현승',changeNote:'School 수정',fileSize:4,contentHash:fingerprint,...overrides});
function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const db={prepare(query){let args=[];const s={bind(...values){args=values;return s;},first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>sql.prepare(query).run(...args),exec:()=>sql.prepare(query).run(...args)};return s;},async batch(stmts){sql.exec('BEGIN');try{const result=stmts.map(s=>s.exec());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const files=new Map();let ids=0;
  const drive={async id(){return 'file-'+(++ids);},async folder(){return 'private-folder';},async start(v,parent){files.set(v.drive_file_id,{id:v.drive_file_id,name:v.normalized_filename,parents:[parent],data:new Uint8Array(0)});return 'https://www.googleapis.com/upload/drive/test/'+v.drive_file_id;},async send(v,token,body,offset){const f=files.get(v.drive_file_id);if(body){assert.equal(offset,f.data.length);const data=new Uint8Array(offset+body.byteLength);data.set(f.data);data.set(body,offset);f.data=data;}return {offset:f.data.length,done:f.data.length===v.file_size};},async metadata(id){const f=files.get(id);return {...f,size:f.data.length,md5Checksum:'drive-md5'};},async download(id){return new Response(files.get(id).data);}};
  sql.exec("UPDATE editorial_editors SET name=CASE role WHEN 'chief' THEN '유현승' ELSE '김우준' END");
  const repo=new EditorialFiles(db,drive,'chief');
  return {sql,db,drive,repo,files,async project(){await repo.create({year:2026,season:'Winter'},'token');return '2026_Winter';},async upload(project,overrides={},ticket){ticket||=(await repo.begin(project,'shared-editor')).lock.id;const start=await repo.upload(project,'shared-editor',input(ticket,overrides),'token');if(!start.done){await repo.progress(start.id,'shared-editor','token',bytes,0);await repo.finish(start.id,'shared-editor','token');}return start;}};
}
test('v001/v002 append, normalize extensions, retain original metadata and serve every private version',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project();
  await f.upload(p);f.repo.role='deputy';await f.upload(p,{originalFilename:'asdf.af',editorName:'김우준',changeNote:'Featured 수정'});
  const d=await f.repo.detail(p);assert.equal(d.latest.version,2);assert.equal(d.versions.length,2);
  assert.equal(d.latest.normalized_filename,'2026_Winter_v002.af');assert.equal(d.versions[1].normalized_filename,'2026_Winter_v001.afpub');
  assert.equal(d.latest.editor_name,'김우준');assert.equal(d.latest.change_note,'Featured 수정');assert.equal(d.latest.original_filename,'asdf.af');assert(d.latest.uploaded_at);assert.equal(d.latest.md5,'drive-md5');assert.equal(d.latest.content_hash,fingerprint);assert.equal(d.latest.base_version,1);assert.equal(f.files.size,2);
  assert.doesNotMatch(JSON.stringify(d),/upload_url|accessToken|edit_session_id/);
  for(const n of [1,2]){const response=await f.repo.download(p,n,'token');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.match(response.headers.get('Content-Disposition'),/attachment/);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);}
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('format, size, filename and fingerprint validation',()=>{
  for(const overrides of [{originalFilename:'x.pdf'},{originalFilename:'x.af.exe'},{fileSize:0},{fileSize:1024**3+1},{fileSize:1.5},{contentHash:''},{changeNote:'x'.repeat(2001)}])assert.throws(()=>validateEditorialFile(input('ticket',overrides)),{status:400});
  for(const extension of ['af','afpub','afdesign','afphoto','AF'])assert.equal(validateEditorialFile(input('t',{originalFilename:'random.'+extension})).extension,extension.toLowerCase());
});
test('simultaneous checkout admits one role; duplicate finish creates one version and audit',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project();
  const deputy=new EditorialFiles(f.db,f.drive,'deputy');
  const results=await Promise.allSettled([f.repo.begin(p,'shared-editor'),deputy.begin(p,'shared-editor')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const lock=(await f.repo.detail(p)).lock;f.repo.role=lock.owner_role;
  const s=await f.repo.upload(p,'shared-editor',input(lock.id),'token');await f.repo.progress(s.id,'shared-editor','token',bytes,0);
  const saved=await Promise.all([f.repo.finish(s.id,'shared-editor','token'),f.repo.finish(s.id,'shared-editor','token')]);assert.equal(saved[0].id,saved[1].id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM editorial_versions').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM editorial_lock_audit').get().n,1);
  assert.equal((await f.repo.upload(p,'shared-editor',input(lock.id),'token')).done,true);assert.equal((await f.repo.detail(p)).lock,null);
});
test('interruption preserves latest; cancel never deletes Drive and late finalize cannot publish',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project();await f.upload(p);const ticket=await f.repo.begin(p,'shared-editor'),s=await f.repo.upload(p,'shared-editor',input(ticket.lock.id),'token');
  await assert.rejects(f.repo.finish(s.id,'shared-editor','token'),{status:409});assert.equal((await f.repo.detail(p)).latest.version,1);
  await f.repo.progress(s.id,'shared-editor','token',bytes,0);await f.repo.checkout.close(ticket.lock.id,await f.repo.checkout.actor('chief','shared-editor'),false,'편집 취소',{});await assert.rejects(f.repo.finish(s.id,'shared-editor','token'),{status:409});assert.equal(f.files.size,2);await f.upload(p);assert.equal((await f.repo.detail(p)).latest.version,2);assert.equal(f.files.size,3);
});
test('retry identity, chunk bounds and server fingerprint prevent mixing local files',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),b=await f.repo.begin(p,'shared-editor'),s=await f.repo.upload(p,'shared-editor',input(b.lock.id),'token');
  await assert.rejects(f.repo.upload(p,'shared-editor',input(b.lock.id,{contentHash:'a'.repeat(64)}),'token'),{status:409});
  await assert.rejects(f.repo.progress(s.id,'shared-editor','token',bytes,1),{status:400});
  await f.repo.progress(s.id,'shared-editor','token',new Uint8Array([4,3,2,1]),0);await assert.rejects(f.repo.finish(s.id,'shared-editor','token'),{status:409});
  await assert.rejects(f.repo.progress(s.id,'shared-editor','token',bytes,0),{status:409});assert.equal((await f.repo.detail(p)).latest,null);
});
test('multi-chunk upload and lost final status recover; hashes cover all bytes',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),data=new Uint8Array(CHUNK_BYTES+7).fill(42),ticket=await f.repo.begin(p,'shared-editor');
  const hash=await fileFingerprint(new Blob([data]));const s=await f.repo.upload(p,'shared-editor',input(ticket.lock.id,{fileSize:data.length,contentHash:hash}),'token');
  assert.equal((await f.repo.progress(s.id,'shared-editor','token',data.slice(0,CHUNK_BYTES),0)).done,false);
  assert.equal((await f.repo.progress(s.id,'shared-editor','token')).offset,CHUNK_BYTES);
  await f.repo.progress(s.id,'shared-editor','token',data.slice(CHUNK_BYTES),CHUNK_BYTES);f.drive.send=async()=>{throw new Error('expired session');};
  assert.equal((await f.repo.progress(s.id,'shared-editor','token')).done,true);assert.equal((await f.repo.finish(s.id,'shared-editor','token')).file_size,data.length);
});
test('another login cannot reuse a ticket/reservation; incomplete files are never downloadable',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),ticket=await f.repo.begin(p,'shared-editor');
  await assert.rejects(f.repo.upload(p,'outsider',input(ticket.lock.id),'token'),{status:403});
  const s=await f.repo.upload(p,'shared-editor',input(ticket.lock.id),'token');await assert.rejects(f.repo.checkout.close(ticket.lock.id,await f.repo.checkout.actor('chief','outsider'),false,'편집 취소',{}),{status:403});await assert.rejects(f.repo.download(p,1,'token'),{status:404});
});
test('Worker routes retain auth/admin/Origin/CSRF checks and private metadata',async t=>{
  const f=fixture();t.after(()=>f.sql.close());await f.project();let student=false;
  t.mock.method(globalThis,'fetch',async url=>String(url).endsWith('/userProfiles/me')?Response.json({id:student?'s':'a'}):String(url).includes('/teachers/')&&student?new Response('',{status:404}):Response.json({userId:student?'s':'a'}));
  const env={DB:f.db,SESSION_SECRET:'editorial-files-test-secret',NEWSPAPER_CLASSROOM_ID:'files-course'};
  const cookie=async sub=>`${SESSION_COOKIE}=${await seal({sub,courseId:env.NEWSPAPER_CLASSROOM_ID,accessToken:'test',exp:Date.now()+60000},env.SESSION_SECRET)}`;
  const headers={Cookie:await cookie('files-admin'),Origin:'https://worker.example','X-Editorial-CSRF':'1'};
  const send=(path,method='GET',extra={})=>worker.fetch(new Request('https://worker.example/api/editorial-files/'+path,{method,headers:{...headers,...extra}}),env);
  assert.equal((await send('projects','GET',{Cookie:''})).status,401);
  for(const extra of [{Origin:'https://evil.example'},{'X-Editorial-CSRF':''}])assert.equal((await send('projects/2026_Winter/checkout','POST',extra)).status,403);
  const good=await send('projects/2026_Winter');assert.equal(good.status,200);assert.equal(good.headers.get('Cache-Control'),'private, no-store');
  student=true;const studentCookie=await cookie('files-student');for(const p of ['settings','editors','projects','projects/2026_Winter','projects/2026_Winter/versions/1/download'])assert.equal((await send(p,'GET',{Cookie:studentCookie})).status,403);
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
  assert.equal((await send('projects/2026_Winter/checkout')).status,403);
  const operatorResponse=await send('operator','POST',{role:'chief'});assert.equal(operatorResponse.status,200);const operatorCookie=operatorResponse.headers.get('Set-Cookie');assert.match(operatorCookie,/Secure/);assert.match(operatorCookie,/HttpOnly/);assert.match(operatorCookie,/SameSite=Lax/);headers.Cookie+='; '+operatorCookie.split(';')[0];
  const ticket=await (await send('projects/2026_Winter/checkout')).json();
  const start=await (await send('projects/2026_Winter/upload','POST',input(ticket.lock.id))).json();assert(start.id);
  assert.equal((await send('locks/'+ticket.lock.id+'/cancel','POST',{confirmation:'no'})).status,400);
  assert.equal((await send('uploads/'+start.id+'/chunk','PUT',new Uint8Array(CHUNK_BYTES+1))).status,413);
  assert.equal((await send('uploads/'+start.id+'/chunk','PUT',bytes,{'X-Upload-Offset':'0'})).status,200);
  assert.equal((await send('uploads/'+start.id+'/finish')).status,200);
  const response=await send('projects/2026_Winter/versions/1/download','GET');assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.match(response.headers.get('Content-Disposition'),/2026_Winter_v001.afpub/);
});
test('D1 finalize failure rolls back latest pointer and can be retried without a second Drive file',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),ticket=await f.repo.begin(p,'shared-editor'),s=await f.repo.upload(p,'shared-editor',input(ticket.lock.id),'token');await f.repo.progress(s.id,'shared-editor','token',bytes,0);
  const batch=f.db.batch;f.db.batch=async()=>{throw new Error('temporary DB failure');};await assert.rejects(f.repo.finish(s.id,'shared-editor','token'));assert.equal((await f.repo.detail(p)).latest,null);f.db.batch=batch;
  await f.repo.finish(s.id,'shared-editor','token');assert.equal((await f.repo.detail(p)).latest.version,1);assert.equal(f.files.size,1);
});
test('partially acknowledged Drive chunk resumes its suffix without changing its canonical hash',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),ticket=await f.repo.begin(p,'shared-editor'),s=await f.repo.upload(p,'shared-editor',input(ticket.lock.id),'token');
  const send=f.drive.send;let partial=true;f.drive.send=async(v,token,body,offset)=>{if(body&&partial){partial=false;await send(v,token,body.slice(0,2),offset);throw new Error('connection lost');}return send(v,token,body,offset);};
  await assert.rejects(f.repo.progress(s.id,'shared-editor','token',bytes,0));assert.equal((await f.repo.progress(s.id,'shared-editor','token')).offset,2);await f.repo.progress(s.id,'shared-editor','token',bytes,0);assert.equal((await f.repo.finish(s.id,'shared-editor','token')).version,1);
});

test('D1 checkout survives a fresh repository/device, blocks deputy, and keeps historical name snapshots',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),lock=(await f.repo.begin(p,'shared-editor')).lock;
  const recovered=new EditorialFiles(f.db,f.drive,'chief');assert.equal((await recovered.detail(p)).lock.id,lock.id);
  const deputy=new EditorialFiles(f.db,f.drive,'deputy');await assert.rejects(deputy.begin(p,'shared-editor'),{status:409});await assert.rejects(deputy.upload(p,'shared-editor',input(lock.id),'token'),{status:403});
  await f.upload(p,{},lock.id);const settings=await f.repo.checkout.settings();settings.editors[0].name='다음 편집장';await f.repo.checkout.saveSettings(settings);
  await f.upload(p);const d=await recovered.detail(p);assert.equal(d.latest.editor_name,'다음 편집장');assert.equal(d.versions[1].editor_name,'유현승');assert.equal(d.latest.editor_role,'chief');assert.equal(d.versions[1].editor_role,'chief');
});

test('forced close audits actor, sends one channel message without DM, and blocks late upload',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),lock=(await f.repo.begin(p,'shared-editor')).lock;
  const settings=await f.repo.checkout.settings();settings.channelEnabled=true;settings.channelId='C11111111';await f.repo.checkout.saveSettings(settings);
  const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});assert.equal(String(url),'https://slack.com/api/chat.postMessage');return Response.json({ok:true,ts:'123.456'});});
  const actor=await f.repo.checkout.actor('deputy','shared-editor'),env={SLACK_BOT_TOKEN:'mock-token'};
  await assert.rejects(f.repo.checkout.close(lock.id,actor,true,'no',env),{status:400});assert.equal(calls.length,0);
  const results=await Promise.all([f.repo.checkout.close(lock.id,actor,true,'강제 종료',env),f.repo.checkout.close(lock.id,actor,true,'강제 종료',env)]);
  assert(results.some(r=>r.notificationStatus==='sent'));assert.equal(calls.length,1);assert.equal(calls[0].body.channel,'C11111111');assert.match(calls[0].body.text,/부편집장 김우준이 편집장 유현승/);assert.equal(calls[0].body.mrkdwn,false);
  const d=await f.repo.detail(p);assert.equal(d.lock,null);assert.equal(d.audit.length,1);assert.equal(d.audit[0].actor_role,'deputy');assert.equal(d.audit[0].owner_name,'유현승');assert.equal(d.audit[0].notification_status,'sent');assert.doesNotMatch(JSON.stringify(d),/U11111111|slack_user_id/);
  await assert.rejects(f.repo.upload(p,'shared-editor',input(lock.id),'token'),{status:409});assert.equal(f.files.size,0);
});

test('Slack failure never revives forced lock or prevents committed version/channel notification',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project();const settings=await f.repo.checkout.settings();settings.channelEnabled=true;settings.channelId='C11111111';await f.repo.checkout.saveSettings(settings);f.repo.env={SLACK_BOT_TOKEN:'mock-token'};
  const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json({ok:false,error:'invalid_auth'});});
  const lock=(await f.repo.begin(p,'shared-editor')).lock;const closed=await f.repo.checkout.close(lock.id,await f.repo.checkout.actor('deputy','shared-editor'),true,'강제 종료',f.repo.env);assert.equal(closed.notificationStatus,'failed');assert.equal((await f.repo.detail(p)).lock,null);
  const s=await f.upload(p);assert.equal((await f.repo.finish(s.id,'shared-editor','token')).notificationStatus,'failed');const d=await f.repo.detail(p);assert.equal(d.latest.version,1);assert.equal(d.lock,null);assert.equal(calls.length,2);assert(calls.every(c=>c.url==='https://slack.com/api/chat.postMessage'&&c.body.channel==='C11111111'));assert.match(calls[1].body.text,/v1|School 수정/);assert.equal(calls[1].body.mrkdwn,false);assert.equal(calls[1].body.unfurl_links,false);
});

test('channel notification succeeds once after durable commit; retry is silent',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),settings=await f.repo.checkout.settings();settings.channelEnabled=true;settings.channelId='C11111111';await f.repo.checkout.saveSettings(settings);f.repo.env={SLACK_BOT_TOKEN:'mock'};let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;assert.equal(url,'https://slack.com/api/chat.postMessage');const body=JSON.parse(init.body);assert.equal(body.channel,'C11111111');assert.match(body.text,/v1 · 편집장 유현승/);assert.doesNotMatch(body.text,/수정 내용:|없음/);assert.equal((await f.repo.detail(p)).latest.version,1);assert.equal((await f.repo.detail(p)).lock,null);return Response.json({ok:true,ts:'123.789'});});
  const s=await f.upload(p,{changeNote:''});assert.equal((await f.repo.finish(s.id,'shared-editor','token')).notificationStatus,'sent');assert.equal(calls,1);
});

test('force versus finalization has a single terminal event and coherent latest pointer',async t=>{
  for(const forceFirst of [true,false]){
    const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),lock=(await f.repo.begin(p,'shared-editor')).lock,s=await f.repo.upload(p,'shared-editor',input(lock.id),'token');await f.repo.progress(s.id,'shared-editor','token',bytes,0);
    const actor=await f.repo.checkout.actor('deputy','shared-editor');
    if(forceFirst){const metadata=f.drive.metadata;f.drive.metadata=async id=>{await f.repo.checkout.close(lock.id,actor,true,'강제 종료',{});return metadata(id);};await assert.rejects(f.repo.finish(s.id,'shared-editor','token'),{status:409});}
    else{await f.repo.finish(s.id,'shared-editor','token');await f.repo.checkout.close(lock.id,actor,true,'강제 종료',{});}
    const d=await f.repo.detail(p);assert.equal(d.latest?.version||0,forceFirst?0:1);assert.equal(d.pendingId,null);assert.equal(d.lock,null);assert.equal(d.audit.length,1);assert.equal(d.audit[0].action,forceFirst?'forced':'completed');assert.equal(f.files.size,1);
  }
});

test('stale D1 baseline and missing named role cannot upload or contact Drive',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project();await assert.rejects(new EditorialFiles(f.db,f.drive).begin(p,'shared-editor'),{status:403});
  f.sql.prepare("UPDATE editorial_editors SET name='' WHERE role='chief'").run();await assert.rejects(f.repo.begin(p,'shared-editor'),{status:403});f.sql.prepare("UPDATE editorial_editors SET name='편집자' WHERE role='chief'").run();
  const lock=(await f.repo.begin(p,'shared-editor')).lock;f.sql.prepare('UPDATE editorial_projects SET latest_version=1 WHERE id=?').run(p);await assert.rejects(f.repo.upload(p,'shared-editor',input(lock.id),'token'),{status:409});assert.equal(f.files.size,0);
});

test('settings validate identifiers, do not return secret, and notification rate cap is durable',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),settings=await f.repo.checkout.settings();
  for(const channelId of ['https://evil.example','@channel'])await assert.rejects(f.repo.checkout.saveSettings({...settings,channelId}),{status:400});
  assert.deepEqual(Object.keys(settings.editors[0]).sort(),['name','role']);assert.equal('dmEnabled' in settings,false);settings.channelEnabled=true;settings.channelId='C11111111';
  await f.repo.checkout.saveSettings({...settings,editors:[{role:'chief',name:'유현승'},settings.editors[1]]});assert.equal(f.sql.prepare("SELECT slack_user_id FROM editorial_editors WHERE role='chief'").get().slack_user_id,'');
  await f.repo.checkout.saveSettings(settings);let calls=0;const actor=await f.repo.checkout.actor('deputy','shared-editor');
  for(let i=0;i<4;i++){const lock=(await f.repo.begin(p,'shared-editor')).lock;const r=await f.repo.checkout.close(lock.id,actor,true,'강제 종료',{SLACK_BOT_TOKEN:'mock'},async()=>{calls++;return {status:'sent'};});assert.equal(r.notificationStatus,i<3?'sent':'rate_limited');}
  assert.equal(calls,3);assert.doesNotMatch(JSON.stringify(await f.repo.checkout.settings()),/TOKEN|mock/);
});

test('Slack transport rejects arbitrary destinations and classifies ambiguous failure without retry',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});throw new Error('network timeout');});
  const event={action:'forced',owner_role:'chief',project_id:'2026_Winter',base_version:14};
  assert.equal((await sendEditorialSlack({SLACK_BOT_TOKEN:'mock'},event,'https://evil.example')).status,'skipped_unlinked');assert.equal(calls.length,0);
  for(const destination of ['U11111111','D11111111'])assert.equal((await sendEditorialSlack({SLACK_BOT_TOKEN:'mock'},event,destination)).status,'skipped_unlinked');
  assert.equal((await sendEditorialSlack({SLACK_BOT_TOKEN:'mock'},event,'C11111111')).status,'unknown');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://slack.com/api/chat.postMessage');assert.equal(calls[0].init.redirect,'error');
});

test('0007 upgrade preserves completed 0006 history and invalidates only tab-based pending reservations',async t=>{
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')&&x<'0007').sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  sql.exec("INSERT INTO editorial_projects VALUES('2026_Winter',2026,'Winter','folder',1,'pending','time'); INSERT INTO editorial_edit_sessions VALUES('s1','2026_Winter','user',0,'time'),('s2','2026_Winter','user',1,'time');");
  const insert=sql.prepare("INSERT INTO editorial_versions(id,project_id,version,base_version,edit_session_id,user_id,editor_name,change_note,original_filename,normalized_filename,extension,file_size,content_hash,drive_file_id,upload_url,state,created_at) VALUES(?,'2026_Winter',?,?,?,'user','Original name','','x.af','x.af','af',4,'hash',?,'private',?,'time')");insert.run('v1',1,0,'s1','file1','complete');insert.run('pending',2,1,'s2','file2','uploading');
  sql.exec(readFileSync(new URL('../migrations/0007_editorial_checkout.sql',import.meta.url),'utf8'));
  assert.equal(sql.prepare("SELECT state FROM editorial_versions WHERE id='v1'").get().state,'complete');assert.equal(sql.prepare("SELECT state FROM editorial_versions WHERE id='pending'").get().state,'cancelled');assert.equal(sql.prepare('SELECT latest_version FROM editorial_projects').get().latest_version,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM editorial_versions').get().n,2);assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('failure inside finalize batch rolls back all rows and retries the same Drive object',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),lock=(await f.repo.begin(p,'shared-editor')).lock;
  const s=await f.repo.upload(p,'shared-editor',input(lock.id),'token');await f.repo.progress(s.id,'shared-editor','token',bytes,0);
  f.sql.exec("CREATE TRIGGER injected_failure BEFORE UPDATE OF latest_version ON editorial_projects BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  await assert.rejects(f.repo.finish(s.id,'shared-editor','token'),/injected failure/);
  assert.equal(f.sql.prepare('SELECT state FROM editorial_versions WHERE id=?').get(s.id).state,'uploading');
  assert.equal((await f.repo.detail(p)).latest,null);assert.equal((await f.repo.detail(p)).lock.id,lock.id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM editorial_lock_audit').get().n,0);
  f.sql.exec('DROP TRIGGER injected_failure');
  assert.equal((await f.repo.finish(s.id,'shared-editor','token')).version,1);assert.equal(f.files.size,1);
  assert.equal((await f.repo.finish(s.id,'shared-editor','token')).version,1);
});

test('simultaneous upload initialization, missing/out-of-order chunks and retries preserve one reservation',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),lock=(await f.repo.begin(p,'shared-editor')).lock;
  const data=new Uint8Array(CHUNK_BYTES+4).fill(7),x=input(lock.id,{fileSize:data.length,contentHash:await fileFingerprint(new Blob([data]))});
  const starts=await Promise.all([f.repo.upload(p,'shared-editor',x,'token'),f.repo.upload(p,'shared-editor',x,'token')]);
  assert.equal(starts[0].id,starts[1].id);const id=starts[0].id;
  await assert.rejects(f.repo.progress(id,'shared-editor','token',data.slice(CHUNK_BYTES),CHUNK_BYTES),{status:409});
  await assert.rejects(f.repo.finish(id,'shared-editor','token'),{status:409});
  await f.repo.progress(id,'shared-editor','token',data.slice(0,CHUNK_BYTES),0);
  await f.repo.progress(id,'shared-editor','token',data.slice(0,CHUNK_BYTES),0);
  await f.repo.progress(id,'shared-editor','token',data.slice(CHUNK_BYTES),CHUNK_BYTES);
  assert.equal((await f.repo.finish(id,'shared-editor','token')).version,1);assert.equal(f.files.size,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM editorial_versions').get().n,1);
});

test('cancel during Drive verification prevents commit but preserves every original',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project(),lock=(await f.repo.begin(p,'shared-editor')).lock;
  const s=await f.repo.upload(p,'shared-editor',input(lock.id),'token');await f.repo.progress(s.id,'shared-editor','token',bytes,0);
  const metadata=f.drive.metadata;
  f.drive.metadata=async id=>{await f.repo.checkout.close(lock.id,await f.repo.checkout.actor('chief','shared-editor'),false,'편집 취소',{});return metadata(id);};
  await assert.rejects(f.repo.finish(s.id,'shared-editor','token'),{status:409});
  const d=await f.repo.detail(p);assert.equal(d.latest,null);assert.equal(d.lock,null);assert.equal(d.pendingId,null);assert.equal(d.audit.length,1);assert.equal(f.files.size,1);
});

test('editorial detail overlaps independent reads while keeping the project prerequisite',async t=>{
  const f=fixture();t.after(()=>f.sql.close());const p=await f.project();await f.upload(p);
  const prepare=f.db.prepare;let active=0,peak=0,count=0;
  f.db.prepare=query=>{
    const stmt=prepare(query);
    for(const method of ['first','all']){const run=stmt[method];stmt[method]=async()=>{
      count++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,20));
      try{return await run();}finally{active--;}
    };}
    return stmt;
  };
  const start=performance.now(),d=await f.repo.detail(p),ms=performance.now()-start;
  assert.equal(d.latest.version,1);assert.equal(count,5);assert.equal(peak,4);
  console.log('editorial read waves',JSON.stringify({queries:count,beforeWaves:5,afterWaves:2,injectedLatencyMs:20,afterMs:Math.round(ms)}));
});
