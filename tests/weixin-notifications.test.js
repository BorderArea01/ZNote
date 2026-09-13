import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../server/app.js';
import {createWeixinNotifications} from '../server/weixin-notifications.js';
import {createWeixinClient} from '../server/weixin-client.js';

const account={base:'https://ilinkai.weixin.qq.com',token:'SECRET-ACCOUNT',bot:'bot',user:'owner'};
const message=(id,extras={})=>({message_type:1,message_state:2,message_id:id,from_user_id:'owner',create_time_ms:Date.now(),context_token:'SECRET-CONTEXT',item_list:[{type:1,text_item:{text:'正常笔记内容'}}],...extras});
const payload=(id='incident-1')=>({idempotency_key:id,title:'【测试】前台 ASR',body:'这是模拟通知，不代表真实故障。'});
async function fixture(t){
 const dir=await mkdtemp(resolve('artifacts/weixin-notify-'));let messages=[],calls=[],sendImpl=async()=>({accepted:true});
 const client={updates:async()=>({msgs:messages.splice(0),get_updates_buf:'cursor'}),sendText:async(...args)=>{calls.push(args);return sendImpl(...args)}};
 const runtime=createApp({dataDir:dir,weixinClient:client}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await runtime.weixin.stop();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})});const cookie=setup.headers.get('set-cookie').split(';')[0];
 const request=(path,method='GET',body,token)=>fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{Cookie:cookie}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const json=async(...args)=>{const r=await request(...args);assert.ok(r.ok,await r.clone().text());return r.json()};
 const get=k=>JSON.parse(runtime.db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value||'null');
 const put=(k,s)=>runtime.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(s));
 put('weixin_inbox_v1',{enabled:true,merge_mode:'daily',collection_id:null,tags:['微信'],account,cursor:'',jobs:[]});
 return {...runtime,request,json,calls,get,put,client,dir,messages:value=>{messages=value},sendImpl:fn=>{sendImpl=fn}};
}

test('outbound wire contract: correct recipient/type/context, explicit acceptance and sanitized rejection',async()=>{
 let sent;const client=createWeixinClient({fetcher:async(url,opts)=>{sent={url:String(url),opts,body:JSON.parse(opts.body)};return Response.json({ret:0})}});
 assert.deepEqual(await client.sendText(account,{text:'test',contextToken:'CONTEXT',clientId:'stable'}),{accepted:true});
 assert.ok(sent.url.endsWith('/ilink/bot/sendmessage'));assert.equal(sent.body.msg.to_user_id,'owner');assert.equal(sent.body.msg.message_type,2);assert.equal(sent.body.msg.message_state,2);assert.equal(sent.body.msg.context_token,'CONTEXT');assert.equal(sent.body.msg.item_list[0].text_item.text,'test');
 for(const body of [{},{ret:-2,errmsg:'SECRET-REMOTE'},{ret:0,errcode:-14}]){
  const failing=createWeixinClient({fetcher:async()=>Response.json(body)});
  await assert.rejects(()=>failing.sendText(account,{text:'x',contextToken:'x',clientId:'x'}),e=>!e.message.includes('SECRET-REMOTE'));
 }
});

test('default disabled, explicit opt-in, owner-only context, original daily archival and outgoing idempotency',async t=>{
 const f=await fixture(t),notice=f.weixinNotifications;
 assert.equal(notice.status().enabled,false);assert.equal((await f.request('/api/weixin/notifications','POST',payload())).status,409);assert.equal(f.calls.length,0);
 await f.json('/api/weixin/notifications','PATCH',{enabled:true});
 f.messages([message(1,{from_user_id:'other'}),message(2,{group_id:'group'}),message(3,{message_type:2})]);await f.weixin.tick(new AbortController().signal);assert.equal(notice.status().ready,false);
 f.messages([message(4)]);await f.weixin.tick(new AbortController().signal);assert.equal(notice.status().ready,true);await f.weixin.tick(new AbortController().signal);
 const before=f.get('weixin_inbox_v1'),notes=f.db.prepare('SELECT id,title,content,version FROM items').all();assert.equal(notes.length,1);assert.ok(notes[0].content.includes('正常笔记内容'));
 const first=await f.json('/api/weixin/notifications','POST',payload());assert.equal(first.status,'accepted');assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].contextToken,'SECRET-CONTEXT');
 assert.deepEqual(await f.json('/api/weixin/notifications','POST',payload()),first);assert.equal(f.calls.length,1);
 assert.equal((await f.request('/api/weixin/notifications','POST',{...payload(),body:'changed'})).status,409);
 assert.equal((await f.request('/api/weixin/notifications','POST',{...payload('recipient'),to_user_id:'other'})).status,400);
 assert.deepEqual(f.get('weixin_inbox_v1'),before);assert.deepEqual(f.db.prepare('SELECT id,title,content,version FROM items').all(),notes);
 const publicStatus=await f.json('/api/weixin/notifications');assert.ok(!JSON.stringify(publicStatus).includes('SECRET'));assert.ok(!JSON.stringify(f.get('weixin_notification_receipts_v1')).includes(payload().body));
 const restored=createWeixinNotifications({db:f.db,client:f.client});assert.deepEqual(await restored.send({scope:'admin'},payload()),first);assert.equal(f.calls.length,1);
});

