import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {weixinDay,weixinNewNoteCommand} from '../server/weixin-grouping.js';
import {weixinMessageKey,weixinItemId} from '../server/weixin.js';
import {originalBuffer} from '../server/storage.js';

test('WeChat days use Beijing midnight and only explicit text commands split notes',()=>{
  assert.equal(weixinDay('2026-09-10T15:59:59Z'),'2026-09-10');
  assert.equal(weixinDay('2026-09-10T16:00:00Z'),'2026-09-11');
  assert.deepEqual(weixinNewNoteCommand({item_list:[{type:1,text_item:{text:'/新篇 旅行参考'}}]}),{title:'旅行参考'});
  for(const text of ['记录 /新篇 旅行','/新篇\n正文','/新篇章','/新篇 '+ 'a'.repeat(81)])assert.equal(weixinNewNoteCommand({item_list:[{type:1,text_item:{text}}]}),null);
});

async function fixture(t){
  const dir=await mkdtemp(resolve('artifacts/weixin-daily-')),image=await sharp({create:{width:40,height:30,channels:3,background:'#8265ab'}}).png().toBuffer();
  let incoming=[],downloads=0,failing=false;
  const client={updates:async()=>({msgs:incoming.splice(0),get_updates_buf:'cursor'}),image:async()=>{downloads++;if(failing)throw Error('offline');return image;}};
  const r=createApp({dataDir:dir,weixinClient:client}),server=r.app.listen(0,'127.0.0.1');await new Promise(done=>server.once('listening',done));
  t.after(async()=>{await r.weixin.stop();await r.trash.stop();await r.backups.stop();await r.imports.stop();await r.webhooks.stop();await new Promise(done=>server.close(done));r.db.close()});
  const base='http://127.0.0.1:'+server.address().port,setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0931'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
  const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const json=async(...args)=>{const response=await request(...args);assert.ok(response.ok,await response.clone().text());return response.json();};
  const a=await json('/api/collections','POST',{name:'微信归档'}),b=await json('/api/collections','POST',{name:'其他知识库'}),account={base:'https://ilinkai.weixin.qq.com',token:'SECRET',bot:'bot',user:'owner'};
  const state=()=>JSON.parse(r.db.prepare("SELECT value FROM settings WHERE key='weixin_inbox_v1'").get().value);
  const store=s=>r.db.prepare("INSERT INTO settings VALUES('weixin_inbox_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(s));
  store({enabled:true,collection_id:a.id,tags:['灵感'],account,cursor:'',jobs:[]});
  const update=fn=>{const s=state();fn(s);store(s)};
  const tick=()=>r.weixin.tick(new AbortController().signal);
  const text=value=>({type:1,text_item:{text:value}}),photo={type:2,image_item:{media:{encrypt_query_param:'private'}}};
  let sequence=0;
  const message=(parts,date='2026-09-10T10:00:00Z')=>({message_type:1,message_state:2,message_id:String(++sequence),from_user_id:'owner',item_list:Array.isArray(parts)?parts:[text(parts)],create_time_ms:Date.parse(date)});
  const deliver=async(...messages)=>{incoming.push(...messages);await tick();await tick()};
  const note=id=>r.db.prepare('SELECT * FROM items WHERE id=?').get(id);
  const notes=()=>r.db.prepare("SELECT * FROM items WHERE kind='note' ORDER BY created_at,id").all();
  return {r,client,base,dir,a,b,account,image,state,store,update,tick,text,photo,message,deliver,note,notes,json,request,queue:(...messages)=>incoming.push(...messages),downloads:()=>downloads,fail:value=>{failing=value}};
}

test('daily text and separate images append locally; edits, cover, duplicate replay and midnight are preserved',async t=>{
  const f=await fixture(t),first=f.message('**灵感标题** [参考](https://example.com/)'),picture=f.message([f.photo]),caption=f.message('这是图片说明');
  await f.deliver(first,picture,caption);
  assert.equal(f.r.weixin.status().merge_mode,'daily');assert.equal(f.notes().length,1);
  let note=f.notes()[0];assert.equal(note.title,'微信收件 · 2026-09-10');
  assert.ok(note.content.indexOf('灵感标题')<note.content.indexOf('![微信配图'));assert.ok(note.content.indexOf('![微信配图')<note.content.indexOf('这是图片说明'));
  const img=f.r.db.prepare("SELECT * FROM items WHERE kind='image'").get();assert.equal(img.group_key,'note:'+note.id);assert.deepEqual(await originalBuffer(f.dir,img),f.image);
  const changed=await f.json('/api/items/'+note.id,'PATCH',{version:note.version,title:'我的手工标题',content:note.content+'\n\n手写补充',tags:['自定义']});
  await f.deliver(f.message([f.photo]));note=f.note(note.id);assert.equal(note.title,'我的手工标题');assert.ok(note.content.includes('手写补充'));assert.ok(JSON.parse(note.tags).includes('自定义'));assert.ok(note.version>changed.version);
  const order=await f.json('/api/item-groups/order?id='+note.id);const reversed=order.items.map(i=>i.id).reverse();await f.json('/api/item-groups/order','POST',{id:note.id,revision:order.revision,ids:reversed,sync_note:false});
  await f.deliver(f.message([f.photo]));const after=await f.json('/api/item-groups/order?id='+note.id);assert.equal(after.cover_id,reversed[0]);assert.equal(after.items.length,3);assert.deepEqual(after.items.slice(0,2).map(i=>i.id),reversed);
  const stable=f.note(note.id).content,downloadCount=f.downloads();f.update(s=>{s.jobs=[]});await f.deliver(first,picture,caption);assert.equal(f.note(note.id).content,stable);assert.equal(f.downloads(),downloadCount);
  await f.deliver(f.message('次日内容','2026-09-10T16:00:00Z'));assert.equal(f.notes().length,2);assert.ok(f.notes().some(n=>n.title==='微信收件 · 2026-09-11'&&n.content==='次日内容'));
});

test('failed photos block only their note; append and receipts commit together and retry once',async t=>{
  const f=await fixture(t);await f.deliver(f.message('之前的内容'));const note=f.notes()[0];
  const imageMessage=f.message([f.photo]),after=f.message('紧随图片的说明'),nextDay=f.message('另一日期','2026-09-10T16:00:00Z');
  f.fail(true);await f.deliver(imageMessage,after,nextDay);assert.equal(f.state().jobs.find(j=>j.id===weixinMessageKey(imageMessage,f.account)).state,'failed');assert.equal(f.note(note.id).content,'之前的内容');assert.ok(f.notes().some(n=>n.content==='另一日期'));
  f.fail(false);f.update(s=>{s.jobs.find(j=>j.state==='failed').state='pending'});await f.tick();assert.ok(f.note(note.id).content.indexOf('![微信配图')<f.note(note.id).content.indexOf('紧随图片的说明'));
  const baseline=f.note(note.id),history=f.r.db.prepare('SELECT count(*) n FROM note_versions WHERE item_id=?').get(note.id).n;
  f.r.db.exec("CREATE TRIGGER fail_weixin_receipt BEFORE INSERT ON settings WHEN NEW.key LIKE 'weixin_receipt_v1:%' BEGIN SELECT RAISE(ABORT,'receipt fixture'); END");
  const atomic=f.message('只能出现一次');await f.deliver(atomic);assert.equal(f.note(note.id).content,baseline.content);assert.equal(f.note(note.id).version,baseline.version);assert.equal(f.r.db.prepare('SELECT count(*) n FROM note_versions WHERE item_id=?').get(note.id).n,history);
  f.r.db.exec('DROP TRIGGER fail_weixin_receipt');f.update(s=>{s.jobs.find(j=>j.id===weixinMessageKey(atomic,f.account)).state='pending'});await f.tick();assert.equal(f.note(note.id).content.split('只能出现一次').length,2);
  f.update(s=>{const j=s.jobs.find(j=>j.id===weixinMessageKey(atomic,f.account));j.state='pending';j.message=atomic});await f.tick();assert.equal(f.note(note.id).content.split('只能出现一次').length,2);
});

test('manual boundaries and pending destinations survive settings changes; deleted notes never resurrect',async t=>{
  const f=await fixture(t),old=f.message('原篇文字'),command=f.message('/新篇 旅行计划'),photo=f.message([f.photo]),caption=f.message('酒店参考');
  await f.deliver(old,command,photo,caption);assert.equal(f.notes().length,2);const travel=f.notes().find(n=>n.title==='旅行计划');assert.ok(travel.content.includes('酒店参考'));assert.equal(travel.content.includes('/新篇'),false);
  const pending=f.message('排队中的内容');f.queue(pending);await f.tick();f.update(s=>{s.collection_id=f.b.id});await f.tick();assert.ok(f.note(travel.id).content.includes('排队中的内容'));
  await f.deliver(f.message('属于另一个库'));assert.ok(f.notes().some(n=>n.collection_id===f.b.id&&n.content==='属于另一个库'));
  f.update(s=>{s.collection_id=f.a.id;s.merge_mode='session'});await f.deliver(f.message('持续收集'),f.message([f.photo],'2026-09-10T16:00:00Z'));const session=f.notes().find(n=>n.content.includes('持续收集'));assert.ok(session.content.includes('/media/'));
  const stale=f.message('不能复活旧笔记');f.queue(stale);await f.tick();await f.request('/api/items/'+session.id,'DELETE');await f.tick();assert.ok(f.note(session.id).deleted_at);assert.equal(f.note(session.id).content.includes('不能复活'),false);
  await f.deliver(f.message('新的收集'));assert.ok(f.notes().some(n=>n.id!==session.id&&n.content==='新的收集'));
  const active=f.notes().find(n=>n.content==='新的收集'),stalePermanent=f.message('永久删除之后不能重建');f.queue(stalePermanent);await f.tick();f.r.db.prepare('DELETE FROM items WHERE id=?').run(active.id);await f.tick();assert.equal(f.note(active.id),undefined);
  // Already queued messages retain their old mode; new independent messages keep legacy IDs.
  f.update(s=>{s.merge_mode='message'});const separate=f.message('单条模式');await f.deliver(separate);assert.equal(f.note(weixinItemId(weixinMessageKey(separate,f.account))).content,'单条模式');
  assert.equal((await f.request('/api/weixin','PATCH',{enabled:false,collection_id:f.a.id,tags:[],merge_mode:'bad'})).status,400);
  await f.json('/api/weixin','PATCH',{enabled:false,collection_id:f.a.id,tags:['灵感'],merge_mode:'daily'});const next=await f.json('/api/weixin/new-note','POST',{title:'下一篇主题'});assert.equal(next.current_note.title,'下一篇主题');assert.equal(next.current_note.pending,true);
  const token=await f.json('/api/tokens','POST',{name:'writer',scope:'write'});const denied=await fetch(f.base+'/api/weixin/new-note',{method:'POST',headers:{Authorization:'Bearer '+token.token,'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
  assert.ok(!JSON.stringify(next).includes('SECRET'));
});

test('daily destinations and durable receipts survive complete backup restore',async t=>{
  const f=await fixture(t),first=f.message('迁移前的文字'),photo=f.message([f.photo]);await f.deliver(first,photo);const note=f.notes()[0];
  await f.r.backups.run();const archive=(await f.r.backups.list())[0],dir=await mkdtemp(resolve('artifacts/weixin-daily-restored-')),restored=createApp({dataDir:dir,weixinClient:f.client});
  try{
    const preview=await restored.backups.preview(f.r.backups.file(archive.id));await restored.backups.restore(preview.id);
    const tick=()=>restored.weixin.tick(new AbortController().signal);
    f.queue(first,photo,f.message('迁移后的文字'));await tick();await tick();
    const notes=restored.db.prepare("SELECT * FROM items WHERE kind='note'").all();assert.equal(notes.length,1);assert.equal(notes[0].id,note.id);assert.equal(notes[0].content.split('迁移前的文字').length,2);assert.ok(notes[0].content.includes('迁移后的文字'));
    const images=restored.db.prepare("SELECT * FROM items WHERE kind='image'").all();assert.equal(images.length,1);assert.deepEqual(await originalBuffer(dir,images[0]),f.image);
  }finally{await restored.weixin.stop();await restored.trash.stop();await restored.backups.stop();await restored.imports.stop();await restored.webhooks.stop();restored.db.close()}
});

test('a note removed while its next photo downloads is not recreated by the append',async t=>{
  const f=await fixture(t);await f.deliver(f.message('不能复活'));const note=f.notes()[0];
  f.client.image=async()=>{f.r.db.prepare('DELETE FROM items WHERE id=?').run(note.id);return f.image;};
  await f.deliver(f.message([f.photo]));assert.equal(f.note(note.id),undefined);assert.equal(f.state().jobs.at(-1).state,'failed');
});

test('the failure blocking a daily note stays visible beyond the recent thirty messages',async t=>{
  const f=await fixture(t);f.fail(true);await f.deliver(f.message([f.photo]),...Array.from({length:35},(_,i)=>f.message('排队说明 '+i)));
  const status=f.r.weixin.status();assert.equal(status.failed_count,1);assert.equal(status.jobs[0].state,'failed');assert.equal(status.jobs.length,30);assert.equal(f.notes().length,0);
  f.r.weixin.skip(status.jobs[0].id);await f.tick();assert.equal(f.notes().length,1);assert.ok(f.notes()[0].content.includes('排队说明 34'));
});
