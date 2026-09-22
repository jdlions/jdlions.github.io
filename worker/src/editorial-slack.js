import {fetchWithTimeout} from '../../assets/js/shared/request-timeout.js';
export const slackUserId=value=>/^[UW][A-Z0-9]{8,31}$/.test(value);
export const slackChannelId=value=>/^[CG][A-Z0-9]{8,31}$/.test(value);
// Fixed API hosts/methods and server-selected recipients. No generic send route.
export async function sendEditorialSlack(env,event,destination,version){
  if(!env.SLACK_BOT_TOKEN)return {status:'not_configured'};
  const dm=event.action==='forced';
  if(!(dm?slackUserId(destination):slackChannelId(destination)))return {status:'skipped_unlinked'};
  const call=async(method,body)=>{
    const r=await fetchWithTimeout('https://slack.com/api/'+method,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${env.SLACK_BOT_TOKEN}`,'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body)},10000,()=>new Error('slack_timeout'));
    if(!r.ok){await r.body?.cancel();throw Object.assign(new Error('slack_rejected'),{definite:r.status<500});}
    const data=await r.json();if(data.ok!==true)throw Object.assign(new Error('slack_rejected'),{definite:true});return data;
  };
  try{
    const role=event.owner_role==='chief'?'편집장':'부편집장';
    const text=dm?`PrideDesk — 편집 작업 강제 종료\n${role}으로 진행 중이던 ${event.project_id} 편집 작업이 강제 종료되었습니다.\n기준 버전: v${event.base_version}\n기존 작업 파일을 업로드하기 전에 PrideDesk에서 최신 버전을 확인해주세요.`:
      `PrideDesk — ${event.project_id} v${version.version} 업로드\n${role} ${version.editor_name}\n수정 내용: ${version.change_note||'없음'}\n시간: ${version.uploaded_at}\nhttps://pridesk.vercel.app`;
    let channel=destination;
    if(dm){channel=(await call('conversations.open',{users:destination})).channel?.id;if(!/^D[A-Z0-9]{8,31}$/.test(channel||''))return {status:'failed'};}
    // Plain text suppresses injected mentions/formatting; never attach private files.
    const sent=await call('chat.postMessage',{channel,text,mrkdwn:false,parse:'none',link_names:false,unfurl_links:false,unfurl_media:false});
    return {status:'sent',messageId:/^\d+\.\d+$/.test(sent.ts||'')?sent.ts:null};
  }catch(e){return {status:e.definite?'failed':'unknown'};} // Timeout might have delivered: do not auto-retry.
}
