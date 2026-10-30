import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {resolve} from 'node:path';import sharp from 'sharp';
import {normalizePixivPost,pixivCapturePlan} from '../shared/pixiv-capture.js';
import {inboxFixture} from './helpers/cloudflare-inbox-fixture.js';
import {createApp} from '../server/app.js';
import {createCollector} from '../addons/connectors/cloudflare/collector.js';
const source='https://www.pixiv.net/artworks/12345',post=()=>({work_id:'12345',page_count:2,type:1,title:'手机画集',description:'正文与出处',author:'作者',tags:['画集'],cookie:'secret-PHPSESSID',images:[0,1].map(i=>({original:`https://i.pximg.net/img-original/12345_p${i}.png`,preview:`https://i.pximg.net/img-master/12345_p${i}.jpg`}))});
test('phone Pixiv metadata keeps complete ordered originals without cookies or unrelated hosts',()=>{
 const safe=normalizePixivPost(post(),source);assert.ok(!JSON.stringify(safe).includes('secret'));assert.equal(safe.images.length,2);assert.equal(pixivCapturePlan(safe,source).url,source);
 for(const bad of [{...post(),work_id:'1'},{...post(),page_count:3},{...post(),type:'2'},{...post(),images:[{original:'https://pximg.net.evil.test/a'}]}])assert.throws(()=>normalizePixivPost(bad,source));
 assert.throws(()=>normalizePixivPost(post(),'https://evil.test/artworks/12345'));
});
test('authenticated phone work crosses inbox and collector as metadata, with the exact source and no session secret',async()=>{
 const f=await inboxFixture();try{const cookie=await f.pair(),r=await f.call('/api/captures','POST',{text:source,image_mode:'group',request_id:'pixiv:phone',browser_pixiv:post()},{Cookie:cookie});assert.equal(r.status,202);const job=await r.json();
 const localJobs=new Map(),seen=[];const c=createCollector({local:async(path,method='GET',input)=>{if(path==='/api/collections')return [];if(path==='/api/captures'){seen.push(input);localJobs.set('one',{id:'one',status:'completed',title:'手机画集',message:'图片组已入库'});return {id:'one'};}return localJobs.get(path.split('/').pop());},relay:async(path,method,input)=>{const r=await f.connector(path.split('/').pop(),input);assert.equal(r.status,200);return r.json();}});
 await c.step();await c.step();assert.equal(seen.length,1);assert.equal(seen[0].browser_pixiv.images.length,2);assert.ok(!JSON.stringify(seen).includes('secret-PHPSESSID'));assert.equal((await(await f.call('/api/captures/'+job.id,'GET',undefined,{Cookie:cookie})).json()).status,'completed');
 assert.equal((await f.call('/api/captures','POST',{text:source,browser_pixiv:{...post(),work_id:'other'}},{Cookie:cookie})).status,400);
 }finally{f.sql.close();}
});
test('server archives the phone-resolved work without another anonymous Pixiv request',async()=>{
 const runtime=createApp({dataDir:await mkdtemp(resolve('artifacts/pixiv-phone-unit-')),captureOptions:{page:async()=>{throw Error('Anonymous refetch is forbidden');},image:async url=>sharp({create:{width:24,height:24,channels:3,background:url.includes('p0')?'#aabbee':'#cceeff'}}).png().toBuffer()}});
 try{const j=runtime.captures.add({text:source,image_mode:'group',request_id:'phone:pixiv',browser_pixiv:post()}),done=await runtime.captures.wait(j.id,AbortSignal.timeout(10000));assert.equal(done.status,'completed');const rows=runtime.db.prepare("SELECT * FROM items WHERE kind='image' ORDER BY group_index").all();assert.equal(rows.length,2);assert.ok(rows.every(r=>r.source_url===source&&r.group_key===rows[0].group_key&&r.group_key.startsWith('capture:')&&r.content.includes('正文与出处')));assert.deepEqual(rows.map(r=>r.group_index),[0,1]);assert.ok(!JSON.stringify(rows).includes('secret-PHPSESSID'));}
 finally{for(const k of ['captures','weixin','trash','imports','backups','webhooks'])await runtime[k].stop();runtime.db.close();}
});

test('phone login retries the original cloud and local failures without moving their library or leaking cookies',async()=>{
 const f=await inboxFixture();try{
  const headers={Cookie:await f.pair()},input={text:source,collection_id:'chosen',image_mode:'group',request_id:'failed:pixiv'};
  const job=await(await f.call('/api/captures','POST',input,headers)).json();const claim=(await(await f.connector('sync',{collections:[],updates:[],can_claim:true})).json()).job;
  await f.connector('sync',{collections:[],can_claim:false,updates:[{id:job.id,lease:claim.lease,status:'failed',message:'需要登录',local_id:'original-local'}]});
  assert.equal((await f.call('/api/captures/'+job.id+'/retry','POST',{browser_pixiv:{...post(),work_id:'other'}},headers)).status,400);
  const retry=await f.call('/api/captures/'+job.id+'/retry','POST',{browser_pixiv:post()},headers);assert.equal(retry.status,202);assert.equal((await retry.json()).id,job.id);
  let seen;const collector=createCollector({local:async(path,method='GET',value)=>{if(path==='/api/collections')return [{id:'chosen',name:'原知识库'}];if(path.endsWith('/retry')){seen={path,value};return {id:'original-local',status:'completed',message:'图片组已入库'};}if(path==='/api/captures')throw Error('Must retry, not create another task');return {id:'original-local',status:'failed'};},relay:async(path,method,value)=>(await f.connector(path.split('/').pop(),value)).json()});
  await collector.step();assert.equal(seen.path,'/api/captures/original-local/retry');assert.equal(seen.value.browser_pixiv.images.length,2);assert.ok(!JSON.stringify(seen).includes('secret'));const stored=f.sql.prepare('SELECT input FROM relay_jobs WHERE id=?').get(job.id);assert.equal(JSON.parse(stored.input).collection_id,'chosen');
 }finally{f.sql.close();}
 const runtime=createApp({dataDir:await mkdtemp(resolve('artifacts/pixiv-retry-unit-')),captureOptions:{page:async()=>{throw Object.assign(Error('需要登录'),{status:422});},image:async()=>sharp({create:{width:24,height:24,channels:3,background:'#aabbee'}}).png().toBuffer()}});
 try{const job=runtime.captures.add({text:source,image_mode:'group',request_id:'failed-local'});await assert.rejects(runtime.captures.wait(job.id,AbortSignal.timeout(10000)),/需要登录/);assert.throws(()=>runtime.captures.retry(job.id,{browser_pixiv:{...post(),work_id:'wrong'}}));assert.equal(runtime.captures.get(job.id).status,'failed');runtime.captures.retry(job.id,{browser_pixiv:post()});const done=await runtime.captures.wait(job.id,AbortSignal.timeout(10000));assert.equal(done.id,job.id);assert.equal(done.status,'completed');assert.equal(runtime.captures.list().length,1);}
 finally{for(const k of ['captures','weixin','trash','imports','backups','webhooks'])await runtime[k].stop();runtime.db.close();}
});
