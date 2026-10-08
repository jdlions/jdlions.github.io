export function normalizeLengthRules(input={}){
  if(input.lengthEnabled===false)return {minCharacters:null,maxCharacters:null};
  const value=key=>{const v=input[key];if(v==null||v==='')return null;if((typeof v!=='number'&&typeof v!=='string')||!/^\d+$/.test(String(v))||!Number.isSafeInteger(Number(v)))throw Object.assign(new Error('글자 수는 0 이상의 정수로 입력해 주세요.'),{status:400,code:'invalid_length_rules'});return Number(v);};
  const minCharacters=value('minCharacters'),maxCharacters=value('maxCharacters');
  if(minCharacters!==null&&maxCharacters!==null&&minCharacters>=maxCharacters)throw Object.assign(new Error('최소 글자 수는 최대 글자 수보다 작아야 합니다.'),{status:400,code:'invalid_length_rules'});
  if(input.lengthEnabled===true&&minCharacters===null&&maxCharacters===null)throw Object.assign(new Error('최소 또는 최대 글자 수를 입력해 주세요.'),{status:400,code:'invalid_length_rules'});
  return {minCharacters,maxCharacters};
}
const n=value=>value.toLocaleString('ko-KR');
export function lengthRange(r={}){return r.minCharacters!=null&&r.maxCharacters!=null?`${n(r.minCharacters)}~${n(r.maxCharacters)}자`:r.minCharacters!=null?`최소 ${n(r.minCharacters)}자`:r.maxCharacters!=null?`최대 ${n(r.maxCharacters)}자`:'제한 없음';}
export function lengthResult(count,r={}){
  const below=r.minCharacters!=null&&count<r.minCharacters,above=r.maxCharacters!=null&&count>r.maxCharacters;
  const difference=below?r.minCharacters-count:above?count-r.maxCharacters:0;
  return {count,difference,state:below?'below':above?'above':'valid',allowed:!below&&!above,text:`현재 ${n(count)}자`+(below?` · 최소 ${n(r.minCharacters)}자 · ${n(difference)}자 부족`:above?` · 최대 ${n(r.maxCharacters)}자 · ${n(difference)}자 초과`:r.minCharacters!=null||r.maxCharacters!=null?' · 제출 가능':'')};
}
export function lengthFeedback(result,r){return `분량 기준 미충족\n허용 범위: ${lengthRange(r)}\n제출 당시: ${n(result.count)}자\n${result.state==='below'?'최소 기준보다':'최대 기준보다'} ${n(result.difference)}자 ${result.state==='below'?'부족합니다':'초과합니다'}.\n수정 후 다시 제출해주세요.`;}
