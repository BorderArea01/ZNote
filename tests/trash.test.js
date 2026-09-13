import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,unlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {localMediaReferences,replaceLocalMedia} from '../shared/local-media.js';

test('Markdown reference ranges preserve images, links and definitions without rewriting code',()=>{
 const content='![alt](/media/a/original "title")\n\n[![inner](/media/b/thumbnail)](/media/a/original)\n\n![ref][pic]\n\n[pic]: </media/b/original> "caption"\n\n`![fake](/media/a/original)`';
 const tricky='![alt](/media/a/original "caption ]( text")';assert.equal(replaceLocalMedia(tricky,localMediaReferences(tricky),new Map([['a','b']])),'![alt](/media/b/original "caption ]( text")');
 const refs=localMediaReferences(content);assert.equal(refs.length,4);const result=replaceLocalMedia(content,refs,new Map([['a','new-a'],['b','new-b']]));assert.match(result,/new-a\/original "title"/);assert.match(result,/<\/media\/new-b\/original>/);assert.match(result,/`!\[fake\]\(\/media\/a\/original\)`/);
});

test('trash preserves independent attachments, rejects deleted references, scopes purge and retries durable file cleanup',async t=>{
 const dir=await mkdtemp(resolve('artifacts/trash-api-'));let denyUnlink=false;
 const runtime=createApp({dataDir:dir,trashOptions:{unlinkFile:async path=>{if(denyUnlink)throw Object.assign(Error('busy'),{code:'EBUSY'});await unlink(path)}}}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()});
 const base='http://127.0.0.1:'+server.address().port;
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'0988'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
 const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const json=async(...args)=>{const r=await request(...args);assert.ok(r.ok,await r.clone().text());return r.json()};
 const a=await json('/api/collections','POST',{name:'当前库'}),b=await json('/api/collections','POST',{name:'其他库'});
 async function image(color='#abcdef',collection=a.id){const bytes=await sharp({create:{width:40,height:30,channels:3,background:color}}).png().toBuffer();const data=new FormData();data.set('file',new Blob([bytes]),'test.png');data.set('collection_id',collection);const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:data});assert.ok(r.ok);return r.json()}
 const original=await image(),foreign=await image('#abcdef',b.id);
 let note=await json('/api/items','POST',{title:'笔记',content:`![正文](${original.url})\n\n[原图](${original.url})`,collection_id:a.id});
 assert.equal((await request('/api/items/'+original.id,'DELETE')).status,204);
 note=await json('/api/items/'+note.id);const aliasId=localMediaReferences(note.content)[0].id;assert.notEqual(aliasId,original.id);assert.ok(localMediaReferences(note.content).every(r=>r.id===aliasId));assert.equal((await json('/api/items/'+aliasId)).deleted_at,null);assert.equal((await readdir(join(dir,'media'))).length,1);
 assert.equal((await request('/api/items','POST',{title:'错误引用',content:`![x](${original.url})`,collection_id:a.id})).status,409);
 const preview=await json('/api/trash/preview','POST',{collection_id:a.id,ids:[original.id]});assert.equal(preview.count,1);assert.equal(preview.reclaimable_bytes,0);
 const purge=await json('/api/trash/purge','POST',{collection_id:a.id,ids:[original.id],revision:preview.revision,confirm:'DELETE'});assert.equal(purge.freed_files,0);assert.equal((await request(original.url)).status,404);assert.ok((await request('/media/'+aliasId+'/original')).ok);assert.ok((await request(foreign.url)).ok);
 assert.equal((await request('/api/trash/preview','POST',{collection_id:a.id,ids:[aliasId]})).status,409);
 // Batch delete a note and its image together: preserve attachments even inside the trashed note.
 note=await json('/api/items/'+note.id);let alias=await json('/api/items/'+aliasId);
 await json('/api/items/batch-trash','POST',{collection_id:a.id,items:[{id:alias.id,version:alias.version},{id:note.id,version:note.version}]});
 note=await json('/api/items/'+note.id);const kept=localMediaReferences(note.content)[0].id;assert.notEqual(kept,aliasId);assert.equal((await json('/api/items/'+kept)).deleted_at,null);
 const all=await json('/api/trash/preview','POST',{collection_id:a.id});assert.equal(all.count,2);await json('/api/items/'+note.id+'/restore','POST',{});
 assert.equal((await request('/api/trash/purge','POST',{collection_id:a.id,revision:all.revision,confirm:'DELETE'})).status,409);
 const fresh=await json('/api/trash/preview','POST',{collection_id:a.id});await json('/api/trash/purge','POST',{collection_id:a.id,revision:fresh.revision,confirm:'DELETE'});assert.ok((await request('/api/items/'+note.id)).ok);
 // Last reference removal physically frees a file, with retry when unlink fails.
 const unique=await image('#123456');await request('/api/items/'+unique.id,'DELETE');denyUnlink=true;
 const uniquePreview=await json('/api/trash/preview','POST',{collection_id:a.id});const queued=await json('/api/trash/purge','POST',{collection_id:a.id,revision:uniquePreview.revision,confirm:'DELETE'});assert.equal(queued.pending_files,1);assert.equal(queued.freed_files,0);denyUnlink=false;await runtime.trash.retry();assert.equal(runtime.db.prepare('SELECT count(*) n FROM pending_file_deletions').get().n,0);assert.equal((await readdir(join(dir,'media'))).length,1);
 // Entire trash is not limited to the 100-row page; never crosses libraries.
 for(let i=0;i<105;i++)await json('/api/items','POST',{title:'待清空 '+i,collection_id:a.id});
 runtime.db.prepare("UPDATE items SET deleted_at='2026-09-13' WHERE title LIKE '待清空 %'").run();await request('/api/items/'+foreign.id,'DELETE');
 const full=await json('/api/trash/preview','POST',{collection_id:a.id});assert.equal(full.count,105);await json('/api/trash/purge','POST',{collection_id:a.id,revision:full.revision,confirm:'DELETE'});assert.ok((await json('/api/items/'+foreign.id)).deleted_at);assert.equal((await json('/api/trash/preview','POST',{collection_id:a.id})).count,0);
 // Repair legacy backups within the restore transaction, preserving source bytes.
 runtime.db.prepare('UPDATE items SET content=? WHERE id=?').run(`![旧配图](${foreign.url})`,note.id);
 const backup=await request('/api/export?mode=backup'),zip=join(dir,'legacy.zip');await writeFile(zip,Buffer.from(await backup.arrayBuffer()));
 const restored=createApp({dataDir:join(dir,'restored')});try{const p=await restored.backups.preview(zip);await restored.backups.restore(p.id);const content=restored.db.prepare('SELECT content FROM items WHERE id=?').get(note.id).content;const id=localMediaReferences(content)[0].id;assert.notEqual(id,foreign.id);assert.equal(restored.db.prepare('SELECT deleted_at FROM items WHERE id=?').get(id).deleted_at,null);assert.equal(restored.db.prepare('PRAGMA user_version').get().user_version, 12);}finally{await restored.trash.stop();await restored.imports.stop();await restored.backups.stop();await restored.webhooks.stop();restored.db.close()}
 transactionRepair();const rows=runtime.db.prepare('SELECT * FROM items ORDER BY id').all();transactionRepair();assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(),rows);
 function transactionRepair(){runtime.db.exec('BEGIN');try{runtime.trash.repairReferences();runtime.db.exec('COMMIT')}catch(e){runtime.db.exec('ROLLBACK');throw e}}
 const token=await json('/api/tokens','POST',{name:'read',scope:'read'});assert.equal((await fetch(base+'/api/trash/preview',{method:'POST',headers:{Authorization:'Bearer '+token.token,'Content-Type':'application/json'},body:JSON.stringify({collection_id:a.id})})).status,403);
});


