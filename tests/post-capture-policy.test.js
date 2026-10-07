import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createCaptureManager } from '../server/captures.js';
import { createApp } from '../server/app.js';
import { xPost, xImage, extractXPost } from '../server/capture-x.js';

const source = 'https://x.com/artist/status/2107462064294051944';
const tweet = { id_str:'2107462064294051944', text:'第一行\n第二行 #作品 https://t.co/media', user:{name:'作者',screen_name:'artist'}, entities:{media:[{url:'https://t.co/media'}],hashtags:[{text:'作品'}]}, mediaDetails:[1,2,3,4].map(i=>({type:'photo',media_url_https:`https://pbs.twimg.com/media/image${i}.jpg`})) };
test('X post identity, original order, body, author, photo-only extraction and missing data', () => {
  const plan=extractXPost({...tweet,quoted_tweet:{photos:[{url:'https://pbs.twimg.com/media/quote.jpg'}]}},source);
  assert.equal(plan.images.length,4); assert.match(plan.images[0],/image1\?format=jpg&name=orig$/);
  assert.equal(plan.content,'第一行\n第二行 #作品'); assert.equal(plan.author,'作者 @artist'); assert.deepEqual(plan.tags,['作品']);
  assert.deepEqual(xPost(source+'/photo/2'),xPost(source));
  assert.equal(xPost(source.replace('x.com','x.com.evil.test')),null);
  assert.equal(xImage('https://pbs.twimg.com/profile_images/avatar.jpg'),'');
  assert.throws(()=>extractXPost({},source),/完整数据/);
  assert.equal(extractXPost({...tweet,mediaDetails:[{type:'video',media_url_https:'https://pbs.twimg.com/media/cover.jpg'}]},source).kind,'video');
});

for (const count of [1,4]) test(`X and XHS default to ${count===1?'a single image':'one group'}, retain remarks, skip failures and resume`, async () => {
  for (const platform of ['x','xhs']) {
    const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
    const plan={...extractXPost({...tweet,mediaDetails:tweet.mediaDetails.slice(0,count)},source),url:platform==='x'?source:'https://www.xiaohongshu.com/explore/abcd'};
    const saved=new Map(), attempts=[]; let fail=count>1;
    const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>({plan}),image:async url=>{attempts.push(url);return Buffer.from('image');},saveImage:async(buffer,item)=>{if(fail&&item.group_index===0)throw Object.assign(Error('单张图片不能超过 100 MB'),{status:413});saved.set(item.id,item);return item;},saveNote:()=>{throw Error('Unexpected note card');}});
    try {
      const raw={text:plan.url,collection_id:'target',request_id:'test-default'};
      const job=manager.add(raw);assert.equal(manager.add(raw).id,job.id);
      if(fail){await assert.rejects(manager.wait(job.id,AbortSignal.timeout(5000)),/其他图片已继续处理/);assert.equal(saved.size,count-1);fail=false;manager.retry(job.id);}
      const done=await manager.wait(job.id,AbortSignal.timeout(5000));assert.equal(saved.size,count);
      const rows=[...saved.values()];assert.ok(rows.every(row=>row.content==='第一行\n第二行 #作品'&&row.source_url===plan.url&&row.collection_id==='target'));
      assert.equal(rows.find(row=>row.id===done.item_id).group_index,0);
      if(count===1)assert.equal(rows[0].group_key,null);else {assert.equal(new Set(rows.map(row=>row.group_key)).size,1);assert.equal(attempts.length,count+1);}
    } finally {await manager.stop();db.close();}
  }
});

test('server image policy persists, restricts writes and handles large static and animated uploads', async t => {
  const dir=await mkdtemp(resolve('artifacts/capture-policy-')), runtime=createApp({dataDir:dir});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await runtime.captures.stop();await runtime.imports.stop();await runtime.trash.stop();await runtime.weixin.stop();await runtime.webhooks.stop();await runtime.backups.stop();await new Promise(r=>server.close(r));runtime.db.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0123'})});
  const Cookie=setup.headers.get('set-cookie').split(';')[0];
  const call=(path,method='GET',body,headers={})=>fetch(base+path,{method,headers:{Cookie,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
  assert.equal((await fetch(base+'/api/capture-settings')).status,401);
  assert.deepEqual(await (await call('/api/capture-settings')).json(),{image_size_mode:'original'});
  const token=await (await call('/api/tokens','POST',{name:'extension',scope:'write'})).json();
  assert.equal((await call('/api/capture-settings','PATCH',{image_size_mode:'compress'},{Authorization:'Bearer '+token.token})).status,403);
  assert.equal((await call('/api/capture-settings','PATCH',{image_size_mode:'invalid'})).status,400);
  assert.equal((await call('/api/capture-settings','PATCH',{image_size_mode:'compress'})).status,200);
  assert.equal(JSON.parse(runtime.db.prepare('SELECT value FROM settings WHERE key=?').get('capture_settings_v1').value).image_size_mode,'compress');
  const small=await sharp({create:{width:16,height:16,channels:3,background:'#579e91'}}).png().toBuffer();
  const large=Buffer.concat([small,Buffer.alloc(26*1048576)]);
  async function upload(buffer,mode) {const body=new FormData();body.set('file',new Blob([buffer]),'image.png');if(mode)body.set('image_size_mode',mode);const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie},body});assert.equal(r.status,201,await r.clone().text());return r.json();}
  const compressed=await upload(large);assert.equal(compressed.mime,'image/webp');assert.ok(compressed.bytes<25*1048576);assert.match(compressed.content,/低损压缩/);
  const original=await upload(large,'original');assert.equal(original.bytes,large.length);
  const frames=Buffer.concat([Buffer.alloc(16,20),Buffer.alloc(16,240)]);
  const gif=await sharp(frames,{raw:{width:2,height:4,channels:4,pageHeight:2}}).gif({delay:[100,100]}).toBuffer();
  const animation=await upload(Buffer.concat([gif,Buffer.alloc(26*1048576)]));assert.equal(animation.mime,'image/gif');assert.match(animation.content,/已保留原文件/);
});
