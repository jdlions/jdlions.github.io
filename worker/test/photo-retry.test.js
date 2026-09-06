import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductionEditorialService} from '../../assets/js/services/production-editorial-service.js';
test('partial photo retry skips confirmed files, preserves gallery and releases lock',async()=>{
  const calls=[];let fail=true;
  const service=ProductionEditorialService.empty({role:'student'},async(path,init)=>{
    const name=init.body.get('file').name;calls.push(name);
    if(name==='second.png'&&fail)throw new Error('Network failure');
    return {id:name,filename:name};
  });
  const files=[new File(['a'],'first.png'),new File(['b'],'second.png')];
  await assert.rejects(service.submitPhotos({articleSubmissionId:'a1'},files));
  assert.equal(service.listPhotos().length,1);fail=false;
  await service.submitPhotos({articleSubmissionId:'a1'},files);
  assert.deepEqual(calls,['first.png','second.png','second.png']);
  assert.equal(service.listPhotos().length,2);
});
test('service rejects simultaneous uploads before a second request starts',async()=>{
  let release,calls=0;
  const service=ProductionEditorialService.empty({role:'student'},async()=>{calls++;await new Promise(r=>release=r);return {id:'p1'};});
  const files=[new File(['a'],'first.png')],pending=service.submitPhotos({},files);
  await assert.rejects(service.submitPhotos({},files),/already in progress/);
  assert.equal(calls,1);release();await pending;
  assert.equal(service.photoUploadPending,false);
});
