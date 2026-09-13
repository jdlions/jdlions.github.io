import {escapeHtml,emptyState} from './ui.js';
// Each dataset can finish independently; stale views never repaint an editor.
export function createViewLoader(service){
  let generation=0;
  return {
    cancel(){generation++;},
    show(container,resources,paint){
      const current=++generation;
      const labels={articles:'기사',assignments:'과제',photos:'사진',students:'학생 명단'};
      const draw=()=>{
        if(current!==generation)return;
        const ready=resources.some(name=>service.resources.get(name)?.loaded);
        if(ready)paint();else container.innerHTML='';
        const notices=document.createElement('div');notices.dataset.loadStatus='';notices.setAttribute('role','status');notices.setAttribute('aria-live','polite');
        for(const name of resources){const state=service.resources.get(name);
          if(state?.loaded)continue;
          const block=document.createElement('div');
          if(state?.error){block.className='notice notice--error';block.innerHTML=escapeHtml(labels[name]+': '+state.error.message)+' <button data-retry-startup>다시 시도</button>';block.querySelector('button').onclick=()=>load(name);}
          else block.innerHTML=emptyState(labels[name]+' 불러오는 중','다른 메뉴는 계속 이용할 수 있습니다.');
          notices.append(block);
        }
        container.prepend(notices);
      };
      const load=name=>{const promise=service.ensureResource(name);draw();promise.then(draw,draw);};
      for(const name of resources)load(name);
    }
  };
}
