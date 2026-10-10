import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishRename} from '../server/atomic-files.js';
const fail=code=>Object.assign(new Error(code),{code});
test('Windows publication waits for transient handle errors, preserving the same atomic rename',async()=>{
  let attempts=0;const waited=[];
  await publishRename('own.tmp','own.snapshot',{platform:'win32',move:async(from,to)=>{assert.equal(from,'own.tmp');assert.equal(to,'own.snapshot');if(attempts++<3)throw fail(['EPERM','EBUSY','EACCES'][attempts-1])},inspect:async()=>{throw fail('ENOENT')},wait:async ms=>waited.push(ms)});
  assert.equal(attempts,4);assert.deepEqual(waited,[20,40,80]);
});
test('permanent denial is bounded; existing snapshot, missing source and cross-device/non-Windows failures are never bypassed',async()=>{
  let attempts=0,delay=0;const denied=fail('EPERM');
  await assert.rejects(publishRename('own.tmp','own.snapshot',{platform:'win32',move:async()=>{attempts++;throw denied},inspect:async()=>{throw fail('ENOENT')},wait:async ms=>{delay+=ms}}),error=>error===denied);assert.equal(attempts,11);assert.ok(delay<5000);
  for(const options of [{platform:'linux',code:'EPERM'},{platform:'win32',code:'ENOENT'},{platform:'win32',code:'EXDEV'},{platform:'win32',code:'EPERM',exists:true}]) {
    let count=0;const error=fail(options.code);await assert.rejects(publishRename('own.tmp','target',{platform:options.platform,move:async()=>{count++;throw error},inspect:async()=>{if(!options.exists)throw fail('ENOENT')},wait:async()=>{throw Error('Must not wait')}}),value=>value===error);assert.equal(count,1);
  }
});
test('only an explicitly owned policy file can use replacement retries',async()=>{
  let attempts=0;
  await publishRename('policy.tmp','policy.json',{replace:true,platform:'win32',move:async()=>{if(attempts++===0)throw fail('EPERM')},inspect:async()=>{throw Error('Replacement target should not be probed')},wait:async()=>{}});assert.equal(attempts,2);
});
