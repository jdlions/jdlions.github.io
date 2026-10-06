// Classroom user IDs are opaque Google IDs, never school numbers.
export function schoolNumber(student){
  return String(student.name||student.studentName||student.authorName||'').match(/(?:^|\s)([123]\d{4})(?=\s|[^\d]|$)/)?.[1]||'';
}
export function isNewAssignmentEligible(student){return !schoolNumber(student).startsWith('3');}
export function compareStudents(a,b){return (schoolNumber(a)||String(a.name||a.studentName||a.authorName||a.studentId||a.id)).localeCompare(schoolNumber(b)||String(b.name||b.studentName||b.authorName||b.studentId||b.id),'ko',{numeric:true})||String(a.studentId||a.id).localeCompare(String(b.studentId||b.id));}
