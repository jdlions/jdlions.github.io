export function bindPhotoPreviews(root){
 root.querySelectorAll('[data-photo-thumbnail]').forEach(img=>{
  const shell=img.closest('.photo-preview-shell'),status=shell?.querySelector('[data-preview-status]');
  const loaded=()=>status?.remove();
  const fail=()=>{
   const path=img.dataset.photoPreviewUrl;
   // Only administrator markup opts in; the Worker authorizes this private redirect.
   if(path&&/^\/api\/photos\/[^/]+\/preview$/.test(path)){
    const frame=document.createElement('iframe');frame.title='Google Drive 비공개 사진 미리보기';frame.loading='lazy';frame.referrerPolicy='no-referrer';frame.src=path;
    frame.addEventListener('load',loaded,{once:true});
    const help=document.createElement('p');help.className='photo-preview-help';help.textContent='Drive 비공개 뷰어입니다. 로그인 차단 또는 빈 화면이면 Drive 원본 열기를 이용해 주세요.';
    frame.addEventListener('error',()=>{loaded();help.textContent='미리보기를 불러오지 못했습니다. Drive 원본 열기를 이용해 주세요.';},{once:true});
    img.replaceWith(frame);shell?.append(help);
   }else{loaded();const p=document.createElement('p');p.className='photo-preview-unavailable';p.textContent='미리보기를 불러오지 못했습니다. 원본 열기를 이용해 주세요.';img.replaceWith(p);}
  };
  img.addEventListener('load',loaded,{once:true});img.addEventListener('error',fail,{once:true});if(img.complete){if(img.naturalWidth)loaded();else fail();}
 });
}
