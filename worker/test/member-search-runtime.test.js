import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('People search runs on workerd, rejects redirects and separates Google failures',async t=>{
 const {outputFiles}=await build({stdin:{contents:`import {searchSchoolPeople} from './src/member-search.js';
 export default {async fetch(){try{return Response.json(await searchSchoolPeople('fixture',{searchSource:'directory',accessToken:'fixture-token'}));}catch(e){return Response.json({code:e.code,message:e.message,googleStatus:e.googleStatus,googleCode:e.googleCode},{status:e.status||500});}}};`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,format:'esm',platform:'browser',write:false});
 let status=200,calls=0;
 const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-08-01',script:outputFiles[0].text,outboundService:async request=>{
  calls++;assert.equal(new URL(request.url).origin,'https://people.googleapis.com');
  if(status===200)return Response.json({people:[{names:[{displayName:'20624 Fixture'}],emailAddresses:[{value:'fixture@joongdong.hs.kr'}]}]});
  if(status===302)return new Response(null,{status,headers:{Location:'https://untrusted.invalid/never-follow'}});
  return Response.json({error:{code:status,status:status===403?'PERMISSION_DENIED':'UNAVAILABLE',message:'DO_NOT_EXPOSE_PRIVATE_PROVIDER_MESSAGE',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'SERVICE_DISABLED',metadata:{service:'people.googleapis.com',consumer:'DO_NOT_EXPOSE_PRIVATE_PROVIDER_MESSAGE'}}]}},{status});
 }}));t.after(()=>runtime.dispose());
 const send=()=>runtime.dispatchFetch('https://fixture.invalid/');
 const result=await send();assert.equal(result.status,200,await result.clone().text());assert.equal((await result.json()).people.length,1);
 for(const code of [302,403,500]){status=code;const response=await send();assert.equal(response.status,code===403?403:502);const data=await response.json();assert.equal(data.googleStatus,code);assert(!JSON.stringify(data).includes('DO_NOT_EXPOSE_PRIVATE_PROVIDER_MESSAGE'));if(code===403){assert(data.message.includes('SERVICE_DISABLED'));assert(data.message.includes('directory scope: 교환 시 확인됨'));}}
 assert.equal(calls,4);
});
