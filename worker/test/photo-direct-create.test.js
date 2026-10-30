import test from 'node:test';import assert from 'node:assert/strict';import {uploadToDrive} from '../src/google.js';
test('drive.file upload creates directly in the configured parent without requiring folder read access',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;assert.match(String(url),/^https:\/\/www.googleapis.com\/upload\/drive\/v3\/files\?/);assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer fixture-token');assert.match(await init.body.text(),/"parents":\["fixture-folder"\]/);return Response.json({id:'fixture-file',name:'test.png',mimeType:'image/png',size:'4'});});
 const result=await uploadToDrive(new File(['test'],'test.png',{type:'image/png'}),'fixture-folder','fixture-token');assert.equal(calls,1);assert.equal(result.id,'fixture-file');
});
test('missing folder and denied create never become successful uploads',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{errors:[{reason:'notFound'}],message:'PRIVATE'}},{status:404});});
 const file=new File(['test'],'test.png',{type:'image/png'});
 await assert.rejects(uploadToDrive(file,'','fixture-token'),e=>e.code==='drive_folder_unconfigured');assert.equal(calls,0);
 await assert.rejects(uploadToDrive(file,'fixture-folder','fixture-token'),e=>e.upstreamStatus===404&&e.reason==='notFound'&&!e.message.includes('PRIVATE'));assert.equal(calls,1);
});
