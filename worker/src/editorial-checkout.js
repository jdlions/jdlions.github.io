import {cookie,seal,unseal,setCookie} from './security.js';
import {sendEditorialSlack,slackChannelId} from './editorial-slack.js';
export const OPERATOR_COOKIE='__Host-lp_editor';
export const roleLabels={chief:'편집장',deputy:'부편집장'};
const fail=(message,status=409)=>Object.assign(new Error(message),{status,code:'editorial_lock_error'});
const now=()=>new Date().toISOString();
export class EditorialCheckout {
  constructor(db){this.db=db;}
  stmt(sql,...args){return this.db.prepare(sql).bind(...args);}
  async editors(){return (await this.stmt('SELECT role,name FROM editorial_editors ORDER BY role').all()).results;}
  async settings(){const settings=await this.stmt('SELECT * FROM editorial_editor_settings WHERE id=1').first();return {editors:(await this.stmt('SELECT role,name FROM editorial_editors ORDER BY role').all()).results,channelEnabled:Boolean(settings.channel_enabled),channelId:settings.channel_id};}
  async saveSettings(input){
    if(!Array.isArray(input?.editors)||input.editors.length!==2||typeof input.channelEnabled!=='boolean')throw fail('편집자 설정을 확인해 주세요.',400);
    const channel=String(input.channelId||'').trim();if(channel&&!slackChannelId(channel))throw fail('Slack 채널 ID를 확인해 주세요.',400);
    const rows=Object.keys(roleLabels).map(role=>{
      const matches=input.editors.filter(x=>x?.role===role);if(matches.length!==1)throw fail('편집자 역할을 확인해 주세요.',400);
      const name=String(matches[0].name||'').trim();
      if(name.length>80||/[\x00-\x1f]/.test(name))throw fail('이름은 제어 문자 없이 80자 이하로 입력해 주세요.',400);
      return {role,name};
    });
    await this.db.batch([...rows.map(x=>this.stmt('UPDATE editorial_editors SET name=?,updated_at=? WHERE role=?',x.name,now(),x.role)),this.stmt('UPDATE editorial_editor_settings SET channel_enabled=?,channel_id=? WHERE id=1',input.channelEnabled?1:0,channel)]);
    return {saved:true};
  }
  async actor(role,user){const e=await this.stmt('SELECT role,name FROM editorial_editors WHERE role=?',role||'').first();if(!e?.name)throw fail('편집자 설정을 완료하고 작업자를 선택해 주세요.',403);return {...e,user};}
  async active(project){return await this.stmt('SELECT id,project_id,owner_role,owner_name,base_version,started_at FROM editorial_locks WHERE project_id=? AND ended_at IS NULL',project).first()||null;}
  async requireLock(id,actor,allowCompleted=false){
    const lock=await this.stmt('SELECT * FROM editorial_locks WHERE id=?',id).first();
    if(!lock||lock.owner_role!==actor.role||lock.user_id!==actor.user)throw fail('현재 작업자에게 이 편집 잠금의 권한이 없습니다.',403);
    if(lock.ended_at&&!(allowCompleted&&lock.end_reason==='completed'))throw fail('편집 잠금이 종료되었습니다. 최신본에서 새로 편집을 시작해 주세요.');
    return lock;
  }
  async begin(project,actor){
    const id=crypto.randomUUID(),started=now();
    try{await this.db.batch([
      this.stmt('INSERT INTO editorial_edit_sessions(id,project_id,user_id,base_version,created_at) SELECT ?,id,?,latest_version,? FROM editorial_projects WHERE id=?',id,actor.user,started,project),
      // Keep the published 0007 NOT NULL legacy column empty; member IDs are no longer used.
      this.stmt('INSERT INTO editorial_locks(id,project_id,user_id,owner_role,owner_name,owner_slack_user_id,base_version,started_at) SELECT id,project_id,user_id,?,?,?,base_version,created_at FROM editorial_edit_sessions WHERE id=?',actor.role,actor.name,'',id)
    ]);}catch(error){if(await this.active(project))throw fail('이미 편집 중인 작업자가 있습니다.');throw error;}
    const lock=await this.active(project);if(!lock||lock.id!==id)throw fail('편집 시작 상태가 변경되었습니다. 새로고침해 주세요.');
    const v=await this.stmt("SELECT normalized_filename FROM editorial_versions WHERE project_id=? AND version=? AND state='complete'",project,lock.base_version).first();
    return {lock,filename:v?.normalized_filename,downloadUrl:v?`/api/editorial-files/projects/${project}/versions/${lock.base_version}/download`:null};
  }
  async audit(project){return (await this.stmt('SELECT id,lock_id,action,actor_role,actor_name,owner_role,owner_name,base_version,created_at,notification_status FROM editorial_lock_audit WHERE project_id=? ORDER BY created_at DESC LIMIT 30',project).all()).results;}
  async close(id,actor,force,confirmation,env,send=sendEditorialSlack){
    if(confirmation!==(force?'강제 종료':'편집 취소'))throw fail('확인 문구가 올바르지 않습니다.',400);
    const lock=await this.stmt('SELECT * FROM editorial_locks WHERE id=?',id).first();if(!lock)throw fail('편집 잠금을 찾을 수 없습니다.',404);
    if(!force&&(lock.owner_role!==actor.role||lock.user_id!==actor.user))throw fail('현재 작업자의 편집만 취소할 수 있습니다.',403);
    const existing=await this.stmt('SELECT id,notification_status FROM editorial_lock_audit WHERE lock_id=?',id).first();if(lock.ended_at)return {closed:true,eventId:existing?.id,notificationStatus:existing?.notification_status||'not_applicable',replayed:true};
    const event=crypto.randomUUID(),time=now(),action=force?'forced':'cancelled';
    await this.db.batch([
      this.stmt('UPDATE editorial_locks SET ended_at=?,end_reason=?,end_event_id=? WHERE id=? AND ended_at IS NULL',time,action,event,id),
      this.stmt("UPDATE editorial_versions SET state='cancelled',upload_url=NULL WHERE edit_session_id=? AND state='uploading' AND EXISTS(SELECT 1 FROM editorial_locks WHERE id=? AND end_event_id=?)",id,id,event),
      this.stmt('UPDATE editorial_projects SET pending_id=NULL WHERE id=? AND EXISTS(SELECT 1 FROM editorial_locks WHERE id=? AND end_event_id=?)',lock.project_id,id,event),
      this.stmt('INSERT INTO editorial_lock_audit(id,lock_id,project_id,action,actor_user_id,actor_role,actor_name,owner_role,owner_name,base_version,created_at,notification_status) SELECT ?,id,project_id,?,?,?,?,owner_role,owner_name,base_version,?,? FROM editorial_locks WHERE id=? AND end_event_id=?',event,action,actor.user,actor.role,actor.name,time,force?'pending':'not_applicable',id,event)
    ]);
    const saved=await this.stmt('SELECT id,notification_status FROM editorial_lock_audit WHERE lock_id=?',id).first();
    if(saved?.id!==event)return {closed:true,eventId:saved?.id,notificationStatus:saved?.notification_status||'not_applicable',replayed:true};
    let status=saved.notification_status;
    if(force)status=await this.notifySafely(event,env,send);
    return {closed:true,eventId:event,notificationStatus:status};
  }
  async notificationStatus(lockId){return (await this.stmt('SELECT notification_status FROM editorial_lock_audit WHERE lock_id=?',lockId).first())?.notification_status||'unknown';}
  async notifySafely(eventId,env,send=sendEditorialSlack){
    try{return await this.notify(eventId,env,send);}catch{
      try{await this.stmt("UPDATE editorial_lock_audit SET notification_status='unknown',notification_status_at=? WHERE id=? AND notification_status IN ('pending','sending')",now(),eventId).run();}catch{}
      return 'unknown';
    }
  }
  async notify(eventId,env,send){
    const event=await this.stmt('SELECT * FROM editorial_lock_audit WHERE id=?',eventId).first();
    if(!event||event.notification_status!=='pending')return event?.notification_status||'unknown';
    const settings=await this.settings(),forced=event.action==='forced';
    const destination=settings.channelId;
    let result;
    if(!settings.channelEnabled)result={status:'skipped_off'};
    else if(!destination)result={status:'skipped_unlinked'};
    else if(!env.SLACK_BOT_TOKEN)result={status:'not_configured'};
    else{
      const claim=await this.stmt("UPDATE editorial_lock_audit SET notification_status='sending',notification_status_at=? WHERE id=? AND notification_status='pending' AND (SELECT COUNT(*) FROM editorial_lock_audit WHERE action=? AND (?=0 OR owner_role=?) AND created_at>=? AND notification_status IN ('sending','sent','failed','unknown'))<?",now(),eventId,event.action,forced?1:0,event.owner_role,new Date(Date.now()-3600000).toISOString(),forced?3:60).run();
      if((claim.meta?.changes??claim.changes)===0){const status=await this.notificationStatus(event.lock_id);if(status!=='pending')return status;result={status:'rate_limited'};}
      else{
        const version=forced?null:await this.stmt("SELECT version,editor_name,change_note,uploaded_at FROM editorial_versions WHERE edit_session_id=? AND state='complete'",event.lock_id).first();
        try{result=await send(env,event,destination,version);}catch{result={status:'unknown'};}
      }
    }
    await this.stmt("UPDATE editorial_lock_audit SET notification_status=?,notification_id=?,notification_status_at=? WHERE id=? AND notification_status IN ('pending','sending')",result.status,result.messageId||null,now(),eventId).run();
    return result.status;
  }
}
export async function selectedOperator(request,env,user){const value=await unseal(cookie(request,OPERATOR_COOKIE)||'',env.SESSION_SECRET);return value?.user===user&&value.exp>Date.now()&&Object.hasOwn(roleLabels,value.role)?value.role:null;}
export async function operatorCookie(role,env,user){return setCookie(OPERATOR_COOKIE,await seal({role,user,exp:Date.now()+30*86400000},env.SESSION_SECRET),30*86400);}
