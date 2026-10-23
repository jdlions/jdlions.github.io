// Classroom user IDs are opaque Google IDs, never school numbers.
export function schoolNumber(student){
  return String(student.name||student.studentName||student.authorName||'').match(/(?:^|\s)([123]\d{4})(?=\s|[^\d]|$)/)?.[1]||'';
}
// March 1, 00:00 KST, independent of the runtime/browser timezone.
export function academicYear(now=new Date()){
  const korea=new Date(new Date(now).getTime()+9*60*60*1000);
  return korea.getUTCFullYear()-(korea.getUTCMonth()<2?1:0);
}
export function currentCohorts(now=new Date()){const first=academicYear(now)-1990;return [first,first-1];}
export function suggestedCohort(number,now=new Date()){
  const grade=/^([12])\d{4}$/.exec(String(number));return grade?currentCohorts(now)[Number(grade[1])-1]:null;
}
export function isActivityEligible(member,now=new Date()){
  if(member.role==='teacher')return true;
  return member.cohort!=null&&currentCohorts(now).includes(Number(member.cohort));
}
export function isNewAssignmentEligible(student){
  // Legacy display summaries lack membership metadata; server rosters always have a cohort.
  return student.cohort!=null?isActivityEligible(student):!schoolNumber(student).startsWith('3');
}
export function compareStudents(a,b){return (schoolNumber(a)||String(a.name||a.studentName||a.authorName||a.studentId||a.id)).localeCompare(schoolNumber(b)||String(b.name||b.studentName||b.authorName||b.studentId||b.id),'ko',{numeric:true})||String(a.studentId||a.id).localeCompare(String(b.studentId||b.id));}
