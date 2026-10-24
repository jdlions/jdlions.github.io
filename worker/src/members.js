import {currentCohorts,isActivityEligible} from '../../assets/js/shared/student-identity.js';
import {memberRecipient,resolveMemberAssignments} from './member-assignments.js';
const failure=(message,status=403,code='membership_required')=>Object.assign(new Error(message),{status,code});
export const MEMBERSHIP_VERSION=1;
const primary=db=>typeof db.withSession==='function'?db.withSession('first-primary'):db;
const mapped=row=>({id:row.id,name:row.name,email:row.email,role:row.role,studentNumber:row.student_number,cohort:row.cohort,active:!!row.active,linked:!!row.google_sub,createdAt:row.created_at,updatedAt:row.updated_at,version:row.auth_version});
export function validateMember(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw failure('회원 정보를 확인해 주세요.',400,'invalid_member');
  const name=String(input.name||'').trim(),email=String(input.email||'').trim().toLowerCase(),role=input.role;
  if(!name||name.length>100||/[\x00-\x1f\x7f]/.test(name)||!['teacher','student'].includes(role)||! /^[a-z0-9][a-z0-9._+-]{0,63}@joongdong\.hs\.kr$/.test(email))throw failure('이름과 학교 Google 계정 이메일을 확인해 주세요.',400,'invalid_member');
  if(typeof input.active!=='boolean')throw failure('활성화 상태를 확인해 주세요.',400,'invalid_member');
  const number=role==='student'?String(input.studentNumber||'').trim():null,cohort=role==='student'?Number(input.cohort):null;
  if(role==='student'&&(!/^\d{5}$/.test(number)||!/^h\d{2}\d{5}@joongdong\.hs\.kr$/.test(email)||!Number.isInteger(cohort)||cohort<1||cohort>999))throw failure('학생 이메일(h + 입학연도 두 자리 + 학번 다섯 자리), 학번, 기수를 확인해 주세요.',400,'invalid_member');
  // Email's historical school number can differ after promotion. It is never an identity key.
  return {name,email,role,number,cohort,active:input.active?1:0};
}
export class Members {
  constructor(db){this.db=primary(db);}
  async get(id){return this.db.prepare('SELECT * FROM members WHERE id=?').bind(id).first();}
  async authenticate(value){
    if(value.membershipVersion!==MEMBERSHIP_VERSION||!value.memberId||!value.sub)throw failure('다시 로그인해 주세요.',401,'authentication_required');
    const row=await this.get(value.memberId);
    if(!row||!row.active||row.google_sub!==value.sub||row.auth_version!==value.authVersion)throw failure('회원 상태가 변경되었습니다. 다시 로그인하거나 관리자에게 문의해 주세요.',401,'authentication_required');
    return {...value,name:row.name,email:row.email,studentNumber:row.student_number,cohort:row.cohort,role:row.role==='teacher'?'admin':'student',studentId:row.role==='student'?row.google_sub:null};
  }
  async login(identity,{allowUnknown=false}={}){
    // The caller must first verify Google's signature/audience/nonce/hd/email.
    const email=identity.email.toLowerCase();
    let row=await this.db.prepare('SELECT * FROM members WHERE google_sub=? OR email=? ORDER BY id').bind(identity.sub,email).all();
    if(!row.results.length&&allowUnknown)return null;
    if(row.results.length!==1)throw failure('등록된 활성 회원만 이용할 수 있습니다. 관리자에게 문의해 주세요.');
    row=row.results[0];
    if(!row.active||row.email!==email||(row.google_sub&&row.google_sub!==identity.sub))throw failure('등록 정보와 Google 계정이 일치하지 않습니다. 관리자에게 문의해 주세요.');
    if(!row.google_sub){
      const now=new Date().toISOString();
      try{await this.db.batch([this.db.prepare('UPDATE members SET google_sub=?,linked_at=?,updated_at=?,changed_by=? WHERE id=? AND google_sub IS NULL AND active=1 AND email=? AND auth_version=?').bind(identity.sub,now,now,'oauth:'+identity.sub,row.id,email,row.auth_version),...resolveMemberAssignments(this.db,row.id)]);}
      catch{throw failure('계정 연결을 확인할 수 없습니다. 관리자에게 문의해 주세요.',409,'member_link_conflict');}
      row=await this.get(row.id);
      if(!row?.active||row.google_sub!==identity.sub||row.email!==email)throw failure('회원 정보가 변경되었습니다. 다시 로그인해 주세요.');
    }else if(row.role==='student')await this.db.batch(resolveMemberAssignments(this.db,row.id));
    return {memberId:row.id,authVersion:row.auth_version,membershipVersion:MEMBERSHIP_VERSION,role:row.role==='teacher'?'admin':'student',studentId:row.role==='student'?identity.sub:null,name:row.name,email:row.email};
  }
  async roster({forAssignment=false}={}){
    const {results}=await this.db.prepare("SELECT id,google_sub,student_number,name,cohort FROM members WHERE role='student' AND active=1 ORDER BY student_number,id").all();
    return results.filter(r=>!forAssignment||isActivityEligible(r)).map(r=>({id:r.google_sub||memberRecipient(r.id),memberId:r.id,name:`${r.student_number} ${r.name}`,studentNumber:r.student_number,cohort:r.cohort}));
  }
  async list(params){
    const q=String(params.get('q')||'').trim();if(q.length>100)throw failure('검색어는 100자 이하로 입력해 주세요.',400,'invalid_member_search');
    const role=params.get('role')||'',cohort=params.get('cohort')||'';
    if((role&&!['teacher','student'].includes(role))||(cohort&&!/^\d{1,3}$/.test(cohort)))throw failure('회원 필터를 확인해 주세요.',400,'invalid_member_search');
    const like='%'+q.replace(/[!%_]/g,'!$&')+'%';
    const sort=params.get('sort')||'default';if(!['default','recent'].includes(sort))throw failure('정렬을 확인해 주세요.',400,'invalid_member_search');
    const order=sort==='recent'?'created_at DESC,id':'role DESC,cohort DESC,student_number,name,id';
    const {results}=await this.db.prepare("SELECT * FROM members WHERE (?='' OR role=?) AND (?='' OR cohort=?) AND (name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' OR student_number LIKE ? ESCAPE '!') ORDER BY "+order).bind(role,role,cohort,cohort,like,like,like).all();
    const activity=params.get('activity')||'current';
    if(!['current','all'].includes(activity))throw failure('활동 범위를 확인해 주세요.',400,'invalid_member_search');
    const stored=(await this.db.prepare('SELECT number FROM member_cohorts ORDER BY number DESC').all()).results.map(r=>r.number);
    return {members:results.filter(r=>activity==='all'||isActivityEligible(r)).map(mapped),cohorts:[...new Set([...stored,...currentCohorts()])].sort((a,b)=>b-a)};
  }
  async save(id,input,actor){
    const v=validateMember(input),now=new Date().toISOString();
    if(v.cohort&&!currentCohorts().includes(v.cohort)&&!await this.db.prepare('SELECT number FROM member_cohorts WHERE number=?').bind(v.cohort).first())throw failure('기수를 먼저 등록해 주세요.',400,'unknown_cohort');
    if(id){
      const old=await this.get(id);if(!old)throw failure('회원을 찾을 수 없습니다.',404,'member_not_found');
      if(!Number.isInteger(input.version)||input.version!==old.auth_version)throw failure('다른 관리자가 수정했습니다. 새로고침해 주세요.',409,'member_conflict');
      if(id===actor.memberId&&(!v.active||v.role!=='teacher'||v.email!==old.email))throw failure('현재 로그인한 교사 계정의 접근 권한은 직접 해제할 수 없습니다.',409,'self_lockout_blocked');
    }
    const target=id||crypto.randomUUID();
    if(v.cohort&&currentCohorts().includes(v.cohort))await this.cohort({number:v.cohort});
    try{
      if(id){
        const result=await this.db.prepare('UPDATE members SET name=?,email=?,role=?,student_number=?,cohort=?,active=?,auth_version=auth_version+1,updated_at=?,changed_by=? WHERE id=? AND auth_version=?').bind(v.name,v.email,v.role,v.number,v.cohort,v.active,now,actor.memberId,id,input.version).run();
        if((result.meta?.changes??result.changes)===0)throw failure('다른 관리자가 수정했습니다. 새로고침해 주세요.',409,'member_conflict');
      }else await this.db.prepare('INSERT INTO members(id,email,name,role,student_number,cohort,active,created_at,updated_at,changed_by) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(target,v.email,v.name,v.role,v.number,v.cohort,v.active,now,now,actor.memberId).run();
    }catch(error){if(error.status)throw error;const text=String(error.message);if(/member_pending_email_locked/.test(text))throw failure('배정 대상 회원의 로그인 전 이메일은 변경할 수 없습니다. 등록 계정을 먼저 확인해 주세요.',409,'assigned_member_email_locked');if(/bootstrap_teacher_protected|last_teacher_required/.test(text))throw failure('기본 관리자와 마지막 활성 교사의 권한은 해제할 수 없습니다.',409,'teacher_protected');if(/UNIQUE/.test(text))throw failure('이메일 또는 같은 기수의 학번이 이미 등록되어 있습니다.',409,'member_duplicate');throw error;}
    return mapped(await this.get(target));
  }
  async cohort(input){
    const number=Number(input?.number);if(!Number.isInteger(number)||number<1||number>999)throw failure('기수는 1~999 사이의 정수여야 합니다.',400,'invalid_cohort');
    await this.db.prepare('INSERT OR IGNORE INTO member_cohorts(number,created_at) VALUES(?,?)').bind(number,new Date().toISOString()).run();return {number};
  }
}
