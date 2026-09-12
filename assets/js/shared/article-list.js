import {customSelect,initCustomSelect,escapeHtml,emptyState} from './ui.js';

// One controller per list keeps its filters/cursor history while detail is open.
export function createArticleList(service,{admin=false,picker=false,free=false,render,bind=()=>{},busy=()=>{}}){
  const labels={draft:'작성 중',submitted:'제출됨',reviewing:'확인 중',revision_requested:'수정 요청',hold:'보류',approved:'승인',scheduled:'발행 예정'};
  let root,sequence=0,abort,timer,position=0,cursors=[''],data,revision=-1;
  let filters=free?{campaign:'free'}:{};
  function cancel(){sequence++;abort?.abort();clearTimeout(timer);}
  function paint(){
    root.querySelector('[data-list-results]').innerHTML=render(data.items);
    bind(root);busy(false);
    root.querySelector('[data-page-range]').textContent=data.items.length?`${position*20+1}–${position*20+data.items.length}${data.stats?' / '+data.stats.total:''}`:'0개';
    root.querySelector('[data-page-prev]').disabled=position===0;
    root.querySelector('[data-page-next]').disabled=!data.nextCursor;
    const stats=root.querySelector('[data-list-stats]');
    if(stats&&data.stats){stats.innerHTML=Object.keys(labels).filter(s=>s!=='draft').map(s=>`<button type="button" data-filter="${s}"><strong>${data.stats.byStatus[s]||0}</strong><span>${labels[s]}</span></button>`).join('');stats.querySelectorAll('button').forEach(b=>b.onclick=()=>root.querySelector('[data-status-filter]').closest('[data-custom-select]')._customSelect.setValue(b.dataset.filter,true));}
    const campaigns=root.querySelector('[data-campaign-control]');
    if(campaigns&&data.campaigns){campaigns.querySelector('[data-custom-select]')?._customSelect?.close(false);campaigns.innerHTML=customSelect('campaign-filter','모든 과제',[['','모든 과제'],['free','자유 기사'],...data.campaigns.map(c=>[c.id,c.name])],{value:filters.campaign||''});initCustomSelect(campaigns.querySelector('[data-custom-select]'),value=>change('campaign',value));}
  }
  async function load({stats=true,target=position}={}){
    cancel();const current=sequence,host=root;abort=new AbortController();
    busy(true);host.querySelector('[data-list-message]').textContent='기사 불러오는 중…';
    host.querySelectorAll('[data-page-prev],[data-page-next]').forEach(b=>b.disabled=true);
    try{
      const page=await service.articlePage({...filters,cursor:cursors[target]||'',stats:stats?'1':'0',...(picker?{picker:'1'}:{})},abort.signal);
      if(current!==sequence||!host.isConnected)return;
      if(!stats&&data){page.stats=data.stats;page.campaigns=data.campaigns;}
      data=page;position=target;revision=service.listRevision||0;
      host.querySelector('[data-list-message]').textContent='';paint();
    }catch(error){
      if(current!==sequence||!host.isConnected)return;
      host.querySelector('[data-list-message]').innerHTML=escapeHtml(error.message)+' <button type="button" data-retry-startup>다시 시도</button>';
      host.querySelector('[data-retry-startup]').onclick=()=>load({stats,target});
      host.querySelector('[data-page-prev]').disabled=position===0;
    }
  }
  function change(key,value,debounce=false){
    filters={...filters,[key]:value.trim()};position=0;cursors=[''];data=undefined;cancel();busy(true);
    // Invalidate immediately, including the debounce window.
    root.querySelectorAll('[data-page-prev],[data-page-next]').forEach(b=>b.disabled=true);
    if(debounce)timer=setTimeout(()=>load(),300);else load();
  }
  function mount(container){
    cancel();root=container;root.querySelectorAll('[data-custom-select]').forEach(x=>x._customSelect?.close(false));
    root.innerHTML=`${admin?'<div class="queue-stats" data-list-stats></div>':''}<div class="queue-tools panel"><input data-query aria-label="기사 검색" maxlength="200" placeholder="제목 · 작성자 · 과제 검색" value="${escapeHtml(filters.q||'')}">${picker?'':`${customSelect('status-filter','모든 상태',[['','모든 상태'],...Object.entries(labels)],{value:filters.status||''})}${customSelect('type-filter','모든 기사 유형',[['','모든 기사 유형'],['school','학교 기사'],['feature','피처'],['opinion','오피니언'],['culture','문화'],['sports','스포츠'],['other','기타']],{value:filters.type||''})}${free?'':'<span data-campaign-control></span>'}${admin?`<input data-student-filter aria-label="작성자 검색" maxlength="200" placeholder="학생 ID 검색" value="${escapeHtml(filters.author||'')}"><input data-date-filter type="date" aria-label="제출일" value="${escapeHtml(filters.date||'')}">`:''}`}</div><div data-list-message role="status"></div><div data-list-results>${emptyState('기사 불러오는 중','다른 메뉴는 계속 사용할 수 있습니다.')}</div><div class="form-actions article-pagination"><button type="button" data-page-prev disabled>이전</button><span data-page-range></span><button type="button" data-page-next disabled>다음</button><button type="button" data-page-refresh>새로고침</button></div>`;
    root.querySelector('[data-query]').oninput=e=>change('q',e.target.value,true);
    for(const [selector,key] of [['status-filter','status'],['type-filter','type']]){const input=root.querySelector('[data-'+selector+']');if(input)initCustomSelect(input.closest('[data-custom-select]'),value=>change(key,value));}
    for(const [selector,key] of [['date-filter','date'],['student-filter','author']]){const input=root.querySelector('[data-'+selector+']');if(input)input.oninput=e=>change(key,e.target.value,key==='author');}
    root.querySelector('[data-page-refresh]').onclick=()=>{position=0;cursors=[''];data=undefined;load();};
    root.querySelector('[data-page-prev]').onclick=()=>load({stats:false,target:position-1});
    root.querySelector('[data-page-next]').onclick=()=>{cursors[position+1]=data.nextCursor;load({stats:false,target:position+1});};
    if(data&&revision===(service.listRevision||0))paint();else load();
  }
  return {mount,cancel,refresh(){data=undefined;return load();}};
}
