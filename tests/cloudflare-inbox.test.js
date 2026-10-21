import test from 'node:test';import assert from 'node:assert/strict';import{inboxFixture}from'./helpers/cloudflare-inbox-fixture.js';
test('invitation GET and preview remain reusable until an explicit authorization POST',async()=>{
 const f=await inboxFixture();try{
  const code=crypto.randomUUID();await f.connector('pair',{code});
  for(let i=0;i<3;i++){const response=await f.call('/connect/'+code);assert.equal(response.status,200);assert.match(await response.text(),/导入 ZNote App/);assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Cache-Control'),'no-store');}
  assert.equal(f.sql.prepare('SELECT count(*) n FROM relay_tokens').get().n,0);assert.equal((await f.call('/api/auth/login','POST',{password:code})).status,200);assert.equal((await f.call('/api/auth/login','POST',{password:code})).status,401);
 }finally{f.sql.close();}
});
test('inbox pairs once, issues an Android-compatible cookie/device token and rejects unauthorized/cross-origin requests',async()=>{
 const f=await inboxFixture();try{
  assert.equal((await f.call('/api/health')).status,200);assert.equal((await f.call('/api/collections')).status,401);
  assert.equal((await f.call('/connector/sync','POST',{})).status,401);
  assert.equal((await f.call('/api/auth/login','POST',{password:'x'},{Origin:'https://evil.test'})).status,403);
  const code=crypto.randomUUID();await f.connector('pair',{code});const response=await f.call('/api/auth/login','POST',{password:code});const cookie=response.headers.get('Set-Cookie');assert.match(cookie,/Secure; SameSite=Strict/);assert.equal((await f.call('/api/auth/login','POST',{password:code})).status,401);
  const device=await(await f.call('/api/tokens','POST',{name:'Android 手机采集',scope:'write'},{Cookie:cookie})).json();assert.match(device.token,/^zn_[a-f0-9]{64}$/);
  assert.equal((await f.call('/api/collections','GET',undefined,{Authorization:'Bearer '+device.token})).status,200);
  assert.equal((await f.call('/api/tokens','POST',{name:'bad',scope:'write'},{Authorization:'Bearer '+device.token})).status,403);
  assert.equal((await f.call('/api/assets','POST',{}, {Authorization:'Bearer '+device.token})).status,413);
 }finally{f.sql.close();}
});
test('queued capture survives connector absence; lease CAS prevents duplicate claims and stale status writes',async()=>{
 const f=await inboxFixture();try{
  const cookie=await f.pair(),headers={Cookie:cookie},input={text:'分享作品 https://www.bilibili.com/video/BV123',image_mode:'group',collection_id:'chosen',request_id:'phone:123'};
  const response=await f.call('/api/captures','POST',input,headers);assert.equal(response.status,202);const job=await response.json();assert.equal(job.status,'queued');assert.equal((await(await f.call('/api/captures','POST',input,headers)).json()).id,job.id);
  assert.equal((await f.call('/api/captures','POST',{...input,collection_id:'other'},headers)).status,409);
  const sync={collections:[{id:'chosen',name:'目标库'}],updates:[],can_claim:true};
  const first=await(await f.connector('sync',sync)).json();assert.equal(first.job.id,job.id);assert.equal(first.job.input.collection_id,'chosen');assert.equal((await(await f.connector('sync',sync)).json()).job,null);
  await f.connector('sync',{...sync,can_claim:false,updates:[{id:job.id,lease:'stale',status:'completed',message:'不应成功'}]});assert.equal((await(await f.call('/api/captures/'+job.id,'GET',undefined,headers)).json()).status,'queued');
  await f.connector('sync',{...sync,can_claim:false,updates:[{id:job.id,lease:first.job.lease,status:'completed',message:'图片组已入库，4 张图片',local_id:'local-job'}]});const saved=await(await f.call('/api/captures/'+job.id,'GET',undefined,headers)).json();assert.equal(saved.status,'completed');assert.match(saved.message,/4 张/);assert.equal(saved.item_id,undefined);
  assert.equal((await f.call('/api/captures/'+job.id+'/retry','POST',{},headers)).status,409);
  assert.deepEqual(await(await f.call('/api/collections','GET',undefined,headers)).json(),sync.collections);
  const otherDevice=await f.pair();assert.equal((await(await f.call('/api/captures/'+job.id,'GET',undefined,{Cookie:otherDevice})).json()).id,job.id);
 }finally{f.sql.close();}
});
test('failed capture retains its identity and increments explicit retry; an expired lease can be recovered',async()=>{
 const f=await inboxFixture();try{
  const headers={Cookie:await f.pair()},job=await(await f.call('/api/captures','POST',{text:'https://tieba.baidu.com/p/123'},headers)).json();
  const sync={collections:[],updates:[],can_claim:true};let claim=(await(await f.connector('sync',sync)).json()).job;
  f.sql.prepare('UPDATE relay_jobs SET lease_until=0 WHERE id=?').run(job.id);const replacement=(await(await f.connector('sync',sync)).json()).job;assert.notEqual(replacement.lease,claim.lease);claim=replacement;
  await f.connector('sync',{...sync,can_claim:false,updates:[{id:job.id,lease:claim.lease,status:'failed',message:'平台需要登录，未入库'}]});
  const retry=await(await f.call('/api/captures/'+job.id+'/retry','POST',{},headers)).json();assert.equal(retry.id,job.id);assert.equal(retry.attempt,1);assert.equal(retry.status,'queued');
  const newClaim=(await(await f.connector('sync',sync)).json()).job;assert.equal(newClaim.id,job.id);assert.equal(newClaim.attempt,1);
 }finally{f.sql.close();}
});
