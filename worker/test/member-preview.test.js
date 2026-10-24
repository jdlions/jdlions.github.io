import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/index.js';

test('preview writes and unrelated features fail before accessing any database',async()=>{
 const env={PREVIEW_MODE:'member-search',DB:{prepare(){throw Error('must not access DB');}}};
 for(const [method,path] of [['POST','/api/admin/members'],['PATCH','/api/admin/members/id'],['POST','/api/assignments'],['POST','/api/editorial-files/projects'],['GET','/api/photos'],['GET','/api/public/issues']]){
  const r=await worker.fetch(new Request('https://test.invalid'+path,{method}),env);
  assert.equal(r.status,403);assert.equal((await r.json()).error.code,'preview_read_only');assert.match(r.headers.get('cache-control'),/no-store/);
 }
 const session=await worker.fetch(new Request('https://test.invalid/api/session'),env);
 assert.equal(session.status,200);assert.equal((await session.json()).authenticated,false);
});

test('fixed preview and production hosts cannot route to each other; temporary previews fail closed',()=>{
 const config=JSON.parse(readFileSync(new URL('../../pridedesk/vercel.json',import.meta.url)));
 const stable='pridedesk-git-feature-member-academic-year-the-lion-s-pride.vercel.app';
 const target=(host,path)=>config.rewrites.find(r=>r.has.every(h=>h.type==='host'&&h.value===host)&&path.startsWith(r.source.split(':')[0]))?.destination;
 for(const path of ['/api/session','/auth/callback']){
  assert(target('pridesk.vercel.app',path).includes('lions-pride-editorial-api.editor-936'));
  assert(target(stable,path).includes('lions-pride-editorial-api-preview.editor-936'));
  assert.equal(target('pridedesk-random-the-lion-s-pride.vercel.app',path),undefined);
  assert.equal(target('attacker.invalid',path),undefined);
 }
 const toml=readFileSync(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
 assert.match(toml,/name = "lions-pride-editorial-api-preview"/);
 assert.match(toml,/database_name = "editorial-member-search-preview"/);
 assert.doesNotMatch(toml,/ad7878f5-4347-441d-835e-37254299dfda|DRIVE_UPLOAD_FOLDER_ID|SLACK_/);
 assert.match(toml,/PREVIEW_ADMIN_EMAIL = "editor@joongdong.hs.kr"/);
});
