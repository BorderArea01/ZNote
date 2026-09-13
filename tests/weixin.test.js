import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createCipheriv,randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {createWeixinClient,decodeWeixinImage,weixinUrl} from '../server/weixin-client.js';
import {weixinItemId,weixinMessageKey} from '../server/weixin.js';
import {createApp} from '../server/app.js';
import {originalBuffer} from '../server/storage.js';

test('Weixin transport isolates credentials from CDN, bounds downloads and decodes both Tencent key encodings',async()=>{
 const bytes=Buffer.from('original picture'),key=randomBytes(16),cipher=createCipheriv('aes-128-ecb',key,null),encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
 for(const aes_key of [key.toString('base64'),Buffer.from(key.toString('hex')).toString('base64')])assert.deepEqual(decodeWeixinImage(encrypted,{media:{aes_key}}),bytes);
 assert.deepEqual(decodeWeixinImage(encrypted,{aeskey:key.toString('hex')}),bytes);
 assert.throws(()=>decodeWeixinImage(encrypted,{media:{encrypt_type:1}}));
 for(const url of ['http://ilinkai.weixin.qq.com','https://ilinkai.weixin.qq.com.evil.test','https://127.0.0.1','https://user@ilinkai.weixin.qq.com','https://ilinkai.weixin.qq.com:444'])assert.throws(()=>weixinUrl(url));
 const calls=[],client=createWeixinClient({fetcher:async(url,options)=>{calls.push({url:String(url),options});return String(url).includes('/c2c/download')?new Response(encrypted):Response.json({ret:0,msgs:[],get_updates_buf:'next'});}});
 await client.updates({base:'https://ilinkai.weixin.qq.com',token:'private'},'',new AbortController().signal);
 assert.equal(calls[0].options.headers.Authorization,'Bearer private');
 assert.deepEqual(await client.image({media:{encrypt_query_param:'abc',aes_key:key.toString('base64')}}),bytes);
 assert.equal(calls[1].options.headers,undefined);assert.ok(!JSON.stringify(calls[1]).includes('private'));
 const oversized=createWeixinClient({fetcher:async()=>new Response('x',{headers:{'content-length':String(26*1024*1024)}})});await assert.rejects(()=>oversized.image({media:{encrypt_query_param:'x'}}),/大小限制/);
 const largeIds=createWeixinClient({fetcher:async()=>new Response('{"ret":0,"msgs":[{"message_id":18446744073709551615}]}')});assert.equal((await largeIds.updates({base:'https://ilinkai.weixin.qq.com',token:'x'},'')).msgs[0].message_id,'18446744073709551615');
});

