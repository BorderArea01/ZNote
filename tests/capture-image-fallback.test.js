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
