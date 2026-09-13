let locks=0,previousOverflow;
export function openDialog(dialog,trigger=document.activeElement){
  if(dialog.open)return;
  dialog.querySelector('[data-dialog-status]')?.remove();
  const progress=dialog.querySelector('[data-upload-progress]');if(progress)progress.textContent='';
  if(!locks++) {previousOverflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';}
  const pending=()=>dialog.querySelector('[data-upload-form]')?.dataset.uploading==='true';
  const cancel=event=>{if(pending())event.preventDefault();};
  const trap=event=>{
    if(event.key!=='Tab')return;
    const items=[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);
    const first=items[0],last=items.at(-1);
    if(!first){event.preventDefault();dialog.focus();return;}
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  dialog.addEventListener('cancel',cancel);
  dialog.addEventListener('keydown',trap);
  dialog.addEventListener('close',()=>{
    dialog.classList.remove('is-open');dialog.removeEventListener('cancel',cancel);
    dialog.removeEventListener('keydown',trap);
    if(!--locks)document.documentElement.style.overflow=previousOverflow;
    if(trigger?.isConnected)trigger.focus();
  },{once:true});
  dialog.showModal();dialog.classList.add('is-open');
  (dialog.querySelector('input:not([type=hidden]),select,textarea,button')||dialog).focus();
}
export function closeDialog(dialog){if(dialog.querySelector('[data-upload-form]')?.dataset.uploading==='true')return;dialog.close();}
