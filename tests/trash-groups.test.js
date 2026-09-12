import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {localMediaReferences} from '../shared/local-media.js';
import {repairDetachedNoteGroups} from '../scripts/repair-detached-note-groups.mjs';

test('purging a note retains its album, cover and order; historical repair is exact, conservative and repeatable',async t=>{
 const dir=await mkdtemp(resolve('artifacts/trash-groups-')),runtime=createApp({dataDir:dir}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()});
 const base='http://127.0.0.1:'+server.address().port,setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0999'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
 const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const json=async(...args)=>{const r=await request(...args);assert.ok(r.ok,await r.clone().text());return r.json()};
 const a=await json('/api/collections','POST',{name:'图集'}),b=await json('/api/collections','POST',{name:'移入库'}),pages=[];
 for(let i=0;i<3;i++){const data=new FormData();data.set('file',new Blob([await sharp({create:{width:32,height:24,channels:3,background:['#789abc','#ab8978','#789a87'][i]}}).png().toBuffer()]),'page.png');data.set('collection_id',a.id);data.set('title','分镜 '+i);const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:data});assert.ok(r.ok);pages.push(await r.json())}
 let note=await json('/api/items','POST',{title:'保留的漫画',collection_id:a.id,content:pages.map(p=>`![页](${p.url})`).join('\n\n')});let order=await json('/api/item-groups/order?id='+note.id);await json('/api/item-groups/order','POST',{id:note.id,revision:order.revision,ids:order.items.map(p=>p.id).reverse(),sync_note:false});
 const selection=[];for(const p of pages){const item=await json('/api/items/'+p.id);selection.push({id:item.id,version:item.version})}await json('/api/items/batch-trash','POST',{collection_id:a.id,items:selection});
 note=await json('/api/items/'+note.id);const ids=localMediaReferences(note.content).map(r=>r.id),beforeOrder=await json('/api/item-groups/order?id='+note.id);assert.deepEqual(beforeOrder.items.map(p=>p.id),[...ids].reverse());
 await request('/api/items/'+note.id,'DELETE');await backup(runtime.db,join(dir,'before-purge.sqlite'));
 const preview=await json('/api/trash/preview','POST',{collection_id:a.id,ids:[note.id]});await json('/api/trash/purge','POST',{collection_id:a.id,ids:[note.id],revision:preview.revision,confirm:'DELETE'});
 const list=await json('/api/items?collection='+a.id+'&kind=image&grouped=true');assert.equal(list.total,1);assert.equal(list.items[0].group_count,3);assert.equal(list.items[0].id,beforeOrder.cover_id);assert.equal(list.items[0].group_key,'album:'+note.id);
 order=await json('/api/item-groups/order?id='+ids[0]);assert.equal(order.note_id,null);assert.deepEqual(order.items.map(p=>p.id),beforeOrder.items.map(p=>p.id));
 // Reproduce exactly the former null-group write, without changing anything else.
 runtime.db.prepare('UPDATE items SET group_key=NULL,group_title=NULL,group_index=0,group_order=NULL WHERE group_key=?').run('album:'+note.id);
 const reference=new DatabaseSync(join(dir,'before-purge.sqlite'),{readOnly:true});
 try{
   assert.deepEqual(repairDetachedNoteGroups(runtime.db,reference),{groups:1,images:6,applied:false});
   const snapshot=runtime.db.prepare('SELECT * FROM items ORDER BY id').all();runtime.db.prepare('UPDATE items SET title=title||? WHERE id=?').run(' changed',ids[0]);assert.throws(()=>repairDetachedNoteGroups(runtime.db,reference,{apply:true}),/changed/);runtime.db.prepare('UPDATE items SET title=? WHERE id=?').run(snapshot.find(p=>p.id===ids[0]).title,ids[0]);assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(),snapshot);
   assert.equal(repairDetachedNoteGroups(runtime.db,reference,{apply:true}).images,6);assert.equal(repairDetachedNoteGroups(runtime.db,reference,{apply:true}).images,0);
 }finally{reference.close()}
 order=await json('/api/item-groups/order?id='+ids[0]);assert.deepEqual(order.items.map(p=>p.id),beforeOrder.items.map(p=>p.id));
 const anchor=await json('/api/items/'+ids[0]);await json('/api/item-groups/move','POST',{id:anchor.id,version:anchor.version,collection_id:b.id,move_note:true});assert.equal((await json('/api/items?collection='+b.id+'&kind=image&grouped=true')).total,1);assert.equal((await json('/api/items?collection='+a.id+'&kind=image&grouped=true')).total,0);
 await json('/api/item-groups/favorite','POST',{group_key:'album:'+note.id,collection_id:b.id,favorite:true});assert.ok((await json('/api/items?collection='+b.id+'&kind=image')).items.every(p=>p.favorite));
 const response=await request('/api/export?mode=backup'),path=join(dir,'album.zip');await writeFile(path,Buffer.from(await response.arrayBuffer()));const restored=createApp({dataDir:join(dir,'restored')});try{const p=await restored.backups.preview(path);await restored.backups.restore(p.id);assert.deepEqual(restored.db.prepare('SELECT id,group_key,group_order,group_index,group_title FROM items ORDER BY id').all(),runtime.db.prepare('SELECT id,group_key,group_order,group_index,group_title FROM items ORDER BY id').all())}finally{await restored.trash.stop();await restored.imports.stop();await restored.backups.stop();await restored.webhooks.stop();restored.db.close()}
});
