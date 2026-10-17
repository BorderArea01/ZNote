import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createCaptureManager} from '../server/captures.js';
const source='https://x.com/artist/status/123';
const stableId=value=>{const h=createHash('sha256').update(value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const deadline=()=>AbortSignal.timeout(3000);
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
 const saved=new Map();let plan={url:source,kind:'note',title:'Test',content:'正文',images:[]},reads=0;
 return {db,saved,setPlan:p=>{plan=p;},reads:()=>reads,make:()=>createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>{reads++;return {plan};},image:async()=>Buffer.from('image'),saveImage:async(_buffer,item)=>{saved.set(item.id,{...item,kind:'image'});return item;},saveNote:async item=>{saved.set(item.id,{...item,kind:'note'});return item;}})};
}
test('empty group fails without writing a note; retry rereads the page and saves all members',async()=>{
 const f=fixture(),m=f.make();try{
  const job=m.add({text:source,image_mode:'group'});
  await assert.rejects(m.wait(job.id,deadline()),/未获取到.*图片或视频/);assert.equal(f.saved.size,0);
  f.setPlan({url:source,kind:'note',content:'正文',images:['https://pbs.twimg.com/media/one.jpg','https://pbs.twimg.com/media/two.jpg']});
  m.retry(job.id);const done=await m.wait(job.id,deadline());assert.match(done.message,/图片组已入库/);assert.equal(f.saved.size,2);assert.equal(f.reads(),2);
  assert.throws(()=>m.retry(job.id),/只有失败/);
 }finally{await m.stop();f.db.close();}
});
test('text notes explicitly report no pictures instead of claiming images saved',async()=>{
 const f=fixture(),m=f.make();try{const job=m.add({text:source,image_mode:'note'});const done=await m.wait(job.id,deadline());assert.equal(done.message,'文字笔记已入库（无配图）');assert.equal(f.saved.size,1);assert.equal(f.saved.get(done.item_id).kind,'note');}finally{await m.stop();f.db.close();}
});
test('legacy false success becomes retryable; preserves edited note and dedupes a repaired group after restart',async()=>{
 const f=fixture(),jobId='legacy-job',noteId=stableId('capture:'+jobId),original={id:noteId,kind:'note',collection_id:'library',content:'用户补充的备注',favorite:1,version:4};
 f.saved.set(noteId,original);f.db.prepare('INSERT INTO settings VALUES(?,?)').run('mobile_captures_v1',JSON.stringify([{id:jobId,item_id:noteId,input:{text:source,image_mode:'group',collection_id:'library',tags:[]},source_url:source,status:'completed',message:'图文已入库，配图已保存到本地'}]));
 let m=f.make();try{
  assert.equal(m.get(jobId).status,'failed');assert.match(m.get(jobId).message,/图片未保存/);
  m.retry(jobId);await assert.rejects(m.wait(jobId,deadline()),/未获取到/);assert.deepEqual(f.saved.get(noteId),original);
  f.setPlan({url:source,kind:'note',content:'原帖正文',images:['https://pbs.twimg.com/media/one.jpg','https://pbs.twimg.com/media/two.jpg']});
  m.retry(jobId);const done=await m.wait(jobId,deadline());assert.equal(f.saved.size,3);assert.notEqual(done.item_id,noteId);assert.deepEqual(f.saved.get(noteId),original);
  await m.stop();m=f.make();assert.equal(m.get(jobId).status,'completed');assert.throws(()=>m.retry(jobId),/只有失败/);assert.equal(f.saved.size,3);
 }finally{await m.stop();f.db.close();}
});
test('legacy deleted or moved notes block repair rather than recreating content in another scope',async()=>{
 for(const changed of [{collection_id:'other'},{deleted_at:'2026-10-17'}]){
  const f=fixture(),jobId='scope-job',noteId=stableId('capture:'+jobId);f.saved.set(noteId,{id:noteId,kind:'note',collection_id:'library',content:'正文',...changed});
  f.db.prepare('INSERT INTO settings VALUES(?,?)').run('mobile_captures_v1',JSON.stringify([{id:jobId,item_id:noteId,input:{text:source,image_mode:'group',collection_id:'library',tags:[]},source_url:source,status:'completed'}]));
  const m=f.make();try{m.retry(jobId);await assert.rejects(m.wait(jobId,deadline()),/已删除或移动/);assert.equal(f.saved.size,1);}finally{await m.stop();f.db.close();}
 }
});
