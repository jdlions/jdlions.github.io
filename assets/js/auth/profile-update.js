import {api} from '../services/api-client.js';
export function showProfileUpdate(user){
  const update=user.profileUpdate,host=document.querySelector('#main .page');if(!update||!host)return;
  const banner=document.createElement('section');banner.className='panel';banner.dataset.profileUpdate='';
  const message=document.createElement('p');message.setAttribute('role','status');
  message.textContent=update.conflict?'Google 프로필의 학번·이름과 회원 정보가 다릅니다. 기존 정보는 유지됩니다. 관리자에게 확인해 주세요.':`Google 프로필의 현재 학번 ${update.studentNumber}로 갱신할까요? 기수와 기존 작성 기록은 유지됩니다.`;
  banner.append(message);
  if(update.studentNumber){
    const button=document.createElement('button');button.type='button';button.textContent='현재 학번 확인·갱신';banner.append(button);
    button.onclick=async()=>{button.disabled=true;try{await api('/api/member-profile/confirm',{method:'POST',body:JSON.stringify({studentNumber:update.studentNumber,confirmed:true})});message.textContent='현재 학번을 갱신했습니다. 기수와 기존 기록은 유지됩니다.';button.remove();}catch(e){message.textContent=e.message;button.disabled=false;}};
  }
  host.prepend(banner);
}
