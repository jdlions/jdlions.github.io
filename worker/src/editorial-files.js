import {editorialDrive,CHUNK_BYTES} from './editorial-drive.js';
const bad=(message,status=400,code='invalid_editorial_file')=>Object.assign(new Error(message),{status,code});
const conflict=()=>bad('편집을 시작한 이후 최신 버전이 변경되었거나 다른 업로드가 진행 중입니다. 최신본을 다시 확인해 주세요.',409,'editorial_conflict');
const now=()=>new Date().toISOString();
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
export const MAX_EDITORIAL_BYTES=1024*1024*1024;
export function validateEditorialFile(input){
  const name=String(input?.originalFilename||''),extension=name.split('.').pop().toLowerCase();
  if(!['af','afpub','afdesign','afphoto'].includes(extension)||name.length>255||/[\x00-\x1f]/.test(name))throw bad('Affinity 원본(.af, .afpub, .afdesign, .afphoto)을 선택해 주세요.');
  const editor=String(input.editorName||'').trim(),note=String(input.changeNote||'').trim();
  if(!editor||editor.length>80||note.length>2000)throw bad('수정자는 필수이며 80자, 수정 내용은 2,000자까지 입력할 수 있습니다.');
  if(!Number.isSafeInteger(input.fileSize)||input.fileSize<1||input.fileSize>MAX_EDITORIAL_BYTES)throw bad('파일은 최대 1 GiB까지 업로드할 수 있습니다.');
  if(!/^[a-f0-9]{64}$/.test(input.contentHash||''))throw bad('파일 확인값이 없습니다. 파일을 다시 선택해 주세요.');
  return {originalFilename:name,extension,editorName:editor,changeNote:note,fileSize:input.fileSize,contentHash:input.contentHash};
}
function publicVersion(v){if(!v)return null;const {upload_url,user_id,edit_session_id,...safe}=v;return safe;}
export class EditorialFiles {
  constructor(db,drive=editorialDrive){this.db=db;this.drive=drive;}
  stmt(sql,...args){return this.db.prepare(sql).bind(...args);}
  async project(id){const p=await this.stmt('SELECT * FROM editorial_projects WHERE id=?',id).first();if(!p)throw bad('프로젝트를 찾을 수 없습니다.',404);return p;}
  async list(){return (await this.stmt('SELECT id,year,season,latest_version,created_at FROM editorial_projects ORDER BY year DESC,season DESC').all()).results;}
  async create(input,token){
    if(!Number.isInteger(input?.year)||input.year<2020||input.year>2100||!['Summer','Winter'].includes(input.season))throw bad('연도와 계절을 확인해 주세요.');
    const id=`${input.year}_${input.season}`;
    if(await this.stmt('SELECT id FROM editorial_projects WHERE id=?',id).first())throw bad('이미 존재하는 프로젝트입니다.',409);
    const folder=await this.drive.folder(id,token);
    try{await this.stmt('INSERT INTO editorial_projects(id,year,season,folder_id,created_at) VALUES(?,?,?,?,?)',id,input.year,input.season,folder,now()).run();}
    catch{throw bad('프로젝트 등록 결과를 다시 확인해 주세요. 생성된 Drive 폴더는 삭제하지 않았습니다.',409);}
    return this.project(id);
  }
  async detail(id,before=Number.MAX_SAFE_INTEGER){
    const p=await this.project(id);
    const latest=await this.stmt("SELECT * FROM editorial_versions WHERE project_id=? AND version=? AND state='complete'",id,p.latest_version).first();
    const history=(await this.stmt("SELECT * FROM editorial_versions WHERE project_id=? AND state='complete' AND version<? ORDER BY version DESC LIMIT 51",id,before).all()).results;
    return {id:p.id,year:p.year,season:p.season,latest:publicVersion(latest),pendingId:p.pending_id,versions:history.slice(0,50).map(publicVersion),nextBefore:history.length>50?history[49].version:null};
  }
  async begin(id,user){
    const p=await this.project(id),ticket=crypto.randomUUID();
    await this.stmt('INSERT INTO editorial_edit_sessions VALUES(?,?,?,?,?)',ticket,id,user,p.latest_version,now()).run();
    const version=p.latest_version?await this.stmt("SELECT normalized_filename FROM editorial_versions WHERE project_id=? AND version=? AND state='complete'",id,p.latest_version).first():null;
    return {ticket,baseVersion:p.latest_version,filename:version?.normalized_filename,downloadUrl:p.latest_version?`/api/editorial-files/projects/${id}/versions/${p.latest_version}/download`:null};
  }
  async upload(id,user,input,token){
    const x=validateEditorialFile(input),ticket=await this.stmt('SELECT * FROM editorial_edit_sessions WHERE id=? AND project_id=? AND user_id=?',String(input.ticket||''),id,user).first();
    if(!ticket)throw bad('이 브라우저에서 최신본을 다운로드한 뒤 업로드해 주세요.',409);
    const previous=await this.stmt('SELECT * FROM editorial_versions WHERE edit_session_id=?',ticket.id).first();
    if(previous){
      if(previous.content_hash!==x.contentHash||previous.original_filename!==x.originalFilename||previous.file_size!==x.fileSize||previous.editor_name!==x.editorName||previous.change_note!==x.changeNote)throw bad('진행 중인 업로드와 파일/입력 정보가 다릅니다.',409);
      if(previous.state==='cancelled')throw bad('취소된 작업입니다. 최신본을 다시 다운로드해 주세요.',409);
      return this.prepare(previous,token);
    }
    const p=await this.project(id);if(p.latest_version!==ticket.base_version||p.pending_id)throw conflict();
    const v={id:crypto.randomUUID(),project_id:id,version:p.latest_version+1,base_version:p.latest_version,edit_session_id:ticket.id,user_id:user,editor_name:x.editorName,change_note:x.changeNote,original_filename:x.originalFilename,normalized_filename:`${id}_v${String(p.latest_version+1).padStart(3,'0')}.${x.extension}`,extension:x.extension,file_size:x.fileSize,drive_file_id:await this.drive.id(token),created_at:now()};
    // D1 batch is transactional. Only a successful compare-and-swap may insert a reservation.
    await this.db.batch([
      this.stmt('UPDATE editorial_projects SET pending_id=? WHERE id=? AND latest_version=? AND pending_id IS NULL',v.id,id,v.base_version),
      this.stmt("INSERT INTO editorial_versions(id,project_id,version,base_version,edit_session_id,user_id,editor_name,change_note,original_filename,normalized_filename,extension,file_size,content_hash,drive_file_id,state,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,'uploading',? WHERE EXISTS(SELECT 1 FROM editorial_projects WHERE id=? AND pending_id=?)",v.id,id,v.version,v.base_version,v.edit_session_id,user,v.editor_name,v.change_note,v.original_filename,v.normalized_filename,v.extension,v.file_size,x.contentHash,v.drive_file_id,v.created_at,id,v.id)
    ]);
    const saved=await this.stmt('SELECT * FROM editorial_versions WHERE id=?',v.id).first();if(!saved){if(await this.stmt('SELECT id FROM editorial_versions WHERE edit_session_id=?',ticket.id).first())return this.upload(id,user,input,token);throw conflict();}
    return this.prepare(saved,token);
  }
  async prepare(v,token){
    if(v.state==='complete')return {id:v.id,done:true,version:publicVersion(v)};
    if(!v.upload_url){
      const p=await this.project(v.project_id);if(p.pending_id!==v.id)throw conflict();
      const url=await this.drive.start(v,p.folder_id,token);
      await this.stmt("UPDATE editorial_versions SET upload_url=? WHERE id=? AND upload_url IS NULL AND state='uploading'",url,v.id).run();
    }
    return {id:v.id,done:false,chunkBytes:CHUNK_BYTES};
  }
  async owned(id,user){const v=await this.stmt('SELECT * FROM editorial_versions WHERE id=? AND user_id=?',id,user).first();if(!v)throw bad('업로드를 찾을 수 없습니다.',404);return v;}
  async progress(id,user,token,body=null,offset=0){
    const v=await this.owned(id,user);if(v.state==='complete')return {done:true,offset:v.file_size};
    const p=await this.project(v.project_id);if(v.state!=='uploading'||p.pending_id!==id||p.latest_version!==v.base_version)throw conflict();
    if(!v.upload_url)throw bad('업로드 시작을 다시 시도해 주세요.',409);
    if(body&&(!Number.isSafeInteger(offset)||offset<0||offset%CHUNK_BYTES!==0||body.byteLength!==Math.min(CHUNK_BYTES,v.file_size-offset)||body.byteLength<=0))throw bad('업로드 조각 범위가 올바르지 않습니다.');
    if(body){
      const hash=await digest(body);
      await this.stmt('INSERT OR IGNORE INTO editorial_upload_chunks VALUES(?,?,?)',id,offset,hash).run();
      const saved=await this.stmt('SELECT digest FROM editorial_upload_chunks WHERE upload_id=? AND offset=?',id,offset).first();
      if(saved.digest!==hash)throw bad('재시도한 파일 조각이 기존 파일과 다릅니다. 업로드를 중단하고 다시 시작해 주세요.',409);
    }
    try{
      if(body){
        const received=await this.drive.send(v,token,null,0);
        if(received.done||received.offset>=offset+body.byteLength)return received;
        if(received.offset<offset)throw bad('업로드 위치를 다시 확인해 주세요.',409);
        // Drive may acknowledge only part of an interrupted chunk. Hash the full
        // canonical chunk, but forward only the missing suffix.
        return await this.drive.send(v,token,body.slice(received.offset-offset),received.offset);
      }
      return await this.drive.send(v,token,null,0);
    }
    catch(error){
      // A completed Drive session may no longer answer status after a lost response.
      if(!body){try{const f=await this.drive.metadata(v.drive_file_id,token);if(!f.trashed&&Number(f.size)===v.file_size)return {offset:v.file_size,done:true};}catch{}}
      throw error;
    }
  }
  async finish(id,user,token){
    const v=await this.owned(id,user);if(v.state==='complete')return publicVersion(v);
    const p=await this.project(v.project_id);if(v.state!=='uploading'||p.pending_id!==id||p.latest_version!==v.base_version)throw conflict();
    const f=await this.drive.metadata(v.drive_file_id,token);
    if(f.id!==v.drive_file_id||f.trashed||Number(f.size)!==v.file_size||f.name!==v.normalized_filename||!f.parents?.includes(p.folder_id))throw bad('Drive 파일의 업로드 완료를 확인할 수 없습니다.',409);
    const chunks=(await this.stmt('SELECT offset,digest FROM editorial_upload_chunks WHERE upload_id=? ORDER BY offset',id).all()).results;
    if(chunks.length!==Math.ceil(v.file_size/CHUNK_BYTES)||chunks.some((x,i)=>x.offset!==i*CHUNK_BYTES))throw bad('파일 조각 검증이 완료되지 않았습니다.',409);
    const bytes=Uint8Array.from(chunks.flatMap(x=>x.digest.match(/../g).map(h=>parseInt(h,16))));
    if(await digest(bytes)!==v.content_hash)throw bad('파일 확인값이 일치하지 않습니다. 최신본은 변경되지 않았습니다.',409);
    await this.db.batch([
      this.stmt("UPDATE editorial_versions SET state='complete',uploaded_at=?,md5=?,upload_url=NULL WHERE id=? AND state='uploading' AND EXISTS(SELECT 1 FROM editorial_projects WHERE id=? AND pending_id=? AND latest_version=?)",now(),f.md5Checksum||null,id,p.id,id,v.base_version),
      this.stmt("UPDATE editorial_projects SET latest_version=?,pending_id=NULL WHERE id=? AND pending_id=? AND latest_version=? AND EXISTS(SELECT 1 FROM editorial_versions WHERE id=? AND state='complete')",v.version,p.id,id,v.base_version,id)
    ]);
    const saved=await this.owned(id,user);if(saved.state!=='complete')throw conflict();return publicVersion(saved);
  }
  async cancel(id,user){
    const v=await this.owned(id,user);if(v.state==='complete')throw bad('완료된 버전은 취소할 수 없습니다.',409);
    await this.db.batch([this.stmt("UPDATE editorial_versions SET state='cancelled',upload_url=NULL WHERE id=? AND state='uploading'",id),this.stmt('UPDATE editorial_projects SET pending_id=NULL WHERE id=? AND pending_id=?',v.project_id,id)]);
    return {cancelled:true}; // Never delete Drive content, including abandoned uploads.
  }
  async download(project,version,token){
    const v=await this.stmt("SELECT * FROM editorial_versions WHERE project_id=? AND version=? AND state='complete'",project,version).first();if(!v)throw bad('버전을 찾을 수 없습니다.',404);
    const r=await this.drive.download(v.drive_file_id,token);
    return new Response(r.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${v.normalized_filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
}
async function smallJson(request){const text=new TextDecoder().decode(await chunk(request,8192));try{return JSON.parse(text);}catch{throw bad('요청 형식이 올바르지 않습니다.');}}
async function chunk(request,maximum=CHUNK_BYTES){const reader=request.body?.getReader();if(!reader)throw bad('요청 본문이 없습니다.');const parts=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw bad('요청이 너무 큽니다.',413);}parts.push(value);}const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}return data;}
export async function routeEditorialFiles(request,env,viewer,path){
  if(viewer.role!=='admin')throw bad('관리자 권한이 필요합니다.',403,'admin_required');
  const repo=new EditorialFiles(env.DB),method=request.method,token=viewer.accessToken;
  const out=data=>Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
  if(path==='/api/editorial-files/projects'){
    if(method==='GET')return out(await repo.list());
    if(method==='POST')return out(await repo.create(await smallJson(request),token));
  }
  const p=path.match(/^\/api\/editorial-files\/projects\/([\w-]+)(?:\/(begin|upload|versions\/(\d+)\/download))?$/);
  if(p){
    if(!p[2]&&method==='GET'){const before=Number(new URL(request.url).searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)throw bad('잘못된 기록 위치입니다.');return out(await repo.detail(p[1],before));}
    if(p[2]==='begin'&&method==='POST')return out(await repo.begin(p[1],viewer.sub));
    if(p[2]==='upload'&&method==='POST')return out(await repo.upload(p[1],viewer.sub,await smallJson(request),token));
    if(p[3]&&method==='GET')return repo.download(p[1],Number(p[3]),token);
  }
  const u=path.match(/^\/api\/editorial-files\/uploads\/([\w-]+)\/(status|chunk|finish|cancel)$/);
  if(u){
    if(u[2]==='status'&&method==='POST')return out(await repo.progress(u[1],viewer.sub,token));
    if(u[2]==='chunk'&&method==='PUT')return out(await repo.progress(u[1],viewer.sub,token,await chunk(request),Number(request.headers.get('X-Upload-Offset'))));
    if(u[2]==='finish'&&method==='POST')return out(await repo.finish(u[1],viewer.sub,token));
    if(u[2]==='cancel'&&method==='POST'){if((await smallJson(request)).confirmation!=='중단')throw bad('확인란에 중단을 입력해 주세요.');return out(await repo.cancel(u[1],viewer.sub));}
  }
  throw bad('경로를 찾을 수 없습니다.',404);
}
