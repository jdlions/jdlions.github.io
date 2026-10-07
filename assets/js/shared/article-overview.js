import {schoolNumber,compareStudents} from './student-identity.js';

// Filter metadata locally; keep unmatched real slots distinct from missing articles.
export function filterArticleOverview(data,f={}){
  const q=(f.q||'').trim().toLowerCase(),author=(f.author||'').trim().toLowerCase();
  const studentScope=data.students.filter(s=>(!f.grade||schoolNumber(s).startsWith(f.grade))&&(!author||(s.name+' '+s.studentId).toLowerCase().includes(author)));
  const match=(a,s,withStatus=true)=>(!q||((a.titleKo||'')+' '+(a.titleEn||'')+' '+s.name+' '+s.studentId+' '+(a.assignmentName||'')).toLowerCase().includes(q))&&(!f.type||a.articleType===f.type)&&(!f.campaign||(f.campaign==='free'?!a.campaignId:a.campaignId===f.campaign))&&(!f.date||(a.submittedAt||'').slice(0,10)===f.date)&&(!withStatus||!f.status||a.status===f.status);
  const students=studentScope.filter(s=>{
    const articles=data.items.filter(a=>a.studentId===s.studentId);
    if(!f.type&&!f.campaign&&!f.date&&!f.status&&!q)return true;
    return articles.some(a=>match(a,s))||(!f.type&&!f.campaign&&!f.date&&!f.status&&(s.name+' '+s.studentId).toLowerCase().includes(q));
  }).sort(compareStudents);
  const ids=new Set(students.map(s=>s.studentId)),scopeIds=new Map(studentScope.map(s=>[s.studentId,s]));
  const counts=data.items.filter(a=>scopeIds.has(a.studentId)&&match(a,scopeIds.get(a.studentId),false));
  const byStatus={};for(const a of counts)byStatus[a.status]=(byStatus[a.status]||0)+1;
  return {students,items:data.items.filter(a=>ids.has(a.studentId)).map(a=>({...a,native:true,matches:match(a,scopeIds.get(a.studentId))})),stats:{byStatus,total:counts.filter(a=>!f.status||a.status===f.status).length},campaigns:data.campaigns||[],nextCursor:null};
}
