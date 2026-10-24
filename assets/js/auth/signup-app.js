import {api} from '../services/api-client.js';
import {editorialUrl} from '../config.js';
const form=document.querySelector('[data-signup-form]'),status=document.querySelector('[data-signup-status]'),retry=document.querySelector('[data-signup-retry]');
let profile,busy=false;
function guidance(){
  const matches=profile?.eligible&&/^[123]\d{4}$/.test(form.elements.studentNumber.value)&&Number(form.elements.studentNumber.value[0])===profile.grade;
  form.querySelector('button').disabled=!matches||busy;
  document.querySelector('[data-signup-guidance]').textContent=!profile?.eligible?'이 계정의 입학 연도·학생 학년을 확인할 수 없습니다. 관리자에게 수동 등록을 요청해 주세요.':!matches?'이메일 입학 연도와 현재 학번의 학년이 다릅니다. 현재 학번을 직접 확인해 주세요.':'이메일의 과거 학번은 현재 학번으로 사용하지 않습니다. 표시된 정보를 확인해 주세요.';
}
async function load(){
  retry.hidden=true;form.hidden=true;status.textContent='학교 Google 로그인 확인 중…';
  try{
    ({profile}=await api('/api/signup'));
    document.querySelector('[data-signup-account]').textContent='Google 인증됨 · '+profile.email;
    form.elements.name.value=profile.name;form.elements.studentNumber.value=profile.studentNumber;form.elements.cohort.value=profile.cohort?`${profile.cohort}기`:'확인 필요';
    guidance();form.hidden=false;status.textContent='가입 정보를 확인해 주세요.';
  }catch(e){status.textContent=e.message;retry.hidden=false;}
}
form.elements.studentNumber.addEventListener('input',guidance);retry.onclick=load;
form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  busy=true;const button=form.querySelector('button');button.disabled=true;form.setAttribute('aria-busy','true');status.textContent='가입 중…';
  try{
    const result=await api('/api/signup',{method:'POST',body:JSON.stringify({code:form.elements.code.value,name:form.elements.name.value,studentNumber:form.elements.studentNumber.value,confirmed:form.elements.confirmed.checked})});
    const expected=editorialUrl('/editorial/student/');
    // Never follow an arbitrary response URL; the fixed student route is sufficient.
    if(!result.redirect)throw Error('가입 결과를 확인할 수 없습니다. 다시 로그인해 주세요.');
    status.textContent='가입되었습니다. 학생 화면으로 이동합니다.';location.replace(expected);
  }catch(e){status.textContent=e.message;}
  finally{busy=false;form.elements.code.value='';guidance();form.removeAttribute('aria-busy');}
};
load();
