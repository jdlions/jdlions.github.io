import {fetchWithTimeout} from '../../assets/js/shared/request-timeout.js';
export const slackChannelId=value=>/^[CG][A-Z0-9]{8,31}$/.test(value);
// Fixed API hosts/methods and server-selected recipients. No generic send route.
export async function sendEditorialSlack(env,event,destination,version){
  if(!env.SLACK_BOT_TOKEN)return {status:'not_configured'};
  const forced=event.action==='forced';
  if(!slackChannelId(destination))return {status:'skipped_unlinked'};
  const call=async(method,body)=>{
    const r=await fetchWithTimeout('https://slack.com/api/'+method,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${env.SLACK_BOT_TOKEN}`,'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body)},10000,()=>new Error('slack_timeout'));
    if(!r.ok){await r.body?.cancel();throw Object.assign(new Error('slack_rejected'),{definite:r.status<500});}
    const data=await r.json();if(data.ok!==true)throw Object.assign(new Error('slack_rejected'),{definite:true});return data;
  };
  try{
    const role=event.owner_role==='chief'?'편집장':'부편집장';
    const actorRole=event.actor_role==='chief'?'편집장':'부편집장';
    const text=forced?`🔓 편집 작업 강제 종료 — ${event.project_id}\n${actorRole} ${event.actor_name}이 ${role} ${event.owner_name}의 편집 작업을 강제 종료했습니다.\n기준 버전: v${event.base_version}\n${event.owner_name} ${role}은 기존 작업 파일을 업로드하기 전에 PrideDesk에서 최신 버전을 확인해주세요.`:
      `📄 새 편집 파일 업로드 — ${event.project_id}\nv${version.version} · ${role} ${version.editor_name}${version.change_note?'\n'+version.change_note:''}\n시간: ${version.uploaded_at}\nhttps://pridesk.vercel.app`;
    // Plain text suppresses injected mentions/formatting; never attach private files.
    const sent=await call('chat.postMessage',{channel:destination,text,mrkdwn:false,parse:'none',link_names:false,unfurl_links:false,unfurl_media:false});
    return {status:'sent',messageId:/^\d+\.\d+$/.test(sent.ts||'')?sent.ts:null};
  }catch(e){return {status:e.definite?'failed':'unknown'};} // Timeout might have delivered: do not auto-retry.
}
