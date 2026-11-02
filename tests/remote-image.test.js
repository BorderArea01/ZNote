import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {normalizeRemoteImage} from '../shared/remote-image.js';
import {remoteCapture} from '../addons/browser/clipper/connection-routes.js';
import {createApp} from '../server/app.js';
import {inboxFixture} from './helpers/cloudflare-inbox-fixture.js';
import {createCollector} from '../addons/connectors/cloudflare/collector.js';

const descriptor={urls:['https://cdn.example.com/original.jpg','https://cdn.example.com/display.jpg'],source_url:'https://example.com/post/42',title:'单张图片与出处'};
test('remote single-image contract rejects private/file pointers and never forwards cookies, file bytes or arbitrary headers',()=>{
 for(const url of ['blob:https://example.com/id','data:image/png;base64,AA','http://127.0.0.1/a','http://192.168.1.1/a','http://[::1]/','http://localhost/a','http://user:pass@example.com/a','https://example.com:444/a'])assert.throws(()=>normalizeRemoteImage({...descriptor,urls:[url]}));
 assert.throws(()=>normalizeRemoteImage({...descriptor,source_url:'file:///private'}));
 const input=remoteCapture({text:descriptor.urls[0],remote_image:descriptor,image_size_mode:'original',browser_html:'private',headers:{Cookie:'private'},file:'private',token:'private'});
 assert.deepEqual(Object.keys(input).sort(),['image_size_mode','remote_image','text']);
});
test('cloud and collector preserve the original candidates, source page and size policy without leaking browser credentials',async()=>{
 const f=await inboxFixture();try{
  const auth={Cookie:await f.pair()},input={text:descriptor.urls[0],remote_image:descriptor,image_size_mode:'original',collection_id:'chosen',request_id:'single-image:42'};
  const response=await f.call('/api/captures','POST',input,auth);assert.equal(response.status,202);const queued=await response.json();
  assert.equal((await f.call('/api/captures','POST',{...input,remote_image:{...descriptor,source_url:'https://example.com/other'}},auth)).status,409);
  assert.equal((await f.call('/api/captures','POST',{...input,request_id:'bad',remote_image:{...descriptor,urls:['http://127.0.0.1/private']}},auth)).status,400);
  const requests=[];const collector=createCollector({local:async(path,method,body)=>{if(path==='/api/collections')return[];if(method==='POST')requests.push(body);return{id:'local',status:'queued'};},relay:async(path,method,body)=>{const r=await f.connector(path.slice('/connector/'.length),body);assert.ok(r.ok);return r.json();}});
  await collector.step();assert.equal(requests.length,1);assert.deepEqual(requests[0].remote_image,descriptor);assert.equal(requests[0].image_size_mode,'original');assert.equal(requests[0].request_id,'cf:'+queued.id);
 }finally{f.sql.close();}
});
test('single-image archive falls back, stores original bytes and provenance, deduplicates retries, and reports real download failure',async t=>{
 let offline=false;const requested=[],png=await sharp({create:{width:24,height:30,channels:3,background:'#517793'}}).png().toBuffer(),dir=await mkdtemp(resolve('artifacts/remote-image-unit-'));
 const runtime=createApp({dataDir:dir,captureOptions:{page:async()=>{throw Error('An image capture must not parse its source page');},image:async url=>{requested.push(url);if(offline||url===descriptor.urls[0])throw Error('图片读取失败 HTTP 403');return png;}}});
 t.after(async()=>{for(const key of ['captures','imports','trash','backups','webhooks','weixin'])await runtime[key].stop();runtime.db.close();});
 const input={text:descriptor.urls[0],remote_image:descriptor,image_size_mode:'original',request_id:'remote-image-local:42'};
 const job=runtime.captures.add(input),done=await runtime.captures.wait(job.id,AbortSignal.timeout(10000));assert.equal(done.status,'completed');assert.equal(done.message,'图片已入库');
 const saved=runtime.db.prepare('SELECT * FROM items WHERE id=?').get(done.item_id);assert.equal(saved.kind,'image');assert.equal(saved.source_url,descriptor.source_url);assert.match(saved.content,/原图链接：https:\/\/cdn.example.com\/display.jpg/);assert.equal(saved.bytes,png.length);assert.deepEqual(requested,descriptor.urls);
 assert.equal(runtime.captures.add(input).id,job.id);assert.equal(requested.length,2);
 assert.throws(()=>runtime.captures.add({...input,remote_image:{...descriptor,source_url:'https://example.com/other'}}),e=>e.status===409);
 assert.throws(()=>runtime.captures.add({...input,remote_image:{...descriptor,urls:['blob:unsafe']}}),e=>e.status===400);
 offline=true;const failed=runtime.captures.add({...input,request_id:'remote-image-local:fail'});await assert.rejects(runtime.captures.wait(failed.id,AbortSignal.timeout(10000)),/原图下载失败/);assert.equal(runtime.captures.get(failed.id).status,'failed');assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,1);
 offline=false;runtime.captures.retry(failed.id);assert.equal((await runtime.captures.wait(failed.id,AbortSignal.timeout(10000))).status,'completed');
});
