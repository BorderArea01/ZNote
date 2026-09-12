import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {markdownImages} from '../shared/markdown-images.js';

test('note groups preserve identical page identities, move atomically with notes and migrate once',async t=>{
 const dir=await mkdtemp(resolve('artifacts/note-groups-'));let runtime,server,base;
 const start=async()=>{runtime=createApp({dataDir:dir});server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;};
 const stop=async()=>{await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()};
 await start();t.after(stop);
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'0933'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
 const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const json=async(...args)=>{const r=await request(...args);assert.ok(r.ok,await r.clone().text());return r.json()};
 const a=await json('/api/collections','POST',{name:'插画'}),b=await json('/api/collections','POST',{name:'笔记'});
 const bytes=await sharp({create:{width:64,height:48,channels:3,background:'#789abc'}}).png().toBuffer();
 const pages=[];for(let i=0;i<3;i++){const form=new FormData();form.set('file',new Blob([bytes]),'page.png');form.set('collection_id',a.id);form.set('group_key','pixiv:art:123');form.set('group_index',i);form.set('tags','["源库标签"]');const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:form});assert.ok(r.ok);pages.push(await r.json());}
 const content=pages.map((p,i)=>`![页 ${i}](${p.url})`).join('\n\n');
 let first=await json('/api/items','POST',{title:'第一篇',content,collection_id:a.id}),second=await json('/api/items','POST',{title:'第二篇',content,collection_id:b.id,tags:['目标库标签']});
 const ids=n=>markdownImages(n.content,true).map(i=>i.url.match(/^\/media\/([^/]+)/)[1]);
 const firstIds=ids(first),secondIds=ids(second);assert.equal(new Set([...firstIds,...secondIds,...pages.map(p=>p.id)]).size,9);assert.equal((await readdir(join(dir,'media'))).length,1,'all note aliases share the physical original');
 first=await json('/api/items/'+first.id,'PATCH',{version:first.version,content:[2,0,1].map(i=>`![页 ${i}](/media/${firstIds[i]}/original)`).join('\n\n')});
 assert.deepEqual(ids(first),[firstIds[2],firstIds[0],firstIds[1]],'identical-byte pages keep their IDs when reordered');
 const group=()=>runtime.db.prepare('SELECT * FROM items WHERE group_key=? ORDER BY group_index').all('note:'+first.id);
 assert.deepEqual(group().map(r=>r.id),ids(first));
 const anchor=await json('/api/items/'+firstIds[2]),copy=await json('/api/items/'+anchor.id+'/copy','POST',{collection_id:b.id});
 const before=runtime.db.prepare('SELECT * FROM items ORDER BY id').all();
 assert.equal((await request('/api/item-groups/move','POST',{id:anchor.id,version:anchor.version,collection_id:b.id,move_note:true})).status,409);
 assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(),before,'conflicting move must leave every row unchanged');
 assert.equal((await request('/api/items/'+copy.id,'DELETE')).status,204);
 const moved=await json('/api/item-groups/move','POST',{id:anchor.id,version:anchor.version,collection_id:b.id,move_note:true});assert.equal(moved.moved_count,3);assert.equal((await json('/api/items/'+first.id)).collection_id,b.id);assert.ok(group().filter(r=>!r.deleted_at).every(r=>r.collection_id===b.id));
 first=await json('/api/items/'+first.id);
 const active=group().filter(r=>!r.deleted_at);await json('/api/items/batch-organize','POST',{items:[{id:first.id,version:first.version},...active.map(({id,version})=>({id,version}))],collection_id:a.id});
 assert.ok(group().filter(r=>!r.deleted_at).every(r=>r.collection_id===a.id));assert.equal((await json('/api/items/'+second.id)).collection_id,b.id);
 first=await json('/api/items/'+first.id);first=await json('/api/items/'+first.id,'PATCH',{version:first.version,content:`![保留](/media/${firstIds[2]}/original)`});
 assert.equal(group().length,1);assert.equal((await json('/api/items/'+firstIds[0])).group_key,null,'removing a note reference detaches rather than deletes its asset');
 assert.equal((await json('/api/tags')).length,0,'default tags do not disclose other libraries');
 assert.ok(!(await json('/api/tags?collection='+a.id)).some(t=>t.name==='目标库标签'));
 const read=await json('/api/tokens','POST',{name:'只读',scope:'read'});
 const denied=await fetch(base+'/api/item-groups/move',{method:'POST',headers:{Authorization:'Bearer '+read.token,'content-type':'application/json'},body:JSON.stringify({id:firstIds[2],version:1,collection_id:b.id,move_note:true})});assert.equal(denied.status,403);
 const backup=await request('/api/export?mode=backup'),zip=join(dir,'test-backup.zip');await writeFile(zip,Buffer.from(await backup.arrayBuffer()));
 const restored=createApp({dataDir:join(dir,'restore')});try{const p=await restored.backups.preview(zip);await restored.backups.restore(p.id);assert.deepEqual(restored.db.prepare('SELECT id,collection_id,group_key,group_index,content,hash FROM items ORDER BY id').all(),runtime.db.prepare('SELECT id,collection_id,group_key,group_index,content,hash FROM items ORDER BY id').all());}finally{await restored.imports.stop();await restored.backups.stop();await restored.webhooks.stop();restored.db.close()}
 // Recreate the pre-upgrade shape and check automatic migration and restart stability.
 runtime.db.prepare("DELETE FROM settings WHERE key='note_groups_v1'").run();runtime.db.prepare("UPDATE items SET group_key=NULL,group_title=NULL,group_index=0 WHERE group_key LIKE 'note:%'").run();
 await stop();await start();assert.equal(runtime.db.prepare('SELECT count(*) AS n FROM items WHERE group_key=?').get('note:'+second.id).n,3);
 const migrated=runtime.db.prepare('SELECT * FROM items ORDER BY id').all();await stop();await start();assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(),migrated,'migration must be idempotent');
 for(const id of secondIds){const r=await request('/media/'+id+'/original');assert.ok(r.ok);assert.ok(Buffer.from(await r.arrayBuffer()).equals(bytes));}
});
