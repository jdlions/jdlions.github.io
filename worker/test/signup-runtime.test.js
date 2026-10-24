import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('salted signup-code PBKDF2 runs on real workerd with the configured iteration count',async t=>{
 const {outputFiles}=await build({stdin:{contents:`import {hashSignupCode} from './src/signup.js';export default {async fetch(){return Response.json({hash:await hashSignupCode('isolated-fixture-code','01'.repeat(16))});}};`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,format:'esm',platform:'browser',write:false});
 const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-08-01',script:outputFiles[0].text}));t.after(()=>runtime.dispose());
 const response=await runtime.dispatchFetch('https://fixture.invalid/');assert.equal(response.status,200,await response.clone().text());
 assert.equal((await response.json()).hash,pbkdf2Sync('isolated-fixture-code',Buffer.alloc(16,1),100000,32,'sha256').toString('hex'));
});
