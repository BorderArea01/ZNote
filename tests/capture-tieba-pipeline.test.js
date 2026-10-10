import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCaptureManager} from '../server/captures.js';
import {extractTiebaPages} from '../server/capture-tieba.js';

const source = 'https://tieba.baidu.com/p/11090769629';
const makePlan = count => extractTiebaPages([{error_code:0, thread:{id:11090769629, title:'楼主图组', author:{id:6003105935, name_show:'作者'}}, forum:{name:'测试吧'}, page:{current_page:1,total_page:1}, post_list:[{id:'100', floor:1, author_id:6003105935, content:[{type:0,text:'需要保留的正文'}, ...Array.from({length:count}, (_,i) => ({type:3,origin_src:`https://tiebapic.baidu.com/forum/pic/item/${i}.jpg?tbpicau=signed`}))]}]}],source);

for (const count of [0,1,3]) test(`Tieba default pipeline stores ${count} images with correct card grouping and remarks`, async () => {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  const plan = makePlan(count), saved = new Map(); let notes = 0;
  const manager = createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>({plan}),image:async()=>Buffer.from('image'),saveImage:async(buffer,item)=>{saved.set(item.id,item);return item;},saveNote:async item=>{notes++;saved.set(item.id,item);return item;}});
  try {
    const job = manager.add({text:source,collection_id:'chosen-library'}), done = await manager.wait(job.id,AbortSignal.timeout(3000));
    assert.equal(done.status,'completed'); assert.equal(saved.size,count || 1); assert.equal(notes,count ? 0 : 1);
    if(count){
      const rows = [...saved.values()];
      assert.ok(rows.every(item=>item.collection_id==='chosen-library' && item.source_url===source && item.content===plan.content));
      assert.deepEqual(rows.map(item=>item.group_index),Array.from({length:count},(_,i)=>i));
      assert.equal(new Set(rows.map(item=>item.group_key)).size,1); assert.equal(Boolean(rows[0].group_key),count>1);
    }
  } finally {await manager.stop();db.close();}
});

test('Tieba picture failure continues other pictures and retry skips saved members',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  const plan=makePlan(3),saved=new Map(),calls=[];let failing=true;
  const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>({plan}),image:async url=>{calls.push(url);if(failing&&url===plan.images[1])throw Error('图片暂时不可读');return Buffer.from('image');},saveImage:async(buffer,item)=>{saved.set(item.id,item);return item;},saveNote:()=>{throw Error('Must not create an extra note');}});
  try{
    const job=manager.add({text:source});await assert.rejects(manager.wait(job.id,AbortSignal.timeout(3000)),/其他图片已继续处理/);
    assert.equal(saved.size,2);failing=false;manager.retry(job.id);await manager.wait(job.id,AbortSignal.timeout(3000));
    assert.equal(saved.size,3);assert.deepEqual(calls,[...plan.images,plan.images[1]]);
    assert.deepEqual([...saved.values()].map(item=>item.group_index).sort(),[0,1,2]);
  }finally{await manager.stop();db.close();}
});
