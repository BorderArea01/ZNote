import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import {extendPageWindow} from '../src/page-window.js';

test('bounded page window traverses forward and backward without losing order',()=>{
 const all=Array.from({length:1847},(_,id)=>({id:String(id)})); let items=all.slice(0,60),offset=0;
 while(offset+items.length<all.length){const next=offset+items.length; ({items,offset}=extendPageWindow(items,offset,{offset:next,items:all.slice(next,next+60)},false));assert.ok(items.length<=300);assert.deepEqual(items,all.slice(offset,offset+items.length));}
 assert.equal(offset+items.length,1847);
 while(offset){const next=Math.max(0,offset-60);({items,offset}=extendPageWindow(items,offset,{offset:next,items:all.slice(next,offset)},true));assert.ok(items.length<=300);assert.deepEqual(items,all.slice(offset,offset+items.length));}
 assert.throws(()=>extendPageWindow(items,0,{offset:600,items:[items[0]]},false));
});

test('summary lists avoid full bodies, preserve grouping/search and reject changed pagination cursors',async t=>{
 const dir=await mkdtemp(resolve('artifacts/page-summary-')),runtime=createApp({dataDir:dir}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()});
 const base='http://127.0.0.1:'+server.address().port,setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0919'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
 const get=path=>fetch(base+path,{headers:{Cookie:cookie}});
 const ids=[],content='前言'.repeat(9990)+'正文末尾唯一检索',date=new Date().toISOString();
 const insert=runtime.db.prepare("INSERT INTO items(id,kind,title,content,created_at,updated_at) VALUES(?,'note',?,?,?,?)");runtime.db.exec('BEGIN');for(let i=0;i<65;i++){let id=randomUUID();ids.push(id);insert.run(id,'笔记'+String(i).padStart(3,'0'),content,date,date)}runtime.db.exec('COMMIT');
 const firstResponse=await get('/api/items?summary=true&sort=title&grouped=true');const raw=await firstResponse.text();assert.ok(Buffer.byteLength(raw)<300000);const first=JSON.parse(raw);assert.equal(first.items.length,60);assert.ok(first.items.every(i=>i.summary&&i.content.length===1000&&i.content_length===content.length));
 assert.equal((await (await get('/api/items/'+ids[0])).json()).content,content);
 assert.equal((await (await get('/api/items?limit=1')).json()).items[0].content,content);
 const search=await (await get('/api/items?summary=true&q='+encodeURIComponent('正文末尾唯一检索')+'&anchor='+ids[62]+'&sort=title')).json();assert.equal(search.offset,60);assert.equal(search.total,65);
 assert.equal((await get('/api/items?summary=true&offset=60&cursor='+first.event_cursor)).status,200);
 const change=await fetch(base+'/api/items/'+ids[0],{method:'PATCH',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({favorite:true,version:1})});assert.equal(change.status,200);
 assert.equal((await get('/api/items?summary=true&offset=60&cursor='+first.event_cursor)).status,409);
 assert.equal((await get('/api/items?offset=60')).status,200,'legacy callers remain compatible');
 console.log('Summary bytes for 60 long notes:',Buffer.byteLength(raw));
});
