import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCaptureManager} from '../server/captures.js';

test('original failure falls back per picture, preserves grouping/provenance and reports fallback',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  const display='https://sns-webpic-qc.xhscdn.com/day/sign/token!mark';
  const html='<script>window.__INITIAL_STATE__='+JSON.stringify({note:{noteId:'abcd',desc:'first\nsecond',title:'作品',user:{nickname:'作者'},imageList:[{urlDefault:display},{urlOriginal:'https://cdn.example/original-2',urlDefault:'https://cdn.example/thumb-2'}]}})+'</script>';
  const saved=new Map(),calls=[];
  const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>({url:'https://www.xiaohongshu.com/explore/abcd',type:'text/html',buffer:Buffer.from(html)}),image:async url=>{calls.push(url);if(url.includes('sns-img-bd'))throw Error('expired');return Buffer.from('fixture');},saveImage:async(buffer,item)=>{saved.set(item.id,item);return item;},saveNote:item=>{saved.set(item.id,item);return item;}});
  try{
    const job=manager.add({text:'https://xhslink.com/fixture',collection_id:'library'});const result=await manager.wait(job.id,AbortSignal.timeout(5000));
    assert.deepEqual(calls,['https://sns-img-bd.xhscdn.com/token',display,'https://cdn.example/original-2']);assert.match(result.message,/备用版本/);
    const note=saved.get(result.item_id),images=[...saved.values()].filter(v=>v.group_key);assert.equal(images.length,2);assert.ok(images.every(v=>v.group_key==='note:'+note.id&&v.source_url===note.source_url&&v.tags.includes('作者')));assert.match(note.content,/first\nsecond/);assert.equal((note.content.match(/\/media\//g)||[]).length,2);assert.ok(!note.content.includes('https://cdn'));
  }finally{await manager.stop();db.close();}
});

for(const count of [1,2])test(`mobile album mode stores ${count} images without an extra note cover`,async()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  const html='<script>window.__INITIAL_STATE__='+JSON.stringify({note:{noteId:'abcd',desc:'第一行\n第二行',title:'作品',user:{nickname:'作者'},imageList:Array.from({length:count},(_,i)=>({urlOriginal:`https://cdn.example/${i}`}))}})+'</script>';
  const saved=new Map();let attempts=0,failSecond=count>1;
  const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>({url:'https://www.xiaohongshu.com/explore/abcd',type:'text/html',buffer:Buffer.from(html)}),image:async url=>{attempts++;if(url.endsWith('/1')&&failSecond){failSecond=false;throw Error('temporary disconnect');}return Buffer.from('fixture');},saveImage:async(buffer,item)=>{assert.ok(!saved.has(item.id));saved.set(item.id,item);return item;},saveNote:()=>{throw Error('Album must not create a duplicate note card');}});
  try{
    const input={text:'https://xhslink.com/fixture',collection_id:'library',image_mode:'group',request_id:'album-request-'+count};
    const job=manager.add(input);
    if(count>1){await assert.rejects(manager.wait(job.id,AbortSignal.timeout(5000)));manager.retry(job.id);}
    const result=await manager.wait(job.id,AbortSignal.timeout(5000));
    assert.equal(saved.size,count);assert.equal(attempts,count+(count>1?1:0));assert.equal(saved.get(result.item_id).group_index,0);
    const items=[...saved.values()];assert.ok(items.every(i=>i.collection_id==='library'&&i.tags.includes('作者')&&i.source_url==='https://www.xiaohongshu.com/explore/abcd'&&i.content==='第一行\n第二行'));
    if(count===1)assert.equal(items[0].group_key,null);else assert.ok(items.every(i=>i.group_key===items[0].group_key&&i.group_key.startsWith('capture:')));
    assert.equal(manager.add(input).id,job.id);assert.throws(()=>manager.add({...input,image_mode:'note'}),/其他内容/);
  }finally{await manager.stop();db.close();}
});