test('Weixin inbox saves original images and Markdown locally, isolates senders/libraries and survives replay and partial failures',async t=>{
 const dir=await mkdtemp(resolve('artifacts/weixin-api-'));
 const image=await sharp({create:{width:32,height:24,channels:3,background:'#5377bb'}}).png().toBuffer();let next=[],failure=false,downloads=0;
 const client={updates:async()=>({msgs:next.splice(0),get_updates_buf:'cursor'}),image:async()=>{downloads++;if(failure)throw Error('offline');return image;}};
 const runtime=createApp({dataDir:dir,weixinClient:client}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await runtime.weixin.stop();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0929'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
 const request=(path,method='GET',body,auth=Cookie())=>fetch(base+path,{method,headers:{...auth,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});function Cookie(){return {Cookie:cookie}}
 const json=async(...args)=>{const r=await request(...args);assert.ok(r.ok,await r.clone().text());return r.json()};
 const a=await json('/api/collections','POST',{name:'微信收件'}),b=await json('/api/collections','POST',{name:'其他知识库'});
 const account={base:'https://ilinkai.weixin.qq.com',token:'PRIVATE-TOKEN',bot:'bot',user:'owner'};
 const state=()=>JSON.parse(runtime.db.prepare("SELECT value FROM settings WHERE key='weixin_inbox_v1'").get().value);
 const store=s=>runtime.db.prepare("INSERT INTO settings(key,value) VALUES('weixin_inbox_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(s));
 store({enabled:true,collection_id:a.id,tags:['灵感'],account,cursor:'',jobs:[]});
 const photo={type:2,image_item:{media:{encrypt_query_param:'resource',aes_key:'PRIVATE-KEY'}}},text={type:1,text_item:{text:'**想法** [链接](https://example.com/)\n\n保留原文'}};
 const msg=(id,items,from='owner')=>({message_type:1,message_state:2,message_id:id,from_user_id:from,item_list:items,create_time_ms:Date.now()});
 const mixed=msg(1,[text,photo,photo]);next=[mixed,msg(2,[photo],'other-person'),{...msg(3,[photo]),message_type:2}];
 await runtime.weixin.tick(new AbortController().signal);assert.equal(state().jobs.length,1);assert.equal(state().cursor,'cursor');
 // A later destination change must not move an already received message.
 const s=state();s.collection_id=b.id;store(s);
 await runtime.weixin.tick(new AbortController().signal);
 const rows=runtime.db.prepare('SELECT * FROM items').all(),note=rows.find(r=>r.kind==='note'),images=rows.filter(r=>r.kind==='image');
 assert.equal(rows.length,3);assert.equal(images.length,2);assert.ok(rows.every(r=>r.collection_id===a.id));assert.ok(images.every(r=>r.group_key==='note:'+note.id));assert.notEqual(images[0].id,images[1].id);assert.equal(images[0].file_key,images[1].file_key);
 assert.ok(note.content.includes(text.text_item.text));assert.ok(note.content.includes('/media/'));assert.ok(!note.content.includes('PRIVATE'));assert.deepEqual(JSON.parse(note.tags),['微信','灵感']);
 for(const row of images)assert.deepEqual(await originalBuffer(dir,row),image);
 const publicState=await json('/api/weixin');assert.ok(!JSON.stringify(publicState).includes('PRIVATE'));assert.ok(!JSON.stringify(publicState).includes('resource'));
 const token=await json('/api/tokens','POST',{name:'reader',scope:'read'});assert.equal((await request('/api/weixin','GET',undefined,{Authorization:'Bearer '+token.token})).status,403);
 next=[mixed];await runtime.weixin.tick(new AbortController().signal);assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,3);
 // Simulate a crash after content was committed but before completion was recorded.
 const crash=state();crash.jobs[0].state='pending';crash.jobs[0].message=mixed;store(crash);const before=downloads;await runtime.weixin.tick(new AbortController().signal);assert.equal(downloads,before);assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,3);
 failure=true;next=[msg(4,[photo])];await runtime.weixin.tick(new AbortController().signal);await runtime.weixin.tick(new AbortController().signal);assert.equal(state().jobs.at(-1).state,'failed');assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,3);
 failure=false;const retry=state();retry.jobs.at(-1).state='pending';store(retry);await runtime.weixin.tick(new AbortController().signal);assert.equal(state().jobs.at(-1).state,'done');assert.equal(runtime.db.prepare('SELECT count(*) n FROM items WHERE collection_id=?').get(b.id).n,1);
 assert.equal(weixinItemId(weixinMessageKey(mixed,account)),note.id);
 assert.throws(()=>weixinMessageKey(msg(Number.MAX_SAFE_INTEGER+10,[text]),account));
 const changed=state();changed.collection_id=a.id;store(changed);next=[msg(5,[text,photo])];await runtime.weixin.tick(new AbortController().signal);await runtime.weixin.tick(new AbortController().signal);
 const fresh=state().jobs.at(-1);assert.equal(fresh.state,'done');assert.ok(fresh.items.includes(weixinItemId(fresh.id,0)),'A separate message gets stable image identity even when bytes match an older note');
 await runtime.backups.run();const backup=(await runtime.backups.list())[0];const restoredDir=await mkdtemp(resolve('artifacts/weixin-restore-')),restored=createApp({dataDir:restoredDir,weixinClient:client});
 try{const preview=await restored.backups.preview(runtime.backups.file(backup.id));await restored.backups.restore(preview.id);assert.deepEqual(JSON.parse(restored.db.prepare("SELECT value FROM settings WHERE key='weixin_inbox_v1'").get().value),state());assert.deepEqual(restored.weixin.status().jobs,runtime.weixin.status().jobs);for(const row of restored.db.prepare("SELECT * FROM items WHERE kind='image'").all())assert.deepEqual(await originalBuffer(restoredDir,row),image);}finally{await restored.weixin.stop();await restored.backups.stop();await restored.trash.stop();await restored.imports.stop();await restored.webhooks.stop();restored.db.close();}
});
