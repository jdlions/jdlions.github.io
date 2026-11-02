import {createDashboard} from './dashboard.js';
import {escapeHtml as e,emptyState} from '../shared/ui.js';
import {compareStudents} from '../shared/student-identity.js';
import {createPhotoManager} from './photo-manager.js';
export const typeName=t=>({school:'학교기사',feature:'피처기사',opinion:'오피니언',culture:'문화',sports:'스포츠',other:'기타'}[t]||t||'기타');
const states={unwritten:['미작성','neutral'],missing:['미제출','neutral'],draft:['작성 중','neutral'],submitted:['제출됨','pending'],reviewing:['확인 중','pending'],revision_requested:['수정 요청','action'],hold:['보류','action'],approved:['승인','complete'],scheduled:['발행 예정','complete'],unreviewed:['검토 전','pending'],rejected:['반려','action'],error:['오류','error']};
export function statusBadge(value){const [label,tone]=states[value]||[value||'없음','neutral'];return `<span class="status status-tone--${tone}">${e(label)}</span>`;}
export function studentGroups(rows){const groups=new Map();for(const row of rows){const id=row.studentId;if(!groups.has(id))groups.set(id,{studentId:id,name:row.studentName||row.authorName||id,rows:[]});const g=groups.get(id);if((!g.name||g.name===id)&&(row.studentName||row.authorName))g.name=row.studentName||row.authorName;g.rows.push(row);}return [...groups.values()].sort(compareStudents);}
export function articleCards(rows,renderRow,data){const groups=(data?.students||studentGroups(rows)).map(s=>({...s,rows:rows.filter(r=>r.studentId===s.studentId)})).sort(compareStudents);return `${data?.pendingMembers?.length?`<details class="panel"><summary>Google 계정 연결 대기 회원 ${data.pendingMembers.length}명</summary><p>기존 기사 소유자와 아직 연결되지 않은 회원입니다. 이름으로 합치지 않으며 최초 Google 로그인에서 확인합니다.</p><ul>${data.pendingMembers.map(m=>`<li>${e(m.name)}</li>`).join('')}</ul></details>`:''}${rows.some(r=>r.matches===false)?'<p class="muted overview-filter-note">검색 조건과 다른 기존 기사는 흐리게 표시합니다.</p>':''}<div class="student-grid compact-student-grid" data-queue>${groups.map(g=>`<article class="panel student-card compact-student-card"><h2>${e(g.name)}</h2>${['school','feature',...new Set(g.rows.map(r=>r.articleType).filter(t=>!['school','feature'].includes(t)))].map(type=>`<section class="compact-slot"><h3>${e(typeName(type))}</h3><div>${g.rows.filter(r=>r.articleType===type).map(renderRow).join('')||statusBadge('missing')}</div></section>`).join('')}</article>`).join('')||emptyState('대상 학생이 없습니다','검색 조건을 확인하세요.')}</div>`;}

export function assignmentCards(rows){return `<div class="student-grid">${studentGroups(rows).map(g=>`<article class="panel student-card" data-assignment-card><h3>${e(g.name)}</h3>${['school','feature',...new Set(g.rows.map(r=>r.articleType).filter(t=>!['school','feature'].includes(t)))].map(type=>{const slots=g.rows.filter(r=>r.articleType===type);return `<section><h4>${e(typeName(type))}</h4>${slots.map(r=>`<button type="button" class="student-slot" data-progress-row data-type="${e(r.articleType)}" data-status="${e(r.articleStatus||'unwritten')}" data-student="${e((g.name+' '+g.studentId).toLowerCase())}" ${r.articleId?`data-review="${e(r.articleId)}"`:'disabled'}><span>${e(r.slotName)}${r.ordinal>1?' · '+r.ordinal:''}</span>${statusBadge(r.articleStatus||'unwritten')}</button>`).join('')||'<p class="muted">배정 없음</p>'}</section>`;}).join('')}</article>`).join('')||emptyState('대상 학생이 없습니다','과제를 배부하면 진행 상황이 표시됩니다.')}</div>`;}
export function createAdminOverview(service,{navigate=()=>{}}={}){
 const controlDashboard=createDashboard(navigate);
 const photoManager=createPhotoManager(service,{studentGroups,typeName,statusBadge,navigate});
 const cancel=()=>{photoManager.cancel();controlDashboard.cancel();};
 function dashboard(root){controlDashboard.render(root);}
 function photos(root,route){photoManager.photos(root,route);}
 return {cancel,dashboard,photos};
}
