import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createImportManager} from '../server/imports.js';
test('import retries retain library and tags, expose title and reject active/completed repeats',async()=>{
  const dir=await mkdtemp(resolve('artifacts/import-retry-'));let tries=0,saved;
  const manager=createImportManager({dataDir:dir,downloader:async({progress})=>{tries++;progress('下载中');if(tries===1)throw Object.assign(Error('临时失败'),{status:422});return{title:'测试作品',description:'作品简介',author:'测试作者'};},save:async(file,input)=>{saved=input;return{id:'saved'}}});
  try{
    const first=manager.add({url:'https://www.bilibili.com/video/BV1xx411c7mD',collection_id:'library-a',tags:['个人标签']});assert.equal(first.collection_id,'library-a');assert.throws(()=>manager.retry(first.id),/失败或取消/);
    for(let i=0;i<50&&manager.get(first.id).status!=='failed';i++)await new Promise(r=>setTimeout(r,10));assert.equal(manager.get(first.id).status,'failed');
    const retried=manager.retry(first.id);assert.notEqual(retried.id,first.id);
    assert.equal(manager.retry(first.id).id,retried.id,'repeated retry submission never creates another job');
    for(let i=0;i<50&&manager.get(retried.id).status!=='completed';i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(manager.get(retried.id).status,'completed');assert.equal(manager.get(retried.id).title,'测试作品');assert.equal(saved.collection_id,'library-a');assert.ok(saved.tags.includes('个人标签'));assert.throws(()=>manager.retry(retried.id),/失败或取消/);
    assert.equal(manager.retry(first.id).id,retried.id,'lost retry response can be read back after completion');
  }finally{await manager.stop();}
});