test('notify tokens cannot read or write notes, read inbox/settings, rebind, or access another sender receipt',async t=>{
 const f=await fixture(t);const token=(await f.json('/api/tokens','POST',{name:'TerminalOps',scope:'notify'})).token;
 const other=(await f.json('/api/tokens','POST',{name:'other',scope:'notify'})).token;
 for(const [path,method,body] of [['/api/items','GET'],['/api/collections','POST',{name:'x'}],['/api/weixin','GET'],['/api/weixin/login','POST',{}],['/api/weixin/notifications','PATCH',{enabled:true}],['/api/tokens','GET'],['/media/x/original','GET'],['/api/info','GET']])assert.equal((await f.request(path,method,body,token)).status,403,path);
 for(const scope of ['read','write']){const old=(await f.json('/api/tokens','POST',{name:scope,scope})).token;assert.equal((await f.request('/api/weixin/notifications','POST',payload(),old)).status,403);assert.equal((await f.request('/api/items','GET',undefined,old)).status,200);}
 await f.json('/api/weixin/notifications','PATCH',{enabled:true});f.messages([message(1)]);await f.weixin.tick(new AbortController().signal);
 assert.equal((await f.json('/api/weixin/notifications','POST',payload(),token)).status,'accepted');
 assert.equal((await f.json('/api/weixin/notifications/incident-1','GET',undefined,token)).status,'accepted');
 assert.equal((await f.request('/api/weixin/notifications/incident-1','GET',undefined,other)).status,404);
});

test('failure, concurrency, re-entry after restart and pause do not duplicate messages or alter inbox',async t=>{
 const f=await fixture(t);let now=Date.now(),finish;
 const n=createWeixinNotifications({db:f.db,client:f.client,clock:()=>now});n.configure({enabled:true});n.captureContext(message(1),account);const before=f.get('weixin_inbox_v1');
 f.sendImpl(()=>new Promise(r=>{finish=r}));const inFlight=n.send({scope:'admin'},payload());
 assert.equal((await n.send({scope:'admin'},payload())).status,'sending');await assert.rejects(()=>n.send({scope:'admin'},payload('other')),e=>e.status===429);assert.equal(f.calls.length,1);
 finish({accepted:true});await inFlight;now+=4000;
 f.sendImpl(async()=>{throw Object.assign(Error('SECRET-ERROR'),{weixinCode:-2})});const rejected=await n.send({scope:'admin'},payload('reject'));assert.equal(rejected.status,'rejected');assert.ok(!rejected.detail.includes('SECRET'));assert.deepEqual(f.get('weixin_inbox_v1'),before);
 now+=4000;f.sendImpl(async()=>{throw Error('SECRET-TIMEOUT')});assert.equal((await n.send({scope:'admin'},payload('unknown'))).status,'unknown');const count=f.calls.length;await n.send({scope:'admin'},payload('unknown'));assert.equal(f.calls.length,count);
 const rows=f.get('weixin_notification_receipts_v1');rows.at(-1).status='sending';f.put('weixin_notification_receipts_v1',rows);const restarted=createWeixinNotifications({db:f.db,client:f.client});assert.equal((await restarted.send({scope:'admin'},payload('unknown'))).status,'unknown');assert.equal(f.calls.length,count);
 n.configure({enabled:false});await assert.rejects(()=>n.send({scope:'admin'},payload('disabled')),e=>e.status===409);assert.deepEqual(f.get('weixin_inbox_v1'),before);
 n.configure({enabled:true});f.put('weixin_inbox_v1',{...before,account:{...account,token:'NEW-ACCOUNT'}});assert.equal(n.status().ready,false);assert.equal(f.calls.length,count);
});

test('outbound context persistence failure is isolated from normal inbound archival',async t=>{
 const f=await fixture(t);f.db.exec("CREATE TRIGGER reject_notify_context BEFORE INSERT ON settings WHEN NEW.key='weixin_notification_context_v1' BEGIN SELECT RAISE(FAIL, 'simulated context failure'); END;");
 f.messages([message(1)]);await f.weixin.tick(new AbortController().signal);await f.weixin.tick(new AbortController().signal);
 assert.equal(f.get('weixin_inbox_v1').jobs[0].state,'done');assert.equal(f.db.prepare('SELECT count(*) n FROM items').get().n,1);assert.equal(f.calls.length,0);
});

test('frequency/capacity guard preserves valid receipts and full backups retain the outbound state',async t=>{
 const f=await fixture(t);const n=f.weixinNotifications;n.configure({enabled:true});n.captureContext(message(1),account);
 await n.send({scope:'admin'},payload());await assert.rejects(()=>n.send({scope:'admin'},payload('too-soon')),e=>e.status===429);assert.equal(f.calls.length,1);
 const receipt=f.get('weixin_notification_receipts_v1')[0];
 f.put('weixin_notification_receipts_v1',Array.from({length:1000},(_,i)=>({...receipt,id:'fixture-'+i,key:'fixture-'+i})));
 await assert.rejects(()=>n.send({scope:'admin'},payload('over-capacity')),e=>e.status===429);assert.equal(f.calls.length,1);assert.equal(f.get('weixin_notification_receipts_v1').length,1000);
 f.put('weixin_notification_receipts_v1',[receipt]);
 await f.backups.run();const saved=(await f.backups.list())[0],restoredDir=await mkdtemp(resolve('artifacts/weixin-notify-restore-')),restored=createApp({dataDir:restoredDir,weixinClient:f.client});
 try{
  const preview=await restored.backups.preview(f.backups.file(saved.id));await restored.backups.restore(preview.id);
  assert.equal(restored.weixinNotifications.status().enabled,true);assert.equal(restored.weixinNotifications.status().ready,true);
  assert.equal((await restored.weixinNotifications.send({scope:'admin'},payload())).status,'accepted');assert.equal(f.calls.length,1);
 }finally{await restored.weixin.stop();await restored.backups.stop();await restored.webhooks.stop();await restored.imports.stop();await restored.trash.stop();restored.db.close()}
});
