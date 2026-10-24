import {fetchWithTimeout} from '../../assets/js/shared/request-timeout.js';
export const searchScopes=Object.freeze({directory:'https://www.googleapis.com/auth/directory.readonly',contacts:'https://www.googleapis.com/auth/contacts.readonly',other:'https://www.googleapis.com/auth/contacts.other.readonly'});
const fail=(message,status=403,code='member_search_unavailable')=>Object.assign(new Error(message),{status,code});
// Never expose arbitrary provider messages, metadata consumers, queries or credentials.
// These finite codes distinguish Cloud API setup, token grants and domain policy.
export function safeSearchFailure(provider){
 const statuses=['PERMISSION_DENIED','UNAUTHENTICATED','RESOURCE_EXHAUSTED','UNAVAILABLE','INTERNAL','INVALID_ARGUMENT','NOT_FOUND'];
 const reasons=['SERVICE_DISABLED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','ACCESS_TOKEN_EXPIRED','CREDENTIALS_MISSING','ORG_RESTRICTION_VIOLATION','SECURITY_POLICY_VIOLATED','RATE_LIMIT_EXCEEDED','CONSUMER_INVALID','accessNotConfigured','insufficientPermissions','forbidden','domainPolicy','authError','rateLimitExceeded','quotaExceeded'];
 const details=Array.isArray(provider?.error?.details)?provider.error.details:[];
 const info=details.filter(d=>d?.['@type']==='type.googleapis.com/google.rpc.ErrorInfo');
 const legacy=Array.isArray(provider?.error?.errors)?provider.error.errors:[];
 const messages=['The caller does not have permission','The caller does not have permission.','Not Authorized to access this resource/api','Request had insufficient authentication scopes.','Directory is disabled.','Directory sharing is not enabled.','Directory sharing is not enabled for this user.','Directory is not enabled for this user.','Permission denied.','Access denied.'];
 return {googleCode:statuses.includes(provider?.error?.status)?provider.error.status:'UNKNOWN',
  providerMessage:messages.includes(provider?.error?.message)?provider.error.message:'REDACTED',
  reasonReported:[...info,...legacy].some(d=>typeof d?.reason==='string'),detailsReported:details.length>0,
  reasons:[...new Set([...info,...legacy].map(d=>d?.reason).filter(r=>reasons.includes(r)))],
  detailTypes:[...new Set(details.map(d=>d?.['@type']).filter(t=>['type.googleapis.com/google.rpc.ErrorInfo','type.googleapis.com/google.rpc.QuotaFailure','type.googleapis.com/google.rpc.PreconditionFailure'].includes(t)))],
  service:info.some(d=>d?.metadata?.service==='people.googleapis.com')?'people.googleapis.com':null};
}
export async function searchSchoolPeople(query,viewer){
 const q=String(query||'').trim();if(q.length<2||q.length>100)throw fail('검색어는 2~100자로 입력해 주세요.',400);
 const source=viewer.searchSource;if(!Object.hasOwn(searchScopes,source))throw fail('관리자 전용 Google 검색 연결이 필요합니다. 수동 입력도 가능합니다.');
 const path=source==='directory'?'people:searchDirectoryPeople':source==='contacts'?'people:searchContacts':'otherContacts:search';
 async function read(query){
  const params=new URLSearchParams({query,readMask:source==='other'?'names,emailAddresses':'names,emailAddresses,photos',pageSize:'10'});
  if(source==='directory')params.append('sources','DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE');
  let response;
  try{response=await fetchWithTimeout('https://people.googleapis.com/v1/'+path+'?'+params,{headers:{Authorization:`Bearer ${viewer.accessToken}`},redirect:'manual'},20000,()=>fail('Google 검색 시간이 초과되었습니다.',504,'member_search_timeout'));}
  catch(error){if(error.status)throw error;console.error(JSON.stringify({event:'member_search_failure',stage:'fetch',code:'member_search_transport_error'}));throw fail('Google 검색 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.',502,'member_search_transport_error');}
  if(!response.ok){
   let provider;try{provider=await response.json();}catch{}
   const diagnostic=safeSearchFailure(provider),{googleCode}=diagnostic;
   // Callback sets searchSource only when the exchanged access token's scope includes
   // this source's required scope. This is grant evidence, not an inference from UI.
   console.error(JSON.stringify({event:'member_search_failure',stage:'google_http',googleStatus:response.status,...diagnostic,source,operation:path,scopeVerifiedAtExchange:true}));
   const detail=`사유: ${diagnostic.reasons.join(', ')||(diagnostic.reasonReported?'REDACTED':'NOT_PROVIDED')} · 상세: ${diagnostic.detailTypes.map(t=>t.split('.').at(-1)).join(', ')||(diagnostic.detailsReported?'REDACTED':'NONE')} · 메시지: ${diagnostic.providerMessage} · 서비스: ${diagnostic.service||'NOT_PROVIDED'} · ${source} scope: 교환 시 확인됨`;
   throw Object.assign(fail(`Google 검색 오류 (HTTP ${response.status} · ${googleCode}). ${detail}. 검색 권한 또는 People API 설정을 확인해 주세요.`,response.status===401||response.status===403?403:502,'member_search_google_error'),{googleStatus:response.status,googleCode});
  }
  try{return await response.json();}catch(error){if(error.status)throw error;console.error(JSON.stringify({event:'member_search_failure',stage:'response_json',googleStatus:response.status}));throw fail('Google 검색 응답 형식을 확인할 수 없습니다.',502,'member_search_response_error');}
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
