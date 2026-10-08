import {studentSubmissions,diffText} from '../shared/submission-diff.js';
import {readableEditorHtml,editorText} from '../shared/editor-text.js';
import {openDialog} from '../shared/dialog.js';

const date=value=>{const d=new Date(value);return Number.isNaN(d.valueOf())?'시각 확인 불가':d.toLocaleString('ko-KR');};
export function submittedText(html) {
  const node=document.createElement('div');node.innerHTML=readableEditorHtml(html);
  return editorText(node);
}
export function comparisonAvailable(article){return studentSubmissions(article.revisions).length>=2;}

export function openSubmissionDiff(article,trigger) {
  const revisions=studentSubmissions(article.revisions);
  if(revisions.length<2)return;
  const latest=revisions[0];
  const dialog=document.createElement('dialog');dialog.className='submission-diff-dialog';dialog.setAttribute('aria-labelledby','submission-diff-title');
  // All manuscript/title/metadata enter as textContent, never HTML interpolation.
  dialog.innerHTML='<header class="modal-head"><div><p class="eyebrow">학생 제출본 비교</p><h2 id="submission-diff-title"></h2></div><button type="button" data-diff-close aria-label="수정 내용 비교 닫기">닫기</button></header><p>관리자 첨삭본은 비교에서 제외됩니다.</p><label class="field"><span>이전 제출본</span><select data-diff-previous aria-label="이전 제출본 선택"></select></label><p data-diff-dates></p><div class="diff-counts" data-diff-counts></div><div class="diff-legend"><span class="diff-added">＋ 추가 · 밑줄</span><span class="diff-removed">− 삭제 · 취소선</span></div><p data-diff-status role="status" aria-live="polite"></p><nav class="diff-navigation" aria-label="변경 부분 이동"><button type="button" data-diff-prev>이전 변경</button><span data-diff-position></span><button type="button" data-diff-next>다음 변경</button></nav><div class="submission-diff-body" data-diff-body aria-label="본문 수정 전후 비교"></div>';
  dialog.querySelector('h2').textContent=article.titleKo||article.titleEn||'제목 없는 기사';
  const select=dialog.querySelector('select');
  for(const revision of revisions.slice(1)){const option=document.createElement('option');option.value=revision.id;option.textContent=`제출 v${revision.revisionNumber} · ${date(revision.createdAt)}`;select.append(option);}
  let position=-1,changes=[],worker=null,sequence=0,deadline;
  const stop=()=>{worker?.terminate();worker=null;clearTimeout(deadline);};
  function fail(){dialog.querySelector('[data-diff-status]').textContent='본문이 너무 길거나 비교에 실패했습니다. 원고는 그대로 보존됩니다. 이전 제출본을 다시 선택해 주세요.';}
  function render(){
    stop();const request=++sequence;
    const previous=revisions.find(r=>r.id===select.value);
    const body=dialog.querySelector('[data-diff-body]');body.replaceChildren();changes=[];position=-1;updatePosition();
    dialog.querySelector('[data-diff-counts]').replaceChildren();
    for(const button of dialog.querySelectorAll('.diff-navigation button'))button.disabled=true;
    dialog.querySelector('[data-diff-status]').textContent='비교하는 중…';
    dialog.querySelector('[data-diff-dates]').textContent=`이전: ${date(previous.createdAt)} · 최신: ${date(latest.createdAt)}`;
    if(previous.contentHtml.length+latest.contentHtml.length>2000000){fail();return;}
    const before=submittedText(previous.contentHtml),after=submittedText(latest.contentHtml);
    if(before.length+after.length>600000){fail();return;}
    if(before.length+after.length>50000){
      try {
        worker=new Worker(new URL('../shared/submission-diff-background.js',import.meta.url),{type:'module'});
        worker.onmessage=event=>{if(request!==sequence||!dialog.isConnected)return;stop();if(event.data.error)fail();else show(event.data.result);};
        worker.onerror=()=>{if(request===sequence){stop();fail();}};
        deadline=setTimeout(()=>{if(request===sequence){stop();fail();}},10000);
        worker.postMessage({previous:before,current:after});
      }catch{stop();fail();}
    }else show(diffText(before,after));
  }
  function show(result){
    const counts=dialog.querySelector('[data-diff-counts]');counts.replaceChildren();
    for(const [label,count] of [['이전',result.previousCount],['현재',result.currentCount],['추가',result.addedCount],['삭제',result.removedCount]]){const span=document.createElement('span');span.textContent=`${label} ${count.toLocaleString('ko-KR')}자`;counts.append(span);}
    const body=dialog.querySelector('[data-diff-body]'),fragment=document.createDocumentFragment();changes=[];position=-1;
    for(const part of result.parts){
      if(part.kind==='equal'){
        if(part.text.length>1500){const details=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('span');summary.textContent='변경 없는 본문 · 펼치기';content.textContent=part.text;details.append(summary,content);fragment.append(details);}
        else fragment.append(document.createTextNode(part.text));
        continue;
      }
      const node=document.createElement(part.kind==='add'?'ins':'del');node.className=part.kind==='add'?'diff-added':'diff-removed';node.tabIndex=-1;
      const marker=document.createElement('span');marker.className='diff-marker';marker.textContent=part.kind==='add'?'＋ 추가':'− 삭제';
      if(/^\s+$/.test(part.text))marker.textContent+=part.text.includes('\n')?' (줄바꿈·공백)':' (공백)';
      node.append(marker,document.createTextNode(part.text));fragment.append(node);changes.push(node);
    }
    body.replaceChildren(fragment);
    dialog.querySelector('[data-diff-status]').textContent=changes.length?(result.coarse?'변경량이 커서 바뀐 구간을 묶어 표시했습니다.':'수정된 부분을 확인하세요.'):'본문 변경이 없습니다.';
    for(const button of dialog.querySelectorAll('.diff-navigation button'))button.disabled=!changes.length;
    updatePosition();
  }
  function updatePosition(){dialog.querySelector('[data-diff-position]').textContent=changes.length?`${position<0?0:position+1} / ${changes.length}`:'0 / 0';}
  function move(direction){if(!changes.length)return;position=position<0?(direction>0?0:changes.length-1):(position+direction+changes.length)%changes.length;changes[position].scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});changes[position].focus({preventScroll:true});updatePosition();}
  select.onchange=render;dialog.querySelector('[data-diff-prev]').onclick=()=>move(-1);dialog.querySelector('[data-diff-next]').onclick=()=>move(1);
  dialog.querySelector('[data-diff-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{sequence++;stop();dialog.remove();},{once:true});
  document.body.append(dialog);render();openDialog(dialog,trigger);
  return dialog;
}