test('file cleanup waits for active work, survives restart and never follows an out-of-directory queue path',async()=>{
 const dir=await mkdtemp(resolve('artifacts/trash-restart-'));let runtime=createApp({dataDir:dir});
 const stop=async()=>{await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();runtime.db.close()};
 try{
   const file=join(dir,'media','pending.bin');await writeFile(file,'original');runtime.db.prepare('INSERT INTO pending_file_deletions VALUES(?)').run('pending.bin');
   let release;const held=runtime.maintenance.work(()=>new Promise(r=>release=r));await Promise.resolve();let completed=false;const cleaning=runtime.trash.retry().then(()=>completed=true);await new Promise(r=>setTimeout(r,40));assert.equal(completed,false);assert.ok((await readdir(join(dir,'media'))).includes('pending.bin'));release();await held;await cleaning;assert.equal((await readdir(join(dir,'media'))).length,0);
   await writeFile(file,'restart');await writeFile(join(dir,'outside.bin'),'safe');runtime.db.prepare('INSERT INTO pending_file_deletions VALUES(?)').run('pending.bin');runtime.db.prepare('INSERT INTO pending_file_deletions VALUES(?)').run('../outside.bin');await stop();runtime=createApp({dataDir:dir});await runtime.trash.retry();assert.equal((await readdir(join(dir,'media'))).length,0);assert.ok((await readdir(dir)).includes('outside.bin'));assert.equal(runtime.db.prepare('SELECT count(*) n FROM pending_file_deletions').get().n,1);
 }finally{await stop()}
});
