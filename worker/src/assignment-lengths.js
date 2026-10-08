import {parseFragment} from 'parse5';
import {editorText,characterCount} from '../../assets/js/shared/character-count.js';
import {normalizeLengthRules,lengthResult,lengthFeedback} from '../../assets/js/shared/length-rules.js';
import {seal,unseal} from './security.js';

const removed=new Set(['script','style','iframe','object','embed','svg','math']);
const readable=new Set(['p','br','div','strong','b','em','i','u','s','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','a','span']);
export function submittedCharacterCount(html){
  // HTML5 parsing handles entities and malformed legacy HTML like a browser.
  // The DOM adapter then uses the unchanged PR #44/#45 text/count functions.
  const convert=node=>{
    if(removed.has(node.tagName)||node.nodeName==='#comment')return [];
    if(node.nodeName==='#text')return [{nodeType:3,nodeName:'#text',nodeValue:node.value,textContent:node.value,childNodes:[]}];
    const childNodes=(node.childNodes||[]).flatMap(convert);
    if(node.tagName&&!readable.has(node.tagName))return childNodes;
    return [{nodeType:1,nodeName:(node.tagName||'ROOT').toUpperCase(),childNodes,firstChild:childNodes[0],textContent:childNodes.map(x=>x.textContent).join('')}];
  };
  return characterCount(editorText(convert(parseFragment(String(html||'')))[0]));
}
export function validateSubmissionLength(article){
  const result=lengthResult(submittedCharacterCount(article.draftHtml),article);
  if(!result.allowed)throw Object.assign(new Error('분량 기준을 충족하지 않았습니다. '+result.text+' · 수정 후 다시 제출해주세요.'),{status:400,code:'article_length_out_of_range'});
  return result;
}
const source=`FROM assignment_slot_instances i JOIN articles a ON a.id=i.article_id LEFT JOIN assignment_recipients p ON p.campaign_id=i.campaign_id AND p.student_id=i.student_id LEFT JOIN article_revisions r ON r.id=(SELECT id FROM article_revisions WHERE article_id=a.id AND author_role='student' AND revision_kind IN ('submission','resubmission') ORDER BY revision_number DESC LIMIT 1) WHERE i.campaign_id=?`;
const signatureSQL=`SELECT json_group_array(json_array(id,status,updatedAt,revisionId)) signature FROM (SELECT a.id,a.status,a.updated_at updatedAt,r.id revisionId ${source} ORDER BY a.id)`;
const signatureOf=rows=>JSON.stringify(rows.map(r=>[r.id,r.status,r.updatedAt,r.revisionId]));
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
const stale=()=>Object.assign(new Error('검사 이후 과제 또는 제출물이 변경되었습니다. 다시 검사하고 대상 확인을 진행해 주세요.'),{status:409,code:'stale_length_review'});
const rowsFor=async(db,id)=>(await db.prepare(`SELECT a.id,a.student_id studentId,p.student_name studentName,a.article_type articleType,a.status,a.updated_at updatedAt,r.id revisionId,r.content_html submittedHtml ${source} ORDER BY a.id`).bind(id).all()).results;
export function assessSubmissions(rows,rules){
  const active=new Set(['submitted','reviewing']),completed=new Set(['approved','scheduled']);
  const targets=[],completedOutside=[],unverifiable=[];let valid=0,below=0,above=0;
  for(const row of rows){
    if(!active.has(row.status)&&!completed.has(row.status))continue;
    const publicRow={id:row.id,studentId:row.studentId,studentName:row.studentName,articleType:row.articleType,status:row.status};
    if(!row.revisionId){unverifiable.push(publicRow);continue;}
    const result=lengthResult(submittedCharacterCount(row.submittedHtml),rules),item={...publicRow,...result};
    if(result.allowed){if(active.has(row.status))valid++;continue;}
    if(completed.has(row.status)){completedOutside.push(item);continue;}
    targets.push(item);if(result.state==='below')below++;else above++;
  }
  return {targets,completedOutside,unverifiable,valid,below,above,targetStudents:new Set(targets.map(r=>r.studentId)).size,belowStudents:new Set(targets.filter(r=>r.state==='below').map(r=>r.studentId)).size,aboveStudents:new Set(targets.filter(r=>r.state==='above').map(r=>r.studentId)).size};
}
export async function reviewAssignmentLengths(db,repo,id,input,viewer,secret,apply=false){
  const rules=normalizeLengthRules(input),campaign=await repo.getCampaign(id);
  if(!campaign)throw Object.assign(new Error('과제를 찾을 수 없습니다.'),{status:404,code:'assignment_not_found'});
  if(campaign.status==='closed')throw Object.assign(new Error('종료된 과제는 일괄 반려할 수 없습니다.'),{status:409,code:'assignment_closed'});
  const rows=await rowsFor(db,id),signature=signatureOf(rows),hash=await digest(JSON.stringify([signature,campaign.updatedAt,campaign.minCharacters,campaign.maxCharacters]));
  const report=assessSubmissions(rows,rules);
  if(!apply){const token=await seal({id,actor:viewer.sub,rules,hash,nonce:crypto.randomUUID(),exp:Date.now()+10*60*1000},secret);return {...report,...rules,token};}
  const token=typeof input.token==='string'&&await unseal(input.token,secret);
  if(!token||token.id!==id||token.actor!==viewer.sub||token.exp<Date.now()||JSON.stringify(token.rules)!==JSON.stringify(rules)||input.confirmation!=='반려')throw Object.assign(new Error('대상 검사 후 확인란에 반려를 입력해 주세요.'),{status:400,code:'invalid_length_confirmation'});
  const previous=await db.prepare('SELECT rejected_count rejectedCount FROM assignment_length_reviews WHERE id=? AND actor_id=?').bind(token.nonce,viewer.sub).first();
  if(previous)return {applied:true,rejectedCount:previous.rejectedCount,replayed:true};
  if(token.hash!==hash)throw stale();
  const timestamp=new Date().toISOString();
  const statements=[db.prepare(`INSERT INTO assignment_length_reviews(id,campaign_id,actor_id,min_characters,max_characters,rejected_count,checked_at,valid) VALUES(?,?,?,?,?,?,?,CASE WHEN ?=(${signatureSQL}) AND EXISTS(SELECT 1 FROM assignment_campaigns WHERE id=? AND updated_at=? AND min_characters IS ? AND max_characters IS ? AND status<>'closed') THEN 1 ELSE 0 END)`).bind(token.nonce,id,viewer.sub,rules.minCharacters,rules.maxCharacters,report.targets.length,timestamp,signature,id,id,campaign.updatedAt,campaign.minCharacters,campaign.maxCharacters),db.prepare('UPDATE assignment_campaigns SET min_characters=?,max_characters=?,updated_at=? WHERE id=?').bind(rules.minCharacters,rules.maxCharacters,timestamp,id)];
  for(const item of report.targets){
    const revisionId=crypto.randomUUID();
    statements.push(db.prepare(`INSERT INTO article_revisions(id,article_id,author_user_id,author_role,revision_kind,title_ko,title_en,content_html,revision_number,created_at) SELECT ?,a.id,?,'admin','status_change',a.title_ko,a.title_en,CASE WHEN a.editor_draft_html='' THEN a.draft_html ELSE a.editor_draft_html END,COALESCE((SELECT MAX(revision_number) FROM article_revisions WHERE article_id=a.id),0)+1,? FROM articles a WHERE a.id=?`).bind(revisionId,viewer.sub,timestamp,item.id));
    statements.push(db.prepare(`INSERT INTO article_feedback(article_id,student_feedback,internal_note,updated_by_user_id,updated_at) VALUES(?,?,'',?,?) ON CONFLICT(article_id) DO UPDATE SET student_feedback=CASE WHEN article_feedback.student_feedback='' THEN excluded.student_feedback ELSE article_feedback.student_feedback||char(10)||char(10)||excluded.student_feedback END,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at`).bind(item.id,lengthFeedback(item,rules),viewer.sub,timestamp));
    statements.push(db.prepare("UPDATE articles SET status='revision_requested',current_editor_revision_id=?,updated_at=? WHERE id=?").bind(revisionId,timestamp,item.id));
  }
  try{await db.batch(statements);}catch(error){
    if(/UNIQUE constraint failed.*assignment_length_reviews/i.test(error.message)){
      const completed=await db.prepare('SELECT rejected_count rejectedCount FROM assignment_length_reviews WHERE id=? AND actor_id=?').bind(token.nonce,viewer.sub).first();
      if(completed)return {applied:true,rejectedCount:completed.rejectedCount,replayed:true};
    }
    if(/CHECK constraint failed.*valid/i.test(error.message))throw stale();throw error;
  }
  return {applied:true,rejectedCount:report.targets.length};
}
