import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
import {reorderLocalImages,markdownImages} from '../shared/markdown-images.js';

test('image order persists independently of Pixiv page identity, rejects stale/cross-library sets, synchronizes notes and restores',async t=>{
 const dir=await mkdtemp(resolve('artifacts/group-order-')),runtime=createApp({dataDir:join(dir,'data')}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'0966'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
 const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const json=async(...args)=>{const r=await request(...args);assert.ok(r.ok,await r.clone().text());return r.json()};
 const a=await json('/api/collections','POST',{name:'漫画'}),b=await json('/api/collections','POST',{name:'另一知识库'});
 const bytes=await sharp({create:{width:64,height:48,channels:3,background:'#7788aa'}}).png().toBuffer();
 const upload=async(index,collection=a.id)=>{const form=new FormData();form.set('file',new Blob([bytes]),'page.png');form.set('collection_id',collection);form.set('title','分镜 '+index);form.set('source_url','https://www.pixiv.net/artworks/12345');form.set('group_key','pixiv:art:12345');form.set('group_index',index);const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:form});assert.ok(r.ok);return r.json()};
 const pages=[await upload(0),await upload(1),await upload(2)],id=pages[0].id;
 const state=()=>json('/api/item-groups/order?id='+id);
 const original=await state(),ids=[pages[2].id,pages[0].id,pages[1].id];
 const sorted=await json('/api/item-groups/order','POST',{id,revision:original.revision,ids});assert.deepEqual(sorted.items.map(i=>i.id),ids);assert.equal(sorted.cover_id,ids[0]);
 for(let i=0;i<3;i++){assert.equal((await json('/api/items/'+pages[i].id)).group_index,i);assert.equal((await upload(i)).id,pages[i].id)}
 assert.deepEqual((await state()).items.map(i=>i.id),ids,'reimport preserves manual display order');
 const added=await upload(3);ids.push(added.id);assert.deepEqual((await state()).items.map(i=>i.id),ids,'new pages append even when all originals have identical bytes');
 assert.equal((await json('/api/items?collection='+a.id+'&grouped=true')).items[0].id,ids[0]);
 const foreign=await upload(0,b.id),current=await state(),before=runtime.db.prepare('SELECT * FROM items ORDER BY id').all();
 for(const body of [{id,revision:original.revision,ids},{id,revision:current.revision,ids:[...ids.slice(1),foreign.id]},{id,revision:current.revision,ids:[ids[0],...ids.slice(0,-1)]}])assert.equal((await request('/api/item-groups/order','POST',body)).status,409);
 assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(),before,'conflicts roll back all rows');
 for(const page of pages)await json('/api/items/'+page.id+'/copy','POST',{collection_id:null});
 assert.equal((await json('/api/items?collection=unfiled&grouped=true')).items[0].group_order,0);
 const note=await json('/api/items','POST',{title:'分镜笔记',collection_id:a.id,content:`开头 [文字链接](https://example.com)\n\n[![第一页](${pages[0].url} "标题")](https://example.com/one)\n\n中间正文\n\n![第二页](${pages[1].url})\n\n结尾`});
 const ns=()=>json('/api/item-groups/order?id='+note.id),n1=await ns(),nids=n1.items.map(i=>i.id).reverse();
 const reordered=await json('/api/item-groups/order','POST',{id:note.id,revision:n1.revision,ids:nids});
 assert.deepEqual(markdownImages(reordered.item.content,true).map(i=>i.url.split('/')[2]),nids);assert.ok(reordered.item.content.includes('[文字链接](https://example.com)'));assert.ok(reordered.item.content.includes('](https://example.com/one)'));assert.ok(reordered.item.content.indexOf('中间正文')>reordered.item.content.indexOf('第二页'));
 const n2=await ns(),nids2=[...nids].reverse();await json('/api/item-groups/order','POST',{id:note.id,revision:n2.revision,ids:nids2,sync_note:false});
 let currentNote=await json('/api/items/'+note.id);assert.equal(currentNote.content,reordered.item.content);
 currentNote=await json('/api/items/'+note.id,'PATCH',{version:currentNote.version,title:'只改标题'});assert.deepEqual((await ns()).items.map(i=>i.id),nids2,'metadata-only note saves keep manual order');
 const exported=await request('/api/export?mode=backup'),path=join(dir,'backup.zip');await writeFile(path,Buffer.from(await exported.arrayBuffer()));
 const restored=createApp({dataDir:join(dir,'restored')});try{const preview=await restored.backups.preview(path);await restored.backups.restore(preview.id);assert.deepEqual(restored.db.prepare('SELECT id,group_index,group_order,content FROM items ORDER BY id').all(),runtime.db.prepare('SELECT id,group_index,group_order,content FROM items ORDER BY id').all())}finally{await restored.imports.stop();await restored.backups.stop();await restored.webhooks.stop();restored.db.close()}
 await backup(runtime.db,join(dir,'schema6.sqlite'));await copyFile(join(dir,'schema6.sqlite'),join(dir,'znote.sqlite'));let db=new DatabaseSync(join(dir,'znote.sqlite'));db.exec('DROP TABLE undo_actions; DROP TABLE pending_file_deletions; ALTER TABLE items DROP COLUMN group_order; PRAGMA user_version=5');const old=db.prepare('SELECT * FROM items ORDER BY id').all();db.close();
 db=openDatabase(dir);assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);assert.deepEqual(db.prepare('SELECT * FROM items ORDER BY id').all().map(({group_order,...r})=>{assert.equal(group_order,null);return r}),old.map(r=>({...r})));db.close();db=openDatabase(dir);assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);db.close();
});

test('Markdown ordering moves image syntax, repeated references and image links without rewriting surrounding text',()=>{
 const content='intro\n\n[![A](/media/a/original "caption")](https://example.com/a)\n\ntext\n\n![B][pic]\n\n![again](/media/a/original)\n\n[pic]: /media/b/original "B"\n';
 const output=reorderLocalImages(content,['b','a']);assert.equal(output,'intro\n\n![B][pic]\n\ntext\n\n[![A](/media/a/original "caption")](https://example.com/a)\n\n![again](/media/a/original)\n\n[pic]: /media/b/original "B"\n');
});

