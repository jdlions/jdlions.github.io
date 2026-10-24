import {academicYear} from './student-identity.js';
export function studentProfile(displayName){
  const match=/^([123]\d{4})\s*([^\d\s].*)$/.exec(String(displayName||'').trim());
  return match?{studentNumber:match[1],name:match[2].trim()}:{studentNumber:'',name:String(displayName||'').trim()};
}
export function signupIdentity(identity,now=new Date()){
  const profile=studentProfile(identity.name),match=/^h(\d{2})\d{5}@joongdong\.hs\.kr$/.exec(identity.email||'');
  const entryYear=match?2000+Number(match[1]):null,cohort=entryYear?entryYear-1990:null;
  const grade=entryYear?academicYear(now)-entryYear+1:null;
  return {...profile,email:identity.email,cohort,grade,
    eligible:!!entryYear&&grade>=1&&grade<=3,
    numberMatches:!!profile.studentNumber&&Number(profile.studentNumber[0])===grade};
}
