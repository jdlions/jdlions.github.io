import {fetchWithTimeout} from '../../assets/js/shared/request-timeout.js';
export const searchScopes=Object.freeze({directory:'https://www.googleapis.com/auth/directory.readonly',contacts:'https://www.googleapis.com/auth/contacts.readonly',other:'https://www.googleapis.com/auth/contacts.other.readonly'});
const fail=(message,status=403)=>Object.assign(new Error(message),{status,code:'member_search_unavailable'});
export async function searchSchoolPeople(query,viewer){
 const q=String(query||'').trim();if(q.length<2||q.length>100)throw fail('검색어는 2~100자로 입력해 주세요.',400);
 const source=viewer.searchSource;if(!Object.hasOwn(searchScopes,source))throw fail('관리자 전용 Google 검색 연결이 필요합니다. 수동 입력도 가능합니다.');
 const path=source==='directory'?'people:searchDirectoryPeople':source==='contacts'?'people:searchContacts':'otherContacts:search';
 async function read(query){
  const params=new URLSearchParams({query,readMask:source==='other'?'names,emailAddresses':'names,emailAddresses,photos',pageSize:'10'});
  if(source==='directory')params.append('sources','DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE');
  const response=await fetchWithTimeout('https://people.googleapis.com/v1/'+path+'?'+params,{headers:{Authorization:`Bearer ${viewer.accessToken}`},redirect:'error'},20000,()=>fail('Google 검색 시간이 초과되었습니다.',504));
  if(!response.ok){await response.body?.cancel();throw fail('Google 검색 권한 또는 People API 설정을 확인해 주세요. 수동 입력은 계속 사용할 수 있습니다.',response.status===401||response.status===403?403:502);}
  return response.json();
 }
 if(source!=='directory')await read(''); // Google requires contact-search cache warmup.
 const data=await read(q),seen=new Set(),people=[];
 for(const person of data.people||data.results?.map(r=>r.person)||[]){
  for(const entry of person.emailAddresses||[]){const email=String(entry.value||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._+-]{0,63}@joongdong\.hs\.kr$/.test(email)||seen.has(email))continue;seen.add(email);
   let photo=null;try{const u=new URL(person.photos?.[0]?.url);if(u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.endsWith('.googleusercontent.com'))photo=u.href;}catch{}
   people.push({photo,displayName:String(person.names?.[0]?.displayName||email).slice(0,200),email});if(people.length===10)return {people};
  }
 }
 return {people};
}
