import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
test('Google JWT verification runs in actual Workers runtime with bounded remote keys and no redirects',async t=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const jwk={...await exportJWK(publicKey),kid:'runtime-key',alg:'RS256'};
 const token=await new SignJWT({email:'editor@joongdong.hs.kr',email_verified:true,hd:'joongdong.hs.kr',nonce:'runtime-nonce'}).setSubject('123').setIssuer('https://accounts.google.com').setAudience('runtime-client').setIssuedAt().setExpirationTime('5m').setProtectedHeader({alg:'RS256',kid:'runtime-key'}).sign(privateKey);
 const {outputFiles}=await build({stdin:{contents:`import {verifyGoogleIdentity} from './src/google-identity.js';export default {async fetch(request){try{return Response.json(await verifyGoogleIdentity(await request.json(),'runtime-client','runtime-nonce'));}catch(e){return Response.json({code:e.code},{status:e.status||500});}}};`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,format:'esm',platform:'browser',write:false});
 let calls=0;const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-08-01',script:outputFiles[0].text,outboundService:async request=>{calls++;assert.equal(request.url,'https://www.googleapis.com/oauth2/v3/certs');return Response.json({keys:[jwk]});}}));t.after(()=>runtime.dispose());
 const response=await runtime.dispatchFetch('https://local.test/',{method:'POST',body:JSON.stringify({id_token:token,access_token:'fixture',token_type:'Bearer'})});
 assert.equal(response.status,200,await response.clone().text());assert.deepEqual(await response.json(),{sub:'123',email:'editor@joongdong.hs.kr',name:''});assert.equal(calls,1);
});
