import {createRemoteJWKSet,jwtVerify,customFetch} from 'jose';
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:20000,cacheMaxAge:300000,[customFetch]:(url,options)=>fetch(url,{...options,redirect:'manual'})});
export async function verifyGoogleIdentity(tokens,clientId,nonce,keySet=keys){
  const invalid=()=>Object.assign(new Error('Google 계정 검증에 실패했습니다. 다시 로그인해 주세요.'),{status:401,code:'google_identity_invalid'});
  try{
    if(!nonce||!tokens.id_token||!tokens.access_token||String(tokens.token_type).toLowerCase()!=='bearer')throw invalid();
    const {payload}=await jwtVerify(tokens.id_token,keySet,{issuer:['https://accounts.google.com','accounts.google.com'],audience:clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat','email','email_verified','nonce','hd'],clockTolerance:5});
    if(payload.nonce!==nonce||payload.email_verified!==true||payload.hd!=='joongdong.hs.kr'||typeof payload.sub!=='string'||!/^\d{1,255}$/.test(payload.sub)||typeof payload.email!=='string'||!payload.email.toLowerCase().endsWith('@joongdong.hs.kr')||(payload.azp&&payload.azp!==clientId))throw invalid();
    if(payload.at_hash){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tokens.access_token)));const hash=btoa(String.fromCharCode(...bytes.slice(0,16))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');if(hash!==payload.at_hash)throw invalid();}
    return {sub:payload.sub,email:payload.email.toLowerCase()};
  }catch{throw invalid();}
}
