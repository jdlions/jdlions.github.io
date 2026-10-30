import test from'node:test';import assert from'node:assert/strict';import{fileURLToPath}from'node:url';import{build}from'esbuild';import{Miniflare,convertV4MiniflareOptions}from'miniflare';
test('diagnostics reaches Google from real workerd and never follows redirects',async t=>{
 const{outputFiles}=await build({stdin:{contents:`import{photoUploadDiagnostics}from'./src/photo-upload-diagnostics.js';export default{async fetch(){return Response.json(await photoUploadDiagnostics('fixed-folder','fixture-token','fixture-client'));}};`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,format:'esm',platform:'browser',write:false});
 const calls=[];let redirect=false;
 const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-08-01',script:outputFiles[0].text,outboundService:async request=>{
 calls.push({url:request.url,method:request.method});assert.equal(request.headers.get('Authorization'),'Bearer fixture-token');assert(!request.url.includes('fixture-token'));
 if(redirect)return new Response(null,{status:302,headers:{Location:'https://untrusted.example/never-follow'}});
 if(request.url==='https://oauth2.googleapis.com/tokeninfo'){assert.equal(request.method,'POST');return Response.json({aud:'fixture-client',scope:'https://www.googleapis.com/auth/drive.file'});}
 assert(request.url.startsWith('https://www.googleapis.com/drive/v3/files/fixed-folder?'));return Response.json({mimeType:'application/vnd.google-apps.folder',isAppAuthorized:true,capabilities:{canAddChildren:true}});
 }}));t.after(()=>runtime.dispose());
 const response=await runtime.dispatchFetch('https://local.test/'),d=await response.json();assert.equal(calls.length,2,JSON.stringify(d));assert.equal(d.token.httpStatus,200);assert.equal(d.folder.httpStatus,200);assert.equal(d.folder.canAddChildren,true);
 redirect=true;const redir=await(await runtime.dispatchFetch('https://local.test/')).json();assert.equal(redir.token.httpStatus,302);assert.equal(redir.folder.httpStatus,302);assert.equal(calls.length,4);assert(calls.every(c=>!c.url.includes('untrusted.example')));
});
