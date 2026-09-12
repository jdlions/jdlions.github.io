import {draftSummary} from '../../assets/js/shared/article-preview.js';

const invalid = message => Object.assign(new Error(message), {status:400,code:'invalid_article_query'});
const statuses = ['draft','submitted','reviewing','revision_requested','hold','approved','scheduled'];
const text = (params,key,max=200) => {
  const value=(params.get(key)||'').trim();
  if(value.length>max)throw invalid(key+' is too long.');
  return value;
};
const escapeLike = value => '%'+value.replace(/[\\%_]/g,'\\$&')+'%';
const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function decode(value){
  try{return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));}
  catch{throw invalid('Invalid cursor.');}
}
export function articleListOptions(params,studentId){
  const raw=params.get('limit')??'20',limit=Number(raw);
  if(!/^\d+$/.test(raw)||!Number.isInteger(limit)||limit<1||limit>50)throw invalid('limit must be between 1 and 50.');
  const options={limit,q:text(params,'q'),author:text(params,'author'),status:text(params,'status',40),type:text(params,'type',80),campaign:text(params,'campaign',100),date:text(params,'date',10),picker:params.get('picker')==='1',stats:params.get('stats')!=='0'};
  if(options.status&&!statuses.includes(options.status))throw invalid('Invalid status.');
  if(options.date&&!/^\d{4}-\d{2}-\d{2}$/.test(options.date))throw invalid('Invalid date.');
  const scope=JSON.stringify([studentId||null,limit,options.q,options.author,options.status,options.type,options.campaign,options.date,options.picker]);
  const cursor=text(params,'cursor',4096);
  options.snapshot=new Date().toISOString();
  if(cursor){
    const c=decode(cursor);
    if(c?.v!==1||c.scope!==scope||typeof c.id!=='string'||!c.id||c.id.length>100||![c.time,c.snapshot].every(x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(x)&&Number.isFinite(Date.parse(x))))throw invalid('Invalid cursor or changed filters.');
    options.after={time:c.time,id:c.id};options.snapshot=c.snapshot;
  }
  options.scope=scope;return options;
}

const joins=` FROM articles a
 LEFT JOIN assignment_slot_instances i ON i.article_id=a.id
 LEFT JOIN assignment_campaigns c ON c.id=i.campaign_id
 LEFT JOIN assignment_recipients r ON r.campaign_id=i.campaign_id AND r.student_id=a.student_id`;
function conditions(options,studentId,withStatus=true){
  const clauses=['a.updated_at<=?'],args=[options.snapshot];
  if(studentId){clauses.push('a.student_id=?');args.push(studentId);}
  if(options.q){clauses.push("(a.title_ko LIKE ? ESCAPE '\\' OR a.title_en LIKE ? ESCAPE '\\' OR a.student_id LIKE ? ESCAPE '\\' OR r.student_name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");args.push(...Array(5).fill(escapeLike(options.q)));}
  if(options.author){clauses.push("(a.student_id LIKE ? ESCAPE '\\' OR r.student_name LIKE ? ESCAPE '\\')");args.push(...Array(2).fill(escapeLike(options.author)));}
  if(withStatus&&options.status){clauses.push('a.status=?');args.push(options.status);}
  if(options.type){clauses.push('a.article_type=?');args.push(options.type);}
  if(options.campaign==='free')clauses.push('i.id IS NULL');
  else if(options.campaign){clauses.push('i.campaign_id=?');args.push(options.campaign);}
  if(options.date){clauses.push('a.submitted_at>=? AND a.submitted_at<?');args.push(options.date,options.date+'T99');}
  return {where:' WHERE '+clauses.join(' AND '),args};
}
export async function listArticlePage(db,options,studentId){
  const filter=conditions(options,studentId);
  let where=filter.where,args=[...filter.args];
  if(options.after){where+=' AND (a.updated_at<? OR (a.updated_at=? AND a.id<?))';args.push(options.after.time,options.after.time,options.after.id);}
  const fields=`a.id,a.student_id studentId,a.article_type articleType,a.title_ko titleKo,a.title_en titleEn,a.status,a.updated_at updatedAt,
 a.submitted_at submittedAt,i.id assignmentInstanceId,i.campaign_id campaignId,c.name assignmentName,COALESCE(NULLIF(r.student_name,''),a.student_id) authorName`;
  const rows=(await db.prepare('SELECT '+fields+(options.picker?'':',a.draft_html draftHtml')+joins+where+' ORDER BY a.updated_at DESC,a.id DESC LIMIT ?').bind(...args,options.limit+1).all()).results;
  const hasNext=rows.length>options.limit,items=rows.slice(0,options.limit).map(({draftHtml,...row})=>options.picker?row:{...row,...draftSummary(draftHtml)});
  const last=items.at(-1),nextCursor=hasNext?encode({v:1,scope:options.scope,snapshot:options.snapshot,time:last.updatedAt,id:last.id}):null;
  const result={items,nextCursor,limit:options.limit};
  if(options.stats&&!options.picker){
    const countFilter=conditions(options,studentId,false);
    const counts=(await db.prepare('SELECT a.status,COUNT(*) count'+joins+countFilter.where+' GROUP BY a.status').bind(...countFilter.args).all()).results;
    const byStatus=Object.fromEntries(counts.map(x=>[x.status,x.count]));
    result.stats={byStatus,total:options.status?(byStatus[options.status]||0):counts.reduce((sum,x)=>sum+x.count,0)};
    // Only IDs/names for visible articles, never the roster or campaign recipients.
    result.campaigns=(await db.prepare('SELECT DISTINCT c.id,c.name'+joins+' WHERE c.id IS NOT NULL'+(studentId?' AND a.student_id=?':'')+' ORDER BY c.name,c.id').bind(...(studentId?[studentId]:[])).all()).results;
  }
  return result;
}
