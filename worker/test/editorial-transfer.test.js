import test from 'node:test';
import assert from 'node:assert/strict';
import {fileFingerprint,retryTransfer,uploadEditorialFile} from '../../assets/js/shared/editorial-transfer.js';
import {editorialFilename,MAX_EDITORIAL_BYTES,EDITORIAL_CHUNK_BYTES} from '../../assets/js/shared/editorial-file-policy.js';

test('general filenames are preserved; traversal, devices, bidi and header controls are rejected',()=>{
 for(const name of ['패키지.zip','신문.INDD','x.idml','image.png','README','.gitignore','long file.name.psd','archive.tar.gz'])assert.equal(editorialFilename(name),name);
 for(const name of ['',null,'..','x/../test.zip','C:\\x.zip','x\r\n.zip','NUL.zip','con','COM1.txt','x\u202ezip','x\ud800','x.zip.','x.zip '])assert.throws(()=>editorialFilename(name));
});

test('fingerprint reads only canonical chunks, reports preparation and supports interruption',async()=>{
 const controller=new AbortController(),size=EDITORIAL_CHUNK_BYTES+17,reads=[];
 const file={size,slice(start,end){reads.push([start,end]);return new Blob([new Uint8Array(Math.min(size,end)-start)]);},arrayBuffer(){assert.fail('whole-file read');}};
 const progress=[];const hash=await fileFingerprint(file,{onProgress:(offset,total)=>progress.push([offset,total])});assert.match(hash,/^[a-f0-9]{64}$/);assert.equal(reads.length,2);assert.deepEqual(progress.at(-1),[size,size]);
 await assert.rejects(fileFingerprint(file,{signal:controller.signal,onProgress:()=>controller.abort(new DOMException('paused','AbortError'))}),{name:'AbortError'});
});

test('retries are bounded, only transient failures retry, and cancellation interrupts backoff',async()=>{
 let calls=0;const retries=[];
 await assert.rejects(retryTransfer(async()=>{calls++;throw {status:503};},{onRetry:n=>retries.push(n),delay:async()=>{}}));assert.equal(calls,3);assert.deepEqual(retries,[1,2]);
 for(const status of [400,401,403,409,413]){calls=0;await assert.rejects(retryTransfer(async()=>{calls++;throw {status};}));assert.equal(calls,1);}
 const controller=new AbortController();await assert.rejects(retryTransfer(async()=>{throw {status:502};},{signal:controller.signal,onRetry:()=>controller.abort(new DOMException('pause','AbortError'))}),{name:'AbortError'});
});

test('resuming after a partially acknowledged chunk resends canonical bytes and publishes only after verification',async()=>{
 const file=new File([new Uint8Array([1,2,3,4])],'package.zip'),calls=[],progress=[];let sends=0;
 const saved={version:2,original_filename:file.name};
 const request=async(path,init)=>{calls.push({path,init});if(path.endsWith('/upload'))return {id:'id',done:false,chunkBytes:EDITORIAL_CHUNK_BYTES};if(path.endsWith('/status'))return {offset:2,done:false};if(path.endsWith('/finish'))return saved;assert.fail(path);};
 const send=async(url,init)=>{sends++;assert.equal(init.headers['X-Upload-Offset'],'0');assert.equal(init.credentials,'include');assert.equal(init.headers['X-Editorial-CSRF'],'1');assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()),new Uint8Array([1,2,3,4]));return Response.json({offset:4,done:true});};
 assert.equal(await uploadEditorialFile({project:'p',lockId:'lock',file,changeNote:'note',request,send,onProgress:p=>progress.push(p)}),saved);assert.equal(sends,1);assert.deepEqual(progress.map(x=>x.phase),['hash','upload','upload','verify']);assert(calls.at(-1).path.endsWith('/finish'));const input=JSON.parse(calls[0].init.body);assert.equal(input.originalFilename,'package.zip');assert.equal(input.lockId,'lock');assert.match(input.contentHash,/^[a-f0-9]{64}$/);
});

test('invalid files and invalid acknowledgement never reach finalize',async()=>{
 let requests=0;const request=async path=>{requests++;if(path.endsWith('/upload'))return {id:'id',done:false,chunkBytes:EDITORIAL_CHUNK_BYTES};if(path.endsWith('/status'))return {offset:-1,done:false};assert.fail('unexpected finalize');};
 for(const file of [new File([],'empty.zip'),{name:'huge.zip',size:MAX_EDITORIAL_BYTES+1},{name:'../x.zip',size:1}])await assert.rejects(uploadEditorialFile({project:'p',file,request}));assert.equal(requests,0);
 await assert.rejects(uploadEditorialFile({project:'p',file:new File(['x'],'package.zip'),request}),/위치/);assert.equal(requests,2);
});
