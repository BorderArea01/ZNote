import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCaptureManager} from '../server/captures.js';
import {extractBrowserXPost,extractXPost} from '../server/capture-x.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source='https://x.com/Tir_al_/status/2107765375521939865';
const browserPost={id:'2107765375521939865',text:'作品正文 #画画',author:{name:'作者',screen_name:'Tir_al_'},images:[1,2,3,4].map(i=>`https://pbs.twimg.com/media/image${i}?format=jpg&name=small`),video:false};
test('X playback records bind variants to the owning post, prefer high bitrate MP4 and exclude HLS/init/cross-host URLs',async()=>{
  const context={URL};vm.createContext(context);vm.runInContext(await readFile('addons/browser/clipper/x-video-records.js','utf8'),context);
  const variants=[{bitrate:1,url:'https://video.twimg.com/ext_tw_video/1/low.mp4'},{bitrate:100,url:'https://video.twimg.com/ext_tw_video/1/high.mp4'},{bitrate:200,url:'https://video.twimg.com/ext_tw_video/1/master.m3u8'},{url:'https://video.twimg.com/ext_tw_video/1/seg-init.mp4'},{url:'https://evil.test/a.mp4'}];
  const rows=context.ZNoteXVideoRecords({tweet:{rest_id:browserPost.id,legacy:{extended_entities:{media:[{type:'video',video_info:{variants}}]}},quoted_status_result:{result:{rest_id:'123',legacy:{extended_entities:{media:[{type:'video',video_info:{variants:[{url:'https://video.twimg.com/quote.mp4'}]}}]}}}}}});
  assert.equal(rows.length,2);const own=rows.find(row=>row.id===browserPost.id);assert.equal(own.video_urls.length,2);assert.match(own.video_urls[0],/high.mp4$/);assert.ok(!own.video_urls.includes('https://video.twimg.com/quote.mp4'));
  const raw={...browserPost,images:[],video:true,video_urls:Array.from(own.video_urls)};
  const plan=extractBrowserXPost(raw,source);assert.equal(plan.kind,'video');assert.deepEqual(plan.video_urls,raw.video_urls);
  assert.throws(()=>extractBrowserXPost({...raw,video_urls:[]},source),/播放地址/);
  assert.throws(()=>extractBrowserXPost({...raw,video_urls:['https://localhost/a.mp4']},source),/无效.*视频/);
  const api=extractXPost({id_str:browserPost.id,text:'视频正文',video:{variants}},source);assert.equal(api.kind,'video');assert.match(api.video_urls[0],/high.mp4$/);
});
test('browser X data binds post identity and permits only own X media, with ordered originals and tags',()=>{
  const plan=extractBrowserXPost(browserPost,source);
  assert.equal(plan.images.length,4);assert.match(plan.images[0],/name=orig/);assert.deepEqual(plan.tags,['画画']);assert.equal(plan.author,'作者 @Tir_al_');
  for(const [raw,url] of [[{...browserPost,id:'123'},source],[browserPost,'https://evil.test/user/status/2107765375521939865'],[{...browserPost,images:['http://127.0.0.1/1.jpg']},source],[{...browserPost,images:['https://pbs.twimg.com/profile_images/avatar.jpg']},source],[{...browserPost,text:'x'.repeat(100001)},source],[{...browserPost,images:[...browserPost.images,browserPost.images[0]]},source]])assert.throws(()=>extractBrowserXPost(raw,url));
});
test('fresh browser data rescues a failed embed task, preserves grouping and dedupe; readonly resolution never writes',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  const saved=new Map();let embeds=0;
  const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>{embeds++;throw Object.assign(Error('公开接口空数据'),{status:422});},image:async()=>Buffer.from('image'),saveImage:async(_buffer,item)=>{saved.set(item.id,item);return item;},saveNote:()=>assert.fail('unexpected note')});
  try{
    const raw={text:source,collection_id:'target',request_id:'rescue-x',image_mode:'group'};
    const failed=manager.add(raw);await assert.rejects(manager.wait(failed.id,AbortSignal.timeout(5000)),/公开接口空数据/);
    const rescue=manager.add({...raw,browser_post:browserPost});assert.equal(rescue.id,failed.id);
    await manager.wait(rescue.id,AbortSignal.timeout(5000));assert.equal(saved.size,4);assert.equal(embeds,1);
    assert.equal(new Set([...saved.values()].map(v=>v.group_key)).size,1);
    assert.ok([...saved.values()].every(v=>v.content===browserPost.text&&v.source_url===source&&v.collection_id==='target'));
    manager.add({...raw,browser_post:browserPost});assert.equal(saved.size,4);
    const history=db.prepare('SELECT value FROM settings').get().value;
    const plan=await manager.resolve({text:source,browser_post:browserPost});assert.equal(plan.images.length,4);assert.equal(db.prepare('SELECT value FROM settings').get().value,history);
    await assert.rejects(manager.resolve({text:source,browser_post:browserPost,browser_html:'x'}),/一种/);
    assert.throws(()=>manager.add({...raw,request_id:'bad-x',browser_post:{...browserPost,id:'12'}}),/不匹配/);
  }finally{await manager.stop();db.close();}
});
