import {Members} from './members.js';
import {signupIdentity,studentProfile} from '../../assets/js/shared/signup-identity.js';
import {academicYear} from '../../assets/js/shared/student-identity.js';
export const SIGNUP_COOKIE='__Host-lp_signup';
const error=(message,status=400,code='signup_invalid')=>Object.assign(new Error(message),{status,code});
const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const bytes=text=>Uint8Array.from(text.match(/../g),v=>parseInt(v,16));
async function digest(code,salt){
  const key=await crypto.subtle.importKey('raw',encoder.encode(code),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(salt),iterations:100000,hash:'SHA-256'},key,256));
}
export {digest as hashSignupCode};
const equal=(a,b)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;};
const codeValue=value=>typeof value==='string'?value.trim():'';
const validCode=code=>code.length>=12&&code.length<=128&&!/[\x00-\x1f\x7f]/.test(code);
export class Signup {
  constructor(db,secret,now=()=>new Date()) {this.db=typeof db.withSession==='function'?db.withSession('first-primary'):db;this.secret=secret;this.now=now;this.members=new Members(this.db);}
  async settings(){
    const r=await this.db.prepare('SELECT code_hash,enabled,version,updated_at FROM member_signup_code WHERE id=1').first();
    return {configured:!!r.code_hash,enabled:!!r.enabled,version:r.version,updatedAt:r.updated_at};
  }
  async configure(input,actor){
    if(typeof input?.enabled!=='boolean'||!Number.isInteger(input.version))throw error('가입 코드 설정을 확인해 주세요.');
    const current=await this.db.prepare('SELECT * FROM member_signup_code WHERE id=1').first();
    let hash=current.code_hash,salt=current.salt;
    if(input.code!==undefined&&input.code!==''){
      const code=codeValue(input.code);if(!validCode(code))throw error('새 코드는 앞뒤 공백을 제외하고 12~128자로 설정해 주세요.');
      salt=hex(crypto.getRandomValues(new Uint8Array(16)));hash=await digest(code,salt);
    }
    if(input.enabled&&!hash)throw error('먼저 새 가입 코드를 설정해 주세요.');
    const result=await this.db.prepare('UPDATE member_signup_code SET code_hash=?,salt=?,enabled=?,version=version+1,updated_at=?,updated_by=? WHERE id=1 AND version=?').bind(hash,salt,input.enabled?1:0,this.now().toISOString(),actor.memberId,input.version).run();
    if((result.meta?.changes??result.changes)!==1)throw error('다른 관리자가 변경했습니다. 새로고침해 주세요.',409,'signup_code_conflict');
    return this.settings();
  }
  async available(identity){
    // Recheck on every pending request; inactive/manual registrations cannot be bypassed.
    if(await this.members.login(identity,{allowUnknown:true}))throw error('이미 등록된 계정입니다. 다시 로그인해 주세요.',409,'signup_existing');
    return signupIdentity(identity,this.now());
  }
  async limit(sub){
    const key=await crypto.subtle.importKey('raw',encoder.encode(this.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const account='account:'+hex(await crypto.subtle.sign('HMAC',key,encoder.encode(sub)));
    const window=Math.floor(this.now().getTime()/900000);
    // An account already over its own quota must not exhaust everybody's quota.
    await this.db.batch([
      this.db.prepare('INSERT INTO member_signup_attempts(bucket,window,attempts) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET window=excluded.window,attempts=CASE WHEN member_signup_attempts.window=excluded.window THEN member_signup_attempts.attempts+1 ELSE 1 END').bind(account,window),
      this.db.prepare('INSERT INTO member_signup_attempts(bucket,window,attempts) SELECT ?,?,1 WHERE (SELECT attempts FROM member_signup_attempts WHERE bucket=? AND window=?)<=5 ON CONFLICT(bucket) DO UPDATE SET window=excluded.window,attempts=CASE WHEN member_signup_attempts.window=excluded.window THEN member_signup_attempts.attempts+1 ELSE 1 END').bind('global',window,account,window)
    ]);
    const {results}=await this.db.prepare('SELECT bucket,attempts FROM member_signup_attempts WHERE bucket IN (?,?)').bind(account,'global').all();
    if(results.some(r=>r.attempts>(r.bucket==='global'?100:5)))throw error('가입 시도가 많습니다. 잠시 후 다시 시도해 주세요.',429,'signup_rate_limited');
  }
  async register(identity,input){
    await this.available(identity);await this.limit(identity.sub);
    if(!input||Object.keys(input).some(k=>!['code','name','studentNumber','confirmed'].includes(k))||input.confirmed!==true)throw error('가입 정보를 확인한 뒤 다시 시도해 주세요.');
    const profile=signupIdentity(identity,this.now()),name=String(input.name||'').trim(),number=String(input.studentNumber||'').trim();
    if(!profile.eligible)throw error('학교 이메일의 입학 연도를 확인할 수 없거나 학생 가입 대상 학년이 아닙니다. 관리자에게 문의해 주세요.',400,'signup_review_required');
    if(!name||name.length>100||/[\x00-\x1f\x7f]/.test(name)||!/^([123])\d{4}$/.test(number)||Number(number[0])!==profile.grade)throw error('현재 학번의 학년과 이메일 입학 연도가 일치하는지 확인해 주세요.',400,'signup_profile_conflict');
    const config=await this.db.prepare('SELECT * FROM member_signup_code WHERE id=1').first(),code=codeValue(input.code);
    if(!config.enabled||!config.code_hash||!validCode(code)||!equal(await digest(code,config.salt),config.code_hash))throw error('가입할 수 없습니다. 코드를 확인하거나 관리자에게 문의해 주세요.',400,'signup_code_invalid');
    const now=this.now().toISOString(),id=crypto.randomUUID();
    try{
      const result=await this.db.batch([
        this.db.prepare('INSERT OR IGNORE INTO member_cohorts(number,created_at) SELECT ?,? FROM member_signup_code WHERE id=1 AND enabled=1 AND version=?').bind(profile.cohort,now,config.version),
        this.db.prepare("INSERT INTO members(id,google_sub,email,name,role,student_number,cohort,active,created_at,updated_at,linked_at,changed_by) SELECT ?,?,?,?,'student',?,?,1,?,?,?,? FROM member_signup_code WHERE id=1 AND enabled=1 AND version=?").bind(id,identity.sub,identity.email,name,number,profile.cohort,now,now,now,'signup:'+identity.sub,config.version)
      ]);
      if((result[1].meta?.changes??result[1].changes)!==1)throw error('가입할 수 없습니다. 코드를 확인하거나 관리자에게 문의해 주세요.',400,'signup_code_invalid');
    }catch(e){if(e.status)throw e;throw error('가입 정보가 이미 등록되었거나 변경되었습니다. 다시 로그인하거나 관리자에게 문의해 주세요.',409,'signup_conflict');}
    return this.members.login(identity);
  }
}
export function profileSuggestion(viewer,now=new Date()){
  if(viewer.role!=='student'||!viewer.googleName)return null;
  const p=studentProfile(viewer.googleName);
  if(!p.studentNumber||p.studentNumber===viewer.studentNumber)return null;
  const grade=academicYear(now)-1990-Number(viewer.cohort)+1;
  if(p.name!==viewer.name||Number(p.studentNumber[0])!==grade)return {conflict:true};
  return {studentNumber:p.studentNumber};
}
