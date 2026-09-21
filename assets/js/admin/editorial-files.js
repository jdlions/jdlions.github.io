import {api,ApiError} from '../services/api-client.js';
import {escapeHtml as esc,loadingState} from '../shared/ui.js';
import {editorialConfig} from '../config.js';
import {fetchWithTimeout} from '../shared/request-timeout.js';
const base='/api/editorial-files';
const label=v=>'v'+String(v).padStart(3,'0');
const date=x=>new Date(x).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
const key=id=>'editorial-edit:'+id;
const read=id=>{try{return JSON.parse(sessionStorage.getItem(key(id))||'null');}catch{return null;}};
const write=(id,x)=>sessionStorage.setItem(key(id),JSON.stringify(x));
const download=(url,filename)=>{const a=document.createElement('a');a.href=editorialConfig.apiBaseUrl+url;a.download=filename||'';document.body.append(a);a.click();a.remove();};
// SHA-256 of ordered 2 MiB chunk digests: bounded memory and exact retry identity.
export async function fileFingerprint(file){const hashes=[];for(let i=0;i<file.size;i+=2*1024*1024)hashes.push(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.slice(i,i+2*1024*1024).arrayBuffer())));const bytes=new Uint8Array(hashes.length*32);hashes.forEach((h,i)=>bytes.set(h,i*32));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function createEditorialFiles(){
  let root,selected='',busy=false,generation=0;
  window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
  const message=(text,error=false)=>{const el=root?.querySelector('[data-file-status]');if(el){el.textContent=text;el.classList.toggle('notice--error',error);}};
  async function action(fn){if(busy)return;busy=true;root.querySelectorAll('button, input, textarea, select').forEach(x=>x.disabled=true);try{await fn();}catch(e){message(e.message,true);}finally{busy=false;root.querySelectorAll('button, input, textarea, select').forEach(x=>x.disabled=false);}}
  async function render(target){
    root=target;const generationId=++generation;
    root.innerHTML=loadingState('편집 파일 불러오는 중…');
    try{
      const projects=await api(base+'/projects');if(generationId!==generation||!root.isConnected)return;
      if(!projects.some(p=>p.id===selected))selected=projects[0]?.id||'';
      root.innerHTML=`<header class="page-head"><div><p class="eyebrow">PrideDesk</p><h1>편집 파일</h1><p>최신본을 다운로드해 편집한 뒤 새 버전을 올려주세요. 원본은 모두 보존됩니다.</p></div></header><div role="status" aria-live="polite" data-file-status></div><label class="field">편집 프로젝트<select data-file-project>${projects.map(p=>`<option value="${p.id}">${p.year} ${p.season} Edition</option>`).join('')}</select></label><details class="panel"><summary>새 편집 프로젝트</summary><form data-project-form class="form-grid"><label class="field">연도<input name="year" type="number" min="2020" max="2100" value="${new Date().getFullYear()}" required></label><label class="field">계절<select name="season"><option>Summer</option><option>Winter</option></select></label><button class="btn-primary">프로젝트 만들기</button></form><p>연도·계절별 전용 private Drive 폴더를 만듭니다. 신문 발행과는 별도로 관리됩니다.</p></details><div data-file-detail></div>`;
      const select=root.querySelector('[data-file-project]');select.value=selected;select.onchange=()=>{selected=select.value;show();};
      root.querySelector('[data-project-form]').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);action(async()=>{const p=await api(base+'/projects',{method:'POST',body:JSON.stringify({year:Number(f.get('year')),season:f.get('season')})});selected=p.id;await render(root);});};
      if(selected)await show();
    }catch(e){if(generationId!==generation)return;root.innerHTML=`<p role="status">${esc(e.message)}</p><button data-file-retry>다시 시도</button>`;root.querySelector('[data-file-retry]').onclick=()=>render(root);}
  }
  async function show(){
    const id=selected,stamp=++generation,container=root.querySelector('[data-file-detail]');container.innerHTML=loadingState();
    try{
      const d=await api(base+'/projects/'+id);if(stamp!==generation)return;
      const local=read(id),v=d.latest;
      container.innerHTML=`<section class="panel"><h2>${d.year} ${d.season} Edition</h2>${v?`<p>최신 버전 <strong>${label(v.version)}</strong></p><p>${esc(v.normalized_filename)}</p><p>수정자: ${esc(v.editor_name)} · 업로드: ${date(v.uploaded_at)}</p><p>${esc(v.change_note||'수정 내용 없음')}</p><p>파일 크기: ${(v.file_size/1024/1024).toFixed(1)} MiB</p>`:'<p>아직 편집 파일이 없습니다.</p>'}<button class="btn-primary" data-file-begin>${v?'최신본 다운로드':'최초 파일 업로드 준비'}</button><p>다운로드한 이 탭에서 새 버전을 업로드하세요. 다른 편집자의 탭을 함께 사용하지 마세요.</p><p data-file-baseline>${local?`이 탭의 작업 기준: ${label(local.baseVersion)}`:'작업 기준이 없습니다.'}</p></section>${d.pendingId?`<section class="notice"><p>완료되지 않은 업로드가 있습니다. 같은 파일로 재시도하거나, 담당자와 확인 후 중단하세요. Drive 파일은 삭제되지 않습니다.</p><label class="field">중단 확인<input data-cancel-text placeholder="중단"></label><button data-file-cancel>미완료 업로드 중단</button></section>`:''}<section class="panel"><h2>새 버전 업로드</h2><form data-version-form><label class="field">수정자 *<input name="editorName" required maxlength="80" autocomplete="off"></label><label class="field">수정 내용<textarea name="changeNote" maxlength="2000"></textarea></label><label class="field">파일 *<input type="file" name="file" accept=".af,.afpub,.afdesign,.afphoto" required></label><p>Affinity 원본 1개 · 최대 1 GiB · 원본 품질 유지</p><progress data-file-progress max="100" value="0" aria-label="편집 파일 업로드 진행률" hidden></progress><button class="btn-primary">새 버전 업로드</button></form></section><details class="panel"><summary>버전 기록</summary><div data-file-history></div><button data-history-more ${d.nextBefore?'':'hidden'}>이전 기록 더 보기</button></details>`;
      const history=container.querySelector('[data-file-history]');
      const append=rows=>{for(const x of rows){const p=document.createElement('p');p.innerHTML=`<a href="${editorialConfig.apiBaseUrl+base}/projects/${id}/versions/${x.version}/download" download>${label(x.version)} 다운로드</a> · ${esc(x.editor_name)} · ${date(x.uploaded_at)} · ${esc(x.change_note)}`;history.append(p);}};append(d.versions);
      let before=d.nextBefore;container.querySelector('[data-history-more]').onclick=()=>action(async()=>{const older=await api(base+'/projects/'+id+'?before='+before);append(older.versions);before=older.nextBefore;container.querySelector('[data-history-more]').hidden=!before;});
      container.querySelector('[data-file-begin]').onclick=()=>action(async()=>{
        if(read(id)&&!confirm('기존 작업 기준을 바꾸고 최신본으로 새 작업을 시작할까요? 이전 파일을 그대로 업로드하지 마세요.'))return;
        const ticket=await api(base+'/projects/'+id+'/begin',{method:'POST'});write(id,ticket);if(ticket.downloadUrl)download(ticket.downloadUrl,ticket.filename);await show();message('작업 기준을 기록했습니다. 다운로드한 파일을 편집해 주세요.');
      });
      container.querySelector('[data-file-cancel]')?.addEventListener('click',()=>action(async()=>{await api(base+'/uploads/'+d.pendingId+'/cancel',{method:'POST',body:JSON.stringify({confirmation:container.querySelector('[data-cancel-text]').value})});sessionStorage.removeItem(key(id));await show();message('미완료 업로드를 중단했습니다. 최신본부터 다시 시작해 주세요.');}));
      container.querySelector('[data-version-form]').onsubmit=e=>{e.preventDefault();const form=e.target,file=form.elements.file.files[0],fields={editorName:form.elements.editorName.value,changeNote:form.elements.changeNote.value};action(()=>upload(id,file,fields,form));};
    }catch(e){if(stamp!==generation)return;container.innerHTML=`<p>${esc(e.message)}</p><button data-detail-retry>다시 시도</button>`;container.querySelector('[data-detail-retry]').onclick=show;message(e.message,true);}
  }
  async function upload(id,file,fields,form){
    const ticket=read(id);if(!ticket)throw new Error('먼저 최신본 다운로드 또는 최초 파일 업로드 준비를 눌러 주세요.');
    if(!file||file.size<1||file.size>1024**3||! /\.(af|afpub|afdesign|afphoto)$/i.test(file.name))throw new Error('1 GiB 이하 Affinity 원본을 선택해 주세요.');
    message('업로드 준비 중…');
    const contentHash=await fileFingerprint(file);
    const start=await api(base+'/projects/'+id+'/upload',{method:'POST',body:JSON.stringify({...fields,ticket:ticket.ticket,originalFilename:file.name,fileSize:file.size,contentHash})});
    if(!start.done){
      let status=await api(base+'/uploads/'+start.id+'/status',{method:'POST'});const progress=form.querySelector('progress');progress.hidden=false;
      while(!status.done){
        const offset=Math.floor(status.offset/start.chunkBytes)*start.chunkBytes,end=Math.min(offset+start.chunkBytes,file.size);
        const r=await fetchWithTimeout(editorialConfig.apiBaseUrl+base+'/uploads/'+start.id+'/chunk',{method:'PUT',credentials:'include',headers:{'X-Editorial-CSRF':'1','Content-Type':'application/octet-stream','X-Upload-Offset':String(offset)},body:file.slice(offset,end)},180000,()=>new Error('업로드 응답 시간이 초과되었습니다. 같은 파일로 재시도해 주세요.'));
        const data=await r.json();if(!r.ok)throw new ApiError(data.error?.message||'업로드 실패. 같은 파일로 다시 시도해 주세요.',data.error?.code,r.status);if(!data.done&&data.offset<=status.offset)throw new Error('전송이 진행되지 않았습니다. 같은 파일로 다시 시도해 주세요.');status=data;
        progress.value=Math.floor(status.offset/file.size*100);message(`업로드 ${progress.value}% — 창을 닫지 마세요.`);
      }
      await api(base+'/uploads/'+start.id+'/finish',{method:'POST'});
    }
    sessionStorage.removeItem(key(id));await show();message('새 버전이 최신본으로 등록되었습니다.');
  }
  return {render,isPending:()=>busy,cancelView:()=>{generation++;}};
}
