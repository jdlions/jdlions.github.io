export function bindPhotoPreviews(root){
  root.querySelectorAll('[data-photo-thumbnail]').forEach(img=>{
    const fail=()=>{const placeholder=document.createElement('p');placeholder.className='photo-preview-unavailable';placeholder.textContent='미리보기를 불러오지 못했습니다. 원본 열기를 이용해 주세요.';img.replaceWith(placeholder);};
    img.addEventListener('error',fail,{once:true});if(img.complete&&!img.naturalWidth)fail();
  });
}
