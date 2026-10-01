import {api,ApiError} from '../services/api-client.js';
import {escapeHtml as esc,loadingState} from '../shared/ui.js';
import {editorialConfig} from '../config.js';
import {fetchWithTimeout} from '../shared/request-timeout.js';
const base='/api/editorial-files';
const roles={chief:'편집장',deputy:'부편집장'};
const label=v=>'v'+String(v).padStart(3,'0');
const date=x=>new Date(x).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
const notification=status=>status==='sent'?' Slack 알림을 보냈습니다.':['skipped_off','not_applicable'].includes(status)?'':` Slack 알림을 보내지 못했거나 결과를 확인할 수 없습니다 (${status||'unknown'}). 작업은 정상 완료되었습니다.`;
const download=(url,filename)=>{const a=document.createElement('a');a.href=editorialConfig.apiBaseUrl+url;a.download=filename||'';document.body.append(a);a.click();a.remove();};
// SHA-256 of ordered 2 MiB chunk digests: bounded memory and exact retry identity.
export async function fileFingerprint(file){const hashes=[];for(let i=0;i<file.size;i+=2*1024*1024)hashes.push(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.slice(i,i+2*1024*1024).arrayBuffer())));const bytes=new Uint8Array(hashes.length*32);hashes.forEach((h,i)=>bytes.set(h,i*32));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function createEditorialFiles(){
  let root,selected='',operator='',busy=false,generation=0;
  window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
  const message=(text,error=false)=>{const el=root?.querySelector('[data-file-status]');if(el){el.textContent=text;el.classList.toggle('notice--error',error);}};
  async function action(fn){if(busy)return;busy=true;const controls=[...root.querySelectorAll('button, input, textarea, select')].map(x=>[x,x.disabled]);controls.forEach(([x])=>x.disabled=true);try{await fn();}catch(e){message(e.message,true);}finally{busy=false;controls.forEach(([x,disabled])=>{if(x.isConnected)x.disabled=disabled;});}}
  async function render(target){
    root=target;const stamp=++generation;root.innerHTML=loadingState('편집 파일 불러오는 중…');
    try{
      const [projects,editors]=await Promise.all([api(base+'/projects'),api(base+'/editors')]);if(stamp!==generation||!root.isConnected)return;operator=editors.operatorRole||'';
      if(!projects.some(p=>p.id===selected))selected=projects[0]?.id||'';
      root.innerHTML=`<header class="page-head"><div><p class="eyebrow">PrideDesk</p><h1>편집 파일</h1><p>편집 시작 후 최신본을 수정하고 새 버전을 올려주세요. 원본은 모두 보존됩니다.</p></div></header><div role="status" aria-live="polite" data-file-status></div><section class="panel"><label class="field">현재 작업자<select data-file-operator><option value="">작업자 선택</option>${editors.editors.map(e=>`<option value="${e.role}" ${e.name?'':'disabled'}>${roles[e.role]} ${esc(e.name||'이름 미설정')}</option>`).join('')}</select></label><p>공용 계정을 사용하므로 본인의 역할을 선택해 주세요. 편집 상태는 서버에 보관됩니다.</p></section><label class="field">편집 프로젝트<select data-file-project>${projects.map(p=>`<option value="${p.id}">${p.year} ${p.season} Edition</option>`).join('')}</select></label><details class="panel"><summary>새 편집 프로젝트</summary><form data-project-form class="form-grid"><label class="field">연도<input name="year" type="number" min="2020" max="2100" value="${new Date().getFullYear()}" required></label><label class="field">계절<select name="season"><option>Summer</option><option>Winter</option></select></label><button class="btn-primary">프로젝트 만들기</button></form><p>연도·계절별 전용 private Drive 폴더를 만듭니다. 신문 발행과는 별도로 관리됩니다.</p></details><div data-file-detail></div>`;
      const select=root.querySelector('[data-file-project]');select.value=selected;select.onchange=()=>{selected=select.value;show();};
      const choice=root.querySelector('[data-file-operator]');choice.value=operator;choice.onchange=()=>action(async()=>{try{await api(base+'/operator',{method:'POST',body:JSON.stringify({role:choice.value})});operator=choice.value;if(selected)await show();}finally{choice.value=operator;}});
      root.querySelector('[data-project-form]').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);action(async()=>{const p=await api(base+'/projects',{method:'POST',body:JSON.stringify({year:Number(f.get('year')),season:f.get('season')})});selected=p.id;await render(root);});};
      if(selected)await show();
    }catch(e){if(stamp!==generation)return;root.innerHTML=`<p role="status">${esc(e.message)}</p><button data-file-retry>다시 시도</button>`;root.querySelector('[data-file-retry]').onclick=()=>render(root);}
  }
  async function renderSettings(target){
    root=target;const stamp=++generation;root.innerHTML=loadingState('편집자 설정 불러오는 중…');
    try {
    const s=await api(base+'/settings');if(stamp!==generation||!target.isConnected)return;
    target.innerHTML='<header class="page-head"><div><p class="eyebrow">PrideDesk</p><h1>편집자 설정</h1><p>편집자 이름과 알림 채널을 관리합니다. 기존 버전과 작업 기록은 유지됩니다.</p></div></header><div role="status" aria-live="polite" data-file-status></div><section class="panel" data-settings-area></section>';
    const area=target.querySelector('[data-settings-area]');
    area.innerHTML=`<form data-editor-form>${s.editors.map(e=>`<fieldset><legend>${roles[e.role]}</legend><label class="field">${roles[e.role]} 이름<input name="${e.role}Name" maxlength="80" value="${esc(e.name)}"></label></fieldset>`).join('')}<details><summary>알림 채널 관리 (최초 설정)</summary><p>운영 담당자가 한 번 설정하면 다음 기수에도 유지됩니다. 이름 변경 시 수정할 필요가 없습니다.</p><label><input type="checkbox" name="channelEnabled" ${s.channelEnabled?'checked':''}> 강제 종료·새 버전 Slack 채널 알림</label><label class="field">#pridedesk-알림 채널 ID<input name="channelId" value="${esc(s.channelId)}" placeholder="C로 시작하는 채널 ID"></label><p>두 알림 모두 #pridedesk-알림으로 전송됩니다. Bot Token은 서버 secret에서만 설정합니다.</p></details><button class="btn-primary">설정 저장</button></form>`;
    area.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);action(async()=>{await api(base+'/settings',{method:'PUT',body:JSON.stringify({editors:Object.keys(roles).map(role=>({role,name:f.get(role+'Name')})),channelEnabled:f.has('channelEnabled'),channelId:f.get('channelId')})});await renderSettings(target);message('편집자 설정을 저장했습니다. 과거 기록과 진행 중인 작업의 이름은 유지됩니다.');});};
    }catch(e){if(stamp!==generation)return;target.innerHTML=`<p role="status">${esc(e.message)}</p><button data-settings-retry>다시 시도</button>`;target.querySelector('[data-settings-retry]').onclick=()=>renderSettings(target);}
  }
  async function show(){
    const id=selected,stamp=++generation,container=root.querySelector('[data-file-detail]');container.innerHTML=loadingState();
    try{
      const d=await api(base+'/projects/'+id);if(stamp!==generation)return;const v=d.latest,lock=d.lock,owner=lock&&lock.owner_role===operator;
      container.innerHTML=`<section class="panel"><h2>${d.year} ${d.season} Edition</h2>${v?`<p>최신 버전 <strong>${label(v.version)}</strong></p><p>${esc(v.normalized_filename)}</p><p>수정자: ${roles[v.editor_role]||'기존 편집자'} ${esc(v.editor_name)} · 업로드: ${date(v.uploaded_at)}</p><p>${esc(v.change_note||'수정 내용 없음')}</p><p>파일 크기: ${(v.file_size/1024/1024).toFixed(1)} MiB</p><a href="${editorialConfig.apiBaseUrl+base}/projects/${id}/versions/${v.version}/download" download>최신본 다운로드 (열람용)</a>`:'<p>아직 편집 파일이 없습니다.</p>'}<p>수정할 때는 반드시 편집 시작을 눌러 받은 최신본을 사용하세요.</p>${lock?`<p data-file-baseline>편집 중 · ${roles[lock.owner_role]} ${esc(lock.owner_name)} · 기준 버전 ${label(lock.base_version)} · 시작 ${date(lock.started_at)}</p><button data-file-close ${operator?'':'disabled'}>${owner?'편집 취소':'강제 종료'}</button>`:`<button class="btn-primary" data-file-begin ${operator?'':'disabled'}>편집 시작</button>`}<button data-file-refresh>상태 새로고침</button></section>${owner?`<section class="panel"><h2>새 버전 업로드</h2><form data-version-form><label class="field">수정 내용<textarea name="changeNote" maxlength="2000"></textarea></label><label class="field">파일 *<input type="file" name="file" accept=".af,.afpub,.afdesign,.afphoto" required></label><p>Affinity 원본 1개 · 최대 1 GiB · 원본 품질 유지${d.pendingId?' · 미완료 업로드는 같은 파일과 수정 내용으로 재시도하세요.':''}</p><progress data-file-progress max="100" value="0" aria-label="편집 파일 업로드 진행률" hidden></progress><button class="btn-primary">새 버전 업로드</button></form></section>`:''}<details class="panel"><summary>버전 기록</summary><div data-file-history></div><button data-history-more ${d.nextBefore?'':'hidden'}>이전 기록 더 보기</button></details><details class="panel"><summary>편집 작업 기록</summary>${(d.audit||[]).map(a=>`<p>${date(a.created_at)} · ${esc(a.actor_name)} (${roles[a.actor_role]}) · ${{completed:'업로드 완료',cancelled:'편집 취소',forced:'강제 종료'}[a.action]} · ${esc(a.owner_name)}의 ${label(a.base_version)} 작업 · Slack: ${esc(a.notification_status)}</p>`).join('')||'<p>기록이 없습니다.</p>'}</details>`;
      const history=container.querySelector('[data-file-history]');const append=rows=>{for(const x of rows){const p=document.createElement('p');p.innerHTML=`<a href="${editorialConfig.apiBaseUrl+base}/projects/${id}/versions/${x.version}/download" download>${label(x.version)} 다운로드</a> · ${roles[x.editor_role]||'기존 편집자'} ${esc(x.editor_name)} · ${date(x.uploaded_at)} · ${esc(x.change_note)}`;history.append(p);}};append(d.versions);
      let before=d.nextBefore;container.querySelector('[data-history-more]').onclick=()=>action(async()=>{const older=await api(base+'/projects/'+id+'?before='+before);append(older.versions);before=older.nextBefore;container.querySelector('[data-history-more]').hidden=!before;});
      container.querySelector('[data-file-refresh]').onclick=()=>action(show);
      container.querySelector('[data-file-begin]')?.addEventListener('click',()=>action(async()=>{const started=await api(base+'/projects/'+id+'/checkout',{method:'POST'});if(started.downloadUrl)download(started.downloadUrl,started.filename);await show();message('편집을 시작했습니다. 탭을 닫아도 작업 상태가 유지됩니다.');}));
      container.querySelector('[data-file-close]')?.addEventListener('click',()=>{if(!confirm(owner?'편집을 취소할까요? 새 버전은 만들어지지 않으며 진행 중인 업로드는 중단됩니다.':`${roles[lock.owner_role]} ${lock.owner_name}님이 ${label(lock.base_version)}를 기준으로 편집 중입니다. 강제로 종료하면 현재 작업 내용은 PrideDesk에 반영되지 않을 수 있습니다. 강제 종료할까요?`))return;action(async()=>{const result=await api(base+'/locks/'+lock.id+'/'+(owner?'cancel':'force'),{method:'POST',body:JSON.stringify({confirmation:owner?'편집 취소':'강제 종료'})});await show();message('편집 작업이 종료되었습니다.'+notification(result.notificationStatus));});});
      container.querySelector('[data-version-form]')?.addEventListener('submit',e=>{e.preventDefault();const form=e.target,file=form.elements.file.files[0],fields={changeNote:form.elements.changeNote.value};action(()=>upload(id,lock.id,file,fields,form));});
    }catch(e){if(stamp!==generation)return;container.innerHTML=`<p>${esc(e.message)}</p><button data-detail-retry>다시 시도</button>`;container.querySelector('[data-detail-retry]').onclick=show;message(e.message,true);}
  }
  async function upload(id,lockId,file,fields,form){
    if(!file||file.size<1||file.size>1024**3||! /\.(af|afpub|afdesign|afphoto)$/i.test(file.name))throw new Error('1 GiB 이하 Affinity 원본을 선택해 주세요.');
    message('업로드 준비 중…');const contentHash=await fileFingerprint(file);
    const start=await api(base+'/projects/'+id+'/upload',{method:'POST',body:JSON.stringify({...fields,lockId,originalFilename:file.name,fileSize:file.size,contentHash})});let saved=start.version;
    if(!start.done){
      let status=await api(base+'/uploads/'+start.id+'/status',{method:'POST'});const progress=form.querySelector('progress');progress.hidden=false;
      while(!status.done){
        const offset=Math.floor(status.offset/start.chunkBytes)*start.chunkBytes,end=Math.min(offset+start.chunkBytes,file.size);
        const r=await fetchWithTimeout(editorialConfig.apiBaseUrl+base+'/uploads/'+start.id+'/chunk',{method:'PUT',credentials:'include',headers:{'X-Editorial-CSRF':'1','Content-Type':'application/octet-stream','X-Upload-Offset':String(offset)},body:file.slice(offset,end)},180000,()=>new Error('업로드 응답 시간이 초과되었습니다. 같은 파일로 재시도해 주세요.'));
        const data=await r.json();if(!r.ok)throw new ApiError(data.error?.message||'업로드 실패. 같은 파일로 다시 시도해 주세요.',data.error?.code,r.status);if(!data.done&&data.offset<=status.offset)throw new Error('전송이 진행되지 않았습니다. 같은 파일로 다시 시도해 주세요.');status=data;
        progress.value=Math.floor(status.offset/file.size*100);message(`업로드 ${progress.value}% — 창을 닫지 마세요.`);
      }
      saved=await api(base+'/uploads/'+start.id+'/finish',{method:'POST'});
    }
    await show();message('새 버전이 최신본으로 등록되었습니다.'+notification(saved?.notificationStatus));
  }
  return {render,renderSettings,isPending:()=>busy,cancelView:()=>{generation++;}};
}
