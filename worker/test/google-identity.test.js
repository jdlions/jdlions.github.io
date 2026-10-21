import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {verifyGoogleIdentity} from '../src/google-identity.js';
const keys=await generateKeyPair('RS256');
const claims={sub:'123456789',email:'teacher@joongdong.hs.kr',email_verified:true,hd:'joongdong.hs.kr',nonce:'expected',iss:'https://accounts.google.com',aud:'client',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300};
async function token(overrides={},key=keys.privateKey){return new SignJWT({...claims,...overrides}).setProtectedHeader({alg:'RS256'}).sign(key);}
test('verified school ID token accepts stable Google subject and checks access-token binding',async()=>{
 const access_token='secret';const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(access_token)));const at_hash=Buffer.from(bytes.slice(0,16)).toString('base64url');
 assert.deepEqual(await verifyGoogleIdentity({id_token:await token({at_hash}),access_token,token_type:'Bearer'},'client','expected',keys.publicKey),{sub:claims.sub,email:claims.email});
});
test('signature, issuer, audience, verified email, school domain, expiry, nonce and token hash fail closed',async t=>{
 for(const overrides of [{iss:'https://evil.example'},{aud:'other'},{email_verified:false},{hd:'gmail.com'},{email:'teacher@gmail.com'},{exp:1},{nonce:'wrong'},{sub:''},{azp:'other'},{at_hash:'wrong'}])await t.test(Object.keys(overrides)[0],async()=>assert.rejects(verifyGoogleIdentity({id_token:await token(overrides),access_token:'secret',token_type:'Bearer'},'client','expected',keys.publicKey),e=>e.status===401&&!e.message.includes('secret')));
 const other=await generateKeyPair('RS256');await assert.rejects(verifyGoogleIdentity({id_token:await token({},other.privateKey),access_token:'secret',token_type:'Bearer'},'client','expected',keys.publicKey),e=>e.status===401);
 for(const tokens of [{},{id_token:await token(),access_token:'secret',token_type:'Other'}])await assert.rejects(verifyGoogleIdentity(tokens,'client','expected',keys.publicKey),e=>e.status===401);
});
